import Phaser from 'phaser';
import { BODY } from './fonts';
import { sfx } from './audio';

const BTN_FONT = BODY;
export type Btn = {
  c: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  setEnabled: (b: boolean) => void;
};

// Realistic 3D button: hover swell, physical press travel, disabled grey-out.
export function makeButton(
  scene: Phaser.Scene,
  o: {
    tex: string; x: number; y: number; label: string;
    tint?: number; fontSize?: number; depth?: number; scroll?: boolean;
    onClick: () => void;
  },
): Btn {
  const d = o.depth ?? 2;
  const bg = scene.add.image(0, 0, o.tex);
  if (o.tint !== undefined) bg.setTint(o.tint);
  bg.setDepth(d);
  const label = scene.add.text(0, -1, o.label, {
    fontFamily: BTN_FONT, fontSize: `${o.fontSize ?? 17}px`, fontStyle: '700', color: '#ffffff',
  }).setOrigin(0.5).setDepth(d + 1);
  label.setStroke('#00000088', 3);
  const c = scene.add.container(o.x, o.y, [bg, label]).setDepth(d);
  if (o.scroll) { bg.setScrollFactor(0); label.setScrollFactor(0); }
  bg.setInteractive({ useHandCursor: true });
  let enabled = true;
  bg.on('pointerover', () => {
    if (!enabled) return;
    scene.tweens.add({ targets: c, scaleX: 1.06, scaleY: 1.06, duration: 110 });
  });
  const release = () => {
    if (!enabled) return;
    c.y = o.y;
    scene.tweens.add({ targets: c, scaleX: 1, scaleY: 1, duration: 110 });
  };
  bg.on('pointerout', release);
  bg.on('pointerup', release);
  bg.on('pointerdown', () => {
    if (!enabled) return;
    c.y = o.y + 3; // physical press travel
    sfx.click();
    o.onClick();
  });
  return {
    c, bg, label,
    setEnabled(b: boolean) {
      enabled = b;
      c.y = o.y;
      c.setAlpha(b ? 1 : 0.45);
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

// Modal card: dim backdrop + glass panel + title + close. Returns {root, body} —
// add content to body (origin at panel center), destroy root to close.
export function modal(scene: Phaser.Scene, title: string, w = 560, h = 380) {
  const root = scene.add.container(480, 300).setDepth(50);
  const dim = scene.add.rectangle(0, 0, 960, 600, 0x000000, 0.6).setInteractive();
  const panel = scene.add.graphics();
  panel.fillStyle(0x0b1220, 0.97);
  panel.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
  panel.lineStyle(1.5, 0x22d3ee, 0.5);
  panel.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);
  const head = scene.add.text(0, -h / 2 + 30, title, {
    fontFamily: BTN_FONT, fontSize: '20px', fontStyle: '700', color: '#fff',
  }).setOrigin(0.5);
  const x = scene.add.text(w / 2 - 24, -h / 2 + 22, '✕', {
    fontFamily: BTN_FONT, fontSize: '18px', color: '#94a3b8',
  }).setOrigin(0.5);
  x.setInteractive({ useHandCursor: true });
  x.on('pointerover', () => x.setColor('#fff'));
  x.on('pointerout', () => x.setColor('#94a3b8'));
  const body = scene.add.container(0, 10);
  root.add([dim, panel, head, x, body]);
  root.setAlpha(0).setScale(0.94);
  scene.tweens.add({ targets: root, alpha: 1, scaleX: 1, scaleY: 1, duration: 180, ease: 'Quad.easeOut' });
  const close = () => {
    scene.tweens.add({
      targets: root, alpha: 0, scaleX: 0.96, scaleY: 0.96, duration: 140,
      onComplete: () => root.destroy(true),
    });
  };
  x.on('pointerdown', close);
  dim.on('pointerdown', close);
  return { root, body, close };
}

const toastY = { next: 0 };
// Toast stack (top-center): message slides down, auto-dismisses.
export function toast(scene: Phaser.Scene, msg: string, color = '#e2e8f0') {
  const i = toastY.next++ % 3;
  const y = 64 + i * 34;
  const t = scene.add.text(480, y - 18, msg, {
    fontFamily: BTN_FONT, fontSize: '15px', fontStyle: '600', color,
    backgroundColor: 'rgba(2,6,23,0.88)', padding: { x: 14, y: 7 },
  }).setOrigin(0.5).setDepth(60).setAlpha(0);
  scene.tweens.add({
    targets: t, y, alpha: 1, duration: 220, ease: 'Quad.easeOut',
    onComplete: () => {
      scene.time.delayedCall(2400, () => {
        scene.tweens.add({ targets: t, alpha: 0, y: y - 10, duration: 250, onComplete: () => t.destroy() });
      });
    },
  });
}
