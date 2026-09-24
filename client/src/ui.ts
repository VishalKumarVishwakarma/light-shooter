import Phaser from 'phaser';
import { BODY, DISPLAY } from './fonts';
import { sfx } from './audio';

const BTN_FONT = BODY;
export type Btn = {
  c: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  setEnabled: (b: boolean) => void;
};

// Premium HQ button: halo glow, elastic press, label shine.
export function makeButton(
  scene: Phaser.Scene,
  o: {
    tex: string; x: number; y: number; label: string;
    tint?: number; fontSize?: number; depth?: number; scroll?: boolean;
    onClick: () => void;
  },
): Btn {
  const d = o.depth ?? 2;
  const halo = scene.add.image(0, 0, 'halo').setDepth(d - 0.5).setAlpha(0)
    .setBlendMode(Phaser.BlendModes.ADD).setScale(2.8, 1.25);
  if (o.tint !== undefined) halo.setTint(o.tint);
  const bg = scene.add.image(0, 0, o.tex);
  if (o.tint !== undefined) bg.setTint(o.tint);
  bg.setDepth(d);
  const label = scene.add.text(0, -1, o.label, {
    fontFamily: BTN_FONT, fontSize: `${o.fontSize ?? 17}px`, fontStyle: '700', color: '#ffffff',
  }).setOrigin(0.5).setDepth(d + 1);
  label.setStroke('#0b1220', 4);
  label.setShadow(0, 2, '#000000', 5, false, true);
  const c = scene.add.container(o.x, o.y, [halo, bg, label]).setDepth(d);
  if (o.scroll) { halo.setScrollFactor(0); bg.setScrollFactor(0); label.setScrollFactor(0); }
  bg.setInteractive({ useHandCursor: true });
  let enabled = true;
  let busy = false;
  bg.on('pointerover', () => {
    if (!enabled) return;
    scene.tweens.add({ targets: c, scaleX: 1.05, scaleY: 1.05, duration: 120, ease: 'Quad.easeOut' });
    scene.tweens.add({ targets: halo, alpha: 0.6, duration: 140 });
    scene.tweens.add({ targets: label, scaleX: 1.03, scaleY: 1.03, duration: 120 });
  });
  const release = () => {
    if (!enabled) return;
    c.y = o.y;
    if (busy) return;
    scene.tweens.add({ targets: c, scaleX: 1, scaleY: 1, duration: 160, ease: 'Quad.easeOut' });
    scene.tweens.add({ targets: halo, alpha: 0, duration: 180 });
    scene.tweens.add({ targets: label, scaleX: 1, scaleY: 1, duration: 160 });
  };
  bg.on('pointerout', release);
  bg.on('pointerup', release);
  bg.on('pointerdown', () => {
    if (!enabled || busy) return;
    busy = true;
    scene.tweens.add({ targets: c, scaleX: 0.95, scaleY: 0.93, duration: 70 });
    scene.tweens.add({ targets: halo, alpha: 0.9, duration: 70 });
    c.y = o.y + 3; // physical press travel
    sfx.click();
    scene.time.delayedCall(90, () => {
      c.y = o.y;
      scene.tweens.add({
        targets: c, scaleX: 1, scaleY: 1, duration: 260, ease: 'Back.easeOut',
        onComplete: () => { busy = false; },
      });
    });
    o.onClick();
  });
  return {
    c, bg, label,
    setEnabled(b: boolean) {
      enabled = b;
      c.y = o.y;
      c.setAlpha(b ? 1 : 0.45);
      halo.setAlpha(0);
      if (b) bg.setInteractive({ useHandCursor: true });
      else bg.disableInteractive();
    },
  };
}

export const VERSION = '0.5.0';

export function quality(): 'high' | 'low' {
  try { return localStorage.getItem('shooter_q') === 'low' ? 'low' : 'high'; }
  catch { return 'high'; }
}

export function setQuality(q: 'high' | 'low') {
  try { localStorage.setItem('shooter_q', q); } catch { /* noop */ }
}

// Modal card: dim backdrop + glass panel + accent bar + title + close.
// Returns {root, body} — add content to body (origin at panel center).
export function modal(scene: Phaser.Scene, title: string, w = 560, h = 380) {
  const root = scene.add.container(480, 300).setDepth(50);
  const dim = scene.add.rectangle(0, 0, 960, 600, 0x000000, 0.62).setInteractive();
  const glow = scene.add.image(0, 0, 'halo').setTint(0x22d3ee)
    .setBlendMode(Phaser.BlendModes.ADD).setScale(w / 60, h / 60).setAlpha(0.22);
  const panel = scene.add.graphics();
  panel.fillStyle(0x020617, 0.55); // outer drop plate
  panel.fillRoundedRect(-w / 2 - 3, -h / 2 - 1, w + 6, h + 6, 20);
  panel.fillStyle(0x0b1220, 0.97); // glass body
  panel.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
  panel.fillStyle(0xffffff, 0.05); // top glass light
  panel.fillRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, h * 0.34, 14);
  panel.fillStyle(0x22d3ee, 0.9); // neon crown line
  panel.fillRoundedRect(-w / 2 + 18, -h / 2, w - 36, 3, 2);
  panel.lineStyle(1.5, 0x22d3ee, 0.55);
  panel.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);
  panel.lineStyle(1, 0xffffff, 0.10); // inner top rim
  panel.beginPath();
  panel.moveTo(-w / 2 + 14, -h / 2 + 8);
  panel.lineTo(w / 2 - 14, -h / 2 + 8);
  panel.strokePath();
  const head = scene.add.text(0, -h / 2 + 34, title, {
    fontFamily: DISPLAY, fontSize: '24px', color: '#fff',
  }).setOrigin(0.5);
  head.setShadow(0, 0, '#22d3ee', 14, false, true);
  const rule = scene.add.graphics();
  rule.lineStyle(1, 0x22d3ee, 0.35);
  rule.beginPath();
  rule.moveTo(-w / 2 + 28, -h / 2 + 58);
  rule.lineTo(w / 2 - 28, -h / 2 + 58);
  rule.strokePath();
  const xbg = scene.add.circle(w / 2 - 24, -h / 2 + 26, 13, 0x020617, 0.8)
    .setStrokeStyle(1.5, 0x64748b, 0.9);
  const x = scene.add.text(w / 2 - 24, -h / 2 + 25, '✕', {
    fontFamily: BTN_FONT, fontSize: '15px', fontStyle: '700', color: '#94a3b8',
  }).setOrigin(0.5);
  xbg.setInteractive({ useHandCursor: true });
  xbg.on('pointerover', () => { x.setColor('#fff'); xbg.setStrokeStyle(1.5, 0x22d3ee, 1); });
  xbg.on('pointerout', () => { x.setColor('#94a3b8'); xbg.setStrokeStyle(1.5, 0x64748b, 0.9); });
  const body = scene.add.container(0, 22);
  root.add([dim, glow, panel, head, rule, xbg, x, body]);
  root.setAlpha(0).setScale(0.92).setY(308);
  scene.tweens.add({
    targets: root, alpha: 1, scaleX: 1, scaleY: 1, y: 300,
    duration: 240, ease: 'Back.easeOut',
  });
  const close = () => {
    scene.tweens.add({
      targets: root, alpha: 0, scaleX: 0.96, scaleY: 0.96, y: 306, duration: 150, ease: 'Quad.easeIn',
      onComplete: () => root.destroy(true),
    });
  };
  xbg.on('pointerdown', close);
  dim.on('pointerdown', close);
  return { root, body, close };
}

const toastY = { next: 0 };
// Toast stack (top-center): glass pill + color dot, slides down, auto-dismisses.
export function toast(scene: Phaser.Scene, msg: string, color = '#e2e8f0') {
  const i = toastY.next++ % 3;
  const y = 64 + i * 36;
  const c = scene.add.container(480, y - 18).setDepth(60).setAlpha(0);
  const t = scene.add.text(12, 0, msg, {
    fontFamily: BTN_FONT, fontSize: '15px', fontStyle: '700', color,
  }).setOrigin(0, 0.5);
  t.setStroke('#020617', 3);
  const pw = Math.max(120, t.width + 52);
  const bg = scene.add.graphics();
  bg.fillStyle(0x020617, 0.82);
  bg.fillRoundedRect(-pw / 2, -14, pw, 28, 14);
  bg.fillStyle(0xffffff, 0.06);
  bg.fillRoundedRect(-pw / 2 + 1.5, -14 + 1.5, pw - 3, 12, 11);
  bg.lineStyle(1.5, 0x22d3ee, 0.4);
  bg.strokeRoundedRect(-pw / 2, -14, pw, 28, 14);
  const dotC = color.startsWith('#') ? Phaser.Display.Color.HexStringToColor(color).color : 0xe2e8f0;
  const dot = scene.add.circle(-pw / 2 + 16, 0, 5, dotC);
  dot.setStrokeStyle(2, 0x020617, 1);
  t.setX(-pw / 2 + 28);
  c.add([bg, dot, t]);
  scene.tweens.add({
    targets: c, y, alpha: 1, duration: 240, ease: 'Back.easeOut',
    onComplete: () => {
      scene.time.delayedCall(2400, () => {
        scene.tweens.add({ targets: c, alpha: 0, y: y - 12, duration: 250, onComplete: () => c.destroy(true) });
      });
    },
  });
}
