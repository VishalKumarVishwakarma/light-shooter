import Phaser from 'phaser';

// Organic arena terrain.
//
// The arena was drawn as a literal 40px grid on the floor, with every steel
// block the same 40px panel repeated by a tileSprite and every ice patch the
// same 60px crack pattern repeated the same way. Uniform tiles read as
// programmer art no matter how good the texture inside them is, because the eye
// locks onto the repeat long before it reads the detail.
//
// So the floor and the big solids are now drawn procedurally per block, seeded
// from their own coordinates: the same block looks identical on every visit,
// and no two blocks look alike. Nothing here touches the collision geometry,
// which stays axis-aligned rects in map.ts (and must stay byte-identical to the
// server copy).

export type Rc = { x: number; y: number; w: number; h: number };

// Seeded LCG. Textures and terrain are generated once and cached, so
// Math.random would churn them on every scene start.
export function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// Phaser's Graphics has fillCircle/strokeCircle but no ellipse, so soft rounded
// shapes are built as polygons. segs scales with size: a 200px mottle does not
// need 40 segments and a 1px speck does not need 12.
function ellipsePts(x: number, y: number, rx: number, ry: number, rot: number, segs = 0) {
  const n = segs || Math.max(8, Math.min(40, Math.round(Math.max(rx, ry))));
  const c = Math.cos(rot), s = Math.sin(rot);
  const pts: Phaser.Geom.Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const px = Math.cos(a) * rx, py = Math.sin(a) * ry;
    pts.push(new Phaser.Geom.Point(x + px * c - py * s, y + px * s + py * c));
  }
  return pts;
}

// ---------------------------------------------------------------------------
// The floor. Was: this.add.grid(0, 0, W, H, 40, 40, 0x111826) -- a hard 40px
// grid of opaque lines across the whole 1600x1200 map, which is the single
// biggest reason everything read as square.
export function drawGround(g: Phaser.GameObjects.Graphics, w: number, h: number) {
  g.fillStyle(0x0b111a, 1);
  g.fillRect(0, 0, w, h);
  const r = rng(0x51a7e);
  // broad mottles in near-identical tones: enough overlap that no shape is
  // legible, which is the point -- it kills the grid read without becoming a
  // pattern of its own
  const TONES = [0x101a27, 0x0d141e, 0x131e2c, 0x0e1621, 0x16212f];
  for (let i = 0; i < 170; i++) {
    const x = r() * w, y = r() * h;
    const rx = 46 + r() * 160, ry = 34 + r() * 120;
    g.fillStyle(TONES[(r() * TONES.length) | 0], 0.34 + r() * 0.3);
    g.fillPoints(ellipsePts(x, y, rx, ry, r() * Math.PI), true);
  }
  // grit: fine light and dark specks, so the floor has tooth up close
  for (let i = 0; i < 220; i++) {
    const x = r() * w, y = r() * h, s = 0.8 + r() * 2.2;
    g.fillStyle(r() > 0.55 ? 0x1d2938 : 0x070b12, 0.16 + r() * 0.22);
    g.fillPoints(ellipsePts(x, y, s * 1.7, s, r() * Math.PI), true);
  }
  // a few long, faint drags, as if the ground has been scuffed by traffic
  g.lineStyle(1, 0x141d2a, 0.5);
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = r() * h, a = r() * Math.PI * 2, len = 40 + r() * 120;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.strokePath();
  }
}

// ---------------------------------------------------------------------------
// A steel block: a welded plate divided into panels of VARIED size.
//
// Was one 40x40 tileSprite repeated across the block, so every steel block in
// the arena was visibly the same grid of identical panels. The subdivision here
// is a seeded recursive split of the longer axis, so the panel sizes differ
// from block to block and the repeat disappears.
function steelPanel(g: Phaser.GameObjects.Graphics, x: number, y: number,
  w: number, h: number, r: () => number) {
  // plate face, lit from the upper left like everything else in the game
  g.fillGradientStyle(0xa9b3c2, 0xa9b3c2, 0x6b7482, 0x6b7482, 1, 1, 1, 1);
  g.fillRect(x, y, w, h);
  g.fillStyle(0x8b95a5, 1);
  // brushed grain
  g.lineStyle(1, 0xffffff, 0.05 + r() * 0.05);
  for (let i = 0; i < 3; i++) {
    const ly = y + 3 + r() * (h - 6);
    g.beginPath(); g.moveTo(x + 2, ly); g.lineTo(x + w - 2, ly); g.strokePath();
  }
  // bevel: bright on the lit edges, dark on the shadowed ones
  g.lineStyle(1.4, 0xdde4ee, 0.5);
  g.beginPath();
  g.moveTo(x + 0.5, y + h - 1); g.lineTo(x + 0.5, y + 0.5); g.lineTo(x + w - 1, y + 0.5);
  g.strokePath();
  g.lineStyle(1.4, 0x2f3742, 0.55);
  g.beginPath();
  g.moveTo(x + w - 1, y + 1); g.lineTo(x + w - 1, y + h - 1); g.lineTo(x + 1, y + h - 1);
  g.strokePath();
  // two to four rivets, placed away from the corners so they do not line up
  const n = 2 + ((r() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const rx = x + 5 + r() * (w - 10), ry = y + 5 + r() * (h - 10);
    g.fillStyle(0x3c444f, 0.8);
    g.fillCircle(rx + 0.5, ry + 0.6, 2.1);
    g.fillStyle(0xe4eaf2, 0.95);
    g.fillCircle(rx, ry, 1.9);
    g.fillStyle(0xffffff, 0.8);
    g.fillCircle(rx - 0.6, ry - 0.6, 0.8);
  }
  // weathering: a dark streak down one side
  if (r() > 0.45) {
    const sx = x + 3 + r() * (w - 6);
    g.fillStyle(0x39424e, 0.16 + r() * 0.16);
    g.fillRect(sx, y + 2, 1.4 + r() * 2.4, h - 4);
  }
}

// A slab outline with its corners cut, so the silhouette is never a hard square.
// The cuts are small (3-7px) and taken OUT of the block, so the collision rect
// is only ever slightly more generous than the art -- the forgiving direction.
// Returns the octagon and the four top-edge x positions, so the sunlit top edge
// can follow the cuts instead of running across the corner notches.
function steelOutline(rc: Rc, r: () => number) {
  const c = [3 + r() * 4, 3 + r() * 4, 3 + r() * 4, 3 + r() * 4];
  const { x, y, w, h } = rc;
  const pts = [
    new Phaser.Geom.Point(x + c[0], y),
    new Phaser.Geom.Point(x + w - c[1], y),
    new Phaser.Geom.Point(x + w, y + c[1]),
    new Phaser.Geom.Point(x + w, y + h - c[2]),
    new Phaser.Geom.Point(x + w - c[2], y + h),
    new Phaser.Geom.Point(x + c[3], y + h),
    new Phaser.Geom.Point(x, y + h - c[3]),
    new Phaser.Geom.Point(x, y + c[0]),
  ];
  return { pts, topL: x + c[0], topR: x + w - c[1] };
}

export function drawSteel(g: Phaser.GameObjects.Graphics, rc: Rc, seed: number) {
  const r = rng(seed);
  const { pts, topL, topR } = steelOutline(rc, r);
  g.fillStyle(0x4a535f, 1);
  g.fillPoints(pts, true);
  // panels, inset so they stay inside the cut corners
  const pad = 7;
  const ix = rc.x + pad, iy = rc.y + pad, iw = rc.w - pad * 2, ih = rc.h - pad * 2;
  const split = (x: number, y: number, w: number, h: number, depth: number) => {
    if (depth >= 3 || (w < 48 && h < 48)) { steelPanel(g, x, y, w, h, r); return; }
    const horiz = w >= h;
    const t = 0.36 + r() * 0.28;
    if (horiz) {
      split(x, y, w * t, h, depth + 1);
      split(x + w * t, y, w * (1 - t), h, depth + 1);
    } else {
      split(x, y, w, h * t, depth + 1);
      split(x, y + h * t, w, h * (1 - t), depth + 1);
    }
  };
  if (iw > 8 && ih > 8) split(ix, iy, iw, ih, 0);
  // the seam between panels: a dark groove, so the weld reads
  g.lineStyle(1.6, 0x39424e, 0.75);
  g.strokePoints(pts, true, true);
  // sunlit top edge, as before, but following the cut corners
  g.lineStyle(2, 0xffffff, 0.16);
  g.beginPath();
  g.moveTo(topL, rc.y + 0.6);
  g.lineTo(topR, rc.y + 0.6);
  g.strokePath();
}

// ---------------------------------------------------------------------------
// An ice patch. Was a 60x60 tileSprite, so the same two cracks repeated across
// every patch. Ice is slippery rather than solid, so a soft irregular edge is
// safe here -- the outline is deliberately loose.
export function drawIce(g: Phaser.GameObjects.Graphics, rc: Rc, seed: number) {
  const r = rng(seed);
  const { x, y, w, h } = rc;
  // body: a cool vertical gradient, lighter at the top
  g.fillGradientStyle(0xcfe8f6, 0xcfe8f6, 0x9ecbe2, 0x9ecbe2, 0.95, 0.95, 0.95, 0.95);
  g.fillRect(x, y, w, h);
  // irregular edge: bite soft notches out of the border so the patch is not a
  // clean rectangle
  g.fillStyle(0x0d141d, 0.5);
  for (let i = 0; i < 5; i++) {
    const side = (r() * 4) | 0;
    const t = r();
    const nx = side === 0 ? x : side === 1 ? x + w : x + t * w;
    const ny = side === 0 ? y + t * h : side === 1 ? y : side === 2 ? y + h : y + t * h;
    g.fillPoints(ellipsePts(nx, ny, 7 + r() * 13, 6 + r() * 11, r() * 3), true);
  }
  // crystal facets: irregular polygons, so the surface has planes in it
  const FACETS = [0xe8f6ff, 0xb6dcef, 0xd4eefb, 0x9cc4dd];
  for (let i = 0; i < 9; i++) {
    const fx = x + 6 + r() * (w - 12), fy = y + 6 + r() * (h - 12);
    const fr = 9 + r() * 20;
    const pts: Phaser.Geom.Point[] = [];
    const n = 5 + ((r() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r() * 0.5;
      const rr = fr * (0.62 + r() * 0.5);
      pts.push(new Phaser.Geom.Point(fx + Math.cos(a) * rr, fy + Math.sin(a) * rr * 0.7));
    }
    g.fillStyle(FACETS[(r() * FACETS.length) | 0], 0.14 + r() * 0.16);
    g.fillPoints(pts, true);
  }
  // cracks: seeded polylines, branching, rather than two straight repeats
  g.lineStyle(1.6, 0x5f9dc0, 0.42);
  for (let i = 0; i < 3; i++) {
    let px = x + r() * w, py = y + r() * h;
    let a = r() * Math.PI * 2;
    g.beginPath();
    g.moveTo(px, py);
    for (let k = 0; k < 5; k++) {
      a += (r() - 0.5) * 1.5;
      px += Math.cos(a) * (8 + r() * 16);
      py += Math.sin(a) * (5 + r() * 11);
      g.lineTo(px, py);
    }
    g.strokePath();
  }
  // sheen bands and glints
  g.lineStyle(5, 0xffffff, 0.13);
  for (let i = 0; i < 2; i++) {
    const sy = y + 8 + r() * (h - 16);
    g.beginPath();
    g.moveTo(x + 3, sy + 6);
    g.lineTo(x + w - 3, sy - 6);
    g.strokePath();
  }
  g.fillStyle(0xffffff, 0.8);
  for (let i = 0; i < 5; i++) {
    g.fillCircle(x + r() * w, y + r() * h, 0.8 + r() * 1.2);
  }
}
