// Requires a local server on :2567. Exercises eight real sockets under movement
// and combat traffic, then rematches and checks the connections still respond.
import assert from 'node:assert/strict';
import { Client } from 'colyseus.js';
import { performance } from 'node:perf_hooks';

const url = process.env.TEST_SERVER_WS || 'ws://127.0.0.1:2567';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rooms = [], errors = [], samples = [], pending = new Map();
let probe = 0;
async function waitPhase(phase) {
  const until = performance.now() + 10000;
  while (performance.now() < until) {
    if (rooms.every(r => r.state.phase === phase)) return;
    await sleep(50);
  }
  assert.fail(`all eight clients did not reach ${phase}`);
}
try {
  rooms.push(await new Client(url).create('shooter', { name: 'ping0', matchSeconds: 6 }));
  for (let i = 1; i < 8; i++) rooms.push(await new Client(url).joinById(rooms[0].id, { name: `ping${i}` }));
  rooms.forEach(room => {
    room.onMessage('*', () => {});
    room.onMessage('pong', ({ t }) => {
      const sent = pending.get(t);
      if (sent !== undefined) { samples.push(performance.now() - sent); pending.delete(t); }
    });
    room.onError((code, message) => errors.push({ code, message }));
  });
  await sleep(200);
  for (let round = 0; round < 2; round++) {
    rooms[0].send('startGame');
    await waitPhase('playing');
    assert.ok(rooms.every(r => r.state.players.size === 8));
    rooms.forEach(r => { r.send('guard', { on: false }); r.send('throw', { kind: 'smoke', angle: 0 }); });
    for (let tick = 0; tick < 120; tick++) {
      rooms.forEach((r, i) => {
        const angle = tick / 12 + i;
        r.send('move', { dx: Math.cos(angle), dy: Math.sin(angle), angle });
        if (tick % 9 === 0) r.send('shoot', { angle });
        if (tick % 15 === 0) { const t = ++probe; pending.set(t, performance.now()); r.send('ping', { t }); }
      });
      await sleep(1000 / 30);
    }
    await waitPhase('ended');
    if (round === 0) { rooms[0].send('rematch'); await waitPhase('lobby'); }
  }
  await sleep(200);
  assert.deepEqual(errors, [], 'no room errors during multiplayer/rematch');
  assert.equal(pending.size, 0, 'every ping must get a reply');
  assert.equal(samples.length, probe);
  rooms.forEach(r => r.state.players.forEach(p => {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.hp));
  }));
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ players: 8, rounds: 2, probes: probe,
    medianMs: +samples[Math.floor(samples.length / 2)].toFixed(1),
    p95Ms: +samples[Math.floor(samples.length * .95)].toFixed(1),
    maxMs: +samples.at(-1).toFixed(1), errors }, null, 2));
  console.log('PASS: eight clients, combat traffic, complete ping replies, and rematch');
} finally {
  await Promise.allSettled(rooms.map(r => Promise.race([r.leave(), sleep(2000)])));
  rooms.forEach(r => r.connection?.close());
}
