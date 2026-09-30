// DOM overlays must be locked to the canvas display scale.
//
// Follow-up to "call sign and name plate box are misplaced".
//
// The previous commit re-centred the callsign row correctly, in GAME coordinates,
// and it was still wrong on screen. The reason is a Phaser limitation that only
// became visible when the layout started fitting the window (7984592):
// DOMElementCSSRenderer builds its CSS transform from the camera matrix and the
// object's own x/y/scale, and the ScaleManager's displayScale appears nowhere in
// it. So add.dom() places elements in the CONTAINER's CSS pixels, unscaled,
// while the canvas around them is up to 1.5x larger.
//
// At display scale 1.0 the bug is invisible -- which is why it survived so long.
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('./src/ui.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const menu = fs.readFileSync(new URL('./src/scenes/MenuScene.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const main = fs.readFileSync(new URL('./src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// --- the helper exists and is correct -------------------------------------
ok(/export function scaleDom\(/.test(ui), 'ui.ts exports scaleDom');
ok(/scene\.scale\.displayScale/.test(ui),
  'it reads scale.displayScale -- the factor Phaser keeps out of the DOM transform');
ok(/el\.setPosition\(gx \* s\.x, gy \* s\.y\)/.test(ui),
  'the position is converted from game px to CSS px');
ok(/el\.setScale\(s\.x, s\.y\)/.test(ui),
  'and the element itself is scaled, so the field is the right SIZE not just the right place');
ok(/scene\.scale\.on\(Phaser\.Scale\.Events\.RESIZE, apply\)/.test(ui),
  're-applied on every resize, or it breaks the moment the window changes');
ok(/scene\.scale\.off\(Phaser\.Scale\.Events\.RESIZE, apply\)/.test(ui),
  'and the resize listener is detached on scene shutdown (a rematch must not leak it)');
ok(/Phaser\.Scenes\.Events\.SHUTDOWN/.test(ui), 'the detach is bound to scene shutdown');

// --- both inputs use it ----------------------------------------------------
// Count real call sites, not the ones inside the explanatory comment above them.
const doms = [...menu.matchAll(/^(?!\s*\/\/).*add\.dom\(/gm)];
ok(doms.length === 2,
  `both DOM inputs in the menu are accounted for (found ${doms.length}, comments excluded)`);
ok(/scaleDom\(this,\s*this\.add\.dom\(x \+ INPUT_W \/ 2, ROW_Y, input\)/.test(menu),
  'the callsign field is scaled');
ok(/scaleDom\(this, this\.add\.dom\(0, -30, input\), 0, -30\)/.test(menu),
  'the lobby-code modal field is scaled too -- it has the same problem');
ok(/import \{[^}]*scaleDom[^}]*\} from '\.\.\/ui'/.test(menu), 'scaleDom is imported');

// --- the unscaled call sites are gone -------------------------------------
ok(!/registerUnderlay\(this\.add\.dom\(/.test(menu),
  'no add.dom() is still registered without the scale lock');
ok(!/m\.body\.add\(this\.add\.dom\(/.test(menu),
  'nor added straight into the modal container unscaled');

// --- the premise: the canvas really does scale ---------------------------
ok(/Phaser\.Scale\.FIT/.test(main), 'the canvas is in Scale.FIT, so it IS css-scaled');
ok(/Phaser\.Scale\.CENTER_BOTH/.test(main), 'and auto-centred');

// --- the arithmetic that made this visible --------------------------------
// Width 960, so any viewport wider than 960 gives a display scale above 1 and
// every unscaled DOM field is too small. The menu is 960 wide inside a 960-wide
// game; the CANVAS scales, the input does not.
const VW = 1920;
const scale = VW / 960;
ok(scale > 1, `a ${VW}px viewport scales the canvas to ${scale}x`);
const PLATE_W = 435, INPUT_W = 230;
const rendered = INPUT_W;                       // unscaled: CSS px, unchanged
const expected = INPUT_W * scale;               // what it should be
ok(expected - rendered > 100,
  `an unscaled field renders ${rendered}px wide inside a ${PLATE_W * scale}-px plate; ` +
  `it should be ${expected}px -- off by ${(expected - rendered).toFixed(0)}px`);
ok(/width: 100%/.test(fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8')),
  'the layout is viewport-driven, so this is reachable in normal use');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
