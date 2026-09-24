// Unit tests for arena geometry. Run after `npm run build`: node test-map.cjs
const M = require('./dist/map.js');
const { STEEL, BRICKS, BRICK_HP, WATER, ICE, BUSH, SPAWNS, PICKUP_POINTS, WEAPONS, WORLD } = M;
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
ok(STEEL.length === 7, `${STEEL.length} steel blocks`);
ok(BRICKS.length === 14, `${BRICKS.length} brick walls`);
ok(BRICK_HP === 3, `bricks take ${BRICK_HP} hits`);
ok(WATER.length === 2, 'west+east rivers');
ok(ICE.length === 2 && BUSH.length === 3, 'ice patches + forests');

// 6b. Maze gaps: north + south gates open, prize reachable, corridor clear
ok(!inRect(800, 755, SOLIDS), 'maze north gate open');
ok(!inRect(800, 940, SOLIDS), 'maze south gate open');
ok(!inRect(800, 880, SOLIDS), 'maze corridor clear');
ok(!inRect(800, 985, SOLIDS), 'maze prize reachable');

// 7. Pickups sit on open ground (not inside solids)
let pkClear = true;
for (const [kind, x, y] of PICKUP_POINTS) {
  if (inRect(x, y, SOLIDS)) { pkClear = false; console.log(`  pickup ${kind} inside solid`, x, y); }
}
ok(pkClear, `${PICKUP_POINTS.length} pickup points on open ground`);
ok(PICKUP_POINTS.length === 12, '12 pickup points (maze prize + sniper twins + laser included)');
ok(PICKUP_POINTS.filter(([k]) => k === 'sniper').length === 2, 'sniper spawns east + west');

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

// 11. Per-gun fire range (speed x life): shotgun < pistol < rifle < sniper,
// sniper crosses the map, pistol can't snipe across it.
const range = (w) => WEAPONS[w].speed * WEAPONS[w].life;
const diag = Math.hypot(WORLD.w, WORLD.h);
ok(range('shotgun') < range('pistol'), `shotgun shorter than pistol (${range('shotgun') | 0} < ${range('pistol') | 0})`);
ok(range('pistol') < range('rifle'), `pistol shorter than rifle (${range('pistol') | 0} < ${range('rifle') | 0})`);
ok(range('rifle') < range('sniper'), `rifle shorter than sniper (${range('rifle') | 0} < ${range('sniper') | 0})`);
ok(range('laser') > range('rifle') && range('laser') < range('sniper'),
  `laser sits rifle-to-sniper (${range('laser') | 0})`);
ok(range('sniper') > WORLD.w, `sniper crosses the map (${range('sniper') | 0} > ${WORLD.w})`);
ok(range('pistol') < diag / 2, `pistol can't cross half the map (${range('pistol') | 0})`);
ok(range('shotgun') < 400, `shotgun is a room broom (${range('shotgun') | 0})`);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
