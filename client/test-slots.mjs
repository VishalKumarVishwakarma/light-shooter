import { Client } from 'colyseus.js';

const URL = 'ws://localhost:2567';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// The server contract the new slot model depends on. The UI is client-side,
// but these are the guarantees it leans on — if they hold, every slot works.
const c1 = new Client(URL);
const r1 = await c1.create('shooter', { name: 'slotA', killTarget: 30, shieldSeconds: 0 });
const c2 = new Client(URL);
const r2 = await c2.joinById(r1.id, { name: 'slotB' });
await sleep(400);
r1.send('startGame');
for (let i = 0; i < 40 && r1.state.phase !== 'playing'; i++) await sleep(200);
ok(r1.state.phase === 'playing', 'match live');
const me = () => r1.state.players.get(r1.sessionId).toJSON();
const foe = () => r2.state.players.get(r2.sessionId).toJSON();
for (const r of [r1, r2]) { r.send('guard', {}); await sleep(200); }

// 1. every throwable is reachable as a switchable item, and fires from one press
for (const [kind, key, label] of [['grenade', 'grenades', 'G'], ['smoke', 'smokes', 'C'], ['molly', 'mollies', 'X']]) {
  const before = me()[key];
  r1.send('throw', { kind, angle: 0 });
  await sleep(400);
  ok(me()[key] === before - 1, `${label} slot throws: ${key} ${before} -> ${me()[key]}`);
  await sleep(1400); // let the throw land/expire before the next
}

// 2. throwables are refused while the shield stance is up (stance is a slot too)
r1.send('guard', { on: true });
await sleep(300);
const gBefore = me().grenades;
r1.send('throw', { kind: 'grenade', angle: 0 });
await sleep(400);
ok(me().grenades === gBefore, 'shielded slot blocks throwing (stance has priority)');
r1.send('guard', { on: false });
await sleep(300);

// 3. the shield slot is a real toggle: raise, then lower, no gun involved
r1.send('guard', { on: true });
await sleep(300);
ok(me().guard === true, 'shield slot raises the stance');
r1.send('guard', {});
await sleep(300);
ok(me().guard === false, 'shield slot toggles the stance back down');

// 4. drawing any gun holsters the shield (switching away from the shield slot)
r1.send('guard', { on: true });
await sleep(300);
r1.send('switch', { weapon: 'pistol' });
await sleep(300);
ok(me().guard === false && me().weapon === 'pistol', 'selecting a gun slot holsters the shield');

// 5. every gun slot the player owns can be selected, and an unowned one cannot
for (const w of ['pistol']) {
  r1.send('switch', { weapon: w });
  await sleep(300);
  ok(me().weapon === w, `slot 1 equips ${w}`);
}
r1.send('switch', { weapon: 'laser' });
await sleep(400);
ok(me().weapon !== 'laser', 'unowned gun slot is refused (no free pickups)');

// 6. counts hit zero: the slot must read as empty, not lie
r2.send('guard', { on: false }); // explicit lower: {} would TOGGLE it back up
await sleep(300);
let g = foe().grenades;
for (let i = 0; i < 6 && g > 0; i++) {
  r2.send('throw', { kind: 'grenade', angle: 0 });
  await sleep(300);
  g = foe().grenades;
}
ok(g === 0, `grenades can be emptied (${g})`);
r2.send('throw', { kind: 'grenade', angle: 0 });
await sleep(300);
ok(foe().grenades === 0, 'empty slot throws nothing (no negative counts)');

await r1.leave(); await r2.leave();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
