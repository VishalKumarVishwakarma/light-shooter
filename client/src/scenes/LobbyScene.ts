import Phaser from 'phaser';
import { Session } from '../net/Session';
import { ensureTextures } from '../textures';
import { makeButton, modal, toast, type Btn } from '../ui';
import { sfx } from '../audio';
import { BODY, COND, DIM, MONO, SUB, TXT, displayText, kicker } from '../fonts';
import qrcode from 'qrcode-generator';
import { STEEL, BRICKS, WATER, BUSH, SPAWNS } from '../map';

export function roomLink(code: string) {
  return `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
}

const qrOrder: string[] = [];
function qrKey(scene: Phaser.Scene, text: string) {
  const key = 'qr_' + text;
  if (scene.textures.exists(key)) return key;
  // cap the cache: lobbies come and go, GPU memory shouldn't grow forever
  if (qrOrder.length >= 20) {
    const old = qrOrder.shift()!;
    try { scene.textures.remove(old); } catch { /* already gone */ }
  }
  qrOrder.push(key);
  const qr = qrcode(0, 'M');
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

    // code pill (click to copy)
    this.add.image(480, 74, 'pill');
    this.codeText = this.add.text(480, 74, '', {
      fontFamily: MONO, fontSize: '16px', fontStyle: '700', color: '#22d3ee',
    }).setOrigin(0.5);
    this.codeText.setStroke('#020617', 3);
    this.codeText.setShadow(0, 0, '#22d3ee', 8, false, true);
    this.refreshCode(false);
    const pillHit = this.add.rectangle(480, 74, 440, 44, 0x000000, 0)
      .setStrokeStyle(1, 0x22d3ee, 0.5);
    pillHit.setInteractive({ useHandCursor: true });
    pillHit.on('pointerdown', () => {
      navigator.clipboard?.writeText(Session.code).catch(() => {});
      this.refreshCode(true);
    });
    const invite = this.add.text(706, 74, '＋ INVITE', {
      fontFamily: COND, fontSize: '15px', fontStyle: '700', color: '#22d3ee',
    }).setOrigin(0, 0.5);
    invite.setStroke('#020617', 3);
    invite.setShadow(0, 0, '#22d3ee', 8, false, true);
    invite.setInteractive({ useHandCursor: true });
    invite.on('pointerdown', () => { sfx.click(); this.openInvite(); });

    // player panel
    const panel = this.add.graphics();
    panel.fillStyle(0x0b1220, 0.88);
    panel.fillRoundedRect(230, 108, 500, 288, 14);
    panel.lineStyle(1.5, 0x22d3ee, 0.35);
    panel.strokeRoundedRect(230, 108, 500, 288, 14);
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
      this.scene.start('menu');
    });
    this.wire();
  }

  private refreshCode(copied: boolean) {
    this.codeText.setText(copied ? `CODE  ${Session.code}   ✓ COPIED` : `CODE  ${Session.code}   ⧉ CLICK TO COPY`);
  }

  private drawMapPreview(cx: number, cy: number) {
    const s = 100 / 1600, w = 100, h = 1200 * s;
    const g = this.add.graphics().setDepth(2);
    g.fillStyle(0x020617, 0.85);
    g.fillRect(cx - w / 2, cy - h / 2, w, h);
    const dot = (rc: { x: number; y: number; w: number; h: number }) =>
      g.fillRect(cx - w / 2 + rc.x * s, cy - h / 2 + rc.y * s, Math.max(1, rc.w * s), Math.max(1, rc.h * s));
    g.fillStyle(0x7dd3fc, 0.6);
    for (const rc of WATER) dot(rc);
    g.fillStyle(0xcbd5e1, 0.9);
    for (const rc of STEEL) dot(rc);
    g.fillStyle(0xc65a1e, 0.9);
    for (const rc of BRICKS) dot(rc);
    g.fillStyle(0x22c55e, 0.5);
    for (const rc of BUSH) dot(rc);
    g.fillStyle(0x4ade80, 1);
    for (const [x, y] of SPAWNS) g.fillCircle(cx - w / 2 + x * s, cy - h / 2 + y * s, 1.8);
    g.lineStyle(1, 0x22d3ee, 0.5);
    g.strokeRect(cx - w / 2, cy - h / 2, w, h);
    const cap = this.add.text(cx, cy + h / 2 + 12, 'BATTLE CITY ARENA', {
      fontFamily: COND, fontSize: '13px', fontStyle: '700', color: SUB,
    }).setOrigin(0.5, 0);
    cap.setStroke('#020617', 3);
  }

  private openInvite() {
    const code = Session.code;
    const link = roomLink(code);
    const m = modal(this, 'INVITE PLAYERS', 500, 420);
    m.body.add(this.add.image(0, -80, qrKey(this, link)).setDisplaySize(150, 150));
    const linkT = this.add.text(0, 20, link, {
      fontFamily: MONO, fontSize: '12px', color: '#7dd3fc', align: 'center', wordWrap: { width: 440 },
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
      navigator.clipboard?.writeText(link).then(
        () => toast(this, 'link copied — send it to your squad'),
        () => toast(this, 'copy blocked — long-press the link', '#f87171'),
      ).catch(() => toast(this, 'copy blocked — long-press the link', '#f87171'));
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
        navigator.clipboard?.writeText(link).catch(() => {});
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
        const icon = this.add.image(268, y, id === meId ? 'soldier_me' : 'soldier_foe').setScale(0.5);
        const crown = id === hostId ? '👑 ' : '';
        const meTag = id === meId ? '   ← YOU' : '';
        const row = this.add.text(292, y, `${crown}${p.name}${meTag}`, {
          fontFamily: BODY, fontSize: '17px', fontStyle: '700',
          color: p.ready ? '#4ade80' : TXT,
        }).setOrigin(0, 0.5);
        row.setStroke('#020617', 4);
        // big status badge + glowing status light — impossible to miss
        const dot = this.add.circle(600, y, 5, p.ready ? 0x4ade80 : 0xef4444);
        if (p.ready) {
          this.tweens.add({ targets: dot, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });
        }
        const badge = this.add.rectangle(648, y, 92, 22, p.ready ? 0x16a34a : 0x334155);
        if (p.ready) badge.setStrokeStyle(1, 0x4ade80, 0.8);
        const badgeTx = this.add.text(648, y, p.ready ? '✓ READY' : '··· WAITING', {
          fontFamily: COND, fontSize: '13px', fontStyle: '700', color: '#ffffff',
        }).setOrigin(0.5);
        badgeTx.setStroke('#020617', 3);
        // subtle slide-in for newcomers only (not on every redraw)
        if (fresh.has(id)) {
          row.setX(284).setAlpha(0);
          this.tweens.add({ targets: row, x: 292, alpha: 1, duration: 180 });
        }
        this.rowsBox.add([icon, row, dot, badge, badgeTx]);
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
    room.state.players.onAdd(draw);
    room.state.players.onRemove((_p: any, id: string) => {
      const name = known.get(id);
      known.delete(id);
      if (name) toast(this, `${name} left the lobby`, '#94a3b8');
      draw();
    });
    room.state.onChange(draw);
    room.onLeave(() => {
      Session.room = null;
      if (!this.gone) { this.gone = true; this.scene.start('menu'); }
    });
    draw();
  }

  update() {
    const phase = (Session.room as any)?.state?.phase;
    if (!Session.room) return;
    if (phase === 'playing' && !this.gone) {
      this.gone = true;
      this.scene.start('arena');
    } else if (phase === 'countdown') {
      this.statusText.setText(`starting in ${Math.ceil((Session.room as any).state.countdown)}…`);
    }
  }
}

