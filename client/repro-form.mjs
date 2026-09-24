import { Client } from 'colyseus.js';
const URL = 'ws://localhost:2567';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const u1 = new Client(URL);
const u1r = await u1.create('shooter', { name: 'gun1', pickupSeconds: 2, reloadSeconds: 1 });
const u2 = new Client(URL);
const u2r = await u2.joinById(u1r.id, { name: 'gun2' });
await sleep(400);
u1r.send('startGame');
for (let i = 0; i < 45 && u1r.state.phase !== 'playing'; i++) await sleep(200);
// replicate: rate test + locked + pistol drain + reload + switch (positions!)
for (let i = 0; i < 8; i++) u1r.send('shoot', { angle: 0 });
await sleep(300);
u1r.send('switch', { weapon: 'rifle' });
await sleep(300);
for (let i = 0; i < 3; i++) { u1r.send('shoot', { angle: Math.PI }); await sleep(350); }
u1r.send('reload', {});
await sleep(1600);
const P = (r, id) => { const p = r.state.players.get(id).toJSON(); return `(${p.x.toFixed(0)},${p.y.toFixed(0)})`; };
console.log('pre-formation h:', P(u1r, u1r.sessionId), 'g:', P(u2r, u2r.sessionId));
// formation (copy of suite legs)
for (let i = 0; i < 20; i++) {
  const a = u1r.state.players.get(u1r.sessionId).toJSON();
  const b = u2r.state.players.get(u2r.sessionId).toJSON();
  if (Math.hypot(b.x - a.x, b.y - a.y) < 450) break;
  u1r.send('move', { dx: 1, dy: 0, angle: 0 });
  u2r.send('move', { dx: -1, dy: 0, angle: Math.PI });
  await sleep(200);
  if (i % 5 === 0) console.log(`leg ${i}: h=${P(u1r, u1r.sessionId)} g=${P(u2r, u2r.sessionId)}`);
}
u1r.send('move', { dx: 0, dy: 0, angle: 0 });
u2r.send('move', { dx: 0, dy: 0, angle: Math.PI });
await sleep(500);
console.log('final h:', P(u1r, u1r.sessionId), 'g:', P(u2r, u2r.sessionId));
await u1r.leave(); await u2r.leave();
process.exit(0);
