import Phaser from 'phaser';
import { Session, fetchLobbies, randomName } from '../net/Session';
import { ensureTextures } from '../textures';
import { makeButton, modal, toast, VERSION, quality, setQuality } from '../ui';
import { sfx } from '../audio';
import { BODY, COND, displayText, kicker } from '../fonts';

export class MenuScene extends Phaser.Scene {
  private errText!: Phaser.GameObjects.Text;
  private listObjs: Phaser.GameObjects.GameObject[] = [];
  private listing = false;

  constructor() { super('menu'); }

  create() {
    ensureTextures(this);
    this.cameras.main.fadeIn(250, 0, 0, 0);
    this.listing = false;
    // backdrop: stretched gradient + grain + grid + drifting glow orbs + embers
    this.add.image(480, 300, 'menubg').setDisplaySize(960, 600);
    const grid = this.add.graphics().setDepth(1).setAlpha(0.5);
    grid.lineStyle(1, 0x22d3ee, 0.07);
    for (let gx = 0; gx <= 960; gx += 48) grid.lineBetween(gx, 0, gx, 600);
    for (let gy = 0; gy <= 600; gy += 48) grid.lineBetween(0, gy, 960, gy);
    this.add.tileSprite(480, 300, 960, 600, 'noise').setAlpha(0.35);
    const orbC = this.add.image(180, 420, 'halo').setTint(0x22d3ee)
      .setBlendMode(Phaser.BlendModes.ADD).setScale(5, 5).setAlpha(0.16).setDepth(1);
    const orbA = this.add.image(790, 400, 'halo').setTint(0xf59e0b)
      .setBlendMode(Phaser.BlendModes.ADD).setScale(4, 4).setAlpha(0.13).setDepth(1);
    this.tweens.add({
      targets: orbC, x: 220, y: 380, alpha: 0.22,
      duration: 5200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    this.tweens.add({
      targets: orbA, x: 750, y: 440, alpha: 0.18,
      duration: 6200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    this.add.particles(0, 0, 'dot', {
      x: { min: 40, max: 920 },
      y: 620,
      lifespan: 3800,
      speedY: { min: -60, max: -25 },
      speedX: { min: -12, max: 12 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 0.7, end: 0 },
      tint: [0x22d3ee, 0xf59e0b, 0x64748b],
      frequency: 140,
    }).setDepth(1);

    const title = displayText(this, 480, 106, 'LIGHT SHOOTER', 54);
    this.tweens.add({ targets: title, y: 100, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    kicker(this, 480, 60, 'T A C T I C A L   8 P   C O M B A T');
    const titleHalo = this.add.image(480, 106, 'halo').setTint(0x22d3ee)
      .setBlendMode(Phaser.BlendModes.ADD).setScale(9, 2.2).setAlpha(0.35).setDepth(1);
    this.tweens.add({
      targets: titleHalo, alpha: 0.55, scaleX: 9.6,
      duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    // war-room radar (decorative sweep + drifting contacts)
    const rx = 842, ry = 96, rr = 56;
    const radar = this.add.graphics().setDepth(2);
    radar.lineStyle(1.5, 0x22d3ee, 0.5);
    for (const r of [rr, rr * 0.66, rr * 0.33]) radar.strokeCircle(rx, ry, r);
    radar.lineBetween(rx - rr, ry, rx + rr, ry);
    radar.lineBetween(rx, ry - rr, rx, ry + rr);
    const sweep = this.add.rectangle(rx, ry, rr, 3, 0x22d3ee, 0.7).setOrigin(0, 0.5).setDepth(2);
    this.tweens.add({ targets: sweep, angle: '+=360', duration: 3200, repeat: -1 });
    for (let i = 0; i < 4; i++) {
      const b = this.add.circle(
        rx + Phaser.Math.Between(-rr + 8, rr - 8),
        ry + Phaser.Math.Between(-rr + 8, rr - 8), 3, i % 2 ? 0xef4444 : 0x4ade80, 0.9,
      ).setDepth(2);
      this.tweens.add({ targets: b, alpha: 0.15, duration: 900 + i * 250, yoyo: true, repeat: -1 });
    }
    const sub = this.add.text(480, 150, '8 - P L A Y E R   R E A L T I M E   A R E N A', {
      fontFamily: BODY, fontSize: '16px', fontStyle: '600', color: '#7dd3fc',
    }).setOrigin(0.5).setDepth(2);
    sub.setStroke('#020617', 4);
    // neon title underline: cyan core fading to the edges
    const ul = this.add.graphics().setDepth(2);
    ul.fillStyle(0x22d3ee, 0.15);
    ul.fillRoundedRect(280, 132, 400, 5, 2);
    ul.fillStyle(0x22d3ee, 0.9);
    ul.fillRoundedRect(380, 132, 200, 5, 2);
    ul.fillStyle(0xffffff, 0.7);
    ul.fillRoundedRect(380, 132, 200, 1.5, 1);
    // glass CTA card behind the buttons
    const card = this.add.graphics().setDepth(1);
    card.fillStyle(0x020617, 0.55);
    card.fillRoundedRect(292, 232, 376, 164, 18);
    card.lineStyle(1.5, 0x22d3ee, 0.28);
    card.strokeRoundedRect(292, 232, 376, 164, 18);
    card.lineStyle(1, 0xffffff, 0.08);
    card.beginPath();
    card.moveTo(306, 240); card.lineTo(654, 240);
    card.strokePath();

    // callsign entry (F1: player name + random generator, persisted).
    // Wrapped defensively: menu must render even if DOM overlay is unavailable.
    try {
      this.add.text(300, 204, 'CALLSIGN', {
        fontFamily: BODY, fontSize: '15px', fontStyle: '700', color: '#94a3b8',
      }).setOrigin(0, 0.5).setDepth(2);
      const input = document.createElement('input');
      input.value = Session.name;
      input.maxLength = 12;
      input.placeholder = 'Your name';
      input.autocomplete = 'off';
      input.style.cssText = 'width:230px;height:34px;background:#0f172a;color:#fff;border:1px solid rgba(34,211,238,.45);'
        + 'border-radius:8px;padding:0 10px;font:600 16px Rajdhani,sans-serif;letter-spacing:1px;outline:none;';
      input.addEventListener('change', () => {
        Session.setName(input.value);
        input.value = Session.name;
      });
      this.add.dom(500, 204, input).setDepth(2);
      this.add.image(262, 204, 'soldier_me').setScale(0.85).setDepth(2);
    const dice = this.add.text(648, 204, '🎲', { fontSize: '24px' }).setOrigin(0, 0.5).setDepth(2);
      dice.setInteractive({ useHandCursor: true });
      dice.on('pointerdown', () => {
        Session.setName(randomName());
        input.value = Session.name;
      });
    } catch (e) {
      console.warn('callsign input unavailable, using generated name', e);
    }

    makeButton(this, {
      tex: 'btn320', x: 480, y: 280, tint: 0x16a34a, label: 'CREATE LOBBY', fontSize: 17,
      onClick: async () => {
        this.errText.setText('');
        try {
          await Session.createLobby();
          this.scene.start('lobby');
        } catch (e: any) {
          this.errText.setText('create failed: ' + (e?.message || e));
        }
      },
    });

    makeButton(this, {
      tex: 'btn320', x: 480, y: 352, tint: 0x2563eb, label: 'JOIN LOBBY', fontSize: 17,
      onClick: () => this.showLobbies(),
    });

    this.add.text(480, 410, 'create a lobby, share the code, host starts the game', {
      fontFamily: BODY, fontSize: '15px', color: '#94a3b8',
    }).setOrigin(0.5).setDepth(2);

    this.errText = this.add.text(480, 438, '', {
      fontFamily: BODY, fontSize: '14px', color: '#f87171',
    }).setOrigin(0.5).setDepth(2);
    // footer: settings / how-to / credits + version
    const foot = (x: number, label: string, fn: () => void) => {
      const t = this.add.text(x, 578, label, {
        fontFamily: COND, fontSize: '15px', fontStyle: '700', color: '#64748b',
      }).setOrigin(0.5).setDepth(2);
      t.setStroke('#020617', 3);
      t.setInteractive({ useHandCursor: true });
      t.on('pointerover', () => t.setColor('#22d3ee'));
      t.on('pointerout', () => t.setColor('#64748b'));
      t.on('pointerdown', () => { sfx.click(); fn(); });
    };
    foot(380, '⚙ SETTINGS', () => this.openSettings());
    foot(500, '❓ HOW TO PLAY', () => this.openHow());
    foot(630, '© CREDITS', () => this.openCredits());
    this.add.text(14, 584, `v${VERSION}`, {
      fontFamily: BODY, fontSize: '12px', color: '#475569',
    }).setOrigin(0, 0.5).setDepth(2);
    // live lobby ticker (real data, refreshed)
    const live = this.add.text(946, 584, '', {
      fontFamily: BODY, fontSize: '12px', fontStyle: '700', color: '#4ade80',
    }).setOrigin(1, 0.5).setDepth(2);
    const pingLobbies = async () => {
      try {
        const ls = await fetchLobbies();
        const n = ls.reduce((a, l) => a + l.players, 0);
        live.setText(`● ${ls.length} LOBBIES · ${n} PLAYERS ONLINE`);
      } catch { live.setText(''); }
    };
    void pingLobbies();
    this.time.addEvent({ delay: 5000, loop: true, callback: () => void pingLobbies() });
    // deep link: ?room=CODE joins instantly (F11 shareable URL)
    try {
      const rc = new URLSearchParams(location.search).get('room');
      if (rc && !Session.room) {
        history.replaceState({}, '', location.pathname);
        this.errText.setText('joining shared lobby…');
        Session.joinLobby(rc).then(
          () => this.scene.start('lobby'),
          () => this.showError('LINK EXPIRED', 'That lobby is gone. Create a new one!'),
        );
      }
    } catch { /* non-browser env */ }
    void sub;
  }

  private linkButton(parent: Phaser.GameObjects.Container, x: number, y: number, label: string, selected: boolean, fn: () => void) {    const t = this.add.text(x, y, label, {
      fontFamily: COND, fontSize: '17px', fontStyle: '700', color: selected ? '#22d3ee' : '#64748b',
    }).setOrigin(0.5);
    t.setInteractive({ useHandCursor: true });
    t.on('pointerdown', fn);
    parent.add(t);
    return t;
  }

  private openSettings() {
    const m = modal(this, 'SETTINGS', 520, 360);
    const y0 = -110;
    m.body.add(this.add.text(-220, y0, 'GRAPHICS', {
      fontFamily: BODY, fontSize: '15px', fontStyle: '700', color: '#94a3b8',
    }).setOrigin(0, 0.5));
    const q = quality();
    this.linkButton(m.body, 120, y0, 'HIGH', q === 'high', () => { setQuality('high'); m.close(); this.openSettings(); });
    this.linkButton(m.body, 190, y0, 'LOW', q === 'low', () => { setQuality('low'); m.close(); this.openSettings(); });
    m.body.add(this.add.text(-220, y0 + 40, 'SOUND', {
      fontFamily: BODY, fontSize: '15px', fontStyle: '700', color: '#94a3b8',
    }).setOrigin(0, 0.5));
    this.linkButton(m.body, 120, y0 + 40, sfx.muted ? 'OFF' : 'ON', !sfx.muted, () => {
      sfx.setMuted(!sfx.muted); m.close(); this.openSettings();
    });
    this.linkButton(m.body, 170, y0 + 40, '−', false, () => {
      sfx.setVolume(sfx.volume - 0.1); sfx.click(); m.close(); this.openSettings();
    });
    const vol = this.add.text(205, y0 + 40, `${Math.round(sfx.volume * 100)}%`, {
      fontFamily: BODY, fontSize: '16px', fontStyle: '700', color: '#e2e8f0',
    }).setOrigin(0.5);
    m.body.add(vol);
    this.linkButton(m.body, 240, y0 + 40, '+', false, () => {
      sfx.setVolume(sfx.volume + 0.1); sfx.click(); m.close(); this.openSettings();
    });
    m.body.add(this.add.text(-220, y0 + 80, 'CONTROLS', {
      fontFamily: BODY, fontSize: '15px', fontStyle: '700', color: '#94a3b8',
    }).setOrigin(0, 0.5));
    const ctl = this.add.text(-60, y0 + 80,
      'move WASD/arrows · aim mouse · fire click(hold)\nR reload · 1/2 or wheel swap · E interact',
      { fontFamily: BODY, fontSize: '14px', color: '#e2e8f0', lineSpacing: 4 }).setOrigin(0, 0.5);
    m.body.add(ctl);
    this.linkButton(m.body, 0, y0 + 140, 'RESET CALLSIGN', false, () => {
      Session.setName(randomName()); toast(this, 'callsign: ' + Session.name); m.close();
    });
  }

  private openHow() {
    const m = modal(this, 'HOW TO PLAY', 560, 400);
    const rows = [
      ['✋', 'Move with WASD or arrow keys.'],
      ['🖱️', 'Aim with the mouse, hold click to fire.'],
      ['🔫', 'Grab rifles/shotguns/snipers with E — R reloads, 1-4 or wheel swaps.'],
      ['🔪', 'F is a knife: 50 damage up close, 0.8s cooldown.'],
      ['✚', 'Green crosses heal 50 HP. Yellow boxes refill ammo.'],
      ['🧱', 'Orange bricks crumble under fire. Silver steel never does.'],
      ['🌊', 'Rivers block you (not bullets). Ice is slippery. Bushes hide you.'],
      ['🏆', 'Most kills at the whistle — or first to the kill target — wins.'],
    ];
    rows.forEach(([icon, txt], i) => {
      m.body.add(this.add.text(-240, -130 + i * 38, `${icon}   ${txt}`, {
        fontFamily: BODY, fontSize: '16px', color: '#e2e8f0',
      }).setOrigin(0, 0.5));
    });
  }

  private openCredits() {
    const m = modal(this, 'CREDITS', 480, 260);
    m.body.add(this.add.text(0, -60,
      '8P LIGHT SHOOTER\nbuilt with Phaser 3 + Colyseus\nprocedural art · zero downloads', {
        fontFamily: BODY, fontSize: '16px', color: '#e2e8f0', align: 'center', lineSpacing: 6,
      }).setOrigin(0.5));
    m.body.add(this.add.text(0, 40, `v${VERSION} · thanks for playing`, {
      fontFamily: BODY, fontSize: '14px', color: '#64748b',
    }).setOrigin(0.5));
    m.body.add(this.add.text(0, 66, 'PRIVACY · TERMS (see repo root)', {
      fontFamily: BODY, fontSize: '12px', color: '#475569',
    }).setOrigin(0.5));
  }

  private showError(title: string, msg: string) {
    const m = modal(this, title, 460, 220);
    m.body.add(this.add.text(0, -30, msg, {
      fontFamily: BODY, fontSize: '16px', color: '#e2e8f0', align: 'center', wordWrap: { width: 400 },
    }).setOrigin(0.5));
    m.body.add(this.add.text(0, 55, 'full room? bad code? server hiccup.', {
      fontFamily: BODY, fontSize: '13px', color: '#64748b',
    }).setOrigin(0.5));
  }

  private clearList() {
    this.listObjs.forEach((o) => o.destroy());
    this.listObjs = [];
  }

  private async showLobbies() {
    if (this.listing) return;
    this.listing = true;
    this.errText.setText('loading lobbies…');
    let lobbies: Array<{ code: string; players: number; max: number; phase: string }> = [];
    try {
      lobbies = await fetchLobbies();
    } catch (e: any) {
      this.errText.setText('list failed, enter code manually. ' + (e?.message || e));
      this.listing = false;
      return this.askCode();
    }
    this.clearList();
    this.errText.setText(lobbies.length ? '' : 'no open lobbies — create one!');
    const rows = lobbies.slice(0, 2);
    const top = 472;
    rows.forEach((l, i) => {
      const live = l.phase === 'playing' || l.phase === 'countdown';
      const bg = this.add.rectangle(480, top + i * 32, 440, 28, live ? 0x7c2d12 : 0x0f172a, 0.92)
        .setStrokeStyle(1, live ? 0xfb923c : 0x22d3ee, 0.7).setDepth(2);
      const tx = this.add.text(480, top + i * 32,
        `${l.code}    ${l.players}/${l.max}    ${l.phase.toUpperCase()}${live ? '  ·  JOIN LIVE' : ''}`,
        { fontFamily: BODY, fontSize: '15px', color: live ? '#fdba74' : '#e2e8f0' })
        .setOrigin(0.5).setDepth(3);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => bg.setFillStyle(live ? 0x9a3412 : 0x1e293b, 0.95));
      bg.on('pointerout', () => bg.setFillStyle(live ? 0x7c2d12 : 0x0f172a, 0.92));
      bg.on('pointerdown', async () => {
        this.errText.setText('joining ' + l.code + '…');
        try {
          await Session.joinLobby(l.code);
          this.scene.start('lobby');
        } catch (e: any) {
          this.errText.setText('');
          this.showError('JOIN FAILED', String(e?.message || e));
        }
      });
      this.listObjs.push(bg, tx);
    });
    if (lobbies.length > 2) {
      const more = this.add.text(480, top + rows.length * 32, `+${lobbies.length - 2} more — type the code below`, {
        fontFamily: BODY, fontSize: '13px', color: '#64748b',
      }).setOrigin(0.5, 0).setDepth(2);
      this.listObjs.push(more);
    }
    const manual = this.add.text(480, top + rows.length * 32 + (lobbies.length > 2 ? 20 : 4),
      'have a code? click here to type it',
      { fontFamily: BODY, fontSize: '14px', color: '#22d3ee' })
      .setOrigin(0.5, 0).setDepth(2);
    manual.setInteractive({ useHandCursor: true });
    manual.on('pointerdown', () => this.askCode());
    this.listObjs.push(manual);
    this.listing = false;
  }

  private askCode() {
    const m = modal(this, 'ENTER LOBBY CODE', 480, 250);
    const input = document.createElement('input');
    input.maxLength = 16;
    input.placeholder = 'e.g. aEGlqLTIf';
    input.autocomplete = 'off';
    input.style.cssText = 'width:280px;height:40px;background:#0f172a;color:#22d3ee;text-align:center;'
      + 'border:1px solid rgba(34,211,238,.5);border-radius:8px;padding:0 10px;'
      + 'font:600 20px "Share Tech Mono",monospace;letter-spacing:2px;outline:none;';
    const holder = this.add.dom(0, -30, input);
    m.body.add(holder);
    const go = this.add.text(0, 45, 'JOIN →', {
      fontFamily: BODY, fontSize: '18px', fontStyle: '700', color: '#22d3ee',
    }).setOrigin(0.5);
    go.setInteractive({ useHandCursor: true });
    const doJoin = () => {
      const code = input.value.trim();
      if (!code) return;
      m.close();
      this.errText.setText('joining…');
      Session.joinLobby(code).then(
        () => this.scene.start('lobby'),
        (e: any) => {
          this.errText.setText('');
          this.showError('JOIN FAILED', String(e?.message || e));
        },
      );
    };
    go.on('pointerdown', doJoin);
    input.addEventListener('keydown', (ev) => { if ((ev as KeyboardEvent).key === 'Enter') doJoin(); });
    m.body.add(go);
    this.time.delayedCall(100, () => { try { input.focus(); } catch { /* noop */ } });
  }
}

