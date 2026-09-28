// Trace a "standing still" body that drifts.
const M = require('../server/dist/map.js');
const { stepMove, collideCircle, STEEL, BRICKS, WATER, RADIUS } = M;
const SOLIDS = [...STEEL, ...WATER, ...BRICKS];
const bur = (x, y) => {
  let w = 0;
  for (const rc of SOLIDS) {
    const cx = Math.max(rc.x, Math.min(x, rc.x + rc.w));
    const cy = Math.max(rc.y, Math.min(y, rc.y + rc.h));
    const d = Math.hypot(x - cx, y - cy);
    if (d < RADIUS && RADIUS - d > w) w = RADIUS - d;
  }
  return w;
};
const where = (x, y) => SOLIDS.map((rc, i) => {
  const cx = Math.max(rc.x, Math.min(x, rc.x + rc.w));
  const cy = Math.max(rc.y, Math.min(y, rc.y + rc.h));
  const d = Math.hypot(x - cx, y - cy);
  return d < RADIUS + 30 ? `[${rc.x},${rc.y} ${rc.w}x${rc.h} d=${d.toFixed(1)}]` : '';
}).filter(Boolean).join(' ');

// deterministic search for a drifting case
let seed = 0x2f6e2b1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
for (let trial = 0; trial < 4000; trial++) {
  let s = collideCircle(40 + rnd() * (1600 - 80), 40 + rnd() * (1200 - 80), RADIUS, SOLIDS);
  let x = s.x, y = s.y, vx = 0, vy = 0;
  for (let i = 0; i < 30; i++) { const r = stepMove(x, y, vx, vy, 1, 0.4, 1 / 30, SOLIDS, false, 1); x = r.x; y = r.y; vx = r.vx; vy = r.vy; }
  if (bur(x, y) <= 0.001) continue;
  const x0 = x, y0 = y;
  let maxStep = 0, at = null;
  for (let i = 0; i < 120; i++) {
    const px = x, py = y;
    const r = stepMove(x, y, vx, vy, 0, 0, 1 / 30, SOLIDS, false, 1);
    x = r.x; y = r.y; vx = r.vx; vy = r.vy;
    const d = Math.hypot(x - px, y - py);
    if (d > maxStep) { maxStep = d; at = [i, px, py, x, y, vx, vy]; }
  }
  const drift = Math.hypot(x - x0, y - y0);
  if (drift > 8) {
    console.log(`trial ${trial}: drift ${drift.toFixed(1)}px, worst single frame ${maxStep.toFixed(1)}px`);
    console.log(`  start (${x0.toFixed(1)},${y0.toFixed(1)}) bur ${bur(x0, y0).toFixed(2)}`);
    console.log(`  at    (${at[1].toFixed(1)},${at[2].toFixed(1)}) bur ${bur(at[1], at[2]).toFixed(2)}  ->  (${at[3].toFixed(1)},${at[4].toFixed(1)}) bur ${bur(at[3], at[4]).toFixed(2)}  v=(${at[5].toFixed(1)},${at[6].toFixed(1)})`);
    console.log(`  near: ${where(at[3], at[4])}`);
    console.log(`  end   (${x.toFixed(1)},${y.toFixed(1)}) bur ${bur(x, y).toFixed(2)}`);
    break;
  }
}
