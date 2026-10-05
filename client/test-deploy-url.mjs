// The deploy URL must actually reach the deployed bundle.
//
// This is here because VITE_SERVER_URL was broken for the entire life of serverUrl.ts and
// nothing caught it. The code read:
//
//     const env = (import.meta as any)?.env?.VITE_SERVER_URL;
//
// Vite inlines env vars by STATIC TEXT REPLACEMENT of the exact expression
// `import.meta.env.VITE_X`. The cast and the optional chaining mean that text never
// appears, so Vite had nothing to substitute: the expression survived into the bundle,
// evaluated to undefined at runtime, and base() always fell through to localhost:2567.
//
// The failure mode is nasty. The deployed game loads, renders, animates and looks
// completely correct -- and connects to nothing but the player's own machine. There is no
// error, just silence, which reads as a hosting problem rather than a build problem.
//
// So this suite does both halves:
//   * a fast static check on the source shape, which is what actually regressed
//   * a real build with a sentinel value, grepped out of the emitted bundle
//
// The build is slow (~25s) because inlining can only be proven by inlining.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const url = fs.readFileSync(path.join(HERE, 'src/net/serverUrl.ts'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// --- the fast check: the exact shape Vite can substitute -----------------
ok(/const env: string \| undefined = import\.meta\.env\.VITE_SERVER_URL;/.test(url),
  'VITE_SERVER_URL is read in the exact form Vite statically replaces');
ok(!/\(import\.meta as any\)\?\.env\?\.VITE_SERVER_URL/.test(url),
  'no cast-plus-optional-chaining on the env read (that is what silently broke it)');
ok(!/import\.meta\.env\?\./.test(url),
  'no optional chaining anywhere in the import.meta.env chain');
ok(/if \(env\) return String\(env\)/.test(url),
  'and the value is still used, so an empty env falls through rather than returning ""');

// the localhost fallback must remain, or local dev stops working
ok(/return 'http:\/\/localhost:2567';/.test(url),
  'the localhost fallback is intact for local development');

// the ?server= override must still take priority -- it is what allows testing a server
// change against a deployed client without rebuilding
{
  ok(/get\('server'\)/.test(url), 'the ?server= query override still exists');
  // compare the RETURNS that decide the value, not the first mention of the name --
  // the file's header comment talks about VITE_SERVER_URL before any code runs, so an
  // indexOf comparison measured the prose instead of the logic
  const iQueryReturn = url.indexOf('return q.replace');
  const iEnvReturn = url.indexOf('if (env) return String(env)');
  ok(iQueryReturn >= 0 && iEnvReturn > iQueryReturn,
    `and ?server= returns FIRST, so it overrides the build-time value `
    + `(query at ${iQueryReturn}, env at ${iEnvReturn})`);
  ok(/searchParams\.delete\('server'\)/.test(url),
    'the override is stripped from the address bar but ?room= is kept');
}

// ws/wss must be derived from the same base, not hardcoded
ok(/SERVER_WS = SERVER_HTTP\.replace\(\/\^http\/, 'ws'\)/.test(url),
  'the WebSocket URL is derived from the same base (http->ws, https->wss)');

// the ambient types must exist, or `import.meta.env.VITE_X` will not typecheck
ok(fs.existsSync(path.join(HERE, 'src/vite-env.d.ts')),
  'src/vite-env.d.ts exists so the canonical form typechecks');

// --- the slow check that actually proves inlining ------------------------
const SENTINEL = 'https://deploy-check.invalid';
console.log('\n  building the client with VITE_SERVER_URL set (this takes ~25s)...');
let built = true;
try {
  // shell: true is required on Windows -- a .cmd cannot be spawned directly and
  // execFileSync fails with EINVAL without it
  execFileSync('npm.cmd', ['run', 'build'], {
    cwd: HERE, stdio: 'pipe', encoding: 'utf-8', shell: true,
    env: { ...process.env, VITE_SERVER_URL: SENTINEL },
  });
} catch (e) {
  built = false;
  console.log('     build failed:', String(e.stdout || e.message).split('\n').slice(-3).join('\n'));
}
ok(built, 'client builds with VITE_SERVER_URL set');

if (built) {
  const assets = path.join(HERE, 'dist', 'assets');
  const files = fs.existsSync(assets) ? fs.readdirSync(assets).filter((f) => f.endsWith('.js')) : [];
  const all = files.map((f) => fs.readFileSync(path.join(assets, f), 'utf8')).join('\n');
  ok(files.length > 0, `emitted ${files.length} JS chunks`);
  ok(all.includes(SENTINEL),
    'the value IS baked into the bundle (this is the assertion that would have caught it)');
  ok(!all.includes('localhost:2567'),
    'and the localhost fallback is GONE -- otherwise it could win at runtime');
}

// --- the deploy docs must not promise something untrue -------------------
const netlify = fs.existsSync(path.join(HERE, '..', 'netlify.toml'))
  ? fs.readFileSync(path.join(HERE, '..', 'netlify.toml'), 'utf8') : '';
ok(/VITE_SERVER_URL/.test(netlify), 'netlify.toml documents the required variable');
ok(/http:\/\/localhost:2567/.test(netlify) || /falls back to http:\/\/localhost:2567/.test(netlify),
  'and warns that leaving it unset falls back to localhost');
ok(html.includes('id="game"'), 'the page still mounts the game canvas');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);