// Unit tests for arena geometry. Run after `npm run build`: node test-map.cjs
const M = require('./dist/map.js');
const fs = require('fs');
const path = require('path');
const { STEEL, BRICKS, BRICK_HP, WATER, ICE, BUSH, SPAWNS, PICKUP_POINTS, WEAPONS, WORLD } = M;
const { collideCircle, pointInWall, inRect, stepMove, randomSpot } = M;
let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`PASS: ${msg}`); }
  else { fail++; console.log(`FAIL: ${msg}`); }
};

// 0. The client's map.ts is a hand-maintained duplicate of this one. If they
// drift, the client renders ranges/geometry the server does not simulate -- and
// nothing else in the build would catch it. Compare content, not line endings.
const norm = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').trim();
const clientMap = path.join(__dirname, '..', 'client', 'src', 'map.ts');
ok(fs.existsSync(clientMap) && norm(clientMap) === norm(path.join(__dirname, 'src', 'map.ts')),
  'client/src/map.ts is in sync with server/src/map.ts');

// 1. Center-inside point gets pushed out (fortress west face)
const c = collideCircle(800, 600, 16, STEEL);
ok(!pointInWall(c.x, c.y, STEEL) && Math.abs(c.x - 684) < 0.01, `fortress pushes out (${c.x.toFixed(0)},${c.y.toFixed(0)})`);

// 2. Open-field point untouched
const o = collideCircle(200, 200, 16, STEEL);
ok(o.x === 200 && o.y === 200, 'open field untouched');

// 3. Brick rect behaves like a wall while standing. Derive the probe from the
// rect so moving level geometry cannot silently invalidate the assertion.
const b6 = BRICKS[6];
const e = collideCircle(b6.x + 10, b6.y + b6.h / 2, 16, [b6]);
ok(Math.abs(e.x - (b6.x - 16)) < 0.01, `brick face resolves to r (${e.x}, want ${b6.x - 16})`);

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
// 7b. ...and every pad is actually WALKABLE to. "not inside a wall" is much
// weaker than "you can reach it": a brick dropped onto the approach to the
// grenade pad left the pad on open ground and walled it off completely, and only
// the integration suite (which walks there) noticed. Flood-fill the walkable
// space from the spawns with the real body radius and require every pad inside.
const CELL = 8;
const cols = Math.ceil(M.WORLD.w / CELL), rows = Math.ceil(M.WORLD.h / CELL);
const walkable = (cx, cy) => !M.collideCircle(cx * CELL + CELL / 2, cy * CELL + CELL / 2, M.RADIUS, SOLIDS)
  || (() => {
    // a cell is usable if the body can stand at its centre
    const r = M.collideCircle(cx * CELL + CELL / 2, cy * CELL + CELL / 2, M.RADIUS, SOLIDS);
    return Math.hypot(r.x - (cx * CELL + CELL / 2), r.y - (cy * CELL + CELL / 2)) < 0.01;
  })();
const reach = new Uint8Array(cols * rows);
const q = [];
for (const [sx, sy] of M.SPAWNS) {
  const cx = Math.floor(sx / CELL), cy = Math.floor(sy / CELL);
  if (!walkable(cx, cy)) continue;
  if (!reach[cy * cols + cx]) { reach[cy * cols + cx] = 1; q.push([cx, cy]); }
}
while (q.length) {
  const [cx, cy] = q.pop();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx2 = cx + dx, ny2 = cy + dy;
    if (nx2 < 0 || ny2 < 0 || nx2 >= cols || ny2 >= rows) continue;
    if (reach[ny2 * cols + nx2] || !walkable(nx2, ny2)) continue;
    reach[ny2 * cols + nx2] = 1;
    q.push([nx2, ny2]);
  }
}
const reachable = (x, y) => {
  // a pad is reachable if any cell within a body radius of it was flood-filled
  const r = Math.ceil(M.RADIUS / CELL) + 1;
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const ax = cx + dx, ay = cy + dy;
      if (ax < 0 || ay < 0 || ax >= cols || ay >= rows) continue;
      if (reach[ay * cols + ax]) return true;
    }
  }
  return false;
};
const unreachable = PICKUP_POINTS.filter(([, x, y]) => !reachable(x, y)).map(([k, x, y]) => `${k}@${x},${y}`);
ok(unreachable.length === 0,
  `every pickup pad is walkable from a spawn (${unreachable.length} walled off${unreachable.length ? ': ' + unreachable.join(', ') : ''})`);
const spawnsSeen = M.SPAWNS.filter(([x, y]) => reach[Math.floor(y / CELL) * cols + Math.floor(x / CELL)]).length;
ok(spawnsSeen === M.SPAWNS.length, `all ${M.SPAWNS.length} spawns are on walkable ground (${spawnsSeen})`);
ok(PICKUP_POINTS.length === 16, '16 pickup points (guns + stance + throwables)');
ok(PICKUP_POINTS.filter(([k]) => k === 'sniper').length === 2, 'sniper spawns east + west');
ok(PICKUP_POINTS.some(([k]) => k === 'electric'), 'electric pad on the map');
// every gun has its own distinct fire envelope
const rgs = Object.keys(WEAPONS).map((k) => WEAPONS[k].speed * WEAPONS[k].life);
ok(new Set(rgs).size === rgs.length, `all ${rgs.length} guns have unique ranges`);
ok(WEAPONS.electric.speed * WEAPONS.electric.life > 200
  && WEAPONS.electric.speed * WEAPONS.electric.life < 1000,
`electric range mid-pack (${(WEAPONS.electric.speed * WEAPONS.electric.life) | 0})`);
// the electric rail was given 2 extra world tiles of reach (1 tile = 60px of
// world art), so it must cover 800 + 120 = 920px -- and must not have crept
// past the rifle while doing it.
const elec = WEAPONS.electric.speed * WEAPONS.electric.life;
const TILE = 60;
ok(elec === 800 + 2 * TILE, `electric covers 800 + 2 tiles (${elec | 0}px)`);
ok(elec > WEAPONS.pistol.speed * WEAPONS.pistol.life
  && elec < WEAPONS.rifle.speed * WEAPONS.rifle.life,
`electric still sits pistol-to-rifle (${(WEAPONS.pistol.speed * WEAPONS.pistol.life) | 0} < ${elec | 0} < ${(WEAPONS.rifle.speed * WEAPONS.rifle.life) | 0})`);
for (const k of ['grenade', 'smoke', 'molly']) {
  ok(PICKUP_POINTS.some(([kk]) => kk === k), `${k} pad on the map`);
}

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

// 12. Random respawn spots: seeded samples always land on open ground,
// spread out (not one nest), and stay in-bounds.
let seed = 42;
const rng = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const seen = new Set();
let spotOk = true;
for (let i = 0; i < 50; i++) {
  const s = randomSpot(rng, SOLIDS);
  if (s.x < 60 || s.x > WORLD.w - 60 || s.y < 60 || s.y > WORLD.h - 60) spotOk = false;
  for (const wl of SOLIDS) {
    const cx = Math.max(wl.x, Math.min(s.x, wl.x + wl.w));
    const cy = Math.max(wl.y, Math.min(s.y, wl.y + wl.h));
    if (Math.hypot(s.x - cx, s.y - cy) < 30) { spotOk = false; console.log('  bad spot', s); break; }
  }
  seen.add(`${s.x | 0},${s.y | 0}`);
}
ok(spotOk, '50 seeded spots all on open ground');
ok(seen.size > 40, `spots spread out (${seen.size}/50 unique)`);
ok(range('sniper') > WORLD.w, `sniper crosses the map (${range('sniper') | 0} > ${WORLD.w})`);
ok(range('pistol') < diag / 2, `pistol can't cross half the map (${range('pistol') | 0})`);
ok(range('shotgun') < 300, `shotgun is a room broom (${range('shotgun') | 0})`);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
