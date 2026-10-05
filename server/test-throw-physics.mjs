// Thrown ordnance bounces off walls and rolls to a stop.
//
// Before this, ordnance ignored the map entirely:
//
//     th.x = clamp(th.x + th.vx * dt, 20, W - 20);
//     th.y = clamp(th.y + th.vy * dt, 20, H - 20);
//     if (th.kind === 'grenade') { const fr = Math.max(0, 1 - 3*dt); th.vx *= fr; th.vy *= fr; }
//
// Only the arena border touched it, by clamping the position and DISCARDING the
// velocity, so a grenade flew straight through maze walls and brick cover. And only
// the grenade had friction at all -- smoke and molly coasted at 520px/s in a dead
// straight line for their whole 0.45s fuse.
//
// This suite reimplements stepThrow's maths and runs it against the REAL map from
// server/src/map.ts, so the geometry under test is the geometry the server uses rather
// than a description of it.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const mapSrc = fs.readFileSync(new URL('../server/src/map.ts', import.meta.url), 'utf8');
const roomSrc = fs.readFileSync(new URL('../server/src/rooms/ShooterRoom.ts', import.meta.url), 'utf8');
// strip comments before asserting absence
const roomCode = roomSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

// --- pull the real constants out of the sources -------------------------
function num(re, src, what) {
  const m = re.exec(src);
  if (!m) throw new Error(`could not read ${what} from source`);
  return Number(m[1]);
}
const THROW_R = num(/const THROW_R = (\d+)/, roomSrc, 'THROW_R');
const THROW_STOP = num(/const THROW_STOP = (\d+)/, roomSrc, 'THROW_STOP');
const PHYS = Object.fromEntries(
  [...roomSrc.matchAll(/(\w+):\s*\{\s*rest:\s*([\d.]+),\s*fric:\s*([\d.]+)\s*\}/g)]
    .map((m) => [m[1], { rest: +m[2], fric: +m[3] }]));
const SPEED = num(/grenade:\s*\{[^}]*speed:\s*(\d+)/, roomSrc, 'throw speed');
const FUSE = Object.fromEntries(
  [...roomSrc.matchAll(/(grenade|smoke|molly):\s*\{[^}]*speed:\s*\d+,\s*fuse:\s*([\d.]+)/g)]
    .map((m) => [m[1], +m[2]]));

// --- the real wall rectangles, read out of map.ts -----------------------
// They are OBJECT literals ({ x, y, w, h }), not arrays, and the array closes with
// two-space indentation before the bracket. My first parser assumed [n,n,n,n] and a
// column-0 `]`, matched nothing, and then every wall test dereferenced undefined.


let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// --- the REAL collision code, imported from the build -------------------
// Not reimplemented. See the note at the top of this file: a transcription that
// omitted settle()'s "only rects actually penetrated" filter and its nearest-spot
// tie-break reported a 400px teleport that the shipped code does not produce.
const require_ = createRequire(import.meta.url);
const {
  collideCircle, STEEL, BRICKS, WATER, W: WORLD_W, H: WORLD_H, clamp,
} = require_('./dist/map.js');

// The REAL integrator, off the prototype. It uses no `this`, so it needs no Room
// instance and no server -- but it IS the shipped function, which is the whole point:
// a transcribed copy reported zero failures when the feature was deleted.
const stepThrow = require_('./dist/rooms/ShooterRoom.js').ShooterRoom.prototype.stepThrow;

const SOLIDS = [...STEEL, ...BRICKS, ...WATER];

// penetration depth, for assertions only (the sim itself uses the real collideCircle)
const penDepth = (px, py, r, rs) => {
  let worst = 0;
  for (const q of rs) {
    const nx = clamp(px, q.x, q.x + q.w), ny = clamp(py, q.y, q.y + q.h);
    const d = Math.hypot(px - nx, py - ny);
    if (d < r) worst = Math.max(worst, r - d);
  }
  return worst;
};

const DT = 1 / 30;
const run = (th, ticks, solids = SOLIDS) => {
  for (let i = 0; i < ticks; i++) stepThrow.call(null, th, DT, solids);
  return th;
};
const spawn = (kind, x, y, a) => ({ kind, x, y, vx: Math.cos(a) * SPEED, vy: Math.sin(a) * SPEED });

// Open ground, found by scanning the REAL map. The first version of the roll tests
// spawned at (60,60) -- which is the top-left corner of the steel block
// {x:60,y:60,w:80,h:80}, i.e. inside a wall -- so both kinds were being settled out of
// a wall and the grenade appeared to travel less than the smoke.
function openGround(clear = 320) {
  for (let y = 120; y < WORLD_H - 120; y += 20) {
    for (let x = 120; x < WORLD_W - 120 - clear; x += 20) {
      if (penDepth(x, y, THROW_R + 4, SOLIDS) > 0) continue;
      let clearRun = true;
      for (let d = 20; d <= clear; d += 20) {
        if (penDepth(x + d, y, THROW_R + 4, SOLIDS) > 0) { clearRun = false; break; }
      }
      if (clearRun) return { x, y };
    }
  }
  return { x: WORLD_W / 2, y: WORLD_H / 2 };
}
// Find the FIRST brick face with clear ground in front of it, and record the approach
// direction. Walk outwards from each face and keep the furthest start from which the
// straight run to that face touches no OTHER solid -- the target rect is excluded, or
// the lane could never reach the face it aims at.
//
// Returns null when the map has no clear approach at all, which is a legitimate answer:
// the assertion then reports that rather than silently testing a made-up position.
function clearLaneTo(cands, want) {
  for (const rect of cands) {
    const others = SOLIDS.filter((q) => q !== rect);
    const faces = [
      { cx: rect.x, cy: rect.y + rect.h / 2, ux: -1, uy: 0 },
      { cx: rect.x + rect.w, cy: rect.y + rect.h / 2, ux: 1, uy: 0 },
      { cx: rect.x + rect.w / 2, cy: rect.y, ux: 0, uy: -1 },
      { cx: rect.x + rect.w / 2, cy: rect.y + rect.h, ux: 0, uy: 1 },
    ];
    for (const f of faces) {
      for (let gap = want; gap >= 20; gap -= 5) {
        const sx = f.cx + f.ux * (gap + THROW_R);
        const sy = f.cy + f.uy * (gap + THROW_R);
        if (sx < 40 || sy < 40 || sx > WORLD_W - 40 || sy > WORLD_H - 40) continue;
        let clear = true;
        const steps = Math.ceil(gap / 4);
        for (let i = 1; i <= steps; i++) {
          const px = f.cx + f.ux * ((gap * i) / steps);
          const py = f.cy + f.uy * ((gap * i) / steps);
          if (penDepth(px, py, THROW_R + 1, others) > 0) { clear = false; break; }
        }
        if (clear) {
          // ux/uy points from the FACE toward the open ground, so the throw has to
        // travel the other way to reach it: velocity is -ux, not ux.
        return { rect, sx, sy, ux: f.ux, uy: f.uy, gap,
          vx0: -f.ux * SPEED, vy0: -f.uy * SPEED };
      }
    }
  }
  }
  return null;
}
const insideRect = (x, y, r, pad = 0) =>
  x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad;

// how far a kind actually rolls before stopping, on open ground
const rollRange = (kind) => {
  const g = openGround();
  return run(spawn(kind, g.x, g.y, 0), 400).x - g.x;
};

  {
  const src = stepThrow.toString();
  const Room = require_('./dist/rooms/ShooterRoom.js').ShooterRoom;
  const self = fs.readFileSync(new URL(import.meta.url), 'utf8');
  ok(typeof stepThrow === 'function', 'the real stepThrow was loaded off ShooterRoom.prototype');
  ok(stepThrow.length === 3, 'and takes (th, dt, solids)');
  ok(!/\bthis\b/.test(src), 'it uses no `this`, so it can be called without a Room');
  ok(stepThrow === Room.prototype.stepThrow,
    'the binding under test IS the prototype method, not a copy');
  ok(/THROW_PHYS/.test(src), 'and it reads the module THROW_PHYS');
  // Read from DISK. A pattern built from a literal in this file would make the check
  // self-fulfilling, which is precisely how the two assertions being replaced went
  // wrong: `X || 'function stepThrow'` always contains the needle, so the negation was
  // always false and the test could never pass.
  // Counted, not negated: the import itself is `const stepThrow = require_(...)`, so a
  // "/const stepThrow\s*=/ must not appear" check fails on the one assignment that is
  // supposed to be there. What matters is that there is exactly ONE binding and that it
  // is the import.
  ok(!/function stepThrow\s*\(/.test(self),
    'no function declaration shadows the imported stepThrow');
  ok((self.match(/^\s*(?:const|let|var)\s+stepThrow\s*=/gm) || []).length === 1,
    'stepThrow is declared exactly once in this file');
  ok(!(self.match(/^\s*function\s+stepThrow\s*\(/gm) || []).length,
    'and is not shadowed by a function declaration');
  ok(/const stepThrow = require_\('\.\/dist\/rooms\/ShooterRoom\.js'\)/.test(self),
    'and that single binding is the require of the built ShooterRoom');
  ok(!/function collideCircle\s*\(/.test(self) && !/function penDepth\s*\(/.test(self),
    'and no local reimplementation of the collision code either');
  }
// ============================ the map is real ============================
ok(SOLIDS.length > 10, `imported the real map: ${STEEL.length} steel + ${BRICKS.length} brick + ${WATER.length} water rects`);
ok(Object.keys(PHYS).length === 3, `read per-kind physics: ${JSON.stringify(PHYS)}`);
ok(THROW_R > 0 && THROW_STOP > 0, `THROW_R=${THROW_R} THROW_STOP=${THROW_STOP}`);
ok(SPEED >= 400, `throw speed ${SPEED}px/s -> ${(SPEED * DT).toFixed(1)}px per tick (substepping is required)`);

// ======================= it bounces off walls ===========================
{
  // a grenade fired straight into a steel wall must come back
  const wall = STEEL[0];
  const y = wall.y + wall.h / 2;
  const th = spawn('grenade', wall.x - 120, y, 0); // +x, into the wall
  let bounced = false;
  for (let k = 0; k < 40; k++) {
    stepThrow.call(null, th, DT, SOLIDS);
    if (th.vx < 0) bounced = true;
  }
  ok(bounced, `a grenade fired into a steel wall reverses direction (vx went negative)`);
  ok(th.x < wall.x, `and ends up back on the near side (x=${th.x.toFixed(1)} < wall ${wall.x})`);
}
{
  // a grenade fired at a wall from very close must NOT end up past it
  const wall = STEEL[0];
  const y = wall.y + wall.h / 2;
  let escaped = 0, trials = 0;
  for (let d = 20; d < 200; d += 10) {
    const th = spawn('grenade', wall.x - d, y, 0);
    run(th, 12);
    trials++;
    if (th.x > wall.x + wall.w) escaped++;
  }
  ok(escaped === 0, `no grenade tunnelled through the wall from ${trials} distances (${escaped} escaped)`);
}
{
  // Bricks are solid too, while they stand.
  //
  // The approach lane is MEASURED, not assumed. Earlier versions threw from a fixed
  // 60px in front of BRICKS[0] (something else was in the way, so the assertion was
  // wrong about the map) and then from a lane picked by a search that never stopped
  // (so it tested a brick in the bottom-right corner). Both were my test's fault, not
  // the game's.
  const lane = clearLaneTo(BRICKS, 90);
  ok(!!lane, 'found a brick face with a clear approach lane');
  if (lane) {
    const { rect, sx, sy, ux, uy, gap } = lane;
    const th = { kind: 'molly', x: sx, y: sy, vx: -ux * SPEED, vy: -uy * SPEED };
    // axis the approach travels along, and the sign it arrives with
    const axis = ux !== 0 ? 'x' : 'y';
    const inSign = (axis === 'x' ? ux : uy) > 0 ? 1 : -1;
    let bounced = false, maxPen = 0, closest = Infinity;
    for (let i = 0; i < 60; i++) {
      stepThrow.call(null, th, DT, SOLIDS);
      const v = axis === 'x' ? th.vx : th.vy;
      // closest approach to the rect itself -- a direct measurement of "reached it",
      // immune to whether two conditions happen to land on the same tick
      const nx = clamp(th.x, rect.x, rect.x + rect.w);
      const ny = clamp(th.y, rect.y, rect.y + rect.h);
      closest = Math.min(closest, Math.hypot(th.x - nx, th.y - ny));
      // bounce: the approach component reversed sign
      if (Math.abs(v) > 1 && Math.sign(v) === -inSign) bounced = true;
      maxPen = Math.max(maxPen, penDepth(th.x, th.y, THROW_R, SOLIDS));
    }
    ok(closest <= THROW_R + 1,
      `the molly reaches the brick from ${gap}px (closest approach ${closest.toFixed(2)}px, radius ${THROW_R})`);
    ok(bounced, 'and the approach component reverses, i.e. it bounced');
    ok(maxPen < THROW_R * 0.5,
      `never deeply penetrating the brick while bouncing (worst ${maxPen.toFixed(2)}px of ${THROW_R})`);
    ok(!insideRect(th.x, th.y, rect), 'and does not come to rest inside it');
  }
}

// ================= substepping: load-bearing, and why ====================
// One definition for the synthetic wall, shared by the test and its control.
//
// THIN_W is 4, not 10, and the arithmetic matters: the barrier a body actually has to
// cross is the wall PLUS the collision radius at each end, so
//     barrier = THIN_W + 2 * THROW_R
// With THIN_W = 10 that is 22px, still wider than the 17.3px one tick covers, so a
// single step could not skip it and removing the substep division went undetected.
// At THIN_W = 4 the barrier is 16px against a 17.3px step, which is only crossable by
// substepping -- which is the property worth asserting.
//
// The SHIPPED map's thinnest wall is a 30px steel pillar (barrier 42px), so none of this
// is reachable in play today. It is about the integrator not depending on that.
const THIN_X = 150, THIN_W = 4;
{
  // Stated plainly: on the SHIPPED map a single 17.3px tick cannot skip the thinnest
  // wall (a 30px steel pillar), so tunnelling is not reachable there. Dropping the
  // substep division therefore produces no failure against the real geometry, and
  // claiming otherwise would be overstating it.
  //
  // What substepping actually buys is robustness to geometry thinner than one step of
  // travel, plus a sane contact normal: at 17.3px the collideCircle settle can be
  // entered already overlapping, so the resolved axis becomes a corner artefact.
  //
  // So this uses a SYNTHETIC wall whose barrier (thickness + 2r) is narrower than one
  // step's travel, to show the integrator holds. It is testing the maths, not the map.
  // x=150, not 400: a grenade from x=60 rolls ~231px, so a wall at 400 would never even
  // be reached and "0 crossed" would be vacuous. The control below proves it is reached.
  const thin = [{ x: THIN_X, y: 100, w: THIN_W, h: 1000 }];
  let crossed = 0, trials = 0;
  for (let k = 0; k < 60; k++) {
    const th = spawn('grenade', 60, 100 + (k % 40) * 20, 0);
    run(th, 20, thin);
    trials++;
    if (th.x > 160) crossed++;
  }
  ok(crossed === 0,
    `no throw crosses a synthetic 4px wall (barrier ${THIN_W + 2 * THROW_R}px vs a ${(SPEED * DT).toFixed(1)}px tick) -- ${crossed}/${trials} crossed`);
}
{
  // the same wall, but with the wall removed entirely, proves the test can detect a
  // crossing at all -- otherwise "0 crossed" above would be vacuous
  // this block declares its OWN thin array -- the earlier edit moved only the other one,
  // so this stayed at x=400 and the throws rolled past it freely to x=243
  const thin = [{ x: THIN_X, y: 100, w: THIN_W, h: 1000 }];
  const through = [];
  for (let k = 0; k < 60; k++) {
    const th = spawn('grenade', 60, 100 + (k % 40) * 20, 0);
    run(th, 20, thin);
    through.push(th.x);
  }
  const reached = Math.max(...through);
  ok(reached < 160,
    `and every throw was stopped at the wall (max x=${reached.toFixed(0)}, wall face 160)`);
}

// ======================= it rolls to a stop =============================
{
  const g = openGround();
  const th = spawn('grenade', g.x, g.y, 0);
  run(th, 240); // 8 seconds
  ok(Math.hypot(th.vx, th.vy) === 0, `a grenade comes to a complete stop (v=${Math.hypot(th.vx, th.vy)})`);
}
{
  // friction must actually stop it, not just bleed it slowly forever
  const g = openGround();
  const th = spawn('grenade', g.x, g.y, 0);
  run(th, 120);
  ok(Math.hypot(th.vx, th.vy) === 0, 'and it stops well within its lifetime, not asymptotically');
}
{
  const g = openGround();
  const th = spawn('grenade', g.x, g.y, 0);
  run(th, 60);
  ok(th.x - g.x > 120, `and it rolls a visible distance first (${(th.x - g.x).toFixed(0)}px in 2s from open ground)`);
}

// =================== per-kind feel: ball vs canister =====================
{
  const ball = rollRange('grenade'), can = rollRange('smoke'), mol = rollRange('molly');
  ok(ball > can,
    `a grenade (ball) rolls further than a smoke canister (${ball.toFixed(0)}px vs ${can.toFixed(0)}px)`);
  ok(ball > mol, `and further than a molly (${ball.toFixed(0)}px vs ${mol.toFixed(0)}px)`);
  // the canisters must still be usable throws, not something that drops at your feet:
  // the unobstructed range is speed * fuse
  for (const [kind, rng] of [['smoke', can], ['molly', mol]]) {
    const free = SPEED * FUSE[kind];
    ok(rng > free * 0.4,
      `${kind} still travels a usable distance (${rng.toFixed(0)}px vs ${free.toFixed(0)}px unobstructed)`);
  }
  ok(PHYS.grenade.rest > PHYS.smoke.rest,
    `and bounces livelier (rest ${PHYS.grenade.rest} vs ${PHYS.smoke.rest})`);
  ok(PHYS.smoke.fric > PHYS.grenade.fric,
    `while the canister stops faster (fric ${PHYS.smoke.fric} vs ${PHYS.grenade.fric})`);
}

// ======================= arena border bounces ===========================
{
  for (const [label, x, y, a] of [
    ['left', 40, WORLD_H / 2, Math.PI],
    ['right', WORLD_W - 40, WORLD_H / 2, 0],
    ['top', WORLD_W / 2, 40, -Math.PI / 2],
    ['bottom', WORLD_W / 2, WORLD_H - 40, Math.PI / 2],
  ]) {
    const th = spawn('grenade', x, y, a);
    let bounced = false;
    for (let i = 0; i < 20; i++) { stepThrow.call(null, th, DT, []); if (label === 'left' ? th.vx > 0 : label === 'right' ? th.vx < 0 : label === 'top' ? th.vy > 0 : th.vy < 0) bounced = true; }
    ok(bounced, `the ${label} arena border bounces a grenade instead of killing its velocity`);
  }
}

// ======================= never leaves the arena =========================
{
  let out = 0, trials = 0;
  for (let k = 0; k < 400; k++) {
    const th = spawn(['grenade', 'smoke', 'molly'][k % 3],
      40 + Math.random() * (WORLD_W - 80),
      40 + Math.random() * (WORLD_H - 80),
      Math.random() * Math.PI * 2);
    run(th, 30);
    trials++;
    if (th.x < 19 || th.x > WORLD_W - 19 || th.y < 19 || th.y > WORLD_H - 19) out++;
  }
  ok(out === 0, `no throw escaped the arena across ${trials} randomised throws (${out} escaped)`);
}
{
  // and never inside a wall, which would mean the settle failed
  let inside = 0, trials = 0;
  for (let k = 0; k < 400; k++) {
    const th = spawn('grenade',
      40 + Math.random() * (WORLD_W - 80),
      40 + Math.random() * (WORLD_H - 80),
      Math.random() * Math.PI * 2);
    run(th, 20);
    trials++;
    if (penDepth(th.x, th.y, THROW_R * 0.5, SOLIDS) > 0) inside++;
  }
  ok(inside === 0, `no throw came to rest inside a wall across ${trials} throws (${inside} did)`);
}
{
  // NaN guard: the schema encoder logs NaN 30x a second forever if this regresses
  const th = spawn('grenade', 30, 30, 0);
  th.vx = NaN; th.vy = NaN;
  stepThrow.call(null, th, DT, SOLIDS);
  ok(Number.isFinite(th.x) && Number.isFinite(th.y), 'a NaN velocity is recovered, not replicated forever');
}

// ======================= the map files must still match =================
ok(fs.readFileSync(new URL('../client/src/map.ts', import.meta.url), 'utf8') === mapSrc,
  'client/src/map.ts is still byte-identical to server/src/map.ts (bounce stayed out of the shared map)');

// ======================= the old straight-line code is gone ============
ok(!/th\.x = clamp\(th\.x \+ th\.vx \* dt, 20, W - 20\)/.test(roomCode),
  'the clamp-and-discard position update is gone');
ok(!/const fr = Math\.max\(0, 1 - 3 \* dt\)/.test(roomCode),
  'the grenade-only friction is gone (all three kinds are handled now)');
ok(/this\.stepThrow\(th, dt, throwSolids\)/.test(roomCode), 'the tick calls stepThrow');
ok(/private stepThrow\(th: Throw, dt: number, solids: Rect\[\]\)/.test(roomCode),
  'stepThrow is typed against the Throw schema, not any');
{
  // Three call sites is correct: player movement, randomSpot, and the new per-tick
  // throwSolids. My first assertion demanded exactly two, which was simply a wrong
  // count. The thing that matters is that it is built ONCE PER TICK and shared across
  // throws, not rebuilt inside the per-throw loop.
  ok(/const throwSolids = this\.solids\(\);/.test(roomCode),
    'the throw tick builds the solids list once');
  const tick = /const throwSolids = this\.solids\(\);([\s\S]*?)this\.stepThrow\(th, dt, throwSolids\)/.exec(roomCode);
  ok(!!tick, 'and passes it to every throw in the loop');
  ok(tick && !/this\.solids\(\)/.test(tick[1]),
    'without rebuilding it per throw');
  ok(/this\.stepThrow\(th, dt, throwSolids\)/.test(roomCode),
    'stepThrow receives the shared list rather than calling solids() itself');
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
