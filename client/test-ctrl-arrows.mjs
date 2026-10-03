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
ok(/kb\.on\('keydown-LEFT', \(ev: KeyboardEvent\) => \{\s*if \(ev\.ctrlKey && !ev\.repeat\) this\.stepSlot\(-1\);/.test(arena),
  'Ctrl+Left steps back');
ok(/kb\.on\('keydown-RIGHT', \(ev: KeyboardEvent\) => \{\s*if \(ev\.ctrlKey && !ev\.repeat\) this\.stepSlot\(1\);/.test(arena),
  'Ctrl+Right steps forward');
ok(/kb\.on\('keydown-COMMA',[\s\S]{0,120}?if \(!ev\.repeat\) this\.stepSlot\(-1\);/.test(arena),
  '`,` steps back with NO modifier');
ok(/kb\.on\('keydown-PERIOD',[\s\S]{0,120}?if \(!ev\.repeat\) this\.stepSlot\(1\);/.test(arena),
  '`.` steps forward with NO modifier');
ok((arena.match(/!ev\.repeat/g) || []).length >= 4,
  'auto-repeat is ignored on all four, so holding a combo steps once');
ok(/ev\.ctrlKey/.test(arena), 'the modifier is read off the KeyboardEvent');
ok(!/keydown-CTRL/.test(arena), 'no separate CTRL listener to keep in sync');

// --- THE REGRESSION: it must not be a guns-only list -----------------------
ok(/private stepSlot\(dir: -1 \| 1\)/.test(arena), 'the stepper exists as stepSlot');
const body = /private stepSlot\(dir: -1 \| 1\) \{([\s\S]*?)\n  \}/.exec(arena);
ok(!!body, 'stepSlot body is locatable');
ok(!/private gunCycle\(/.test(arena), 'the guns-only cycle is gone');
if (body) {
  ok(/this\.slotCycle\(\)/.test(body[1]),
    'it steps slotCycle() -- the WHEEL\'s list, so it is a true drop-in for the wheel');
  ok(!/kind === 'gun'/.test(body[1]),
    'and does not re-filter to guns only (that is what made it inert at spawn)');
}

// BEHAVIOUR, modelled from the SOURCE's list.
//
// The first version of this suite hard-coded the wheel's filter in the helper, so
// reverting the source to the guns-only filter changed nothing the behaviour
// assertions could see -- they only tripped the shape checks. The list is now
// derived from what stepSlot actually does, so the shipped bug fails on BEHAVIOUR:
// with a guns-only filter `cycle({}).length` is 1 and every "not a no-op" assertion
// below goes red, which is the symptom that was reported.
const gunsOnly = body ? /kind === 'gun'/.test(body[1]) : true;
const cycle = (me) => (gunsOnly
  ? SLOTS.filter((s) => s.kind === 'gun' && (s.id === 'pistol' || (me && me[s.id] === true)))
  : SLOTS.filter((s) => s.kind !== 'gun' || s.id === 'pistol' || (me && me[s.id] === true)));
function step(dir, active, me) {
  const l = cycle(me);
  if (l.length < 2) return active;
  const i = l.findIndex((s) => s.id === active);
  const idx = i < 0 ? (dir > 0 ? 0 : l.length - 1)
    : ((i + dir) % l.length + l.length) % l.length;
  return l[idx].id;
}
{
  ok(!gunsOnly, 'the stepped list is the wheel\'s list, not a guns-only one');
  ok(cycle({}).length >= 2,
    `the list is usable at spawn (${cycle({}).length} slots, guns-only gave 1 = inert)`);
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
  ok(all.every((g) => l.some((s) => s.id === g)), 'every owned gun is in the strip');
  ok(l.some((s) => s.kind !== 'gun'), 'and the throwables/shield are in it too');
  // all six guns reachable in one sweep
  const hit = new Set(['pistol']);
  let cur = 'pistol';
  for (let i = 0; i < 5; i++) { cur = step(1, cur, me); hit.add(cur); }
  ok(['pistol', ...all].every((g) => hit.has(g)),
    `all six guns reached in 5 presses (${[...hit].join(', ')})`);
  ok(step(1, 'rifle', me) === 'shotgun', 'Ctrl+Right walks the strip in order');
  ok(step(-1, 'rifle', me) === 'pistol', 'Ctrl+Left walks it back');
  ok(step(-1, 'pistol', me) === 'shield', 'and wraps past the start to the far end');
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

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
