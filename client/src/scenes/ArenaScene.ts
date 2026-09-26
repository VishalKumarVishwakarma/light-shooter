import Phaser from 'phaser';
import { Session } from '../net/Session';
import { W, H, SPEED, STEEL, BRICKS, BRICK_HP, WATER, ICE, BUSH, MUZZLE, WEAPONS, inRect, pointInWall, stepMove } from '../map';
import { ensureTextures, avatarTex, foeColor } from '../textures';
import { makeButton, quality, setQuality, toast, type Btn } from '../ui';
import { sfx } from '../audio';
import { BODY, COND, DIM, MONO, SUB, TXT, displayText, kicker } from '../fonts';

const RADIUS = 16;
type PObj = {
  gfx: Phaser.GameObjects.Container; body: Phaser.GameObjects.Image;
  gun: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text;
  ring: Phaser.GameObjects.Image; ringB: Phaser.GameObjects.Image;
  gring: Phaser.GameObjects.Container; // frontal shield holder (rotates to aim)
  legs: Phaser.GameObjects.Container;
  bootL: Phaser.GameObjects.Image; bootR: Phaser.GameObjects.Image;
  stepPhase: number;
  tx: number; ty: number; hp: number; alive: boolean;
  shield: number; shieldPts: number; speedT: number;
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
type BObj = { img: Phaser.GameObjects.Image; vx: number; vy: number };

export class ArenaScene extends Phaser.Scene {
  meId = '';
  players = new Map<string, PObj>();
  bullets = new Map<string, BObj>();
  throws = new Map<string, { img: Phaser.GameObjects.Image; vx: number; vy: number }>();
  clouds = new Map<string, { c: Phaser.GameObjects.Container; parts: Phaser.GameObjects.GameObject[]; timers: Phaser.Time.TimerEvent[] }>();
  throwBtns: Array<{ bg: Phaser.GameObjects.Rectangle; tx: Phaser.GameObjects.Text; kind: string; key: string; icon: string }> = [];
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
  private ammoHint!: Phaser.GameObjects.Text;
  private reloadBar!: Phaser.GameObjects.Rectangle;
  private reloadBg!: Phaser.GameObjects.Rectangle;
  private reloadTx!: Phaser.GameObjects.Text;
  private guardBg!: Phaser.GameObjects.Rectangle;
  private guardTx!: Phaser.GameObjects.Text;
  private loadSlots: Array<{ bg: Phaser.GameObjects.Rectangle; tx: Phaser.GameObjects.Text }> = [];
  private shChipBg!: Phaser.GameObjects.Rectangle;
  private shChipFill!: Phaser.GameObjects.Rectangle;
  private shChipTx!: Phaser.GameObjects.Text;
  private spChipBg!: Phaser.GameObjects.Rectangle;
  private spChipFill!: Phaser.GameObjects.Rectangle;
  private spChipTx!: Phaser.GameObjects.Text;
  private raceBg!: Phaser.GameObjects.Rectangle;
  private raceFill!: Phaser.GameObjects.Rectangle;
  private grabBtn: Btn | null = null;

  constructor() { super('arena'); }

  create() {
    ensureTextures(this);
    this.cameras.main.fadeIn(250, 0, 0, 0);
    this.events.once('shutdown', () => {
      try { this.input.setDefaultCursor('default'); } catch { /* dying */ }
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
    this.moveStick = null; this.aimStick = null;
    this.joyMove = { dx: 0, dy: 0 };
    this.tacVin = null; this.tacScan = null;
    this.autoQTrip = false; this.autoQLow = 0;
    // fresh maps/arrays: display objects were destroyed on shutdown
    this.players.clear();
    this.bullets.clear();
    this.throws.clear();
    this.clouds.clear();
    this.throwBtns = [];
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
    this.myMove = { dx: 0, dy: 0 };
    this.firing = false;
    this.lastFire = 0;
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

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,R,E,Q,G,X,C,ONE,TWO,THREE,FOUR,FIVE,SIX,F,TAB') as any;
    this.input.keyboard!.addCapture('UP,DOWN,LEFT,RIGHT,SPACE,TAB'); // stop page scroll + focus steal
    // global KeyboardPlugin outlives the scene: wire once or keys multi-fire
    if (!this.kbWired) {
      this.kbWired = true;
      const kb = this.input.keyboard!;
      kb.on('keydown-R', () => { Session.room?.send('reload'); sfx.reload(); });
      kb.on('keydown-E', () => Session.room?.send('interact'));
      kb.on('keydown-ONE', () => Session.room?.send('switch', { weapon: 'pistol' }));
      kb.on('keydown-TWO', () => Session.room?.send('switch', { weapon: 'rifle' }));
      kb.on('keydown-THREE', () => Session.room?.send('switch', { weapon: 'shotgun' }));
      kb.on('keydown-FOUR', () => Session.room?.send('switch', { weapon: 'sniper' }));
      kb.on('keydown-FIVE', () => Session.room?.send('switch', { weapon: 'laser' }));
      kb.on('keydown-SIX', () => {
        Session.room?.send('guard', { on: true }); // slot 6: raise the shield
        sfx.guard(true);
      });
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
    this.input.on('wheel', () => {
      const st: any = (Session.room as any)?.state;
      const me = st?.players.get(Session.room?.sessionId || '');
      const owned = ['pistol'];
      if (me?.rifle) owned.push('rifle');
      if (me?.shotgun) owned.push('shotgun');
      if (me?.sniper) owned.push('sniper');
      if (me?.laser) owned.push('laser');
      const next = owned[(owned.indexOf(me?.weapon) + 1) % owned.length];
      Session.room?.send('switch', { weapon: next });
    });
    // HP bar (top-left): metallic frame, ghost damage trail, gloss, segment ticks
    this.hpFrame = this.add.rectangle(10, 12, 232, 26, 0x0b1220, 0.85).setOrigin(0, 0.5)
      .setStrokeStyle(2.5, 0x22d3ee, 0.8).setScrollFactor(0).setDepth(10);
    this.add.rectangle(14, 12, 224, 18, 0x020617, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.hpGhost = this.add.rectangle(14, 12, 224, 18, 0xfca5a5).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.hpFill = this.add.rectangle(14, 12, 224, 18, 0x22c55e).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.add.rectangle(14, 5.5, 224, 5, 0xffffff, 0.16).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    for (const f of [0.25, 0.5, 0.75]) {
      this.add.rectangle(14 + 224 * f, 12, 2, 18, 0x000000, 0.55).setScrollFactor(0).setDepth(11);
    }
    this.hpLabel = this.add.text(126, 12, 'HP 100 · 0 K', {
      fontFamily: COND, fontSize: '15px', fontStyle: '700', color: '#fff',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(12);
    this.hpLabel.setStroke('#000000', 3);
    this.hpLabel.setShadow(0, 0, '#22c55e', 8, false, true);
    this.pingText = this.add.text(10, 34, 'PING …', {
      fontFamily: COND, fontSize: '12px', fontStyle: '700', color: DIM,
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    this.pingText.setStroke('#020617', 3);
    this.dispHp = 100; this.ghostHp = 100;
    this.paintHp(100, 100);
    if (this.lowPulse) { this.lowPulse.stop(); this.lowPulse = null; }
    this.dispHp = 100; this.ghostHp = 100;
    // red edge flash on damage
    this.dmgVin = this.add.image(480, 300, 'vignette').setTint(0xef4444)
      .setDisplaySize(960, 600).setScrollFactor(0).setDepth(8).setAlpha(0);
    // ammo readout (bottom-right, above minimap): compact glass card
    const ammoCard = this.add.graphics().setScrollFactor(0).setDepth(9);
    ammoCard.fillStyle(0x020617, 0.68);
    ammoCard.fillRoundedRect(800, 344, 156, 72, 12);
    ammoCard.fillStyle(0xffffff, 0.05);
    ammoCard.fillRoundedRect(802, 346, 152, 26, 10);
    ammoCard.lineStyle(4, 0x020617, 0.8);
    ammoCard.strokeRoundedRect(799, 343, 158, 74, 13);
    ammoCard.lineStyle(2.5, 0x22d3ee, 0.6);
    ammoCard.strokeRoundedRect(800, 344, 156, 72, 12);
    this.add.image(820, 384, 'gun').setScale(0.7).setScrollFactor(0).setDepth(10).setAlpha(0.95);
    this.ammoTitle = this.add.text(806, 350, 'PISTOL', {
      fontFamily: COND, fontSize: '12px', fontStyle: '700', color: '#94a3b8',
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(10);
    this.ammoCount = this.add.text(950, 348, '12/12', {
      fontFamily: COND, fontSize: '22px', fontStyle: '700', color: '#fff',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(10);
    this.ammoCount.setStroke('#020617', 4);
    this.ammoCount.setShadow(0, 0, '#22d3ee', 10, false, true);
    this.ammoHint = this.add.text(950, 392, 'R reload · F knife · Q guard', {
      fontFamily: COND, fontSize: '10px', fontStyle: '700', color: DIM,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(10);
    this.ammoHint.setStroke('#020617', 3);
    // reload progress bar under the ammo readout
    this.add.rectangle(946, 406, 140, 4, 0x000000, 0.55).setOrigin(1, 0).setScrollFactor(0).setDepth(10);
    this.reloadBar = this.add.rectangle(946, 406, 0, 4, 0xfb923c).setOrigin(1, 0).setScrollFactor(0).setDepth(11);
    // tappable RELOAD button (touch + mouse; R key works too)
    this.reloadBg = this.add.rectangle(906, 428, 80, 22, 0x0b1220, 0.92)
      .setStrokeStyle(2.5, 0xeab308, 0.95).setScrollFactor(0).setDepth(10);
    this.reloadTx = this.add.text(906, 428, '⟳ RELOAD', {
      fontFamily: COND, fontSize: '12px', fontStyle: '700', color: '#facc15',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(11);
    this.reloadBg.setInteractive({ useHandCursor: true });
    this.reloadBg.on('pointerover', () => this.reloadBg.setFillStyle(0x334155));
    this.reloadBg.on('pointerout', () => this.reloadBg.setFillStyle(0x1e293b));
    this.reloadBg.on('pointerdown', () => {
      Session.room?.send('reload');
      sfx.reload();
      this.reloadBg.setAlpha(0.6);
      this.time.delayedCall(150, () => this.reloadBg.setAlpha(1));
    });
    // throwable ordnance (bottom-left, above the guard button): tap to toss
    const ords: Array<[string, string, string]> = [
      ['G', '💣', 'grenade'], ['X', '🔥', 'molly'], ['C', '💨', 'smoke'],
    ];
    this.throwBtns = [];
    ords.forEach(([key, icon, kind], i) => {
      const x = 33 + i * 50;
      const bg = this.add.rectangle(x, 410, 46, 26, 0x0b1220, 0.92)
        .setStrokeStyle(2, 0x475569, 0.9).setScrollFactor(0).setDepth(10);
      const tx = this.add.text(x, 410, `${key}${icon}·`, {
        fontFamily: COND, fontSize: '12px', fontStyle: '700', color: '#e2e8f0',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(11);
      tx.setStroke('#020617', 2);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => this.throwOrd(kind));
      this.throwBtns.push({ bg, tx, kind, key, icon });
    });
    // stance toggle (touch + mouse; Q works too): shield = knife-only, gun = fire
    this.guardBg = this.add.rectangle(75, 448, 130, 30, 0x0b1220, 0.92)
      .setStrokeStyle(2.5, 0x4ade80, 0.95).setScrollFactor(0).setDepth(10);
    this.guardTx = this.add.text(75, 448, '🛡 SHIELD', {
      fontFamily: COND, fontSize: '15px', fontStyle: '700', color: '#4ade80',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(11);
    this.guardTx.setStroke('#020617', 3);
    this.guardBg.setInteractive({ useHandCursor: true });
    this.guardBg.on('pointerover', () => this.guardBg.setFillStyle(0x1e293b));
    this.guardBg.on('pointerout', () => this.guardBg.setFillStyle(0x0b1220));
    this.guardBg.on('pointerdown', () => {
      Session.room?.send('guard');
      const g = (Session.room as any)?.state?.players.get(Session.room?.sessionId || '');
      sfx.guard(!g?.guard);
      this.guardBg.setAlpha(0.6);
      this.time.delayedCall(150, () => this.guardBg.setAlpha(1));
    });
    // loadout strip (bottom-center): 6 tappable slots — guns + shield, live states
    const slots: Array<[string, string, string]> = [
      ['1', 'PISTOL', 'pistol'], ['2', 'RIFLE', 'rifle'], ['3', 'SG', 'shotgun'],
      ['4', 'SNP', 'sniper'], ['5', 'LSR', 'laser'], ['6', 'SHD', 'shield'],
    ];
    this.loadSlots = [];
    slots.forEach(([key, nm, w], i) => {
      const x = 480 + (i - 2.5) * 42;
      const bg = this.add.rectangle(x, 500, 38, 32, 0x020617, 0.78)
        .setStrokeStyle(2, 0x334155, 0.95).setScrollFactor(0).setDepth(10);
      const tx = this.add.text(x, 500, `${key}\n${nm}`, {
        fontFamily: COND, fontSize: '10px', fontStyle: '700', color: '#475569', align: 'center', lineSpacing: 0,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(11);
      tx.setStroke('#020617', 2);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => {
        if (w === 'shield') {
          Session.room?.send('guard', { on: true });
          sfx.guard(true);
        } else {
          Session.room?.send('switch', { weapon: w });
          sfx.click();
        }
      });
      this.loadSlots.push({ bg, tx });
    });
    // buff chips (under the HP bar): shield points + haste timers with mini bars
    this.shChipBg = this.add.rectangle(10, 50, 150, 16, 0x020617, 0.72).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10).setVisible(false)
      .setStrokeStyle(2, 0x38bdf8, 0.7);
    this.shChipFill = this.add.rectangle(12, 50, 0, 10, 0x38bdf8).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10).setVisible(false);
    this.shChipTx = this.add.text(16, 50, '', {
      fontFamily: COND, fontSize: '11px', fontStyle: '700', color: '#bae6fd',
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11).setVisible(false);
    this.shChipTx.setStroke('#020617', 2);
    this.spChipBg = this.add.rectangle(10, 68, 150, 16, 0x020617, 0.72).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10).setVisible(false)
      .setStrokeStyle(2, 0xfde047, 0.7);
    this.spChipFill = this.add.rectangle(12, 68, 0, 10, 0xfde047).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10).setVisible(false);
    this.spChipTx = this.add.text(16, 68, '', {
      fontFamily: COND, fontSize: '11px', fontStyle: '700', color: '#fef08a',
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11).setVisible(false);
    this.spChipTx.setStroke('#020617', 2);
    // kill-target race bar (top-center, under the clock)
    this.raceBg = this.add.rectangle(480, 33, 150, 6, 0x020617, 0.72).setScrollFactor(0).setDepth(10);
    this.raceFill = this.add.rectangle(405, 33, 0, 6, 0xfacc15).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    // actionable pickup button: appears near a rifle, click/tap to grab (E works too)
    this.grabBtn = makeButton(this, {
      tex: 'btn220', x: 480, y: 556, tint: 0xca8a04, label: 'Ⓔ PICK UP RIFLE', fontSize: 15,
      depth: 11, scroll: true,
      onClick: () => Session.room?.send('interact'),
    });
    this.grabBtn.c.setVisible(false);
    const clockCard = this.add.graphics().setScrollFactor(0).setDepth(10);
    clockCard.fillStyle(0x020617, 0.72);
    clockCard.fillRoundedRect(421, 1, 118, 27, 13);
    clockCard.fillStyle(0xffffff, 0.06);
    clockCard.fillRoundedRect(423, 3, 114, 11, 6);
    clockCard.lineStyle(4, 0x020617, 0.8);
    clockCard.strokeRoundedRect(420, 0, 120, 29, 14);
    clockCard.lineStyle(2.5, 0xfacc15, 0.65);
    clockCard.strokeRoundedRect(421, 1, 118, 27, 13);
    const liveDot = this.add.circle(434, 14, 5, 0xef4444).setScrollFactor(0).setDepth(11);
    this.tweens.add({ targets: liveDot, alpha: 0.25, duration: 800, yoyo: true, repeat: -1 });
    this.clockText = this.add.text(484, 14, '2:00', {
      fontFamily: COND, fontSize: '17px', fontStyle: '700', color: '#facc15',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(11);
    this.clockText.setStroke('#020617', 3);
    this.clockText.setShadow(0, 0, '#facc15', 10, false, true);
    this.compassText = this.add.text(480, 44, 'HDG 090 · E', {
      fontFamily: COND, fontSize: '13px', fontStyle: '700', color: '#7dd3fc',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(11);
    this.compassText.setStroke('#020617', 3);
    const ticks = this.add.graphics().setScrollFactor(0).setDepth(10);
    ticks.lineStyle(2, 0x7dd3fc, 0.55);
    for (let k = -4; k <= 4; k++) {
      const tx = 480 + k * 14, tall = k % 2 === 0 ? 7 : 4;
      ticks.beginPath();
      ticks.moveTo(tx, 56); ticks.lineTo(tx, 56 + tall);
      ticks.strokePath();
    }
    ticks.fillStyle(0xfacc15, 1); // center caret
    ticks.fillTriangle(480 - 5, 54, 480 + 5, 54, 480, 60);
    this.wantedText = this.add.text(480, 66, '', {
      fontFamily: COND, fontSize: '16px', fontStyle: '700', color: '#facc15',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(11);
    this.wantedText.setStroke('#000000', 3);
    this.roundText = this.add.text(480, 88, '', {
      fontFamily: COND, fontSize: '13px', fontStyle: '700', color: SUB,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(11);
    this.roundText.setStroke('#020617', 3);
    try {
      if (new URLSearchParams(location.search).get('fps')) {
        this.fpsText = this.add.text(12, 578, '60', {
          fontFamily: MONO, fontSize: '12px', color: '#4ade80',
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
      }
    } catch { /* noop */ }
    this.arenaBorn = Date.now();
    // GTA cash counter top-right, scoreboard below it
    this.cashText = this.add.text(950, 8, '$0', {
      fontFamily: COND, fontSize: '22px', fontStyle: '700', color: '#4ade80',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(11);
    this.cashText.setStroke('#020617', 4);
    this.cashText.setShadow(0, 0, '#4ade80', 10, false, true);
    this.scoreText = this.add.text(950, 36, '', {
      fontFamily: MONO, fontSize: '14px', color: '#e2e8f0', align: 'right', lineSpacing: 3,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(10);
    this.scoreText.setStroke('#000000', 3);
    // minimap frame (bottom-right): glass plate + neon rim (drawn once)
    this.minimap = this.add.graphics().setScrollFactor(0).setDepth(9);
    const mmFrame = this.add.graphics().setScrollFactor(0).setDepth(10);
    mmFrame.fillStyle(0x020617, 0.55);
    mmFrame.fillRoundedRect(795, 471, 160, 122, 10);
    mmFrame.lineStyle(4, 0x020617, 0.8);
    mmFrame.strokeRoundedRect(794, 470, 162, 124, 11);
    mmFrame.lineStyle(2.5, 0x22d3ee, 0.75);
    mmFrame.strokeRoundedRect(795, 471, 160, 122, 10);
    mmFrame.lineStyle(1.5, 0xffffff, 0.12);
    mmFrame.strokeRoundedRect(798, 474, 154, 116, 8);

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
        && Math.abs(pt.x - 480) < 130 && Math.abs(pt.y - 556) < 45) return;
      if (Math.abs(pt.x - 906) < 45 && Math.abs(pt.y - 428) < 15) return; // reload btn
      if (Math.abs(pt.x - 75) < 70 && Math.abs(pt.y - 448) < 20) return; // guard btn
      if (pt.y > 395 && pt.y < 425 && pt.x > 5 && pt.x < 160) return; // ordnance btns
      if (pt.y > 482 && pt.y < 518 && Math.abs(pt.x - 480) < 110) return; // loadout strip
      if (pt.leftButtonDown()) {
        this.firing = true;
        this.fireNow();
      }
    });
    this.input.on('pointerup', (pt: Phaser.Input.Pointer) => {
      if ((pt as any).wasTouch) this.releaseStick(pt.id);
      else this.firing = false;
    });
    this.input.on('gameout', () => { this.firing = false; this.clearSticks(); });
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
    g.lineStyle(2.5, 0x22d3ee, 0.95);
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
    if (this.grabBtn?.c.visible && Math.abs(pt.x - 480) < 130 && Math.abs(pt.y - 556) < 45) return;
    if (Math.abs(pt.x - 906) < 45 && Math.abs(pt.y - 428) < 15) return;
    if (Math.abs(pt.x - 75) < 70 && Math.abs(pt.y - 448) < 20) return;
    if (pt.y > 395 && pt.y < 425 && pt.x > 5 && pt.x < 160) return;
    if (pt.y > 482 && pt.y < 518 && Math.abs(pt.x - 480) < 110) return;
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
    return w === 'rifle' || w === 'shotgun' || w === 'sniper' || w === 'laser' ? w : 'pistol';
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

  private fireNow() {
    const room = Session.room;
    if (!room || (room as any).state?.phase !== 'playing') return;
    const me = this.players.get(this.meId);
    if (!me) return;
    const st = (room as any).state?.players.get(this.meId);
    if (st?.guard) { // shield raised: guns are dead — knife (F) or lower (Q)
      sfx.empty();
      this.guardBg.setAlpha(0.5);
      this.time.delayedCall(150, () => this.guardBg.setAlpha(1));
      return;
    }
    const w = WEAPONS[this.ownWeapon()] || WEAPONS.pistol;
    const now = this.time.now / 1000;
    if (now - this.lastFire < w.interval) return;
    this.lastFire = now;
    // dry mag: reload instead of flashing blanks (server would reject anyway)
    const mag = st?.weapon === 'rifle' ? st?.ammo : st?.weapon === 'shotgun' ? st?.sammo
      : st?.weapon === 'sniper' ? st?.nammo : st?.weapon === 'laser' ? st?.lammo : st?.pammo;
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
    this.flash(mx, my, ang, false, gw === 'laser' ? 0x22d3ee : 0);
    if (gw === 'laser') this.beam(mx, my, ang, this.meId); // instant full-length beam (no echo delay)
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
        if (Math.hypot(px - b.x, py - b.y) < 20) return { x: b.x, y: b.y };
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
    gun.x = 8 - 4;
    this.tweens.add({ targets: gun, x: 8, duration: 110, ease: 'Quad.easeOut' });
  }

  async connect() {
    if (!Session.room) { this.scene.start('menu'); return; }
    const room: any = Session.room;
    this.meId = room.sessionId;
    // generation token: callbacks from previous arena visits exit early
    const gen = ++this.subGen;
    const live = () => gen === this.subGen && Session.room === room;

    room.state.onChange(() => {
      if (!live()) return;
      if (room.state.phase === 'lobby' && !this.backToLobby) {
        this.backToLobby = true;
        this.scene.start('lobby');
      }
      if (room.state.phase === 'ended') this.showEnd(room.state.winnerName);
      if (room.state.phase === 'countdown') this.showCountdown(Math.ceil(room.state.countdown));
      if (room.state.phase === 'playing' && this.lastCd !== -99) this.showFight();
      this.drawScore();
    });
    // entering arena mid-state (e.g. reloaded scene) — show banner if already ended
    if (room.state.phase === 'ended') this.showEnd(room.state.winnerName);
    this.drawScore();

    room.onMessage('kill', (k: { killer: string; victim: string; w?: string }) => {
      if (!live()) return;
      const w = (k.w || 'pistol').toUpperCase();
      const myName = (Session.room as any)?.state?.players.get(this.meId)?.name;
      const rowY = (i: number) => 57 + i * 22;
      // shift older rows down
      this.feedRows.forEach((r, i) => {
        const y = rowY(i + 1);
        r.bg.setY(y);
        r.k.setY(y); r.m.setX(r.k.x + r.k.width + 5); r.m.setY(y);
        r.v.setX(r.m.x + r.m.width + 5); r.v.setY(y);
      });
      const bg = this.add.rectangle(10, rowY(0), 330, 19, 0x020617, 0.72)
        .setOrigin(0, 0.5).setScrollFactor(0).setDepth(9)
        .setStrokeStyle(2, 0x22d3ee, 0.5);
      const kk = this.add.text(16, rowY(0), k.killer, {
        fontFamily: MONO, fontSize: '13px', color: k.killer === myName ? '#22d3ee' : '#fdba74',
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
      kk.setStroke('#000000', 3);
      const mm = this.add.text(kk.x + kk.width + 5, rowY(0), `[${w}] 🔫`, {
        fontFamily: MONO, fontSize: '13px', color: '#94a3b8',
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
      mm.setStroke('#000000', 3);
      const vv = this.add.text(mm.x + mm.width + 5, rowY(0), k.victim, {
        fontFamily: MONO, fontSize: '13px', color: k.victim === myName ? '#ef4444' : '#e2e8f0',
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
      vv.setStroke('#000000', 3);
      this.feedRows.unshift({ bg, k: kk, m: mm, v: vv });
      while (this.feedRows.length > 4) {
        const old = this.feedRows.pop()!;
        old.bg.destroy(); old.k.destroy(); old.m.destroy(); old.v.destroy();
      }
      this.feedExpiry = Date.now() + 6000;
    });
    room.onMessage('hit', (h: { x: number; y: number; by?: string; dmg?: number; ox?: number; oy?: number; to?: string }) => {
      if (!live()) return;
      this.sparks.explode(8, h.x, h.y);
      // floating damage number on every impact (grey BLOCKED when shielded)
      const blocked = (h.dmg ?? 0) <= 0;
      this.damageNumber(h.x, h.y, blocked ? 'BLOCKED' : `-${h.dmg ?? 0}`, blocked ? '#94a3b8' : '#fecaca');
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
    });
    room.onMessage('chip', (c: { x: number; y: number; kind: string }) => {
      if (!live()) return;
      // wall impacts: sparks off steel, dust puff off crumbling brick
      this.sparks.explode(6, c.x, c.y);
      if (c.kind === 'brick') this.dust.explode(4, c.x, c.y);
    });

    room.state.bricks.onAdd((b: any, id: string) => {
      if (!live()) return;
      this.syncBrick(id, b.hp);
      b.onChange(() => { if (live()) this.syncBrick(id, b.hp); });
    });
    room.onMessage('collect', (c: { name: string; kind: string; x: number; y: number }) => {
      if (!live()) return;
      sfx.pickup();
      const txt = c.kind === 'health' ? '+50 HP' : c.kind === 'ammo' ? 'AMMO FULL' : c.kind.toUpperCase() + '!';
      const col = c.kind === 'health' ? '#4ade80' : c.kind === 'ammo' ? '#fdba74'
        : c.kind === 'shield' ? '#38bdf8' : c.kind === 'speed' ? '#fde047' : '#facc15';
      const f = this.add.text(c.x, c.y - 24, `${c.name} ${txt}`, {
        fontFamily: MONO, fontSize: '14px', color: col,
      }).setOrigin(0.5).setDepth(8);
      f.setStroke('#000000', 3);
      this.tweens.add({
        targets: f, y: c.y - 64, alpha: 0, duration: 950, ease: 'Quad.easeOut',
        onComplete: () => f.destroy(),
      });
    });

    room.state.pickups.onAdd((pk: any, id: string) => {
      if (!live()) return;
      this.pkDots.set(id, { x: pk.x, y: pk.y, kind: pk.kind, active: pk.active });
      const marker = this.buildPickup(pk.kind);
      marker.setPosition(pk.x, pk.y);
      marker.setVisible(pk.active);
      this.pickups.set(id, marker);
      pk.onChange(() => {
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
      });
      pk.onRemove(() => {
        if (!live()) return;
        this.pkDots.delete(id);
        marker.destroy(true);
        this.pickups.delete(id);
      });
    });

    room.state.players.onAdd((p: any, id: string) => {
      if (!live()) return;
      // mid-match arrivals/departures get a toast (skip the initial roster)
      if (Date.now() - this.arenaBorn > 4000 && id !== this.meId) {
        toast(this, `${p.name} joined the fight`, '#4ade80');
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
      const gun = this.add.image(8, 0, 'gun').setScale(0.85); // barrel tip lands on MUZZLE
      gun.setOrigin(0.15, 0.5);
      const label = this.add.text(-20, -36, p.name, { fontSize: '13px', fontStyle: '700', color: '#fff', fontFamily: COND });
      label.setStroke('#020617', 4);
      label.setShadow(0, 0, glowCss, 6, false, true);
      const gfx = this.add.container(p.x, p.y, [sh, baseRing, legs, gring, ring, ringB, body, gun, label]);
      this.players.set(id, {
        gfx, body, gun, label, ring, ringB, legs, bootL, bootR, stepPhase: Math.random() * 6,
        tx: p.x, ty: p.y, sx: p.x, sy: p.y, hp: p.hp, alive: p.alive,
        shield: p.shield || 0, shieldPts: p.shieldPts || 0, speedT: p.speedT || 0,
        hist: [], col, gring, smoked: !!p.smoked,
      });
      if (!p.alive) body.setTint(0x666677);
      p.onChange(() => {
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
        o.gfx.setRotation(0);
        o.gun.setRotation(p.angle);
        this.setT('nl' + id, o.label, `${p.name} ${p.hp}${o.speedT > 0 ? ' ⚡' : ''}${o.shieldPts > 0 ? ' 🛡' : ''}`);
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
      });
      p.onRemove(() => {
        if (!live()) return;
        const o = this.players.get(id);
        o?.gfx.destroy(true);
        this.players.delete(id);
        if (Date.now() - this.arenaBorn > 4000 && id !== this.meId && o) {
          toast(this, `${o.label.text.split(' ')[0]} left the fight`, '#94a3b8');
        }
      });
    });

    room.state.bullets.onAdd((b: any, id: string) => {
      if (!live()) return;
      const foe = b.ownerId !== this.meId;
      const bw = typeof b.weapon === 'string' ? b.weapon : 'pistol';
      const a0 = Math.atan2(b.vy, b.vx);
      // spawn at the RENDERED barrel (remotes lag 66ms behind server truth —
      // spawning at truth pops tracers out of thin air ahead of the gun)
      const own0 = this.players.get(b.ownerId);
      const sx = own0 ? own0.gfx.x + Math.cos(a0) * MUZZLE : b.x;
      const sy = own0 ? own0.gfx.y + Math.sin(a0) * MUZZLE : b.y;
      const img = this.add.image(sx, sy, 'bolt').setBlendMode(Phaser.BlendModes.ADD).setDepth(5);
      if (bw === 'laser') img.setTint(0x22d3ee); // cyan bolts, both sides
      else if (foe) img.setTint(0xfb923c);
      img.setRotation(a0);
      img.setScale(bw === 'laser' ? 1.4 : 1.0, 1.0); // laser head rides inside its beam
      img.setAlpha(0); // fade in: no spawn pop, then dead-reckoning takes over
      this.tweens.add({ targets: img, alpha: 1, duration: 90 });
      this.bullets.set(id, { img, vx: b.vx, vy: b.vy });
      // muzzle flash + recoil at the shooter's barrel — foes only.
      // (own shots already flashed + recoiled at fire time; the echo would double it)
      const own = this.players.get(b.ownerId);
      if (own && foe) {
        const a = Math.atan2(b.vy, b.vx);
        const mx = own.gfx.x + Math.cos(a) * MUZZLE, my = own.gfx.y + Math.sin(a) * MUZZLE;
        this.flash(mx, my, a, false, bw === 'laser' ? 0x22d3ee : 0);
        this.recoil(own.gun);
        // enemy lasers burn their beam from the visible barrel too
        if (bw === 'laser') this.beam(mx, my, a, b.ownerId);
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
      b.onChange(() => {
        if (!live()) return;
        const o = this.bullets.get(id);
        if (!o) return;
        // authoritative tick correction (small — extrapolation covers the gaps)
        o.img.setPosition(b.x, b.y);
        o.vx = b.vx; o.vy = b.vy;
        o.img.setRotation(Math.atan2(b.vy, b.vx));
      });
      b.onRemove(() => { if (!live()) return; img.destroy(); this.bullets.delete(id); });
    });

    room.state.throws.onAdd((th: any, id: string) => {
      if (!live()) return;
      const cols: Record<string, number> = { grenade: 0x9ca3af, smoke: 0xd1d5db, molly: 0xfb923c };
      const img = this.add.image(th.x, th.y, 'dot')
        .setTint(cols[th.kind] ?? 0xffffff).setDepth(5)
        .setScale(th.kind === 'grenade' ? 1.5 : 1.1);
      this.throws.set(id, { img, vx: th.vx, vy: th.vy });
      if (th.kind === 'grenade') {
        this.tweens.add({ targets: img, alpha: 0.35, duration: 180, yoyo: true, repeat: -1 });
      }
      th.onChange(() => {
        if (!live()) return;
        const o = this.throws.get(id);
        if (!o) return;
        o.img.setPosition(th.x, th.y);
        o.vx = th.vx; o.vy = th.vy;
      });
      th.onRemove(() => {
        if (!live()) return;
        const o = this.throws.get(id);
        if (o) this.tweens.killTweensOf(o.img);
        o?.img.destroy();
        this.throws.delete(id);
      });
    });

    room.state.clouds.onAdd((cl: any, id: string) => {
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
      cl.onChange(() => {
        if (!live()) return;
        const o = this.clouds.get(id);
        if (o) o.c.setAlpha(cl.t < 1.5 ? Math.max(0, cl.t / 1.5) : 1);
      });
      cl.onRemove(() => {
        if (!live()) return;
        const o = this.clouds.get(id);
        if (o) {
          this.tweens.killTweensOf(o.c);
          o.parts.forEach((pp) => this.tweens.killTweensOf(pp));
          o.timers.forEach((tm) => tm.remove(false));
          o.c.destroy(true);
        }
        this.clouds.delete(id);
      });
    });

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
    Session.room = null;
    try { toast(this, 'connection lost — back to menu', '#f87171'); } catch { /* scene dying */ }
    this.scene.start('menu');
  }

  private drawAmmo(p: any) {
    const W = WEAPONS[p.weapon] || WEAPONS.pistol;
    const colors: Record<string, string> = { pistol: '#94a3b8', rifle: '#facc15', shotgun: '#fb923c', sniper: '#c084fc', laser: '#22d3ee' };
    this.setT('ammoT', this.ammoTitle, p.weapon.toUpperCase(), colors[p.weapon] || '#94a3b8');
    const left = p.weapon === 'rifle' ? p.ammo : p.weapon === 'shotgun' ? p.sammo
      : p.weapon === 'sniper' ? p.nammo : p.weapon === 'laser' ? p.lammo : p.pammo;
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
    this.setT('ammoH', this.ammoHint, 'R reload · F knife · Q guard');
    const needReload = !p.reloading && left < W.clip;
    this.reloadBg.setAlpha(p.reloading ? 0.45 : needReload ? 1 : 0.55);
    this.reloadTx.setAlpha(p.reloading ? 0.45 : needReload ? 1 : 0.55);
    // stance badge mirrors the server guard flag (drawAmmo runs for me on change)
    const guarded = !!p.guard;
    this.setT('guard', this.guardTx, guarded ? '🛡 SHIELD' : '🔫 GUN', guarded ? '#4ade80' : '#60a5fa');
    this.guardBg.setStrokeStyle(2.5, guarded ? 0x4ade80 : 0x60a5fa, 0.95);
    this.drawLoadout(p);
    // ordnance counts on the throw buttons
    const ordN: Record<string, number> = {
      grenade: p.grenades || 0, molly: p.mollies || 0, smoke: p.smokes || 0,
    };
    this.throwBtns.forEach((b) => {
      this.setT('ord' + b.kind, b.tx, `${b.key}${b.icon}${ordN[b.kind] ?? 0}`);
      b.bg.setAlpha((ordN[b.kind] ?? 0) > 0 ? 1 : 0.45);
    });
  }

  private drawLoadout(p: any) {
    const keys = ['pistol', 'rifle', 'shotgun', 'sniper', 'laser', 'shield'];
    const cols: Record<string, string> = {
      pistol: '#94a3b8', rifle: '#facc15', shotgun: '#fb923c',
      sniper: '#c084fc', laser: '#22d3ee', shield: '#4ade80',
    };
    const names: Record<string, string> = {
      pistol: 'PISTOL', rifle: 'RIFLE', shotgun: 'SG',
      sniper: 'SNP', laser: 'LSR', shield: 'SHD',
    };
    keys.forEach((w, i) => {
      const s = this.loadSlots[i];
      if (!s) return;
      const owned = w === 'pistol' || w === 'shield' || p[w] === true;
      const cur = w === 'shield' ? !!p.guard : p.weapon === w;
      this.setT('load' + i, s.tx, `${i + 1}\n${names[w]}`,
        cur ? '#ffffff' : owned ? cols[w] : '#334155');
      if (cur) {
        s.bg.setFillStyle(0x0e2a3a, 0.95).setStrokeStyle(2.5, 0x22d3ee, 1);
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
      const b = displayText(this, 480, 220, txt, 40, '#facc15', '#facc15', 30, true);
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
    this.tweens.killTweensOf(this.hpFill);
    const proxy = { v: from };
    this.tweens.add({
      targets: proxy, v: hp, duration: 180, ease: 'Quad.easeOut',
      onUpdate: () => this.paintHp(proxy.v, this.ghostHp),
    });
    this.tweens.killTweensOf(this.hpGhost);
    const gproxy = { v: this.ghostHp };
    this.tweens.add({
      targets: gproxy, v: hp, duration: 650, delay: hp < this.ghostHp ? 180 : 0, ease: 'Quad.easeOut',
      onUpdate: () => { this.ghostHp = gproxy.v; this.paintHp(this.dispHp, gproxy.v); },
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
    this.hpFill.displayWidth = Math.max(1, 224 * pct);
    this.hpFill.setFillStyle(this.hpColor(pct));
    const gpct = Math.max(0, Math.min(1, ghost / 100));
    this.hpGhost.displayWidth = Math.max(1, 224 * gpct);
  }

  private drawMinimap() {
    const g = this.minimap;
    if (!g) return;
    const s = 150 / W, x0 = 800, y0 = 476, h = H * s;
    const dot = (rc: { x: number; y: number; w: number; h: number }) =>
      g.fillRect(x0 + rc.x * s, y0 + rc.y * s, Math.max(1, rc.w * s), Math.max(1, rc.h * s));
    g.clear();
    g.fillStyle(0x020617, 0.72);
    g.fillRect(x0, y0, 150, h);
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
        shotgun: 0xfb923c, sniper: 0xc084fc, laser: 0x22d3ee, shield: 0x38bdf8, speed: 0xfde047,
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
    g.strokeRect(x0, y0, 150, h);
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
    } else { // rifle / shotgun / sniper / laser: gold ring + tinted rifle + name tag
      const tints: Record<string, number> = { rifle: 0xffffff, shotgun: 0xfb923c, sniper: 0xc084fc, laser: 0x22d3ee };
      const ring = this.add.image(0, 0, 'ring').setScale(0.85);
      const gun = this.add.image(0, 0, 'gun').setScale(1.0).setTint(tints[kind] ?? 0xffffff);
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
        if (pk.kind !== 'rifle' && pk.kind !== 'shotgun' && pk.kind !== 'sniper' && pk.kind !== 'laser') return;
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
    this.setT('score', this.scoreText, rows.map((r, i) => `#${i + 1} ${r.name} ${r.kills}K/${r.deaths}D`).join('\n'));
    this.setT('round', this.roundText, lead && lead.kills > 0
      ? `TARGET ${target} · ${lead.name} LEADS ${lead.kills}K`
      : `FIRST TO ${target} KILLS`);
    let myCash = 0, myStreak = 0;
    st.players.forEach((p: any, id: string) => {
      if (id === this.meId) { myCash = p.cash || 0; myStreak = p.streak || 0; }
    });
    this.setT('cash', this.cashText, '$' + myCash.toLocaleString('en-US'));
    // kill-target race bar: leader's progress to the target
    const race = lead ? Math.min(1, lead.kills / target) : 0;
    this.raceFill.displayWidth = Math.max(1, 150 * race);
    this.raceFill.setFillStyle(race >= 0.8 ? 0x4ade80 : 0xfacc15);
    // buff chips: shield points + haste countdown for me
    const mine = st.players.get(this.meId);
    const pts = mine?.shieldPts || 0;
    this.shChipBg.setVisible(pts > 0);
    this.shChipFill.setVisible(pts > 0);
    this.shChipTx.setVisible(pts > 0);
    if (pts > 0) {
      this.setT('shc', this.shChipTx, `🛡 ${Math.ceil(pts)} PTS`);
      this.shChipFill.displayWidth = Math.max(1, 146 * Math.min(1, pts / 100));
    }
    const haste = mine?.speedT || 0;
    this.spChipBg.setVisible(haste > 0);
    this.spChipFill.setVisible(haste > 0);
    this.spChipTx.setVisible(haste > 0);
    if (haste > 0) {
      this.setT('spc', this.spChipTx, `⚡ ${haste.toFixed(1)}s HASTE`);
      this.spChipFill.displayWidth = Math.max(1, 146 * Math.min(1, haste / 8));
    }
    // GTA wanted level from your streak (cap 5)
    const stars = Math.min(5, myStreak);
    this.setT('want', this.wantedText, stars > 0 ? '★'.repeat(stars) + '☆'.repeat(5 - stars) : '');
    if (myStreak > this.prevStreak && stars > 0) {
      this.wantedText.setScale(1.6);
      this.tweens.add({ targets: this.wantedText, scaleX: 1, scaleY: 1, duration: 300, ease: 'Back.easeOut' });
    }
    this.prevStreak = myStreak;
    if (this.boardVisible) this.drawBoard();
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
    this.cdBanner?.destroy(true);
    this.cdBanner = displayText(this, 480, 300, 'FIGHT!', 84, '#4ade80', '#4ade80', 30, true);
    this.tweens.add({
      targets: this.cdBanner, alpha: 0, duration: 700, delay: 100,
      onComplete: () => { this.cdBanner?.destroy(true); this.cdBanner = null; },
    });
    sfx.count(true);
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
          toast(this, 'returning to lobby…', '#7dd3fc');
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
    const rows: Array<{ name: string; kills: number; deaths: number; damage: number; shots: number; hits: number; id: string }> = [];
    st.players.forEach((p: any, id: string) => rows.push({
      name: p.name, kills: p.kills || 0, deaths: p.deaths || 0,
      damage: p.damage || 0, shots: p.shots || 0, hits: p.hitsMade || 0, id,
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
    if (me && Session.room && playing) {
      if (this.firing) this.fireNow();
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
      const mult = me.speedT > 0 ? 1.4 : 1;
      const s = stepMove(me.gfx.x, me.gfx.y, this.myVel.x, this.myVel.y,
        dx, dy, dt, this.solids(), inRect(me.gfx.x, me.gfx.y, ICE), mult);
      me.gfx.x = s.x; me.gfx.y = s.y;
      this.myVel = { x: s.vx, y: s.vy };
      me.tx = me.gfx.x; me.ty = me.gfx.y;
      me.gun.setRotation(ang);
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
          toast(this, 'AUTO LOW GRAPHICS — raise it in settings', '#facc15');
        }
      }
      if (this.fpsText) {
        this.setT('fps', this.fpsText, `${fps} FPS`,
          fps >= 50 ? '#4ade80' : fps >= 30 ? '#facc15' : '#ef4444');
      }
      this.fpsAcc = 0; this.fpsN = 0;
    }
  }
}
