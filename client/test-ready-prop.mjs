// Proves lobby ready toggles reach per-player onChange (the UI redraw hook).
import { Client } from 'colyseus.js';
const URL = 'ws://localhost:2567';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const c1 = new Client(URL);
const r1 = await c1.create('shooter', { name: 'readyA' });
const c2 = new Client(URL);
const r2 = await c2.joinById(r1.id, { name: 'readyB' });
await sleep(500);

let stateChanges = 0, playerChanges = 0;
r2.state.onChange(() => { stateChanges++; });
r2.state.players.onAdd((p) => { p.onChange(() => { playerChanges++; }); });

r1.send('toggleReady');
await sleep(800);
const seen = r2.state.players.get(r1.sessionId)?.ready === true;
console.log(`other client sees ready=true: ${seen}`);
console.log(`state.onChange fired: ${stateChanges}x, player.onChange fired: ${playerChanges}x`);
const ok = seen && playerChanges > 0;
console.log(ok ? 'PASS: ready toggle propagates to player.onChange' : 'FAIL: no propagation');
await r1.leave(); await r2.leave();
process.exit(ok ? 0 : 1);
