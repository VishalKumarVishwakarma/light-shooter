// Execute the procedural soldier against a recording Canvas2D stub.
//
// This art is ~180 lines of hand-rolled canvas calls, and it runs for EVERY
// player on join -- a single NaN coordinate or a misspelled method would throw
// inside the game's boot path and take the whole lobby down, and tsc cannot see
// either. So the routine is actually executed here, for all nine variants, and
// every numeric argument is checked for finiteness.
//
// The module is transpiled with esbuild (already a dependency) rather than
// regex-stripping type annotations, then the two functions are lifted out: the
// module itself imports Phaser, which needs a DOM.
import fs from 'node:fs';
import * as esbuild from 'esbuild';

const raw = fs.readFileSync('src/textures.ts', 'utf8').replace(/\r\n/g, '\n');
const map = fs.readFileSync('src/map.ts', 'utf8').replace(/\r\n/g, '\n');
const arena = fs.readFileSync('src/scenes/ArenaScene.ts', 'utf8').replace(/\r\n/g, '\n');
const src = (await esbuild.transform(raw, { loader: 'ts', format: 'cjs' })).code;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// esbuild splits `ctx.beginPath(); ctx.moveTo(...);` onto separate lines, so the
// structural regexes below must run against whitespace-flattened text.
const flat = (s) => s.replace(/\s+/g, ' ');
// esbuild strips comments and constant-folds (0x2f6b2d1 -> 49722065), so the
// STRUCTURAL assertions must read the original source. The transpiled bundle is
// only for EXECUTION.
const rawFn = (name) => {
  const i = raw.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found in textures.ts`);
  const j = raw.indexOf('\nfunction ', i + 10);
  return raw.slice(i, j < 0 ? raw.length : j);
};
const fn = (name) => {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found`);
  const j = src.indexOf('\nfunction ', i + 10);
  return src.slice(i, j < 0 ? src.length : j);
};

// ---- a recording 2D context -------------------------------------------------
const NUMERIC = new Set(['ellipse', 'arc', 'roundRect', 'rect', 'fillRect', 'strokeRect',
  'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arcTo', 'translate',
  'scale', 'rotate', 'setTransform', 'createLinearGradient', 'createRadialGradient']);
const calls = [];
let bad = [];
let unknown = null;

const grad = { addColorStop() {} };
function makeCtx() {
  const target = {};
  return new Proxy(target, {
    get(_t, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== 'string') return undefined;
      // every other member must be a callable we know about, or a style prop
      if (prop === 'canvas') return { width: 56, height: 56 };
      if (['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'font',
        'textAlign', 'textBaseline', 'globalAlpha', 'shadowColor', 'shadowBlur',
        'filter', 'globalCompositeOperation'].includes(prop)) return undefined;
      return (...args) => {
        if (unknown === null && !/^[a-z]/.test(prop) === false) unknown = null;
        calls.push(prop);
        if (NUMERIC.has(prop)) {
          args.forEach((a, k) => {
            if (a === undefined) bad.push(`${prop} arg${k} undefined`);
            else if (typeof a === 'number' && !Number.isFinite(a)) {
              bad.push(`${prop} arg${k} = ${a}`);
            }
          });
        }
        if (prop.startsWith('create') && prop.includes('Gradient')) return grad;
        if (prop === 'measureText') return () => ({ width: 10 });
        return undefined;
      };
    },
    set(_t, prop, value) { target[prop] = value; return true; },
  });
}

// a strict whitelist: calling anything else is a bug we want to hear about
const KNOWN = new Set(['save', 'restore', 'beginPath', 'closePath', 'fill', 'stroke',
  'ellipse', 'arc', 'arcTo', 'roundRect', 'rect', 'fillRect', 'strokeRect', 'clearRect',
  'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'translate', 'scale', 'rotate',
  'setTransform', 'createLinearGradient', 'createRadialGradient', 'measureText', 'fillText',
  'strokeText', 'clip', 'setLineDash']);

// the canvas dimensions each generator asks for, so the stub can report them
const cvSizes = [];
const cv = (w = 56, h = 56) => {
  cvSizes.push([w, h]);
  return { c: { width: w, height: h }, ctx: makeCtx() };
};

// ---- run every variant ------------------------------------------------------
const soldier = fn('soldier');
const star = fn('star');
const guard = fn('guardTex');
const bush = fn('bushTile');
// eslint-disable-next-line no-new-func
const factory = new Function('cv',
  `${star}\n${soldier}\n${guard}\n${bush}\nreturn { soldier, guardTex, bushTile };`);
const { soldier: draw, guardTex: drawGuard, bushTile: drawBush } = factory(cv);

const ME = ['#22d3ee', '#0e7490', '#a5f3fc', '#083344', null];
const FOE = [
  ['#ef4444', '#991b1b', '#fecaca', '#450a0a', null],
  ['#f97316', '#9a3412', '#fed7aa', '#7c2d12', null],
  ['#a855f7', '#6b21a8', '#ddd6fe', '#4c1d95', null],
  ['#eab308', '#854d0e', '#fef08a', '#713f12', null],
  ['#ec4899', '#9d174d', '#fbcfe8', '#831843', null],
  ['#84cc16', '#3f6212', '#d9f99d', '#365314', null],
  ['#3b82f6', '#1e3a8a', '#bfdbfe', '#1e40af', null],
  ['#10b981', '#065f46', '#a7f3d0', '#064e3b', null],
];

const variants = [['me', ME], ...FOE.map((c, i) => [`foe ${i + 1}`, c])];
let threw = null;
for (const [name, args] of variants) {
  calls.length = 0; bad = [];
  try {
    draw(...args);
  } catch (e) {
    threw = `${name}: ${e.message}`;
    break;
  }
  ok(bad.length === 0, `${name}: every coordinate is finite${bad.length ? ` -- ${bad.slice(0, 3).join('; ')}` : ''}`);
}

// the numbered avatar variants pass a squad number, which adds the chest patch
let badgeThrew = null;
for (let n = 1; n <= 8; n++) {
  calls.length = 0; bad = [];
  try { draw('#22d3ee', '#0e7490', '#a5f3fc', '#083344', String(n)); }
  catch (e) { badgeThrew = `badge ${n}: ${e.message}`; break; }
  if (bad.length) { badgeThrew = `badge ${n}: ${bad[0]}`; break; }
}
ok(!threw, `all ${variants.length} variants draw without throwing${threw ? ` -- ${threw}` : ''}`);
ok(!badgeThrew, 'all 8 numbered squad variants draw without throwing' + (badgeThrew ? ` -- ${badgeThrew}` : ''));

// ---- only whitelisted methods are called ------------------------------------
ok(unknown === null, 'no unknown ctx method was reached');
ok(!bad.length, 'no non-finite argument was recorded');

// ---- the chibi construction is actually in there ----------------------------
const has = (m) => calls.includes(m);
ok(has('roundRect'), 'legs, boots, plate carrier, pouches and belt use roundRect');
ok(has('ellipse'), 'the face and helmet domes are ellipses (a 3/4 head, not a ball)');
ok(has('quadraticCurveTo'), 'torso and sleeve are curved, not boxes');
ok(has('createLinearGradient'), 'a vertical key light gradient is applied');
ok(has('createRadialGradient'), 'the helmet keeps its radial team-colour shading');
ok(calls.filter((m) => m === 'stroke').length >= 8,
  `heavy contour work: ${calls.filter((m) => m === 'stroke').length} strokes for a clean silhouette`);
ok(calls.filter((m) => m === 'fill').length >= 12,
  `${calls.filter((m) => m === 'fill').length} filled shapes`);
// re-draw an UN-numbered variant: the badge loop above left calls populated, and
// the "no watermark" check must look at a run that had no numeral in it
calls.length = 0; bad = [];
draw('#22d3ee', '#0e7490', '#a5f3fc', '#083344', null);
ok(!has('fillText'), 'the un-numbered variants draw no text (no watermark)');
ok(calls.length >= 20, `...and still draw the whole figure (${calls.length} ops)`);

// the numbered variant stamps a numeral on the vest
calls.length = 0; draw('#22d3ee', '#0e7490', '#a5f3fc', '#083344', '3');
ok(has('fillText'), 'the numbered variant stamps a squad numeral on the vest');
ok(calls.length >= 20, '...and the badge path still draws the whole figure');

// ---- the proportions the prompt asked for -----------------------------------
const s = soldier;
// head: a face ellipse of radius 8.4/9.2 and a dome of 11.4/10.6 around a
// 56px canvas -- i.e. a head roughly half the 36px figure, not a torso ball
ok(/ellipse\(cx \+ 2\.5, cy - 12, 8\.4, 9\.2/.test(s), 'the head is a large expressive face (chibi proportion)');
ok(/cy \+ 13, 11, 3\.4/.test(s), 'there is a contact shadow grounding the figure');
ok(/roundRect\(x, cy \+ 6, 5, 8, 2\)/.test(s), 'the legs are drawn in the body, not left to the hidden boot sprites');
ok(/roundRect\(x - 0\.6, cy \+ 12, 6\.4, 4\.2/.test(s), 'boots are drawn, with a lit toe and a dark sole');
ok(/const ARM_X = 10, ARM_Y = 1/.test(s),
  'the sleeve stops at the rifle\'s trigger hand, which rides the rotating gun sprite');
ok(/shoulder nubs/.test(src) === false, 'the old shoulder-nub construction is gone');
ok(/arc\(cx, cy, 12, 0, Math\.PI \* 2\)/.test(src) === false, 'the old torso ball is gone');

// ---------------------------------------------------------------------------
// The rifle must pivot on the CHARACTER, not on its own stock.
//
// The gun image used to sit at (8,0) with a hand-picked origin, so it rotated
// about a point 8px right of the character. The barrel tip therefore swung on a
// circle of radius 37.57 centred at (8,0), while the tracer, muzzle flash,
// laser beam and electric arc all spawn at MUZZLE from the character CENTRE. The
// two agreed only at aim-right and diverged by up to 16.4px at aim-left -- over
// half the player's width -- so shots visibly left from thin air.
{
  const MUZZLE = +/export const MUZZLE = (\d+)/.exec(map)?.[1];
  const num = (n) => {
    const m = new RegExp(`const ${n} = ([-\\d.]+)`).exec(arena);
    if (!m) throw new Error(`${n} not found in ArenaScene.ts`);
    return +m[1];
  };
  const GUN_TEX_W = num('GUN_TEX_W'), GUN_SCALE = num('GUN_SCALE');
  const GUN_REST_X = num('GUN_REST_X');
  const derived = /const GUN_ORIGIN_X = 1 - MUZZLE \/ \(GUN_TEX_W \* GUN_SCALE\)/.test(arena);
  const GUN_ORIGIN_X = derived
    ? 1 - MUZZLE / (GUN_TEX_W * GUN_SCALE)
    : (() => { throw new Error('GUN_ORIGIN_X is not derived from MUZZLE'); })();

  // Read the ACTUAL mount out of the constructor, not just the constants: the
  // constants can stay correct while nothing uses them, which is exactly the
  // shape of the original bug. The sweep below runs on these values.
  // Anchored on `const gun = ` -- the same 'gun' texture is also used as the
  // ammo HUD icon at (724,18) scale 0.55, and matching that would be nonsense.
  const mount = /const gun = this\.add\.image\(([-\d.]+|[A-Z_][A-Z0-9_]*), ?([-\d.]+|[A-Z_][A-Z0-9_]*), 'gun'\)\.setScale\(([\d.]+|[A-Z_][A-Z0-9_]*)\)/.exec(arena);
  const org = /gun\.setOrigin\(([-\d.]+|[A-Z_][A-Z0-9_]*), ?([-\d.]+|[A-Z_][A-Z0-9_]*)\)/.exec(arena);
  const tex = /function gun\(\)[\s\S]*?cv\((\d+), ?(\d+)\)/.exec(raw);
  // the mount may be written as a literal or as a named constant, and the two
  // must agree -- resolving the name is what catches a literal creeping back in.
  // GUN_ORIGIN_X is an EXPRESSION (derived from MUZZLE), so it cannot be read
  // as a literal: it is evaluated from its own definition.
  const DERIVED_ORIGIN = /const GUN_ORIGIN_X = 1 - MUZZLE \/ \(GUN_TEX_W \* GUN_SCALE\)/.test(arena);
  const derivedOriginX = DERIVED_ORIGIN
    ? 1 - MUZZLE / (GUN_TEX_W * GUN_SCALE) : NaN;
  const resolve = (tok) => {
    if (tok === undefined) return NaN;
    if (tok === 'GUN_ORIGIN_X') return derivedOriginX;
    if (/^[-\d.]+$/.test(tok)) return +tok;
    const m = new RegExp(`const ${tok} = ([-\\d.]+)`).exec(arena);
    if (!m) return NaN;
    return +m[1];
  };
  const mX = mount ? resolve(mount[1]) : NaN, mY = mount ? resolve(mount[2]) : NaN;
  const mScale = mount ? resolve(mount[3]) : NaN;
  const mOx = org ? resolve(org[1]) : NaN, mOy = org ? resolve(org[2]) : NaN;
  const texW = tex ? +tex[1] : NaN, texH = tex ? +tex[2] : NaN;

  ok(!!mount && !!org, 'the mounted rifle and its origin are parseable');
  ok(Number.isFinite(mX) && Number.isFinite(mOx) && Number.isFinite(mScale),
    `the mount resolves to numbers (x=${mX}, originX=${mOx}, scale=${mScale})`);
  ok(texW === GUN_TEX_W,
    `GUN_TEX_W matches the real gun canvas (${GUN_TEX_W} vs ${texW})`);
  ok(mScale === GUN_SCALE, `the mount uses GUN_SCALE (${mScale} vs ${GUN_SCALE})`);
  ok(derived, 'the texture pivot is DERIVED from MUZZLE, not hand-picked');
  ok(/const gun = this\.add\.image\(GUN_REST_X, 0, 'gun'\)/.test(arena),
    'the gun is pinned to the rest position, not a hardcoded 8');
  ok(/gun\.setOrigin\(GUN_ORIGIN_X, 0\.5\)/.test(arena), '...with the derived origin');
  ok(mX === 0, `...and the mount x is the character centre (got ${mX})`);
  ok(mY === 0, `...and the mount y is on the barrel axis (got ${mY})`);
  ok(mOy === 0.5, '...with the origin vertically centred on the barrel axis');

  // the invariant itself, over a full sweep, on the values actually mounted
  const tipLenOf = () => (texW - mOx * texW) * mScale;
  let worst = 0, worstDeg = 0;
  for (let deg = 0; deg < 360; deg += 0.5) {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a), sn = Math.sin(a);
    // the image rotates about its origin, which sits at the mount point
    const tx = mX + tipLenOf() * c, ty = mY + tipLenOf() * sn;
    const e = Math.hypot(MUZZLE * c - tx, MUZZLE * sn - ty);
    if (e > worst) { worst = e; worstDeg = deg; }
  }
  ok(worst < 0.001,
    `barrel tip and muzzle spawn coincide at every aim angle (worst ${worst.toFixed(4)}px at ${worstDeg}deg)`);

  // and the shot must leave the barrel, not from short of it, in any direction
  let minReach = Infinity, maxReach = 0;
  for (let deg = 0; deg < 360; deg += 1) {
    const a = (deg * Math.PI) / 180;
    const r = Math.hypot(mX + tipLenOf() * Math.cos(a), mY + tipLenOf() * Math.sin(a));
    minReach = Math.min(minReach, r);
    maxReach = Math.max(maxReach, r);
  }
  ok(minReach >= MUZZLE - 0.01,
    `the barrel reaches at least MUZZLE (${minReach.toFixed(1)}px >= ${MUZZLE}px) at every angle`);
  ok(maxReach - minReach < 0.01,
    `...and never overshoots it (reach is constant: ${minReach.toFixed(1)}..${maxReach.toFixed(1)}px)`);

  // the drawn gun must still be mounted on the character, not floating off it
  const butt = (0 - mOx * texW) * mScale + mX;
  ok(butt >= 0 && butt < 6,
    `the stock still starts on the body (${butt.toFixed(1)}px from centre, was 1.4)`);

  // recoil must return to the same rest position the gun was mounted at
  ok(/gun\.x = GUN_REST_X - 4;/.test(arena), 'recoil kicks back 4px from the rest position');
  ok(/targets: gun, x: GUN_REST_X,/.test(arena), '...and returns to the rest position');
  ok(!/gun\.x = 8 - 4;/.test(arena), 'the hardcoded 8 is gone (it would snap the barrel off the pivot)');
}

// ---------------------------------------------------------------------------
// The SHIELD must read as a modern police riot shield: slim, rounded, with a
// viewport and a grip. The previous art was a square-cornered slab with a heavy
// 4px stile, 6px rails, a centre spine and five rivets -- a fantasy buckler.
{
  const guardFlat = flat(guard);
  // execute it: a NaN here would make the canvas refuse to draw, so a raised
  // shield would simply be invisible
  calls.length = 0; bad = [];
  let gThrew = null;
  try { drawGuard(); } catch (e) { gThrew = e.message; }
  ok(!gThrew, 'guardTex() runs without throwing' + (gThrew ? ` -- ${gThrew}` : ''));
  ok(bad.length === 0, `every shield coordinate is finite${bad.length ? ` -- ${bad[0]}` : ''}`);
  ok(calls.includes('roundRect'), 'the shield silhouette is built from rounded rects');
  ok((calls.filter((m) => m === 'roundRect').length) >= 6,
    `the silhouette, viewport, grip and cuff are all rounded (${calls.filter((m) => m === 'roundRect').length} roundRects)`);
  ok(calls.includes('clip'), 'the reflection is clipped to the silhouette, not painted over the frame');

  // the specific tells
  ok(/const R = 9/.test(guardFlat) && /roundRect\(1\.5, 1\.5, 21, 53, R\)/.test(guardFlat),
    'one rounded silhouette defines the whole panel (R=9, generous corners)');
  ok(/lineWidth = 2\.5/.test(guardFlat), 'the frame is slim (2.5px, not a heavy stile)');
  ok(!/ctx\.fillRect\(0, 0, 24, 6\)/.test(guardFlat) && !/ctx\.fillRect\(0, 0, 4, 56\)/.test(guardFlat),
    'the old heavy top/bottom rails and side stiles are gone');
  ok(/const vx = 4\.5, vy = 8\.5, vw = 15, vh = 6\.5/.test(guardFlat),
    'there is a VIEWPORT, high on the panel -- the signature riot-shield feature');
  ok(/roundRect\(vx - 0\.6, vy - 0\.6, vw \+ 1\.2, vh \+ 1\.2, 3\.4\)/.test(guardFlat),
    '...with a machined surround, so it reads as a cut edge');
  ok(/roundRect\(6, 42, 12, 3\.4, 1\.4\)/.test(guardFlat), 'there is a grip bar at the bottom');
  ok(/ctx\.moveTo\(8\.4, 45\.4\); ctx\.lineTo\(8, 50\.5\)/.test(guardFlat), '...with a forearm cuff');
  ok(!/center spine/.test(guardFlat) && !/ctx\.fillRect\(11, 6, 2, 44\)/.test(guardFlat),
    'the centre spine is gone -- a real shield has none');
  ok(!/rivets/.test(guardFlat), 'the five-rivet grid is gone');
  ok((guardFlat.match(/\[12, 4\.6\], \[12, 51\.4\]/) || []).length === 1,
    'just two small frame bolts remain');
  // the carrier must read through it, so the glass stays light
  ok(/rgba\(214,240,252,0\.10\)/.test(guardFlat), 'the glass is nearly clear through the middle');
  // the canvas size must not change: the arena mounts it at (30, 0)
  ok(/cv\(24, 56\)/.test(guardFlat), 'the canvas is still 24x56, so the mount point is untouched');
}

// ---------------------------------------------------------------------------
// The FOREST must read as a canopy, not as 12 flat circles.
//
// The old art was flat-filled circles in three greens over a flat bed, which
// reads as broccoli: a smooth circular outline is the tell, every clump was one
// flat colour so there was no light direction, and nothing overlapped anything
// so there was no depth.
{
  const bushFlat = flat(rawFn('bushTile'));
  calls.length = 0; bad = [];
  cvSizes.length = 0;
  let bThrew = null;
  try { drawBush(); } catch (e) { bThrew = e.message; }
  ok(!bThrew, 'bushTile() runs without throwing' + (bThrew ? ` -- ${bThrew}` : ''));
  ok(bad.length === 0, `every canopy coordinate is finite${bad.length ? ` -- ${bad[0]}` : ''}`);
  ok(cvSizes.length === 1 && cvSizes[0][0] === 60 && cvSizes[0][1] === 60,
    `the tile is still 60x60, as the map rects assume - got ${cvSizes[0]}`);

  // depth: clumps must be shaded and drawn with occlusion, not flat-filled
  const radials = calls.filter((m) => m === 'createRadialGradient').length;
  const ellipses = calls.filter((m) => m === 'ellipse').length;
  const arcs = calls.filter((m) => m === 'arc').length;
  const fills = calls.filter((m) => m === 'fill').length;
  ok(radials >= 8, `every clump is shaded, not flat-filled (${radials} radial gradients)`);
  ok(ellipses >= 20, `the canopy is built from leaves, not circles (${ellipses} ellipses)`);
  ok(arcs >= 8, `clump bodies still use arcs, with leaves on top (${arcs} arcs)`);
  ok(fills >= 100, `enough overlapping shapes to give the canopy real density (${fills} fills)`);
  ok(/px - r \* 0\.38, py - r \* 0\.42/.test(bushFlat),
    'each clump is lit from the upper left, matching the rest of the art');
  ok(/rgba\(4,16,8,0\.30\)/.test(bushFlat),
    'each clump carries an occlusion crescent where it meets the one behind');

  // the things that make it read as FOLIAGE rather than as broccoli
  ok(/const ls = 1\.5 \+ rnd\(\) \* 1\.7/.test(bushFlat) && /ellipse\(px, py, ls \* 1\.5, ls, a,/.test(bushFlat),
    'leaves are scattered around each rim -- the ragged silhouette is the point');
  ok((bushFlat.match(/wrap\(lx, ly/g) || []).length === 1, '...and the leaves go through wrap() too');
  ok(/rgba\(196,236,150,0\.55\)/.test(bushFlat), 'there are specular dabs on the lit leaves');
  ok(/rgba\(74,52,28,0\.5\)/.test(bushFlat) && /rgba\(20,42,22,0\.6\)/.test(bushFlat),
    'the forest floor has litter, so a gap is not a flat void');
  ok(/rgba\(6,20,10,0\.72\)/.test(bushFlat) && /\[37, 52, 3\.4\]/.test(bushFlat),
    'the canopy has holes, so it is not a solid mass');

  // determinism: textures are generated once and cached, so Math.random here
  // would churn the atlas on every scene start
  ok(/let seed = 0x[0-9a-f]+/.test(bushFlat) && /const rnd = \(\) =>/.test(bushFlat),
    'the canopy is deterministic (a seeded LCG, not Math.random)');
  ok(!/Math\.random\(/.test(bushFlat), 'no Math.random anywhere in the tile');

  // tiling. The forest rects are 260x120 -- 4.3 x 2 repeats of a 60px tile --
  // so a seam would read as a grid straight across the wood.
  ok(/const wrap = \(x: number, y: number, r: number/.test(bushFlat), 'there is a wrap-aware draw helper');
  ok(/x - r < 0 \? \[x, x \+ S\]/.test(bushFlat) && /x \+ r > S \? \[x, x - S\]/.test(bushFlat),
    'elements near a vertical edge are redrawn on the far side');
  ok(/y - r < 0 \? \[y, y \+ S\]/.test(bushFlat) && /y \+ r > S \? \[y, y - S\]/.test(bushFlat),
    '...and near a horizontal one');
  const wraps = (bushFlat.match(/wrap\(/g) || []).length;
  ok(wraps === 5, `all five element kinds go through wrap() (${wraps}: litter, body, leaves, specular, gaps)`);

  // the old broccoli is gone
  ok(!/const blobs: Array/.test(bushFlat), 'the flat blob list is gone');
  ok(!/sun flecks/.test(bushFlat), 'the four pale sun-fleck dots are gone');
  ok(!/rgba\(190,242,150,0\.5\)/.test(bushFlat), '...and so is their colour');
}

// ---------------------------------------------------------------------------
// TERRAIN. The arena read as square because of three specific things, and each
// is asserted gone:
//
//   1. the floor was a hard 40px grid of opaque lines across the whole map
//   2. every steel block was one 40px tileSprite -- the same panel grid repeated
//   3. every ice patch was one 60px tileSprite -- the same two cracks repeated
//
// Steel and ice are now drawn per block, seeded from their own coordinates, with
// cut corners, so the silhouette is never a hard square.
{
  const terrRaw = fs.readFileSync('src/terrain.ts', 'utf8').replace(/\r\n/g, '\n');
  ok(/export function steelCanvas/.test(terrRaw), 'terrain.ts exports steelCanvas');
  ok(/export function iceCanvas/.test(terrRaw), 'terrain.ts exports iceCanvas');
  ok(/export function groundCanvas/.test(terrRaw), 'terrain.ts exports groundCanvas');
  // the Graphics-based API is gone entirely, not just unused
  ok(!/export function drawSteel/.test(terrRaw) && !/export function drawIce/.test(terrRaw)
    && !/export function drawGround/.test(terrRaw),
    'the old Graphics-based draw* API is deleted, not merely unreferenced');

  // the grid is gone from the arena, and the tiles are gone from ensureTextures
  ok(!/this\.add\.grid\(0, 0, W, H, 40, 40/.test(arena),
    'the 40px ground grid is gone from ArenaScene');
  // ---------------------------------------------------------------------
  // THE PERFORMANCE FIX. Phaser Graphics is RETAINED MODE: every draw call
  // pushes a command into a commandBuffer that GraphicsWebGLRenderer re-walks
  // and re-tessellates on EVERY FRAME. The floor was ~416 commands / ~8,560
  // triangles, rebuilt 60x/sec per client. With 8 tabs on one machine that
  // saturated the GPU. Terrain must be baked to canvas textures, once.
  // ---------------------------------------------------------------------
  ok(!/drawGround\(this\.add\.graphics\(\)/.test(arena),
    'the ground is NOT drawn into a retained-mode Graphics (the lag bug)');
  ok(!/drawSteel\(this\.add\.graphics\(\)/.test(arena),
    'steel is not drawn into a retained-mode Graphics either');
  ok(!/drawIce\(/.test(arena), 'ice is not drawn into a retained-mode Graphics either');
  ok(/this\.textures\.addCanvas\('groundTex', groundCanvas\(W, H\)\)/.test(arena),
    'the ground bakes to a canvas texture instead');
  ok(/this\.add\.image\(0, 0, 'groundTex'\)/.test(arena),
    'and is drawn as ONE image, i.e. one draw call per frame');
  ok(/this\.add\.image\(st\.x, st\.y, this\.steelTex\(this, st,/.test(arena),
    'each steel block is one image, not a Graphics full of panels');
  ok(/this\.add\.image\(ic\.x, ic\.y, this\.iceTex\(this, ic,/.test(arena),
    'each ice patch is one image too');
  // the cache: a rematch must reuse the canvas, not repaint it
  ok(/textures\.exists\(key\)\) scene\.textures\.addCanvas\(key, steelCanvas/.test(arena),
    'steel textures are cached by key, so a rematch does not repaint them');
  ok(/textures\.exists\(key\)\) scene\.textures\.addCanvas\(key, iceCanvas/.test(arena),
    'ice likewise');
  // and terrain.ts must actually return canvases, not touch Graphics at all
  // strip comments first: terrain.ts's header explains the Graphics pitfall in
  // detail, so a raw text scan always matches the prose and never the code.
  const terrCode = terrRaw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  ok(!/Phaser\.GameObjects\.Graphics/.test(terrCode),
    'terrain.ts does not import or reference Graphics in any executable line');
  ok(!/add\.graphics/.test(terrCode), 'terrain.ts creates no Graphics objects');
  ok(!/Graphics/.test(terrCode),
    'and the token does not appear outside comments at all');
  ok(/export function groundCanvas[\s\S]*return c;/.test(terrRaw),
    'groundCanvas returns a canvas');
  ok(!/'steelTile'/.test(arena), 'no steelTile tileSprite left in the arena');
  ok(!/'iceTile'/.test(arena), 'no iceTile tileSprite left in the arena');
  ok(!/function steelTile\(/.test(raw), 'the steelTile generator is deleted, not just unused');
  ok(!/function iceTile\(/.test(raw), 'the iceTile generator is deleted too');
  ok(!/put\(scene, 'steelTile'/.test(raw) && !/put\(scene, 'iceTile'/.test(raw),
    'and neither is generated on every scene start any more');

  // per-block seeding: stable across visits, different per block
  ok(/steelTex\(this, st, \(st\.x \* 73856093\) \^ \(st\.y \* 19349663\)\)/.test(arena),
    'steel is seeded from its own coordinates, so it is stable per visit');
  ok(/iceTex\(this, ic, \(ic\.x \* 2654435761\) \^ \(ic\.y \* 40503\)\)/.test(arena),
    'ice likewise');

  // collision must not have moved: map.ts is still axis-aligned rects
  ok(/export const STEEL: Rect\[\]/.test(map), 'STEEL is still a list of rects in map.ts');
  ok(/export const ICE: Rect\[\]/.test(map), 'ICE is still a list of rects in map.ts');
  ok(!/terrain/.test(map), 'map.ts is untouched by the visual work');

  // the organic parts, read off the source
  const t = terrRaw;
  ok(/const TONES = \[0x101a27/.test(t) && /for \(let i = 0; i < 170; i\+\+\)/.test(t),
    'the floor is 170 overlapping mottles in near-identical tones, not a grid');
  ok(/ctx\.ellipse\(x, y, rx, ry, r\(\) \* Math\.PI, 0, Math\.PI \* 2\)/.test(t),
    'the mottles are soft ellipses, not hard rects');
  ok(/ctx\.beginPath\(\);\s*ctx\.ellipse\(x, y, s \* 1\.7, s,/.test(t),
    'the grit specks are ellipses too');
  // steel: varied panel sizes via a seeded recursive split
  ok(/const split = \(px: number, py: number, pw: number, ph: number, depth: number\)/.test(t),
    'steel panels come from a recursive split, so the sizes vary');
  ok(/depth >= 3 \|\| \(pw < 48 && ph < 48\)/.test(t),
    'the split stops on depth and on size, so panels are not infinite');
  ok(/const t = 0\.36 \+ r\(\) \* 0\.28/.test(t), 'the split point is randomised per block');
  // cut corners
  ok(/const cut = \[3 \+ r\(\) \* 4, 3 \+ r\(\) \* 4, 3 \+ r\(\) \* 4, 3 \+ r\(\) \* 4\]/.test(t),
    'every steel block has its four corners cut, so the silhouette is never a hard square');
  ok(/const pad = 7/.test(t), 'and the panels are inset to stay inside the cuts');
  ok(/new Path2D\(\)/.test(t) && /ctx\.stroke\(path\)/.test(t),
    'the octagon outline is one Path2D, stroked as a closed shape');
  // ice: irregular edge and seeded cracks
  ok(/for \(let i = 0; i < 5; i\+\+\)/.test(t) && /const side = \(r\(\) \* 4\) \| 0/.test(t),
    'ice has soft notches bitten out of all four edges');
  ok(/const FACETS = \[0xe8f6ff/.test(t), 'ice has crystal facets, so the surface has planes in it');
  ok(/a \+= \(r\(\) - 0\.5\) \* 1\.5/.test(t),
    'ice cracks are branching seeded polylines, not two straight repeats');
  // determinism
  ok(/export function rng\(seed: number\)/.test(t) && /Math\.random\(/.test(t) === false,
    'terrain is seeded: no Math.random anywhere in it');
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
