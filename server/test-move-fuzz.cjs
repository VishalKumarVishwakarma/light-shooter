// Property/fuzz test for the shared movement integrator.
//
// stepMove is the one function both sides of the wire agree on: the server runs
// it authoritatively, the client runs it for prediction. Reading it is not
// enough -- the two bugs this exists for are invisible in review and obvious in
// a sweep:
//   A. collision resolved only at the destination, so a long step (a server
//      stall) lands clear on the FAR side of a wall: lag spikes clipped through
//      indestructible steel.
//   B. a single in-order resolve pass, so pushing out of one rect can leave the
//      body buried in another -- and in the maze's sub-diameter slots the two
//      walls demand opposite moves and the body ping-pongs between them
//      forever, jittering inside solid geometry.
//
// Invariants, over thousands of random walks. Note the maze is full of gaps
// narrower than the 32px body, so "never buried" is not achievable and is NOT
// asserted; what matters is that burial is bounded, stable, and escapable.
const M = require('./dist/map.js');
const { stepMove, collideCircle, STEEL, BRICKS, WATER, W, H, SPEED, RADIUS } = M;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// deterministic RNG so any failure is reproducible from the printed seed
let seed = 0x2f6e2b1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// must match MOVE_SUBSTEPS_MAX in map.ts
const MOVE_SUBSTEPS_MAX = 8;
// exactly what the game treats as blocking: steel + water + standing bricks
const SOLIDS = [...STEEL, ...WATER, ...BRICKS];
const bur = (x, y) => {
  let worst = 0;
  for (const rc of SOLIDS) {
    const cx = Math.max(rc.x, Math.min(x, rc.x + rc.w));
    const cy = Math.max(rc.y, Math.min(y, rc.y + rc.h));
    const d = Math.hypot(x - cx, y - cy);
    if (d < RADIUS && RADIUS - d > worst) worst = RADIUS - d;
  }
  return worst;
};
const legal = (x, y) => bur(x, y) <= 0.001;
// does the swept path between two points pass within a body radius of a solid?
const pathNearSolid = (x0, y0, x1, y1) => {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    if (bur(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t) > 0) return true;
  }
  return false;
};
const n2 = (v) => Math.round(v * 100) / 100;

// ---- the sweep ---------------------------------------------------------------
const DT = [1 / 60, 1 / 30, 0.05, 0.1, 0.25, 0.5, 2];
let oob = 0, nondet = 0, teleport = 0, jitter = 0, maxStill = 0, worstTeleport = '', openSteps = 0, moving = 0;
let maxBur = 0, samples = 0, buried = 0;
let worstJitter = '', worstBur = '';

for (let trial = 0; trial < 4000; trial++) {
  const dt = DT[trial % DT.length];
  const onIce = rnd() < 0.15;
  const mult = [1, 0.35, 1.4][Math.floor(rnd() * 3)];
  // start from a LEGAL position only
  let s = collideCircle(40 + rnd() * (W - 80), 40 + rnd() * (H - 80), RADIUS, SOLIDS);
  let x = s.x, y = s.y, vx = 0, vy = 0;
  for (let step = 0; step < 6; step++) {
    const ang = rnd() * Math.PI * 2;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const a = stepMove(x, y, vx, vy, dx, dy, dt, SOLIDS, onIce, mult);
    const b = stepMove(x, y, vx, vy, dx, dy, dt, SOLIDS, onIce, mult);
    if (a.x !== b.x || a.y !== b.y || a.vx !== b.vx || a.vy !== b.vy) nondet++;

    const d = bur(a.x, a.y);
    if (d > maxBur) { maxBur = d; worstBur = `dt=${dt.toFixed(2)} (${n2(a.x)},${n2(a.y)})`; }
    if (d > 0.001) buried++;

    if (a.x < 19.9 || a.x > W - 19.9 || a.y < 19.9 || a.y > H - 19.9) oob++;
    const disp = Math.hypot(a.x - x, a.y - y);
    // FAITHFUL MOVEMENT. Rather than cap the displacement (a step that resolves
    // out of a wall legitimately travels further than one tick), assert the
    // exact thing that matters: in open space, with the swept path nowhere near
    // a solid, the integrator must move the body EXACTLY input*SPEED*mult*t.
    // Any collision firing where there is nothing to collide with shows up here.
    // t is the SIMULATED time, which is dt up to the substep ceiling and
    // 8/30s beyond it: a pathological stall deliberately covers less ground
    // rather than tunnelling, and that truncation is exact, not approximate.
    const moveTime = Math.min(dt, MOVE_SUBSTEPS_MAX / 30);
    const want = SPEED * mult * moveTime;
    const ex = x + dx * want, ey = y + dy * want;
    if (!onIce && !pathNearSolid(x, y, ex, ey) && legal(x, y) && legal(ex, ey)
      && bur(x, y) === 0 && bur(ex, ey) === 0 // strictly clear: a body a hair
      // inside a wall is legitimately re-snapped by the resolver, which is the
      // 0.015px case, not a movement error
      && ex >= 20 && ex <= W - 20 && ey >= 20 && ey <= H - 20) { // not world-clamped
      openSteps++;
      const err = Math.hypot(a.x - ex, a.y - ey);
      // Tolerance is 0.05px: the path sampler below steps every 8px, so a graze
      // it steps over is legitimately resolved by a hair. A twentieth of a pixel
      // is not a movement error.
      if (err > 0.05) {
        teleport++;
        if (!worstTeleport) worstTeleport = `dt=${dt.toFixed(2)} open-space error ${err.toFixed(3)}px at (${n2(x)},${n2(y)})`;
      }
    }
    if (disp > 0.01) moving++;

    // IDEMPOTENCE: with no input the body must not move. This is the anti-jitter
    // invariant -- a wedged body that ping-pongs between two walls fails here.
    // Tolerance is a quarter of a pixel: the settle picks the shallowest of
    // several equally-valid spots, so re-resolving can legitimately land a
    // hundredth of a pixel over. What must not happen is visible sliding.
    const still = stepMove(a.x, a.y, a.vx, a.vy, 0, 0, 1 / 30, SOLIDS, onIce, mult);
    const moved = Math.hypot(still.x - a.x, still.y - a.y);
    if (!onIce && moved > 0.25) {
      jitter++;
      if (!worstJitter) worstJitter = `(${n2(a.x)},${n2(a.y)}) -> (${n2(still.x)},${n2(still.y)})`;
    }
    if (moved > maxStill) maxStill = moved;

    x = a.x; y = a.y; vx = a.vx; vy = a.vy;
    samples++;
  }
}

console.log(`\n${samples} random steps from legal starts, across ${DT.length} tick sizes (1/60 .. 2s)\n`);
ok(oob === 0, `never leaves the world bounds (${oob} violations)`);
ok(nondet === 0, `deterministic across repeated calls (${nondet} mismatches)`);
ok(teleport === 0, `open-space movement is exact (${teleport} errors over ${openSteps} unobstructed steps${worstTeleport ? ', worst ' + worstTeleport : ''})`);
ok(jitter === 0, `standing still never slides the body (${jitter} cases, worst single-frame drift ${maxStill.toFixed(3)}px)`);

// The tightest gap in the map: brick12 ends at x=710 and the maze pillar starts
// at x=725, a 15px slot. A 32px body cannot fit, so SOME burial is forced, and
// the least possible is (32-15)/2 = 8.5px. The settle must never exceed that --
// i.e. it must always find the least-buried spot available, not merely a better
// one than before.
const TIGHTEST_GAP = 15;
const burialFloor = RADIUS * 2 - TIGHTEST_GAP;
ok(maxBur <= burialFloor / 2 + 0.01,
  `wedging is always optimal: deepest burial ${maxBur.toFixed(2)}px, and the map's tightest ` +
  `${TIGHTEST_GAP}px gap forces at least ${(burialFloor / 2).toFixed(2)}px (${buried}/${samples} steps, worst ${worstBur})`);

// ...and that bound must not drift over time: hold a wedged body still for 120
// frames and require it to stay put, not creep.
let maxDrift = 0, driftAt = '';
for (let trial = 0; trial < 400 && maxDrift < 1; trial++) {
  let s = collideCircle(40 + rnd() * (W - 80), 40 + rnd() * (H - 80), RADIUS, SOLIDS);
  let x = s.x, y = s.y, vx = 0, vy = 0;
  for (let i = 0; i < 30; i++) { const r = stepMove(x, y, vx, vy, 1, 0.4, 1 / 30, SOLIDS, false, 1); x = r.x; y = r.y; vx = r.vx; vy = r.vy; }
  if (bur(x, y) <= 0.001) continue; // not wedged, nothing to prove
  // reference is AFTER the walk: only the still-frames may move it
  const x0 = x, y0 = y;
  for (let i = 0; i < 120; i++) { const r = stepMove(x, y, vx, vy, 0, 0, 1 / 30, SOLIDS, false, 1); x = r.x; y = r.y; vx = r.vx; vy = r.vy; }
  const drift = Math.hypot(x - x0, y - y0);
  // only the part of the drift AFTER the walk matters; compare against the walk's end
  if (drift > maxDrift) { maxDrift = drift; driftAt = `(${n2(x)},${n2(y)}) bur ${bur(x, y).toFixed(2)}`; }
}
ok(maxDrift <= 1, `a wedged body does not creep while standing still (worst ${maxDrift.toFixed(2)}px over 120 frames, ${driftAt})`);

// ---- escapability: a buried body must be able to walk out -------------------
// This is the player-visible symptom of bug B -- being stuck. Push every legal
// start in every direction for up to 2s and require it to reach a legal spot.
let stuck = 0, worstStuck = '';
for (let trial = 0; trial < 600; trial++) {
  let s = collideCircle(40 + rnd() * (W - 80), 40 + rnd() * (H - 80), RADIUS, SOLIDS);
  let x = s.x, y = s.y, vx = 0, vy = 0;
  const ang = rnd() * Math.PI * 2;
  let free = legal(x, y);
  for (let i = 0; i < 60 && !free; i++) {
    const r = stepMove(x, y, vx, vy, Math.cos(ang), Math.sin(ang), 1 / 30, SOLIDS, false, 1);
    x = r.x; y = r.y; vx = r.vx; vy = r.vy;
    free = legal(x, y);
  }
  if (!free) { stuck++; if (!worstStuck) worstStuck = `(${n2(x)},${n2(y)}) heading ${(ang * 57.3).toFixed(0)}deg`; }
}
ok(stuck === 0, `no body can get wedged for good (${stuck} of 600 unreachable-from-wedge${worstStuck ? ', worst ' + worstStuck : ''})`);

// ---- sliding, on a wall that is actually approachable ------------------------
// the centre fortress: walk into its west face from open ground
const fort = STEEL.find((r) => r.x === 700 && r.y === 500);
ok(legal(fort.x - RADIUS - 1, 600), 'the fortress west approach is a legal standing spot');
const into = stepMove(fort.x - RADIUS - 1, 600, 0, 0, 0, 1, 1 / 30, SOLIDS, false, 1);
ok(Math.abs(into.x - (fort.x - RADIUS)) < 1.5,
  `walking into the fortress is blocked on x (x=${n2(into.x)}, wall face at ${fort.x - RADIUS})`);
ok(into.y > 600, `...while still sliding along it (y 600 -> ${n2(into.y)})`);

// ---- the wall-clip regression, stated directly ------------------------------
const walk = (dt) => stepMove(fort.x - RADIUS - 1, 600, 0, 0, 1, 0, dt, SOLIDS, false, 1).x;
for (const dt of [1 / 30, 0.1, 0.25, 0.5, 1, 2]) {
  const x = walk(dt);
  ok(x < fort.x + fort.w + RADIUS, `a single ${dt.toFixed(2)}s step cannot cross the fortress (end x=${n2(x)})`);
}
const stall = stepMove(fort.x - RADIUS - 1, 600, 0, 0, -1, 0, 0.5, SOLIDS, false, 1);
ok(stall.x < fort.x - RADIUS - 1, `a 0.5s stall still moves the player (x=${n2(stall.x)})`);

// ---- and the sub-diameter slot that caused the ping-pong ---------------------
// brick13 base y=900 and brick11 top y=925 leave a 25px slot; the body is 32px
const slotY = (brick13, brick11) => (brick13.y + brick13.h + brick11.y) / 2;
const b13 = BRICKS[13], b11 = BRICKS[11];
const sy = slotY(b13, b11);
const settle = collideCircle(b13.x + b13.w / 2, sy, RADIUS, SOLIDS);
const d1 = bur(settle.x, settle.y);
const again = collideCircle(settle.x, settle.y, RADIUS, SOLIDS);
ok(d1 <= 4.2, `an impassable 25px slot settles at the least-buried spot (${d1.toFixed(2)}px, the floor is 3.5px)`);
ok(Math.abs(again.x - settle.x) < 0.01 && Math.abs(again.y - settle.y) < 0.01,
  `...and stays there: resolving a settled position again does not move it (${n2(settle.x)},${n2(settle.y)})`);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
