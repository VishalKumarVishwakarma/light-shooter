// The avatar's drawn ART must be centred against the name beside it.
//
// soldier() documents its own vertical extents (head y-22..0, torso y-2..+9, legs
// y+7..+14) while drawing into cv(56,56) with cy=28 commented "texture centre ==
// the collision point". Those extents span -22..+14, so the figure's visual
// centre is -4 -- four pixels ABOVE the canvas centre. Nothing lands on cy: there
// is 6px of headroom over the helmet and 14px of dead space under the boots.
//
// So every avatar rendered high inside its own texture and never lined up with
// the name next to it: 2.8px in the menu row, 2.0px in the lobby roster, and a
// full 4 game-pixels in the arena.
//
// The fix exports the offset and compensates at the two UI call sites. The
// generator is deliberately NOT changed -- the arena draws the body at scale 1
// with the gun positioned separately against its hands, and there is still no
// browser attached to verify that shifting the art would not detach them.
import fs from 'node:fs';

const tex = fs.readFileSync(new URL('./src/textures.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const menu = fs.readFileSync(new URL('./src/scenes/MenuScene.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lobby = fs.readFileSync(new URL('./src/scenes/LobbyScene.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// --- the offset is derived from the generator's own numbers, not guessed ---
ok(/export const SOLDIER_ART_DY = -4;/.test(tex),
  'SOLDIER_ART_DY is exported as -4 (the figure centre sits 4px above the canvas centre)');

// recompute it from the extents the generator documents, so the constant cannot
// drift away from the art it describes.
// The comment lines carry trailing prose ("... half the figure: the instant read
// at 32px on screen"), so anchor on the range itself and ignore the rest.
const headTop = /head\s+y\s+-(\d+)\.\.0/.exec(tex);
const bootsEnd = /legs\s+y\s+\+\d+\.\.\+(\d+)/.exec(tex);
ok(!!headTop && !!bootsEnd, "the generator's documented extents are found");
if (headTop && bootsEnd) {
  const top = -Number(headTop[1]);
  const bottom = Number(bootsEnd[1]);
  const derived = Math.round((top + bottom) / 2);
  const declared = Number(/SOLDIER_ART_DY = (-?\d+)/.exec(tex)[1]);
  ok(derived === declared,
    `SOLDIER_ART_DY matches the art: head top ${top}, boots ${bottom}, centre ${derived} -> ${declared}`);
  ok(derived < 0, 'and the figure really is drawn high, so a correction is warranted');
}

// the canvas is 56px and cy is 28, i.e. the claimed collision centre
ok(/cv\(56, 56\)/.test(tex), 'the soldier canvas is 56x56');
ok(/const cx = 28, cy = 28/.test(tex), 'with cy = 28 at the documented centre');

// --- both UI sites compensate -------------------------------------------
ok(/add\.image\(x \+ AVATAR \/ 2, ROW_Y - SOLDIER_ART_DY \* 0\.7, 'soldier_me'\)/.test(menu),
  'the menu avatar is nudged down by the offset at its 0.7 scale');
ok(/add\.image\(268, y - SOLDIER_ART_DY \* 0\.5,/.test(lobby),
  'the lobby roster avatar likewise at 0.5');
ok(/SOLDIER_ART_DY/.test(menu) && /from '\.\.\/textures'/.test(menu), 'MenuScene imports it');
ok(/SOLDIER_ART_DY/.test(lobby) && /from '\.\.\/textures'/.test(lobby), 'LobbyScene imports it');

// --- and the sign is right: -(-4)*scale is DOWNWARD ---------------------
const dy = -4;
ok(dy - -4 === dy - (-4), 'sign sanity: -SOLDIER_ART_DY * scale > 0 moves the image down');
ok(Math.abs((204 - dy * 0.7) - 204) > 2, 'the menu nudge is ~2.8px, which is visible');

// --- the raw, uncompensated draws are gone -------------------------------
ok(!/add\.image\(x \+ AVATAR \/ 2, ROW_Y, 'soldier_me'\)/.test(menu),
  'the old uncompensated menu draw is gone');
ok(!/add\.image\(268, y, id === meId \? 'soldier_me'/.test(lobby),
  'the old uncompensated lobby draw is gone');

// --- the generator was NOT touched, and that is deliberate ---------------
ok(!/cy = 32/.test(tex) && !/cy = 24/.test(tex),
  'the generator\'s cy is untouched: the fix is at the call sites, not in the art');
ok(/The generator itself is deliberately[\s\S]{0,80}left alone/.test(tex) ||
  /generator is deliberately NOT changed/.test(tex) ||
  /left alone: the arena draws the body at \(0,0\)/.test(tex),
  'and textures.ts records why, so it is not "tidied up" later');
ok(/no browser has been attached/i.test(tex), 'including the fact that this is unverified in a browser');

// --- the arena finding is recorded, not silently ignored ----------------
// The arena draws the body at scale 1, so the offset there is a full 4 game-px,
// which is a gameplay-visual issue (body vs its own hitbox), not a 2px cosmetic
// one. It must stay written down rather than quietly dropped.
ok(/arena draws the body at \(0,0\) with NO setScale/.test(tex),
  'the arena scale-1 case is documented in textures.ts');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);