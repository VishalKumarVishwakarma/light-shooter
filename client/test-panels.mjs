// Premium sci-fi HUD: the panel system on the menus, lobby and modals.
//
// The old construction was identical everywhere -- a flat translucent
// fillRoundedRect inside a full 2.5px cyan outline -- so nothing in the headless
// suite could tell whether a surface had been upgraded or not, and a change to a
// panel's GEOMETRY would silently slide the content sitting on it. These
// assertions pin both: that the treatment is present on every surface that
// should have it, and that the footprints are byte-for-byte the same ones the
// content was laid out against.
import fs from 'node:fs';

const R = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const panel = R('src/panel.ts');
const ui = R('src/ui.ts');
const menu = R('src/scenes/MenuScene.ts');
const lobby = R('src/scenes/LobbyScene.ts');
const tex = R('src/textures.ts');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };
const body = (src, a, b) => {
  const i = src.indexOf(a);
  if (i < 0) return '';
  const j = src.indexOf(b, i);
  return j < 0 ? '' : src.slice(i, j + b.length);
};

// ---------------------------------------------------------------------------
// the primitives themselves
// ---------------------------------------------------------------------------
ok(/export function chamfer\(/.test(panel), 'chamfer() exists and is exported');
ok(/Math\.min\(cut, w \/ 2, h \/ 2\)/.test(panel),
  'the chamfer is clamped to half the panel, so a small surface cannot invert');
ok(/export function drawPanel\(/.test(panel) && /export function drawFrame\(/.test(panel)
  && /export function panelSweep\(/.test(panel), 'all three primitives are exported');

// four layers, in order: shadow -> gradient body -> inner shadow + specular -> rim
// Scoped to drawPanel's own body: the same words also appear in the option
// type's comments ABOVE the function, which would make every ordering check
// compare the wrong two offsets.
const draw = body(panel, 'export function drawPanel(', 'export type FrameOpts');
ok(draw.length > 0, 'drawPanel\'s body was located');
ok(draw.indexOf('cast shadow') < draw.indexOf('fillGradientStyle'),
  'the cast shadow is drawn before the body');
ok(/fillGradientStyle\(top, top, bot, bot/.test(draw) && /fillPoints\(pts, true\)/.test(draw),
  'the body is a real top-to-bottom gradient on the octagon, in one fill call');
ok(/g\.fillStyle\(bot, a\); \/\/ reset/.test(draw),
  'the gradient is reset afterwards, so a later flat fill cannot inherit the ramp');
ok(draw.indexOf('inner shadow') < draw.indexOf('specular hairline'),
  'the inner shadow is drawn before the specular hairline');
ok(/lineStyle\(1\.25, accent, rim\)/.test(draw),
  'the rim is a recessive 1.25px line, not the old 2.5px shout');
ok(!/lineStyle\(2\.5, 0x22d3ee/.test(draw), 'the 2.5px full outline is gone from the primitive');
ok(draw.indexOf('scanlines') < draw.indexOf('specular hairline'),
  'scanlines are part of the material stack');
// brackets: four corners, each an L, drawn on the bounding box
const frame = body(panel, 'export function drawFrame(', '// Travelling specular sweep');
ok((frame.match(/lineBetween/g) || []).length === 2, 'each bracket is two line segments');
ok(/for \(const cy of \[y, y \+ h\]\)/.test(frame) && /for \(const cx of \[x, x \+ w\]\)/.test(frame),
  '...drawn at all four corners');
ok(/accent stops/i.test(frame), 'the frame carries accent stops at the top edge');

// ---------------------------------------------------------------------------
// sweep lifecycle -- the one thing that can leak
// ---------------------------------------------------------------------------
const sweep = body(panel, 'export function panelSweep(', '\n}\n');
ok(/repeat: -1/.test(sweep), 'the sweep loops');
ok(/band\.once\(Phaser\.GameObjects\.Events\.DESTROY, \(\) => \{ tw\.stop\(\); \}\)/.test(sweep),
  'the sweep tween is killed on the image DESTROY event');
ok(!/events\.once\('shutdown'/.test(sweep),
  '...and not on scene shutdown, which does NOT cover a modal closed at runtime');
ok(/BlendModes\.ADD/.test(sweep), 'the sweep is ADD-blended, so it needs no clipping to the octagon');
ok(/displayWidth/.test(sweep), 'the sweep measures its own DISPLAY width, not the 128px texture width');

// ---------------------------------------------------------------------------
// the modal
// ---------------------------------------------------------------------------
const modal = body(ui, 'export function modal(', 'const toastY');
ok(/drawPanel\(panel, \{/.test(modal), 'the modal glass uses the panel primitive');
ok(/drawFrame\(panel, \{/.test(modal), '...with corner brackets');
ok(/panelSweep\(scene, null/.test(modal), '...and a travelling sweep');
ok(!/fillRoundedRect/.test(modal) && !/strokeRoundedRect/.test(modal),
  'no rounded-rect panel is left in the modal');
ok(!/fillRoundedRect\(-w \/ 2 \+ 18/.test(modal), 'the full-width neon crown bar is gone');
ok(/root\.add\(\[dim, glow, panel, sweep, head/.test(modal),
  'the sweep sits BETWEEN the glass and the text, so it never washes over copy');
// geometry that the content was laid out against must not move
ok(/root = scene\.add\.container\(480, 300\)/.test(modal), 'the modal root is still centred at 480,300');
ok(/const body = scene\.add\.container\(0, 22\)/.test(modal), 'the body container offset is still 22');
ok(/scene\.add\.text\(0, -h \/ 2 \+ 34,/.test(modal), 'the title still sits 34px below the panel top');
ok(/-h \/ 2 \+ 58/.test(modal), 'the title rule is still at +58');
ok(/fillText|add\.text\(w \/ 2 - 24, -h \/ 2 \+ 2[56]/.test(modal), 'the close button is still top-right');
ok(/w = 560, h = 380/.test(modal), 'the default modal size is unchanged');
// the close/teardown contract must survive the new objects
ok(/scene\.events\.once\(Phaser\.Scenes\.Events\.SHUTDOWN, restore\)/.test(modal),
  'a scene torn down with the modal open still releases the underlay count');
ok(/if \(--modalCount <= 0\)/.test(modal), 'the modalCount decrement is intact');

// ---------------------------------------------------------------------------
// the toast
// ---------------------------------------------------------------------------
const toast = body(ui, 'export function toast(', '\n}\n');
ok(/drawPanel\(bg, \{/.test(toast), 'the toast uses the panel primitive');
ok(/accent: dotC/.test(toast), 'its rim carries the message colour, so severity reads from shape');
ok(/scan: false/.test(toast), 'no scanlines on a 28px surface');
ok(/inner: 4/.test(toast), 'the inner shadow is scaled down for a 28px pill');
ok(/const pw = Math\.max\(120, t\.width \+ 52\)/.test(toast), 'the toast width formula is unchanged');

// ---------------------------------------------------------------------------
// the menu
// ---------------------------------------------------------------------------
ok(/drawPanel\(card, \{/.test(menu), 'the hero CTA card uses the panel primitive');
ok(/drawFrame\(card, \{/.test(menu), '...with corner brackets');
ok(/panelSweep\(this, null/.test(menu), '...and a sweep (it is the first thing you see)');
ok(/drawPanel\(plate, \{/.test(menu), 'the callsign field sits on a chamfered plate');
ok(/drawPanel\(rowG, \{/.test(menu), 'lobby list rows are chamfered panels');
ok(/rowG\.clear\(\)/.test(menu), '...and repainted on hover rather than fill-swapped');
ok(/const bg = this\.add\.rectangle\(480, y, 440, 28, 0x000000, 0\)/.test(menu),
  'the hit target is a separate transparent rect, so hover can change the rim');
ok(/\[rowG, bg, code, pips, chipBg, chip\]/.test(menu),
  'both the art and the hit target are registered for clearList()');
ok(!/this\.add\.rectangle\(480, y \+ 2, 444, 30/.test(menu),
  'the old manual drop plate under each row is gone (the panel casts its own)');
// the only rounded rects left in the menu are the 5px title underline
const rounded = [...menu.matchAll(/fillRoundedRect\(([^)]*)\)/g)].map((m) => m[1].trim());
ok(rounded.length === 3 && rounded.every((r) => /,\s*5,\s*2$/.test(r) || /,\s*1\.5,\s*1$/.test(r)),
  `the only rounded fills left are the neon title underline (${rounded.join(' | ')})`);

// ---------------------------------------------------------------------------
// the lobby
// ---------------------------------------------------------------------------
ok(/drawPanel\(pillG, \{/.test(lobby), 'the code pill is a chamfered panel, not a rounded texture');
ok(/drawPanel\(panel, \{/.test(lobby), 'the player panel uses the panel primitive');
ok(/drawFrame\(panel, \{/.test(lobby), '...with corner brackets');
ok(/panelSweep\(this, null/.test(lobby), '...and a sweep');
ok(/drawPanel\(strip, \{/.test(lobby), 'roster rows are chamfered panels');
ok(/drawFrame\(fr, \{/.test(lobby), 'the recon map gets brackets so it reads as an inset screen');
ok(/isReady \? 0x4ade80 : 0xef4444/.test(lobby), 'the roster keeps its green/red ready semantics');
// footprints -- every coordinate the content was positioned against
ok(/x: 230, y: 108, w: 500, h: 288/.test(lobby), 'the player panel keeps its 230,108 500x288 footprint');
ok(/x: 250, y: y - 13, w: 462, h: 26/.test(lobby), 'roster rows keep their 250..712 x 26 band');
ok(/x: 260, y: 52, w: 440, h: 44/.test(lobby), 'the code pill keeps its 440x44 footprint');
ok(/this\.add\.rectangle\(480, 74, 440, 44, 0x000000, 0\)/.test(lobby),
  'the pill hit target is unchanged, so the copy click area is identical');
ok(/const head = this\.add\.text\(250, 126/.test(lobby) && /const rdy = this\.add\.text\(710, 126/.test(lobby),
  'the squad header and ready counter keep their columns');
ok(/const row = this\.add\.text\(292, y,/.test(lobby), 'roster names still start at x=292');
ok(/this\.add\.image\(268, y,/.test(lobby) && /this\.add\.circle\(596, y, 6/.test(lobby),
  'the avatar and status light keep their columns');
ok(/x: 292, y: 232, w: 376, h: 164/.test(menu), 'the CTA card keeps its 376x164 footprint');
  // The callsign plate is no longer a fixed 424x36. It was 36px tall while the
  // avatar it contains is 39.2px (56px texture at 0.7), so the avatar poked out
  // of the top and bottom of its own field; and 424 wide put its centre on 484
  // while the rest of the menu is centred on 480. It is now measured from the
  // row and sized to fit, so assert the property rather than the old numbers.
  // test-menu-callsign.mjs covers this row in detail.
  ok(/const PLATE_H = 46/.test(menu) && /x: Math\.round\(480 - total \/ 2 - PAD\)/.test(menu)
    && /w: Math\.round\(total \+ PAD \* 2\)/.test(menu),
    'the callsign plate is measured, centred on 480, and tall enough to hold the avatar');
ok(/x: 260, y: y - 14, w: 440, h: 28/.test(menu), 'menu list rows keep their 440x28 band');

// ---------------------------------------------------------------------------
// restraint: motion on hero panels only
// ---------------------------------------------------------------------------
const sweeps = (menu + lobby + ui).match(/panelSweep\(/g) || [];
ok(sweeps.length === 3, `exactly three sweeps ship (modal, CTA card, lobby panel) - ${sweeps.length}`);
ok(!/panelSweep\([^)]*rowG/.test(menu) && !/panelSweep\([^)]*strip/.test(lobby),
  'list rows get NO sweep: eight roster rows each running a 4s loop is noise, not polish');
ok(!/panelSweep/.test(lobby.slice(lobby.indexOf('room.state.players.onAdd'))),
  'nothing inside the 30Hz roster redraw allocates a tween or an image');

// ---------------------------------------------------------------------------
// dead code
// ---------------------------------------------------------------------------
ok(!/function pill\(\)/.test(tex) && !/put\(scene, 'pill'/.test(tex),
  "the 456x60 'pill' canvas is removed (the code pill no longer uses it)");

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
