// Reproduces the rematch flow headless: play -> ended -> rematch -> lobby -> playing.
import { Client } from 'colyseus.js';
const URL = 'ws://localhost:2567';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

const c1 = new Client(URL);
const r1 = await c1.create('shooter', { name: 'remA', killTarget: 1, shieldSeconds: 0 });
const c2 = new Client(URL);
const r2 = await c2.joinById(r1.id, { name: 'remB' });
await sleep(400);
r1.send('startGame');
for (let i = 0; i < 40 && r1.state.phase !== 'playing'; i++) await sleep(250);
ok(r1.state.phase === 'playing', 'match goes live');

// both to gun mode, then host guns the guest down (killTarget 1 ends it)
const lower = async (r) => {
  if (r.state.players.get(r.sessionId).guard) { r.send('guard', {}); await sleep(250); }
};
await lower(r1); await lower(r2);
let stateChanges = 0;
r1.state.onChange(() => { stateChanges++; });
for (let i = 0; i < 60; i++) {
  const a = r1.state.players.get(r1.sessionId).toJSON();
  const b = r2.state.players.get(r2.sessionId).toJSON();
  if (r1.state.phase !== 'playing') break;
  if (b.guard) { r2.send('guard', {}); await sleep(250); continue; }
  if (Math.hypot(b.x - a.x, b.y - a.y) > 120) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    r1.send('move', { dx: dx / d, dy: dy / d, angle: Math.atan2(dy, dx) });
  } else {
    r1.send('move', { dx: 0, dy: 0, angle: 0 });
    r1.send('shoot', { angle: Math.atan2(b.y - a.y, b.x - a.x) });
  }
  await sleep(250);
}
ok(r1.state.phase === 'ended', `kill target ends match (phase=${r1.state.phase})`);
ok(r1.state.winnerName === 'remA', `winner recorded (${r1.state.winnerName})`);
console.log(`state.onChange fired during play: ${stateChanges}x`);

// REMATCH (host) -> lobby
r1.send('rematch');
await sleep(800);
ok(r1.state.phase === 'lobby', `rematch returns to lobby (phase=${r1.state.phase})`);
const p1 = r1.state.players.get(r1.sessionId).toJSON();
ok(p1.ready === false, 'ready flags reset');
console.log(`state.onChange fired total: ${stateChanges}x`);

// guest rematch ignored, then host starts again -> playing
r2.send('rematch');
await sleep(400);
ok(r1.state.phase === 'lobby', 'guest rematch is a no-op');
r1.send('startGame');
let live = false;
for (let i = 0; i < 40 && !live; i++) { await sleep(250); live = r1.state.phase === 'playing'; }
ok(live, 'second match goes live after rematch');
const q1 = r1.state.players.get(r1.sessionId).toJSON();
ok(q1.alive && q1.hp === 100 && q1.kills === 0 && q1.guard === true, 'fresh fighter state (alive/hp/kills/guard)');

await r1.leave(); await r2.leave();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
