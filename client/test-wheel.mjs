// Simulate the wheel-gesture coalescer against realistic browser event
// patterns: a single mouse notch, a trackpad flick (many small events), a hard
// 3-notch roll, a sustained scroll and jitter. One flick must move the loadout
// by one step, not half of it.
import fs from 'node:fs';

const src = fs.readFileSync('src/scenes/ArenaScene.ts', 'utf8');
const SLOTS = [...src.matchAll(/\{ key: '(\d)', nm: '([^']*)', id: '(\w+)', kind: '(\w+)' \}/g)]
  .map((m) => ({ key: m[1], id: m[3], kind: m[4] }));

// mirror of the shipped implementation
const NEW_GESTURE_MS = 320, SETTLE_MS = 150, CAP = 4;

class Wheel {
  constructor() { this.acc = 0; this.at = 0; this.active = SLOTS[0].id; this.moves = 0; }

  event(now, dy) {
    if (now - this.at > NEW_GESTURE_MS) this.acc = 0;
    this.at = now;
    if (dy > 0) this.acc += 1; else if (dy < 0) this.acc -= 1;
    this.acc = Math.max(-CAP, Math.min(CAP, this.acc));
  }

  frame(now, cycle) {
    if (!this.acc || now - this.at < SETTLE_MS) return;
    const steps = this.acc;
    this.acc = 0;
    if (cycle.length < 2) return;
    const i = cycle.findIndex((s) => s.id === this.active);
    const from = i < 0 ? 0 : i;
    const idx = ((from + steps) % cycle.length + cycle.length) % cycle.length;
    this.active = cycle[idx].id;
    this.moves++;
  }

  // events carry an absolute arrival time; frames run every FRAME_MS, which is
  // what makes a gesture commit at all
  run(events, cycle, { frame = 16, total = 2500 } = {}) {
    let t = 0, next = 0;
    while (t < total) {
      while (next < events.length && events[next].at <= t) {
        this.event(t, events[next].dy);
        next++;
      }
      this.frame(t, cycle);
      t += frame;
    }
    return { moves: this.moves, active: this.active };
  }
}

const cycle = SLOTS.map((s) => ({ id: s.id })); // owns everything
const bare = SLOTS.filter((s) => s.kind !== 'gun' || s.id === 'pistol').map((s) => ({ id: s.id }));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };
const at = (start, n, step) => Array.from({ length: n }, (_, i) => ({ at: start + i * step, dy: 4 }));

// 1. one mouse notch: one event, one move
let r = new Wheel().run([{ at: 16, dy: 100 }], cycle);
ok(r.moves === 1, `single notch -> 1 move (${r.moves}) to ${r.active}`);

// 2. a trackpad flick: 18 small events in ~180ms is ONE move, not 18
r = new Wheel().run(at(16, 18, 10), cycle);
ok(r.moves === 1, `trackpad flick (18 events) -> 1 move (${r.moves}) to ${r.active}`);

// 3. a sustained two-finger scroll over 1.5s stays to a few deliberate moves
r = new Wheel().run(at(16, 90, 16), cycle, { total: 2500 });
ok(r.moves >= 1 && r.moves <= 4, `sustained 1.5s scroll -> ${r.moves} moves (1-4 expected)`);

// 4. a hard 3-notch roll: 3 notches 40ms apart = ONE gesture advancing 3 slots
r = new Wheel().run([{ at: 16, dy: 100 }, { at: 56, dy: 100 }, { at: 96, dy: 100 }], cycle);
ok(r.moves === 1, `3-notch roll -> 1 commit, no switch spam (${r.moves})`);
ok(r.active === SLOTS[3].id, `3-notch roll advances 3 slots (${r.active})`);

// 5. a single huge delta (drivers that emit one event per fling) is capped
r = new Wheel().run([{ at: 16, dy: 1200 }], cycle);
ok(r.moves === 1 && r.active === SLOTS[1].id, `one 1200-delta fling -> 1 capped step (${r.active})`);

// 6. jitter that cancels itself out must not move anything
r = new Wheel().run([
  { at: 16, dy: 2 }, { at: 32, dy: -2 }, { at: 48, dy: 2 }, { at: 64, dy: -2 },
], cycle);
ok(r.moves === 0, `opposing jitter -> 0 moves (${r.moves})`);

// 7. scrolling back walks the cycle back
r = new Wheel().run([{ at: 16, dy: 100 }, { at: 700, dy: -100 }], cycle);
ok(r.active === SLOTS[0].id, `scroll down then up returns to start (${r.active})`);

// 8. a full lap wraps instead of falling off the end
r = new Wheel().run(SLOTS.map((_, i) => ({ at: 16 + i * 400, dy: 100 })), cycle,
  { total: 16 + SLOTS.length * 400 + 400 });
ok(r.moves === SLOTS.length, `a full lap is ${r.moves} moves (${SLOTS.length} slots)`);
ok(r.active === SLOTS[0].id, `a full lap lands back on the start (${r.active})`);

// 9. the bare cycle (pistol only) still reaches the throwables
r = new Wheel().run([{ at: 16, dy: 100 }], bare);
ok(r.active === 'grenade', `bare cycle steps to the first throwable (${r.active})`);
ok(bare.length === 5, `bare cycle is ${bare.map((s) => s.id).join(',')}`);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
