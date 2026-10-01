// DOM overlays must be positioned in game coordinates and NOT hand-scaled.
//
// This test previously asserted the OPPOSITE, and was wrong.
//
// The claim it encoded was that Phaser's ScaleManager display scale is missing
// from DOM overlay positioning, so each element had to be scaled by hand. That
// is not true. ScaleManager.updateScale already gives the DOM container a CSS
// size of baseSize, a transform of displaySize/baseSize, and the canvas's own
// margins:
//
//     this.baseSize.setCSS(domContainer);
//     domStyle.transform = 'scale(' + displaySize.width  / baseSize.width  + ','
//                                   + displaySize.height / baseSize.height + ')';
//     domStyle.marginLeft = canvasStyle.marginLeft;
//     domStyle.marginTop  = canvasStyle.marginTop;
//
// So an element at game (gx, gy) already lands on the same screen pixel as a
// canvas object at (gx, gy). Hand-scaling it multiplies the position by s TWICE.
// That is what pushed the name field ~150px below the 46px plate holding it and
// out of line with the CALLSIGN label.
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('./src/ui.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const menu = fs.readFileSync(new URL('./src/scenes/MuleScene.ts'.replace('Mule', 'Menu'), import.meta.url), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// --- the wrong helper is gone ---------------------------------------------
// Strip comments first: the file explains the ScaleManager internals in prose,
// which necessarily mentions displayScale. Only executable lines count.
const uiCode = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const menuCode = menu.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

ok(!/export function scaleDom/.test(uiCode), 'scaleDom() is deleted');
ok(!/displayScale/.test(uiCode),
  'no executable line in ui.ts reads displayScale to hand-place an element');
ok(!/scaleDom/.test(menuCode), 'and nothing in MenuScene references it');
ok(!/import \{[^}]*scaleDom/.test(menuCode), 'the import is gone');

// --- no element is scaled or re-positioned by hand ------------------------
ok(!/add\.dom\([^)]*\)\.setScale/.test(menuCode), 'no add.dom() is given a manual setScale');
ok(!/scaleDom\(/.test(menuCode), 'no add.dom() goes through a scaling wrapper');

// --- the elements ARE positioned in game coordinates ---------------------
// ROW_Y is a game y. add.dom() takes game coordinates, which is correct now that
// the container carries the display scale.
ok(/this\.add\.dom\(x \+ INPUT_W \/ 2, ROW_Y, input\)/.test(menu),
  'the callsign field is positioned in game coordinates (x + INPUT_W/2, ROW_Y)');
ok(/this\.add\.dom\(0, -30, input\)/.test(menu),
  'the lobby-code field likewise, in modal-local coordinates');
ok(!/this\.add\.dom\([^)]*\*\s*scale/.test(menuCode),
  'and no position is multiplied by a scale factor by hand');

// --- the row is still measured and centred ------------------------------
ok(/let x = 480 - total \/ 2/.test(menu),
  'the callsign row is still measured and centred on the 480 centre line');
ok(/this\.add\.dom\(x \+ INPUT_W \/ 2/.test(menu),
  'the field lands at the measured slot, so it aligns with the label and avatar');

// --- the reason is recorded where the bug would be reintroduced -----------
ok(/DO NOT scale DOM overlays by hand/.test(ui),
  'ui.ts warns against hand-scaling DOM overlays');
ok(/baseSize\.setCSS\(domContainer\)/.test(ui),
  'and quotes the ScaleManager line that does the scaling');
ok(/displaySize\.width \/ baseSize\.width/.test(ui),
  'including the displaySize/baseSize transform');
ok(/x2\.25|x\^2|s twice|squared/i.test(ui),
  'and states the double-scaling arithmetic that caused the displacement');

// --- both DOM inputs still exist and are still wired ---------------------
ok((menu.match(/add\.dom\(/g) || []).length >= 2, 'both DOM inputs are still created');
ok(/registerUnderlay\(this\.add\.dom/.test(menu), 'the callsign field is still an underlay');
ok(/m\.body\.add\(holder\)/.test(menu), 'the lobby-code field still goes in the modal body');
ok(/input\.addEventListener\('change'/.test(menu), 'the change handler survived');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
