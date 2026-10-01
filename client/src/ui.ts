import Phaser from 'phaser';
import { COND, DISPLAY, track } from './fonts';
import { drawFrame, drawPanel, panelSweep } from './panel';
import { sfx } from './audio';

const BTN_FONT = COND;
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
    fontFamily: BTN_FONT, fontSize: `${(o.fontSize ?? 17) + 1}px`, fontStyle: '700', color: '#ffffff',
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
// Returns {root, body} - add content to body (origin at panel center).
//
// DOM elements (text inputs) live in their own HTML layer ABOVE the canvas, so
// a canvas `depth` can never put one behind a modal: the input just floats over
// the glass and reads as an overlay breaking the window. Scenes register their
// scene-level inputs here and modal() hides them for as long as it is open.
type Underlay = { el: Phaser.GameObjects.DOMElement; hide: () => void; show: () => void };
const underlay: Underlay[] = [];
let modalCount = 0;

// apply to every registered input, dropping any whose scene has been torn down
function eachUnderlay(fn: (r: Underlay) => void) {
  for (let i = underlay.length - 1; i >= 0; i--) {
    fn(underlay[i]);
  }
}

// ---------------------------------------------------------------------------
// DO NOT scale DOM overlays by hand.
//
// This file used to export a scaleDom() that multiplied each element's position
// and scale by scaleManager.displayScale. It was wrong, and it was the cause of
// the name field appearing displaced from its plate.
//
// Phaser already handles this. On every resize, ScaleManager.updateScale gives
// the DOM container a CSS size of baseSize (game px), a transform of
// displaySize/baseSize (the canvas display scale), and the SAME margins as the
// canvas:
//
//     this.baseSize.setCSS(domContainer);
//     domStyle.transform = 'scale(' + displaySize.width / baseSize.width + ','
//                                   + displaySize.height / baseSize.height + ')';
//     domStyle.marginLeft = canvasStyle.marginLeft;
//     domStyle.marginTop  = canvasStyle.marginTop;
//
// So an element positioned at game (gx, gy) already lands on the same screen
// pixel as a canvas object at (gx, gy). Scaling it again by hand multiplies the
// position by s twice -- at s=1.5 that is x2.25 instead of x1.5, which pushed
// the callsign field ~150px below the 46px plate that holds it.
//
// Position DOM elements in game coordinates and leave the container alone.
// ---------------------------------------------------------------------------

export function registerUnderlay(el: Phaser.GameObjects.DOMElement) {
  const rec: Underlay = {
    el,
    hide: () => el.setVisible(false),
    show: () => el.setVisible(true),
  };
  underlay.push(rec);
  // Unregister on the element's own destruction. This used to rely on
  // setVisible() throwing for a destroyed DOMElement as a prune signal, but
  // setVisible only flips a boolean (Visible mixin) and never throws -- so the
  // catch was unreachable and the registry grew one dead entry per menu visit,
  // with every modal open/close walking the whole dead list.
  el.once(Phaser.GameObjects.Events.DESTROY, () => {
    const i = underlay.indexOf(rec);
    if (i >= 0) underlay.splice(i, 1);
  });
  if (modalCount > 0) eachUnderlay((r) => r.hide());
  return el;
}

function underlayShow() {
  eachUnderlay((r) => r.show());
}

export function modal(scene: Phaser.Scene, title: string, w = 560, h = 380) {
  const root = scene.add.container(480, 300).setDepth(50);
  modalCount++;
  eachUnderlay((r) => r.hide());
  const dim = scene.add.rectangle(0, 0, 960, 600, 0x000000, 0.62).setInteractive();
  const glow = scene.add.image(0, 0, 'halo').setTint(0x22d3ee)
    .setBlendMode(Phaser.BlendModes.ADD).setScale(w / 60, h / 60).setAlpha(0.22);
  // Chamfered glass instead of a rounded plate with a heavy 2.5px outline. The
  // brackets carry the accent, so the silhouette stays legible without a ring
  // around every surface, and the sweep gives the panel a material.
  const PCUT = 18;
  const panel = scene.add.graphics();
  drawPanel(panel, { x: -w / 2, y: -h / 2, w, h, cut: PCUT, alpha: 0.97, shadow: true });
  drawFrame(panel, { x: -w / 2, y: -h / 2, w, h, cut: PCUT, arm: 18, alpha: 0.75 });
  const sweep = panelSweep(scene, null, { x: 0, y: 0, w, h, cut: PCUT, period: 5600, alpha: 0.1 });
  const head = scene.add.text(0, -h / 2 + 34, track(title.toUpperCase()), {
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
  root.add([dim, glow, panel, sweep, head, rule, xbg, x, body]);
  root.setAlpha(0).setScale(0.92).setY(308);
  scene.tweens.add({
    targets: root, alpha: 1, scaleX: 1, scaleY: 1, y: 300,
    duration: 240, ease: 'Back.easeOut',
  });
  let closed = false;
  const restore = () => {
    if (closed) return; // one decrement per modal, ever
    closed = true;
    if (--modalCount <= 0) {
      modalCount = 0;
      underlayShow(); // a DOM node is only un-hidden by setVisible(true)
    }
  };
  const close = () => {
    if (closed) return;
    scene.tweens.add({
      targets: root, alpha: 0, scaleX: 0.96, scaleY: 0.96, y: 306, duration: 150, ease: 'Quad.easeIn',
      onComplete: () => root.destroy(true),
    });
    // Release the underlay NOW, not in the tween's onComplete. Phaser's
    // TweenManager.shutdown() kills in-flight tweens WITHOUT firing onComplete,
    // so a scene that changes during the 150ms close (which is every join on
    // localhost, where the handshake beats the animation) used to leak the
    // count. modalCount is a module global: once stuck above zero, every later
    // registerUnderlay() hid its input and the menu's callsign field stayed
    // invisible for the rest of the session.
    restore();
  };
  // ...and a scene torn down with the modal still open must release it too.
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, restore);
  xbg.on('pointerdown', close);
  dim.on('pointerdown', close);
  return { root, body, close };
}

const toastY = { next: 0 };
// Toast stack (top-center): glass pill + color dot, slides down, auto-dismisses.
// y0 lets a scene place its toasts where its own layout wants them: the arena
// pushes them down into the lower band so notifications never sit in the fight
export function toast(scene: Phaser.Scene, msg: string, color = '#e2e8f0', y0 = 64) {
  const i = toastY.next++ % 3;
  const y = y0 + i * 32;
  // scrollFactor 0 is essential: this is a SCREEN-space position (the viewport
  // centre), and the arena camera follows the player across a 1600x1200 world.
  // Without it a toast at world (480,344) rendered at screen (480-scrollX,
  // 344-scrollY) -- off-screen entirely for anyone standing in the east or
  // south of the map, so "SHIELD UP", the control hint, the join notice and
  // "AUTO LOW GRAPHICS" were simply never seen.
  const c = scene.add.container(480, y - 18).setScrollFactor(0).setDepth(60).setAlpha(0);
  const t = scene.add.text(12, 0, msg, {
    fontFamily: BTN_FONT, fontSize: '15px', fontStyle: '700', color,
  }).setOrigin(0, 0.5);
  t.setStroke('#020617', 3);
  const pw = Math.max(120, t.width + 52);
  const dotC = color.startsWith('#') ? Phaser.Display.Color.HexStringToColor(color).color : 0xe2e8f0;
  const bg = scene.add.graphics();
  // The rim carries the message's own colour, so severity is readable from the
  // shape alone and not only from the dot.
  drawPanel(bg, {
    x: -pw / 2, y: -14, w: pw, h: 28, cut: 9, accent: dotC,
    alpha: 0.9, scan: false, shadow: true, rim: 0.5, inner: 4,
  });
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
