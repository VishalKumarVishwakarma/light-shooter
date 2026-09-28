import Phaser from 'phaser';
import { Session, fetchLobbies, randomName, CODE_RE } from '../net/Session';
import { ensureTextures } from '../textures';
import { makeButton, modal, toast, VERSION, quality, setQuality, registerUnderlay } from '../ui';
import { sfx } from '../audio';
import { BODY, COND, DIM, MONO, SUB, TXT, displayText, kicker, prose } from '../fonts';

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
      // its own slim plate, so it reads as a field in the menu and can never be
      // mistaken for (or collide with) a modal window
      const plate = this.add.graphics().setDepth(1);
      plate.fillStyle(0x020617, 0.55);
      plate.fillRoundedRect(272, 186, 424, 36, 10);
      plate.lineStyle(1.5, 0x22d3ee, 0.28);
      plate.strokeRoundedRect(272, 186, 424, 36, 10);
      const cs = this.add.text(320, 204, 'CALLSIGN', {
        fontFamily: COND, fontSize: '14px', fontStyle: '700', color: SUB,
      }).setOrigin(0, 0.5).setDepth(2);
      cs.setStroke('#020617', 3);
      cs.setShadow(0, 0, '#22d3ee', 6, false, true);
      const input = document.createElement('input');
      input.value = Session.name;
      input.maxLength = 12;
      input.placeholder = 'Your name';
      input.autocomplete = 'off';
      input.style.cssText = 'width:230px;height:30px;background:#0f172a;color:#fff;border:1px solid rgba(34,211,238,.45);'
        + 'border-radius:8px;padding:0 10px;font:600 16px Rajdhani,sans-serif;letter-spacing:1px;outline:none;';
      input.addEventListener('change', () => {
        Session.setName(input.value);
        input.value = Session.name;
      });
      // DOM elements sit in their own layer above the canvas, so depth alone
      // cannot tuck this behind a modal - register it to be hidden instead
      registerUnderlay(this.add.dom(516, 204, input).setDepth(2));
      this.add.image(292, 204, 'soldier_me').setScale(0.7).setDepth(2);
      const dice = this.add.text(662, 204, '🎲', { fontSize: '22px' }).setOrigin(0, 0.5).setDepth(2);
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

    prose(this, 480, 410, 'create a lobby, share the code, host starts the game', 15, SUB);

    this.errText = this.add.text(480, 438, '', {
      fontFamily: BODY, fontSize: '14px', fontStyle: '700', color: '#fca5a5',
    }).setOrigin(0.5).setDepth(2);
    this.errText.setStroke('#020617', 3);
    // footer: settings / how-to / credits + version
    const foot = (x: number, label: string, fn: () => void) => {
      const t = this.add.text(x, 578, label, {
        fontFamily: COND, fontSize: '15px', fontStyle: '700', color: DIM,
      }).setOrigin(0.5).setDepth(2);
      t.setStroke('#020617', 3);
      t.setInteractive({ useHandCursor: true });
      t.on('pointerover', () => t.setColor('#22d3ee'));
      t.on('pointerout', () => t.setColor(DIM));
      t.on('pointerdown', () => { sfx.click(); fn(); });
    };
    foot(380, '⚙ SETTINGS', () => this.openSettings());
    foot(500, '❓ HOW TO PLAY', () => this.openHow());
    foot(630, '© CREDITS', () => this.openCredits());
    const ver = this.add.text(14, 584, `v${VERSION}`, {
      fontFamily: COND, fontSize: '12px', fontStyle: '700', color: DIM,
    }).setOrigin(0, 0.5).setDepth(2);
    ver.setStroke('#020617', 3);
    // live lobby ticker (real data, refreshed)
    const live = this.add.text(946, 584, '', {
      fontFamily: COND, fontSize: '13px', fontStyle: '700', color: '#4ade80',
    }).setOrigin(1, 0.5).setDepth(2);
    live.setStroke('#020617', 3);
    live.setShadow(0, 0, '#4ade80', 8, false, true);
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

  private linkButton(parent: Phaser.GameObjects.Container, x: number, y: number, label: string, selected: boolean, fn: () => void) {
    const t = this.add.text(x, y, label, {
      fontFamily: COND, fontSize: '17px', fontStyle: '700', color: selected ? '#22d3ee' : DIM,
    }).setOrigin(0.5);
    t.setStroke('#020617', 3);
    if (selected) t.setShadow(0, 0, '#22d3ee', 8, false, true);
    t.setInteractive({ useHandCursor: true });
    t.on('pointerdown', fn);
    parent.add(t);
    return t;
  }

  // Modal rows are WRAPPED and stacked by their real measured height, laid
  // out in columns, and MEASURED BEFORE the panel exists so the glass can be
  // sized to the content. One plan drives both the measurement and the render,
  // so the two can never disagree about how tall a row is.
  private planRows(rows: Array<[string, string]>, w: number, size = 16, gap = 10, columns = 1) {
    const colW = (w - 52) / columns;
    const per = Math.ceil(rows.length / columns);
    const probe = this.add.text(0, 0, '', {
      fontFamily: BODY, fontSize: `${size}px`, fontStyle: '600',
      wordWrap: { width: colW - 16 }, lineSpacing: 5,
    });
    const items: Array<{ s: string; x: number; y: number; h: number }> = [];
    let tallest = 0;
    for (let c = 0; c < columns; c++) {
      let y = 0;
      for (const [icon, txt] of rows.slice(c * per, (c + 1) * per)) {
        const s = icon ? `${icon}   ${txt}` : txt;
        probe.setText(s);
        items.push({ s, x: -w / 2 + 26 + c * colW, y, h: probe.height });
        y += probe.height + gap;
      }
      tallest = Math.max(tallest, y - gap);
    }
    probe.destroy();
    return { items, height: tallest, colW };
  }

  private drawPlan(m: any, plan: ReturnType<MenuScene['planRows']>, yTop: number,
    size = 16, color = TXT) {
    for (const it of plan.items) {
      const row = this.add.text(it.x, yTop + it.y, it.s, {
        fontFamily: BODY, fontSize: `${size}px`, fontStyle: '600', color,
        wordWrap: { width: plan.colW - 16 }, lineSpacing: 5,
      }).setOrigin(0, 0);
      row.setStroke('#020617', 3);
      m.body.add(row);
    }
  }

  // vertical space a modal body actually has: below the title block, above the
  // bottom rim. The body container sits 22px below the panel centre.
  private bodyTop(h: number) {
    return -h / 2 + 92;
  }

  private openSettings() {
    const W = 520;
    // the control list used to be one 60-char line per row, which ran ~110px
    // past the right edge of a 520-wide panel
    const ctl: Array<[string, string]> = [
      ['', 'move WASD / arrows · aim with mouse · hold click to fire'],
      ['', 'wheel or 1-0 switches any slot · R reloads · Q toggles the shield'],
      ['', 'G / X / C throw now · F knife · E grabs a gun'],
    ];
    const ctlPlan = this.planRows(ctl, W, 14, 7);
    const ctlH = ctlPlan.height;
    const h = Math.min(560, Math.max(320, 150 + 40 * 2 + 26 + ctlH + 34));
    const m = modal(this, 'SETTINGS', W, h);
    const x0 = -W / 2 + 26;
    let y = this.bodyTop(h);
    const rowLabel = (yTop: number, str: string) => {
      const t = this.add.text(x0, yTop, str, {
        fontFamily: COND, fontSize: '14px', fontStyle: '700', color: SUB,
      }).setOrigin(0, 0);
      t.setStroke('#020617', 3);
      m.body.add(t);
    };
    const q = quality();
    rowLabel(y, 'GRAPHICS');
    this.linkButton(m.body, x0 + 190, y + 8, 'HIGH', q === 'high', () => { setQuality('high'); m.close(); this.openSettings(); });
    this.linkButton(m.body, x0 + 262, y + 8, 'LOW', q === 'low', () => { setQuality('low'); m.close(); this.openSettings(); });
    y += 40;
    rowLabel(y, 'SOUND');
    this.linkButton(m.body, x0 + 190, y + 8, sfx.muted ? 'OFF' : 'ON', !sfx.muted, () => {
      sfx.setMuted(!sfx.muted); m.close(); this.openSettings();
    });
    this.linkButton(m.body, x0 + 240, y + 8, '\u2212', false, () => {
      sfx.setVolume(sfx.volume - 0.1); sfx.click(); m.close(); this.openSettings();
    });
    const vol = this.add.text(x0 + 275, y + 8, `${Math.round(sfx.volume * 100)}%`, {
      fontFamily: COND, fontSize: '16px', fontStyle: '700', color: TXT,
    }).setOrigin(0.5, 0.5);
    vol.setStroke('#020617', 3);
    m.body.add(vol);
    this.linkButton(m.body, x0 + 310, y + 8, '+', false, () => {
      sfx.setVolume(sfx.volume + 0.1); sfx.click(); m.close(); this.openSettings();
    });
    y += 40;
    rowLabel(y, 'CONTROLS');
    this.drawPlan(m, ctlPlan, y + 22, 14);
    this.linkButton(m.body, 0, this.bodyTop(h) + h - 96, 'RESET CALLSIGN', false, () => {
      Session.setName(randomName()); toast(this, 'callsign: ' + Session.name); m.close();
    });
  }

  private openHow() {
    const W = 560;
    const rows: Array<[string, string]> = [
      ['✋', 'Move with WASD or arrows.'],
      ['🖱️', 'Aim with the mouse, hold click to fire.'],
      ['🔫', 'Grab guns with E. 1-0 or the wheel switches any slot.'],
      ['🔪', 'F is a knife: 50 damage, and it pierces shields.'],
      ['⚡', 'Electric gun: every hit locks them for 2.5s.'],
      ['🛡️', 'You spawn SHIELDED; a raised shield stops every bullet.'],
      ['💣', 'G/X/C throw now; slots 7/8/9 arm one, click tosses.'],
      ['🎚️', 'Guns, throwables and the shield are all switchable slots.'],
      ['✚', 'Crosses heal 50, yellow boxes refill ammo.'],
      ['🧱', 'Bricks crumble, steel never does. Rivers block you.'],
      ['🏆', 'Most kills at the whistle, or first to the target.'],
    ];
    // 12 rows on a fixed 30px pitch ran straight off the bottom of a 400-tall
    // panel. Rows are now MEASURED, the glass is sized to them, and the copy is
    // trimmed so every line fits the column on one line: no ragged wrapping.
    const plan = this.planRows(rows, W, 15, 8, 1);
    const h = Math.min(520, Math.max(300, plan.height + 132));
    const m = modal(this, 'HOW TO PLAY', W, h);
    const top = this.bodyTop(h);
    const usable = h - 92 - 24;
    this.drawPlan(m, plan, top + Math.max(0, (usable - plan.height) / 2), 15);
  }

  private openCredits() {
    const m = modal(this, 'CREDITS', 480, 260);
    const cred = this.add.text(0, -60,
      '8P LIGHT SHOOTER\nbuilt with Phaser 3 + Colyseus\nprocedural art · zero downloads', {
        fontFamily: BODY, fontSize: '16px', fontStyle: '600', color: TXT, align: 'center', lineSpacing: 6,
      }).setOrigin(0.5);
    cred.setStroke('#020617', 3);
    m.body.add(cred);
    const cv = this.add.text(0, 40, `v${VERSION} · thanks for playing`, {
      fontFamily: COND, fontSize: '15px', fontStyle: '700', color: SUB,
    }).setOrigin(0.5);
    cv.setStroke('#020617', 3);
    m.body.add(cv);
    m.body.add(this.add.text(0, 66, 'PRIVACY · TERMS (see repo root)', {
      fontFamily: BODY, fontSize: '12px', color: DIM,
    }).setOrigin(0.5));
  }

  private showError(title: string, msg: string) {
    const m = modal(this, title, 460, 220);
    const em = this.add.text(0, -30, msg, {
      fontFamily: BODY, fontSize: '16px', fontStyle: '600', color: TXT, align: 'center', wordWrap: { width: 400 },
    }).setOrigin(0.5);
    em.setStroke('#020617', 3);
    m.body.add(em);
    m.body.add(this.add.text(0, 55, 'full room? bad code? server hiccup.', {
      fontFamily: BODY, fontSize: '13px', color: DIM,
    }).setOrigin(0.5));
  }

  private clearList() {
    // kill the tweens first. Phaser never removes a tween because its target
    // was destroyed, and the LIVE chips run `repeat: -1`, so every rebuild left
    // a looping tween stepping a dead object for the rest of the session.
    this.listObjs.forEach((o) => { this.tweens.killTweensOf(o); o.destroy(); });
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
    } finally {
      // one-way latch: anything thrown while rendering the rows used to leave
      // `listing` true, and every later click on JOIN LOBBY was a silent no-op
      this.listing = false;
    }
    this.clearList();
    this.errText.setText(lobbies.length ? '' : 'no open lobbies — create one!');
    const rows = lobbies.slice(0, 2);
    const top = 472;
    rows.forEach((l, i) => {
      const live = l.phase === 'playing' || l.phase === 'countdown';
      const y = top + i * 32;
      // drop plate + glass row + neon rim
      this.listObjs.push(this.add.rectangle(480, y + 2, 444, 30, 0x020617, 0.6).setDepth(1));
      const bg = this.add.rectangle(480, y, 440, 28, live ? 0x7c2d12 : 0x0f172a, 0.94)
        .setStrokeStyle(2, live ? 0xfb923c : 0x22d3ee, 0.8).setDepth(2);
      const code = this.add.text(288, y, l.code, {
        fontFamily: MONO, fontSize: '15px', fontStyle: '700', color: live ? '#fdba74' : '#7dd3fc',
      }).setOrigin(0, 0.5).setDepth(3);
      code.setStroke('#020617', 3);
      // headcount pips: filled = seated, hollow = open
      const pips = this.add.graphics().setDepth(3);
      for (let k = 0; k < l.max; k++) {
        const px = 470 + k * 13;
        if (k < l.players) {
          pips.fillStyle(live ? 0xfb923c : 0x4ade80, 1);
          pips.fillCircle(px, y, 4);
        } else {
          pips.lineStyle(1.5, 0x475569, 1);
          pips.strokeCircle(px, y, 4);
        }
      }
      // phase chip (right): LIVE pulses on running games
      const chipCol = l.phase === 'playing' ? '#ef4444' : l.phase === 'countdown' ? '#facc15' : '#4ade80';
      const chipBg = this.add.rectangle(656, y, 76, 20, 0x020617, 0.85)
        .setStrokeStyle(1.5, Phaser.Display.Color.HexStringToColor(chipCol).color, 0.9).setDepth(3);
      const chip = this.add.text(656, y, live ? '● LIVE' : '○ LOBBY', {
        fontFamily: COND, fontSize: '12px', fontStyle: '700', color: chipCol,
      }).setOrigin(0.5).setDepth(3);
      chip.setStroke('#020617', 2);
      if (live) this.tweens.add({ targets: chip, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });
      const tx = [bg, code, pips, chipBg, chip];
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => bg.setFillStyle(live ? 0x9a3412 : 0x1e293b, 0.95));
      bg.on('pointerout', () => bg.setFillStyle(live ? 0x7c2d12 : 0x0f172a, 0.94));
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
      this.listObjs.push(...tx);
    });
    if (lobbies.length > 2) {
      const more = this.add.text(480, top + rows.length * 32, `+${lobbies.length - 2} more — type the code below`, {
        fontFamily: BODY, fontSize: '13px', fontStyle: '600', color: DIM,
      }).setOrigin(0.5, 0).setDepth(2);
      more.setStroke('#020617', 3);
      this.listObjs.push(more);
    }
    const manual = this.add.text(480, top + rows.length * 32 + (lobbies.length > 2 ? 20 : 4),
      'have a code? click here to type it',
      { fontFamily: COND, fontSize: '15px', fontStyle: '700', color: '#22d3ee' })
      .setOrigin(0.5, 0).setDepth(2);
    manual.setStroke('#020617', 3);
    manual.setShadow(0, 0, '#22d3ee', 8, false, true);
    manual.setInteractive({ useHandCursor: true });
    manual.on('pointerdown', () => this.askCode());
    this.listObjs.push(manual);
  }

  private askCode() {
    let joining = false;
    const m = modal(this, 'ENTER LOBBY CODE', 480, 250);
    const input = document.createElement('input');
    input.maxLength = 4;
    input.inputMode = 'numeric';
    input.placeholder = '0000';
    input.autocomplete = 'off';
    input.style.cssText = 'width:280px;height:40px;background:#0f172a;color:#22d3ee;text-align:center;'
      + 'border:1px solid rgba(34,211,238,.5);border-radius:8px;padding:0 10px;'
      + 'font:600 20px "Share Tech Mono",monospace;letter-spacing:2px;outline:none;';
    const holder = this.add.dom(0, -30, input);
    m.body.add(holder);
    const hint = this.add.text(0, -2, 'four digits, e.g. 4271', {
      fontFamily: BODY, fontSize: '13px', color: DIM,
    }).setOrigin(0.5);
    m.body.add(hint);
    const go = this.add.text(0, 45, 'JOIN →', {
      fontFamily: COND, fontSize: '19px', fontStyle: '700', color: '#22d3ee',
    }).setOrigin(0.5);
    go.setStroke('#020617', 3);
    go.setShadow(0, 0, '#22d3ee', 8, false, true);
    go.setInteractive({ useHandCursor: true });
    // digits only, and never a leading zero: the code space is 1000-9999
    const scrub = () => {
      const v = input.value.replace(/\D/g, '').slice(0, 4);
      if (input.value !== v) input.value = v;
    };
    input.addEventListener('input', scrub);
    const doJoin = () => {
      scrub();
      const code = input.value.trim();
      if (!code) return;
      if (!CODE_RE.test(code)) {
        hint.setText('a code is 4 digits, 1000-9999').setColor('#ef4444');
        return;
      }
      // One join in flight. doJoin is bound to BOTH the GO button and the
      // input's Enter key, and the modal auto-focuses the input -- so hammering
      // Enter fired it twice. m.close() is idempotent and did not stop the
      // second call; both then saw Session.room === null (the first had not
      // assigned yet), both joinById'd the same room, and the server seated the
      // player twice: two identical rows in the lobby and one person on both
      // teams in a 2-player match.
      if (joining) return;
      joining = true;
      m.close();
      this.errText.setText('joining…');
      Session.joinLobby(code).then(
        () => this.scene.start('lobby'),
        (e: any) => {
          joining = false;
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

