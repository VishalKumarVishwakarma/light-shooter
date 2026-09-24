import Phaser from 'phaser';
import { Session } from '../net/Session';
import { W, H, SPEED, STEEL, BRICKS, BRICK_HP, WATER, ICE, BUSH, MUZZLE, WEAPONS, inRect, stepMove } from '../map';
import { ensureTextures, avatarTex } from '../textures';
import { makeButton, quality, toast, type Btn } from '../ui';
import { sfx } from '../audio';
import { BODY, COND, MONO, displayText, kicker } from '../fonts';

const RADIUS = 16;
type PObj = {
  gfx: Phaser.GameObjects.Container; body: Phaser.GameObjects.Image;
  gun: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text;
  ring: Phaser.GameObjects.Image; ringB: Phaser.GameObjects.Image;
  legs: Phaser.GameObjects.Container;
  bootL: Phaser.GameObjects.Image; bootR: Phaser.GameObjects.Image;
  stepPhase: number;
  tx: number; ty: number; hp: number; alive: boolean;
  shield: number; shieldPts: number; speedT: number;
  sx: number; sy: number; // last authoritative position (reconciliation anchor)
  pool?: Phaser.GameObjects.Image;
};

function angLerp(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
type BObj = { img: Phaser.GameObjects.Image };

export class ArenaScene extends Phaser.Scene {
  meId = '';
  players = new Map<string, PObj>();
  bullets = new Map<string, BObj>();
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
  private grabBtn: Btn | null = null;

  constructor() { super('arena'); }

  create() {
    ensureTextures(this);
    this.cameras.main.fadeIn(250, 0, 0, 0);
    this.cameras.main.setBounds(0, 0, W, H);
    this.physics.world.setBounds(0, 0, W, H);
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
    // fresh maps/arrays: display objects were destroyed on shutdown
    this.players.clear();
    this.bullets.clear();
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
    this.add.image(480, 300, 'vignette').setDisplaySize(960, 600).setScrollFactor(0).setDepth(9)
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
    if (!lowQ) this.add.tileSprite(480, 300, 960, 600, 'scan').setAlpha(0.35).setScrollFactor(0).setDepth(9);

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,R,E,ONE,TWO,THREE,FOUR,F,TAB') as any;
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
      kb.on('keydown-TAB', () => this.toggleBoard());
      kb.on('keydown-F', () => {
        Session.room?.send('melee');
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
      const next = owned[(owned.indexOf(me?.weapon) + 1) % owned.length];
      Session.room?.send('switch', { weapon: next });
    });
    // HP bar (top-left): metallic frame, ghost damage trail, gloss, segment ticks
    this.hpFrame = this.add.rectangle(10, 12, 232, 26, 0x0b1220, 0.85).setOrigin(0, 0.5)
      .setStrokeStyle(1.5, 0x22d3ee, 0.6).setScrollFactor(0).setDepth(10);
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
      fontFamily: MONO, fontSize: '11px', color: '#64748b',
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    this.dispHp = 100; this.ghostHp = 100;
    this.paintHp(100, 100);
    if (this.lowPulse) { this.lowPulse.stop(); this.lowPulse = null; }
    this.dispHp = 100; this.ghostHp = 100;
    // red edge flash on damage
    this.dmgVin = this.add.image(480, 300, 'vignette').setTint(0xef4444)
      .setDisplaySize(960, 600).setScrollFactor(0).setDepth(8).setAlpha(0);
    // ammo readout (bottom-right, above minimap): glass card
    const ammoCard = this.add.graphics().setScrollFactor(0).setDepth(9);
    ammoCard.fillStyle(0x020617, 0.68);
    ammoCard.fillRoundedRect(796, 340, 160, 96, 12);
    ammoCard.fillStyle(0xffffff, 0.05);
    ammoCard.fillRoundedRect(798, 342, 156, 34, 10);
    ammoCard.lineStyle(1.5, 0x22d3ee, 0.35);
    ammoCard.strokeRoundedRect(796, 340, 160, 96, 12);
    this.add.image(872, 372, 'gun').setScale(0.8).setScrollFactor(0).setDepth(10).setAlpha(0.9);
    this.ammoTitle = this.add.text(950, 352, 'PISTOL', {
      fontFamily: COND, fontSize: '14px', fontStyle: '700', color: '#94a3b8',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(10);
    this.ammoCount = this.add.text(950, 366, '12/12', {
      fontFamily: COND, fontSize: '32px', fontStyle: '700', color: '#fff',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(10);
    this.ammoCount.setStroke('#020617', 5);
    this.ammoCount.setShadow(0, 0, '#22d3ee', 10, false, true);
    this.ammoHint = this.add.text(950, 402, 'R reload · 1/2 swap', {
      fontFamily: BODY, fontSize: '12px', color: '#64748b',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(10);
    // reload progress bar under the ammo readout
    this.add.rectangle(950, 420, 110, 5, 0x000000, 0.55).setOrigin(1, 0).setScrollFactor(0).setDepth(10);
    this.reloadBar = this.add.rectangle(950, 420, 0, 5, 0xfb923c).setOrigin(1, 0).setScrollFactor(0).setDepth(11);
    // tappable RELOAD button (touch + mouse; R key works too)
    this.reloadBg = this.add.rectangle(895, 448, 110, 30, 0x0b1220, 0.92)
      .setStrokeStyle(1.5, 0xeab308, 0.9).setScrollFactor(0).setDepth(10);
    this.reloadTx = this.add.text(895, 448, '⟳ RELOAD', {
      fontFamily: COND, fontSize: '15px', fontStyle: '700', color: '#facc15',
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
    clockCard.lineStyle(1.5, 0xfacc15, 0.45);
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
    this.wantedText = this.add.text(480, 66, '', {
      fontFamily: COND, fontSize: '16px', fontStyle: '700', color: '#facc15',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(11);
    this.wantedText.setStroke('#000000', 3);
    this.roundText = this.add.text(480, 88, '', {
      fontFamily: BODY, fontSize: '12px', fontStyle: '700', color: '#94a3b8',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(11);
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
    mmFrame.lineStyle(1.5, 0x22d3ee, 0.55);
    mmFrame.strokeRoundedRect(795, 471, 160, 122, 10);
    mmFrame.lineStyle(1, 0xffffff, 0.10);
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
      // clicks on HUD buttons belong to the buttons, not the trigger
      if (this.grabBtn?.c.visible
        && Math.abs(pt.x - 480) < 130 && Math.abs(pt.y - 556) < 45) return;
      if (Math.abs(pt.x - 895) < 60 && Math.abs(pt.y - 448) < 20) return; // reload btn
      if (pt.leftButtonDown()) {
        this.firing = true;
        this.fireNow();
      }
    });
    this.input.on('pointerup', () => { this.firing = false; });
    this.input.on('gameout', () => { this.firing = false; });
  }

  private ownWeapon(): string {
    const me = (Session.room as any)?.state?.players.get(this.meId);
    return me?.weapon === 'rifle' ? 'rifle' : 'pistol';
  }

  private fireNow() {
    const room = Session.room;
    if (!room || (room as any).state?.phase !== 'playing') return;
    const me = this.players.get(this.meId);
    if (!me) return;
    const w = WEAPONS[this.ownWeapon()] || WEAPONS.pistol;
    const now = this.time.now / 1000;
    if (now - this.lastFire < w.interval) return;
    this.lastFire = now;
    const pt = this.input.activePointer;
    const wp = this.cameras.main.getWorldPoint(pt.x, pt.y);
    const ang = Math.atan2(wp.y - me.gfx.y, wp.x - me.gfx.x);
    room.send('shoot', { angle: ang });
    if (this.ownWeapon() === 'rifle') sfx.shootRifle(); else sfx.shootPistol();
    this.flash(me.gfx.x + Math.cos(ang) * MUZZLE, me.gfx.y + Math.sin(ang) * MUZZLE, ang, false);
    this.recoil(me.gun);
    this.cameras.main.shake(60, 0.0015);
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

  private flash(x: number, y: number, ang: number, big: boolean) {
    const f = this.add.image(x, y, 'muzzle').setBlendMode(Phaser.BlendModes.ADD)
      .setRotation(ang).setDepth(7).setScale(big ? 1.3 : 0.8);
    this.time.delayedCall(60, () => f.destroy());
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
        .setStrokeStyle(1, 0x22d3ee, 0.35);
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
      const sh = this.add.image(0, 11, 'shadow').setAlpha(0.8);
      const ring = this.add.image(0, 0, 'ring').setVisible(false);
      const ringB = this.add.image(0, 0, 'ring').setTint(0x38bdf8).setVisible(false);
      const bootL = this.add.image(-7, 8, 'boot');
      const bootR = this.add.image(7, 8, 'boot');
      const legs = this.add.container(0, 0, [bootL, bootR]);
      const body = this.add.image(0, 0, avatarTex(this, mine ? 'me' : 'foe', idx));
      const gun = this.add.image(8, 0, 'gun');
      gun.setOrigin(0.15, 0.5);
      const label = this.add.text(-20, -36, p.name, { fontSize: '13px', fontStyle: '700', color: '#fff', fontFamily: COND });
      label.setStroke('#020617', 4);
      label.setShadow(0, 0, mine ? '#22d3ee' : '#ef4444', 6, false, true);
      const gfx = this.add.container(p.x, p.y, [sh, legs, ring, ringB, body, gun, label]);
      this.players.set(id, {
        gfx, body, gun, label, ring, ringB, legs, bootL, bootR, stepPhase: Math.random() * 6,
        tx: p.x, ty: p.y, sx: p.x, sy: p.y, hp: p.hp, alive: p.alive,
        shield: p.shield || 0, shieldPts: p.shieldPts || 0, speedT: p.speedT || 0,
      });
      if (!p.alive) body.setTint(0x666677);
      p.onChange(() => {
        if (!live()) return;
        const o = this.players.get(id);
        if (!o) return;
        o.tx = p.x; o.ty = p.y;
        o.sx = p.x; o.sy = p.y;
        o.shield = p.shield || 0;
        o.shieldPts = p.shieldPts || 0;
        o.speedT = p.speedT || 0;
        o.gfx.setRotation(0);
        o.gun.setRotation(p.angle);
        o.label.setText(`${p.name} ${p.hp}${o.speedT > 0 ? ' ⚡' : ''}${o.shieldPts > 0 ? ' 🛡' : ''}`);
        if (id === this.meId) {
          this.drawHp(p.hp, p.kills);
          this.drawAmmo(p);
          this.checkStreak(p.streak);
        }
        // kill-streak aura (2+): golden ring under hot players; blue ring while shielded
        o.ring.setVisible(p.streak >= 2 && p.alive);
        o.ringB.setVisible(p.shieldPts > 0 && p.alive);
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
      const img = this.add.image(b.x, b.y, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(5);
      if (foe) img.setTint(0xfb923c);
      img.setRotation(Math.atan2(b.vy, b.vx));
      img.setScale(2.1, 0.85); // stretched tracer hides spawn pop
      this.bullets.set(id, { img });
      // muzzle flash + recoil at the shooter's barrel
      const own = this.players.get(b.ownerId);
      if (own) {
        const a = Math.atan2(b.vy, b.vx);
        this.flash(own.gfx.x + Math.cos(a) * MUZZLE, own.gfx.y + Math.sin(a) * MUZZLE, a, false);
        this.recoil(own.gun);
      }
      b.onChange(() => { if (!live()) return; img.setPosition(b.x, b.y); img.setRotation(Math.atan2(b.vy, b.vx)); });
      b.onRemove(() => { if (!live()) return; img.destroy(); this.bullets.delete(id); });
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
      this.pingText.setText(`PING ${Math.max(0, Math.round(rtt))}`);
      this.pingText.setColor(rtt < 100 ? '#4ade80' : rtt < 200 ? '#facc15' : '#ef4444');
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
    const colors: Record<string, string> = { pistol: '#94a3b8', rifle: '#facc15', shotgun: '#fb923c', sniper: '#c084fc' };
    this.ammoTitle.setText(p.weapon.toUpperCase());
    this.ammoTitle.setColor(colors[p.weapon] || '#94a3b8');
    const left = p.weapon === 'rifle' ? p.ammo : p.weapon === 'shotgun' ? p.sammo
      : p.weapon === 'sniper' ? p.nammo : p.pammo;
    if (p.reloading) {
      this.ammoCount.setText('…');
      this.ammoCount.setColor('#fb923c');
      const total = p.weapon === 'rifle' ? 2 : W.reload;
      this.reloadBar.displayWidth = Math.max(1, 110 * (1 - Math.max(0, p.reloadLeft) / total));
    } else {
      this.reloadBar.displayWidth = 1;
      const low = left > 0 && left / W.clip <= 0.25;
      this.ammoCount.setText(low ? `LOW ${left}/${W.clip}` : `${left}/${W.clip}`);
      this.ammoCount.setColor(left === 0 ? '#ef4444' : low ? '#fb923c' : '#ffffff');
    }
    this.ammoHint.setText('R reload · 1-4 swap · F knife');
    const needReload = !p.reloading && left < W.clip;
    this.reloadBg.setAlpha(p.reloading ? 0.45 : needReload ? 1 : 0.55);
    this.reloadTx.setAlpha(p.reloading ? 0.45 : needReload ? 1 : 0.55);
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
    this.hpLabel.setText(`HP ${hp} · ${kills} K`);
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
        shotgun: 0xfb923c, sniper: 0xc084fc, shield: 0x38bdf8, speed: 0xfde047,
      };
      g.fillStyle(cols[pk.kind] ?? 0xffffff, 1);
      g.fillCircle(x0 + pk.x * s, y0 + pk.y * s, 1.8);
    });
    this.players.forEach((o, id) => {
      const px = x0 + o.gfx.x * s, py = y0 + o.gfx.y * s;
      if (!o.alive) {
        g.fillStyle(0x475569, 1);
        g.fillCircle(px, py, 2.6);
      } else {
        // GTA blip: facing wedge instead of a dot
        const a = o.gun.rotation;
        const dxm = Math.cos(a), dym = Math.sin(a);
        g.fillStyle(id === this.meId ? 0x22d3ee : 0xef4444, 1);
        g.fillTriangle(
          px + dxm * 4.6, py + dym * 4.6,
          px - dym * 2.6 - dxm * 2.4, py + dxm * 2.6 - dym * 2.4,
          px + dym * 2.6 - dxm * 2.4, py - dxm * 2.6 - dym * 2.4,
        );
      }
    });
    g.lineStyle(1.5, 0x22d3ee, 0.6);
    g.strokeRect(x0, y0, 150, h);
  }

  private buildPickup(kind: string) {
    let inner: Phaser.GameObjects.GameObject[];
    if (kind === 'health') {
      const glow = this.add.image(0, 0, 'glow').setTint(0x22c55e).setAlpha(0.5);
      const h1 = this.add.rectangle(0, 0, 20, 7, 0x22c55e);
      const h2 = this.add.rectangle(0, 0, 7, 20, 0x22c55e);
      inner = [glow, h1, h2];
    } else if (kind === 'ammo') {
      const box = this.add.rectangle(0, 0, 18, 13, 0xeab308).setStrokeStyle(2, 0x92400e);
      inner = [box];
    } else { // rifle / shotgun / sniper: gold ring + tinted rifle
      const tints: Record<string, number> = { rifle: 0xffffff, shotgun: 0xfb923c, sniper: 0xc084fc };
      const ring = this.add.image(0, 0, 'ring').setScale(0.75);
      const gun = this.add.image(0, 0, 'gun').setScale(0.9).setTint(tints[kind] ?? 0xffffff);
      inner = [ring, gun];
    }
    if (kind === 'shield' || kind === 'speed') {
      const ring = this.add.image(0, 0, 'ring').setScale(0.7)
        .setTint(kind === 'shield' ? 0x38bdf8 : 0xfde047);
      const dot = this.add.image(0, 0, 'dot').setScale(1.6)
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
    let near = false;
    if (st && me && st.phase === 'playing') {
      const already = st.players.get(this.meId)?.rifle;
      if (!already) {
        st.pickups.forEach((pk: any) => {
          if (near || pk.kind !== 'rifle' || !pk.active) return;
          const dx = me.gfx.x - pk.x, dy = me.gfx.y - pk.y;
          if (dx * dx + dy * dy < 70 * 70) near = true;
        });
      }
    }
    if (!this.grabBtn) return;
    this.grabBtn.c.setVisible(near);
    if (near) this.grabBtn.c.setAlpha(0.7 + 0.3 * Math.sin(this.time.now / 180));
  }

  private drawScore() {
    const st: any = (Session.room as any)?.state;
    if (!st) return;
    // urgency clock: gold -> orange under 30s -> pulsing red under 10s
    const t = Math.max(0, Math.ceil(st.timeLeft || 0));
    this.clockText.setText(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    this.clockText.setColor(t <= 10 ? '#ef4444' : t <= 30 ? '#fb923c' : '#facc15');
    this.clockText.setScale(t <= 10 ? 1.18 : 1);
    // ranked ticker: #rank name K/D + kill-target race line
    const rows: Array<{ name: string; kills: number; deaths: number; damage: number; id: string }> = [];
    st.players.forEach((p: any, id: string) => rows.push({
      name: p.name, kills: p.kills || 0, deaths: p.deaths || 0, damage: p.damage || 0, id,
    }));
    rows.sort((a, b) => b.kills - a.kills || b.damage - a.damage);
    const target = st.killTarget || 15;
    const lead = rows[0];
    this.scoreText.setText(rows.map((r, i) => `#${i + 1} ${r.name} ${r.kills}K/${r.deaths}D`).join('\n'));
    this.roundText.setText(lead && lead.kills > 0
      ? `TARGET ${target} · ${lead.name} LEADS ${lead.kills}K`
      : `FIRST TO ${target} KILLS`);
    let myCash = 0, myStreak = 0;
    st.players.forEach((p: any, id: string) => {
      if (id === this.meId) { myCash = p.cash || 0; myStreak = p.streak || 0; }
    });
    this.cashText.setText('$' + myCash.toLocaleString('en-US'));
    // GTA wanted level from your streak (cap 5)
    const stars = Math.min(5, myStreak);
    this.wantedText.setText(stars > 0 ? '★'.repeat(stars) + '☆'.repeat(5 - stars) : '');
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
    rows.slice(0, 6).forEach((r, i) => {
      this.add.text(cx, cy - 80 + i * 22,
        `${r.name === mvp ? '★ ' : '#' + (i + 1) + ' '}${r.name}   ${r.kills}K/${r.deaths}D   ${r.damage} DMG   ${acc(r)}`, {
          fontFamily: MONO, fontSize: '14px', color: r.name === mvp ? '#facc15' : '#e2e8f0',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(21);
    });
    this.add.text(cx, cy + 62, `kill target ${st?.killTarget || 15} · rematch for a new game`, { fontFamily: BODY, fontSize: '13px', fontStyle: '600', color: '#94a3b8' }).setOrigin(0.5).setScrollFactor(0).setDepth(21);
    if (Session.isHost) {
      makeButton(this, {
        tex: 'btn220', x: cx, y: cy + 104, tint: 0x2563eb, label: 'REMATCH', fontSize: 15,
        depth: 21, scroll: true,
        onClick: () => Session.room?.send('rematch'),
      });
    } else {
      this.add.text(cx, cy + 96, 'waiting for host…', { fontFamily: BODY, fontSize: '16px', fontStyle: '600', color: '#fff' }).setOrigin(0.5).setScrollFactor(0).setDepth(21);
    }
    const leave = this.add.text(cx, cy + 136, 'leave to menu', {
      fontFamily: BODY, fontSize: '13px', color: '#64748b',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);
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
    const h = 120 + rows.length * 24;
    this.board.add(this.add.rectangle(0, 0, 480, h, 0x020617, 0.94)
      .setStrokeStyle(1.5, 0x22d3ee, 0.6));
    this.board.add(this.add.text(0, -h / 2 + 24, `SCOREBOARD · FIRST TO ${target} (TAB to close)`, {
      fontFamily: MONO, fontSize: '15px', fontStyle: '700', color: '#facc15',
    }).setOrigin(0.5));
    rows.forEach((r, i) => {
      const acc = r.shots > 0 ? Math.round((r.hits / r.shots) * 100) + '%' : '—';
      this.board!.add(this.add.text(0, -h / 2 + 52 + i * 24,
        `#${i + 1}  ${r.name}${r.id === this.meId ? ' ← YOU' : ''}   ${r.kills}K / ${r.deaths}D   ${r.damage} DMG   ${acc}`, {
          fontFamily: MONO, fontSize: '14px', color: i === 0 ? '#4ade80' : '#e2e8f0',
        }).setOrigin(0.5));
    });
  }

  update(_t: number, dtMs: number) {
    const dt = dtMs / 1000;
    const playing = (Session.room as any)?.state?.phase === 'playing';
    const me = this.players.get(this.meId);
    // idle breathing for every soldier (phase-shifted per player) + streak-ring pulse
    // + walk cycle: legs swing toward movement, feet alternate while running
    // + spawn-shield shimmer for the protected
    this.players.forEach((o, id) => {
      let h = 0;
      for (let i = 0; i < id.length; i++) h = ((h * 31 + id.charCodeAt(i)) >>> 0);
      o.body.setScale(1 + 0.018 * Math.sin(_t / 380 + h));
      if (o.alive && o.shield > 0) {
        o.gfx.setAlpha(0.6 + 0.3 * Math.sin(_t / 130 + h));
      } else if (o.alive && o.gfx.alpha !== 1) {
        o.gfx.setAlpha(1);
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
      const pt = this.input.activePointer;
      const wp = this.cameras.main.getWorldPoint(pt.x, pt.y);
      const ang = Math.atan2(wp.y - me.gfx.y, wp.x - me.gfx.x);
      this.lastAim = ang;
      // client prediction (shared stepMove integrator: walls + ice drift like server)
      const mult = me.speedT > 0 ? 1.4 : 1;
      const s = stepMove(me.gfx.x, me.gfx.y, this.myVel.x, this.myVel.y,
        dx, dy, dt, this.solids(), inRect(me.gfx.x, me.gfx.y, ICE), mult);
      me.gfx.x = s.x; me.gfx.y = s.y;
      this.myVel = { x: s.vx, y: s.vy };
      me.tx = me.gfx.x; me.ty = me.gfx.y;
      me.gun.setRotation(ang);
      this.cameras.main.startFollow(me.gfx, true, 0.15, 0.15);
      this.cameras.main.setZoom(1);
      (this as any)._acc = ((this as any)._acc || 0) + dt;
      if ((this as any)._acc > 1 / 20) {
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
    // interpolate remotes
    this.players.forEach((o, id) => {
      if (id === this.meId) return;
      o.gfx.x += (o.tx - o.gfx.x) * Math.min(1, dt * 12);
      o.gfx.y += (o.ty - o.gfx.y) * Math.min(1, dt * 12);
    });
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
      this.compassText.setText(`HDG ${String(deg).padStart(3, '0')} · ${dirs[Math.round(deg / 45) % 8]}`);
    }
    // minimap 2x/sec + river shimmer
    (this as any)._mm = ((this as any)._mm || 0) + dt;
    if ((this as any)._mm > 0.5) {
      (this as any)._mm = 0;
      this.drawMinimap();
    }
    for (const w of this.waterTiles) w.tilePositionX += dt * 12;
    // fps meter (?fps=1)
    if (this.fpsText) {
      this.fpsAcc += dt; this.fpsN++;
      if (this.fpsAcc >= 1) {
        const fps = Math.round(this.fpsN / this.fpsAcc);
        this.fpsText.setText(`${fps} FPS`);
        this.fpsText.setColor(fps >= 50 ? '#4ade80' : fps >= 30 ? '#facc15' : '#ef4444');
        this.fpsAcc = 0; this.fpsN = 0;
      }
    }
  }
}
