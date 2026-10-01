// Menu layout: the callsign row must sit on the menu's centre line and contain
// its own avatar.
//
// Reported as "call sign has misplaced". Three separate defects, which look like
// one vague problem on screen:
//
//   1. the avatar overflowed the plate it sits in (39.2px avatar, 36px plate)
//   2. the plate was centred on 484 while the entire menu is centred on 480
//   3. the plate overhung the hero CTA card asymmetrically (20px left, 28px right)
//
// The fix measures the row and lays it out from 480, because two of the four
// child widths come from a webfont and hardcoding them is what produced the 4px
// error. These assertions pin the property, not the old numbers.
import fs from 'node:fs';

const menu = fs.readFileSync(new URL('./src/scenes/MenuScene.ts', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// --- the centre line everything shares -------------------------------------
// The hero CTA card, the CREATE LOBBY button, the title, the kicker and the sub.
const card = /drawPanel\(card, \{ x: (\d+), y: (\d+), w: (\d+), h: (\d+)/.exec(menu);
ok(!!card, 'the hero CTA card is still declared');
const cardCentre = +card[1] + +card[3] / 2;
ok(cardCentre === 480, `the CTA card is centred on 480 (was ${cardCentre})`);

// --- the plate is derived from the centre, not hardcoded -------------------
ok(!/x: 272, y: 186, w: 424, h: 36/.test(menu),
  'the old hardcoded 272/186/424/36 plate is gone');
ok(/const AVATAR = 39\.2/.test(menu), 'the avatar footprint is named (56px texture at 0.7)');
ok(/const INPUT_W = 230/.test(menu), 'the input width is named');
ok(/const PLATE_H = 46/.test(menu),
  'the plate is 46px tall, so the 39.2px avatar fits inside it (was 36)');
ok(PLATE_FITS(), 'avatar fits the plate vertically with air to spare');

function PLATE_FITS() {
  const h = +/const PLATE_H = (\d+)/.exec(menu)[1];
  const av = +/const AVATAR = ([\d.]+)/.exec(menu)[1];
  return h - av >= 4; // at least 2px of air top and bottom
}

// --- the row is measured, then centred -------------------------------------
ok(/const total = AVATAR \+ GAP \+ cs\.width \+ GAP \+ INPUT_W \+ GAP \+ dice\.width/.test(menu),
  'the row width is measured from cs.width and dice.width, not assumed');
ok(/let x = 480 - total \/ 2/.test(menu),
  'the row starts at 480 - total/2, i.e. it is centred on the menu centre line');
ok(/x: Math\.round\(480 - total \/ 2 - PAD\)/.test(menu),
  'and the plate is centred the same way, so its edges cannot drift off-line');
ok(/w: Math\.round\(total \+ PAD \* 2\)/.test(menu),
  'the plate is sized to the measured content rather than a fixed 424');

// --- nothing is left at a magic x ------------------------------------------
// Every one of the old offsets (320/516/292/662) must be gone: they are what
// encoded the 4px drift.
for (const [x, what] of [[320, 'CALLSIGN label'], [516, 'DOM input'], [662, 'dice']]) {
  ok(!new RegExp(`add\\.(text|dom|image)\\((${x}|${x - 0}),\\s*204`).test(menu),
    `the ${what} is no longer pinned to x=${x}`);
}
// the avatar used to be at 292
ok(!/add\.image\(292, 204, 'soldier_me'\)/.test(menu),
  "the avatar is no longer pinned to x=292");

// --- the avatar actually uses that footprint -------------------------------
ok(/add\.image\(x \+ AVATAR \/ 2, ROW_Y - SOLDIER_ART_DY \* 0\.7, 'soldier_me'\)/.test(menu),
  'the avatar is at the measured left edge + half its width, nudged down for optical centring');
ok(/setScale\(0\.7\)/.test(menu), 'and still at scale 0.7 (appearance unchanged)');
ok(/setScale\(0\.7\)/.test(menu), 'and still at scale 0.7 (unchanged appearance)');

// --- the input width is now real -------------------------------------------
ok(/box-sizing:border-box;width:230px/.test(menu),
  'the input declares box-sizing:border-box, so INPUT_W is the rendered width');
ok(/add\.dom\(x \+ INPUT_W \/ 2, ROW_Y, input\)/.test(menu),
  'the DOM input is centred on the measured slot');

// --- the row still works ----------------------------------------------------
// The callsign field is registered as an underlay so a modal can hide it. It is
// positioned with a plain add.dom(): Phaser scales the DOM container to match the
// canvas on every resize, so hand-scaling the element would double-count the
// scale and displace it. See ui.ts and test-dom-scale.mjs.
ok(/registerUnderlay\(this\.add\.dom\(x \+ INPUT_W \/ 2, ROW_Y, input\)/.test(menu),
  'the input is still registered as an underlay so a modal can hide it');
ok(/input\.addEventListener\('change'/.test(menu), 'the change handler survived');
ok(/dice\.on\('pointerdown'/.test(menu), 'the dice randomiser survived');
ok(/input\.maxLength = 12/.test(menu), 'the 12-char cap survived (server caps too)');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
