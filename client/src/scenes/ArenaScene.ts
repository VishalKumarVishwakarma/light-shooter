import Phaser from 'phaser';
import { Session } from '../net/Session';
import { W, H, SPEED, STEEL, BRICKS, BRICK_HP, WATER, ICE, BUSH, MUZZLE, WEAPONS, inRect, pointInWall, stepMove } from '../map';
import { ensureTextures, avatarTex, foeColor } from '../textures';
import { makeButton, quality, setQuality, toast, type Btn } from '../ui';
import { sfx } from '../audio';
import { BODY, COND, DIM, MONO, SUB, TXT, displayText, kicker } from '../fonts';

const RADIUS = 16;
// how many in-flight electric bolts get a drawn tether at once. The gun fires
// every 0.14s and a bolt lives 0.8s, so one shooter can have ~6 up; beyond the
// cap the newest tips still show (they are sprites) and the frame stays bounded.
const ARC_TETHER_MAX = 8;
// Rifle sprite geometry. The image is pinned to the CHARACTER CENTRE and its
// texture pivot is derived from MUZZLE, so the barrel tip lands exactly MUZZLE
// from the centre at EVERY aim angle.
//
// It used to sit at (8, 0) with a hand-picked origin, so it rotated about a
// point 8px to the right of the character: the tip swung on a circle of radius
// 37.6 centred at (8,0) while the tracer, flash, beam and arc all spawned on a
// circle of radius MUZZLE=46 centred on the character. Those agreed only at
// aim-right (0.4px) and diverged by up to 16.4px at aim-left -- over half the
// player's width -- so shots visibly left from thin air, not the barrel.
const GUN_TEX_W = 52;   // the 'gun' canvas width
const GUN_SCALE = 0.85;
const GUN_ORIGIN_X = 1 - MUZZLE / (GUN_TEX_W * GUN_SCALE);
const GUN_REST_X = 0;   // where the recoil tween returns the barrel to
// Mouse-wheel selector. One physical notch is ~100px of wheel deltaY (Chrome
// reports 100, Firefox 3 lines x 33, pages x 400), so dividing by that turns
// both a wheel and a trackpad into a count of NOTCHES instead of a count of
// events -- a wheel sends one event per notch, a trackpad dozens per second.
const WHEEL_NOTCH = 100;
const WHEEL_EVENT_MAX = 3;    // one event (a momentum fling) is never worth >3
const WHEEL_GESTURE_MAX = 10; // ...nor is a whole gesture worth more than 10
const WHEEL_GESTURE_MS = 320; // gap that starts a new gesture
const WHEEL_SETTLE_MS = 150; // quiet period before a gesture is committed
type PObj = {
  gfx: Phaser.GameObjects.Container; body: Phaser.GameObjects.Image;
  gun: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text;
  ring: Phaser.GameObjects.Image; ringB: Phaser.GameObjects.Image;
  gring: Phaser.GameObjects.Container; // frontal shield holder (rotates to aim)
  legs: Phaser.GameObjects.Container;
  bootL: Phaser.GameObjects.Image; bootR: Phaser.GameObjects.Image;
  stepPhase: number;
  tx: number; ty: number; hp: number; alive: boolean;
  shield: number; shieldPts: number; speedT: number; slowT: number;
  zap?: Phaser.GameObjects.Image; zap2?: Phaser.GameObjects.Image; // electric-lock shell
  sx: number; sy: number; // last authoritative position (reconciliation anchor)
  hist: Array<{ t: number; x: number; y: number }>; // remote snapshot buffer (interp)
  col: number; // squad color (minimap blip + label glow)
  smoked: boolean; // inside smoke: dimmed + unlabeled on foe screens
  pool?: Phaser.GameObjects.Image;
};

function angLerp(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
type BObj = {
  img: Phaser.GameObjects.Image;
  vx: number; vy: number;
  arc?: string; // set on electric shots: owner id, so the bolt can be drawn
                // from their muzzle instead of as a travelling round
};

// The loadout is one uniform list: guns, throwables and the shield are all
// switchable slots. `kind` decides what selecting/using the slot means.
type Slot = { key: string; nm: string; id: string; kind: 'gun' | 'ord' | 'shield' };
const SLOTS: Slot[] = [
  { key: '1', nm: 'PIS', id: 'pistol', kind: 'gun' },
  { key: '2', nm: 'RIF', id: 'rifle', kind: 'gun' },
  { key: '3', nm: 'SG', id: 'shotgun', kind: 'gun' },
  { key: '4', nm: 'SNP', id: 'sniper', kind: 'gun' },
  { key: '5', nm: 'LSR', id: 'laser', kind: 'gun' },
  { key: '6', nm: 'ELC', id: 'electric', kind: 'gun' },
  { key: '7', nm: '\u{1F4A3}', id: 'grenade', kind: 'ord' },
  { key: '8', nm: '\u{1F4A8}', id: 'smoke', kind: 'ord' },
  { key: '9', nm: '\u{1F525}', id: 'molly', kind: 'ord' },
  { key: '0', nm: 'SHD', id: 'shield', kind: 'shield' },
];
const isGunSlot = (id: string) => SLOTS.some((s) => s.id === id && s.kind === 'gun');
const ORD_ICON: Record<string, string> = { grenade: '\u{1F4A3}', smoke: '\u{1F4A8}', molly: '\u{1F525}' };

export class ArenaScene extends Phaser.Scene {
  meId = '';
  players = new Map<string, PObj>();
  bullets = new Map<string, BObj>();
  throws = new Map<string, { img: Phaser.GameObjects.Image; vx: number; vy: number }>();
  clouds = new Map<string, { c: Phaser.GameObjects.Container; parts: Phaser.GameObjects.GameObject[]; timers: Phaser.Time.TimerEvent[] }>();
  activeSlot = 'pistol'; // the switchable item in hand (gun, ord, or shield)
  private fireWas = false; // rising edge of the trigger, for one-shot items
  // The game's event emitter outlives the scene, so a BLUR handler added per
  // create() would pile up one dead listener per arena visit. Held on the
  // instance and removed on shutdown.
  private blurHandler: (() => void) | null = null;
  private pendingSlot = ''; // gun asked for, not yet acknowledged by the server
  private pendingAt = 0;
  private pendingFire = false; // fire the moment that switch is confirmed
  // wheel gesture coalescing: raw events accumulate, one commit per gesture
  private wheelAcc = 0;
  private wheelAt = 0;
  private wheelCycle: Slot[] = [];
  private wheelKey = '';
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private scoreText!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;
  private compassText!: Phaser.GameObjects.Text;
  private cashText!: Phaser.GameObjects.Text;
  private wantedText!: Phaser.GameObjects.Text;
  private prevStreak = 0;
  private feedRows: Array<{
    bg: Phaser.GameObjects.Rectangle; k: Phaser.GameObjects.Text;
    m: Phaser.GameObjects.Text; v: Phaser.GameObjects.Text;
  }> = [];
  private roundText!: Phaser.GameObjects.Text;
  private fpsText?: Phaser.GameObjects.Text;
  private fpsAcc = 0;
  private fpsN = 0;
  private arenaBorn = 0;
  private fightAt = 0; // when the current match went live (diagnostics ordering)
  private lastAim = 0;
  private hpFrame!: Phaser.GameObjects.Rectangle;
  private hpFill!: Phaser.GameObjects.Rectangle;
  private hpGhost!: Phaser.GameObjects.Rectangle;
  private hpLabel!: Phaser.GameObjects.Text;
  private dmgVin!: Phaser.GameObjects.Image;
  private dispHp = 100;
  private ghostHp = 100;
  private lowPulse: Phaser.Tweens.Tween | null = null;
  private minimap!: Phaser.GameObjects.Graphics;
  private feedExpiry = 0;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private blood!: Phaser.GameObjects.Particles.ParticleEmitter;
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  // pooled damage numbers: every impact mints canvas-backed Text, and browsers
  // cap live 2D contexts — pooling bounds them no matter how long the fight runs
  private dmgPool: Phaser.GameObjects.Text[] = [];
  private dmgMade = 0;
  private backToLobby = false;
  private endShown = false;
  private subGen = 0; // subscription generation: stale room callbacks exit early
  // Disposers for every Colyseus subscription made in connect(). The schema's
  // $callbacks arrays hang off the STATE object, which outlives this scene, and
  // onAdd defaults to triggerAll=true -- so without this each arena visit added
  // another handler per entity, and every later patch walked a list that was
  // mostly dead code. live() kept the stale handlers from drawing anything, so
  // it read as a mild slow-down rather than a bug. Flushed on shutdown.
  private colyOff: Array<() => void> = [];
  private keep(d: unknown) {
    if (typeof d === 'function') this.colyOff.push(d as () => void);
  }
  private kbWired = false;
  private myMove = { dx: 0, dy: 0 };
  private firing = false;
  private lastFire = 0;
  private camLocked = false; // camera follow issued once per arena entry
  private tacVin: Phaser.GameObjects.Image | null = null;
  private tacScan: Phaser.GameObjects.TileSprite | null = null;
  private autoQTrip = false; // auto low-graphics engaged this match
  private autoQLow = 0; // consecutive sub-35fps seconds
  private shotSfxAt = new Map<string, number>(); // per-shooter throttle: one boom per volley
  private touchMode = false; // twin-stick controls engage on first touch
  private moveStick: { id: number; ox: number; oy: number } | null = null;
  private aimStick: { id: number; ox: number; oy: number; kx: number; ky: number; ang: number } | null = null;
  private joyMove = { dx: 0, dy: 0 };
  private stickG: Phaser.GameObjects.Graphics | null = null;
  private crossG: Phaser.GameObjects.Graphics | null = null;
  private txtCache = new Map<string, string>();

  // setText re-uploads the canvas texture even for identical strings — at
  // 30Hz state churn that's pure stall. Cache and skip no-ops.
  private setT(key: string, o: Phaser.GameObjects.Text, str: string, color?: string) {
    if (this.txtCache.get(key) !== str) { this.txtCache.set(key, str); o.setText(str); }
    if (color !== undefined) {
      const ck = key + '#c';
      if (this.txtCache.get(ck) !== color) { this.txtCache.set(ck, color); o.setColor(color); }
    }
  }
  private myVel = { x: 0, y: 0 };
  private brickHp = new Map<string, number>();
  private brickViews = new Map<string, { c: Phaser.GameObjects.Container; cracks: Phaser.GameObjects.Graphics }>();
  private rubble = new Map<string, Phaser.GameObjects.Image>();
  private waterTiles: Phaser.GameObjects.TileSprite[] = [];
  private lastCd = -1;
  private cdBanner: Phaser.GameObjects.Container | null = null;
  private pickups = new Map<string, Phaser.GameObjects.Container>();
  private pkDots = new Map<string, { x: number; y: number; kind: string; active: boolean }>();
  private pingText!: Phaser.GameObjects.Text;
  private pingTimer?: Phaser.Time.TimerEvent;
  private ammoTitle!: Phaser.GameObjects.Text;
  private ammoCount!: Phaser.GameObjects.Text;

  private reloadBar!: Phaser.GameObjects.Rectangle;
  private reloadBg!: Phaser.GameObjects.Rectangle;
  private ammoIcon!: Phaser.GameObjects.Image;
  private clockCardG!: Phaser.GameObjects.Graphics;
  private liveDot!: Phaser.GameObjects.Arc;
  private clockStars = -1; // last rendered streak-star count
  // the tween targets for the HP bar. They live on the instance so drawHp can
  // kill the previous pair before minting a new one.
  private hpProxy = { v: 100 };
  private hpGhostProxy = { v: 100 };
  private reloadTx!: Phaser.GameObjects.Text;
  private loadSlots: Array<{ bg: Phaser.GameObjects.Rectangle; tx: Phaser.GameObjects.Text }> = [];
  private statusSegs: Array<{
    bg: Phaser.GameObjects.Rectangle; fill: Phaser.GameObjects.Rectangle; tx: Phaser.GameObjects.Text;
  }> = [];
  private zkVin!: Phaser.GameObjects.Image;
  private arcG: Phaser.GameObjects.Graphics | null = null; // my live electric arc
  private boltG: Phaser.GameObjects.Graphics | null = null; // every in-flight bolt tether
  private foeArcs = new Map<string, { g: Phaser.GameObjects.Graphics; t: number }>();
  private prevSlow = 0; // last known electric lock on me (rising edge = cue)
  private grabBtn: Btn | null = null;

  constructor() { super('arena'); }

  create() {
    ensureTextures(this);
    this.cameras.main.fadeIn(250, 0, 0, 0);
    this.events.once('shutdown', () => {
      try { this.input.setDefaultCursor('default'); } catch { /* dying */ }
      // the sustained discharge bed must stop HERE, on the real teardown event.
      // It used to live in a `shutdown()` METHOD, which Phaser never calls
      // (Systems.shutdown() only emits the event), so leaving mid-burst -- by
      // clicking leave, or when the whistle ends the match -- left the saw +
      // noise bed droning over the whole lobby and menu, unsilenceable except
      // through Settings.
      sfx.arcOff();
      // The KeyboardPlugin is cached per InputPlugin instance and survives the
      // scene, but its shutdown() calls removeAllListeners() -- which wipes every
      // keydown-* handler. The instance is then reused by the next create(), so
      // the kbWired guard below would skip re-registering them and EVERY
      // shortcut (R, E, 1-0, G/X/C, Q, TAB, F) would be dead after one rematch.
      // WASD kept working because addKeys is unconditional, which is exactly
      // why this survived a casual playtest. Clear the guard on the way out.
      this.kbWired = false;
      // detach every Colyseus subscription made in connect(), so a rematch
      // starts from a clean callback list instead of stacking another handler
      // per entity on the room state
      for (const d of this.colyOff) { try { d(); } catch { /* state already gone */ } }
      this.colyOff = [];
      if (this.blurHandler) {
        this.game.events.off(Phaser.Core.Events.BLUR, this.blurHandler);
        this.blurHandler = null;
      }
      this.firing = false;
    });
    this.cameras.main.setBounds(0, 0, W, H);
    // ground: grid + film-grain noise + vignette
    this.add.grid(0, 0, W, H, 40, 40, 0x111826).setOrigin(0);
    const lowQ = quality() === 'low';
    this.add.tileSprite(W / 2, H / 2, W, H, 'noise').setAlpha(lowQ ? 0.15 : 0.5);
    // HD ground detail: deterministic scuffs/cracks (seeded = identical everywhere)
    if (!lowQ) {
      let seed = 1337;
      const rnd = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < 34; i++) {
        this.add.image(rnd() * W, rnd() * H, 'dot')
          .setTint(0x000000).setAlpha(0.28).setScale(0.8 + rnd() * 1.8)
          .setRotation(rnd() * Math.PI).setDepth(0);
      }
    }
    this.add.rectangle(0, 0, W, 8, 0x22d3ee).setOrigin(0);
    this.add.rectangle(0, H - 8, W, 8, 0x22d3ee).setOrigin(0);
    // Battle City terrain: steel blocks, brick cover, rivers, ice, stealth bushes
    for (const st of STEEL) {
      this.add.rectangle(st.x + 4, st.y + 6, st.w, st.h, 0x000000, 0.35).setOrigin(0);
      this.add.tileSprite(st.x + st.w / 2, st.y + st.h / 2, st.w, st.h, 'steelTile');
      this.add.rectangle(st.x, st.y + 3, st.w, 6, 0xffffff, 0.22).setOrigin(0, 0.5); // sunlit top edge
    }
    for (const ic of ICE) {
      this.add.tileSprite(ic.x + ic.w / 2, ic.y + ic.h / 2, ic.w, ic.h, 'iceTile').setAlpha(0.95);
    }
    for (const wt of WATER) {
      this.waterTiles.push(this.add.tileSprite(wt.x + wt.w / 2, wt.y + wt.h / 2, wt.w, wt.h, 'waterTile'));
    }
    // stealth forest: drawn OVER soldiers (depth 7), no collision
    for (const bu of BUSH) {
      this.add.tileSprite(bu.x + bu.w / 2, bu.y + bu.h / 2, bu.w, bu.h, 'bushTile')
        .setDepth(7).setAlpha(0.94);
    }
    this.brickHp.clear();
    this.brickViews.forEach((v) => v.c.destroy(true));
    this.brickViews.clear();
    this.rubble.forEach((r) => r.destroy());
    this.rubble.clear();
    this.myVel = { x: 0, y: 0 };
    this.camLocked = false;
    this.txtCache.clear(); // stale strings would skip first paint on fresh objects
    this.activeSlot = 'pistol';
    this.fireWas = false;
    this.wheelAcc = 0;
    this.wheelAt = 0;
    this.wheelKey = '';
    this.prevSlow = 0; // scene restart must not re-fire the lock cue
    this.moveStick = null; this.aimStick = null;
    this.joyMove = { dx: 0, dy: 0 };
    this.tacVin = null; this.tacScan = null;
    this.autoQTrip = false; this.autoQLow = 0;
    // fresh maps/arrays: display objects were destroyed on shutdown
    this.players.clear();
    this.bullets.clear();
    this.throws.clear();
    this.clouds.clear();
    this.pickups.clear();
    this.pkDots.clear();
    this.feedRows.forEach((r) => { r.bg.destroy(); r.k.destroy(); r.m.destroy(); r.v.destroy(); });
    this.feedRows = [];
    this.dmgPool = [];
    this.dmgMade = 0;
    if (this.board) { this.board.destroy(true); this.board = null; }
    this.boardVisible = false;
    this.waterTiles = [];
    this.lastCd = -1;
    this.cdBanner = null;
    this.prevStreak = 0;
    // layoutClock() early-returns when the star count is unchanged, and it is
    // the only thing that draws the timer plate and positions the live dot. If
    // the previous match ended with no streak, clockStars was already 0, so the
    // fresh clockCardG stayed empty: no timer plate at all for the whole match,
    // and liveDot sat at its constructor x=0 as a red dot on the HP bar.
    this.clockStars = -1;
    this.myMove = { dx: 0, dy: 0 };
    this.firing = false;
    this.lastFire = 0;
    // scene restart: kill any discharge bed left droning from the last visit
    sfx.arcOff();
    this.arcG?.destroy();
    this.arcG = null;
    this.boltG?.destroy();
    this.boltG = null;
    this.foeArcs.forEach((a) => a.g.destroy());
    this.foeArcs.clear();
    this.tacVin = this.add.image(480, 300, 'vignette').setDisplaySize(960, 600).setScrollFactor(0).setDepth(9)
      .setVisible(!lowQ);
    // TAC frame: corner brackets + scanlines over the viewport
    const frame = this.add.graphics().setScrollFactor(0).setDepth(9);
    frame.lineStyle(2.5, 0x22d3ee, 0.75);
    const L = 30, M = 12, X = 960, Y = 600;
    frame.beginPath();
    frame.moveTo(M, M + L); frame.lineTo(M, M); frame.lineTo(M + L, M); // TL
    frame.moveTo(X - M - L, M); frame.lineTo(X - M, M); frame.lineTo(X - M, M + L); // TR
    frame.moveTo(M, Y - M - L); frame.lineTo(M, Y - M); frame.lineTo(M + L, Y - M); // BL
    frame.moveTo(X - M - L, Y - M); frame.lineTo(X - M, Y - M); frame.lineTo(X - M, Y - M - L); // BR
    frame.strokePath();
    frame.lineStyle(1, 0x22d3ee, 0.25);
    frame.strokeRect(M, M, X - M * 2, Y - M * 2);
    if (!lowQ) this.tacScan = this.add.tileSprite(480, 300, 960, 600, 'scan').setAlpha(0.35).setScrollFactor(0).setDepth(9);

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,R,E,Q,G,X,C,ONE,TWO,THREE,FOUR,FIVE,SIX,SEVEN,EIGHT,NINE,ZERO,F,TAB') as any;
    this.input.keyboard!.addCapture('UP,DOWN,LEFT,RIGHT,SPACE,TAB'); // stop page scroll + focus steal
    // global KeyboardPlugin outlives the scene: wire once or keys multi-fire
    if (!this.kbWired) {
      this.kbWired = true;
      const kb = this.input.keyboard!;
      kb.on('keydown-R', () => { Session.room?.send('reload'); sfx.reload(); });
      kb.on('keydown-E', () => Session.room?.send('interact'));
      // 1-0 select any slot: guns equip, throwables arm, 0 raises the shield
      const KEYMAP: Array<[string, string]> = [
        ['ONE', 'pistol'], ['TWO', 'rifle'], ['THREE', 'shotgun'], ['FOUR', 'sniper'],
        ['FIVE', 'laser'], ['SIX', 'electric'], ['SEVEN', 'grenade'], ['EIGHT', 'smoke'],
        ['NINE', 'molly'], ['ZERO', 'shield'],
      ];
      KEYMAP.forEach(([code, id]) => kb.on('keydown-' + code, () => this.selectSlot(id, false)));
      kb.on('keydown-G', () => this.throwOrd('grenade'));
      kb.on('keydown-X', () => this.throwOrd('molly'));
      kb.on('keydown-C', () => this.throwOrd('smoke'));
      kb.on('keydown-Q', () => {
        Session.room?.send('guard');
        const g = (Session.room as any)?.state?.players.get(Session.room?.sessionId || '');
        sfx.guard(!g?.guard); // clank previews the stance we're entering
      });
      kb.on('keydown-TAB', () => this.toggleBoard());
      kb.on('keydown-F', () => {
        Session.room?.send('melee');
        sfx.melee();
        const me = this.players.get(this.meId);
        if (me) this.slash(me.gfx.x, me.gfx.y, this.lastAim);
      });
    }
    // The wheel is a SELECTOR, not a twitch. A gesture is accumulated and
    // committed once, when the events stop, so a fast roll does not spam the
    // server with a switch request per notch.
    this.input.on('wheel', (_p: unknown, _g: unknown, _dx: number, dy: number) => {
      const now = this.time.now;
      if (now - this.wheelAt > WHEEL_GESTURE_MS) this.wheelAcc = 0; // a new gesture
      this.wheelAt = now;
      // Weight by MAGNITUDE, not by event count. Counting events was wrong in
      // both directions at once: a 6-notch mouse roll arrived as 6 events and
      // was capped at 4, so two notches vanished and a long scroll saturated
      // and then ignored everything after the fourth -- the wheel looked dead.
      // Meanwhile a trackpad flick arrived as ~18 events and was capped at the
      // same 4, so one flick jumped four slots, which is exactly what the cap
      // existed to prevent. One mouse notch is ~100px of deltaY, so dividing by
      // that counts notches on both kinds of device.
      const notches = Math.max(-WHEEL_EVENT_MAX,
        Math.min(WHEEL_EVENT_MAX, dy / WHEEL_NOTCH));
      this.wheelAcc = Math.max(-WHEEL_GESTURE_MAX,
        Math.min(WHEEL_GESTURE_MAX, this.wheelAcc + notches));
    });
    // ---- READOUTS: the three things you must never hunt for -------------
    //   TOP LEFT   health + status (shield / haste / electric lock)
    //   TOP MIDDLE the match timer (+ streak stars, objective, heading)
    //   TOP RIGHT  the gun in your hands and its ammo
    // Everything else (feed, controls, map, standings) stays in the bottom band.
    // HP bar (top-left): frame, ghost damage trail, gloss, segment ticks
    this.hpFrame = this.add.rectangle(10, 16, 236, 24, 0x0b1220, 0.85).setOrigin(0, 0.5)
      .setStrokeStyle(2.5, 0x22d3ee, 0.8).setScrollFactor(0).setDepth(10);
    this.add.rectangle(14, 16, 228, 16, 0x020617, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.hpGhost = this.add.rectangle(14, 16, 228, 16, 0xfca5a5).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.hpFill = this.add.rectangle(14, 16, 228, 16, 0x22c55e).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.add.rectangle(14, 9.5, 228, 4, 0xffffff, 0.16).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    for (const f of [0.25, 0.5, 0.75]) {
      this.add.rectangle(14 + 228 * f, 16, 2, 16, 0x000000, 0.55).setScrollFactor(0).setDepth(11);
    }
    this.hpLabel = this.add.text(128, 16, 'HP 100 · 0 K', {
      fontFamily: COND, fontSize: '15px', fontStyle: '700', color: '#fff',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(12);
    this.hpLabel.setStroke('#000000', 3);
    this.hpLabel.setShadow(0, 0, '#22c55e', 8, false, true);
    // diagnostics sit in the gutter between the left and center columns
    this.pingText = this.add.text(256, 452, 'PING …', {
      fontFamily: COND, fontSize: '11px', fontStyle: '700', color: DIM,
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    this.pingText.setStroke('#020617', 3);
    this.dispHp = 100; this.ghostHp = 100;
    this.paintHp(100, 100);
    if (this.lowPulse) { this.lowPulse.stop(); this.lowPulse = null; }
    this.dispHp = 100; this.ghostHp = 100;
    // red edge flash on damage
    this.dmgVin = this.add.image(480, 300, 'vignette').setTint(0xef4444)
      .setDisplaySize(960, 600).setScrollFactor(0).setDepth(8).setAlpha(0);
    // ammo strip (top-right). Row 1 of the card is a strict 3-column grid —
    // icon | weapon name | ammo count — and the reload/status line gets its
    // OWN row below the card, so a long message can never run over the count.
    const ammoCard = this.add.graphics().setScrollFactor(0).setDepth(9);
    ammoCard.fillStyle(0x020617, 0.62);
    ammoCard.fillRoundedRect(706, 2, 238, 32, 8);
    ammoCard.lineStyle(2, 0x22d3ee, 0.5);
    ammoCard.strokeRoundedRect(706, 2, 238, 32, 8);
    this.ammoIcon = this.add.image(724, 18, 'gun').setScale(0.55)
      .setScrollFactor(0).setDepth(10).setAlpha(0.9);
    this.ammoTitle = this.add.text(742, 12, 'PISTOL', {
      fontFamily: COND, fontSize: '11px', fontStyle: '700', color: '#94a3b8',
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.ammoCount = this.add.text(936, 18, '12/12', {
      fontFamily: COND, fontSize: '20px', fontStyle: '700', color: '#fff',
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(10);
    this.ammoCount.setStroke('#020617', 4);
    this.ammoCount.setShadow(0, 0, '#22d3ee', 10, false, true);
    // reload progress rides the card's own underline
    this.add.rectangle(938, 35, 232, 3, 0x000000, 0.5).setOrigin(1, 0).setScrollFactor(0).setDepth(10);
    this.reloadBar = this.add.rectangle(938, 35, 0, 3, 0xfb923c).setOrigin(1, 0).setScrollFactor(0).setDepth(11);
    // the strip itself is the reload target (row 1 only, so the status line
    // below is never a click target)
    this.reloadBg = this.add.rectangle(825, 18, 238, 32, 0xffffff, 0)
      .setScrollFactor(0).setDepth(12);
    // status line: its own row, right-aligned, 10px — room for any message
    this.reloadTx = this.add.text(944, 45, '', {
      fontFamily: COND, fontSize: '10px', fontStyle: '700', color: '#facc15', align: 'right',
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(11);
    this.reloadTx.setStroke('#020617', 3);
    this.reloadBg.setInteractive({ useHandCursor: true });
    this.reloadBg.on('pointerdown', () => {
      Session.room?.send('reload');
      sfx.reload();
    });
    // loadout strip (bottom-center): 10 tappable slots — every gun, every
    // throwable and the shield are switchable items, exactly like each other
    this.loadSlots = [];
    SLOTS.forEach((s, i) => {
      const x = 480 + (i - (SLOTS.length - 1) / 2) * 40;
      const bg = this.add.rectangle(x, 506, 36, 34, 0x020617, 0.78)
        .setStrokeStyle(2, 0x334155, 0.95).setScrollFactor(0).setDepth(10);
      const tx = this.add.text(x, 506, `${s.key}\n${s.nm}`, {
        fontFamily: COND, fontSize: '10px', fontStyle: '700', color: '#475569', align: 'center', lineSpacing: 0,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(11);
      tx.setStroke('#020617', 2);
      bg.setInteractive({ useHandCursor: true });
      // tapping a throwable slot throws it right away (one tap, PUBG-style);
      // guns equip, the shield slot raises the stance
      bg.on('pointerdown', () => this.selectSlot(s.id, true));
      this.loadSlots.push({ bg, tx });
    });
    // status row (one line under the HP bar): shield points / haste / electric
    // lock share a single strip, so effects never stack three rows deep
    this.statusSegs = [];
    for (let i = 0; i < 3; i++) {
      const x = 10 + i * 78;
      const bg = this.add.rectangle(x, 44, 74, 15, 0x020617, 0.66)
        .setOrigin(0, 0.5).setScrollFactor(0).setDepth(10).setVisible(false);
      const fill = this.add.rectangle(x + 2, 44, 0, 11, 0xffffff)
        .setOrigin(0, 0.5).setScrollFactor(0).setDepth(10).setVisible(false);
      const tx = this.add.text(x + 6, 44, '', {
        fontFamily: COND, fontSize: '10px', fontStyle: '700', color: '#e2e8f0',
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11).setVisible(false);
      tx.setStroke('#020617', 2);
      this.statusSegs.push({ bg, fill, tx });
    }
    // electric screen wash: violet edge pulse while YOU are locked
    this.zkVin = this.add.image(480, 300, 'vignette').setTint(0xa855f7)
      .setDisplaySize(960, 600).setScrollFactor(0).setDepth(8).setAlpha(0);
    // actionable pickup button (center column, under the loadout)
    this.grabBtn = makeButton(this, {
      tex: 'btn220', x: 480, y: 562, tint: 0xca8a04, label: 'Ⓔ PICK UP RIFLE', fontSize: 15,
      depth: 11, scroll: true,
      onClick: () => Session.room?.send('interact'),
    });
    this.grabBtn.c.setVisible(false);
    this.grabBtn.c.setScale(0.8);
    // the match timer sits dead top-middle. The pill is sized to its content
    // (compact with no streak, wider when the stars are showing) and shares
    // the ammo card's 32px row, corner radius and rim treatment.
    this.clockCardG = this.add.graphics().setScrollFactor(0).setDepth(10);
    this.liveDot = this.add.circle(0, 18, 4.5, 0xef4444).setScrollFactor(0).setDepth(11);
    this.tweens.add({ targets: this.liveDot, alpha: 0.25, duration: 800, yoyo: true, repeat: -1 });
    this.clockText = this.add.text(480, 18, '2:00', {
      fontFamily: COND, fontSize: '17px', fontStyle: '700', color: '#facc15',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(11);
    this.clockText.setStroke('#020617', 3);
    this.clockText.setShadow(0, 0, '#facc15', 10, false, true);
    this.compassText = this.add.text(700, 45, 'HDG 090 · E', {
      fontFamily: COND, fontSize: '11px', fontStyle: '700', color: '#7dd3fc',
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(11);
    this.compassText.setStroke('#020617', 3);
    // wanted stars only render while a streak is live, so they cost nothing
    this.wantedText = this.add.text(540, 18, '', {
      fontFamily: COND, fontSize: '15px', fontStyle: '700', color: '#facc15',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(11);
    this.wantedText.setStroke('#000000', 3);
    this.roundText = this.add.text(480, 45, '', {
      fontFamily: COND, fontSize: '12px', fontStyle: '700', color: SUB,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(11);
    this.roundText.setStroke('#020617', 3);
    this.layoutClock(false); // now that the texts exist, size the pill to them
    try {
      if (new URLSearchParams(location.search).get('fps')) {
        this.fpsText = this.add.text(256, 468, '60', {
          fontFamily: MONO, fontSize: '11px', color: '#4ade80',
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
      }
    } catch { /* noop */ }
    this.arenaBorn = Date.now();
    // GTA cash + leaders ticker: bottom of the right column, under the map.
    // The column is budgeted, not eyeballed: map 440-528, cash 533-553,
    // ticker 560-588. Stacked any tighter the cash sat ON the ticker and the
    // ticker ran off the bottom edge (see test-hud.mjs).
    this.cashText = this.add.text(948, 543, '$0', {
      fontFamily: COND, fontSize: '17px', fontStyle: '700', color: '#4ade80',
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(11);
    this.cashText.setStroke('#020617', 4);
    this.cashText.setShadow(0, 0, '#4ade80', 10, false, true);
    this.scoreText = this.add.text(948, 574, '', {
      fontFamily: MONO, fontSize: '11px', color: SUB, align: 'right', lineSpacing: 1,
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(10);
    this.scoreText.setStroke('#000000', 3);
    // minimap frame (right column): one plate, one rim
    this.minimap = this.add.graphics().setScrollFactor(0).setDepth(9);
    const mmFrame = this.add.graphics().setScrollFactor(0).setDepth(10);
    mmFrame.fillStyle(0x020617, 0.5);
    mmFrame.fillRoundedRect(836, 440, 116, 88, 8);
    mmFrame.lineStyle(2, 0x22d3ee, 0.6);
    mmFrame.strokeRoundedRect(836, 440, 116, 88, 8);

    // impact spray, blood, movement dust
    this.sparks = this.add.particles(0, 0, 'dot', {
      speed: { min: 90, max: 280 }, lifespan: 320, scale: { start: 1, end: 0 },
      tint: 0xfcd34d, blendMode: 'ADD', emitting: false,
    });
    this.sparks.setDepth(6);
    this.blood = this.add.particles(0, 0, 'dot', {
      speed: { min: 40, max: 190 }, lifespan: 550, scale: { start: 1.1, end: 0 },
      tint: 0xdc2626, emitting: false,
    });
    this.blood.setDepth(6);
    this.dust = this.add.particles(0, 0, 'dot', {
      speed: { min: 10, max: 45 }, lifespan: 600, scale: { start: 0.8, end: 0 },
      alpha: { start: 0.3, end: 0 }, tint: 0x94a3b8, emitting: false,
    });
    this.dust.setDepth(2);

    this.backToLobby = false;
    this.endShown = false;
    this.lastStreak = 0;
    this.firing = false;
    this.connect();
    this.input.on('pointerdown', (pt: Phaser.Input.Pointer) => {
      if ((pt as any).wasTouch) { this.pressStick(pt); return; } // twin-sticks own touches
      // clicks on HUD buttons belong to the buttons, not the trigger
      if (this.grabBtn?.c.visible
        && Math.abs(pt.x - 480) < 100 && Math.abs(pt.y - 562) < 28) return;
      if (pt.y < 40 && pt.x > 700) return; // ammo strip = reload
      if (pt.y > 488 && pt.y < 526 && Math.abs(pt.x - 480) < 205) return; // loadout strip
      if (pt.leftButtonDown()) {
        // Only set the flag. update() owns the trigger edge: this DOM handler
        // runs BETWEEN frames, so calling fireNow() here fired it a second
        // time on the same click. Guns hid the double because the per-weapon rate
        // limit rejected the second call -- but the one-shot branches return
        // BEFORE that limit, so a click threw two grenades, and the shield slot
        // sent two `guard` toggles that cancelled each other (the stance simply
        // never came up).
        this.firing = true;
      }
    });
    // Releasing the trigger. 'pointerupoutside' is NOT a rare edge case to
    // ignore: Phaser reports the release under that name whenever the target is
    // not the canvas, and this used to listen only for 'pointerup'. Letting go
    // of the button just off the window edge therefore left `firing` stuck true
    // and every automatic weapon (rifle, laser, electric) kept firing, with its
    // live arc and sustained audio bed, until the next click. Touch keeps its
    // own per-stick release: lifting the MOVE stick must not cancel a fire that
    // the aim stick is still holding.
    const release = (pt: Phaser.Input.Pointer) => {
      if ((pt as any).wasTouch) { this.releaseStick(pt.id); return; }
      this.firing = false;
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
    this.input.on('gameout', () => { this.firing = false; this.clearSticks(); });
    // Blur produces no mouseup at all -- the browser never delivers one -- and
    // 'gameout' needs actual pointer movement, so alt-tabbing mid-burst would
    // otherwise leave the trigger down for the rest of the match.
    this.blurHandler = () => { this.firing = false; this.clearSticks(); };
    this.game.events.on(Phaser.Core.Events.BLUR, this.blurHandler);
    this.input.addPointer(3); // multitouch: move + aim + button taps at once
    this.input.on('pointermove', (pt: Phaser.Input.Pointer) => this.dragStick(pt));
    this.stickG = this.add.graphics().setScrollFactor(0).setDepth(30);
    // reactive crosshair (desktop only): bloom answers every trigger pull
    this.crossG = this.add.graphics().setScrollFactor(0).setDepth(40);
    if (!this.touchMode) this.input.setDefaultCursor('none');
  }

  private drawCrosshair() {
    const g = this.crossG;
    if (!g) return;
    g.clear();
    if (this.touchMode || (Session.room as any)?.state?.phase !== 'playing') return;
    const pt = this.input.activePointer;
    if (pt.x < 0 || pt.y < 0 || pt.x > 960 || pt.y > 600) return;
    const since = this.time.now / 1000 - this.lastFire;
    const gap = 7 + 15 * Math.max(0, 1 - since * 3.5); // bloom after each shot
    const L = 9;
    // reticle takes the held weapon's colour
    const cw = this.ownWeapon();
    const cc = cw === 'electric' ? 0xc084fc : cw === 'sniper' ? 0xc084fc
      : cw === 'laser' ? 0x22d3ee : cw === 'shotgun' ? 0xfb923c
      : cw === 'rifle' ? 0xfacc15 : 0x22d3ee;
    g.lineStyle(2.5, cc, 0.95);
    g.beginPath();
    g.moveTo(pt.x - gap - L, pt.y); g.lineTo(pt.x - gap, pt.y);
    g.moveTo(pt.x + gap, pt.y); g.lineTo(pt.x + gap + L, pt.y);
    g.moveTo(pt.x, pt.y - gap - L); g.lineTo(pt.x, pt.y - gap);
    g.moveTo(pt.x, pt.y + gap); g.lineTo(pt.x, pt.y + gap + L);
    g.strokePath();
    g.fillStyle(0xffffff, 0.95);
    g.fillCircle(pt.x, pt.y, 1.6);
    g.lineStyle(1, 0x020617, 0.8);
    g.strokeCircle(pt.x, pt.y, gap + L + 1);
  }

  // ---- twin-stick touch controls (left = move, right = aim + fire) ----
  private pressStick(pt: Phaser.Input.Pointer) {
    this.touchMode = true;
    // HUD buttons handle themselves; sticks ignore those taps
    if (this.grabBtn?.c.visible && Math.abs(pt.x - 480) < 100 && Math.abs(pt.y - 562) < 28) return;
    if (pt.y < 40 && pt.x > 700) return; // ammo strip = reload
    if (pt.y > 488 && pt.y < 526 && Math.abs(pt.x - 480) < 205) return;
    if (pt.x < 480 && !this.moveStick) {
      this.moveStick = { id: pt.id, ox: pt.x, oy: pt.y };
    } else if (pt.x >= 480 && !this.aimStick) {
      this.aimStick = { id: pt.id, ox: pt.x, oy: pt.y, kx: pt.x, ky: pt.y, ang: this.lastAim };
    }
    this.paintSticks();
  }

  private dragStick(pt: Phaser.Input.Pointer) {
    if (!(pt as any).wasTouch) return;
    if (this.moveStick && pt.id === this.moveStick.id) {
      const R = 60;
      let dx = pt.x - this.moveStick.ox, dy = pt.y - this.moveStick.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      this.joyMove = d < 8 ? { dx: 0, dy: 0 } : { dx: dx / R, dy: dy / R };
    } else if (this.aimStick && pt.id === this.aimStick.id) {
      const s = this.aimStick;
      s.kx = pt.x; s.ky = pt.y;
      const dx = pt.x - s.ox, dy = pt.y - s.oy;
      const d = Math.hypot(dx, dy);
      if (d > 12) s.ang = Math.atan2(dy, dx);
      this.firing = d > 28; // push past the deadzone to fire
    }
    this.paintSticks();
  }

  private releaseStick(id: number) {
    if (this.moveStick?.id === id) {
      this.moveStick = null;
      this.joyMove = { dx: 0, dy: 0 };
    }
    if (this.aimStick?.id === id) {
      this.aimStick = null;
      this.firing = false;
    }
    this.paintSticks();
  }

  private clearSticks() {
    this.moveStick = null;
    this.aimStick = null;
    this.joyMove = { dx: 0, dy: 0 };
    this.paintSticks();
  }

  private paintSticks() {
    const g = this.stickG;
    if (!g) return;
    g.clear();
    const draw = (ox: number, oy: number, kx: number, ky: number, color: number, hot: boolean) => {
      g.fillStyle(0x020617, 0.45);
      g.fillCircle(ox, oy, 56);
      g.lineStyle(2.5, color, hot ? 1 : 0.6);
      g.strokeCircle(ox, oy, 56);
      g.fillStyle(color, hot ? 0.85 : 0.5);
      g.fillCircle(kx, ky, 24);
    };
    if (this.moveStick) {
      const s = this.moveStick;
      draw(s.ox, s.oy, s.ox + this.joyMove.dx * 60, s.oy + this.joyMove.dy * 60, 0x22d3ee,
        this.joyMove.dx !== 0 || this.joyMove.dy !== 0);
    }
    if (this.aimStick) {
      const s = this.aimStick;
      draw(s.ox, s.oy, s.kx, s.ky, 0xfb923c, this.firing);
    }
  }

  private ownWeapon(): string {
    const me = (Session.room as any)?.state?.players.get(this.meId);
    const w = me?.weapon;
    return w === 'rifle' || w === 'shotgun' || w === 'sniper' || w === 'laser' || w === 'electric'
      ? w : 'pistol';
  }

  // Select a loadout slot. `use` = fire it now (tap on touch, click on the
  // slot): guns equip, throwables toss, the shield raises the stance.
  //
  // A gun switch is a REQUEST, not a fact: the server owns p.weapon and only
  // confirms it on the next patch. So the selection goes pending until the
  // server agrees (or refuses) — otherwise the highlight snaps back on the
  // first stale patch, and a tap fires the gun we were holding a moment ago.
  private selectSlot(id: string, use: boolean) {
    const slot = SLOTS.find((s) => s.id === id);
    if (!slot) return;
    if (slot.kind === 'gun') {
      const st: any = (Session.room as any)?.state?.players.get(this.meId);
      if (st && id !== 'pistol' && st[id] !== true) {
        // tell the player why nothing happened instead of a silent no-op
        sfx.empty();
        this.flashSlot(SLOTS.findIndex((s) => s.id === id), 380);
        toast(this, `${slot.nm} not picked up yet — grab it with E`, '#facc15', 344);
        return;
      }
      this.activeSlot = id;
      this.pendingSlot = id;
      this.pendingAt = this.time.now;
      this.pendingFire = use;
      Session.room?.send('switch', { weapon: id });
      sfx.click();
      return;
    }
    // selecting anything but the shield means the stance comes down, so an
    // armed throwable is always legal to use the moment you pick it
    this.pendingSlot = '';
    this.activeSlot = id;
    if (slot.kind === 'ord') {
      Session.room?.send('guard', { on: false });
      sfx.click();
      if (use) this.throwOrd(id); // arm now, toss on the key/fire button
    } else {
      Session.room?.send('guard', { on: true });
      sfx.guard(true);
    }
  }

  // called from drawAmmo on every local patch: settle an in-flight switch
  private settlePending(p: any) {
    if (!this.pendingSlot) {
      // no request in flight: the server is the only truth for gun slots
      if (isGunSlot(this.activeSlot) && p.weapon !== this.activeSlot) {
        this.activeSlot = p.weapon;
      }
      return;
    }
    if (p.weapon === this.pendingSlot) {
      const wantFire = this.pendingFire;
      this.pendingSlot = '';
      this.pendingFire = false;
      if (wantFire) this.fireNow(true); // the new gun is live: it may fire
      return;
    }
    if (this.time.now - this.pendingAt > 600) {
      // never confirmed: refused (dead, wrong phase) or lost in the wire
      this.pendingSlot = '';
      this.pendingFire = false;
      this.activeSlot = p.weapon;
    }
  }

  // The wheel's cycle: the very same slot list as 1-0 — owned guns in strip
  // order, then the three throwables, then the shield. Throwables stay in the
  // cycle even at zero so the order never shifts under your fingers. Cached
  // against an ownership fingerprint so a scroll allocates nothing.
  private slotCycle(): Slot[] {
    const me: any = (Session.room as any)?.state?.players.get(this.meId);
    const key = SLOTS.map((s) => (s.kind === 'gun'
      ? (s.id === 'pistol' || me?.[s.id] === true ? '1' : '0') : '1')).join('');
    if (key !== this.wheelKey) {
      this.wheelKey = key;
      this.wheelCycle = SLOTS.filter((s) => s.kind !== 'gun'
        || s.id === 'pistol' || me?.[s.id] === true);
    }
    return this.wheelCycle;
  }

  // called every frame: commits a wheel gesture once its events stop arriving
  private commitWheel() {
    if (this.time.now - this.wheelAt < WHEEL_SETTLE_MS) return; // still receiving
    // whole notches only: a fraction means the scroll has not travelled far
    // enough yet, and it carries into the next gesture so slow scrolling still
    // adds up instead of resetting every gesture
    const steps = Math.trunc(this.wheelAcc);
    if (!steps) return;
    this.wheelAcc -= steps;
    const cycle = this.slotCycle();
    if (cycle.length < 2) return;
    const i = cycle.findIndex((s) => s.id === this.activeSlot);
    const from = i < 0 ? 0 : i;
    const next = from + steps;
    const idx = ((next % cycle.length) + cycle.length) % cycle.length;
    this.selectSlot(cycle[idx].id, false);
  }

  // brief red flash on a slot that cannot be equipped
  private flashSlot(idx: number, ms: number) {
    const s = this.loadSlots[idx];
    if (!s) return;
    this.tweens.killTweensOf(s.bg);
    s.bg.setStrokeStyle(2.5, 0xef4444, 1);
    this.time.delayedCall(ms, () => {
      const p: any = (Session.room as any)?.state?.players.get(this.meId);
      if (p) this.drawLoadout(p);
    });
  }

  // toss ordnance toward the cursor (shield must be lowered first)
  private throwOrd(kind: string) {
    const room = Session.room;
    if (!room || (room as any).state?.phase !== 'playing') return;
    const me = this.players.get(this.meId);
    if (!me) return;
    const st = (room as any).state?.players.get(this.meId);
    if (st?.guard) { sfx.empty(); return; }
    let ang: number;
    if (this.touchMode && this.aimStick) {
      ang = this.aimStick.ang;
    } else if (this.touchMode) {
      ang = this.lastAim; // button tap: throw where you're facing, not at the button
    } else {
      const pt = this.input.activePointer;
      const wp = this.cameras.main.getWorldPoint(pt.x, pt.y);
      ang = Math.atan2(wp.y - me.gfx.y, wp.x - me.gfx.x);
    }
    room.send('throw', { kind, angle: ang });
    sfx.melee();
  }

  private fireNow(edge = true) {
    const room = Session.room;
    if (!room || (room as any).state?.phase !== 'playing') return;
    const me = this.players.get(this.meId);
    if (!me) return;
    const st = (room as any).state?.players.get(this.meId);
    // the selected slot decides what the trigger does. One-shot items fire on
    // the press edge only, so holding the mouse can't carpet-bomb grenades.
    const slot = SLOTS.find((s) => s.id === this.activeSlot);
    if (slot && slot.kind === 'ord') {
      if (!edge) return;
      this.throwOrd(slot.id);
      return;
    }
    if (slot && slot.kind === 'shield') {
      if (!edge) return;
      room.send('guard');
      sfx.guard(!st?.guard);
      return;
    }
    if (st?.guard) { // shield raised: guns are dead — knife (F) or lower (Q)
      sfx.empty();
      toast(this, 'SHIELD UP - Q or slot 0 to lower', '#4ade80', 344);
      return;
    }
    const w = WEAPONS[this.ownWeapon()] || WEAPONS.pistol;
    const now = this.time.now / 1000;
    if (now - this.lastFire < w.interval) return;
    this.lastFire = now;
    // dry mag: reload instead of flashing blanks (server would reject anyway)
    const mag = st?.weapon === 'rifle' ? st?.ammo : st?.weapon === 'shotgun' ? st?.sammo
      : st?.weapon === 'sniper' ? st?.nammo : st?.weapon === 'laser' ? st?.lammo
      : st?.weapon === 'electric' ? st?.eammo : st?.pammo;
    if (st?.reloading) return;
    if ((mag ?? 1) <= 0) {
      room.send('reload');
      sfx.reload();
      return;
    }
    const pt = this.input.activePointer;
    const wp = this.cameras.main.getWorldPoint(pt.x, pt.y);
    const ang = this.touchMode && this.aimStick ? this.aimStick.ang
      : Math.atan2(wp.y - me.gfx.y, wp.x - me.gfx.x);
    room.send('shoot', { angle: ang });
    const gw = this.ownWeapon();
    sfx.shoot(gw);
    const mx = me.gfx.x + Math.cos(ang) * MUZZLE, my = me.gfx.y + Math.sin(ang) * MUZZLE;
    this.flash(mx, my, ang, false, gw === 'laser' ? 0x22d3ee : gw === 'electric' ? 0xc084fc : 0);
    if (gw === 'laser') this.beam(mx, my, ang, this.meId); // instant full-length beam (no echo delay)
    if (gw === 'electric') this.arcBolt(mx, my, ang, this.meId); // crawling thunder bolt
    this.recoil(me.gun);
    // heavier guns kick the camera harder
    this.cameras.main.shake(60, gw === 'shotgun' ? 0.004 : gw === 'sniper' ? 0.003 : 0.0015);
  }

  // steel + standing bricks + water (mirrors server solids())
  private solids(): Array<{ x: number; y: number; w: number; h: number }> {
    const out = [...STEEL, ...WATER];
    BRICKS.forEach((rc, i) => {
      if ((this.brickHp.get(`br_${i}`) ?? BRICK_HP) > 0) out.push(rc);
    });
    return out;
  }

  private syncBrick(id: string, hp: number) {
    this.brickHp.set(id, hp);
    const idx = Number(id.split('_')[1]);
    const rc = BRICKS[idx];
    if (!rc) return;
    if (hp <= 0) {
      const v = this.brickViews.get(id);
      if (v) { v.c.destroy(true); this.brickViews.delete(id); }
      if (!this.rubble.has(id)) {
        this.rubble.set(id, this.add.image(rc.x + rc.w / 2, rc.y + rc.h / 2, 'rubble'));
      }
      this.sparks.explode(14, rc.x + rc.w / 2, rc.y + rc.h / 2);
      return;
    }
    this.rubble.get(id)?.destroy();
    this.rubble.delete(id);
    let v = this.brickViews.get(id);
    if (!v) {
      const idx = Number(id.split('_')[1]) || 0;
      const tiles = this.add.tileSprite(rc.x + rc.w / 2, rc.y + rc.h / 2, rc.w, rc.h, idx % 2 ? 'brickTileB' : 'brickTileA');
      // 3D top cap: sunlit edge for depth
      const cap = this.add.rectangle(rc.x, rc.y + 2.5, rc.w, 5, 0xffd9a0, 0.35).setOrigin(0, 0.5);
      const cracks = this.add.graphics();
      const c = this.add.container(0, 0, [tiles, cap, cracks]);
      v = { c, cracks };
      this.brickViews.set(id, v);
      c.setScale(0);
      this.tweens.add({ targets: c, scaleX: 1, scaleY: 1, duration: 300, ease: 'Back.easeOut' });
    }
    // crack stages as damage mounts
    v.cracks.clear();
    const lines = hp >= BRICK_HP ? 0 : hp === BRICK_HP - 1 ? 3 : 6;
    v.cracks.lineStyle(2, 0x2a1408, 0.9);
    for (let i = 0; i < lines; i++) {
      const x = rc.x + ((i * 53) % rc.w), y = rc.y + ((i * 37) % rc.h);
      v.cracks.beginPath();
      v.cracks.moveTo(x - rc.w / 2 + rc.w / 2, y);
      v.cracks.lineTo(x + 8, y + 10);
      v.cracks.strokePath();
    }
  }

  private flash(x: number, y: number, ang: number, big: boolean, tint = 0) {
    const f = this.add.image(x, y, 'muzzle').setBlendMode(Phaser.BlendModes.ADD)
      .setRotation(ang).setDepth(7).setScale(big ? 1.3 : 0.8);
    if (tint) f.setTint(tint);
    this.time.delayedCall(60, () => f.destroy());
  }

  // laser beam: march the ray until a wall (steel/standing brick), a player,
  // or max range, then burn a 3-pass beam with an impact flare.
  private rayEnd(x: number, y: number, dx: number, dy: number, maxD: number, skipId: string) {
    const walls = [...STEEL];
    BRICKS.forEach((rc, i) => {
      if ((this.brickHp.get(`br_${i}`) ?? BRICK_HP) > 0) walls.push(rc);
    });
    const bodies: Array<{ x: number; y: number }> = [];
    this.players.forEach((o, id) => {
      if (id !== skipId && o.alive) bodies.push({ x: o.gfx.x, y: o.gfx.y });
    });
    for (let t = 16; t <= maxD; t += 16) {
      const px = x + dx * t, py = y + dy * t;
      if (px < 0 || py < 0 || px > W || py > H) return { x: px, y: py };
      if (pointInWall(px, py, walls)) return { x: x + dx * (t - 8), y: y + dy * (t - 8) };
      for (const b of bodies) {
        // 22px = the server's bullet-vs-player radius, so the beam/arc stops
        // exactly where the shot stops instead of a few pixels past it
        if (Math.hypot(px - b.x, py - b.y) < 22) return { x: b.x, y: b.y };
      }
    }
    return { x: x + dx * maxD, y: y + dy * maxD };
  }

  private beam(x1: number, y1: number, ang: number, skipId: string) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const range = WEAPONS.laser.speed * WEAPONS.laser.life;
    const end = this.rayEnd(x1, y1, dx, dy, range, skipId);
    const g = this.add.graphics().setDepth(6).setBlendMode(Phaser.BlendModes.ADD);
    g.lineStyle(11, 0x22d3ee, 0.28);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(end.x, end.y); g.strokePath();
    g.lineStyle(5, 0x67e8f9, 0.65);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(end.x, end.y); g.strokePath();
    g.lineStyle(2, 0xffffff, 0.95);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(end.x, end.y); g.strokePath();
    const flare = this.add.image(end.x, end.y, 'glow').setTint(0x22d3ee)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(6).setScale(2.2);
    this.tweens.add({
      targets: [g, flare], alpha: 0, duration: 170, ease: 'Quad.easeOut',
      onComplete: () => { g.destroy(); flare.destroy(); },
    });
  }

  // CONTINUOUS electric fire: while the trigger is held the gun keeps a live
  // arc crawling off the prongs and a sustained discharge bed droning under the
  // per-shot cracks. One driver for both, so nothing can desync.
  private driveArc(me: PObj, ang: number, playing: boolean) {
    const st: any = (Session.room as any)?.state?.players.get(this.meId);
    const mag = st?.eammo ?? 0;
    const live = playing && this.firing && me.alive && st?.weapon === 'electric'
      && !st?.guard && !st?.reloading && mag > 0;
    if (live) {
      if (!this.arcG) {
        this.arcG = this.add.graphics().setDepth(7).setBlendMode(Phaser.BlendModes.ADD);
      }
      // redrawn (new jitter) every frame = crawling current, not a static shape
      const flick = 0.7 + 0.3 * Math.random();
      const mx = me.gfx.x + Math.cos(ang) * MUZZLE, my = me.gfx.y + Math.sin(ang) * MUZZLE;
      // clipped to the first blocker: no arc through a body, a wall or a crate
      const reach = this.arcReach(mx, my, ang, 190, this.meId);
      this.arcStream(this.arcG, mx, my, ang, reach, flick);
      this.arcG.setVisible(true);
      if (!sfx.arcLive) sfx.arcOn();
      if (Math.random() < 0.55 && reach > 8) {
        // continuous spark shed off the live arc, not just on trigger frames
        const t = 0.2 + Math.random() * 0.8;
        this.sparks.explode(1,
          mx + Math.cos(ang) * (reach * t) + (Math.random() - 0.5) * 26,
          my + Math.sin(ang) * (reach * t) + (Math.random() - 0.5) * 26);
      }
      if (Math.random() < 0.22) { // muzzle corona while it runs hot
        const z = this.add.image(me.gfx.x + Math.cos(ang) * MUZZLE,
          me.gfx.y + Math.sin(ang) * MUZZLE, 'zap').setDepth(7)
          .setScale(0.3 + Math.random() * 0.25).setAngle(Math.random() * 360)
          .setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({
          targets: z, scaleX: 0, scaleY: 0, alpha: 0, duration: 110 + Math.random() * 90,
          onComplete: () => z.destroy(),
        });
      }
    } else {
      this.arcG?.clear();
      this.arcG?.setVisible(false);
      if (sfx.arcLive) sfx.arcOff();
    }
  }

  // Stop the discharge bed without leaving the scene (reload, respawn, guard).
  // Scene teardown handles itself via the 'shutdown' listener in create().
  private arcOffNow() {
    this.arcG?.clear();
    this.arcG?.setVisible(false);
    if (sfx.arcLive) sfx.arcOff();
  }

  // a foe's electric stream: each shot re-opens a window, so sustained fire
  // from them reads as continuous too (no trigger state to poll remotely)
  private foeArc(id: string, hold: number) {
    let a = this.foeArcs.get(id);
    if (!a) {
      const g = this.add.graphics().setDepth(7).setBlendMode(Phaser.BlendModes.ADD);
      a = { g, t: 0 };
      this.foeArcs.set(id, a);
    }
    a.t = Math.max(a.t, hold);
  }

  private tickFoeArcs(dt: number) {
    this.foeArcs.forEach((a, id) => {
      const o = this.players.get(id);
      if (!o || !o.alive) { a.g.destroy(); this.foeArcs.delete(id); return; }
      a.t -= dt;
      if (a.t <= 0) {
        a.g.clear();
        this.foeArcs.delete(id);
        a.g.destroy();
        return;
      }
      const ang = o.gun.rotation;
      const mx = o.gfx.x + Math.cos(ang) * MUZZLE, my = o.gfx.y + Math.sin(ang) * MUZZLE;
      // same clip as my own arc: a foe's current stops at me, at steel, at brick
      const reach = this.arcReach(mx, my, ang, 190, id);
      this.arcStream(a.g, mx, my, ang, reach, Math.min(1, a.t / 0.3) * 0.85);
    });
  }

  // The arc is current, not a ghost: it stops at the first thing that would stop
  // the bolt — a body, standing steel or brick, or the map edge. Without this the
  // muzzle stream drew straight through teammates, walls and crates while the
  // shot itself was being absorbed by them. Same rule for my arc, a foe's arc
  // and the per-shot lance, so all three agree with the authoritative sim.
  private arcReach(x: number, y: number, ang: number, want: number, skipId: string) {
    if (want <= 0) return 0;
    const end = this.rayEnd(x, y, Math.cos(ang), Math.sin(ang), want, skipId);
    return Math.min(want, Math.hypot(end.x - x, end.y - y));
  }

  // Every in-flight electric shot is a bolt, not a bullet: current running from
  // the shooter's muzzle out to where the discharge tip is right now. One shared
  // Graphics for all of them, re-rolled every frame so it crawls. Drawn after
  // dead-reckoning, so the tether always ends exactly at the rendered tip, and
  // capped so a burst (0.14s interval) can never flood the frame.
  private drawArcTethers() {
    let n = 0;
    this.bullets.forEach((o) => { if (o.arc) n++; });
    if (!n) {
      this.boltG?.clear();
      this.boltG?.setVisible(false);
      return;
    }
    if (!this.boltG) {
      this.boltG = this.add.graphics().setDepth(6).setBlendMode(Phaser.BlendModes.ADD);
    }
    this.boltG.setVisible(true).clear();
    let drawn = 0;
    this.bullets.forEach((o) => {
      if (!o.arc || drawn >= ARC_TETHER_MAX) return;
      const own = this.players.get(o.arc);
      if (!own || !own.alive) return; // shooter gone or dead: nothing to anchor to
      const dx = o.img.x - own.gfx.x, dy = o.img.y - own.gfx.y;
      const reach = Math.hypot(dx, dy);
      if (reach < MUZZLE + 6) return; // still inside the barrel
      const a = Math.atan2(dy, dx);
      this.arcStream(this.boltG!, own.gfx.x + Math.cos(a) * MUZZLE,
        own.gfx.y + Math.sin(a) * MUZZLE, a, reach - MUZZLE, 0.85, false);
      drawn++;
    });
  }

  // jagged 3-pass lightning path — re-rolled every call, so a redraw each frame
  // reads as crawling current rather than a static polygon. clearFirst=false
  // lets several bolts share one Graphics (the screen-wide tether pass).
  private arcStream(g: Phaser.GameObjects.Graphics, x: number, y: number,
    ang: number, reach: number, alpha = 1, clearFirst = true) {
    if (alpha <= 0) { if (clearFirst) g.clear(); return; }
    if (clearFirst) g.clear();
    const dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
    const segs = Math.max(4, Math.round(reach / 22));
    for (let pass = 0; pass < 3; pass++) {
      g.lineStyle(pass === 2 ? 1.6 : pass === 1 ? 4 : 8,
        pass === 2 ? 0xffffff : pass === 1 ? 0xa855f7 : 0x6d28d9,
        (pass === 2 ? 0.9 : pass === 1 ? 0.6 : 0.25) * alpha);
      g.beginPath();
      g.moveTo(x, y);
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const jag = i === segs ? 0 : (Math.random() - 0.5) * 30 * (pass === 2 ? 0.4 : 1);
        g.lineTo(x + dx * reach * t + nx * jag, y + dy * reach * t + ny * jag);
      }
      g.strokePath();
    }
  }

  // per-shot discharge accent. The discharge is a muzzle lance, NOT a hitscan
  // beam: the bolt is still in flight after this fades, so a full-length arc
  // would lie about range.
  private arcBolt(x1: number, y1: number, ang: number, skipId: string) {
    const reach = Math.min(WEAPONS.electric.speed * WEAPONS.electric.life, 280);
    const end = this.rayEnd(x1, y1, Math.cos(ang), Math.sin(ang), reach, skipId);
    const g = this.add.graphics().setDepth(7).setBlendMode(Phaser.BlendModes.ADD);
    this.arcStream(g, x1, y1, ang, Math.hypot(end.x - x1, end.y - y1));
    // charge orb at the barrel + crackle at the lance tip
    const src = this.add.image(x1, y1, 'zap').setDepth(7).setScale(0.5)
      .setBlendMode(Phaser.BlendModes.ADD);
    const dst = this.add.image(end.x, end.y, 'zap').setDepth(7).setScale(1.1)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: [g, src], alpha: 0, duration: 130, ease: 'Quad.easeOut',
      onComplete: () => { g.destroy(); src.destroy(); },
    });
    this.tweens.add({
      targets: dst, scaleX: 1.9, scaleY: 1.9, alpha: 0, duration: 220, ease: 'Quad.easeOut',
      onComplete: () => dst.destroy(),
    });
    this.sparks.explode(5, end.x, end.y);
  }

  // electric impact: white flash, radial crackle and a grounding ring
  private electricImpact(x: number, y: number) {
    const core = this.add.image(x, y, 'zap').setDepth(8).setScale(0.7)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: core, scaleX: 2.2, scaleY: 2.2, angle: 120, alpha: 0,
      duration: 240, ease: 'Quad.easeOut', onComplete: () => core.destroy(),
    });
    const g = this.add.graphics().setDepth(8).setBlendMode(Phaser.BlendModes.ADD);
    g.lineStyle(2, 0xddd6fe, 0.9);
    g.strokeCircle(x, y, 10);
    g.lineStyle(1.4, 0xa855f7, 0.55);
    g.strokeCircle(x, y, 22);
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      g.beginPath();
      g.moveTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6);
      let px = x, py = y, aa = a;
      for (let s = 0; s < 3; s++) {
        aa += (Math.random() - 0.5) * 1.1;
        px = x + Math.cos(aa) * (6 + s * 9); py = y + Math.sin(aa) * (6 + s * 9);
        g.lineTo(px, py);
      }
      g.strokePath();
    }
    this.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });
    this.sparks.explode(6, x, y);
  }

  // lock aura on a shocked body: crackling shell that dies with slowT
  private zapAura(o: PObj) {
    if (!o.zap) {
      const a = this.add.image(0, 0, 'zap').setBlendMode(Phaser.BlendModes.ADD).setScale(1.5);
      const b = this.add.image(0, 0, 'zap').setBlendMode(Phaser.BlendModes.ADD).setScale(1.1);
      o.gfx.addAt([a, b], o.gfx.getIndex(o.gun) + 1);
      o.zap = a; o.zap2 = b;
    }
    const j = 60 + Math.random() * 50;
    [o.zap!, o.zap2!].forEach((z, i) => {
      this.tweens.killTweensOf(z);
      z.setAngle(Math.random() * 360).setScale((i ? 1.0 : 1.45) + Math.random() * 0.3)
        .setAlpha(0.55 + Math.random() * 0.4);
      this.tweens.add({
        targets: z, angle: z.angle + (Math.random() - 0.5) * 120, alpha: 0.25,
        duration: j, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    });
  }

  private damageNumber(x: number, y: number, str: string, color: string) {
    let t = this.dmgPool.pop();
    if (!t) {
      if (this.dmgMade >= 24) return; // shed load under absurd burst instead of crashing
      t = this.add.text(0, 0, '', {
        fontFamily: MONO, fontSize: '14px', fontStyle: '700', color: '#fecaca',
      }).setOrigin(0.5).setDepth(8);
      t.setStroke('#000000', 3);
      this.dmgMade++;
    }
    this.tweens.killTweensOf(t);
    t.setText(str).setColor(color).setPosition(x, y - 14).setAlpha(1).setVisible(true);
    this.tweens.add({
      targets: t, y: y - 44, alpha: 0, duration: 650, ease: 'Quad.easeOut',
      onComplete: () => { t.setVisible(false); this.dmgPool.push(t); },
    });
  }

  private slash(x: number, y: number, ang: number) {
    const g = this.add.graphics().setDepth(7);
    g.lineStyle(5, 0xfef08a, 0.95);
    g.beginPath();
    g.arc(x, y, 52, ang - 0.7, ang + 0.7);
    g.strokePath();
    this.tweens.add({ targets: g, alpha: 0, duration: 160, onComplete: () => g.destroy() });
  }

  private recoil(gun: Phaser.GameObjects.Image) {
    this.tweens.killTweensOf(gun);
    // back into the barrel, then settle at the rest position -- derived, so it
    // cannot drift away from where the gun is actually mounted
    gun.x = GUN_REST_X - 4;
    this.tweens.add({ targets: gun, x: GUN_REST_X, duration: 110, ease: 'Quad.easeOut' });
  }

  async connect() {
    if (!Session.room) { this.scene.start('menu'); return; }
    const room: any = Session.room;
    this.meId = room.sessionId;
    // generation token: callbacks from previous arena visits exit early
    const gen = ++this.subGen;
    const live = () => gen === this.subGen && Session.room === room;

    this.keep(room.state.onChange(() => {
      if (!live()) return;
      if (room.state.phase === 'lobby' && !this.backToLobby) {
        this.backToLobby = true;
        this.scene.start('lobby');
      }
      if (room.state.phase === 'ended') this.showEnd(room.state.winnerName);
      if (room.state.phase === 'countdown') this.showCountdown(Math.ceil(room.state.countdown));
      if (room.state.phase === 'playing' && this.lastCd !== -99) this.showFight();
      this.drawScore();
    }));
    // entering arena mid-state (e.g. reloaded scene) — show banner if already ended
    if (room.state.phase === 'ended') this.showEnd(room.state.winnerName);
    this.drawScore();

    room.onMessage('kill', (k: { killer: string; victim: string; w?: string }) => {
      if (!live()) return;
      const w = (k.w || 'pistol').toUpperCase();
      const myName = (Session.room as any)?.state?.players.get(this.meId)?.name;
      const rowY = (i: number) => 494 + i * 19; // inside the bottom band
      // shift older rows down
      this.feedRows.forEach((r, i) => {
        const y = rowY(i + 1);
        r.bg.setY(y);
        r.k.setY(y); r.m.setX(r.k.x + r.k.width + 4); r.m.setY(y);
        r.v.setX(r.m.x + r.m.width + 4); r.v.setY(y);
      });
      const kk = this.add.text(12, rowY(0), k.killer, {
        fontFamily: MONO, fontSize: '12px', color: k.killer === myName ? '#22d3ee' : '#fdba74',
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
      kk.setStroke('#000000', 3);
      const mm = this.add.text(kk.x + kk.width + 4, rowY(0), `[${w}]`, {
        fontFamily: MONO, fontSize: '12px', color: '#94a3b8',
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
      mm.setStroke('#000000', 3);
      const vv = this.add.text(mm.x + mm.width + 4, rowY(0), k.victim, {
        fontFamily: MONO, fontSize: '12px', color: k.victim === myName ? '#ef4444' : '#e2e8f0',
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
      vv.setStroke('#000000', 3);
      // Measure, then draw the plate: two 12-char names plus [ELECTRIC] run to
      // x=265, so a fixed 244px plate left ~15px of text hanging off its own
      // background. Clamped so the row can never reach the loadout strip.
      const bg = this.add.rectangle(6, rowY(0),
        Math.max(244, Math.min(270, vv.x + vv.width + 10 - 6)), 17, 0x020617, 0.72)
        .setOrigin(0, 0.5).setScrollFactor(0).setDepth(9)
        .setStrokeStyle(1.5, 0x22d3ee, 0.45);
      this.feedRows.unshift({ bg, k: kk, m: mm, v: vv });
      while (this.feedRows.length > 2) {
        const old = this.feedRows.pop()!;
        old.bg.destroy(); old.k.destroy(); old.m.destroy(); old.v.destroy();
      }
      this.feedExpiry = Date.now() + 6000;
    });
    room.onMessage('hit', (h: { x: number; y: number; by?: string; dmg?: number; ox?: number; oy?: number; to?: string; w?: string }) => {
      if (!live()) return;
      this.sparks.explode(8, h.x, h.y);
      const blocked = (h.dmg ?? 0) <= 0;
      // electric impacts arc and report the lock instead of plain damage
      if (h.w === 'electric') {
        this.damageNumber(h.x, h.y, blocked ? 'ARC BLOCKED' : `LOCK -${h.dmg ?? 0}`, '#c4b5fd');
        this.electricImpact(h.x, h.y);
      } else {
        this.damageNumber(h.x, h.y, blocked ? 'BLOCKED' : `-${h.dmg ?? 0}`, blocked ? '#94a3b8' : '#fecaca');
      }
      // blocked on a raised shield: the barrier visibly takes the hit
      if (blocked && h.to) {
        const o = this.players.get(h.to);
        if (o && o.gring.visible) {
          this.tweens.killTweensOf(o.gring);
          o.gring.setScale(1.18);
          this.tweens.add({ targets: o.gring, scaleX: 1, scaleY: 1, duration: 180, ease: 'Quad.easeOut' });
        }
      }
      // damage direction arc for the victim (screen-edge red arc toward the shooter)
      const me = this.players.get(this.meId);
      if (h.to === this.meId && me && h.ox !== undefined && h.oy !== undefined) {
        const a = Math.atan2(h.oy - me.gfx.y, h.ox - me.gfx.x);
        const arc = this.add.graphics().setScrollFactor(0).setDepth(29);
        arc.lineStyle(5, 0xef4444, 0.9);
        arc.beginPath();
        arc.arc(480, 300, 210, a - 0.45, a + 0.45);
        arc.strokePath();
        this.tweens.add({ targets: arc, alpha: 0, duration: 600, onComplete: () => arc.destroy() });
      }
      if (h.by === this.meId) {
        this.hitmarker();
        sfx.hit();
        try { (navigator as any).vibrate?.(15); } catch { /* noop */ }
      }
      if (h.w === 'electric') sfx.zap(1.2 - Math.min(1, Math.hypot((this.players.get(this.meId)?.gfx.x ?? 0) - h.x, (this.players.get(this.meId)?.gfx.y ?? 0) - h.y) / 700));
    });
    room.onMessage('chip', (c: { x: number; y: number; kind: string }) => {
      if (!live()) return;
      // wall impacts: sparks off steel, dust puff off crumbling brick
      this.sparks.explode(6, c.x, c.y);
      if (c.kind === 'brick') this.dust.explode(4, c.x, c.y);
    });

    this.keep(room.state.bricks.onAdd((b: any, id: string) => {
      if (!live()) return;
      this.syncBrick(id, b.hp);
      this.keep(b.onChange(() => { if (live()) this.syncBrick(id, b.hp); }));
    }));
    room.onMessage('collect', (c: { name: string; kind: string; x: number; y: number }) => {
      if (!live()) return;
      sfx.pickup();
      const txt = c.kind === 'health' ? '+50 HP' : c.kind === 'ammo' ? 'AMMO FULL' : c.kind.toUpperCase() + '!';
      const col = c.kind === 'health' ? '#4ade80' : c.kind === 'ammo' ? '#fdba74'
        : c.kind === 'shield' ? '#38bdf8' : c.kind === 'speed' ? '#fde047'
        : c.kind === 'electric' ? '#c4b5fd' : '#facc15';
      const f = this.add.text(c.x, c.y - 24, `${c.name} ${txt}`, {
        fontFamily: MONO, fontSize: '14px', color: col,
      }).setOrigin(0.5).setDepth(8);
      f.setStroke('#000000', 3);
      this.tweens.add({
        targets: f, y: c.y - 64, alpha: 0, duration: 950, ease: 'Quad.easeOut',
        onComplete: () => f.destroy(),
      });
    });

    this.keep(room.state.pickups.onAdd((pk: any, id: string) => {
      if (!live()) return;
      this.pkDots.set(id, { x: pk.x, y: pk.y, kind: pk.kind, active: pk.active });
      const marker = this.buildPickup(pk.kind);
      marker.setPosition(pk.x, pk.y);
      marker.setVisible(pk.active);
      this.pickups.set(id, marker);
      this.keep(pk.onChange(() => {
        if (!live()) return;
        this.pkDots.set(id, { x: pk.x, y: pk.y, kind: pk.kind, active: pk.active });
        const was = marker.visible;
        marker.setVisible(pk.active);
        if (pk.active && !was) { // respawn pop (restart pulse after)
          this.tweens.killTweensOf(marker);
          marker.setScale(0);
          this.tweens.add({
            targets: marker, scaleX: 1, scaleY: 1, duration: 350, ease: 'Back.easeOut',
            onComplete: () => {
              this.tweens.add({ targets: marker, scaleX: 1.12, scaleY: 1.12, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
            },
          });
        }
      }));
      this.keep(pk.onRemove(() => {
        if (!live()) return;
        this.pkDots.delete(id);
        marker.destroy(true);
        this.pickups.delete(id);
      }));
    }));

    this.keep(room.state.players.onAdd((p: any, id: string) => {
      if (!live()) return;
      // mid-match arrivals/departures get a toast (skip the initial roster)
      if (Date.now() - this.arenaBorn > 4000 && id !== this.meId) {
        toast(this, `${p.name} joined the fight`, '#4ade80', 344);
      }
      const mine = id === this.meId;
      const idx = Math.min(8, this.players.size + 1); // squad number by join order
      const col = mine ? 0x22d3ee : foeColor(idx)[4];
      const glowCss = mine ? '#22d3ee' : foeColor(idx)[3];
      const sh = this.add.image(0, 11, 'shadow').setAlpha(0.8);
      const baseRing = this.add.image(0, 10, 'ring').setTint(col).setScale(0.62, 0.34).setAlpha(0.95);
      const gring = this.add.container(0, 0, [
        this.add.image(30, 0, 'guard').setAlpha(0.95),
      ]).setVisible(p.guard && p.alive); // frontal riot barrier, tracks aim
      const ring = this.add.image(0, 0, 'ring').setVisible(false);
      const ringB = this.add.image(0, 0, 'ring').setTint(0x38bdf8).setVisible(false);
      const bootL = this.add.image(-7, 8, 'boot');
      const bootR = this.add.image(7, 8, 'boot');
      const legs = this.add.container(0, 0, [bootL, bootR]);
      const body = this.add.image(0, 0, avatarTex(this, mine ? 'me' : 'foe', idx));
      // pinned to the centre, pivot derived from MUZZLE: the tip is MUZZLE from
      // the character at every angle, not just when aiming right
      // pinned to the centre, pivot derived from MUZZLE: the tip is MUZZLE from
      // the character at every angle, not just when aiming right
      // pinned to the centre, pivot derived from MUZZLE: the tip is MUZZLE from
      // the character at every angle, not just when aiming right
      const gun = this.add.image(GUN_REST_X, 0, 'gun').setScale(GUN_SCALE);
      gun.setOrigin(GUN_ORIGIN_X, 0.5);
      const label = this.add.text(-20, -36, p.name, { fontSize: '13px', fontStyle: '700', color: '#fff', fontFamily: COND });
      label.setStroke('#020617', 4);
      label.setShadow(0, 0, glowCss, 6, false, true);
      const gfx = this.add.container(p.x, p.y, [sh, baseRing, legs, gring, ring, ringB, body, gun, label]);
      this.players.set(id, {
        gfx, body, gun, label, ring, ringB, legs, bootL, bootR, stepPhase: Math.random() * 6,
        tx: p.x, ty: p.y, sx: p.x, sy: p.y, hp: p.hp, alive: p.alive,
        shield: p.shield || 0, shieldPts: p.shieldPts || 0, speedT: p.speedT || 0, slowT: p.slowT || 0,
        hist: [], col, gring, smoked: !!p.smoked,
      });
      if (!p.alive) body.setTint(0x666677);
      this.keep(p.onChange(() => {
        if (!live()) return;
        const o = this.players.get(id);
        if (!o) return;
        o.tx = p.x; o.ty = p.y;
        o.sx = p.x; o.sy = p.y;
        o.smoked = !!p.smoked;
        if (id !== this.meId) {
          // remote snapshot: respawns/teleports reset the buffer, else append
          const last = o.hist[o.hist.length - 1];
          if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 200) {
            o.hist = [{ t: this.time.now, x: p.x, y: p.y }];
            o.gfx.x = p.x; o.gfx.y = p.y;
          } else {
            o.hist.push({ t: this.time.now, x: p.x, y: p.y });
            if (o.hist.length > 8) o.hist.shift();
          }
        }
        o.shield = p.shield || 0;
        o.shieldPts = p.shieldPts || 0;
        o.speedT = p.speedT || 0;
        // electric gun swaps the whole held weapon to the coil rail
        const we = p.weapon === 'electric';
        if (we && o.gun.texture.key !== 'egun') o.gun.setTexture('egun');
        else if (!we && o.gun.texture.key === 'egun') o.gun.setTexture('gun');
        // shock status: lock the aura on while the arc is live
        const locked = (p.slowT || 0) > 0 && p.alive;
        o.slowT = p.slowT || 0;
        if (locked && !o.zap) this.zapAura(o);
        o.zap?.setVisible(locked);
        o.zap2?.setVisible(locked);
        o.gfx.setRotation(0);
        o.gun.setRotation(p.angle);
        this.setT('nl' + id, o.label, `${p.name} ${p.hp}${o.slowT > 0 ? ' ⛓' : o.speedT > 0 ? ' ⚡' : ''}${o.shieldPts > 0 ? ' 🛡' : ''}`);
        if (id === this.meId) {
          this.drawHp(p.hp, p.kills);
          this.drawAmmo(p);
          this.checkStreak(p.streak);
        }
        // kill-streak aura (2+): golden ring under hot players; blue ring while shielded
        o.ring.setVisible(p.streak >= 2 && p.alive);
        o.ringB.setVisible(p.shieldPts > 0 && p.alive);
        o.gring.setVisible(!!p.guard && p.alive); // raised shield bubble
        // fresh hit -> white flash + blood puff (+ hurt cue for self)
        if (p.hp < o.hp && p.alive) {
          o.body.setTintFill(0xffffff);
          this.blood.explode(6, o.gfx.x, o.gfx.y);
          if (id === this.meId) {
            sfx.hurt();
            try { (navigator as any).vibrate?.(45); } catch { /* noop */ }
          }
          this.time.delayedCall(60, () => {
            if (!o.body.active) return;
            o.body.clearTint();
            if (!p.alive) o.body.setTint(0x666677);
          });
        }
        // death -> burst + blood pool + fall over (+ shake for self)
        if (!p.alive && o.alive) {
          this.blood.explode(24, o.gfx.x, o.gfx.y);
          o.pool?.destroy(true);
          o.pool = this.add.image(o.gfx.x, o.gfx.y + 6, 'pool').setDepth(1);
          this.tweens.killTweensOf(o.body);
          this.tweens.add({ targets: o.body, angle: 90, duration: 350, ease: 'Quad.easeIn' });
          o.body.setTint(0x666677);
          o.gfx.setAlpha(0.55);
          if (id === this.meId) {
            this.cameras.main.shake(250, 0.008);
            sfx.death();
            try { (navigator as any).vibrate?.([60, 40, 60]); } catch { /* noop */ }
          }
        } else if (p.alive && !o.alive) {
          this.tweens.killTweensOf(o.body);
          o.body.setAngle(0);
          o.body.clearTint();
          o.gfx.setAlpha(1);
          const old = o.pool; o.pool = undefined;
          if (old) this.tweens.add({ targets: old, alpha: 0, duration: 900, onComplete: () => old.destroy() });
        }
        o.hp = p.hp; o.alive = p.alive;
      }));
      this.keep(p.onRemove(() => {
        if (!live()) return;
        const o = this.players.get(id);
        o?.gfx.destroy(true);
        // the shock aura runs two repeat:-1 tweens and Phaser never reclaims a
        // tween whose target was destroyed -- zapAura is entered once per
        // player, so its killTweensOf never got a chance to run. Two tweens per
        // shocked player who left, stepped every frame for the rest of the match
        if (o?.zap) this.tweens.killTweensOf(o.zap);
        if (o?.zap2) this.tweens.killTweensOf(o.zap2);
        this.players.delete(id);
        this.foeArcs.get(id)?.g.destroy(); // their arc must not outlive them
        this.foeArcs.delete(id);
        if (Date.now() - this.arenaBorn > 4000 && id !== this.meId && o) {
          toast(this, `${o.label.text.split(' ')[0]} left the fight`, '#94a3b8', 344);
        }
      }));
    }));

    this.keep(room.state.bullets.onAdd((b: any, id: string) => {
      if (!live()) return;
      const foe = b.ownerId !== this.meId;
      const bw = typeof b.weapon === 'string' ? b.weapon : 'pistol';
      const a0 = Math.atan2(b.vy, b.vx);
      // spawn at the RENDERED barrel (remotes lag 66ms behind server truth —
      // spawning at truth pops tracers out of thin air ahead of the gun)
      const own0 = this.players.get(b.ownerId);
      const sx = own0 ? own0.gfx.x + Math.cos(a0) * MUZZLE : b.x;
      const sy = own0 ? own0.gfx.y + Math.sin(a0) * MUZZLE : b.y;
      // The electric gun throws no bullet. Its shot is a live bolt: the server
      // still simulates a projectile (that is what carries the damage and the
      // lock, and it is what stops at bodies and walls), but on screen it is
      // current running from the shooter's muzzle out to the discharge tip --
      // a travelling slug on top of an arc read as two weapons firing at once.
      const isArc = bw === 'electric';
      const img = this.add.image(sx, sy, isArc ? 'zap' : 'bolt')
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(5);
      if (bw === 'laser') img.setTint(0x22d3ee); // cyan bolts, both sides
      else if (foe && !isArc) img.setTint(0xfb923c);
      img.setRotation(a0);
      // the arc tip is a soft charge head, never a round; laser head rides
      // inside its beam
      if (isArc) img.setScale(0.5);
      else img.setScale(bw === 'laser' ? 1.4 : 1.0, 1.0);
      img.setAlpha(0); // fade in: no spawn pop, then dead-reckoning takes over
      this.tweens.add({ targets: img, alpha: isArc ? 0.95 : 1, duration: 90 });
      this.bullets.set(id, { img, vx: b.vx, vy: b.vy, arc: isArc ? b.ownerId : undefined });
      // muzzle flash + recoil at the shooter's barrel — foes only.
      // (own shots already flashed + recoiled at fire time; the echo would double it)
      const own = this.players.get(b.ownerId);
      if (own && foe) {
        const a = Math.atan2(b.vy, b.vx);
        const mx = own.gfx.x + Math.cos(a) * MUZZLE, my = own.gfx.y + Math.sin(a) * MUZZLE;
        this.flash(mx, my, a, false, bw === 'laser' ? 0x22d3ee : bw === 'electric' ? 0xc084fc : 0);
        this.recoil(own.gun);
        // enemy lasers burn their beam from the visible barrel too
        if (bw === 'laser') this.beam(mx, my, a, b.ownerId);
        if (bw === 'electric') {
          this.arcBolt(mx, my, a, b.ownerId);
          this.foeArc(b.ownerId, 0.3); // hold the stream open across the burst
        }
      }
      // distant guns stay audible: correct weapon, volume falls off with range.
      // throttled per shooter so a shotgun volley (6 pellets, 1 tick) booms once.
      if (foe) {
        const nowMs = this.time.now;
        if (nowMs - (this.shotSfxAt.get(b.ownerId) || 0) > 130) {
          this.shotSfxAt.set(b.ownerId, nowMs);
          const me = this.players.get(this.meId);
          const d = me ? Math.hypot(me.gfx.x - b.x, me.gfx.y - b.y) : 500;
          sfx.shoot(typeof b.weapon === 'string' ? b.weapon : 'pistol', 1.1 - d / 850);
        }
      }
      this.keep(b.onChange(() => {
        if (!live()) return;
        const o = this.bullets.get(id);
        if (!o) return;
        // authoritative tick correction (small — extrapolation covers the gaps)
        o.img.setPosition(b.x, b.y);
        o.vx = b.vx; o.vy = b.vy;
        if (!o.arc) o.img.setRotation(Math.atan2(b.vy, b.vx)); // the arc tip is a round glow: no spin
      }));
      this.keep(b.onRemove(() => { if (!live()) return; img.destroy(); this.bullets.delete(id); }));
    }));

    this.keep(room.state.throws.onAdd((th: any, id: string) => {
      if (!live()) return;
      const cols: Record<string, number> = { grenade: 0x9ca3af, smoke: 0xd1d5db, molly: 0xfb923c };
      const img = this.add.image(th.x, th.y, 'dot')
        .setTint(cols[th.kind] ?? 0xffffff).setDepth(5)
        .setScale(th.kind === 'grenade' ? 1.5 : 1.1);
      this.throws.set(id, { img, vx: th.vx, vy: th.vy });
      if (th.kind === 'grenade') {
        this.tweens.add({ targets: img, alpha: 0.35, duration: 180, yoyo: true, repeat: -1 });
      }
      this.keep(th.onChange(() => {
        if (!live()) return;
        const o = this.throws.get(id);
        if (!o) return;
        o.img.setPosition(th.x, th.y);
        o.vx = th.vx; o.vy = th.vy;
      }));
      this.keep(th.onRemove(() => {
        if (!live()) return;
        const o = this.throws.get(id);
        if (o) this.tweens.killTweensOf(o.img);
        o?.img.destroy();
        this.throws.delete(id);
      }));
    }));

    this.keep(room.state.clouds.onAdd((cl: any, id: string) => {
      if (!live()) return;
      const c = this.add.container(cl.x, cl.y).setDepth(4);
      const parts = [];
      const timers = [];
      const R = cl.r || 100;
      if (cl.kind === 'smoke') {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2 + Math.random() * 0.5;
          const dist = R * (0.25 + Math.random() * 0.5);
          const puff = this.add.image(0, 0, 'puff')
            .setTint(Math.random() < 0.5 ? 0xe5e5e5 : 0x9ca3af)
            .setAlpha(0.85).setScale(0.4);
          parts.push(puff); c.add(puff);
          this.tweens.add({
            targets: puff, x: Math.cos(a) * dist, y: Math.sin(a) * dist * 0.8 - R * 0.25,
            scaleX: 1.6 + Math.random() * 1.4, scaleY: 1.6 + Math.random() * 1.4,
            duration: 900 + Math.random() * 700, ease: 'Quad.easeOut',
          });
          const rise = 8 + Math.random() * 10;
          this.tweens.add({
            targets: puff, y: '-=' + rise, angle: (Math.random() - 0.5) * 40,
            duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 900,
          });
        }
      } else {
        // white-hot bed + breathing halo + spreading char
        const bed = this.add.image(0, 0, 'glow').setTint(0xfbbf24).setAlpha(0.55)
          .setScale(R / 9, R / 14);
        parts.push(bed); c.add(bed);
        this.tweens.add({
          targets: bed, alpha: 0.35, scaleX: R / 10, scaleY: R / 16,
          duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
        const stain = this.add.image(0, 4, 'scorch').setAlpha(0.85).setScale(R / 90);
        parts.push(stain); c.add(stain);
        this.tweens.add({
          targets: stain, scaleX: R / 50, scaleY: R / 50,
          duration: 4000, ease: 'Quad.easeOut',
        });
        const halo = this.add.image(0, 0, 'glow').setTint(0xea580c).setAlpha(0.22)
          .setScale(R / 5, R / 8);
        parts.push(halo); c.add(halo);
        this.tweens.add({
          targets: halo, alpha: 0.12, scaleX: R / 4.4, scaleY: R / 7,
          duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
        // base tongues: 8 tall flames with a slow sway (emitters do the licking)
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * Math.PI * 2;
          const dist = Math.random() * R * 0.55;
          const tall = 1.3 + (1 - dist / (R * 0.6)) * 0.8 + Math.random() * 0.3;
          const f = this.add.image(Math.cos(a) * dist, Math.sin(a) * dist * 0.7, 'flame')
            .setScale(tall * 0.9, tall);
          if (Math.random() < 0.4) f.setTint(0xffe08a);
          parts.push(f); c.add(f);
          this.tweens.add({
            targets: f, angle: (Math.random() - 0.5) * 30,
            duration: 200 + Math.random() * 200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
          });
        }
        // live flame emitters: constant birth, rise, shrink = real licking fire
        const disc = (r: number) => ({
          getRandomPoint: (pt: { x: number; y: number }) => {
            const a = Math.random() * Math.PI * 2;
            const d = Math.sqrt(Math.random()) * r;
            pt.x = Math.cos(a) * d; pt.y = Math.sin(a) * d;
            return pt;
          },
        });
        const burn = this.add.particles(0, 4, 'flame', {
          speedY: { min: -95, max: -45 }, speedX: { min: -14, max: 14 },
          lifespan: { min: 350, max: 550 }, frequency: 45,
          scale: { start: 1.5, end: 0.15 }, alpha: { start: 1, end: 0 },
          tint: 0xffd97a, blendMode: 'ADD',
          emitZone: new Phaser.GameObjects.Particles.Zones.RandomZone(disc(R * 0.55) as any),
        });
        parts.push(burn); c.add(burn);
        const burnDeep = this.add.particles(0, 4, 'flame', {
          speedY: { min: -70, max: -35 }, speedX: { min: -10, max: 10 },
          lifespan: { min: 300, max: 450 }, frequency: 70,
          scale: { start: 1.1, end: 0.1 }, alpha: { start: 0.95, end: 0 },
          tint: 0xea580c, blendMode: 'ADD',
          emitZone: new Phaser.GameObjects.Particles.Zones.RandomZone(disc(R * 0.5) as any),
        });
        parts.push(burnDeep); c.add(burnDeep);
        // smoke stack emitter (replaces per-tick puff spawns)
        const stack = this.add.particles(0, -10, 'puff', {
          speedY: { min: -50, max: -25 }, speedX: { min: -8, max: 8 },
          lifespan: 2400, frequency: 260,
          scale: { start: 0.7, end: 2.4 }, alpha: { start: 0.5, end: 0 },
          tint: 0x44403c,
        });
        parts.push(stack); c.add(stack);
        // endless ember fountain while the patch lives
        const fountain = this.time.addEvent({
          delay: 380, loop: true,
          callback: () => {
            if (!c.active) return;
            this.sparks.explode(2, cl.x + (Math.random() - 0.5) * R, cl.y + (Math.random() - 0.5) * R * 0.6);
          },
        });
        timers.push(fountain);
        // ember burst on ignite
        for (let i = 0; i < 6; i++) {
          const e = this.add.image(0, 0, 'dot').setTint(0xfdba74).setScale(1.2);
          parts.push(e); c.add(e);
          const ea = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
          this.tweens.add({
            targets: e, x: Math.cos(ea) * (40 + Math.random() * 60), y: Math.sin(ea) * (50 + Math.random() * 70),
            alpha: 0, duration: 700 + Math.random() * 500, ease: 'Quad.easeOut',
            onComplete: () => e.destroy(),
          });
        }
      }
      this.clouds.set(id, { c, parts, timers });
      sfx.ignite();
      this.keep(cl.onChange(() => {
        if (!live()) return;
        const o = this.clouds.get(id);
        if (o) o.c.setAlpha(cl.t < 1.5 ? Math.max(0, cl.t / 1.5) : 1);
      }));
      this.keep(cl.onRemove(() => {
        if (!live()) return;
        const o = this.clouds.get(id);
        if (o) {
          this.tweens.killTweensOf(o.c);
          o.parts.forEach((pp) => this.tweens.killTweensOf(pp));
          o.timers.forEach((tm) => tm.remove(false));
          o.c.destroy(true);
        }
        this.clouds.delete(id);
      }));
    }));

    room.onMessage('boom', (m: { x?: number; y?: number; r?: number }) => {
      if (!live()) return;
      const x = m?.x || 0, y = m?.y || 0, r = m?.r || 100;
      const big = r >= 100; // grenades stage the full show; landings pop small
      // 1) white flash
      const f = this.add.image(x, y, 'muzzle').setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(7).setScale(Math.max(1.5, r / 26));
      this.tweens.add({ targets: f, alpha: 0, duration: big ? 120 : 350, onComplete: () => f.destroy() });
      if (big) {
        // 2) expanding fireball
        const ball = this.add.image(x, y, 'glow').setTint(0xea580c)
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(7).setScale(1);
        this.tweens.add({
          targets: ball, scaleX: r / 12, scaleY: r / 12, alpha: 0,
          duration: 320, ease: 'Quad.easeOut', onComplete: () => ball.destroy(),
        });
        // 3) soot column: puffs kick up and hang
        for (let i = 0; i < 5; i++) {
          const p = this.add.image(x + (Math.random() - 0.5) * r * 0.6, y, 'puff')
            .setTint(0x57534e).setAlpha(0.9).setDepth(6).setScale(0.5);
          this.tweens.add({
            targets: p, y: y - 40 - Math.random() * 70, x: x + (Math.random() - 0.5) * 50,
            scaleX: 1.4 + Math.random(), scaleY: 1.4 + Math.random(), alpha: 0.25,
            duration: 1100 + i * 160 + Math.random() * 300, ease: 'Quad.easeOut',
            onComplete: () => p.destroy(),
          });
        }
        // 4) scorch stain that fades over seconds
        const s = this.add.image(x, y + 6, 'scorch').setDepth(1).setAlpha(0.9)
          .setScale(Math.max(0.8, r / 90));
        this.tweens.add({ targets: s, alpha: 0, duration: 8000, onComplete: () => s.destroy() });
      }
      this.sparks.explode(Math.min(26, 8 + Math.round(r / 10)), x, y);
      this.dust.explode(8, x, y);
      const me = this.players.get(this.meId);
      const d = me ? Math.hypot(me.gfx.x - x, me.gfx.y - y) : 400;
      if (d < 550) this.cameras.main.shake(160, 0.005 * Math.max(0, 1 - d / 650));
      sfx.boom(Math.max(0.15, 1 - d / 900));
    });

    // server gone mid-match: don't freeze silently, route back to menu
    room.onLeave(() => {
      if (!live()) return;
      this.leaveToMenu();
    });
    room.onError(() => {
      if (!live()) return;
      this.leaveToMenu();
    });
    // latency probe for the HUD ping meter (mod-1M keeps ints 32-bit for the codec)
    room.onMessage('pong', (m: { t?: number }) => {
      if (!live()) return;
      const now = Date.now() % 1000000;
      const sent = typeof m?.t === 'number' ? m.t : now;
      const rtt = (now - sent + 1000000) % 1000000;
      this.setT('ping', this.pingText, `PING ${Math.max(0, Math.round(rtt))}`,
        rtt < 100 ? '#4ade80' : rtt < 200 ? '#facc15' : '#ef4444');
    });
    this.pingTimer?.remove();
    this.pingTimer = this.time.addEvent({
      delay: 2000, loop: true,
      callback: () => { try { room.send('ping', { t: Date.now() % 1000000 }); } catch { /* dying */ } },
    });
  }

  private leaveToMenu() {
    if (this.backToLobby) return;
    this.backToLobby = true;
    this.firing = false;
    this.arcOffNow();
    Session.room = null;
    try { toast(this, 'connection lost — back to menu', '#f87171', 344); } catch { /* scene dying */ }
    this.scene.start('menu');
  }

  // Draw the timer pill at exactly the width its content needs, always
  // centred on 480 and always on the same 32px row as the ammo card.
  private layoutClock(withStars: boolean) {
    if (this.clockStars === (withStars ? 1 : 0)) return;
    this.clockStars = withStars ? 1 : 0;
    const w = withStars ? 226 : 132; // stars need room; the bare clock does not
    const x = 480 - w / 2;
    const g = this.clockCardG;
    g.clear();
    g.fillStyle(0x020617, 0.72);
    g.fillRoundedRect(x, 2, w, 32, 8);
    g.lineStyle(2, 0xfacc15, 0.55);
    g.strokeRoundedRect(x, 2, w, 32, 8);
    this.liveDot.setPosition(x + 20, 18);
    this.clockText?.setPosition(x + (withStars ? 66 : 74), 18);
    this.wantedText?.setPosition(x + w - 48, 18);
  }

  // one status segment: label '' hides it, frac paints the mini bar
  private status(i: number, label: string, col: number, frac: number) {
    const s = this.statusSegs[i];
    if (!s) return;
    const on = label !== '';
    s.bg.setVisible(on);
    s.fill.setVisible(on);
    s.tx.setVisible(on);
    if (!on) return;
    this.setT('st' + i, s.tx, label, '#' + col.toString(16).padStart(6, '0'));
    s.bg.setStrokeStyle(1.5, col, 0.8);
    s.fill.setFillStyle(col, 0.85);
    s.fill.displayWidth = Math.max(1, 70 * Math.max(0, Math.min(1, frac)));
  }

  private drawAmmo(p: any) {
    // settle any in-flight switch FIRST: it is the only thing that may
    // override the server's truth about p.weapon
    this.settlePending(p);
    const slot = SLOTS.find((s) => s.id === this.activeSlot);
    // non-gun slots render their own readout in the same strip
    if (slot && slot.kind !== 'gun') {
      this.drawItemStrip(slot, p);
      this.drawLoadout(p);
      return;
    }
    const W = WEAPONS[p.weapon] || WEAPONS.pistol;
    const colors: Record<string, string> = {
      pistol: '#94a3b8', rifle: '#facc15', shotgun: '#fb923c',
      sniper: '#c084fc', laser: '#22d3ee', electric: '#a855f7',
    };
    this.ammoIcon.setVisible(true);
    // while a switch is in flight, name the gun we are switching TO and admit
    // it: the old name beside the new slot highlight is what read as broken
    if (this.pendingSlot) {
      this.ammoIcon.setTexture(this.pendingSlot === 'electric' ? 'egun' : 'gun');
      this.setT('ammoT', this.ammoTitle, this.pendingSlot.toUpperCase(), colors[this.pendingSlot] || '#94a3b8');
      this.setT('ammoC', this.ammoCount, '···', colors[this.pendingSlot] || '#94a3b8');
      this.setT('rld', this.reloadTx, 'SWITCHING…', '#94a3b8');
      this.reloadTx.setAlpha(0.8);
      this.reloadBar.displayWidth = 1;
      this.drawLoadout(p);
      return;
    }
    this.ammoIcon.setTexture(p.weapon === 'electric' ? 'egun' : 'gun');
    this.setT('ammoT', this.ammoTitle, p.weapon.toUpperCase(), colors[p.weapon] || '#94a3b8');
    const left = p.weapon === 'rifle' ? p.ammo : p.weapon === 'shotgun' ? p.sammo
      : p.weapon === 'sniper' ? p.nammo : p.weapon === 'laser' ? p.lammo
      : p.weapon === 'electric' ? p.eammo : p.pammo;
    if (p.reloading) {
      this.setT('ammoC', this.ammoCount, '…', '#fb923c');
      const total = p.weapon === 'rifle' ? 2 : W.reload;
      this.reloadBar.displayWidth = Math.max(1, 140 * (1 - Math.max(0, p.reloadLeft) / total));
    } else {
      this.reloadBar.displayWidth = 1;
      const low = left > 0 && left / W.clip <= 0.25;
      this.setT('ammoC', this.ammoCount,
        low ? `LOW ${left}/${W.clip}` : `${left}/${W.clip}`,
        left === 0 ? '#ef4444' : low ? '#fb923c' : '#ffffff');
    }
    // the reload affordance lives inside the ammo strip, not as its own button
    const needReload = !p.reloading && left < W.clip;
    const dry = left <= 0;
    this.setT('rld', this.reloadTx,
      p.reloading ? 'RELOADING…' : dry ? '⟳ R RELOAD' : needReload ? '⟳ RELOAD' : '');
    this.reloadTx.setColor(dry ? '#ef4444' : '#facc15');
    this.reloadTx.setAlpha(p.reloading ? 0.6 : needReload ? 1 : 0.35);
  }

  // throwable / shield readout: same strip, different payload
  private drawItemStrip(slot: Slot, p: any) {
    this.ammoIcon.setVisible(false);
    if (slot.kind === 'shield') {
      const up = !!p.guard;
      this.setT('ammoT', this.ammoTitle, 'RIOT SHIELD', up ? '#4ade80' : '#94a3b8');
      this.setT('ammoC', this.ammoCount, up ? 'UP' : 'DOWN', up ? '#4ade80' : '#cbd5e1');
      this.setT('rld', this.reloadTx, up ? 'BLOCKS ALL BULLETS' : 'KNIFE ONLY',
        up ? '#4ade80' : '#94a3b8');
      this.reloadTx.setAlpha(0.9);
      this.reloadBar.displayWidth = 1;
      return;
    }
    const n = slot.id === 'grenade' ? (p.grenades || 0)
      : slot.id === 'molly' ? (p.mollies || 0) : (p.smokes || 0);
    this.setT('ammoT', this.ammoTitle, (ORD_ICON[slot.id] || '') + ' ' + slot.id.toUpperCase(),
      n > 0 ? '#e2e8f0' : '#64748b');
    this.setT('ammoC', this.ammoCount, 'x' + n, n > 0 ? '#ffffff' : '#ef4444');
    this.setT('rld', this.reloadTx, n > 0 ? 'TAP SLOT / G TO THROW' : 'NONE LEFT - RESTOCK AT PADS',
      n > 0 ? '#facc15' : '#ef4444');
    this.reloadTx.setAlpha(1);
    this.reloadBar.displayWidth = 1;
  }

  private drawLoadout(p: any) {
    const cols: Record<string, string> = {
      pistol: '#94a3b8', rifle: '#facc15', shotgun: '#fb923c', sniper: '#c084fc',
      laser: '#22d3ee', electric: '#a855f7', grenade: '#e2e8f0', smoke: '#e2e8f0',
      molly: '#fdba74', shield: '#4ade80',
    };
    SLOTS.forEach((slot, i) => {
      const s = this.loadSlots[i];
      if (!s) return;
      const owned = slot.kind === 'gun' ? (slot.id === 'pistol' || p[slot.id] === true) : true;
      const held = slot.id === this.activeSlot; // the switchable item in hand
      const n = slot.kind === 'ord'
        ? (slot.id === 'grenade' ? (p.grenades || 0)
          : slot.id === 'molly' ? (p.mollies || 0) : (p.smokes || 0))
        : -1;
      const label = slot.kind === 'ord' ? `${slot.key}\n${slot.nm}${n}` : `${slot.key}\n${slot.nm}`;
      this.setT('load' + i, s.tx, label,
        held ? '#ffffff' : n === 0 ? '#475569' : owned ? cols[slot.id] : '#334155');
      if (held) {
        // the shield slot glows green while the stance is actually up
        s.bg.setFillStyle(0x0e2a3a, 0.95)
          .setStrokeStyle(2.5, slot.kind === 'shield' && p.guard ? 0x4ade80 : 0x22d3ee, 1);
      } else if (owned) {
        s.bg.setFillStyle(0x020617, 0.78).setStrokeStyle(2, 0x475569, 0.95);
      } else {
        s.bg.setFillStyle(0x020617, 0.5).setStrokeStyle(1.5, 0x1e293b, 0.8);
      }
    });
  }

  private lastStreak = 0;
  private checkStreak(streak: number) {
    if (streak >= 2 && streak > this.lastStreak) {
      const names = ['DOUBLE KILL!', 'TRIPLE KILL!', 'RAMPAGE!', 'UNSTOPPABLE!'];
      const txt = names[Math.min(streak - 2, names.length - 1)];
      const b = displayText(this, 480, 310, txt, 36, '#facc15', '#facc15', 30, true);
      b.setScale(1.5).setAlpha(0);
      this.tweens.add({
        targets: b, scaleX: 1, scaleY: 1, alpha: 1, duration: 220, ease: 'Back.easeOut',
        onComplete: () => {
          this.time.delayedCall(800, () => {
            this.tweens.add({ targets: b, alpha: 0, duration: 300, onComplete: () => b.destroy() });
          });
        },
      });
      sfx.streak(streak);
    }
    this.lastStreak = streak;
  }

  private drawHp(hp: number, kills: number) {    const from = this.dispHp;
    this.dispHp = hp;
    this.setT('hp', this.hpLabel, `HP ${hp} · ${kills} K`);
    // main bar snaps fast, ghost trails behind (classic damage feel)
    // Main bar snaps fast, ghost trails behind (classic damage feel).
    // The proxies are held on the instance so killTweensOf can actually match
    // them: the tweens target these objects, NOT hpFill/hpGhost, so killing
    // those was a no-op. That left ~20 live tweens (60 allocations/second at
    // 30Hz) all writing the ghost bar with different captured values, so it
    // jittered and stalled instead of trailing, and a stale onComplete could
    // yank it backwards.
    this.tweens.killTweensOf(this.hpProxy);
    this.hpProxy.v = from;
    this.tweens.add({
      targets: this.hpProxy, v: hp, duration: 180, ease: 'Quad.easeOut',
      onUpdate: () => this.paintHp(this.hpProxy.v, this.ghostHp),
    });
    this.tweens.killTweensOf(this.hpGhostProxy);
    this.hpGhostProxy.v = this.ghostHp;
    this.tweens.add({
      targets: this.hpGhostProxy, v: hp, duration: 650, delay: hp < this.ghostHp ? 180 : 0, ease: 'Quad.easeOut',
      onUpdate: () => { this.ghostHp = this.hpGhostProxy.v; this.paintHp(this.dispHp, this.hpGhostProxy.v); },
      onComplete: () => { this.ghostHp = hp; },
    });
    // damage feedback: red edge flash when hp drops
    if (hp < from) {
      this.tweens.killTweensOf(this.dmgVin);
      this.dmgVin.setAlpha(0.5);
      this.tweens.add({ targets: this.dmgVin, alpha: 0, duration: 380 });
    }
    // low-hp distress pulse on the frame
    const low = hp <= 30 && hp > 0;
    if (low && !this.lowPulse) {
      this.lowPulse = this.tweens.add({
        targets: this.hpFrame, alpha: { from: 1, to: 0.45 },
        duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    } else if (!low && this.lowPulse) {
      this.lowPulse.stop();
      this.lowPulse = null;
      this.hpFrame.setAlpha(1);
    }
  }

  private hpColor(pct: number) {
    return pct > 0.55 ? 0x22c55e : pct > 0.25 ? 0xeab308 : 0xef4444;
  }

  private paintHp(main: number, ghost: number) {
    const pct = Math.max(0, Math.min(1, main / 100));
    this.hpFill.displayWidth = Math.max(1, 228 * pct);
    this.hpFill.setFillStyle(this.hpColor(pct));
    const gpct = Math.max(0, Math.min(1, ghost / 100));
    this.hpGhost.displayWidth = Math.max(1, 228 * gpct);
  }

  private drawMinimap() {
    const g = this.minimap;
    if (!g) return;
    const s = 112 / W, x0 = 838, y0 = 442, h = H * s;
    const dot = (rc: { x: number; y: number; w: number; h: number }) =>
      g.fillRect(x0 + rc.x * s, y0 + rc.y * s, Math.max(1, rc.w * s), Math.max(1, rc.h * s));
    g.clear();
    g.fillStyle(0x020617, 0.72);
    g.fillRect(x0, y0, 112, h);
    g.fillStyle(0x7dd3fc, 0.5); // rivers
    for (const rc of WATER) dot(rc);
    g.fillStyle(0xcbd5e1, 0.75); // steel
    for (const rc of STEEL) dot(rc);
    g.fillStyle(0xc65a1e, 0.85); // standing bricks
    BRICKS.forEach((rc, i) => {
      if ((this.brickHp.get(`br_${i}`) ?? BRICK_HP) > 0) dot(rc);
    });
    g.fillStyle(0x22c55e, 0.35); // forest
    for (const rc of BUSH) dot(rc);
    this.pkDots.forEach((pk) => { // live pickups
      if (!pk.active) return;
      const cols: Record<string, number> = {
        health: 0x4ade80, rifle: 0xfacc15, ammo: 0xfdba74,
        shotgun: 0xfb923c, sniper: 0xc084fc, laser: 0x22d3ee, electric: 0xa855f7,
        shield: 0x38bdf8, speed: 0xfde047,
        grenade: 0x9ca3af, smoke: 0xd1d5db, molly: 0xf97316,
      };
      g.fillStyle(cols[pk.kind] ?? 0xffffff, 1);
      g.fillCircle(x0 + pk.x * s, y0 + pk.y * s, 1.8);
    });
    this.players.forEach((o, id) => {
      if (id !== this.meId && o.smoked) return; // smoke hides foes from the map
      const px = x0 + o.gfx.x * s, py = y0 + o.gfx.y * s;
      if (!o.alive) {
        g.fillStyle(0x475569, 1);
        g.fillCircle(px, py, 2.6);
      } else {
        // squad blip: facing wedge in the player's own color
        const a = o.gun.rotation;
        const dxm = Math.cos(a), dym = Math.sin(a);
        g.fillStyle(id === this.meId ? 0x22d3ee : o.col, 1);
        g.fillTriangle(
          px + dxm * 4.6, py + dym * 4.6,
          px - dym * 2.6 - dxm * 2.4, py + dxm * 2.6 - dym * 2.4,
          px + dym * 2.6 - dxm * 2.4, py - dxm * 2.6 - dym * 2.4,
        );
      }
    });
    g.lineStyle(2.5, 0x22d3ee, 0.8);
    g.strokeRect(x0, y0, 112, h);
  }

  private buildPickup(kind: string) {
    let inner: Phaser.GameObjects.GameObject[];
    if (kind === 'health') {
      const glow = this.add.image(0, 0, 'glow').setTint(0x22c55e).setAlpha(0.5);
      const h1 = this.add.rectangle(0, 0, 22, 8, 0x22c55e).setStrokeStyle(1.5, 0x052e16, 0.9);
      const h2 = this.add.rectangle(0, 0, 8, 22, 0x22c55e).setStrokeStyle(1.5, 0x052e16, 0.9);
      inner = [glow, h1, h2];
    } else if (kind === 'ammo') {
      const box = this.add.rectangle(0, 0, 20, 14, 0xeab308).setStrokeStyle(2.5, 0x92400e);
      inner = [box];
    } else if (kind === 'grenade' || kind === 'smoke' || kind === 'molly') {
      // ordnance: chunky icon + name tag (auto-collect on walk-over)
      const cols: Record<string, number> = { grenade: 0x4b5563, smoke: 0x9ca3af, molly: 0xea580c };
      const names: Record<string, string> = { grenade: 'GRENADES', smoke: 'SMOKE', molly: 'MOLLY' };
      const dot = this.add.image(0, 2, 'dot').setTint(cols[kind] ?? 0xffffff).setScale(2.2);
      const ring = this.add.image(0, 2, 'ring').setScale(0.55).setTint(cols[kind] ?? 0xffffff);
      const tag = this.add.text(0, -28, names[kind] ?? kind.toUpperCase(), {
        fontFamily: COND, fontSize: '12px', fontStyle: '700', color: '#fdba74',
      }).setOrigin(0.5);
      tag.setStroke('#020617', 3);
      inner = [ring, dot, tag];
    } else { // rifle / shotgun / sniper / laser / electric: gold ring + tinted weapon + name tag
      const tints: Record<string, number> = {
        rifle: 0xffffff, shotgun: 0xfb923c, sniper: 0xc084fc, laser: 0x22d3ee, electric: 0xa855f7,
      };
      const ring = this.add.image(0, 0, 'ring').setScale(0.85);
      const gun = this.add.image(0, 0, kind === 'electric' ? 'egun' : 'gun')
        .setScale(1.0).setTint(kind === 'electric' ? 0xffffff : tints[kind] ?? 0xffffff);
      const tag = this.add.text(0, -30, kind.toUpperCase(), {
        fontFamily: COND, fontSize: '12px', fontStyle: '700', color: '#facc15',
      }).setOrigin(0.5);
      tag.setStroke('#020617', 3);
      inner = [ring, gun, tag];
    }
    if (kind === 'shield' || kind === 'speed') {
      const ring = this.add.image(0, 0, 'ring').setScale(0.8)
        .setTint(kind === 'shield' ? 0x38bdf8 : 0xfde047);
      const dot = this.add.image(0, 0, 'dot').setScale(1.9)
        .setTint(kind === 'shield' ? 0x38bdf8 : 0xfde047);
      inner = [ring, dot];
    }
    const c = this.add.container(0, 0, inner);
    this.tweens.add({ targets: c, scaleX: 1.12, scaleY: 1.12, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    return c;
  }

  private refreshGrabPrompt() {
    const st: any = (Session.room as any)?.state;
    const me = this.players.get(this.meId);
    let kind: string | null = null;
    if (st && me && st.phase === 'playing') {
      const mine = st.players.get(this.meId);
      st.pickups.forEach((pk: any) => {
        if (kind || !pk.active) return;
        if (pk.kind !== 'rifle' && pk.kind !== 'shotgun' && pk.kind !== 'sniper'
          && pk.kind !== 'laser' && pk.kind !== 'electric') return;
        if (mine?.[pk.kind] === true) return; // already own it
        const dx = me.gfx.x - pk.x, dy = me.gfx.y - pk.y;
        if (dx * dx + dy * dy < 70 * 70) kind = pk.kind;
      });
    }
    if (!this.grabBtn) return;
    this.grabBtn.c.setVisible(kind !== null);
    if (kind !== null) {
      const k: string = kind;
      this.setT('grab', this.grabBtn.label, `Ⓔ PICK UP ${k.toUpperCase()}`);
      this.grabBtn.c.setAlpha(0.7 + 0.3 * Math.sin(this.time.now / 180));
    }
  }

  private drawScore() {
    const st: any = (Session.room as any)?.state;
    if (!st) return;
    // urgency clock: gold -> orange under 30s -> pulsing red under 10s
    const t = Math.max(0, Math.ceil(st.timeLeft || 0));
    this.setT('clock', this.clockText, `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`,
      t <= 10 ? '#ef4444' : t <= 30 ? '#fb923c' : '#facc15');
    this.clockText.setScale(t <= 10 ? 1.18 : 1);
    // ranked ticker: #rank name K/D + kill-target race line
    const rows: Array<{ name: string; kills: number; deaths: number; damage: number; id: string }> = [];
    st.players.forEach((p: any, id: string) => rows.push({
      name: p.name, kills: p.kills || 0, deaths: p.deaths || 0, damage: p.damage || 0, id,
    }));
    rows.sort((a, b) => b.kills - a.kills || b.damage - a.damage);
    const target = st.killTarget || 15;
    const lead = rows[0];
    // mini ticker: leaders only. TAB holds the full board — no need to keep
    // eight rows of standings burned into the corner all match
    this.setT('score', this.scoreText, rows.slice(0, 2)
      .map((r, i) => `#${i + 1} ${r.name} ${r.kills}K/${r.deaths}D`).join('\n'));
    this.setT('round', this.roundText, lead && lead.kills > 0
      ? `FIRST TO ${target} · ${lead.name} ${lead.kills}K`
      : `FIRST TO ${target} KILLS`);
    let myCash = 0, myStreak = 0;
    st.players.forEach((p: any, id: string) => {
      if (id === this.meId) { myCash = p.cash || 0; myStreak = p.streak || 0; }
    });
    this.setT('cash', this.cashText, '$' + myCash.toLocaleString('en-US'));
    // one status line for every active effect (shield / haste / electric lock)
    const mine = st.players.get(this.meId);
    const pts = mine?.shieldPts || 0;
    const haste = mine?.speedT || 0;
    const lock = mine?.slowT || 0;
    this.status(0, pts > 0 ? `🛡 ${Math.ceil(pts)}` : '', 0x38bdf8, pts > 0 ? pts / 100 : 0);
    this.status(1, haste > 0 ? `⚡ ${haste.toFixed(1)}s` : '', 0xfde047, haste > 0 ? haste / 8 : 0);
    this.status(2, lock > 0 ? `⛓ ${lock.toFixed(1)}s` : '', 0xa855f7, lock > 0 ? lock / 2.5 : 0);
    // electric lock: violet edge wash while it burns, hard pulse on a fresh arc
    if (lock > 0) {
      if (lock > this.prevSlow + 0.4) {
        this.tweens.killTweensOf(this.zkVin);
        this.zkVin.setAlpha(0.6);
        this.tweens.add({ targets: this.zkVin, alpha: 0.18, duration: 260, yoyo: true, repeat: 1 });
        try { (navigator as any).vibrate?.([25, 30, 25]); } catch { /* noop */ }
      }
      if (lock > 0.4) this.zkVin.setAlpha(0.1 + 0.07 * Math.sin(this.time.now / 90));
    } else {
      this.zkVin.setAlpha(0);
    }
    this.prevSlow = lock;
    // GTA wanted level from your streak (cap 5)
    const stars = Math.min(5, myStreak);
    this.setT('want', this.wantedText, stars > 0 ? '★'.repeat(stars) + '☆'.repeat(5 - stars) : '');
    this.layoutClock(stars > 0);
    if (myStreak > this.prevStreak && stars > 0) {
      this.wantedText.setScale(1.6);
      this.tweens.add({ targets: this.wantedText, scaleX: 1, scaleY: 1, duration: 300, ease: 'Back.easeOut' });
    }
    this.prevStreak = myStreak;
    // Throttled: drawBoard() destroys and re-mints the whole board, and this
    // runs on every 30Hz patch. Holding TAB open rebuilt ~30 canvas-backed Text
    // objects per tick (text measure + raster + texture upload) and collapsed
    // the framerate. 4Hz is plenty for a standings list.
    if (this.boardVisible && this.time.now - this.boardAt > 250) {
      this.boardAt = this.time.now;
      this.drawBoard();
    }
  }

  private showCountdown(n: number) {
    if (n === this.lastCd) return;
    this.lastCd = n;
    this.cdBanner?.destroy(true);
    this.cdBanner = displayText(this, 480, 300, String(Math.max(1, n)), 96, '#ffffff', '#22d3ee', 30, true);
    this.cdBanner.setScale(1.6).setAlpha(0);
    this.tweens.add({ targets: this.cdBanner, scaleX: 1, scaleY: 1, alpha: 1, duration: 280, ease: 'Quad.easeOut' });
    sfx.count(false);
    try { (navigator as any).vibrate?.(30); } catch { /* noop */ }
  }

  private showFight() {
    this.lastCd = -99;
    this.fightAt = Date.now();
    this.cdBanner?.destroy(true);
    this.cdBanner = displayText(this, 480, 300, 'FIGHT!', 84, '#4ade80', '#4ade80', 30, true);
    this.tweens.add({
      targets: this.cdBanner, alpha: 0, duration: 700, delay: 100,
      onComplete: () => { this.cdBanner?.destroy(true); this.cdBanner = null; },
    });
    sfx.count(true);
    // controls are taught once, in the lower band, then never shown again
    this.time.delayedCall(1400, () => {
      if (!this.scene.isActive()) return;
      toast(this, 'R reload - F knife - Q guard - 1-0 switch item', '#7dd3fc', 344);
    });
    // red alert edges as the match goes hot
    this.tweens.killTweensOf(this.dmgVin);
    this.dmgVin.setAlpha(0.55);
    this.tweens.add({ targets: this.dmgVin, alpha: 0, duration: 600 });
  }

  private hitmarker() {
    const pt = this.input.activePointer;
    const m = this.add.text(pt.x, pt.y, '✕', {
      fontFamily: BODY, fontSize: '24px', fontStyle: '700', color: '#fff',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30);
    this.tweens.add({
      targets: m, scaleX: 0.7, scaleY: 0.7, alpha: 0, duration: 200,
      onComplete: () => m.destroy(),
    });
    m.setScale(1.5);
  }

  private showEnd(winnerName: string) {
    if (this.endShown) return;
    this.endShown = true;
    if (this.board) { this.board.destroy(true); this.board = null; }
    this.boardVisible = false;
    const myName = (Session.room as any)?.state?.players.get(this.meId)?.name;
    if (winnerName !== 'DRAW' && winnerName === myName) sfx.win();
    const cx = this.cameras.main.width / 2, cy = this.cameras.main.height / 2;
    this.add.rectangle(cx, cy - 10, 600, 320, 0x000000, 0.85).setScrollFactor(0).setDepth(20);
    const title = winnerName === 'DRAW' ? 'DRAW!' : `🏆 ${winnerName} WINS THE MATCH!`;
    displayText(this, cx, cy - 128, title, 34, '#facc15', '#facc15', 21, true);
    const rk = kicker(this, cx, cy - 152, 'M A T C H   R E S U L T', '#7dd3fc', 12);
    rk.setScrollFactor(0).setDepth(21);
    const st: any = (Session.room as any)?.state;
    // ranked table: kills → damage, MVP crowned, accuracy shown
    const rows: Array<{ name: string; kills: number; deaths: number; damage: number; shots: number; hits: number }> = [];
    st?.players.forEach((p: any) => rows.push({
      name: p.name, kills: p.kills || 0, deaths: p.deaths || 0,
      damage: p.damage || 0, shots: p.shots || 0, hits: p.hitsMade || 0,
    }));
    rows.sort((a, b) => b.kills - a.kills || b.damage - a.damage);
    const mvp = rows.length ? rows[0].name : '';
    const acc = (r: { shots: number; hits: number }) =>
      r.shots > 0 ? Math.round((r.hits / r.shots) * 100) + '%' : '—';
    const rhdr = this.add.text(cx, cy - 102, '#   NAME              K/D      DMG      ACC', {
      fontFamily: MONO, fontSize: '12px', fontStyle: '700', color: '#67e8f9',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);
    rhdr.setStroke('#020617', 3);
    rows.slice(0, 6).forEach((r, i) => {
      const row = this.add.text(cx, cy - 80 + i * 22,
        `${r.name === mvp ? '★ ' : '#' + (i + 1) + ' '}${r.name}   ${r.kills}K/${r.deaths}D   ${r.damage} DMG   ${acc(r)}`, {
          fontFamily: MONO, fontSize: '14px', fontStyle: '700', color: r.name === mvp ? '#facc15' : TXT,
        }).setOrigin(0.5).setScrollFactor(0).setDepth(21);
      row.setStroke('#020617', 3);
    });
    const sub = this.add.text(cx, cy + 62, `kill target ${st?.killTarget || 15} · rematch for a new game`, { fontFamily: BODY, fontSize: '13px', fontStyle: '600', color: SUB }).setOrigin(0.5).setScrollFactor(0).setDepth(21);
    sub.setStroke('#020617', 3);
    if (Session.isHost) {
      makeButton(this, {
        tex: 'btn220', x: cx, y: cy + 104, tint: 0x2563eb, label: 'REMATCH', fontSize: 15,
        depth: 21, scroll: true,
        onClick: () => {
          toast(this, 'returning to lobby…', '#7dd3fc', 344);
          Session.room?.send('rematch');
        },
      });
    } else {
      const wait = this.add.text(cx, cy + 96, 'waiting for host…', { fontFamily: COND, fontSize: '17px', fontStyle: '700', color: TXT }).setOrigin(0.5).setScrollFactor(0).setDepth(21);
      wait.setStroke('#020617', 3);
      wait.setShadow(0, 0, '#22d3ee', 8, false, true);
    }
    const leave = this.add.text(cx, cy + 136, 'leave to menu', {
      fontFamily: COND, fontSize: '14px', fontStyle: '700', color: DIM,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);
    leave.setStroke('#020617', 3);
    leave.setInteractive({ useHandCursor: true });
    leave.on('pointerdown', async () => { await Session.leave(); this.scene.start('menu'); });
  }

  private board: Phaser.GameObjects.Container | null = null;
  private boardVisible = false;
  private boardAt = -1e9;

  toggleBoard() {
    this.boardVisible = !this.boardVisible;
    if (!this.boardVisible && this.board) {
      this.board.destroy(true);
      this.board = null;
    } else if (this.boardVisible) {
      this.drawBoard();
    }
  }

  private drawBoard() {
    const st: any = (Session.room as any)?.state;
    if (!st) return;
    const rows: Array<{ name: string; kills: number; deaths: number; damage: number; shots: number; hits: number; id: string; load: string[] }> = [];
    // arsenal pips: which guns each player is carrying (pistol is always owned)
    const GUNS: Array<[string, number]> = [
      ['rifle', 0xfacc15], ['shotgun', 0xfb923c], ['sniper', 0xc084fc],
      ['laser', 0x22d3ee], ['electric', 0xa855f7],
    ];
    st.players.forEach((p: any, id: string) => rows.push({
      name: p.name, kills: p.kills || 0, deaths: p.deaths || 0,
      damage: p.damage || 0, shots: p.shots || 0, hits: p.hitsMade || 0, id,
      load: GUNS.filter(([g]) => p[g] === true).map(([g]) => g),
    }));
    rows.sort((a, b) => b.kills - a.kills || b.damage - a.damage);
    const target = st.killTarget || 15;
    if (!this.board) {
      this.board = this.add.container(480, 300).setScrollFactor(0).setDepth(25);
    } else {
      this.board.removeAll(true);
    }
    const h = 148 + rows.length * 24;
    this.board.add(this.add.rectangle(0, 0, 480, h, 0x020617, 0.94)
      .setStrokeStyle(2.5, 0x22d3ee, 0.8));
    this.board.add(this.add.text(0, -h / 2 + 24, `SCOREBOARD · FIRST TO ${target} (TAB to close)`, {
      fontFamily: MONO, fontSize: '15px', fontStyle: '700', color: '#facc15',
    }).setOrigin(0.5));
    const hdr = this.add.text(0, -h / 2 + 46, '#   NAME              K/D      DMG      ACC', {
      fontFamily: MONO, fontSize: '12px', fontStyle: '700', color: '#67e8f9',
    }).setOrigin(0.5);
    this.board.add(hdr);
    rows.forEach((r, i) => {
      const acc = r.shots > 0 ? Math.round((r.hits / r.shots) * 100) + '%' : '—';
      const y = -h / 2 + 70 + i * 24;
      const meRow = r.id === this.meId;
      if (i % 2 === 0) {
        this.board!.add(this.add.rectangle(0, y, 440, 22, 0xffffff, 0.045));
      }
      if (meRow) {
        this.board!.add(this.add.rectangle(-218, y, 5, 22, 0x22d3ee, 1));
      }
      const rowTx = `#${i + 1}  ${r.name}${meRow ? ' ← YOU' : ''}   ${r.kills}K / ${r.deaths}D   ${r.damage} DMG   ${acc}`;
      const row = this.add.text(0, y, rowTx, {
        fontFamily: MONO, fontSize: '14px', fontStyle: '700',
        color: i === 0 ? '#4ade80' : meRow ? '#a5f3fc' : '#e2e8f0',
      }).setOrigin(0.5);
      row.setStroke('#020617', 3);
      this.board!.add(row);
      // arsenal pips, right-aligned: owned guns in their own colour
      r.load.forEach((g, k) => {
        const col = GUNS.find(([gg]) => gg === g)?.[1] ?? 0xffffff;
        const px = 168 + k * 13;
        const pip = this.add.circle(px, y, 4.5, col, 1).setStrokeStyle(1, 0x020617, 0.8);
        this.board!.add(pip);
      });
    });
  }

  update(_t: number, dtMs: number) {
    const dt = dtMs / 1000;
    // phase routing, polled every frame: state callbacks can miss a transition
    // (proven with ready toggles), and a missed ended->lobby strands the player
    // on the results screen forever. Polling is the backstop; callbacks stay fast-path.
    const phase = (Session.room as any)?.state?.phase;
    if (phase === 'lobby' && !this.backToLobby) {
      this.backToLobby = true;
      this.scene.start('lobby');
      return;
    }
    if (phase === 'ended' && !this.endShown) {
      this.showEnd((Session.room as any)?.state?.winnerName || 'DRAW');
    }
    if (phase === 'countdown') {
      this.showCountdown(Math.ceil((Session.room as any)?.state?.countdown || 0));
    }
    if (phase === 'playing' && this.lastCd !== -99) this.showFight();
    const playing = phase === 'playing';
    const me = this.players.get(this.meId);
    // idle breathing for every soldier (phase-shifted per player) + streak-ring pulse
    // + walk cycle: legs swing toward movement, feet alternate while running
    // + spawn-shield shimmer for the protected
    this.players.forEach((o, id) => {
      let h = 0;
      for (let i = 0; i < id.length; i++) h = ((h * 31 + id.charCodeAt(i)) >>> 0);
      o.body.setScale(1 + 0.018 * Math.sin(_t / 380 + h));
      const vanished = o.alive && id !== this.meId && o.smoked; // in smoke: ghost
      if (o.alive && o.shield > 0) {
        o.gfx.setAlpha(0.6 + 0.3 * Math.sin(_t / 130 + h));
      } else if (vanished) {
        o.gfx.setAlpha(0.28);
      } else if (o.alive && o.gfx.alpha !== 1) {
        o.gfx.setAlpha(1);
      }
      o.label.setVisible(!vanished);
      if (o.gring.visible) { // riot barrier faces the aim (self) or the gun (foes)
        o.gring.setRotation(id === this.meId ? this.lastAim : o.gun.rotation);
        const sh = o.gring.getAt(0) as Phaser.GameObjects.Image; // glass shimmer
        sh.setAlpha(0.8 + 0.2 * Math.sin(_t / 300 + h));
      }
      if (o.ring.visible) {
        const s = 1 + 0.09 * Math.sin(_t / 240 + h);
        o.ring.setScale(s);
        o.ring.setAlpha(0.75 + 0.25 * Math.sin(_t / 240 + h));
      }
      if (o.ringB.visible) {
        const s2 = 1.1 + 0.1 * Math.sin(_t / 300 + h);
        o.ringB.setScale(s2);
        o.ringB.setAlpha(0.7 + 0.3 * Math.sin(_t / 300 + h));
      }
      // electric lock: crackle jitter on the shell so it never reads as a decal
      if (o.zap && o.zap.visible) {
        const t2 = _t / 70 + h;
        o.zap.setPosition(Math.sin(t2 * 3.1) * 2, Math.cos(t2 * 2.3) * 2);
        o.zap2?.setPosition(Math.cos(t2 * 3.7) * 3, Math.sin(t2 * 2.9) * 3);
        if (Math.random() < 0.16) this.sparks.explode(1, o.gfx.x, o.gfx.y);
      }
      let vx: number, vy: number;
      if (id === this.meId) {
        vx = this.myMove.dx * SPEED; vy = this.myMove.dy * SPEED;
      } else if (dt > 0) {
        vx = (o.tx - o.gfx.x) / dt; vy = (o.ty - o.gfx.y) / dt;
      } else { vx = 0; vy = 0; }
      const speed = Math.hypot(vx, vy);
      if (speed > 30 && o.alive) {
        o.legs.rotation = angLerp(o.legs.rotation, Math.atan2(vy, vx) - Math.PI / 2, Math.min(1, dt * 10));
        o.stepPhase += speed * dt * 0.045;
        const stride = Math.min(1, speed / SPEED);
        o.bootL.y = 8 + Math.sin(o.stepPhase) * 3.5 * stride;
        o.bootR.y = 8 - Math.sin(o.stepPhase) * 3.5 * stride;
      } else {
        o.bootL.y += (8 - o.bootL.y) * Math.min(1, dt * 8);
        o.bootR.y += (8 - o.bootR.y) * Math.min(1, dt * 8);
      }
    });
    this.tickFoeArcs(dt);
    this.commitWheel();
    // a switch the server never acknowledges must not strand the strip on
    // "SWITCHING" - state changes drive the happy path, this drives the timeout
    if (this.pendingSlot) {
      const sp: any = (Session.room as any)?.state?.players.get(this.meId);
      if (sp) this.settlePending(sp);
    }
    const edge = this.firing && !this.fireWas;
    this.fireWas = this.firing;
    if (me && Session.room && playing) {
      if (this.firing) this.fireNow(edge);
      let dx = 0, dy = 0;
      if (this.keys.W.isDown || this.keys.UP.isDown) dy -= 1;
      if (this.keys.S.isDown || this.keys.DOWN.isDown) dy += 1;
      if (this.keys.A.isDown || this.keys.LEFT.isDown) dx -= 1;
      if (this.keys.D.isDown || this.keys.RIGHT.isDown) dx += 1;
      if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
      // twin-stick overrides keyboard while a move stick is held
      if (this.moveStick) { dx = this.joyMove.dx; dy = this.joyMove.dy; }
      let ang: number;
      if (this.aimStick) {
        ang = this.aimStick.ang;
      } else {
        const pt = this.input.activePointer;
        const wp = this.cameras.main.getWorldPoint(pt.x, pt.y);
        ang = Math.atan2(wp.y - me.gfx.y, wp.x - me.gfx.x);
      }
      this.lastAim = ang;
      // client prediction (shared stepMove integrator: walls + ice drift like server)
      const mult = me.slowT > 0 ? 0.35 : me.speedT > 0 ? 1.4 : 1;
      const s = stepMove(me.gfx.x, me.gfx.y, this.myVel.x, this.myVel.y,
        dx, dy, dt, this.solids(), inRect(me.gfx.x, me.gfx.y, ICE), mult);
      me.gfx.x = s.x; me.gfx.y = s.y;
      this.myVel = { x: s.vx, y: s.vy };
      me.tx = me.gfx.x; me.ty = me.gfx.y;
      me.gun.setRotation(ang);
      // electric gun idles with a live charge crackling off the prongs
      const mySt: any = (Session.room as any)?.state?.players.get(this.meId);
      const volt = mySt?.weapon === 'electric';
      if (volt && me.alive && Math.random() < 0.3) {
        const zx = me.gfx.x + Math.cos(ang) * (MUZZLE + 4), zy = me.gfx.y + Math.sin(ang) * (MUZZLE + 4);
        const z = this.add.image(zx, zy, 'zap').setDepth(5)
          .setScale(0.26 + Math.random() * 0.22).setAngle(Math.random() * 360)
          .setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({
          targets: z, scaleX: 0, scaleY: 0, alpha: 0, duration: 150 + Math.random() * 130,
          onComplete: () => z.destroy(),
        });
      }
      this.driveArc(me, ang, playing);
      // lock the camera once: re-issuing startFollow every frame resets its
      // lerp state and reads as micro-stutter
      if (!this.camLocked) {
        this.camLocked = true;
        this.cameras.main.startFollow(me.gfx, true, 0.15, 0.15);
        this.cameras.main.setZoom(1);
      }
      (this as any)._acc = ((this as any)._acc || 0) + dt;
      if ((this as any)._acc > 1 / 30) {
        (this as any)._acc = 0;
        Session.room!.send('move', { dx, dy, angle: ang });
      }
      // dust puffs while sprinting (skipped on low quality)
      if ((dx || dy) && quality() !== 'low') {
        (this as any)._dust = ((this as any)._dust || 0) + dt;
        if ((this as any)._dust > 0.3) {
          (this as any)._dust = 0;
          this.dust.explode(1, me.gfx.x, me.gfx.y + 10);
        }
      }
      this.myMove = { dx, dy };
      // reconcile: if prediction drifted far from server truth, ease back
      const ex = me.sx - me.gfx.x, ey = me.sy - me.gfx.y;
      if (ex * ex + ey * ey > 30 * 30) {
        me.gfx.x += ex * 0.25; me.gfx.y += ey * 0.25;
        me.tx = me.gfx.x; me.ty = me.gfx.y;
      }
    } else {
      this.myMove = { dx: 0, dy: 0 };
      // no body / no room / not playing: the discharge must not linger
      this.arcOffNow();
    }
    // interpolate remotes: render 66ms behind the server, lerping between
    // the two bracketing snapshots — constant velocity instead of chase judder
    const nowMs = this.time.now;
    const rt = nowMs - 66;
    this.players.forEach((o, id) => {
      if (id === this.meId) return;
      const h = o.hist;
      if (h.length === 0) {
        o.gfx.x += (o.tx - o.gfx.x) * Math.min(1, dt * 12);
        o.gfx.y += (o.ty - o.gfx.y) * Math.min(1, dt * 12);
        return;
      }
      if (rt <= h[0].t) { o.gfx.x = h[0].x; o.gfx.y = h[0].y; return; }
      const last = h[h.length - 1];
      if (rt >= last.t) {
        // past the newest sample: coast along the last segment (capped 100ms)
        if (h.length >= 2) {
          const p0 = h[h.length - 2];
          const seg = Math.max(1, last.t - p0.t);
          const k = Math.min(100, rt - last.t) / seg;
          o.gfx.x = last.x + (last.x - p0.x) * k;
          o.gfx.y = last.y + (last.y - p0.y) * k;
        } else { o.gfx.x = last.x; o.gfx.y = last.y; }
        return;
      }
      for (let i = 0; i < h.length - 1; i++) {
        if (h[i].t <= rt && rt <= h[i + 1].t) {
          const k = (rt - h[i].t) / Math.max(1, h[i + 1].t - h[i].t);
          o.gfx.x = h[i].x + (h[i + 1].x - h[i].x) * k;
          o.gfx.y = h[i].y + (h[i + 1].y - h[i].y) * k;
          return;
        }
      }
    });
    // dead-reckon bullets between 30Hz server ticks (sniper covers 43px/tick —
    // snapping reads as stutter; ticks still correct via onChange)
    if (dt > 0) {
      const step = Math.min(dt, 0.05);
      this.bullets.forEach((o) => {
        o.img.x += o.vx * step;
        o.img.y += o.vy * step;
      });
      this.throws.forEach((o) => {
        o.img.x += o.vx * step;
        o.img.y += o.vy * step;
      });
    }
    // fade kill feed after a few quiet seconds
    if (this.feedRows.length && Date.now() > this.feedExpiry) {
      for (const r of this.feedRows) {
        r.bg.destroy(); r.k.destroy(); r.m.destroy(); r.v.destroy();
      }
      this.feedRows = [];
    }
    // refresh clock 4x/sec regardless of patch batching + rifle proximity prompt
    (this as any)._clk = ((this as any)._clk || 0) + dt;
    if ((this as any)._clk > 0.25) {
      (this as any)._clk = 0;
      this.drawScore();
      this.refreshGrabPrompt();
      const deg = Math.round(((this.lastAim * 180) / Math.PI % 360 + 360) % 360);
      const dirs = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
      this.setT('comp', this.compassText, `HDG ${String(deg).padStart(3, '0')} · ${dirs[Math.round(deg / 45) % 8]}`);
    }
    // minimap 2x/sec + river shimmer
    (this as any)._mm = ((this as any)._mm || 0) + dt;
    if ((this as any)._mm > 0.5) {
      (this as any)._mm = 0;
      this.drawMinimap();
    }
    this.drawCrosshair();
    for (const w of this.waterTiles) w.tilePositionX += dt * 12;
    // fps meter (?fps=1) + auto low-graphics: 3 straight sub-35fps seconds
    // on HIGH drops scan/vignette/dust live (two tabs on one box stay fluid)
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 1) {
      const fps = Math.round(this.fpsN / this.fpsAcc);
      if (!this.autoQTrip && quality() === 'high' && playing) {
        this.autoQLow = fps < 35 ? this.autoQLow + 1 : 0;
        if (this.autoQLow >= 3) {
          this.autoQTrip = true;
          setQuality('low');
          this.tacScan?.setVisible(false);
          this.tacVin?.setVisible(false);
          try { this.dust.stop(); } catch { /* dying */ }
          toast(this, 'AUTO LOW GRAPHICS — raise it in settings', '#facc15', 344);
        }
      }
      if (this.fpsText) {
        this.setT('fps', this.fpsText, `${fps} FPS`,
          fps >= 50 ? '#4ade80' : fps >= 30 ? '#facc15' : '#ef4444');
      }
      this.fpsAcc = 0; this.fpsN = 0;
    }
    // last: the bolts follow the tips dead-reckoning just moved
    this.drawArcTethers();
  }
}
