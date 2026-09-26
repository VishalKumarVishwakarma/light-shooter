import { Room, Client } from 'colyseus';
import { ShooterState, Player, Bullet, Pickup, Brick, Throw, Cloud } from '../schema/ShooterState.js';
import {
  W, H, SPAWNS, MUZZLE, WEAPONS, PICKUP_POINTS, BRICK_HP,
  STEEL, BRICKS, WATER, ICE, inRect, pointInWall, stepMove, clamp, randomSpot,
} from '../map.js';
import { log, metrics } from '../ops.js';
import type { Rect } from '../map.js';

const TICK = 1000 / 30; // 30Hz authoritative sim (snappy remotes, cheap at 2-8p)
let bulletSeq = 0, pickupSeq = 0, throwSeq = 0, cloudSeq = 0;

// Throwables: grenades pierce guard, smoke hides, fire burns through guard.
const THROWABLE: Record<string, {
  count: 'grenades' | 'smokes' | 'mollies'; give: number; cap: number;
  speed: number; fuse: number; r: number;
}> = {
  grenade: { count: 'grenades', give: 2, cap: 3, speed: 520, fuse: 1.2, r: 130 },
  smoke: { count: 'smokes', give: 2, cap: 3, speed: 520, fuse: 0.45, r: 120 },
  molly: { count: 'mollies', give: 2, cap: 3, speed: 520, fuse: 0.45, r: 100 },
};
const SMOKE_DUR = 6, FIRE_DUR = 6, FIRE_TICK = 0.5, FIRE_DMG = 12;
const NADE_MAX = 80, NADE_MIN = 15;
// electric gun: every hit re-arcs the lock and drags the victim to a crawl
const ELECTRIC_SLOW = 2.5, ELECTRIC_MULT = 0.35;

const MATCH_DEFAULT = 300, KILL_TARGET = 15;
const RELOAD_DEFAULT = 2, PICKUP_DEFAULT = 15, RIFLE_DEFAULT = 25;
const EMPTY_DEFAULT = 300; // empty rooms self-destruct after 5 min idle
const SHIELD_DEFAULT = 2; // spawn protection, seconds

export class ShooterRoom extends Room<ShooterState> {
  maxClients = 8;
  private inputs = new Map<string, { dx: number; dy: number; angle: number }>();
  private matchSeconds = MATCH_DEFAULT;
  private killTarget = KILL_TARGET;
  private reloadSeconds = RELOAD_DEFAULT;
  private pickupSeconds = PICKUP_DEFAULT;
  private rifleSeconds = RIFLE_DEFAULT;
  private emptySeconds = EMPTY_DEFAULT;
  private shieldSeconds = SHIELD_DEFAULT;
  private lastShot = new Map<string, number>();
  private reloadT = new Map<string, number>();
  private lastMelee = new Map<string, number>();
  private vel = new Map<string, { x: number; y: number }>();
  private emptyT = 0;

  private cleanNum(v: any, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  private cleanMove(m: any) {
    return {
      dx: Math.max(-1, Math.min(1, this.cleanNum(m?.dx))),
      dy: Math.max(-1, Math.min(1, this.cleanNum(m?.dy))),
      angle: this.cleanNum(m?.angle),
    };
  }

  onCreate(opts: { matchSeconds?: number; killTarget?: number; reloadSeconds?: number; pickupSeconds?: number; rifleSeconds?: number; roomEmptySeconds?: number; shieldSeconds?: number }) {
    (this as any).autoDispose = false;
    const s = Number(opts?.matchSeconds || MATCH_DEFAULT);
    this.matchSeconds = Math.max(5, Math.min(600, s));
    this.killTarget = Math.max(1, Math.min(50, Number(opts?.killTarget || KILL_TARGET)));
    this.reloadSeconds = Math.max(0.5, Math.min(5, Number(opts?.reloadSeconds || RELOAD_DEFAULT)));
    this.pickupSeconds = Math.max(1, Math.min(60, Number(opts?.pickupSeconds || PICKUP_DEFAULT)));
    this.rifleSeconds = Math.max(1, Math.min(120, Number(opts?.rifleSeconds || RIFLE_DEFAULT)));
    this.emptySeconds = Math.max(5, Number(opts?.roomEmptySeconds || EMPTY_DEFAULT));
    this.shieldSeconds = Math.max(0, Math.min(60, Number(opts?.shieldSeconds ?? SHIELD_DEFAULT)));
    this.setState(new ShooterState());
    this.state.timeLeft = this.matchSeconds; // lobby previews full duration
    this.state.killTarget = this.killTarget;
    this.spawnPickups();
    this.resetBricks();
    metrics.roomsCreated++;
    log('info', 'room created', { roomId: this.roomId });
    this.syncMeta();
    this.setSimulationInterval((dt) => this.tick(dt / 1000), TICK);

    this.onMessage('move', (c, m: { dx: number; dy: number; angle: number }) => {
      if (this.state.phase !== 'playing') return;
      this.inputs.set(c.sessionId, this.cleanMove(m));
    });
    this.onMessage('shoot', (c, m: { angle: number }) => {
      if (this.state.phase !== 'playing') return;
      const p = this.state.players.get(c.sessionId);
      if (!p || !p.alive || p.reloading) return;
      if (p.guard) return; // shield raised: knife only — lower it (Q) to fire
      const w = WEAPONS[p.weapon] || WEAPONS.pistol;
      const now = Date.now() / 1000;
      if (now - (this.lastShot.get(c.sessionId) || 0) < w.interval) return; // fire-rate limit
      if (!this.owns(p, p.weapon)) return;
      if (this.ammoOf(p, p.weapon) <= 0) { this.startReload(c.sessionId); return; }
      this.setAmmo(p, p.weapon, this.ammoOf(p, p.weapon) - 1);
      this.lastShot.set(c.sessionId, now);
      p.shots++;
      const base = this.cleanNum(m?.angle);
      const n = w.pellets || 1;
      for (let i = 0; i < n; i++) {
        const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 * (w.spread || 0);
        this.spawnBullet(c, base + off, w, p.weapon);
      }
    });
    this.onMessage('reload', (c) => {
      if (this.state.phase !== 'playing') return;
      this.startReload(c.sessionId);
    });
    this.onMessage('guard', (c, m?: { on?: boolean }) => {
      if (this.state.phase !== 'playing') return;
      const p = this.state.players.get(c.sessionId);
      if (!p || !p.alive) return;
      // {on:true} raises (slot 7), {on:false} lowers, absent toggles (Q/button)
      p.guard = typeof m?.on === 'boolean' ? m.on : !p.guard;
    });
    this.onMessage('throw', (c, m?: { kind?: string; angle?: number }) => {
      if (this.state.phase !== 'playing') return;
      const p = this.state.players.get(c.sessionId);
      if (!p || !p.alive || p.guard) return; // lower the shield to throw
      const kind = String(m?.kind || '');
      const T = THROWABLE[kind];
      if (!T || p[T.count] <= 0) return;
      p[T.count]--;
      const a = this.cleanNum(m?.angle);
      const th = new Throw();
      th.id = `th_${Date.now()}_${throwSeq++}`;
      th.kind = kind;
      th.x = p.x + Math.cos(a) * 30; th.y = p.y + Math.sin(a) * 30;
      th.vx = Math.cos(a) * T.speed; th.vy = Math.sin(a) * T.speed;
      th.t = T.fuse; th.ownerId = c.sessionId;
      this.state.throws.set(th.id, th);
    });
    this.onMessage('switch', (c, m: { weapon?: string }) => {
      if (this.state.phase !== 'playing') return;
      const p = this.state.players.get(c.sessionId);
      if (!p || !p.alive) return;
      const want = ['pistol', 'rifle', 'shotgun', 'sniper', 'laser', 'electric'].includes(m?.weapon || '')
        ? String(m?.weapon) : 'pistol';
      if (!this.owns(p, want)) return; // must pick one up first
      p.weapon = want;
      p.guard = false; // drawing a gun holsters the shield (shield is slot 7)
      p.reloading = false;
      p.reloadLeft = 0;
      this.reloadT.delete(c.sessionId);
    });
    this.onMessage('melee', (c) => {
      if (this.state.phase !== 'playing') return;
      const p = this.state.players.get(c.sessionId);
      if (!p || !p.alive) return;
      const now = Date.now() / 1000;
      if (now - (this.lastMelee.get(c.sessionId) || 0) < 0.8) return; // swing cooldown
      this.lastMelee.set(c.sessionId, now);
      // close-range arc in facing direction: 70px reach, 50 dmg
      this.state.players.forEach((q, qid) => {
        if (qid === c.sessionId || !q.alive) return;
        const dx = q.x - p.x, dy = q.y - p.y;
        if (dx * dx + dy * dy > 70 * 70) return;
        let da = Math.atan2(dy, dx) - p.angle;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        if (Math.abs(da) > 0.7) return;
        this.directHit(q, qid, 50, c.sessionId, p.x, p.y);
      });
    });
    this.onMessage('interact', (c) => {
      if (this.state.phase !== 'playing') return;
      this.tryCollect(c.sessionId, true); // E key: manual pickup (weapons require it)
    });
    this.onMessage('ping', (c, m: { t?: number }) => {
      try { c.send('pong', { t: typeof m?.t === 'number' ? m.t : 0 }); } catch { /* gone */ }
    });
    this.onMessage('toggleReady', (c) => {
      if (this.state.phase !== 'lobby') return;
      const p = this.state.players.get(c.sessionId);
      if (!p) return;
      p.ready = !p.ready;
    });
    this.onMessage('startGame', (c) => {
      if (this.state.phase !== 'lobby') return;
      // only the lobby creator (host) may start
      if (c.sessionId !== this.state.hostId) return;
      if (this.state.players.size >= 2) this.startCountdown();
    });
    this.onMessage('rematch', (c) => {
      if (this.state.phase !== 'ended') return;
      // only host may send everyone back to lobby
      if (c.sessionId !== this.state.hostId) return;
      this.resetToLobby();
    });
  }

  onJoin(c: Client, opts: { name?: string }) {
    const p = new Player();
    const i = this.clients.length % SPAWNS.length;
    p.x = SPAWNS[i][0]; p.y = SPAWNS[i][1];
    // server-side sanitize: strip markup, trim, cap (mirrors client cleanName)
    const raw = String(opts?.name || '').replace(/[<>&"']/g, '').trim().slice(0, 12);
    p.name = raw || 'Soldier' + i;
    this.state.players.set(c.sessionId, p);
    this.inputs.set(c.sessionId, { dx: 0, dy: 0, angle: 0 });
    this.vel.set(c.sessionId, { x: 0, y: 0 });
    // first player in = lobby creator (host)
    if (!this.state.hostId || !this.state.players.has(this.state.hostId)) {
      this.state.hostId = c.sessionId;
    }
    log('info', 'player joined', { roomId: this.roomId, name: p.name, count: this.clients.length });
  }

  onLeave(c: Client) {
    const wasHost = c.sessionId === this.state.hostId;
    metrics.disconnects++;
    log('info', 'player left', { roomId: this.roomId, wasHost, count: this.clients.length });
    this.state.players.delete(c.sessionId);
    this.inputs.delete(c.sessionId);
    this.vel.delete(c.sessionId);
    this.lastShot.delete(c.sessionId);
    this.reloadT.delete(c.sessionId);
    this.lastMelee.delete(c.sessionId);
    // host migration: oldest remaining player becomes host
    if (wasHost) {
      const next = this.state.players.keys().next();
      this.state.hostId = next.done ? '' : next.value;
    }
    if (this.state.phase === 'playing' && this.state.players.size < 2) {
      this.resetToLobby();
    }
  }

  private startCountdown() {
    if (this.state.phase !== 'lobby') return;
    this.state.phase = 'countdown';
    this.state.countdown = 3;
    this.syncMeta();
  }

  private spawnPickups() {
    for (const [kind, x, y] of PICKUP_POINTS) {
      const pk = new Pickup();
      pk.id = `pk_${pickupSeq++}`;
      pk.kind = kind; pk.x = x; pk.y = y;
      pk.active = true; pk.t = 0;
      this.state.pickups.set(pk.id, pk);
    }
  }

  private resetBricks() {
    BRICKS.forEach((_, i) => {
      const id = `br_${i}`;
      let b = this.state.bricks.get(id);
      if (!b) {
        b = new Brick();
        b.id = id;
        this.state.bricks.set(id, b);
      }
      b.hp = BRICK_HP;
    });
  }

  // steel + standing bricks + water
  private solids(): Rect[] {
    const out: Rect[] = [...STEEL, ...WATER];
    BRICKS.forEach((rc, i) => {
      if ((this.state.bricks.get(`br_${i}`)?.hp ?? BRICK_HP) > 0) out.push(rc);
    });
    return out;
  }

  private ammoOf(p: Player, w: string) {
    return w === 'rifle' ? p.ammo : w === 'shotgun' ? p.sammo : w === 'sniper' ? p.nammo
      : w === 'laser' ? p.lammo : w === 'electric' ? p.eammo : p.pammo;
  }

  private setAmmo(p: Player, w: string, v: number) {
    if (w === 'rifle') p.ammo = v;
    else if (w === 'shotgun') p.sammo = v;
    else if (w === 'sniper') p.nammo = v;
    else if (w === 'laser') p.lammo = v;
    else if (w === 'electric') p.eammo = v;
    else p.pammo = v;
  }

  private owns(p: Player, w: string) {
    return w === 'pistol' || (w === 'rifle' && p.rifle)
      || (w === 'shotgun' && p.shotgun) || (w === 'sniper' && p.sniper)
      || (w === 'laser' && p.laser) || (w === 'electric' && p.electric);
  }

  private startReload(id: string) {
    const p = this.state.players.get(id);
    if (!p || !p.alive || p.reloading || !this.owns(p, p.weapon)) return;
    if (this.ammoOf(p, p.weapon) >= WEAPONS[p.weapon].clip) return;
    p.reloading = true;
    const t = p.weapon === 'rifle' ? this.reloadSeconds : WEAPONS[p.weapon].reload;
    p.reloadLeft = t;
    this.reloadT.set(id, t);
  }

  // E key (manual=true) or walk-over (manual=false). Weapons need E; health/ammo auto-collect.
  private tryCollect(id: string, manual: boolean) {
    const p = this.state.players.get(id);
    if (!p || !p.alive) return;
    this.state.pickups.forEach((pk) => {
      if (!pk.active) return;
      const dx = p.x - pk.x, dy = p.y - pk.y;
      if (dx * dx + dy * dy > 30 * 30) return;
      if (pk.kind === 'health') {
        if (p.hp >= 100) return;
        p.hp = Math.min(100, p.hp + 50);
      } else if (pk.kind === 'rifle' || pk.kind === 'shotgun' || pk.kind === 'sniper' || pk.kind === 'laser' || pk.kind === 'electric') {
        if (!manual) return;
        if (pk.kind === 'rifle') p.rifle = true;
        if (pk.kind === 'shotgun') p.shotgun = true;
        if (pk.kind === 'sniper') p.sniper = true;
        if (pk.kind === 'laser') p.laser = true;
        if (pk.kind === 'electric') p.electric = true;
        p.weapon = pk.kind;
        this.setAmmo(p, pk.kind, WEAPONS[pk.kind].clip);
        p.reloading = false;
        this.reloadT.delete(id);
      } else if (pk.kind === 'ammo') {
        if (p.weapon === 'pistol' || !this.owns(p, p.weapon)) return;
        if (this.ammoOf(p, p.weapon) >= WEAPONS[p.weapon].clip) return;
        this.setAmmo(p, p.weapon, WEAPONS[p.weapon].clip);
        p.reloading = false;
        this.reloadT.delete(id);
      } else if (pk.kind === 'shield') {
        p.shieldPts = 100;
      } else if (pk.kind === 'speed') {
        p.speedT = 8;
      } else if (pk.kind === 'grenade' || pk.kind === 'smoke' || pk.kind === 'molly') {
        const T = THROWABLE[pk.kind]; // walk-over reload, capped
        if (p[T.count] >= T.cap) return;
        p[T.count] = Math.min(T.cap, p[T.count] + T.give);
      }
      pk.active = false;
      pk.t = pk.kind === 'rifle' ? this.rifleSeconds : this.pickupSeconds;
      this.broadcast('collect', { name: p.name, kind: pk.kind, x: pk.x, y: pk.y });
    });
  }

  // shared melee/direct damage path (mirrors bullet-hit rules)
  private directHit(q: Player, qid: string, dmg: number, killerId: string, ox: number, oy: number) {
    const before = Math.max(0, q.hp);
    if (q.shield > 0) {
      this.broadcast('hit', { x: q.x, y: q.y, by: killerId, dmg: 0, ox, oy, to: qid });
      return;
    }
    const absorbed = Math.min(dmg, q.shieldPts);
    const eff = dmg - absorbed;
    q.shieldPts -= absorbed;
    if (eff <= 0) {
      this.broadcast('hit', { x: q.x, y: q.y, by: killerId, dmg: 0, ox, oy, to: qid });
      return;
    }
    q.hp -= eff;
    const owner = this.state.players.get(killerId);
    this.broadcast('hit', { x: q.x, y: q.y, by: killerId, dmg: eff, ox, oy, to: qid });
    if (owner) {
      owner.damage += Math.min(eff, before);
      owner.hitsMade++;
    }
    if (q.hp <= 0) {
      q.hp = 0; q.alive = false; (q as any)._deadT = 0;
      q.streak = 0; q.deaths++;
      if (owner) {
        owner.kills++;
        owner.streak++;
        owner.cash += 120;
        this.broadcast('kill', { killer: owner.name, victim: q.name, w: 'melee' });
        if (owner.kills >= this.killTarget && this.state.phase === 'playing') {
          this.matchWin(killerId, owner.name);
        }
      }
    }
  }

  private syncMeta() {
    try {
      (this.setMetadata({ phase: this.state.phase }) as any)?.catch?.(() => {});
    } catch { /* listing metadata is best-effort */ }
  }

  private beginPlay() {
    if (this.state.players.size < 2) { // countdown outlived its players
      this.resetToLobby();
      return;
    }
    let i = 0;
    this.state.players.forEach((p) => {
      const s = SPAWNS[i++ % SPAWNS.length];
      p.x = s[0]; p.y = s[1]; p.hp = 100; p.alive = true; p.streak = 0;
      p.kills = 0; p.deaths = 0; p.cash = 0; p.damage = 0; p.reloadLeft = 0;
      p.shots = 0; p.hitsMade = 0; p.shieldPts = 0; p.speedT = 0;
      p.shield = this.shieldSeconds; // spawn protection at match start
      p.weapon = 'pistol'; p.ammo = 0; p.pammo = WEAPONS.pistol.clip;
      p.sammo = 0; p.nammo = 0; p.lammo = 0; p.eammo = 0;
      p.rifle = false; p.shotgun = false; p.sniper = false; p.laser = false; p.electric = false; p.reloading = false;
      p.guard = true; // everyone spawns shielded — lower it (Q) to shoot
      p.grenades = 1; p.smokes = 1; p.mollies = 1; p.smoked = false; p.slowT = 0;
      (p as any)._deadT = 0;
    });
    this.vel.clear();
    this.state.bullets.clear();
    this.state.throws.clear();
    this.state.clouds.clear();
    this.state.pickups.forEach((pk) => { pk.active = true; pk.t = 0; });
    this.resetBricks();
    this.reloadT.clear();
    this.state.winnerId = '';
    this.state.winnerName = '';
    this.state.timeLeft = this.matchSeconds;
    this.state.phase = 'playing';
    metrics.matchesStarted++;
    log('info', 'match started', { roomId: this.roomId, players: this.state.players.size });
    this.syncMeta();
  }

  private resetToLobby() {
    this.state.phase = 'lobby';
    this.state.countdown = 0;
    this.state.winnerId = '';
    this.state.winnerName = '';
    this.state.bullets.clear();
    this.state.throws.clear();
    this.state.clouds.clear();
    this.state.players.forEach((p) => { p.ready = false; p.smoked = false; });
    this.inputs.clear();
    this.vel.clear();
    this.lastShot.clear();
    this.reloadT.clear();
    this.syncMeta();
  }

  private matchWin(id: string, name: string) {
    if (this.state.phase !== 'playing') return;
    this.state.phase = 'ended';
    this.state.winnerId = id;
    this.state.winnerName = name;
    metrics.matchesCompleted++;
    log('info', 'match ended', { roomId: this.roomId, winner: name, reason: 'kill-target' });
    this.syncMeta();
  }

  private timeoutWinner() {
    // most kills wins; tiebreak total damage; unbreakable tie -> DRAW
    let best: Player | null = null, bestId = '', tied = false;
    this.state.players.forEach((p, pid) => {
      if (!best) { best = p; bestId = pid; tied = false; return; }
      if (p.kills > best.kills || (p.kills === best.kills && p.damage > best.damage)) {
        best = p; bestId = pid; tied = false;
      } else if (p.kills === best.kills && p.damage === best.damage) {
        tied = true;
      }
    });
    if (!best || tied) {
      this.state.phase = 'ended';
      this.state.winnerId = '';
      this.state.winnerName = 'DRAW';
      metrics.matchesCompleted++;
      log('info', 'match ended', { roomId: this.roomId, winner: 'DRAW', reason: 'timeout-tie' });
      this.syncMeta();
    } else {
      this.state.phase = 'ended';
      this.state.winnerId = bestId;
      this.state.winnerName = (best as Player).name;
      metrics.matchesCompleted++;
      log('info', 'match ended', { roomId: this.roomId, winner: (best as Player).name, reason: 'timeout' });
      this.syncMeta();
    }
  }

  private spawnBullet(c: Client, angle: number, w: { dmg: number; speed: number; life: number }, weapon = 'pistol') {
    const p = this.state.players.get(c.sessionId);
    if (!p || !p.alive) return;
    const b = new Bullet();
    b.id = `${Date.now()}_${bulletSeq++}`;
    b.ownerId = c.sessionId;
    b.weapon = weapon;
    b.x = p.x + Math.cos(angle) * MUZZLE;
    b.y = p.y + Math.sin(angle) * MUZZLE;
    b.vx = Math.cos(angle) * w.speed;
    b.vy = Math.sin(angle) * w.speed;
    b.life = w.life;
    b.dmg = w.dmg;
    this.state.bullets.set(b.id, b);
  }

  // grenade blast: radial falloff, pierces guard stance (spawn fairness holds)
  private explode(
    x: number, y: number, ownerId: string,
    feed: Array<{ killer: string; victim: string; w: string }>,
    hits: Array<{ x: number; y: number; by: string; dmg: number; ox: number; oy: number; to: string }>,
  ) {
    const R = THROWABLE.grenade.r;
    this.state.players.forEach((q, qid) => {
      if (!q.alive) return;
      const d = Math.hypot(q.x - x, q.y - y);
      if (d >= R) return;
      const dmg = Math.max(NADE_MIN, Math.round(NADE_MAX * (1 - d / R)));
      if (q.shield > 0) {
        hits.push({ x: q.x, y: q.y, by: ownerId, dmg: 0, ox: x, oy: y, to: qid });
        return;
      }
      const before = Math.max(0, q.hp);
      q.hp -= dmg;
      hits.push({ x: q.x, y: q.y, by: ownerId, dmg, ox: x, oy: y, to: qid });
      const owner = this.state.players.get(ownerId);
      if (owner) { owner.damage += Math.min(dmg, before); owner.hitsMade++; }
      if (q.hp <= 0) {
        q.hp = 0; q.alive = false; (q as any)._deadT = 0;
        q.streak = 0; q.deaths++;
        const killer = this.state.players.get(ownerId);
        if (killer) {
          killer.kills++; killer.streak++; killer.cash += 120;
          feed.push({ killer: killer.name, victim: q.name, w: 'grenade' });
          if (killer.kills >= this.killTarget) this.matchWin(ownerId, killer.name);
        }
      }
    });
  }

  private tick(dt: number) {
    // empty rooms self-destruct (autoDispose is off so hosts can re-find them)
    if (this.clients.length === 0) {
      this.emptyT += dt;
      if (this.emptyT >= this.emptySeconds) {
        log('info', 'room expired (empty)', { roomId: this.roomId });
        try { (this as any).disconnect(); } catch { /* already closing */ }
      }
      return;
    }
    this.emptyT = 0;
    if (this.state.phase === 'countdown') {
      this.state.countdown -= dt;
      if (this.state.countdown <= 0) {
        this.state.countdown = 0;
        this.beginPlay();
      }
      return;
    }
    if (this.state.phase !== 'playing') return;
    // players
    this.state.players.forEach((p, id) => {
      if (p.shield > 0) p.shield = Math.max(0, p.shield - dt);
      if (p.speedT > 0) p.speedT = Math.max(0, p.speedT - dt);
      if (p.slowT > 0) p.slowT = Math.max(0, p.slowT - dt); // electric lock wears off
      if (!p.alive) {
        (p as any)._deadT = ((p as any)._deadT || 0) + dt;
        if ((p as any)._deadT > 3) {
          p.alive = true; p.hp = 100;
          p.shield = this.shieldSeconds; // spawn protection
          p.shieldPts = 0; p.speedT = 0; p.slowT = 0; // buffs die with you
          p.guard = true; // respawn shielded
          p.pammo = WEAPONS.pistol.clip;
          if (p.rifle) p.ammo = WEAPONS.rifle.clip;
          if (p.shotgun) p.sammo = WEAPONS.shotgun.clip;
          if (p.sniper) p.nammo = WEAPONS.sniper.clip;
          if (p.laser) p.lammo = WEAPONS.laser.clip;
          if (p.electric) p.eammo = WEAPONS.electric.clip;
          const i = Math.floor(Math.random() * SPAWNS.length);
          p.x = SPAWNS[i][0]; p.y = SPAWNS[i][1];
          (p as any)._deadT = 0;
        }
        return;
      }
      // reload progress
      const rt = this.reloadT.get(id);
      if (rt !== undefined) {
        const left = rt - dt;
        if (left <= 0) {
          this.reloadT.delete(id);
          p.reloading = false;
          p.reloadLeft = 0;
          this.setAmmo(p, p.weapon, WEAPONS[p.weapon].clip);
        } else {
          this.reloadT.set(id, left);
          p.reloadLeft = left;
        }
      }
      // walk-over auto-collect (health/ammo; rifles need E)
      this.tryCollect(id, false);
      const inp = this.inputs.get(id);
      if (inp) {
        const v = this.vel.get(id) || { x: 0, y: 0 };
        // haste stacks with the electric lock — but a live arc always wins
        const mult = p.slowT > 0 ? ELECTRIC_MULT : p.speedT > 0 ? 1.4 : 1;
        const s = stepMove(p.x, p.y, v.x, v.y, inp.dx, inp.dy, dt, this.solids(), inRect(p.x, p.y, ICE), mult);
        p.x = s.x; p.y = s.y;
        this.vel.set(id, { x: s.vx, y: s.vy });
        p.angle = inp.angle;
      }
    });
    // pickup respawn timers: come back at a RANDOM open spot, never the same nest
    this.state.pickups.forEach((pk) => {
      if (pk.active) return;
      pk.t -= dt;
      if (pk.t <= 0) {
        const s = randomSpot(Math.random, this.solids());
        pk.x = Math.round(s.x); pk.y = Math.round(s.y);
        pk.active = true; pk.t = 0;
      }
    });
    // bullets
    const dead: string[] = [];
    const feed: Array<{ killer: string; victim: string; w: string }> = [];
    const hits: Array<{ x: number; y: number; by: string; dmg: number; ox: number; oy: number; to: string; w?: string }> = [];
    const chips: Array<{ x: number; y: number; kind: string }> = [];
    this.state.bullets.forEach((b) => {
      if (this.state.phase !== 'playing') return; // ended mid-tick by a kill target
      const ox = b.x, oy = b.y;
      const nx = ox + b.vx * dt, ny = oy + b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || nx < 0 || nx > W || ny < 0 || ny > H) { dead.push(b.id); return; }
      // swept collision: sample along the path so fast bullets can't tunnel
      // through players or thin walls between ticks (lag-proof hit detection)
      const dist = Math.hypot(nx - ox, ny - oy);
      const steps = Math.max(1, Math.ceil(dist / 18));
      let consumed = false;
      const killAt = (px: number, py: number) => {
        b.x = px; b.y = py;
        dead.push(b.id);
        consumed = true;
      };
      for (let s = 1; s <= steps && !consumed; s++) {
        const px = ox + ((nx - ox) * s) / steps;
        const py = oy + ((ny - oy) * s) / steps;
        if (pointInWall(px, py, STEEL)) { // steel: spark + absorb
          killAt(px, py);
          chips.push({ x: px, y: py, kind: 'steel' });
          break;
        }
        let hitBrick = false; // bricks: crumble + absorb
        BRICKS.forEach((rc, i) => {
          if (hitBrick) return;
          const br = this.state.bricks.get(`br_${i}`);
          if (!br || br.hp <= 0) return;
          if (px >= rc.x && px <= rc.x + rc.w && py >= rc.y && py <= rc.y + rc.h) {
            br.hp--;
            hitBrick = true;
          }
        });
        if (hitBrick) {
          killAt(px, py);
          chips.push({ x: px, y: py, kind: 'brick' });
          break;
        }
        this.state.players.forEach((p, pid) => {
          if (consumed || pid === b.ownerId || !p.alive) return;
          const dx = p.x - px, dy = p.y - py;
          if (dx * dx + dy * dy >= 22 * 22) return;
          const before = Math.max(0, p.hp);
          // electric lock arcs on contact — even a shielded block tethers them,
          // so the gun is a lockdown tool as well as chip damage
          if (b.weapon === 'electric') p.slowT = ELECTRIC_SLOW;
          // raised shield stance blocks bullets entirely (knives bypass it)
          if (p.guard) {
            killAt(px, py);
            hits.push({ x: px, y: py, by: b.ownerId, dmg: 0, ox: 0, oy: 0, to: pid, w: b.weapon });
            return;
          }
          // spawn shield absorbs everything while active (fairness rule)
          if (p.shield > 0) {
            killAt(px, py);
            hits.push({ x: px, y: py, by: b.ownerId, dmg: 0, ox: 0, oy: 0, to: pid, w: b.weapon });
            return;
          }
          // power shield absorbs up to shieldPts first
          const absorbed = Math.min(b.dmg, p.shieldPts);
          const eff = b.dmg - absorbed;
          p.shieldPts -= absorbed;
          if (eff <= 0) {
            killAt(px, py);
            hits.push({ x: px, y: py, by: b.ownerId, dmg: 0, ox: 0, oy: 0, to: pid, w: b.weapon });
            return;
          }
          p.hp -= eff;
          killAt(px, py);
          const owner = this.state.players.get(b.ownerId);
          hits.push({
            x: px, y: py, by: b.ownerId, dmg: eff,
            ox: owner ? owner.x : px, oy: owner ? owner.y : py, to: pid, w: b.weapon,
          });
          if (owner) {
            owner.damage += Math.min(eff, before);
            owner.hitsMade++;
          }
          if (p.hp <= 0) {
            p.hp = 0; p.alive = false; (p as any)._deadT = 0;
            p.streak = 0; p.deaths++;
            const killer = this.state.players.get(b.ownerId);
            if (killer) {
              killer.kills++;
              killer.streak++;
              killer.cash += 120; // GTA payout per elimination
              feed.push({ killer: killer.name, victim: p.name, w: killer.weapon });
              if (killer.kills >= this.killTarget) {
                this.matchWin(b.ownerId, killer.name);
              }
            }
          }
        });
      }
      if (!consumed) { b.x = nx; b.y = ny; }
    });
    dead.forEach((id) => this.state.bullets.delete(id));
    // thrown ordnance: grenades roll + blow, smoke/molly land into clouds
    const deadT: string[] = [];
    this.state.throws.forEach((th) => {
      if (this.state.phase !== 'playing') return;
      th.t -= dt;
      th.x = clamp(th.x + th.vx * dt, 20, W - 20);
      th.y = clamp(th.y + th.vy * dt, 20, H - 20);
      if (th.kind === 'grenade') {
        const fr = Math.max(0, 1 - 3 * dt);
        th.vx *= fr; th.vy *= fr;
        if (th.t <= 0) {
          this.explode(th.x, th.y, th.ownerId, feed, hits);
          this.broadcast('boom', { x: th.x, y: th.y, r: THROWABLE.grenade.r });
          deadT.push(th.id);
        }
      } else if (th.t <= 0) {
        const cl = new Cloud();
        cl.id = `cl_${Date.now()}_${cloudSeq++}`;
        cl.kind = th.kind === 'smoke' ? 'smoke' : 'fire';
        cl.x = th.x; cl.y = th.y;
        cl.r = th.kind === 'smoke' ? THROWABLE.smoke.r : THROWABLE.molly.r;
        cl.t = th.kind === 'smoke' ? SMOKE_DUR : FIRE_DUR;
        cl.tick = 0; cl.ownerId = th.ownerId;
        this.state.clouds.set(cl.id, cl);
        this.broadcast('boom', { x: th.x, y: th.y, r: 60 });
        deadT.push(th.id);
      }
    });
    deadT.forEach((id) => this.state.throws.delete(id));
    // clouds: smoke hides steppers-in, fire ticks everything (guard pierced)
    this.state.players.forEach((p) => { p.smoked = false; });
    const deadC: string[] = [];
    this.state.clouds.forEach((cl) => {
      if (this.state.phase !== 'playing') return;
      cl.t -= dt;
      if (cl.t <= 0) { deadC.push(cl.id); return; }
      if (cl.kind === 'smoke') {
        this.state.players.forEach((p) => {
          if (!p.alive) return;
          if (Math.hypot(p.x - cl.x, p.y - cl.y) < cl.r) p.smoked = true;
        });
      } else {
        cl.tick -= dt;
        if (cl.tick > 0) return;
        cl.tick = FIRE_TICK;
        this.state.players.forEach((q, qid) => {
          if (!q.alive || Math.hypot(q.x - cl.x, q.y - cl.y) >= cl.r) return;
          const before = Math.max(0, q.hp);
          if (q.shield > 0) { // spawn fairness outranks even fire
            hits.push({ x: q.x, y: q.y, by: cl.ownerId, dmg: 0, ox: cl.x, oy: cl.y, to: qid });
            return;
          }
          q.hp -= FIRE_DMG;
          hits.push({ x: q.x, y: q.y, by: cl.ownerId, dmg: FIRE_DMG, ox: cl.x, oy: cl.y, to: qid });
          const owner = this.state.players.get(cl.ownerId);
          if (owner) { owner.damage += Math.min(FIRE_DMG, before); owner.hitsMade++; }
          if (q.hp <= 0) {
            q.hp = 0; q.alive = false; (q as any)._deadT = 0;
            q.streak = 0; q.deaths++;
            const killer = this.state.players.get(cl.ownerId);
            if (killer) {
              killer.kills++; killer.streak++; killer.cash += 120;
              feed.push({ killer: killer.name, victim: q.name, w: 'molly' });
              if (killer.kills >= this.killTarget) this.matchWin(cl.ownerId, killer.name);
            }
          }
        });
      }
    });
    deadC.forEach((id) => this.state.clouds.delete(id));
    feed.forEach((k) => this.broadcast('kill', k));
    hits.forEach((h) => this.broadcast('hit', h));
    chips.forEach((c) => this.broadcast('chip', c));
    if (this.state.phase !== 'playing') return; // a kill target may have just ended it
    // match timer: expiry -> best score wins
    this.state.timeLeft -= dt;
    if (this.state.timeLeft <= 0) {
      this.state.timeLeft = 0;
      this.timeoutWinner();
    }
  }
}
