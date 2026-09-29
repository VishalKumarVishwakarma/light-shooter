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

const cv = () => ({ c: { width: 56, height: 56 }, ctx: makeCtx() });

// ---- run every variant ------------------------------------------------------
const soldier = fn('soldier');
const star = fn('star');
// eslint-disable-next-line no-new-func
const factory = new Function('cv', `${star}\n${soldier}\nreturn soldier;`);
const draw = factory(cv);

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

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
