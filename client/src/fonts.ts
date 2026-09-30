import Phaser from 'phaser';

// Premium type system:
//   DISPLAY — Anton: condensed marquee titles (headers, banners, results).
//   COND    — Chakra Petch: techy workhorse for buttons, kickers, HUD numbers.
//   BODY    — Rajdhani: paragraphs, hints, roster prose.
//   MONO    — JetBrains Mono 700: codes, hashes, data readouts.
//
// MONO is JetBrains Mono at weight 700, NOT Share Tech Mono, and that is load
// bearing. Share Tech Mono is a 400-ONLY font -- Google Fonts answers HTTP 400
// for `wght@700`, and `wght@400;700` serves only 400. So every `fontStyle:
// '700'` written against it produced SYNTHESISED bold: the browser smeared the
// 400 outlines instead of loading a bolder cut, which fuzzes counters and goes
// soft at the 11-12px sizes the HUD actually uses. Text with no fontStyle at all
// rendered at a genuine 400, i.e. thin.
//
// Every MONO readout is now real 700. Share Tech Mono stays in the stack purely
// as a fallback if the webfont fails.
//
// Safe for layout: monospace cuts are metric-compatible, so 400 and 700 advance
// the same 0.6em per glyph. Bolding changes stroke weight, never text width, so
// the measured kill-feed plate in ArenaScene is unaffected.
export const DISPLAY = '"Anton", "Rajdhani", sans-serif';
export const COND = '"Chakra Petch", "Rajdhani", sans-serif';
export const BODY = '"Rajdhani", system-ui, sans-serif';
export const MONO = '"JetBrains Mono", "Share Tech Mono", monospace';

// Wide tracking for eyebrow labels (Phaser has no letter-spacing, so we
// letterspace with hair spaces — matches the existing kicker look).
export function track(str: string): string {
  return str.split('').join('  ');
}

// Premium body palette (tiers on dark glass — nothing below DIM for prose).
export const TXT = '#edf2f9'; // primary copy
export const SUB = '#bcc8da'; // secondary copy (replaces flat #94a3b8)
export const DIM = '#8ea0b8'; // tertiary captions (replaces #64748b/#475569)

// Body copy: Rajdhani semibold with carved stroke + soft drop so paragraphs
// sit on glass instead of sinking into it.
export function prose(
  scene: Phaser.Scene, x: number, y: number, str: string,
  size = 15, color = TXT, depth = 2,
) {
  const t = scene.add.text(x, y, str, {
    fontFamily: BODY, fontSize: `${size}px`, fontStyle: '600', color,
  }).setOrigin(0.5).setDepth(depth);
  t.setStroke('#020617', 3);
  t.setShadow(0, 1, '#000000', 3, false, true);
  return t;
}

// Section label: bold condensed eyebrow for settings rows / list headers.
export function eyebrow(
  scene: Phaser.Scene, x: number, y: number, str: string,
  color = SUB, size = 14, depth = 2,
) {
  const t = scene.add.text(x, y, track(str.toUpperCase()), {
    fontFamily: COND, fontSize: `${size}px`, fontStyle: '700', color,
  }).setOrigin(0.5).setDepth(depth);
  t.setStroke('#020617', 3);
  t.setShadow(0, 0, color, 6, false, true);
  return t;
}

// Small letterspaced kicker label (section eyebrows, broadcast tags).
export function kicker(
  scene: Phaser.Scene, x: number, y: number, str: string,
  color = '#f59e0b', size = 13, depth = 2,
) {
  const t = scene.add.text(x, y, track(str), {
    fontFamily: COND, fontSize: `${size}px`, fontStyle: '700', color,
  }).setOrigin(0.5).setDepth(depth);
  t.setStroke('#020617', 3);
  t.setShadow(0, 0, color, 8, false, true);
  return t;
}

// Button / nav label: bold condensed caps with carved depth.
export function label(
  scene: Phaser.Scene, x: number, y: number, str: string,
  size = 17, color = '#ffffff', depth = 2,
) {
  const t = scene.add.text(x, y, str, {
    fontFamily: COND, fontSize: `${size}px`, fontStyle: '700', color,
  }).setOrigin(0.5).setDepth(depth);
  t.setStroke('#0b1220', 4);
  t.setShadow(0, 2, '#000000', 5, false, true);
  return t;
}

// HUD number: heavy condensed figure with glow + hard legibility stroke.
export function num(
  scene: Phaser.Scene, x: number, y: number, str: string,
  size = 30, color = '#ffffff', glow = '#22d3ee', depth = 10,
) {
  const t = scene.add.text(x, y, str, {
    fontFamily: COND, fontSize: `${size}px`, fontStyle: '700', color,
  }).setOrigin(0.5).setDepth(depth);
  t.setStroke('#020617', Math.max(3, Math.round(size / 8)));
  t.setShadow(0, 0, glow, 12, false, true);
  return t;
}

// Big extruded title: double-offset base + glowing face + top sheen.
export function displayText(
  scene: Phaser.Scene,
  x: number, y: number, str: string, size: number,
  color = '#ffffff', glow = '#22d3ee', depth = 2, fixed = false,
) {
  const back = scene.add.text(3, 4.5, str, {
    fontFamily: DISPLAY, fontSize: `${size}px`, color: '#020617',
  }).setOrigin(0.5).setAlpha(0.9);
  const mid = scene.add.text(1.5, 2, str, {
    fontFamily: DISPLAY, fontSize: `${size}px`, color: '#0b1220',
  }).setOrigin(0.5);
  const front = scene.add.text(0, 0, str, {
    fontFamily: DISPLAY, fontSize: `${size}px`, color,
  }).setOrigin(0.5);
  front.setStroke('#020617', Math.max(2, Math.round(size / 14)));
  front.setShadow(0, 0, glow, 22, false, true);
  const sheen = scene.add.text(0, -Math.max(1, size * 0.03), str, {
    fontFamily: DISPLAY, fontSize: `${size}px`, color: '#ffffff',
  }).setOrigin(0.5).setAlpha(0.16);
  if (fixed) {
    back.setScrollFactor(0); mid.setScrollFactor(0);
    front.setScrollFactor(0); sheen.setScrollFactor(0);
  }
  return scene.add.container(x, y, [back, mid, front, sheen]).setDepth(depth);
}
