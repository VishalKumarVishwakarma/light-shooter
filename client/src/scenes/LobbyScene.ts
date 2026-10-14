import Phaser from 'phaser';
import { Session } from '../net/Session';
import { ensureTextures, SOLDIER_ART_DY } from '../textures';
import { makeButton, modal, toast, type Btn } from '../ui';
import { sfx } from '../audio';
import { BODY, COND, DIM, MONO, SUB, displayText, kicker } from '../fonts';
import { drawFrame, drawPanel, panelSweep } from '../panel';
import { ensureArena, preloadArena } from './loadArena';
import { STEEL, BRICKS, WATER, BUSH, SPAWNS } from '../map';

import { SERVER_HTTP } from '../net/serverUrl';

// Clipboard write that cannot throw. `navigator.clipboard?.writeText(x).catch()`
// only guards the PROPERTY access: where the API is absent the expression
// evaluates to undefined and the next link (.catch/.then) dereferences it. That
// is not a permission denial -- navigator.clipboard is simply undefined on every
// non-secure origin, i.e. http://192.168.x.x, which is exactly how a shared
// invite link is opened. Clicking the code pill threw a TypeError straight into
// main.ts's unhandled-rejection handler and painted the red "refresh the page"
// banner over a perfectly working lobby.
function copyText(text: string, ok?: () => void, fail?: () => void) {
  const cb = (navigator as any)?.clipboard;
  if (!cb || typeof cb.writeText !== 'function') { fail?.(); return; }
  try {
    const p = cb.writeText(text);
    if (p && typeof p.then === 'function') {
      p.then(() => ok?.(), () => fail?.()).catch(() => fail?.());
    } else ok?.();
  } catch { fail?.(); }
}

export function roomLink(code: string) {
  const base = `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
  // keep the page pointed at a non-local server when shared
  if (!/localhost|127\.0\.0\.1/.test(SERVER_HTTP)) {
    return `${base}&server=${encodeURIComponent(SERVER_HTTP)}`;
  }
  return base;
}

// The QR encoder is only needed when someone opens the share sheet, so it is
// pulled in on demand (warmed on lobby entry, so the click never waits).
let qrLib: any = null;
let qrPending: Promise<any> | null = null;
function loadQr() {
  if (qrLib) return Promise.resolve(qrLib);
  if (!qrPending) {
    qrPending = import('qrcode-generator')
      .then((m: any) => { qrLib = m.default || m; return qrLib; })
      .catch((e) => { qrPending = null; throw e; });
  }
  return qrPending;
}
export function preloadQr() { void loadQr().catch(() => { /* retried on demand */ }); }

function qrKey(scene: Phaser.Scene, text: string) {
  const key = 'qr_' + text;
  if (scene.textures.exists(key)) return key;
  // NOTE: never evict these (textures.remove + a live image = updateUVs crash).
  // Keys are tiny canvases, one per distinct link — bounded in practice.
  const qr = qrLib(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), s = 5, pad = 10;
  const cv = document.createElement('canvas');
  cv.width = cv.height = n * s + pad * 2;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#0b1220';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(pad + c * s, pad + r * s, s, s);
    }
  }
  scene.textures.addCanvas(key, cv);
  return key;
}

export class LobbyScene extends Phaser.Scene {
  private rowsBox!: Phaser.GameObjects.Container;
  private statusText!: Phaser.GameObjects.Text;
  private codeText!: Phaser.GameObjects.Text;
  private readyBtn!: Btn;
  private readyBg!: Phaser.GameObjects.Image;
  private readyLabel!: Phaser.GameObjects.Text;
  private startBtn!: Btn;
  private startBg!: Phaser.GameObjects.Image;
  private startLabel!: Phaser.GameObjects.Text;
  private gone = false;
  private prevReady = -1;
  private allReadyWas = false;
  private lobbyGen = 0;
  private hypePulse: Phaser.Tweens.Tween | null = null;

  constructor() { super('lobby'); }

  create() {
    // warm the two deferred chunks while the player reads the code: the arena
    // (needed the instant a match starts) and the invite QR
    preloadQr();
    void preloadArena(this.game);
    ensureTextures(this);
    this.cameras.main.fadeIn(250, 0, 0, 0);
    this.gone = false;
    this.prevReady = -1;
    this.allReadyWas = false;
    this.hypePulse?.stop();
    this.hypePulse = null;
    if (!Session.room) { this.scene.start('menu'); return; }

    this.add.image(480, 300, 'menubg').setDisplaySize(960, 600);
    this.add.tileSprite(480, 300, 960, 600, 'noise').setAlpha(0.3);
    const mission = this.add.text(480, 100, 'MISSION: LAST SQUAD STANDING  ·  FIRST TO 3 WINS', {
      fontFamily: COND, fontSize: '14px', fontStyle: '700', color: '#f59e0b',
    }).setOrigin(0.5);
    mission.setStroke('#020617', 3);
    mission.setShadow(0, 0, '#f59e0b', 8, false, true);

    displayText(this, 480, 32, 'LOBBY', 30);
    kicker(this, 480, 10, 'S Q U A D   M U S T E R');

    // code pill (click to copy). The 'pill' texture was a 20px-radius rounded
    // canvas, which fought the chamfered language everywhere else; the panel
    // primitive replaces it and keeps the same 440x44 footprint.
    const pillG = this.add.graphics();
    drawPanel(pillG, {
      x: 260, y: 52, w: 440, h: 44, cut: 14, shadow: true, rim: 0.4, inner: 6,
    });
    drawFrame(pillG, { x: 260, y: 52, w: 440, h: 44, cut: 14, arm: 14, alpha: 0.6 });
    this.codeText = this.add.text(480, 74, '', {
      fontFamily: MONO, fontSize: '16px', fontStyle: '700', color: '#22d3ee',
    }).setOrigin(0.5);
    this.codeText.setStroke('#020617', 3);
    this.codeText.setShadow(0, 0, '#22d3ee', 8, false, true);
    this.refreshCode(false);
    const pillHit = this.add.rectangle(480, 74, 440, 44, 0x000000, 0);
    pillHit.setInteractive({ useHandCursor: true });
    pillHit.on('pointerdown', () => {
      copyText(Session.code);
      this.refreshCode(true);
    });
    const invite = this.add.text(706, 74, '＋ INVITE', {
      fontFamily: COND, fontSize: '15px', fontStyle: '700', color: '#22d3ee',
    }).setOrigin(0, 0.5);
    invite.setStroke('#020617', 3);
    invite.setShadow(0, 0, '#22d3ee', 8, false, true);
    invite.setInteractive({ useHandCursor: true });
    invite.on('pointerdown', () => { sfx.click(); this.openInvite(); });

    // player panel: chamfered gradient glass, TAC brackets, and one slow sweep.
    // The footprint is unchanged (230,108 500x288) so every row inside it still
    // lands exactly where it did before.
    const panel = this.add.graphics();
    drawPanel(panel, {
      x: 230, y: 108, w: 500, h: 288, cut: 20, alpha: 0.93, shadow: true, rim: 0.4,
    });
    drawFrame(panel, { x: 230, y: 108, w: 500, h: 288, cut: 20, arm: 22, alpha: 0.72 });
    panelSweep(this, null, {
      x: 480, y: 252, w: 500, h: 288, cut: 20, period: 6000, alpha: 0.085, depth: 1,
    });
    this.rowsBox = this.add.container(0, 0).setDepth(2);
    // arena recon preview (scaled terrain + spawns)
    this.drawMapPreview(842, 250);

    const ready = makeButton(this, {
      tex: 'btn220', x: 350, y: 470, tint: 0x16a34a, label: 'READY', fontSize: 15,
      onClick: () => Session.room?.send('toggleReady'),
    });
    this.readyBtn = ready;
    this.readyBg = ready.bg;
    this.readyLabel = ready.label;

    const start = makeButton(this, {
      tex: 'btn220', x: 610, y: 470, tint: 0x2563eb, label: 'START', fontSize: 15,
      onClick: () => Session.room?.send('startGame'),
    });
    this.startBtn = start;
    this.startBg = start.bg;
    this.startLabel = start.label;

    this.statusText = this.add.text(480, 524, '', {
      fontFamily: COND, fontSize: '17px', fontStyle: '700', color: '#facc15',
    }).setOrigin(0.5);
    this.statusText.setStroke('#020617', 3);
    this.statusText.setShadow(0, 0, '#facc15', 8, false, true);
    const leave = this.add.text(480, 562, 'leave lobby', {
      fontFamily: COND, fontSize: '14px', fontStyle: '700', color: DIM,
    }).setOrigin(0.5);
    leave.setStroke('#020617', 3);
    leave.setInteractive({ useHandCursor: true });
    leave.on('pointerover', () => leave.setColor(SUB));
    leave.on('pointerout', () => leave.setColor(DIM));
    leave.on('pointerdown', async () => {
      this.gone = true;
      await Session.leave();
      if (this.sys.isActive()) this.scene.start('menu');
    });
    this.wire();
  }

  private refreshCode(copied: boolean) {
    this.codeText.setText(copied ? `CODE  ${Session.code}   ✓ COPIED` : `CODE  ${Session.code}   ⧉ CLICK TO COPY`);
  }

  private drawMapPreview(cx: number, cy: number) {
    const s = 100 / 1600, w = 100, h = 1200 * s;
    const key = 'lobbyMapPrev';
    // Bake once. A Graphics of every steel/brick/water/bush rect is retained-mode
    // and was re-tessellated every lobby frame.
    if (!this.textures.exists(key)) {
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w));
      cv.height = Math.max(1, Math.round(h));
      const ctx = cv.getContext('2d');
      if (ctx) {
        const box = (hex: string, a: number, rc: { x: number; y: number; w: number; h: number }) => {
          ctx.globalAlpha = a;
          ctx.fillStyle = hex;
          ctx.fillRect(rc.x * s, rc.y * s, Math.max(1, rc.w * s), Math.max(1, rc.h * s));
        };
        ctx.globalAlpha = 0.85; ctx.fillStyle = '#020617'; ctx.fillRect(0, 0, w, h);
        for (const rc of WATER) box('#7dd3fc', 0.6, rc);
        for (const rc of STEEL) box('#cbd5e1', 0.9, rc);
        for (const rc of BRICKS) box('#c65a1e', 0.9, rc);
        for (const rc of BUSH) box('#22c55e', 0.5, rc);
        ctx.globalAlpha = 1; ctx.fillStyle = '#4ade80';
        for (const [x, y] of SPAWNS) {
          ctx.beginPath(); ctx.arc(x * s, y * s, 1.8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 0.5; ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      }
      this.textures.addCanvas(key, cv);
    }
    this.add.image(cx, cy, key).setDepth(2);
    // A map is legitimately a rectangle -- what was missing was the sense that
    // it is a screen inset into the panel, so it gets a cast plate behind it and
    // the same corner brackets as every other surface.
    this.add.graphics().setDepth(1)
      .fillStyle(0x000000, 0.42)
      .fillRect(cx - w / 2 - 4, cy - h / 2 - 2, w + 8, h + 8);
    const fr = this.add.graphics().setDepth(2);
    drawFrame(fr, { x: cx - w / 2, y: cy - h / 2, w, h, cut: 8, arm: 12, alpha: 0.6, stops: false });
    const cap = this.add.text(cx, cy + h / 2 + 12, 'BATTLE CITY ARENA', {
      fontFamily: COND, fontSize: '13px', fontStyle: '700', color: SUB,
    }).setOrigin(0.5, 0);
    cap.setStroke('#020617', 3);
  }

  private openInvite() {
    const code = Session.code;
    const link = roomLink(code);
    const m = modal(this, 'INVITE PLAYERS', 500, 420);
    // the QR encoder arrives as its own chunk; the modal's 240ms open animation
    // covers the fetch, so the code is in place before anyone can look at it
    const qrSlot = this.add.image(0, -80, 'btn220').setVisible(false);
    m.body.add(qrSlot);
    void loadQr().then(() => {
      if (!this.scene.isActive() || !m.root.active) return;
      qrSlot.setTexture(qrKey(this, link)).setDisplaySize(150, 150).setVisible(true);
    }).catch(() => { /* link + code still work without the picture */ });
    const linkT = this.add.text(0, 20, link, {
      fontFamily: MONO, fontSize: '12px', fontStyle: '700', color: '#7dd3fc', align: 'center', wordWrap: { width: 440 },
    }).setOrigin(0.5, 0);
    linkT.setStroke('#020617', 3);
    m.body.add(linkT);
    const copy = this.add.text(-90, 130, '⧉ COPY LINK', {
      fontFamily: COND, fontSize: '17px', fontStyle: '700', color: '#22d3ee',
    }).setOrigin(0.5);
    copy.setStroke('#020617', 3);
    copy.setShadow(0, 0, '#22d3ee', 8, false, true);
    copy.setInteractive({ useHandCursor: true });
    copy.on('pointerdown', () => {
      copyText(link, () => toast(this, 'link copied — send it to your squad'),
        () => toast(this, 'copy blocked — long-press the link', '#f87171'));
    });
    m.body.add(copy);
    const share = this.add.text(90, 130, '⤴ SHARE', {
      fontFamily: COND, fontSize: '17px', fontStyle: '700', color: '#22d3ee',
    }).setOrigin(0.5);
    share.setStroke('#020617', 3);
    share.setShadow(0, 0, '#22d3ee', 8, false, true);
    share.setInteractive({ useHandCursor: true });
    share.on('pointerdown', () => {
      const nav = navigator as any;
      if (nav.share) {
        nav.share({ title: 'Join my shooter lobby', text: `Code ${code}`, url: link }).catch(() => {});
      } else {
        copyText(link);
        toast(this, 'link copied — no share sheet on this device');
      }
    });
    m.body.add(share);
  }

  private wire() {
    const room: any = Session.room;
    const gen = ++this.lobbyGen;
    const live = () => gen === this.lobbyGen && Session.room === room;
    // roster memory survives rematch cycles: no re-toast for players already seen
    const known: Map<string, string> = room._lobbyKnown || (room._lobbyKnown = new Map());
    const draw = () => {
      if (!live() || !Session.room) return;
      // join toasts + blip for newcomers (skip the initial roster fill)
      const fresh = new Set<string>();
      room.state.players.forEach((p: any, id: string) => {
        if (!known.has(id)) {
          fresh.add(id);
          if (known.size > 0 && id !== room.sessionId) {
            toast(this, `${p.name} joined the lobby`, '#4ade80');
            sfx.ready();
          }
        }
        known.set(id, p.name);
      });
      // kill the roster's looping tweens before dropping the objects. Phaser
      // never removes a tween because its target was destroyed, and draw() is
      // driven by state.onChange -- which fires on every countdown tick (30Hz),
      // so each rebuild minted a fresh `repeat: -1` per ready player that then
      // ran forever on a dead dot.
      this.rowsBox.getAll().forEach((o: any) => this.tweens.killTweensOf(o));
      this.rowsBox.removeAll(true);
      const ps = room.state.players;
      const hostId = room.state.hostId;
      const meId = room.sessionId;
      // squad header: headcount + ready progress bar (host reads this at a glance)
      let i = 0, ready = 0;
      ps.forEach((p: any) => { if (p.ready) ready++; i++; });
      const n = i;
      const head = this.add.text(250, 126, `SQUAD  ${n}/8`, {
        fontFamily: COND, fontSize: '16px', fontStyle: '700', color: SUB,
      }).setOrigin(0, 0.5);
      head.setStroke('#020617', 3);
      const pct = n ? ready / n : 0;
      const barBg = this.add.rectangle(480, 144, 460, 8, 0x1e293b).setOrigin(0.5);
      const barFill = this.add.rectangle(250, 144, Math.max(2, 460 * pct), 8,
        pct === 1 && n >= 2 ? 0x4ade80 : 0xca8a04).setOrigin(0, 0.5);
      const rdy = this.add.text(710, 126, n >= 2 && ready === n ? 'ALL READY ✓' : `READY  ${ready}/${n}`, {
        fontFamily: COND, fontSize: '16px', fontStyle: '700',
        color: n >= 2 && ready === n ? '#4ade80' : '#facc15',
      }).setOrigin(1, 0.5);
      rdy.setStroke('#020617', 3);
      this.rowsBox.add([head, barBg, barFill, rdy]);
      // ready-up chime for the host when the count climbs
      if (this.prevReady !== -1 && ready > this.prevReady) sfx.ready();
      this.prevReady = ready;
      i = 0;
      ps.forEach((p: any, id: string) => {
        const y = 168 + i * 28;
        const isReady = !!p.ready;
        // state strip: ready = green glass + green spine, waiting = dark + red
        // spine. The same colours as before, now on a chamfered panel so a full
        // 8-player roster still reads as one system instead of eight rects.
        const strip = this.add.graphics();
        drawPanel(strip, {
          x: 250, y: y - 13, w: 462, h: 26, cut: 7,
          accent: isReady ? 0x4ade80 : 0xef4444,
          fill: isReady ? 0x0d2c1a : 0x070c17,
          fillBot: isReady ? 0x061a0f : 0x03060d,
          alpha: 0.97, scan: false, rim: isReady ? 0.7 : 0.34, inner: 4,
        });
        const spine = this.add.rectangle(250, y, 5, 26,
          isReady ? 0x4ade80 : 0xef4444).setOrigin(0, 0.5);
        let spineGlow: Phaser.GameObjects.Image | null = null;
        if (isReady) {
          spineGlow = this.add.image(252, y, 'halo').setTint(0x4ade80)
            .setBlendMode(Phaser.BlendModes.ADD).setScale(0.5, 0.35).setAlpha(0.7);
        }
        // SOLDIER_ART_DY: the figure is drawn 4px high inside its 56px texture, so
        // nudge the image down by that at 0.5 scale to put the CHARACTER's centre
        // on the row's y, level with the player name beside it.
        const icon = this.add.image(268, y - SOLDIER_ART_DY * 0.5,
          id === meId ? 'soldier_me' : 'soldier_foe').setScale(0.5);
        if (!isReady) icon.setAlpha(0.55); // waiting players visibly dimmed
        const crown = id === hostId ? '👑 ' : '';
        const meTag = id === meId ? '   ← YOU' : '';
        const row = this.add.text(292, y, `${crown}${p.name}${meTag}`, {
          fontFamily: BODY, fontSize: '17px', fontStyle: '700',
          color: isReady ? '#ffffff' : DIM,
        }).setOrigin(0, 0.5);
        row.setStroke('#020617', 4);
        if (isReady) row.setShadow(0, 0, '#4ade80', 8, false, true);
        // status light: ready = filled pulsing green, waiting = hollow red ring
        const dot = isReady
          ? this.add.circle(596, y, 6, 0x4ade80).setStrokeStyle(2, 0xbbf7d0, 1)
          : this.add.circle(596, y, 6).setStrokeStyle(2.5, 0xef4444, 1).setFillStyle(0xef4444, 0.15);
        if (isReady) {
          this.tweens.add({ targets: dot, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });
        }
        // badge: ready = bright green pill w/ dark text, waiting = dark pill w/ red text
        const badge = this.add.rectangle(652, y, 106, 24, isReady ? 0x4ade80 : 0x1e293b);
        badge.setStrokeStyle(1.5, isReady ? 0xbbf7d0 : 0xef4444, isReady ? 1 : 0.8);
        const badgeTx = this.add.text(652, y, isReady ? '✓ READY' : '✕ NOT READY', {
          fontFamily: COND, fontSize: '14px', fontStyle: '700',
          color: isReady ? '#052e16' : '#f87171',
        }).setOrigin(0.5);
        badgeTx.setStroke(isReady ? '#bbf7d0' : '#020617', isReady ? 1 : 3);
        // subtle slide-in for newcomers only (not on every redraw)
        if (fresh.has(id)) {
          row.setX(284).setAlpha(0);
          this.tweens.add({ targets: row, x: 292, alpha: 1, duration: 180 });
        }
        this.rowsBox.add([strip, spine, icon, row, dot, badge, badgeTx]);
        if (spineGlow) this.rowsBox.add(spineGlow);
        i++;
      });
      if (!n) {
        const waiting = this.add.text(480, 250, 'waiting for players…', {
          fontFamily: BODY, fontSize: '16px', fontStyle: '600', color: DIM,
        }).setOrigin(0.5);
        waiting.setStroke('#020617', 3);
        this.rowsBox.add(waiting);
      }
      const myReady = !!ps.get(meId)?.ready;
      this.readyLabel.setText(myReady ? 'UNREADY' : 'READY');
      this.readyBg.setTint(myReady ? 0xca8a04 : 0x16a34a);
      const host = Session.isHost;
      const hype = host && n >= 2 && ready === n; // everyone ready: START demands attention
      const squadReady = n >= 2 && ready === n;
      if (squadReady && !this.allReadyWas) {
        sfx.count(true); // klaxon: squad complete
        toast(this, n === 2 ? 'BOTH READY — START THE MATCH' : 'ALL READY — START THE MATCH', '#4ade80');
      }
      this.allReadyWas = squadReady;
      this.startLabel.setText(!host ? 'HOST ONLY' : hype ? 'START ▶' : n >= 2 ? `START  ${n}/8` : `NEED 2+  (${n}/8)`);
      const canStart = host && n >= 2;
      this.startBg.setTint(hype ? 0x16a34a : canStart ? 0x2563eb : 0x475569);
      this.startBg.setAlpha(canStart ? 1 : 0.55);
      if (hype && !this.hypePulse) {
        this.hypePulse = this.tweens.add({
          targets: this.startBtn.c, scaleX: 1.07, scaleY: 1.07,
          duration: 450, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
      } else if (!hype && this.hypePulse) {
        this.hypePulse.stop();
        this.hypePulse = null;
        this.startBtn.c.setScale(1);
      }
      this.statusText.setText(
        room.state.phase === 'countdown'
          ? `starting in ${Math.ceil(room.state.countdown)}…`
          : !host ? 'waiting for the host to start…'
            : n < 2 ? 'share the code — need 2+ players'
              : `ready ${ready}/${n} — press START when ready`,
      );
    };
    // roster redraws on join, leave, AND any player field change (ready toggles
    // only flip a nested field — without per-player onChange the badges never update)
    room.state.players.onAdd((p: any) => { p.onChange(draw); draw(); });
    room.state.players.onRemove((_p: any, id: string) => {
      const name = known.get(id);
      known.delete(id);
      if (name) toast(this, `${name} left the lobby`, '#94a3b8');
      draw();
    });
    room.state.onChange(draw);
    // The match going live must NOT be detected by polling update(). Phaser
    // pauses its loop in a hidden tab, so with 8 tabs on one machine the other 7
    // would never run update(), never see phase === 'playing', and never enter
    // the arena -- only the visible (host) tab would. A Colyseus patch arrives
    // over the WebSocket regardless of the render loop, so watch it here instead.
    room.state.onChange(() => {
      if (room.state.phase === 'playing') this.enterArena();
    });
    room.onLeave(() => {
      Session.room = null;
      if (!this.gone) { this.gone = true; this.scene.start('menu'); }
    });
    draw();
  }

  private lastCdSec = -1;

  // Single entry point into the arena, called from the state listener (the path
  // that works in a background tab) and from update() as a backstop for a patch
  // that landed before the listener was attached. `gone` makes it idempotent, so
  // both routes firing cannot start the scene twice.
  private enterArena() {
    if (this.gone) return;
    this.gone = true;
    // the arena ships as its own chunk; make sure it is registered before the
    // switch (preloaded during the countdown, so this resolves immediately).
    // Re-check liveness after the await: `gone` was only tested BEFORE it, so
    // leaving the lobby while the chunk was still in flight dragged the player
    // out of the menu into the arena unasked, and dropped the "could not load"
    // toast on a dead scene.
    void ensureArena(this.game).then((ok) => {
      if (!this.scene.isActive()) return; // left the lobby while loading
      if (ok) this.scene.start('arena');
      else toast(this, 'could not load the arena - refresh', '#ef4444', 348);
    });
  }

  update() {
    const phase = (Session.room as any)?.state?.phase;
    if (!Session.room) return;
    if (phase === 'playing') {
      // backstop only -- the state listener above normally gets there first,
      // and it is the only route that fires in a hidden tab.
      this.enterArena();
    } else if (phase === 'countdown') {
      const s = Math.ceil((Session.room as any).state.countdown);
      if (s !== this.lastCdSec) {
        this.lastCdSec = s;
        this.statusText.setText(`starting in ${s}…`);
      }
    } else {
      this.lastCdSec = -1;
    }
  }
}

