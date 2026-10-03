// Mouse-wheel selector: does a gesture move slots, RELIABLY, on every device?
//
// Reported as "gun properly not switched, sometimes working, sometimes not".
// Three distinct causes, all reproduced below before being fixed:
//
//   1. deltaMode was never read. Phaser hands the raw DOM value through
//      (Pointer.js), and the DOM has THREE units: pixel (~100/notch), line
//      (~3/notch) and page. Dividing everything by 100 made one notch worth
//      0.03 in line mode, and the old trunc(0.03) was 0 -- so the wheel was
//      silently dead on Firefox. Same code, different browser.
//   2. A sub-notch gesture was discarded. A trackpad has no notches; it streams
//      2-8px events and a normal scroll sums to ~0.2-0.4 notches. trunc() threw
//      all of them away.
//   3. The carried fraction leaked across gestures. The gesture resets after
//      GESTURE_MS but the commit settles after SETTLE_MS, so a fraction scrolled
//      inside that 170ms gap was inherited -- a 40% twitch rode on a full notch,
//      and scrolling down then up accumulated instead of cancelling.
//
// THIS FILE DOES NOT MIRROR THE IMPLEMENTATION.
//
// The previous suite carried its own copy of the constants and the arithmetic,
// which is how the original bug survived three times. Here the per-event
// normalisation and the commit decision are EVALUATED FROM ArenaScene.ts, so
// reverting any of the three fixes fails here rather than shipping. Every tunable
// is a named constant parsed from the source, so behaviour can only change by
// changing something this file reads.
//
// Device reality being modelled:
//   MOUSE    one wheel event per physical notch
//   TRACKPAD many small events per second, no notches at all
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync('src/scenes/ArenaScene.ts', 'utf8');
const SLOTS = [...src.matchAll(/\{ key: '(\d)', nm: '([^']*)', id: '(\w+)', kind: '(\w+)' \}/g)]
  .map((m) => ({ key: m[1], id: m[3], kind: m[4] }));

const num = (name) => {
  const m = src.match(new RegExp(`const ${name} = ([0-9.]+);`));
  if (!m) throw new Error(`cannot find ${name} in ArenaScene.ts`);
  return +m[1];
};
const PIXEL_NOTCH = num('WHEEL_PIXEL_NOTCH'), LINE_NOTCH = num('WHEEL_LINE_NOTCH');
const EVENT_MAX = num('WHEEL_EVENT_MAX'), GESTURE_MAX = num('WHEEL_GESTURE_MAX');
const GESTURE_MS = num('WHEEL_GESTURE_MS'), SETTLE_MS = num('WHEEL_SETTLE_MS');
const COMMIT = num('WHEEL_COMMIT');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// ---------------------------------------------------------------------------
// Pull the SHIPPED expressions out of the source and run them.
//
// handler: `const per = mode === 1 ? WHEEL_LINE_NOTCH : mode === 2 ? 1 : WHEEL_PIXEL_NOTCH;`
//          `const notches = Math.max(-WHEEL_EVENT_MAX, Math.min(WHEEL_EVENT_MAX, dy / per));`
// commit:  the direction-aware `steps` decision
// If any of these cannot be found, that is itself the failure -- it means the
// shape this suite depends on has changed.
// ---------------------------------------------------------------------------
function extract(re, what) {
  const m = src.match(re);
  if (!m) {
    fail++; console.log(`FAIL: could not extract the ${what} from ArenaScene.ts -- the wheel algorithm changed shape`);
    return null;
  }
  return m[0];
}

const evalIn = (code, scope) => vm.runInNewContext(`(() => { ${code} })()`, scope);

const perExpr = extract(/const per = mode === 1 \? WHEEL_LINE_NOTCH : mode === 2 \? 1 : WHEEL_PIXEL_NOTCH;/,
  'deltaMode divisor');
// `notches` is wrapped across two lines in the source, so anchor on the two
// halves separately and join them -- a loose [\s\S]*? here swallows the lines
// after it, which is how this extraction silently failed the first time.
const notchesHead = extract(/const notches = Math\.max\(-WHEEL_EVENT_MAX,/,
  'notch normalisation (head)');
const notchesTail = extract(/Math\.min\(WHEEL_EVENT_MAX, dy \/ per\)\);/, 'notch normalisation (tail)');
const notchesExpr = notchesHead && notchesTail
  ? `${notchesHead}\n        ${notchesTail}`
  : null;
// \s* rather than \n: the commit block's first two lines are indented differently,
// and an \n anchor silently failed the extraction the first time.
const stepsExpr = extract(/let steps = 0;\s*if \(acc >= WHEEL_COMMIT\)[\s\S]*?if \(!steps\) return;/,
  'commit decision');

let shipped = null;
if (perExpr && notchesExpr && stepsExpr) {
  pass += 4; console.log('PASS: extracted the shipped normalisation and commit from ArenaScene.ts');
  // The extracted expressions reference the module-level constants by name, so
  // they must be in scope inside the VM. Build one shared scope: a `const` in
  // the caller's scope is NOT visible to runInNewContext.
  const scope = () => ({
    mode: 0, dy: 0, acc: 0,
    WHEEL_LINE_NOTCH: LINE_NOTCH, WHEEL_PIXEL_NOTCH: PIXEL_NOTCH,
    WHEEL_EVENT_MAX: EVENT_MAX, WHEEL_COMMIT: COMMIT,
  });
  shipped = {
    notches: (dy, mode) => {
      const s = scope(); s.dy = dy; s.mode = mode;
      return evalIn(`${perExpr} ${notchesExpr} return notches;`, s);
    },
    steps: (acc) => {
      const s = scope(); s.acc = acc;
      return evalIn(stepsExpr.replace('if (!steps) return;', 'return steps;'), s);
    },
  };
}

class Wheel {
  constructor() { this.acc = 0; this.at = 0; this.active = SLOTS[0].id; this.moves = 0; this.sel = []; }
  event(now, dy, mode) {
    if (now - this.at > GESTURE_MS) this.acc = 0;
    this.at = now;
    const n = shipped ? shipped.notches(dy, mode) : dy / PIXEL_NOTCH;
    this.acc = Math.max(-GESTURE_MAX, Math.min(GESTURE_MAX, this.acc + n));
  }
  frame(now, cycle) {
    if (now - this.at < SETTLE_MS) return;
    let steps = shipped ? shipped.steps(this.acc) : Math.trunc(this.acc);
    if (!steps) return;
    this.acc = 0; // the fix: the remainder is dropped, not carried
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
      while (n < events.length && events[n].at <= t) { this.event(t, events[n].dy, events[n].mode ?? 0); n++; }
      this.frame(t, cycle);
      t += frame;
    }
    return { moves: this.moves, active: this.active, sel: this.sel, acc: this.acc };
  }
}

const cycle = SLOTS.map((s) => ({ id: s.id }));
const mouse = (start, n, gap = 60, dy = 100, mode = 0) =>
  Array.from({ length: n }, (_, i) => ({ at: start + i * gap, dy, mode }));
// a real two-finger flick reports 10-40 per event, a slow drag a few px
const flick = (start, n, dy = 20, gap = 12) => Array.from({ length: n }, (_, i) => ({ at: start + i * gap, dy }));
const drag = (start, n, dy = 5, gap = 30) => Array.from({ length: n }, (_, i) => ({ at: start + i * gap, dy }));

// ---- 1. deltaMode: a mouse notch is one notch in EVERY unit -----------------
// The regression that made the wheel dead on non-Chrome browsers.
{
  const perMode = [0, 1, 2].map((mode) => new Wheel().run(mouse(16, 1, 60, 100, mode), cycle).moves);
  ok(perMode.every((m) => m === 1),
    `one physical notch switches exactly once in every deltaMode (pixel/line/page = ${perMode.join('/')})`);

  // the units these actually report, so the test is not asserting fiction
  const lineMode = new Wheel().run(mouse(16, 1, 60, LINE_NOTCH, 1), cycle).moves;
  ok(lineMode === 1, `one notch in LINE mode (deltaY=${LINE_NOTCH}) switches once -- was 0, i.e. dead`);

  const pageMode = new Wheel().run(mouse(16, 1, 60, 300, 2), cycle).moves;
  ok(pageMode >= 1, `a PAGE-mode event (deltaY=300) still switches`);

  ok(/deltaMode/.test(src), 'the handler reads deltaMode at all');
  ok(/mode === 1 \? WHEEL_LINE_NOTCH/.test(src), 'line mode has its own divisor');
  ok(/mode === 2 \? 1/.test(src), 'page mode is one notch per event');
  ok(!/dy \/ WHEEL_NOTCH\b/.test(src),
    'nothing still divides by a single pixel-mode notch, which was the bug');
}

// ---- 2. a deliberate sub-notch scroll must switch --------------------------
// The regression that made the wheel look dead on a trackpad.
{
  const d = new Wheel().run(drag(16, 10, 5, 30), cycle);
  ok(d.moves >= 1, `a slow one-finger drag still switches (${d.moves} move(s)) -- was 0`);

  const f = new Wheel().run(flick(16, 18, 20, 12), cycle);
  ok(f.moves >= 1, `a two-finger flick switches (${f.moves} move(s))`);

  // ...but a nudge inside the dead zone must NOT fire the weapon
  const nudge = new Wheel().run([{ at: 16, dy: 4 }], cycle);
  ok(nudge.moves === 0, `a 4px nudge inside the dead zone does NOT switch (${nudge.moves})`);
  ok(COMMIT > 0 && COMMIT < 1,
    `WHEEL_COMMIT (${COMMIT}) is below one notch, so a trackpad scroll can commit`);
  ok(Math.abs(nudge.acc) <= COMMIT, 'and the dead zone is reachable in the real accumulator');

  ok(/acc >= WHEEL_COMMIT/.test(src) && /acc <= -WHEEL_COMMIT/.test(src),
    'the commit is direction-aware, not trunc()');
  ok(!/Math\.trunc\(this\.wheelAcc\)/.test(src),
    'trunc() is gone -- it discarded every sub-notch trackpad gesture');
}

// ---- 3. the fraction must not leak across gestures -------------------------
{
  // a full notch, then a 40% twitch inside the SETTLE..GESTURE gap
  const leak = new Wheel().run([{ at: 16, dy: 100 }, { at: 200, dy: 40 }], cycle);
  ok(Math.abs(leak.acc) < 0.0001,
    `nothing is carried after a commit (acc=${leak.acc.toFixed(3)}, was 0.40)`);
  ok(leak.moves === 2, `the full notch and the twitch commit separately (${leak.moves})`);

  // scrolling down then back up is a cancel, not an accumulation
  const cancel = new Wheel().run([{ at: 16, dy: 100 }, { at: 60, dy: -100 }], cycle);
  ok(cancel.moves === 0, `scroll down then up inside one gesture cancels (${cancel.moves} move(s))`);
  ok(Math.abs(cancel.acc) <= 0.0001, 'and leaves nothing behind');

  ok(/this\.wheelAcc = 0;/.test(src) && !/this\.wheelAcc -= steps;/.test(src),
    'the remainder is dropped rather than carried forward');
}

// ---- 4. the distance model from 4cc5d3a must survive ----------------------
// Regression guard: the fixes must not resurrect event-counting.
{
  let r = new Wheel().run(mouse(16, 6, 60), cycle);
  ok(r.sel[0] === SLOTS[6].id,
    `a 6-notch roll advances 6 slots in ONE commit (got to ${r.active})`);
  ok(r.moves === 1, `...and still only one commit, so no switch spam (${r.moves})`);

  r = new Wheel().run(mouse(16, 8, 40), cycle, { total: 6000 });
  ok(r.moves === 1, `a continuous 8-notch hold is one coalesced commit (${r.moves})`);
  ok(r.sel[0] === SLOTS[8].id, `...and travels all 8 slots (${r.active})`);

  // a single momentum fling is clamped per event, so it cannot jump the strip
  const fling = new Wheel().run([{ at: 16, dy: 4000 }], cycle);
  ok(fling.moves === 1 && fling.sel[0] === SLOTS[EVENT_MAX].id,
    `one 4000px fling is clamped to ${EVENT_MAX} slots (got ${fling.sel[0]})`);

  r = new Wheel().run(mouse(16, 20, 40), cycle, { total: 6000 });
  ok(r.moves === 1 && r.sel[0] === SLOTS[0].id,
    `20 notches is clamped to GESTURE_MAX and wraps to the start (${r.sel[0]})`);

  ok(!/if \(dy > 0\) this\.wheelAcc \+= 1;/.test(src), 'the handler still does not count raw events');
  ok(/this\.wheelAt > WHEEL_GESTURE_MS/.test(src), 'the gesture window uses WHEEL_GESTURE_MS');
  ok(/this\.wheelAt < WHEEL_SETTLE_MS/.test(src), 'the settle delay uses WHEEL_SETTLE_MS');
  ok(/Math\.min\(WHEEL_GESTURE_MAX, this\.wheelAcc \+ notches\)/.test(src), 'the per-gesture clamp survives');
  const handler = src.slice(src.indexOf("this.input.on('wheel'"), src.indexOf("this.input.on('wheel'") + 1100);
  ok(!/\b(150|320)\b/.test(handler), 'the wheel handler carries no bare timing literals');
}

// ---- 5. the cycle the wheel walks is still the 1-0 order ------------------
{
  const bare = SLOTS.filter((s) => s.kind !== 'gun' || s.id === 'pistol').map((s) => ({ id: s.id }));
  // pistol + grenade + smoke + molly + shield = 5. Counted from SLOTS rather than
  // hard-coded, so adding a slot does not need this file edited.
  ok(bare.length === SLOTS.filter((s) => s.kind !== 'gun').length + 1,
    `with no guns picked up the cycle is pistol + every non-gun slot (${bare.length})`);
  ok(bare[0].id === 'pistol' && bare[bare.length - 1].id === 'shield',
    'the cycle starts at pistol and ends at the shield');
  const r = new Wheel().run(mouse(16, 1, 60), bare);
  ok(r.active === bare[1].id, `one notch from pistol lands on the next slot (${r.active})`);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);