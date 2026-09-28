// Mouse-wheel selector: does one gesture move the right number of slots?
//
// The previous suite MIRRORED the implementation (its own copy of the constants
// and arithmetic), which is how the real bug survived: the suite asserted
// "a sustained scroll -> 1-4 moves", i.e. it encoded the cap as expected
// behaviour. These constants are now parsed out of ArenaScene.ts, and the
// shape of the handler is asserted too, so reverting to event-counting fails
// here instead of shipping.
//
// Device reality being modelled:
//   MOUSE   one wheel event per physical notch, deltaY ~100
//   TRACKPAD many small events per second, deltaY ~2-8, no notches at all
import fs from 'node:fs';

const src = fs.readFileSync('src/scenes/ArenaScene.ts', 'utf8');
const SLOTS = [...src.matchAll(/\{ key: '(\d)', nm: '([^']*)', id: '(\w+)', kind: '(\w+)' \}/g)]
  .map((m) => ({ key: m[1], id: m[3], kind: m[4] }));

const num = (name) => {
  const m = src.match(new RegExp(`const ${name} = ([0-9.]+);`));
  if (!m) throw new Error(`cannot find ${name} in ArenaScene.ts`);
  return +m[1];
};
const NOTCH = num('WHEEL_NOTCH'), EVENT_MAX = num('WHEEL_EVENT_MAX');
const GESTURE_MAX = num('WHEEL_GESTURE_MAX'), GESTURE_MS = num('WHEEL_GESTURE_MS');
const SETTLE_MS = num('WHEEL_SETTLE_MS');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// The handler must weight by magnitude. If someone restores `if (dy > 0)
// this.wheelAcc += 1`, the simulation below stops describing the shipped code
// and would happily pass -- so the SHAPE of the algorithm is asserted directly,
// and every tunable is a named constant this file parses. Behaviour can only
// change by changing a constant the test reads.
ok(/dy \/ WHEEL_NOTCH/.test(src), 'the handler divides deltaY by WHEEL_NOTCH (counts notches, not events)');
ok(!/if \(dy > 0\) this\.wheelAcc \+= 1;/.test(src), 'the handler does not count raw events');
ok(/Math\.trunc\(this\.wheelAcc\)/.test(src), 'only whole notches are committed; the fraction carries over');
ok(/this\.wheelAcc -= steps;/.test(src), 'the leftover fraction is kept, not thrown away');
ok(/this\.wheelAt > WHEEL_GESTURE_MS/.test(src), 'the gesture window uses WHEEL_GESTURE_MS, not a literal');
ok(/this\.wheelAt < WHEEL_SETTLE_MS/.test(src), 'the settle delay uses WHEEL_SETTLE_MS, not a literal');
ok(/Math\.min\(WHEEL_EVENT_MAX, dy \/ WHEEL_NOTCH\)/.test(src), 'the per-event clamp uses WHEEL_EVENT_MAX');
ok(/Math\.min\(WHEEL_GESTURE_MAX, this\.wheelAcc \+ notches\)/.test(src), 'the per-gesture clamp uses WHEEL_GESTURE_MAX');
// no bare numbers left in the wheel handler itself
const handler = src.slice(src.indexOf("this.input.on('wheel'"), src.indexOf("this.input.on('wheel'") + 900);
ok(!/\b(150|320)\b/.test(handler), 'the wheel handler carries no bare timing literals');
ok(!/Math\.[a-z]+\(\s*-?\d+\s*\)/.test(handler), 'the wheel handler carries no bare numeric clamps');

class Wheel {
  constructor() { this.acc = 0; this.at = 0; this.active = SLOTS[0].id; this.moves = 0; this.sel = []; }
  event(now, dy) {
    if (now - this.at > GESTURE_MS) this.acc = 0;
    this.at = now;
    const n = Math.max(-EVENT_MAX, Math.min(EVENT_MAX, dy / NOTCH));
    this.acc = Math.max(-GESTURE_MAX, Math.min(GESTURE_MAX, this.acc + n));
  }
  frame(now, cycle) {
    if (now - this.at < SETTLE_MS) return;
    const steps = Math.trunc(this.acc);
    if (!steps) return;
    this.acc -= steps;
    if (cycle.length < 2) return;
    const i = cycle.findIndex((s) => s.id === this.active);
    const from = i < 0 ? 0 : i;
    const idx = ((from + steps) % cycle.length + cycle.length) % cycle.length;
    this.active = cycle[idx].id;
    this.sel.push(cycle[idx].id);
    this.moves++;
  }
  run(events, cycle, { frame = 16, total = 4000 } = {}) {
    let t = 0, n = 0;
    while (t < total) {
      while (n < events.length && events[n].at <= t) { this.event(t, events[n].dy); n++; }
      this.frame(t, cycle);
      t += frame;
    }
    return { moves: this.moves, active: this.active, sel: this.sel };
  }
}

const cycle = SLOTS.map((s) => ({ id: s.id }));
const bare = SLOTS.filter((s) => s.kind !== 'gun' || s.id === 'pistol').map((s) => ({ id: s.id }));
const mouse = (start, n, gap = 60) => Array.from({ length: n }, (_, i) => ({ at: start + i * gap, dy: 100 }));
// A real two-finger flick reports deltas of 10-40 per event, so 18 events is a
// few hundred px of travel -- a couple of notches' worth, NOT eighteen.
const flick = (start, n, dy = 20, gap = 12) => Array.from({ length: n }, (_, i) => ({ at: start + i * gap, dy }));
// ...and a slow two-finger drag is a few px per event, which is deliberately
// below one notch: it should bank progress rather than jump.
const drag = (start, n, dy = 5, gap = 30) => Array.from({ length: n }, (_, i) => ({ at: start + i * gap, dy }));

// ---- the regression: a mouse scroll must move as many slots as it notched -----
let r = new Wheel().run(mouse(16, 6, 60), cycle);
ok(r.sel[0] === SLOTS[6].id,
  `a 6-notch roll advances 6 slots in ONE commit (got to ${r.active}, want ${SLOTS[6].id})`);
ok(r.moves === 1, `...and still only one commit, so no switch spam (${r.moves})`);

// A held-down wheel emits notches faster than the 320ms gesture window, so a
// long hold is deliberately ONE gesture. What matters is that it is no longer
// pinned at the old 4-slot ceiling.
r = new Wheel().run(mouse(16, 8, 40), cycle, { total: 6000 });
ok(r.moves === 1, `a continuous 8-notch hold is one coalesced commit (${r.moves})`);
ok(r.sel[0] === SLOTS[8].id,
  `...and travels all 8 slots, double the old ceiling (${r.active})`);

// 20 notches exceeds GESTURE_MAX, which is a full lap of the 10-slot strip
r = new Wheel().run(mouse(16, 20, 40), cycle, { total: 6000 });
ok(r.moves === 1 && r.sel[0] === SLOTS[0].id,
  `a 20-notch hold clamps to one gesture and wraps a full lap (${r.active})`);

r = new Wheel().run(mouse(16, 1), cycle);
ok(r.moves === 1 && r.active === SLOTS[1].id, `one notch -> exactly one slot (${r.active})`);

// ---- a trackpad is still a selector, not a twitch ---------------------------
r = new Wheel().run(flick(16, 18), cycle);
ok(r.moves === 1, `an 18-event trackpad flick is one commit (${r.moves})`);
const byFlick = cycle.findIndex((s) => s.id === r.active);
ok(byFlick >= 1 && byFlick <= 4,
  `...and moves a few slots, not eighteen and not zero (${byFlick})`);

// a slow drag travels less than a notch, so it must not jump -- but the
// fraction has to bank, or slow scrolling would never move at all
r = new Wheel().run(drag(16, 10), cycle, { total: 1200 });
ok(r.moves === 0, `a sub-notch drag moves nothing yet (${r.moves})`);
r = new Wheel().run(drag(16, 40), cycle, { total: 3000 });
ok(r.moves >= 1, `...and a longer drag banks up to a whole notch and fires (${r.moves})`);

// ---- bounds still hold ------------------------------------------------------
r = new Wheel().run([{ at: 16, dy: 1200 }], cycle);
ok(r.active === SLOTS[EVENT_MAX].id, `a single 1200-delta fling is clamped to ${EVENT_MAX} slots (${r.active})`);

r = new Wheel().run(mouse(16, 60, 8), cycle, { total: 8000 });
ok(r.moves >= 1, 'a violent continuous roll still commits (no silent drop)');

// ---- jitter, direction, wrap, bare cycle -----------------------------------
r = new Wheel().run([
  { at: 16, dy: 2 }, { at: 32, dy: -2 }, { at: 48, dy: 2 }, { at: 64, dy: -2 },
], cycle);
ok(r.moves === 0, `opposing jitter -> 0 moves (${r.moves})`);

r = new Wheel().run([{ at: 16, dy: 100 }, { at: 900, dy: -100 }], cycle);
ok(r.active === SLOTS[0].id, `scroll down then up returns to start (${r.active})`);

r = new Wheel().run(SLOTS.map((_, i) => ({ at: 16 + i * 400, dy: 100 })), cycle,
  { total: 16 + SLOTS.length * 400 + 400 });
ok(r.active === SLOTS[0].id, `a full lap wraps back to the start (${r.active})`);

r = new Wheel().run(mouse(16, 3), bare);
ok(r.active === 'molly',
  `the bare cycle (pistol only) walks pistol -> grenade -> smoke -> molly (${r.active})`);
ok(bare.length === 5, `bare cycle is ${bare.map((s) => s.id).join(',')}`);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
