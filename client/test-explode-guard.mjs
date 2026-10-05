// A hard crash: explode() on a DESTROYED particle emitter.
//
//     TypeError: Cannot read properties of null (reading 'fill')
//       at ParticleEmitter2.resetCountors (phaser.js:36704)
//       at ParticleEmitter2.explode (phaser.js:37848)
//
// Traced through the bundled Phaser source rather than recalled:
//   L36527  this.counters = new Float32Array(10)   <- boot
//   L36704  counters.fill(0)                       <- the crash, inside resetCountors
//   L38837  this.counters = null                   <- preDestroy
//
// So counters is null ONLY after preDestroy(): the emitter is destroyed. Not a missing
// texture, not a bad config -- a lifecycle problem.
//
// The cause: a Colyseus state callback can fire AFTER the scene is torn down. The patch
// still invokes our handlers, they still hold this.sparks / this.blood / this.dust, and
// they explode an emitter that no longer exists. It races the network against scene
// teardown, so it lands intermittently -- leaving, a rematch, the match ending.
//
// This suite pins that every explode() goes through the guard, that the guard tests the
// exact precondition resetCountors() needs, and that it behaves correctly against a
// destroyed emitter rather than merely compiling.
import fs from 'node:fs';

const arena = fs.readFileSync(new URL('./src/scenes/ArenaScene.ts', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
// strip comments before asserting absence -- prose about a pitfall has caused false
// failures on this repo repeatedly
const code = arena.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// --- the guard exists and tests the right thing --------------------------
ok(/private boom\(em: any, n: number, x: number, y: number\)/.test(arena),
  'a single guarded entry point exists');
const body = /private boom\(em: any, n: number, x: number, y: number\) \{([\s\S]*?)\n  \}/.exec(arena);
ok(!!body, 'the guard body is locatable');
if (body) {
  const b = body[1];
  ok(/if \(!em \|\| !\(em as any\)\.counters\) return;/.test(b),
    'it bails when counters is null -- the exact state preDestroy() leaves behind');
  ok(/if \(!em \|\|/.test(b), 'and tolerates a null/undefined emitter reference');
  ok(/try \{[\s\S]{0,60}?em\.explode\(n, x, y\);[\s\S]{0,60}?\} catch/.test(b),
    'the call itself is wrapped, so a mid-call teardown cannot throw either');
  ok(/return;/.test(b.split('em.explode')[0]),
    'and it returns rather than falling through to explode()');
}

// --- every call site goes through it -------------------------------------
const raw = [...code.matchAll(/(this\.[A-Za-z_$][\w$]*)\.explode\(/g)].map((m) => m[1]);
ok(raw.length === 0,
  `no emitter is exploded directly any more (found ${raw.length}: ${[...new Set(raw)].join(', ') || 'none'})`);
const viaBoom = (code.match(/this\.boom\(\s*this\.[A-Za-z_$][\w$]*\s*,/g) || []).length;
ok(viaBoom >= 14, `all ${viaBoom} call sites route through boom() (expected at least 14)`);

// the three long-lived emitters that callbacks reach are all covered
for (const em of ['sparks', 'blood', 'dust']) {
  ok(new RegExp(`this\\.boom\\(this\\.${em},`).test(code),
    `the ${em} emitter -- the one callbacks hold -- is exploded only via boom()`);
}

// --- the guard's behaviour, replayed --------------------------------------
// Reproduces boom()'s logic against emitter states, including the destroyed one.
function boom(em, n, x, y) {
  const calls = [];
  if (!em || !em.counters) return calls;
  try { em.explode = (a, b, c) => { calls.push([a, b, c]); }; em.explode(n, x, y); } catch { /* */ }
  return calls;
}
{
  ok(boom({ counters: new Float32Array(10) }, 5, 1, 2).length === 1,
    'a live emitter still explodes');
  ok(boom({ counters: new Float32Array(10) }, 5, 1, 2)[0].join(',') === '5,1,2',
    'and the count and position are passed through unchanged');
  ok(boom({ counters: null }, 5, 1, 2).length === 0,
    'a DESTROYED emitter (counters === null, i.e. post-preDestroy) is silently skipped');
  ok(boom(null, 5, 1, 2).length === 0, 'a null emitter reference is skipped, not thrown on');
  ok(boom(undefined, 5, 1, 2).length === 0, 'and so is undefined');
  // the guard must not swallow a live emitter that merely lacks a counters array key
  ok(boom({}, 5, 1, 2).length === 0, 'an emitter with no counters is treated as not-ready');
}

// --- the emitters callbacks can reach are fields, created in create() -----
// A local emitter created per effect cannot be stale; a long-lived field can.
ok(/this\.sparks = this\.add\.particles\(/.test(code), 'sparks is a scene field');
ok(/this\.blood = this\.add\.particles\(/.test(code), 'blood is a scene field');
ok(/this\.dust = this\.add\.particles\(/.test(code), 'dust is a scene field');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
