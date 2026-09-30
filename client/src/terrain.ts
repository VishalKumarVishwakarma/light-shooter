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
//
// ---------------------------------------------------------------------------
// WHY THIS DRAWS INTO A CANVAS AND NOT A Phaser.GameObjects.Graphics
// ---------------------------------------------------------------------------
// The first version of this file drew into Graphics. That was a real
// performance bug, and an expensive one to learn from.
//
// Phaser Graphics is RETAINED MODE. It does not bake pixels. Every fillStyle /
// fillPoints / strokePath call pushes a command into a commandBuffer, and
// GraphicsWebGLRenderer re-walks that whole buffer and re-tessellates it into a
// vertex buffer on EVERY FRAME. The floor alone was ~416 commands / ~8,560
// triangles, and it was being rebuilt and re-uploaded to the GPU 60 times a
// second, per client. With eight tabs on one machine that saturated the GPU and
// was the main cause of the "game is so lagged" report.
//
// Drawing the same art into a 2D canvas once and registering it as a texture
// turns each of those into a single textured quad: the geometry cost drops from
// thousands of re-tessellated triangles per frame to one draw call, and the art
// is identical. Canvas 2D has gradients, paths, clipping and per-pixel fills
// natively, so nothing is lost by not going through Phaser.

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

function cv(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas 2D unavailable (GPU/memory pressure?)');
  return { c, ctx };
}

// hex -> 'rgba(r,g,b,a)' so one palette literal can carry its own alpha
function rgba(hex: number, a = 1) {
  return `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;
}

// ---------------------------------------------------------------------------
// The floor. Was: this.add.grid(0, 0, W, H, 40, 40, 0x111826) -- a hard 40px
// grid of opaque lines across the whole 1600x1200 map, which was the single
// biggest reason everything read as square.
//
// Baked once into a single full-map texture. The arena is a fixed size, so this
// is exactly one image and never regenerates.
export function groundCanvas(w: number, h: number) {
  const { c, ctx } = cv(w, h);
  ctx.fillStyle = '#0b111a';
  ctx.fillRect(0, 0, w, h);
  const r = rng(0x51a7e);
  // broad mottles in near-identical tones: enough overlap that no shape is
  // legible, which is the point -- it kills the grid read without becoming a
  // pattern of its own
  const TONES = [0x101a27, 0x0d141e, 0x131e2c, 0x0e1621, 0x16212f];
  for (let i = 0; i < 170; i++) {
    const x = r() * w, y = r() * h;
    const rx = 46 + r() * 160, ry = 34 + r() * 120;
    ctx.fillStyle = rgba(TONES[(r() * TONES.length) | 0], 0.34 + r() * 0.3);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // grit: fine light and dark specks, so the floor has tooth up close
  for (let i = 0; i < 220; i++) {
    const x = r() * w, y = r() * h, s = 0.8 + r() * 2.2;
    ctx.fillStyle = rgba(r() > 0.55 ? 0x1d2938 : 0x070b12, 0.16 + r() * 0.22);
    ctx.beginPath();
    ctx.ellipse(x, y, s * 1.7, s, r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // a few long, faint drags, as if the ground has been scuffed by traffic
  ctx.strokeStyle = rgba(0x141d2a, 0.5);
  ctx.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = r() * h, a = r() * Math.PI * 2, len = 40 + r() * 120;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  return c;
}

// ---------------------------------------------------------------------------
// A steel block: a welded plate divided into panels of VARIED size.
//
// Was one 40x40 tileSprite repeated across the block, so every steel block in
// the arena was visibly the same grid of identical panels. The subdivision here
// is a seeded recursive split of the longer axis, so the panel sizes differ
// from block to block and the repeat disappears.
//
// Drawn in LOCAL space into a canvas the size of the block, so the texture can
// be placed with a plain image at (rc.x, rc.y).
function steelPanel(ctx: CanvasRenderingContext2D, x: number, y: number,
  w: number, h: number, r: () => number) {
  // plate face, lit from the upper left like everything else in the game
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, '#a9b3c2');
  grad.addColorStop(1, '#6b7482');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  // brushed grain
  ctx.strokeStyle = rgba(0xffffff, 0.05 + r() * 0.05);
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const ly = y + 3 + r() * (h - 6);
    ctx.beginPath(); ctx.moveTo(x + 2, ly); ctx.lineTo(x + w - 2, ly); ctx.stroke();
  }
  // bevel: bright on the lit edges, dark on the shadowed ones
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = rgba(0xdde4ee, 0.5);
  ctx.beginPath();
  ctx.moveTo(x + 0.5, y + h - 1); ctx.lineTo(x + 0.5, y + 0.5); ctx.lineTo(x + w - 1, y + 0.5);
  ctx.stroke();
  ctx.strokeStyle = rgba(0x2f3742, 0.55);
  ctx.beginPath();
  ctx.moveTo(x + w - 1, y + 1); ctx.lineTo(x + w - 1, y + h - 1); ctx.lineTo(x + 1, y + h - 1);
  ctx.stroke();
  // two to four rivets, placed away from the corners so they do not line up
  const n = 2 + ((r() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const rx = x + 5 + r() * (w - 10), ry = y + 5 + r() * (h - 10);
    ctx.fillStyle = rgba(0x3c444f, 0.8);
    ctx.beginPath(); ctx.arc(rx + 0.5, ry + 0.6, 2.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba(0xe4eaf2, 0.95);
    ctx.beginPath(); ctx.arc(rx, ry, 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba(0xffffff, 0.8);
    ctx.beginPath(); ctx.arc(rx - 0.6, ry - 0.6, 0.8, 0, Math.PI * 2); ctx.fill();
  }
  // weathering: a dark streak down one side
  if (r() > 0.45) {
    const sx = x + 3 + r() * (w - 6);
    ctx.fillStyle = rgba(0x39424e, 0.16 + r() * 0.16);
    ctx.fillRect(sx, y + 2, 1.4 + r() * 2.4, h - 4);
  }
}

export function steelCanvas(rc: Rc, seed: number) {
  const { x, y, w, h } = rc;
  const { c, ctx } = cv(w, h);
  const r = rng(seed);
  // corners cut by 3-7px, so the silhouette is never a hard square. The cuts are
  // taken OUT of the block, so the collision rect is very slightly more generous
  // than the art -- the forgiving direction, since a player never bumps into
  // something invisible.
  const cut = [3 + r() * 4, 3 + r() * 4, 3 + r() * 4, 3 + r() * 4];
  const path = new Path2D();
  path.moveTo(cut[0], 0);
  path.lineTo(w - cut[1], 0);
  path.lineTo(w, cut[1]);
  path.lineTo(w, h - cut[2]);
  path.lineTo(w - cut[2], h);
  path.lineTo(cut[3], h);
  path.lineTo(0, h - cut[3]);
  path.lineTo(0, cut[0]);
  path.closePath();
  ctx.fillStyle = '#4a535f';
  ctx.fill(path);
  // panels, inset so they stay inside the cut corners
  const pad = 7;
  const split = (px: number, py: number, pw: number, ph: number, depth: number) => {
    if (depth >= 3 || (pw < 48 && ph < 48)) { steelPanel(ctx, px, py, pw, ph, r); return; }
    const horiz = pw >= ph;
    const t = 0.36 + r() * 0.28;
    if (horiz) {
      split(px, py, pw * t, ph, depth + 1);
      split(px + pw * t, py, pw * (1 - t), ph, depth + 1);
    } else {
      split(px, py, pw, ph * t, depth + 1);
      split(px, py + ph * t, pw, ph * (1 - t), depth + 1);
    }
  };
  const iw = w - pad * 2, ih = h - pad * 2;
  if (iw > 8 && ih > 8) split(pad, pad, iw, ih, 0);
  // the seam between panels: a dark groove, so the weld reads
  ctx.strokeStyle = rgba(0x39424e, 0.75);
  ctx.lineWidth = 1.6;
  ctx.stroke(path);
  // sunlit top edge, as before, but following the cut corners
  ctx.strokeStyle = rgba(0xffffff, 0.16);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cut[0], 0.6);
  ctx.lineTo(w - cut[1], 0.6);
  ctx.stroke();
  return c;
}

// ---------------------------------------------------------------------------
// An ice patch. Was a 60x60 tileSprite, so the same two cracks repeated across
// every patch. Ice is slippery rather than solid, so a soft irregular edge is
// safe here -- the outline is deliberately loose.
export function iceCanvas(rc: Rc, seed: number) {
  const { x, y, w, h } = rc;
  const { c, ctx } = cv(w, h);
  const r = rng(seed);
  // body: a cool vertical gradient, lighter at the top
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(207,232,246,0.95)');
  grad.addColorStop(1, 'rgba(158,203,226,0.95)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // irregular edge: bite soft notches out of the border so the patch is not a
  // clean rectangle. The backdrop behind the arena is dark, so the notches are
  // painted in the deep ground tone.
  ctx.fillStyle = rgba(0x0d141d, 0.5);
  for (let i = 0; i < 5; i++) {
    const side = (r() * 4) | 0;
    const t = r();
    const nx = side === 0 ? x : side === 1 ? x + w : x + t * w;
    const ny = side === 0 ? y + t * h : side === 1 ? y : side === 2 ? y + h : y + t * h;
    ctx.beginPath();
    ctx.ellipse(nx - x, ny - y, 7 + r() * 13, 6 + r() * 11, r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // crystal facets: irregular polygons, so the surface has planes in it
  const FACETS = [0xe8f6ff, 0xb6dcef, 0xd4eefb, 0x9cc4dd];
  for (let i = 0; i < 9; i++) {
    const fx = x + 6 + r() * (w - 12), fy = y + 6 + r() * (h - 12);
    const fr = 9 + r() * 20;
    const n = 5 + ((r() * 3) | 0);
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r() * 0.5;
      const rr = fr * (0.62 + r() * 0.5);
      const px = fx - x + Math.cos(a) * rr, py = fy - y + Math.sin(a) * rr * 0.7;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = rgba(FACETS[(r() * FACETS.length) | 0], 0.14 + r() * 0.16);
    ctx.fill();
  }
  // cracks: seeded polylines, branching, rather than two straight repeats
  ctx.strokeStyle = rgba(0x5f9dc0, 0.42);
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 3; i++) {
    let px = r() * w, py = r() * h;
    let a = r() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    for (let k = 0; k < 5; k++) {
      a += (r() - 0.5) * 1.5;
      px += Math.cos(a) * (8 + r() * 16);
      py += Math.sin(a) * (5 + r() * 11);
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  // sheen bands and glints
  ctx.strokeStyle = rgba(0xffffff, 0.13);
  ctx.lineWidth = 5;
  for (let i = 0; i < 2; i++) {
    const sy = 8 + r() * (h - 16);
    ctx.beginPath();
    ctx.moveTo(3, sy + 6);
    ctx.lineTo(w - 3, sy - 6);
    ctx.stroke();
  }
  ctx.fillStyle = rgba(0xffffff, 0.8);
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(r() * w, r() * h, 0.8 + r() * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}
