// The HOW TO PLAY content must be equally placed inside the modal box: the space
// above the rows and the space below them must be the same.
//
// The arithmetic here mirrors modal()'s real geometry rather than assuming it:
//
//     title rule      at -h/2 + 58        (ui.ts:186)
//     body container  at (0, 22)          (ui.ts:197)
//     bottom rim      at +h/2
//
// The old code placed rows at bodyTop(h) = -h/2 + 92. That is a BODY-LOCAL y, and
// the container is already +22 down, so the real top was -h/2 + 114 -- leaving 56px
// under the rule before any slack, against 10px at the bottom. With
// h = plan.height + 132 the slack was a constant 8px, so the gaps came out 64 vs
// 10 at EVERY plan height: the content sat in the lower half of the box.
import fs from 'node:fs';

const menu = fs.readFileSync(new URL('./src/scenes/MenuScene.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ui = fs.readFileSync(new URL('./src/ui.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// --- modal()'s anchors are what the maths must agree with ---------------
ok(/moveTo\(-w \/ 2 \+ 28, -h \/ 2 \+ 58\)/.test(ui), 'the title rule really is at -h/2 + 58');
ok(/const body = scene\.add\.container\(0, 22\)/.test(ui), 'the body container really is at +22');
ok(/const head = scene\.add\.text\(0, -h \/ 2 \+ 34/.test(ui), 'and the title sits above the rule');

// --- the helper exists and uses those anchors ---------------------------
ok(/private centredBodyTop\(h: number, contentH: number\)/.test(menu),
  'centredBodyTop(h, contentH) exists');
ok(/const RULE_Y = 58/.test(menu), 'it names the title rule offset');
ok(/const BODY_DY = 22/.test(menu), 'it names the body container offset');
ok(/const band = h - RULE_Y/.test(menu), 'the band runs from the rule to the bottom rim');
ok(/Math\.max\(0, \(band - contentH\) \/ 2\)/.test(menu),
  'the padding is the leftover split in half, and never goes negative');
ok(/return \(-h \/ 2 \+ RULE_Y\) \+ pad - BODY_DY/.test(menu),
  'it converts the panel-coordinate top into a body-local y');

// --- openHow uses it ----------------------------------------------------
ok(/this\.drawPlan\(m, plan, this\.centredBodyTop\(h, plan\.height\), 15\)/.test(menu),
  'openHow centres the rows with it');
ok(/const usable = h - 92 - 24/.test(menu) === false,
  'the old hand-rolled slack arithmetic is gone');

// --- the arithmetic itself: recompute the gaps for real plan heights -----
const RULE_Y = 58, BODY_DY = 22, BASE_W = 960, BASE_H = 600;
// 11 rows at 15px with an 8px gap; Phaser line height for BODY 15px is ~18px
const planH = 11 * 18 + 10 * 8;
const h = Math.min(520, Math.max(300, planH + 132));
const band = h - RULE_Y;
const pad = Math.max(0, (band - planH) / 2);
const topBody = (-h / 2 + RULE_Y) + pad - BODY_DY;
const topPanel = topBody + BODY_DY;   // back to panel coords
const above = topPanel - (-h / 2 + RULE_Y);
const below = h / 2 - (topPanel + planH);

ok(Math.abs(above - below) < 0.001,
  `the gaps are equal by construction: above ${above.toFixed(0)}px, below ${below.toFixed(0)}px`);
ok(above > 0 && below > 0, 'and both are positive, so the content is inside the box');
ok(topPanel + planH < h / 2 + 0.001, 'the content does not overflow the bottom rim');

// The OLD arithmetic, reproduced exactly. openHow did:
//     top    = bodyTop(h)                       = -h/2 + 92   (BODY-local)
//     usable = h - 92 - 24                      = h - 116
//     slack  = max(0, (usable - plan.height) / 2)
// and the body container is +22 down, so in panel coords the top was -h/2 + 114
// plus that slack.
const oldSlack = Math.max(0, ((h - 116) - planH) / 2);
const oldTopPanel = (-h / 2 + 92) + BODY_DY + oldSlack;
const oldAbove = oldTopPanel - (-h / 2 + RULE_Y);
const oldBelow = h / 2 - (oldTopPanel + planH);
ok(oldAbove > oldBelow + 40,
  `the old placement really was lopsided: ${oldAbove.toFixed(0)}px above vs ${oldBelow.toFixed(0)}px below`);

// --- openSettings is deliberately left alone ----------------------------
ok(/private bodyTop\(h: number\)/.test(menu), 'bodyTop() still exists');
ok(/let y = this\.bodyTop\(h\);/.test(menu),
  'openSettings still uses it -- it stacks from the top and pins a footer button');
ok(/this\.linkButton\(m\.body, 0, this\.bodyTop\(h\) \+ h - 96/.test(menu),
  'and its RESET CALLSIGN is still pinned to the bottom rim');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);