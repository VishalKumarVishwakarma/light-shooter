const M = require('../server/dist/map.js');
const { collideCircle, STEEL, BRICKS, WATER, RADIUS, clamp } = M;
const SOLIDS = [...STEEL, ...WATER, ...BRICKS];
const names = [
  ...STEEL.map((r, i) => [`steel${i}`, r]),
  ...WATER.map((r, i) => [`water${i}`, r]),
  ...BRICKS.map((r, i) => [`brick${i}`, r]),
];
const bur = (x, y) => {
  let w = 0;
  for (const [, rc] of names) {
    const cx = clamp(x, rc.x, rc.x + rc.w);
    const cy = clamp(y, rc.y, rc.y + rc.h);
    const d = Math.hypot(x - cx, y - cy);
    if (d < RADIUS && RADIUS - d > w) w = RADIUS - d;
  }
  return w;
};
const hit = (x, y) => names.filter(([, rc]) => {
  const cx = clamp(x, rc.x, rc.x + rc.w), cy = clamp(y, rc.y, rc.y + rc.h);
  return Math.hypot(x - cx, y - cy) < RADIUS;
}).map(([n, rc]) => `${n} ${rc.x},${rc.y} ${rc.w}x${rc.h}`);

for (const [x, y] of [[1298.32, 592.75], [1244, 544], [1250.17, 649.92]]) {
  const r = collideCircle(x, y, RADIUS, SOLIDS);
  console.log(`(${x}, ${y}) bur=${bur(x, y).toFixed(2)} in [${hit(x, y).join(' | ')}]`);
  console.log(`  -> collideCircle = (${r.x.toFixed(2)}, ${r.y.toFixed(2)}) bur=${bur(r.x, r.y).toFixed(2)}`);
  console.log(`  nearby: [${hit(r.x, r.y).join(' | ')}]`);
  // what do the individual escapes look like?
  for (const [n, rc] of names) {
    const cx = clamp(x, rc.x, rc.x + rc.w), cy = clamp(y, rc.y, rc.y + rc.h);
    const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
    if (d2 >= RADIUS * RADIUS) continue;
    let ex, ey;
    if (d2 === 0) {
      const l = x - rc.x, rr2 = rc.x + rc.w - x, t = y - rc.y, bb = rc.y + rc.h - y;
      const m = Math.min(l, rr2, t, bb);
      if (m === l) { ex = rc.x - RADIUS; ey = y; } else if (m === rr2) { ex = rc.x + rc.w + RADIUS; ey = y; }
      else if (m === t) { ex = x; ey = rc.y - RADIUS; } else { ex = x; ey = rc.y + rc.h + RADIUS; }
    } else {
      const d = Math.sqrt(d2);
      ex = cx + (dx / d) * RADIUS; ey = cy + (dy / d) * RADIUS;
    }
    console.log(`  escape via ${n}: (${ex.toFixed(2)}, ${ey.toFixed(2)}) bur=${bur(ex, ey).toFixed(2)}`);
  }
  console.log();
}
