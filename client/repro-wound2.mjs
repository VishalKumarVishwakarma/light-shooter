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
// grab rifle from spawn
for (let i = 0; i < 10; i++) {
  const p = u1r.state.players.get(u1r.sessionId).toJSON();
  if (p.x > 370) break;
  u1r.send('move', { dx: 1, dy: 0, angle: 0 });
  await sleep(200);
}
u1r.send('move', { dx: 0, dy: 0, angle: 0 });
u1r.send('interact', {});
await sleep(400);
console.log('armed:', u1r.state.players.get(u1r.sessionId).weapon,
  u1r.state.players.get(u1r.sessionId).ammo);
// formation: guest west to ~1030, host east/dip/east to ~980,410
for (let i = 0; i < 15; i++) {
  const gp = u2r.state.players.get(u2r.sessionId).toJSON();
  if (gp.x < 1030) break;
  u2r.send('move', { dx: -1, dy: 0, angle: Math.PI });
  await sleep(200);
}
u2r.send('move', { dx: 0, dy: 0, angle: Math.PI });
let ux = u1r.state.players.get(u1r.sessionId).toJSON().x, px = ux, st = 0;
for (let i = 0; i < 20 && ux < 540 && st < 3; i++) {
  u1r.send('move', { dx: 1, dy: 0, angle: 0 });
  await sleep(200);
  ux = u1r.state.players.get(u1r.sessionId).toJSON().x;
  st = Math.abs(ux - px) < 3 ? st + 1 : 0;
  px = ux;
}
for (let i = 0; i < 12; i++) {
  const h = u1r.state.players.get(u1r.sessionId).toJSON();
  if (h.y > 400) break;
  u1r.send('move', { dx: 0, dy: 1, angle: Math.PI / 2 });
  await sleep(200);
}
for (let i = 0; i < 20; i++) {
  const h = u1r.state.players.get(u1r.sessionId).toJSON();
  if (h.x > 980) break;
  u1r.send('move', { dx: 1, dy: 0, angle: 0 });
  await sleep(200);
}
u1r.send('move', { dx: 0, dy: 0, angle: 0 });
await sleep(600);
const a = u1r.state.players.get(u1r.sessionId).toJSON();
const b = u2r.state.players.get(u2r.sessionId).toJSON();
console.log('host:', a.x.toFixed(0), a.y.toFixed(0), a.weapon, 'ammo', a.ammo, 'rel', a.reloading);
console.log('guest:', b.x.toFixed(0), b.y.toFixed(0), 'hp', b.hp);
const ang = Math.atan2(b.y - a.y, b.x - a.x);
console.log('angle:', ang.toFixed(3));
let hits = 0;
u1r.onMessage('hit', (m) => { hits++; console.log('HIT dmg=', m.dmg); });
u1r.send('shoot', { angle: ang });
await sleep(700);
console.log('guest hp now:', u2r.state.players.get(u2r.sessionId).toJSON().hp, 'hits:', hits);
await u1r.leave(); await u2r.leave();
process.exit(0);
