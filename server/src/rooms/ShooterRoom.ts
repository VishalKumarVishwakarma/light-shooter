import { Room, Client } from 'colyseus';
import { ShooterState, Player, Bullet, Pickup, Brick } from '../schema/ShooterState.js';
import {
  W, H, SPAWNS, MUZZLE, WEAPONS, PICKUP_POINTS, BRICK_HP,
  STEEL, BRICKS, WATER, ICE, inRect, pointInWall, stepMove,
} from '../map.js';
import { log, metrics } from '../ops.js';
import type { Rect } from '../map.js';

const TICK = 1000 / 20;
let bulletSeq = 0, pickupSeq = 0;

const MATCH_DEFAULT = 120, WIN_SCORE = 3;
const RELOAD_DEFAULT = 2, PICKUP_DEFAULT = 15, RIFLE_DEFAULT = 25;
const EMPTY_DEFAULT = 300; // empty rooms self-destruct after 5 min idle
const SHIELD_DEFAULT = 2; // spawn protection, seconds

export class ShooterRoom extends Room<ShooterState> {
  maxClients = 8;
  private inputs = new Map<string, { dx: number; dy: number; angle: number }>();
  private matchSeconds = MATCH_DEFAULT;
  private reloadSeconds = RELOAD_DEFAULT;
  private pickupSeconds = PICKUP_DEFAULT;
  private rifleSeconds = RIFLE_DEFAULT;
  private emptySeconds = EMPTY_DEFAULT;
  private shieldSeconds = SHIELD_DEFAULT;
  private lastShot = new Map<string, number>();
  private reloadT = new Map<string, number>();
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

  onCreate(opts: { matchSeconds?: number; reloadSeconds?: number; pickupSeconds?: number; rifleSeconds?: number; roomEmptySeconds?: number; shieldSeconds?: number }) {
    (this as any).autoDispose = false;
    const s = Number(opts?.matchSeconds || MATCH_DEFAULT);
    this.matchSeconds = Math.max(5, Math.min(600, s));
    this.reloadSeconds = Math.max(0.5, Math.min(5, Number(opts?.reloadSeconds || RELOAD_DEFAULT)));
    this.pickupSeconds = Math.max(1, Math.min(60, Number(opts?.pickupSeconds || PICKUP_DEFAULT)));
    this.rifleSeconds = Math.max(1, Math.min(120, Number(opts?.rifleSeconds || RIFLE_DEFAULT)));
    this.emptySeconds = Math.max(5, Number(opts?.roomEmptySeconds || EMPTY_DEFAULT));
    this.shieldSeconds = Math.max(0, Math.min(60, Number(opts?.shieldSeconds ?? SHIELD_DEFAULT)));
    this.setState(new ShooterState());
    this.state.timeLeft = this.matchSeconds; // lobby previews full duration
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
      const w = WEAPONS[p.weapon] || WEAPONS.pistol;
      const now = Date.now() / 1000;
      if (now - (this.lastShot.get(c.sessionId) || 0) < w.interval) return; // fire-rate limit
      if (p.weapon === 'rifle') {
        if (!p.rifle) return;
        if (p.ammo <= 0) { this.startReload(c.sessionId); return; }
        p.ammo--;
      } else {
        if (p.pammo <= 0) { this.startReload(c.sessionId); return; }
        p.pammo--;
      }
      this.lastShot.set(c.sessionId, now);
      this.spawnBullet(c, this.cleanNum(m?.angle), w);
    });
    this.onMessage('reload', (c) => {
      if (this.state.phase !== 'playing') return;
      this.startReload(c.sessionId);
    });
    this.onMessage('switch', (c, m: { weapon?: string }) => {
      if (this.state.phase !== 'playing') return;
      const p = this.state.players.get(c.sessionId);
      if (!p || !p.alive) return;
      const want = m?.weapon === 'rifle' ? 'rifle' : 'pistol';
      if (want === 'rifle' && !p.rifle) return; // must pick one up first
      p.weapon = want;
      p.reloading = false;
      this.reloadT.delete(c.sessionId);
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

  private startReload(id: string) {
    const p = this.state.players.get(id);
    if (!p || !p.alive || p.reloading) return;
    if (p.weapon === 'rifle') {
      if (!p.rifle || p.ammo >= WEAPONS.rifle.clip) return;
      p.reloading = true;
      p.reloadLeft = this.reloadSeconds;
      this.reloadT.set(id, this.reloadSeconds);
    } else {
      if (p.pammo >= WEAPONS.pistol.clip) return;
      p.reloading = true;
      p.reloadLeft = WEAPONS.pistol.reload;
      this.reloadT.set(id, WEAPONS.pistol.reload);
    }
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
      } else if (pk.kind === 'rifle') {
        if (!manual) return;
        p.rifle = true; p.weapon = 'rifle';
        p.ammo = WEAPONS.rifle.clip; p.reloading = false;
        this.reloadT.delete(id);
      } else if (pk.kind === 'ammo') {
        if (!p.rifle) return;
        if (p.ammo >= WEAPONS.rifle.clip) return;
        p.ammo = WEAPONS.rifle.clip; p.reloading = false;
        this.reloadT.delete(id);
      }
      pk.active = false;
      pk.t = pk.kind === 'rifle' ? this.rifleSeconds : this.pickupSeconds;
      this.broadcast('collect', { name: p.name, kind: pk.kind, x: pk.x, y: pk.y });
    });
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
      p.shield = this.shieldSeconds; // spawn protection at match start
      p.weapon = 'pistol'; p.ammo = 0; p.pammo = WEAPONS.pistol.clip;
      p.rifle = false; p.reloading = false;
      (p as any)._deadT = 0;
    });
    this.vel.clear();
    this.state.bullets.clear();
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
    // tournament over -> fresh scoreboard; otherwise wins carry to next round
    if (this.state.champion) {
      this.state.champion = '';
      this.state.players.forEach((p) => { p.wins = 0; });
    }
    this.state.bullets.clear();
    this.state.players.forEach((p) => { p.ready = false; });
    this.inputs.clear();
    this.vel.clear();
    this.lastShot.clear();
    this.reloadT.clear();
    this.syncMeta();
  }

  private awardWin(id: string, name: string) {
    this.state.phase = 'ended';
    this.state.winnerId = id;
    this.state.winnerName = name;
    const w = this.state.players.get(id);
    if (w) {
      w.wins++;
      if (w.wins >= WIN_SCORE) this.state.champion = name;
    }
    metrics.matchesCompleted++;
    log('info', 'match ended', { roomId: this.roomId, winner: name });
    this.syncMeta();
  }

  private timeoutWinner() {
    // most kills, tiebreak highest hp; unbreakable tie -> DRAW
    let best: Player | null = null, bestId = '', tied = false;
    this.state.players.forEach((p, pid) => {
      if (!best) { best = p; bestId = pid; tied = false; return; }
      if (p.kills > best.kills || (p.kills === best.kills && p.hp > best.hp)) {
        best = p; bestId = pid; tied = false;
      } else if (p.kills === best.kills && p.hp === best.hp) {
        tied = true;
      }
    });
    if (!best || tied) {
      this.state.phase = 'ended';
      this.state.winnerId = '';
      this.state.winnerName = 'DRAW';
      metrics.matchesCompleted++;
      log('info', 'match ended', { roomId: this.roomId, winner: 'DRAW' });
      this.syncMeta();
    } else {
      this.awardWin(bestId, (best as Player).name);
    }
  }

  private spawnBullet(c: Client, angle: number, w: { dmg: number; speed: number; life: number }) {
    const p = this.state.players.get(c.sessionId);
    if (!p || !p.alive) return;
    const b = new Bullet();
    b.id = `${Date.now()}_${bulletSeq++}`;
    b.ownerId = c.sessionId;
    b.x = p.x + Math.cos(angle) * MUZZLE;
    b.y = p.y + Math.sin(angle) * MUZZLE;
    b.vx = Math.cos(angle) * w.speed;
    b.vy = Math.sin(angle) * w.speed;
    b.life = w.life;
    b.dmg = w.dmg;
    this.state.bullets.set(b.id, b);
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
      if (!p.alive) {
        (p as any)._deadT = ((p as any)._deadT || 0) + dt;
        if ((p as any)._deadT > 3) {
          p.alive = true; p.hp = 100;
          p.shield = this.shieldSeconds; // spawn protection
          p.pammo = WEAPONS.pistol.clip;
          if (p.rifle) p.ammo = WEAPONS.rifle.clip;
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
          if (p.weapon === 'rifle') p.ammo = WEAPONS.rifle.clip;
          else p.pammo = WEAPONS.pistol.clip;
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
        const s = stepMove(p.x, p.y, v.x, v.y, inp.dx, inp.dy, dt, this.solids(), inRect(p.x, p.y, ICE));
        p.x = s.x; p.y = s.y;
        this.vel.set(id, { x: s.vx, y: s.vy });
        p.angle = inp.angle;
      }
    });
    // pickup respawn timers
    this.state.pickups.forEach((pk) => {
      if (pk.active) return;
      pk.t -= dt;
      if (pk.t <= 0) { pk.active = true; pk.t = 0; }
    });
    // bullets
    const dead: string[] = [];
    const feed: Array<{ killer: string; victim: string; w: string }> = [];
    const hits: Array<{ x: number; y: number; by: string; dmg: number; ox: number; oy: number; to: string }> = [];
    const chips: Array<{ x: number; y: number; kind: string }> = [];
    this.state.bullets.forEach((b) => {
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || b.x < 0 || b.x > W || b.y < 0 || b.y > H) { dead.push(b.id); return; }
      if (pointInWall(b.x, b.y, STEEL)) { // steel: spark + absorb
        dead.push(b.id);
        chips.push({ x: b.x, y: b.y, kind: 'steel' });
        return;
      }
      let hitBrick = false; // bricks: crumble + absorb
      BRICKS.forEach((rc, i) => {
        if (hitBrick) return;
        const br = this.state.bricks.get(`br_${i}`);
        if (!br || br.hp <= 0) return;
        if (b.x >= rc.x && b.x <= rc.x + rc.w && b.y >= rc.y && b.y <= rc.y + rc.h) {
          br.hp--;
          hitBrick = true;
        }
      });
      if (hitBrick) {
        dead.push(b.id);
        chips.push({ x: b.x, y: b.y, kind: 'brick' });
        return;
      }
      this.state.players.forEach((p, pid) => {
        if (pid === b.ownerId || !p.alive) return;
        const dx = p.x - b.x, dy = p.y - b.y;
        if (dx * dx + dy * dy < 22 * 22) {
          const before = Math.max(0, p.hp);
          // spawn shield absorbs everything while active (fairness rule)
          if (p.shield > 0) {
            dead.push(b.id);
            hits.push({ x: b.x, y: b.y, by: b.ownerId, dmg: 0, ox: 0, oy: 0, to: pid });
            return;
          }
          p.hp -= b.dmg;
          dead.push(b.id);
          const owner = this.state.players.get(b.ownerId);
          hits.push({
            x: b.x, y: b.y, by: b.ownerId, dmg: b.dmg,
            ox: owner ? owner.x : b.x, oy: owner ? owner.y : b.y, to: pid,
          });
          if (owner) owner.damage += Math.min(b.dmg, before);
          if (p.hp <= 0) {
            p.hp = 0; p.alive = false; (p as any)._deadT = 0;
            p.streak = 0; p.deaths++;
            const killer = this.state.players.get(b.ownerId);
            if (killer) {
              killer.kills++;
              killer.streak++;
              killer.cash += 120; // GTA payout per elimination
              feed.push({ killer: killer.name, victim: p.name, w: killer.weapon });
            }
          }
        }
      });
    });
    dead.forEach((id) => this.state.bullets.delete(id));
    feed.forEach((k) => this.broadcast('kill', k));
    hits.forEach((h) => this.broadcast('hit', h));
    chips.forEach((c) => this.broadcast('chip', c));
    // last-man-standing: sole survivor with any hp wins immediately
    if (this.state.players.size >= 2) {
      let alive = 0, lastName = '', lastId = '';
      this.state.players.forEach((p, pid) => {
        if (p.alive && p.hp > 0) { alive++; lastName = p.name; lastId = pid; }
      });
      if (alive === 1) {
        this.awardWin(lastId, lastName);
        return;
      } else if (alive === 0) {
        this.state.phase = 'ended';
        this.state.winnerId = '';
        this.state.winnerName = 'DRAW';
        metrics.matchesCompleted++;
        log('info', 'match ended', { roomId: this.roomId, winner: 'DRAW' });
        this.syncMeta();
        return;
      }
    }
    // match timer: expiry -> best score wins
    this.state.timeLeft -= dt;
    if (this.state.timeLeft <= 0) {
      this.state.timeLeft = 0;
      this.timeoutWinner();
    }
  }
}
