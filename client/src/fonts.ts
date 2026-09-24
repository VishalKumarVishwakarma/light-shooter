import Phaser from 'phaser';

// Central type system: GTA-condensed display, athletic body, terminal mono.
export const DISPLAY = '"Anton", "Rajdhani", sans-serif';
export const BODY = '"Rajdhani", system-ui, sans-serif';
export const MONO = '"Share Tech Mono", monospace';

// Small letterspaced kicker label (section eyebrows, broadcast tags).
export function kicker(
  scene: Phaser.Scene, x: number, y: number, str: string,
  color = '#f59e0b', size = 13, depth = 2,
) {
  const t = scene.add.text(x, y, str.split('').join('  '), {
    fontFamily: BODY, fontSize: `${size}px`, fontStyle: '700', color,
  }).setOrigin(0.5).setDepth(depth);
  return t;
}

// Big extruded title: dark offset base + glowing face + top sheen.
export function displayText(
  scene: Phaser.Scene,
  x: number, y: number, str: string, size: number,
  color = '#ffffff', glow = '#22d3ee', depth = 2, fixed = false,
) {
  const back = scene.add.text(2, 3, str, {
    fontFamily: DISPLAY, fontSize: `${size}px`, color: '#020617',
  }).setOrigin(0.5);
  const front = scene.add.text(0, 0, str, {
    fontFamily: DISPLAY, fontSize: `${size}px`, color,
  }).setOrigin(0.5);
  front.setStroke('#020617', Math.max(2, Math.round(size / 14)));
  front.setShadow(0, 0, glow, 22, false, true);
  const sheen = scene.add.text(0, -Math.max(1, size * 0.03), str, {
    fontFamily: DISPLAY, fontSize: `${size}px`, color: '#ffffff',
  }).setOrigin(0.5).setAlpha(0.16);
  if (fixed) { back.setScrollFactor(0); front.setScrollFactor(0); sheen.setScrollFactor(0); }
  return scene.add.container(x, y, [back, front, sheen]).setDepth(depth);
}
