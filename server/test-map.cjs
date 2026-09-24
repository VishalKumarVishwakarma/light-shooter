// Unit tests for arena geometry. Run after `npm run build`: node test-map.cjs
const M = require('./dist/map.js');
const { STEEL, BRICKS, BRICK_HP, WATER, ICE, BUSH, SPAWNS, PICKUP_POINTS } = M;
const { collideCircle, pointInWall, inRect, stepMove } = M;
let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`PASS: ${msg}`); }
  else { fail++; console.log(`FAIL: ${msg}`); }
};

// 1. Center-inside point gets pushed out (fortress west face)
const c = collideCircle(800, 600, 16, STEEL);
ok(!pointInWall(c.x, c.y, STEEL) && Math.abs(c.x - 684) < 0.01, `fortress pushes out (${c.x.toFixed(0)},${c.y.toFixed(0)})`);

// 2. Open-field point untouched
const o = collideCircle(200, 200, 16, STEEL);
ok(o.x === 200 && o.y === 200, 'open field untouched');

// 3. Brick rect behaves like a wall while standing
const e = collideCircle(290, 600, 16, [BRICKS[6]]);
ok(Math.abs(e.x - 264) < 0.01, `brick face resolves to r (${e.x})`);

// 4. pointInWall sanity
ok(pointInWall(750, 550, STEEL) === true, 'inside steel detected');
ok(pointInWall(200, 200, STEEL) === false, 'outside steel clear');

// 5. Every spawn clear of ALL solids (steel+bricks+water) with margin
const SOLIDS = [...STEEL, ...BRICKS, ...WATER];
const MARGIN = 40;
let allClear = true;
for (const [sx, sy] of SPAWNS) {
  for (const wl of SOLIDS) {
    const cx = Math.max(wl.x, Math.min(sx, wl.x + wl.w));
    const cy = Math.max(wl.y, Math.min(sy, wl.y + wl.h));
    const d = Math.hypot(sx - cx, sy - cy);
    if (d < MARGIN) { allClear = false; console.log(`  spawn (${sx},${sy}) too close to`, wl); }
  }
}
ok(allClear, `all ${SPAWNS.length} spawns clear (margin ${MARGIN})`);

// 6. Battle City inventory
ok(STEEL.length === 5, `${STEEL.length} steel blocks`);
ok(BRICKS.length === 8, `${BRICKS.length} brick walls`);
ok(BRICK_HP === 3, `bricks take ${BRICK_HP} hits`);
ok(WATER.length === 2, 'west+east rivers');
ok(ICE.length === 2 && BUSH.length === 3, 'ice patches + forests');

// 7. Pickups sit on open ground (not inside solids)
let pkClear = true;
for (const [kind, x, y] of PICKUP_POINTS) {
  if (inRect(x, y, SOLIDS)) { pkClear = false; console.log(`  pickup ${kind} inside solid`, x, y); }
}
ok(pkClear, `${PICKUP_POINTS.length} pickup points on open ground`);

// 8. stepMove: full speed off ice, drift on ice
const open = [];
const s1 = stepMove(200, 200, 0, 0, 1, 0, 0.05, open, false);
ok(Math.abs(s1.vx - 260) < 0.01 && Math.abs(s1.x - 213) < 0.01, 'instant response off ice');
const s2 = stepMove(500, 900, 0, 0, 1, 0, 0.05, open, true);
ok(s2.vx > 0 && s2.vx < 100, `ice drifts in (${s2.vx.toFixed(0)}px/s)`);
const s3 = stepMove(500, 900, 260, 0, 0, 0, 0.05, open, true);
ok(s3.vx > 160 && s3.vx < 260, `ice slides out (${s3.vx.toFixed(0)}px/s)`);
// 9. stepMove blocked by steel (small step stops at the face)
const s4 = stepMove(680, 600, 0, 0, 1, 0, 0.05, STEEL, false);
ok(Math.abs(s4.x - 684) < 0.01, `fortress blocks (x=${s4.x.toFixed(1)})`);

// 10. swept sampling helper math: a 120px step still samples every <=18px
const span = Math.hypot(850 * 0.14, 0);
const steps = Math.max(1, Math.ceil(span / 18));
ok(steps >= 6 && span / steps <= 18, `swept steps cover fast bullets (${steps} samples)`);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
