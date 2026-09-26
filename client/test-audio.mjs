// Stubbed runtime check for the PUBG gunfire dispatcher (no real audio).
// The SFX module is TypeScript, so transpile it to a sibling .mjs stub first
// (keeps the suite runnable with a bare `node test-audio.mjs`).
import fs from 'node:fs';
import ts from 'typescript';
const stubPath = new URL('./test-audio.stub.mjs', import.meta.url);
fs.writeFileSync(stubPath, ts.transpileModule(
  fs.readFileSync(new URL('./src/audio.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } },
).outputText);
const calls = [];
const mkParam = (v) => ({ value: v, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
function mkNode() {
  return { connect() { return mkNode(); }, start() {}, stop() {}, frequency: mkParam(0), gain: mkParam(0), buffer: null, type: '' };
}
const fakeCtx = {
  currentTime: 0, sampleRate: 44100, state: 'running',
  createOscillator: () => { calls.push(['osc']); return mkNode(); },
  createGain: () => mkNode(),
  createBuffer: (_c, len) => ({ getChannelData: () => new Float32Array(len) }),
  createBufferSource: () => { calls.push(['src']); return mkNode(); },
  createBiquadFilter: () => { calls.push(['flt']); return { ...mkNode(), frequency: mkParam(0) }; },
  resume() {},
  destination: {},
};
globalThis.window = { AudioContext: function () { return fakeCtx; } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { sfx } = await import(stubPath.href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// each gun layers a distinct node count (crack+body+thump+clack+echoes differ)
for (const w of ['pistol', 'rifle', 'shotgun', 'sniper', 'laser', 'electric']) {
  calls.length = 0;
  sfx.shoot(w, 1);
  ok(calls.length > 4, `${w} layers sound (nodes=${calls.length})`);
}
const counts = {};
for (const w of ['pistol', 'rifle', 'shotgun', 'sniper', 'laser', 'electric']) {
  calls.length = 0;
  sfx.shoot(w, 1);
  counts[w] = calls.length;
}
ok(new Set(Object.values(counts)).size >= 3, `guns differ: ${JSON.stringify(counts)}`);
ok(counts.electric !== counts.laser, `electric is its own voice (${counts.electric} vs laser ${counts.laser})`);

// sniper echo tail schedules delayed nodes (delay > 0.1)
calls.length = 0;
sfx.shoot('sniper', 1);
ok(calls.length >= counts.pistol + 2, 'sniper carries echo tail');

// gain 0 = silent, no nodes
calls.length = 0;
sfx.shoot('rifle', 0);
ok(calls.length === 0, 'gain 0 stays silent');

// unknown weapon falls back to pistol
calls.length = 0;
sfx.shoot('plasma', 1);
ok(calls.length === counts.pistol, 'unknown gun falls back to pistol');

// melee + empty + reload don't throw
sfx.melee(); sfx.empty(); sfx.reload(); sfx.hit(); sfx.death(); sfx.pickup(); sfx.zap(1);
ok(true, 'melee/empty/reload/hit/death/pickup/zap run clean');

// the electric lock impact is a separate voice from the gunshot
calls.length = 0;
sfx.zap(1);
ok(calls.length > 0, `zap impact sounds (nodes=${calls.length})`);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
