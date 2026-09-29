import Phaser from 'phaser';

// Premium sci-fi HUD surfaces.
//
// Every panel in the menus, lobby and modals used to be the same construction:
// a flat translucent fillRoundedRect inside a full 2.5px cyan outline. Uniform
// treatment is exactly what reads as unfinished -- there was no depth (a flat
// fill cannot say which way the light comes from), no material, and no hierarchy
// between a hero panel and a list row. Rounded 16px corners also fought the TAC
// corner-bracket motif already on screen, so the game had two design languages.
//
// These primitives give every surface one construction, in four layers:
//
//   1. a cast drop shadow, so the panel sits ABOVE the backdrop
//   2. a chamfered gradient body -- depth without shipping a texture
//   3. a specular hairline along the top edge and a soft inner shadow at the
//      bottom, which is what makes flat glass read as a physical object
//   4. corner brackets + accent stops, continuing the TAC motif
//
// Hero panels add a slow travelling sweep. Kept out of list rows on purpose:
// eight roster rows each running a 4s loop is noise, not polish.

export const ACCENT = 0x22d3ee;

// Glass body, lit from above. The gap between these two is small on purpose --
// a wide ramp reads as a gradient wallpaper; a subtle one reads as depth.
const BODY_TOP = 0x111c30;
const BODY_BOT = 0x050a15;

// Octagon: four corners cut by `cut`. Clamped so a small panel cannot invert.
export function chamfer(x: number, y: number, w: number, h: number, cut = 14) {
  const c = Math.max(2, Math.min(cut, w / 2, h / 2));
  return [
    new Phaser.Geom.Point(x + c, y),
    new Phaser.Geom.Point(x + w - c, y),
    new Phaser.Geom.Point(x + w, y + c),
    new Phaser.Geom.Point(x + w, y + h - c),
    new Phaser.Geom.Point(x + w - c, y + h),
    new Phaser.Geom.Point(x + c, y + h),
    new Phaser.Geom.Point(x, y + h - c),
    new Phaser.Geom.Point(x, y + c),
  ];
}

export type PanelOpts = {
  x: number; y: number; w: number; h: number;
  cut?: number;
  accent?: number;
  alpha?: number;    // body opacity
  fill?: number;     // override the glass colour
  fillBot?: number;  // ...and its bottom half, so a tinted row still has depth
  shadow?: boolean;  // cast shadow, hero panels
  scan?: boolean;    // interior scanlines
  rim?: number;      // rim alpha; 0 omits the rim
  scanPitch?: number;
  inner?: number;    // depth of the bottom inner shadow, 0 omits it
};

export function drawPanel(g: Phaser.GameObjects.Graphics, o: PanelOpts) {
  const { x, y, w, h } = o;
  const cut = o.cut ?? 14;
  const accent = o.accent ?? ACCENT;
  const a = o.alpha ?? 0.96;
  const top = o.fill ?? BODY_TOP;
  const bot = o.fillBot ?? (o.fill === undefined ? BODY_BOT : o.fill);
  const pts = chamfer(x, y, w, h, cut);

  // 1. cast shadow: the octagon, spread and pushed down
  if (o.shadow) {
    g.fillStyle(0x000000, 0.34);
    g.fillPoints(chamfer(x - 3, y - 1, w + 6, h + 8, cut + 3), true);
  }

  // 2. gradient body. fillGradientStyle sets the four corner tints that
  //    fillPath consumes, so the whole octagon is lit top-to-bottom in ONE
  //    call -- and it costs no texture, which matters at this payload size.
  g.fillGradientStyle(top, top, bot, bot, a, a, a, a);
  g.fillPoints(pts, true);
  g.fillStyle(bot, a); // reset: a later flat fill must not inherit the ramp

  // 3. interior scanlines, held clear of the chamfer diagonals
  if (o.scan !== false) {
    const pitch = o.scanPitch ?? 3;
    g.lineStyle(1, accent, 0.05);
    for (let sy = y + cut + 2; sy < y + h - cut - 1; sy += pitch) {
      g.lineBetween(x + cut, sy, x + w - cut, sy);
    }
  }

  // 4. inner shadow along the bottom edge, in four steps. A gradient rect would
  //    be one call, but four flat ones are deterministic across renderers.
  //    Scaled for small surfaces: on a 28px toast the default 9px would eat a
  //    third of the panel, so callers can pass `inner`.
  const inner = o.inner ?? 9;
  if (inner > 0) {
    g.fillStyle(0x000000, 0.10); g.fillRect(x, y + h - Math.round(inner * 0.4), w, Math.round(inner * 0.4));
    g.fillStyle(0x000000, 0.14); g.fillRect(x, y + h - Math.round(inner * 0.65), w, Math.round(inner * 0.65));
    g.fillStyle(0x000000, 0.18); g.fillRect(x, y + h - Math.round(inner * 0.85), w, Math.round(inner * 0.85));
    g.fillStyle(0x000000, 0.22); g.fillRect(x, y + h - 1, w, 1);
  }

  // 5. specular hairline along the top flat
  g.lineStyle(1, 0xffffff, 0.13);
  g.lineBetween(x + cut + 2, y + 0.5, x + w - cut - 2, y + 0.5);

  // 6. rim: deliberately recessive. The old 2.5px 0.75-alpha outline shouted;
  //    the brackets in drawFrame carry the accent instead, so the silhouette
  //    stays readable without a heavy ring around every surface.
  const rim = o.rim ?? 0.34;
  if (rim > 0) {
    g.lineStyle(1.25, accent, rim);
    g.strokePoints(pts, true, true);
  }
}

// Corner brackets + accent stops: the TAC motif, at panel scale.
export type FrameOpts = {
  x: number; y: number; w: number; h: number;
  cut?: number; accent?: number; alpha?: number; arm?: number;
  stops?: boolean;
};

export function drawFrame(g: Phaser.GameObjects.Graphics, o: FrameOpts) {
  const { x, y, w, h } = o;
  const cut = o.cut ?? 14;
  const accent = o.accent ?? ACCENT;
  const arm = o.arm ?? 15;
  g.lineStyle(2, accent, o.alpha ?? 0.8);
  for (const cy of [y, y + h]) {
    for (const cx of [x, x + w]) {
      const sx = cx === x ? 1 : -1;
      const sy = cy === y ? 1 : -1;
      g.lineBetween(cx, cy, cx + arm * sx, cy);
      g.lineBetween(cx, cy, cx, cy + arm * sy);
    }
  }
  // Accent stops anchor the top edge without a full-width crown bar, which used
  // to read as a progress indicator rather than as part of the frame.
  if (o.stops !== false) {
    g.fillStyle(accent, 0.9);
    g.fillRect(x + cut, y - 1, arm, 2);
    g.fillRect(x + w - cut - arm, y - 1, arm, 2);
  }
}

// Travelling specular sweep. ADD-blended soft glow rather than a hard band, so
// it never needs clipping to the octagon and cannot spill a visible edge.
//
// Lifecycle: Phaser never reclaims a tween whose target was destroyed, and a
// modal can be torn down mid-sweep by a scene change -- which would leave the
// tween stepping a dead image for the rest of the session. The cleanup is bound
// to the image's own DESTROY event, so it cannot be forgotten at a call site.
export function panelSweep(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container | null,
  o: { x: number; y: number; w: number; h: number; cut?: number; accent?: number;
    period?: number; alpha?: number; depth?: number },
) {
  const cut = o.cut ?? 14;
  const band = scene.add.image(o.x, o.y, 'halo')
    .setDisplaySize(Math.max(70, o.w * 0.4), Math.max(20, o.h - cut * 2))
    .setTint(o.accent ?? ACCENT)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setAlpha(0)
    .setDepth(o.depth ?? 0);
  if (parent) parent.add(band);
  const travel = o.w / 2 + band.displayWidth / 2;
  const half = (o.period ?? 4200) / 2;
  const tw = scene.tweens.add({
    targets: band,
    x: { from: o.x - travel, to: o.x + travel },
    alpha: { from: 0, to: o.alpha ?? 0.12 },
    duration: half, ease: 'Sine.easeInOut', yoyo: true, repeat: -1, repeatDelay: 1100,
  });
  band.once(Phaser.GameObjects.Events.DESTROY, () => { tw.stop(); });
  return band;
}
