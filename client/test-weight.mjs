// Weight audit: what the browser must download to reach the MENU, what is
// deferred, and where the remaining bytes actually live.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dist = path.join('dist', 'assets');
const files = fs.readdirSync(dist).filter((f) => f.endsWith('.js'));
const size = (f) => {
  const b = fs.readFileSync(path.join(dist, f));
  return { raw: b.length, gz: zlib.gzipSync(b, { level: 9 }).length };
};

const rows = files.map((f) => ({ f, ...size(f) })).sort((a, b) => b.gz - a.gz);
const html = fs.readFileSync(path.join('dist', 'index.html'));

console.log('CHUNKS');
for (const r of rows) {
  console.log(`  ${r.f.padEnd(28)} ${String(Math.round(r.raw / 1024)).padStart(6)} KB raw  ${String((r.gz / 1024).toFixed(1)).padStart(7)} KB gzip`);
}
const total = rows.reduce((a, r) => a + r.gz, 0) + zlib.gzipSync(html, { level: 9 }).length;
console.log(`  ${'TOTAL'.padEnd(28)} ${' '.repeat(6)}      ${(total / 1024).toFixed(1).padStart(7)} KB gzip`);

// the entry chunk is what blocks the first paint: entry + engine + net
const entry = rows.find((r) => r.f.startsWith('index-'));
const engine = rows.find((r) => r.f.startsWith('phaser-'));
const net = rows.find((r) => r.f.startsWith('net-'));
const deferred = rows.filter((r) => !r.f.startsWith('index-') && !r.f.startsWith('phaser-') && !r.f.startsWith('net-'));
const first = (entry?.gz || 0) + (engine?.gz || 0) + (net?.gz || 0) + zlib.gzipSync(html, { level: 9 }).length;

console.log('\nFIRST PAINT (menu)');
console.log(`  html + app + engine + net = ${(first / 1024).toFixed(1)} KB gzip`);
console.log('\nDEFERRED (fetched during the lobby, before any match can start)');
for (const d of deferred) console.log(`  ${d.f.padEnd(28)} ${(d.gz / 1024).toFixed(1)} KB gzip`);

// prove the split: arena-only strings must NOT be in the entry chunk
const entryText = fs.readFileSync(path.join(dist, entry.f), 'utf8');
const arenaOnly = ['RIOT SHIELD', 'ELECTRIC LOCK', 'BOTTOM DASHBOARD', 'arcStream', 'zapAura'];
const leaked = arenaOnly.filter((s) => entryText.includes(s));
console.log('\nSPLIT INTEGRITY');
console.log(`  arena code present in the entry chunk: ${leaked.length ? leaked.join(', ') : 'none'}`);
const qr = rows.find((r) => r.f.startsWith('qrcode-'));
// Prove the encoder is NOT inlined by finding a string that exists only in the
// encoder's own implementation. (Grepping for "isDark" would be a false alarm:
// that is our call site in LobbyScene, not the library.)
let qrVerdict = 'qr chunk missing';
if (qr) {
  const qrText = fs.readFileSync(path.join(dist, qr.f), 'utf8');
  const cands = [...qrText.matchAll(/"([A-Za-z][A-Za-z0-9 _/.,-]{12,})"/g)].map((m) => m[1]);
  const only = cands.filter((c) => !entryText.includes(c));
  qrVerdict = only.length
    ? `separate module (encoder-only string "${only[0].slice(0, 28)}" absent from entry)`
    : 'could not find a distinguishing string';
}
console.log(`  qr encoder: ${qrVerdict}`);
console.log(`  entry chunk has a dynamic import: ${/import\(/.test(entryText) || /\.\w+\.js/.test(entryText) ? 'yes' : 'NO'}`);

const engineShare = ((engine?.gz || 0) / total) * 100;
console.log(`\nENGINE SHARE`);
console.log(`  phaser = ${(engine?.gz || 0) / 1024} KB gzip = ${engineShare.toFixed(0)}% of everything we ship`);
console.log(`  our own code (app + arena + qr) = ${(((entry?.gz || 0) + deferred.reduce((a, d) => a + d.gz, 0) - (net?.gz || 0)) / 1024).toFixed(1)} KB gzip`);
process.exit(leaked.length ? 1 : 0);
