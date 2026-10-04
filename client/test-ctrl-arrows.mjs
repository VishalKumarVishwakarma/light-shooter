// Keyboard loadout stepping: Ctrl+Left / Ctrl+Right, plus `,` / `.`.
//
// REVISION. The first version of this cycled GUNS ONLY and was reported as
// "not working". It was not unwired -- it was INERT:
//
//     SLOTS.filter((s) => s.kind === 'gun' && (s.id === 'pistol' || me?.[s.id] === true))
//
// At spawn you hold only the pistol, so that returns [pistol], length 1, and the
// stepper returned early. No switch, no sound, no toast -- indistinguishable from
// the key not existing at all. The wheel never had this problem: its list is the
// three throwables and the shield too, so 5 slots even with only the pistol.
//
// So the suite is now built around that defect: it asserts the stepped list is
// the WHEEL's list, and that it is non-empty at spawn.
//
// Phaser's side was verified rather than assumed, because "the binding never
// fires" and "the binding fires and does nothing" have opposite fixes:
//   - KeyCodes.CTRL = 17 exists, so addKeys('CTRL') makes a real Key. Had it not
//     existed, the movement gate would always read false and Ctrl+Arrow would
//     switch AND strafe.
//   - KeyboardManager.onKeyDown queues every event, modified or not; `modified`
//     only decides whether captures get preventDefault.
//   - KeyboardPlugin.update emits keydown-LEFT with the NATIVE event, no modifier
//     filter, so ev.ctrlKey arrives intact.
//   - nothing of ours calls preventDefault on keydown (the only hit was
//     webglcontextlost), so Phaser's `event.defaultPrevented` bail never fires.
import fs from 'node:fs';

const arena = fs.readFileSync(new URL('./src/scenes/ArenaScene.ts', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SLOTS = [...arena.matchAll(/\{ key: '(\d)', nm: '([^']*)', id: '(\w+)', kind: '(\w+)' \}/g)]
  .map((m) => ({ key: m[1], id: m[3], kind: m[4] }));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// --- CTRL is tracked, and only gates the horizontal strafe -----------------
ok(/addKeys\('W,A,S,D,UP,DOWN,LEFT,RIGHT[^']*CTRL/.test(arena),
  'CTRL is in addKeys, so its key state can be read during movement');
ok(/const ctrl = !!this\.keys\.CTRL\?\.isDown;/.test(arena), 'movement reads a Ctrl flag');
ok(/this\.keys\.A\.isDown \|\| \(this\.keys\.LEFT\.isDown && !ctrl\)/.test(arena),
  'Left does not strafe while Ctrl is held');
ok(/this\.keys\.D\.isDown \|\| \(this\.keys\.RIGHT\.isDown && !ctrl\)/.test(arena),
  'Right does not strafe while Ctrl is held');
ok(!/this\.keys\.W\.isDown \|\| \(this\.keys\.UP\.isDown && !ctrl\)/.test(arena),
  'Up is NOT gated -- Ctrl+Up still moves');
ok(!/this\.keys\.S\.isDown \|\| \(this\.keys\.DOWN\.isDown && !ctrl\)/.test(arena),
  'Down is NOT gated -- Ctrl+Down still moves');

// --- the bindings ----------------------------------------------------------
// These tolerate up to ~240 chars between `=> {` and the guard on purpose: the F3
// diagnostics (see dbgEv) log each key inside the handler, so an adjacency match
// would fail on formatting rather than behaviour. They still pin the guard
// (ev.ctrlKey) and the direction, which are the parts that matter.
// NOTE: these two used to assert the inline shape
//   if (ev.ctrlKey && !ev.repeat) this.stepSlot(-1);
// which the order-independence fix replaced with a shared `once()` guard. The
// detailed assertions live in the CAUSE 1 block below; these only confirm each
// arrow is wired at all, and in the right direction.
ok(/kb\.on\('keydown-LEFT', \(ev: KeyboardEvent\) => \{[\s\S]{0,240}?if \(ev\.ctrlKey\) once\(ev, -1\)/.test(arena),
  'Ctrl+Left steps back');
ok(/kb\.on\('keydown-RIGHT', \(ev: KeyboardEvent\) => \{[\s\S]{0,240}?if \(ev\.ctrlKey\) once\(ev, 1\)/.test(arena),
  'Ctrl+Right steps forward');
ok(/kb\.on\('keydown-COMMA',[\s\S]{0,120}?if \(!ev\.repeat\) this\.stepSlot\(-1\);/.test(arena),
  '`,` steps back with NO modifier');
ok(/kb\.on\('keydown-PERIOD',[\s\S]{0,120}?if \(!ev\.repeat\) this\.stepSlot\(1\);/.test(arena),
  '`.` steps forward with NO modifier');
// auto-repeat is guarded in three places now: the shared once() for the arrows,
// keydown-CTRL's own early return, and inline on comma/period
ok((arena.match(/!ev\.repeat/g) || []).length >= 3
  && /if \(ev\.repeat\) return;/.test(arena),
  'auto-repeat is ignored on all four, so holding a combo steps once');
ok(/ev\.ctrlKey/.test(arena), 'the modifier is read off the KeyboardEvent');
// There IS now a keydown-CTRL listener, deliberately -- it is the fix for pressing
// the arrow BEFORE Ctrl. What must not exist is a *polled* modifier driving the
// stepper, which was the original single-listener design.
ok(!/if \(this\.keys\.CTRL\.isDown\) this\.stepSlot/.test(arena),
  'the stepper is not driven by polling a CTRL key state');

// --- WHICH LIST gets stepped ----------------------------------------------
// Three versions have shipped, and each broke something, so all three are pinned:
//
//   69673c2  guns only, `if (guns.length < 2) return`   -> inert at spawn
//   ea84703  the wheel's full strip                      -> 4 presses in 5 selected a
//                                                          throwable, so a "gun switch"
//                                                          that mostly did not switch guns
//   now      guns when >= 2, the strip when < 2         -> a gun every press, never dead
ok(/private stepSlot\(dir: -1 \| 1\)/.test(arena), 'the stepper exists as stepSlot');
const body = /private stepSlot\(dir: -1 \| 1\) \{([\s\S]*?)\n  \}/.exec(arena);
ok(!!body, 'stepSlot body is locatable');
ok(!/private gunCycle\(/.test(arena), 'the guns-only cycle is gone as a separate method');
if (body) {
  ok(/kind === 'gun'/.test(body[1]), 'it filters to guns -- this is a gun selector');
  ok(/this\.slotCycle\(\)/.test(body[1]), 'and can reach slotCycle() as a fallback');
  ok(/guns\.length >= 2 \? guns : this\.slotCycle\(\)/.test(body[1]),
    'the ternary picks guns when two or more are carried, the strip otherwise');
  ok(!/guns\.length < 2\) return/.test(body[1]),
    'and does NOT bail out entirely with one gun, which is what made 69673c2 dead');
}

// BEHAVIOUR, modelled from the SOURCE's list.
//
// The first version of this suite hard-coded the wheel's filter in the helper, so
// reverting the source to the guns-only filter changed nothing the behaviour
// assertions could see -- they only tripped the shape checks. The list is now
// derived from what stepSlot actually does, so the shipped bug fails on BEHAVIOUR:
// with a guns-only filter `cycle({}).length` is 1 and every "not a no-op" assertion
// below goes red, which is the symptom that was reported.
// Derived from the SOURCE, so a revert changes what the behaviour assertions see.
// Three shapes are recognised so all three historical bugs fail here rather than
// only tripping the shape checks above:
//   gunsOnly + early return -> the 69673c2 inert build
//   gunsOnly, no fallback  -> dead with one gun
//   neither                -> the ea84703 everything-selector
const srcGuns = body ? /kind === 'gun'/.test(body[1]) : false;
const srcFallback = body ? /guns\.length >= 2 \? guns : this\.slotCycle\(\)/.test(body[1]) : false;
const srcBails = body ? /guns\.length < 2\) return/.test(body[1]) : false;
const gunsList = (me) => SLOTS.filter((s) => s.kind === 'gun'
  && (s.id === 'pistol' || (me && me[s.id] === true)));
const stripList = (me) => SLOTS.filter((s) => s.kind !== 'gun'
  || s.id === 'pistol' || (me && me[s.id] === true));
const cycle = (me) => {
  if (!srcGuns) return stripList(me);                       // ea84703: everything
  if (!srcFallback) return gunsList(me);                    // guns only, dead at spawn
  const g = gunsList(me);
  return srcBails && g.length < 2 ? g : (g.length >= 2 ? g : stripList(me));
};
function step(dir, active, me) {
  const l = cycle(me);
  if (l.length < 2) return active;
  const i = l.findIndex((s) => s.id === active);
  const idx = i < 0 ? (dir > 0 ? 0 : l.length - 1)
    : ((i + dir) % l.length + l.length) % l.length;
  return l[idx].id;
}
{
  ok(cycle({}).length >= 2,
    `the list is usable at spawn (${cycle({}).length} slots, a bare guns-only list gives 1 = inert)`);
  const seen = ['pistol'];
  let cur = 'pistol';
  for (let i = 0; i < 3; i++) { cur = step(1, cur, {}); seen.push(cur); }
  ok(new Set(seen).size === 4,
    `Ctrl+Right repeatedly changes the slot from spawn (${seen.join(' -> ')})`);
  ok(step(1, 'pistol', {}) !== 'pistol', 'and Ctrl+Right from spawn is NOT a no-op');
  ok(step(-1, 'pistol', {}) !== 'pistol', 'and Ctrl+Left from spawn is NOT a no-op either');
}
{
  const all = ['rifle', 'shotgun', 'sniper', 'laser', 'electric'];
  const me = Object.fromEntries(all.map((g) => [g, true]));
  const l = cycle(me);
  ok(all.every((g) => l.some((s) => s.id === g)), 'every owned gun is in the stepped list');
  ok(!l.some((s) => s.kind !== 'gun'),
    'and with guns carried NO throwable or shield is in it -- every press is a gun');
  // all six guns reachable in one sweep
  const hit = new Set(['pistol']);
  let cur = 'pistol';
  for (let i = 0; i < 5; i++) { cur = step(1, cur, me); hit.add(cur); }
  ok(['pistol', ...all].every((g) => hit.has(g)),
    `all six guns reached in 5 presses (${[...hit].join(', ')})`);
  ok(step(1, 'rifle', me) === 'shotgun', 'Ctrl+Right walks the strip in order');
  ok(step(-1, 'rifle', me) === 'pistol', 'Ctrl+Left walks it back');
  // wraps to the LAST GUN, not to the shield -- the stepped list is guns-only
  // while guns are carried, so the far end is `electric`, not a throwable
  ok(step(-1, 'pistol', me) === 'electric',
    'and wraps past the start to the last gun, not to a throwable');
  ok(step(-1, 'electric', me) === 'laser', 'wrapping is a plain cycle of the guns');
  // unpicked guns are skipped, not selectable
  ok(step(1, 'pistol', { shotgun: true }) === 'shotgun',
    'with only pistol+shotgun owned, Ctrl+Right goes to shotgun');
  ok(step(1, 'pistol', { rifle: true }) === 'rifle',
    'and never lands on a gun that was not picked up');
}

// --- stepping maths --------------------------------------------------------
ok(/const idx = i < 0\s*\? \(dir > 0 \? 0 : list\.length - 1\)/.test(arena),
  'stepping from a slot outside the list enters at the boundary being travelled toward');
ok(/:\s*\(\(i \+ dir\) % list\.length \+ list\.length\) % list\.length;/.test(arena),
  'the index wraps in both directions');
ok(!/\(dir > 0 \? 0 : list\.length - 1\) : i/.test(arena),
  'entering from outside the list does NOT also take a step (that skipped an entry)');
ok(/this\.selectSlot\(list\[idx\]\.id, false\);/.test(arena),
  'it goes through selectSlot, so the server is told exactly as for 1-0');
ok(/this\.stepSlot\(-1\)/.test(arena) && /this\.stepSlot\(1\)/.test(arena),
  'both arrows are wired to the stepper');
ok(!/this\.stepGun\(/.test(arena), 'no stale stepGun calls remain');

// --- discoverable ----------------------------------------------------------
ok(/class="k">Ctrl<\/span>/.test(html), 'the key hints advertise Ctrl + arrows');
ok(/class="k">,<\/span>|class="k">&comma;|class="k">&#44;/.test(html) || /class="k">\.,?<\/span>/.test(html),
  'and the comma/period fallback');
ok(/weapon<\/b>/.test(html), 'labelled as the weapon control');

// ===========================================================================
// INTERMITTENCY. Reported as "sometimes works and sometimes not", which is a
// different bug from the inert-at-spawn case above and has two causes, both
// confirmed in Phaser's source rather than guessed at.
// ===========================================================================

// --- CAUSE 1: PRESS ORDER --------------------------------------------------
// The browser fires a keydown for whichever key lands SECOND and never re-fires
// the first. Reading the chord only off the arrow meant pressing Left before Ctrl
// delivered an arrow event with ctrlKey=false, then a bare keydown-CTRL with no
// arrow information -- nothing happened. Working or not came down to which
// finger moved first.
ok(/kb\.on\('keydown-LEFT', \(ev: KeyboardEvent\) => \{[\s\S]{0,240}?if \(ev\.ctrlKey\) once\(ev, -1\);\s*\}\);/.test(arena),
  'Ctrl+Left still completes on the arrow going down second');
ok(/kb\.on\('keydown-RIGHT', \(ev: KeyboardEvent\) => \{[\s\S]{0,240}?if \(ev\.ctrlKey\) once\(ev, 1\);\s*\}\);/.test(arena),
  'Ctrl+Right likewise');
ok(/kb\.on\('keydown-CTRL', \(ev: KeyboardEvent\) => \{[\s\S]{0,320}?this\.keys\.LEFT\.isDown\) once\(ev, -1\)/.test(arena),
  'Ctrl going down SECOND acts on an already-held Left');
ok(/else if \(this\.keys\.RIGHT\.isDown\) once\(ev, 1\)/.test(arena),
  'and on an already-held Right');
// the direction must come from which arrow is HELD, not from a polled modifier
const ctrlIsDown = [...arena.matchAll(/keys\.CTRL\?*\.isDown/g)];
ok(ctrlIsDown.length === 1,
  `keys.CTRL.isDown is read exactly once -- in the movement gate, never to drive the stepper (found ${ctrlIsDown.length})`);
// exactly one of the two conditions can be true when the second key lands, so it
// cannot double-step; replayed rather than asserted
ok(/const once = \(ev: KeyboardEvent, dir: -1 \| 1\) => \{[\s\S]{0,200}?if \(!ev\.repeat\) this\.stepSlot\(dir\);\s*\};/.test(arena),
  'a shared guard applies !repeat to both arrows');
ok(/kb\.on\('keydown-CTRL', \(ev: KeyboardEvent\) => \{[\s\S]{0,320}?if \(ev\.repeat\) return;/.test(arena),
  'and Ctrl auto-repeat is ignored too');

// --- CAUSE 2: A LOST KEYUP KILLED IT PERMANENTLY ---------------------------
// Phaser binds keydown/keyup on window and registers NO blur or
// visibilitychange listener in KeyboardManager. A keyup lost to an Alt+Tab or a
// devtools click leaves Key.isDown true, and KeyboardPlugin.update reads
// `repeat = key.isDown` BEFORE onDown clears it -- so every later keydown for
// that code is treated as auto-repeat and `keydown-LEFT` is never emitted again
// for the rest of the session. That is the "worked, then stopped dead" half.
ok(/window\.addEventListener\('blur', \(\) => kb\.resetKeys\(\)\);/.test(arena),
  'a blur listener clears the key state, so a lost keyup cannot strand it');
ok(/window\.addEventListener\('blur'[\s\S]{0,60}?kb\.resetKeys\(\)/.test(arena)
  && (arena.match(/addEventListener\('blur'/g) || []).length === 1,
  'and it is registered exactly once (inside the kbWired guard, since the plugin is global)');
{
  // the blur listener must sit inside the kbWired guard, or every scene start
  // would stack another one on the cached plugin
  const guard = arena.indexOf('if (!this.kbWired) {');
  const blur = arena.indexOf("addEventListener('blur'");
  ok(guard >= 0 && blur > guard, 'the blur listener is inside the kbWired guard');
}

// --- the chord, replayed over hand orders ----------------------------------
{
  function makeScene() {
    return {
      steps: [],
      keys: { LEFT: { isDown: false }, RIGHT: { isDown: false }, CTRL: { isDown: false } },
      stepSlot(d) { this.steps.push(d); },
    };
  }
  function wire(sc) {
    const once = (ev, dir) => { if (!ev.repeat) sc.stepSlot(dir); };
    return {
      LEFT: (ev) => { sc.keys.LEFT.isDown = true; if (ev.ctrlKey) once(ev, -1); },
      RIGHT: (ev) => { sc.keys.RIGHT.isDown = true; if (ev.ctrlKey) once(ev, 1); },
      CTRL: (ev) => {
        sc.keys.CTRL.isDown = true;
        if (ev.repeat) return;
        if (sc.keys.LEFT.isDown) sc.stepSlot(-1);
        else if (sc.keys.RIGHT.isDown) sc.stepSlot(1);
      },
      up: (k) => { sc.keys[k].isDown = false; },
    };
  }
  const play = (order) => {
    const sc = makeScene(); const h = wire(sc);
    for (const s of order) {
      if (s === 'up-LEFT') h.up('LEFT');
      else if (s === 'up-RIGHT') h.up('RIGHT');
      else if (s === 'up-CTRL') h.up('CTRL');
      else h[s]({ ctrlKey: sc.keys.CTRL.isDown, repeat: false });
    }
    return sc.steps;
  };
  const cases = [
    ['Ctrl then Left (ctrl first)', ['CTRL', 'LEFT'], 1],
    ['Left then Ctrl (arrow first)', ['LEFT', 'CTRL'], 1],
    ['Ctrl then Right (ctrl first)', ['CTRL', 'RIGHT'], 1],
    ['Right then Ctrl (arrow first)', ['RIGHT', 'CTRL'], 1],
    ['Left alone (strafe, no Ctrl)', ['LEFT'], 0],
    ['Right alone (strafe, no Ctrl)', ['RIGHT'], 0],
    ['Ctrl alone (no arrow held)', ['CTRL'], 0],
    ['L rel L, then Ctrl+Left', ['LEFT', 'up-LEFT', 'CTRL', 'LEFT'], 1],
    ['L rel, R held, then Ctrl', ['LEFT', 'up-LEFT', 'RIGHT', 'CTRL'], 1],
    ['two presses of the combo', ['CTRL', 'LEFT', 'up-LEFT', 'LEFT'], 2],
    ['two taps of Ctrl, holding L', ['LEFT', 'CTRL', 'up-CTRL', 'CTRL'], 2],
  ];
  let bad = 0;
  for (const [label, order, want] of cases) {
    const got = play(order);
    if (got.length !== want) { bad++; console.log(`     order "${label}" -> ${got.length} steps, wanted ${want}`); }
  }
  ok(bad === 0, `all ${cases.length} press orders step exactly once per press, never zero, never twice`);
  ok(play(['LEFT', 'CTRL']).length === 1,
    'specifically: arrow-first now works, which is the case that used to do nothing');
  ok(play(['CTRL', 'LEFT']).length === 1,
    'and ctrl-first still works, so nothing regressed');
}

// --- the regression that actually caused the third report ------------------
// How many of four presses select a gun. This is the number that matters: at 1-in-5
// the control "works" but is not a gun switch, which is what the user reported.
{
  const ALL = ['rifle', 'shotgun', 'sniper', 'laser', 'electric'];
  const allMe = Object.fromEntries(ALL.map((g) => [g, true]));
  const isGun = (id) => (SLOTS.find((s) => s.id === id) || {}).kind === 'gun';
  const sweep = (me) => {
    let cur = 'pistol';
    const out = [];
    for (let i = 0; i < 4; i++) { cur = step(1, cur, me); out.push(cur); }
    return out;
  };
  for (const [label, me] of [['2 guns', { rifle: true }], ['3 guns', { rifle: true, shotgun: true }],
    ['all 6', allMe]]) {
    const seq = sweep(me);
    ok(seq.every(isGun),
      `with ${label}, all four presses select guns (${seq.join(' -> ')})`);
    ok(new Set(seq).size > 1, `with ${label}, consecutive presses actually differ`);
  }
  // the specific ea84703 failure: a full strip lands on a throwable almost every time
  const stripSeq = sweep(allMe);
  const stripGunRate = stripSeq.filter(isGun).length / stripSeq.length;
  ok(!cycle(allMe).some((s) => s.kind !== 'gun'),
    `the ea84703 build put throwables in the list (a strip sweep hits a gun only `
    + `${Math.round(stripGunRate * 100)}% of the time) -- that was the bug`);

  // and it must still never be dead
  ok(step(1, 'pistol', {}) !== 'pistol',
    'with only the pistol it falls back to the strip rather than doing nothing');
  ok(step(-1, 'pistol', {}) !== 'pistol', 'stepping left is not dead either');
  const solo = cycle({});
  ok(solo.length >= 2 && solo.some((s) => s.kind !== 'gun'),
    'and the fallback really is the throwables/shield strip, not a one-item list');
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
