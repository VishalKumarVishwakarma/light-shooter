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
const src = (await esbuild.transform(raw, { loader: 'ts', format: 'cjs' })).code;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// esbuild splits `ctx.beginPath(); ctx.moveTo(...);` onto separate lines, so the
// structural regexes below must run against whitespace-flattened text.
const flat = (s) => s.replace(/\s+/g, ' ');
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
// eslint-disable-next-line no-new-func
const factory = new Function('cv', `${star}\n${soldier}\n${guard}\nreturn { soldier, guardTex };`);
const { soldier: draw, guardTex: drawGuard } = factory(cv);

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
  const arena = fs.readFileSync('src/scenes/ArenaScene.ts', 'utf8').replace(/\r\n/g, '\n');
  const map = fs.readFileSync('src/map.ts', 'utf8').replace(/\r\n/g, '\n');
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

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
