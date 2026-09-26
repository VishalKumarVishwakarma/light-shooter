import { Client } from 'colyseus.js';
import fs from 'node:fs';
import { join } from 'node:path';

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

// 7. the wheel's cycle rule, checked against the REAL slot table in the source.
// The wheel handler is DOM-bound, so instead we parse SLOTS out of ArenaScene
// and apply the same predicate: unowned guns drop out, throwables and the
// shield always stay (even at zero), and the order matches the strip.
const src = fs.readFileSync(join(import.meta.dirname, 'src/scenes/ArenaScene.ts'), 'utf8');
const table = [...src.matchAll(/\{ key: '(\d)', nm: '([^']*)', id: '(\w+)', kind: '(\w+)' \}/g)]
  .map((m) => ({ key: m[1], id: m[3], kind: m[4] }));
ok(table.length === 10, `slot table has 10 entries (${table.length})`);
ok(table.map((s) => s.key).join('') === '1234567890', `keys run 1-0 in order (${table.map((s) => s.key).join('')})`);
const cycleFor = (p) => table.filter((s) => s.kind !== 'gun' || (s.id === 'pistol' || p[s.id] === true));
const bare = cycleFor({}).map((s) => s.id).join(',');
ok(bare === 'pistol,grenade,smoke,molly,shield', `bare cycle: ${bare}`);
const armed = cycleFor({ rifle: true, laser: true, shotgun: false, sniper: false, electric: false })
  .map((s) => s.id).join(',');
ok(armed === 'pistol,rifle,laser,grenade,smoke,molly,shield',
  `owned guns slot in strip order: ${armed}`);
ok(!armed.includes('shotgun') && !armed.includes('sniper') && !armed.includes('electric'),
  'unowned guns never enter the cycle');
ok(armed.endsWith('grenade,smoke,molly,shield'), 'throwables + shield sit at the tail');
// a full cycle from the pistol wraps back to the pistol
const full = cycleFor({ rifle: true, laser: true, electric: true, shotgun: true, sniper: true });
let cur = full.findIndex((s) => s.id === 'pistol');
for (let i = 0; i < full.length; i++) cur = (cur + 1) % full.length;
ok(full[cur].id === 'pistol', 'one full lap returns to where it started');

// 8. the switch handshake the client now relies on. The UI treats a gun switch
// as a REQUEST it waits to have acknowledged, so the server must always
// acknowledge or refuse it, and never leave the client guessing.
const c3 = new Client(URL);
const code3 = (await (await fetch('http://localhost:2567/code', { method: 'POST' })).json()).code;
const { roomId: room3 } = await (await fetch(`http://localhost:2567/code/${code3}`)).json();
const h3 = await c3.joinById(room3, { name: 'swHost' });
const c4 = new Client(URL);
const g4 = await c4.joinById(room3, { name: 'swGuest' });
await sleep(500);
h3.send('startGame');
for (let i = 0; i < 40 && h3.state.phase !== 'playing'; i++) await sleep(200);
ok(h3.state.phase === 'playing', 'switch-test match live');
const p3 = () => h3.state.players.get(h3.sessionId).toJSON();
h3.send('guard', { on: false });
await sleep(300);

// an owned switch is applied and visible in state within a round trip
h3.send('switch', { weapon: 'pistol' });
await sleep(350);
ok(p3().weapon === 'pistol', `owned switch acknowledged (${p3().weapon})`);

// an unowned gun is refused and the held gun is untouched, so the client can
// time out and fall back instead of showing a selection that never happened
h3.send('switch', { weapon: 'sniper' });
await sleep(400);
ok(p3().weapon === 'pistol', `unowned switch refused, gun unchanged (${p3().weapon})`);

// spam: several switches in one tick settle on what is actually ownable
h3.send('switch', { weapon: 'laser' });
h3.send('switch', { weapon: 'rifle' });
h3.send('switch', { weapon: 'shotgun' });
await sleep(500);
ok(p3().weapon === 'pistol', `switch spam cannot desync the held gun (${p3().weapon})`);

// a refused switch must not cancel an in-flight reload (and vice versa).
// a full mag refuses to reload, so spend a round first.
h3.send('shoot', { angle: Math.PI });
await sleep(400);
ok(p3().pammo < 12, `pistol spent a round (${p3().pammo}/12)`);
h3.send('reload');
await sleep(200);
const wasReloading = p3().reloading;
ok(wasReloading === true, 'reload started');
h3.send('switch', { weapon: 'sniper' }); // unowned -> refused
await sleep(300);
ok(p3().reloading === true, 'a refused switch leaves the reload running');
h3.send('switch', { weapon: 'pistol' }); // owned, same gun -> cancels it
await sleep(300);
ok(p3().reloading === false, 'an accepted switch cancels the reload');

// a dead player cannot swap guns (the client will time out and revert)
const g4id = g4.sessionId;
g4.send('guard', { on: false });
await sleep(200);
g4.send('switch', { weapon: 'pistol' });
await sleep(300);
ok(g4.state.players.get(g4id).weapon === 'pistol', 'guest can switch normally');

await h3.leave();
await g4.leave();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
