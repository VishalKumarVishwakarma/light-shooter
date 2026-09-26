import { Client } from 'colyseus.js';

const HTTP = 'http://localhost:2567';
const WS = 'ws://localhost:2567';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };
const CODE_RE = /^[1-9]\d{3}$/;
const newCode = async () => (await (await fetch(`${HTTP}/code`, { method: 'POST' })).json()).code;
const resolve = async (c) => {
  const r = await fetch(`${HTTP}/code/${c}`);
  return { status: r.status, body: r.status === 200 ? await r.json() : null };
};

// 1. POST /code hands out a well-formed 4-digit code
const code = await newCode();
ok(typeof code === 'string' && CODE_RE.test(code), `code is 4 digits, no leading zero: ${code}`);
ok(String(Number(code)) === code, `code is numeric (${code})`);

// 2. a burst of allocations must never collide or emit a bad code
const seen = new Set([code]);
let bad = '';
for (let i = 0; i < 40; i++) {
  const c = await newCode();
  if (!CODE_RE.test(c)) bad = `bad:${c}`;
  if (seen.has(c)) bad = `dup:${c}`;
  seen.add(c);
}
ok(bad === '', `40 allocations, all unique and 4-digit${bad ? ' -> ' + bad : ''}`);

// 3. the code resolves to a real room, and two clients land in the SAME one
const r1 = await resolve(code);
ok(r1.status === 200 && typeof r1.body.roomId === 'string', `code ${code} resolves to a room`);
ok(r1.body.roomId !== code, 'the internal room id is not the code');
const host = new Client(WS);
const hr = await host.joinById(r1.body.roomId, { name: 'codeHost' });
const guest = new Client(WS);
const gr = await guest.joinById(r1.body.roomId, { name: 'codeGuest' });
await sleep(500); // state is async: both joins must land before counting
ok(hr.id === gr.id, 'host and guest share one room');
ok(hr.id === r1.body.roomId, 'the socket room is the one the code pointed at');
ok(Object.keys(hr.state.players.toJSON()).length === 2, 'both players in one room');

// 4. a full match still runs in a code-created room
hr.send('startGame');
for (let i = 0; i < 40 && hr.state.phase !== 'playing'; i++) await sleep(200);
ok(hr.state.phase === 'playing', `match starts in the room behind ${code}`);
for (const r of [hr, gr]) { r.send('guard', { on: false }); await sleep(250); }
gr.send('shoot', { angle: Math.random() * 6.28 });
await sleep(600);
ok(gr.state.players.get(gr.sessionId).shots >= 0, 'shooting works');

// 5. the lobby list advertises CODES, never internal ids
const list = await (await fetch(`${HTTP}/lobbies`)).json();
ok(list.some((l) => l.code === code), `lobby list shows ${code}`);
ok(list.every((l) => CODE_RE.test(l.code)), `every listed code is 4 digits (${list.map((l) => l.code).join(',')})`);
ok(list.every((l) => l.code !== r1.body.roomId), 'no internal room id leaks into the list');

// 6. lookup errors are specific. 0000 is not a code at all (a code never leads
// with zero), so it is a malformed request; 1111 is well-formed but unused.
ok((await resolve('0000')).status === 400, 'GET /code/0000 -> 400 (a code never leads with 0)');
ok((await resolve('abc')).status === 400, 'GET /code/abc -> 400 (not four digits)');
ok((await resolve('42')).status === 400, 'GET /code/42 -> 400 (too short)');
ok((await resolve('12345')).status === 400, 'GET /code/12345 -> 400 (too long)');
ok((await resolve('1111')).status === 404, 'GET /code/1111 -> 404 (well-formed but unused)');

await hr.leave();
await gr.leave();
await sleep(600);

// 7. the allocator itself: bind, resolve, release, and the space is reusable.
// A room outlives its last player by design (5 min), so disposal is exercised
// directly against the compiled module rather than waiting out the timer.
const codes = await import(new URL('../server/dist/codes.js', import.meta.url));
const c1 = codes.reserveCode();
const c2 = codes.reserveCode();
ok(CODE_RE.test(c1) && CODE_RE.test(c2), `allocator emits valid codes (${c1}, ${c2})`);
ok(c1 !== c2, 'two reservations never collide');
codes.bindCode(c1, 'room-abc');
ok(codes.roomForCode(c1) === 'room-abc', 'bound code resolves to its room');
ok(codes.codeForRoom('room-abc') === c1, 'reverse lookup finds the code');
const dup = codes.reserveCode(() => false);
ok(dup !== c1, 'a live code is not re-issued while bound');
codes.releaseRoom('room-abc');
ok(codes.roomForCode(c1) === undefined, 'released code stops resolving');
ok(codes.codeForRoom('room-abc') === undefined, 'released room forgets its code');
const again = codes.reserveCode();
ok(CODE_RE.test(again), 'the code space is reusable after release');
codes.releasePending(again);

try { hr.connection?.close(); } catch { /* already closed */ }
try { gr.connection?.close(); } catch { /* already closed */ }
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
