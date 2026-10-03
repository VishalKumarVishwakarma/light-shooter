// Ctrl+Left / Ctrl+Right selects guns.
//
// Reported as a request for a keyboard alternative to the wheel.
//
// The binding is small, but it sits on top of two things that already exist and
// would break it silently if it were wrong:
//
//   1. THE ARROWS ARE MOVEMENT. Movement reads the key state directly
//      (`if (this.keys.A.isDown || this.keys.LEFT.isDown) dx -= 1`), so binding
//      Ctrl+Arrow without gating that read switches the gun AND strafes.
//   2. THE WHEEL CYCLE IS NOT THE SAME LIST. slotCycle() walks owned guns PLUS
//      the three throwables AND the shield; this is a gun selector, so stepping
//      onto a grenade would be wrong.
//
// Also pinned: auto-repeat is ignored, so holding the combo steps once rather
// than running the whole loadout, and an unpicked gun is never selectable.
import fs from 'node:fs';

const arena = fs.readFileSync(new URL('./src/scenes/ArenaScene.ts', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SLOTS = [...arena.matchAll(/\{ key: '(\d)', nm: '([^']*)', id: '(\w+)', kind: '(\w+)' \}/g)]
  .map((m) => ({ key: m[1], id: m[3], kind: m[4] }));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// --- CTRL is tracked -------------------------------------------------------
ok(/addKeys\('W,A,S,D,UP,DOWN,LEFT,RIGHT[^']*CTRL/.test(arena),
  'CTRL is in addKeys, so its key state can be read during movement');
ok(/const ctrl = !!this\.keys\.CTRL\?\.isDown;/.test(arena),
  'movement reads a Ctrl flag');

// --- the bindings ----------------------------------------------------------
ok(/kb\.on\('keydown-LEFT', \(ev: KeyboardEvent\) => \{\s*if \(ev\.ctrlKey && !ev\.repeat\) this\.stepGun\(-1\);/.test(arena),
  'Ctrl+Left steps back one gun');
ok(/kb\.on\('keydown-RIGHT', \(ev: KeyboardEvent\) => \{\s*if \(ev\.ctrlKey && !ev\.repeat\) this\.stepGun\(1\);/.test(arena),
  'Ctrl+Right steps forward one gun');
ok((arena.match(/!ev\.repeat/g) || []).length >= 2,
  'auto-repeat is ignored on both, so holding the combo steps once');

// the modifier comes off the event, not a second polled key
ok(/ev\.ctrlKey/.test(arena), 'the modifier is read off the KeyboardEvent');
ok(!/keydown-CTRL/.test(arena), 'no separate CTRL listener to keep in sync');

// --- movement is gated ONLY horizontally -----------------------------------
ok(/this\.keys\.A\.isDown \|\| \(this\.keys\.LEFT\.isDown && !ctrl\)/.test(arena),
  'Left does not strafe while Ctrl is held');
ok(/this\.keys\.D\.isDown \|\| \(this\.keys\.RIGHT\.isDown && !ctrl\)/.test(arena),
  'Right does not strafe while Ctrl is held');
ok(!/this\.keys\.W\.isDown \|\| \(this\.keys\.UP\.isDown && !ctrl\)/.test(arena),
  'Up is NOT gated -- Ctrl+Up still moves');
ok(!/this\.keys\.S\.isDown \|\| \(this\.keys\.DOWN\.isDown && !ctrl\)/.test(arena),
  'Down is NOT gated -- Ctrl+Down still moves');
// WASD must be untouched: it has no arrow binding to protect
ok(/this\.keys\.A\.isDown \|\| \(this\.keys\.LEFT\.isDown && !ctrl\)/.test(arena)
  && /this\.keys\.D\.isDown \|\| \(this\.keys\.RIGHT\.isDown && !ctrl\)/.test(arena),
  'WASD still strafes regardless of Ctrl');

// --- it is a GUN cycle, not the wheel's slot cycle --------------------------
ok(/private gunCycle\(\): Slot\[\]/.test(arena), 'a guns-only cycle exists');
const gc = /private gunCycle\(\): Slot\[\] \{([\s\S]*?)\n  \}/.exec(arena);
ok(!!gc, 'gunCycle body is locatable');
if (gc) {
  ok(/s\.kind === 'gun'/.test(gc[1]), 'gunCycle filters to kind === "gun"');
  ok(!/kind !== 'gun'/.test(gc[1]), 'it does not include the throwables or the shield');
  ok(/s\.id === 'pistol' \|\| me\?\.\[s\.id\] === true/.test(gc[1]),
    'and uses the same ownership test as the wheel, so an unpicked gun is unreachable');
}
ok(/const guns = this\.gunCycle\(\);\s*if \(guns\.length < 2\) return;/.test(arena),
  'with only the pistol owned there is nothing to step to, and the key is inert');

// --- stepping maths --------------------------------------------------------
ok(/const idx = i < 0\s*\? \(dir > 0 \? 0 : guns\.length - 1\)/.test(arena),
  'stepping from a non-gun slot enters at the boundary being travelled toward');
ok(/: \(\(i \+ dir\) % guns\.length \+ guns\.length\) % guns\.length;/.test(arena),
  'the index wraps in both directions');
// the two branches must NOT both apply dir: entering from a throwable and then
// stepping as well skipped a gun (grenade -> rifle instead of -> pistol)
ok(!/\(dir > 0 \? 0 : guns\.length - 1\) : i/.test(arena),
  'entering from a non-gun slot does NOT also take a step (that skipped the first gun)');
ok(/this\.selectSlot\(guns\[idx\]\.id, false\);/.test(arena),
  'it goes through selectSlot, so the server is told exactly as for 1-0');
ok(/this\.stepGun\(-1\)/.test(arena) && /this\.stepGun\(1\)/.test(arena),
  'both arrows are wired to the stepper');

// --- behaviour, replayed ---------------------------------------------------
// ownership as the server would report it, so the maths is exercised, not just read
function step(dir, active, owned) {
  const guns = SLOTS.filter((s) => s.kind === 'gun' && (s.id === 'pistol' || owned.includes(s.id)));
  if (guns.length < 2) return active;
  const i = guns.findIndex((s) => s.id === active);
  const idx = i < 0 ? (dir > 0 ? 0 : guns.length - 1)
    : ((i + dir) % guns.length + guns.length) % guns.length;
  return guns[idx].id;
}
{
  const all = ['rifle', 'shotgun', 'sniper', 'laser', 'electric'];
  ok(step(1, 'pistol', all) === 'rifle', 'Ctrl+Right from pistol goes to rifle');
  ok(step(1, 'rifle', all) === 'shotgun', '...and onward along the strip');
  ok(step(-1, 'rifle', all) === 'pistol', 'Ctrl+Left steps back');
  ok(step(-1, 'pistol', all) === 'electric', 'and wraps past the start to the last gun');
  ok(step(1, 'grenade', all) === 'pistol', 'Ctrl+Right from a throwable enters at the first gun');
  ok(step(-1, 'shield', all) === 'electric', 'Ctrl+Left from the shield enters at the last gun');
  ok(step(1, 'rifle', []) === 'rifle', 'with only the pistol owned, Ctrl+Right does nothing');
  // stepping must SKIP guns that are not owned: with pistol+shotgun only, two
  // presses right from pistol must reach shotgun and not wander through the
  // rifle/sniper/laser/electric holes in the cycle.
  {
    const partial = ['shotgun'];
    let cur = 'pistol';
    const visited = [cur];
    for (let i = 0; i < 2; i++) { cur = step(1, cur, partial); visited.push(cur); }
    ok(visited.join(' -> ') === 'pistol -> shotgun -> pistol',
      `stepping skips unpicked guns (${visited.join(' -> ')})`);
    ok(!/rifle|sniper|laser|electric/.test(visited.join(' ')),
      'and never lands on a gun that was not picked up');
  }
  // A gun you do not own cannot be active in the first place, so stepping from
  // one is unreachable in play -- it only happens transiently if a gun is dropped
  // mid-match. The boundary fallback must still land somewhere legal: pistol,
  // the boundary ctrl+RIGHT travels toward, not shotgun.
  ok(step(1, 'rifle', ['shotgun']) === 'pistol',
    'a non-owned active slot falls back to the boundary in the direction of travel');
  ok(step(-1, 'rifle', ['shotgun']) === 'shotgun',
    '...and to the far boundary for ctrl+LEFT');
  ok(!/molly|smoke|grenade|shield/.test(step(1, 'pistol', all)),
    'stepping never lands on a throwable or the shield');
}

// --- it is discoverable ----------------------------------------------------
ok(/Ctrl<\/span><span class="k">&larr;|<span class="k">Ctrl<\/span>/.test(html),
  'the key hints advertise Ctrl + arrows');
ok(/gun<\/b>/.test(html), 'and label it as the gun control');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);