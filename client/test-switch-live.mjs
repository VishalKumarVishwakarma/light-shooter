// Measure weapon-switch reliability against the LIVE server, not by reading code.
//
// Five fixes have gone into this path and all five missed, each verified from source.
// Every one of them assumed the client-side plumbing was the problem. This assumes
// nothing: it joins a real room, plays until phase==='playing', walks onto a real
// rifle pickup to actually OWN a rifle, then hammers `switch` and counts how often
// p.weapon fails to follow.
//
// What it is looking for, specifically:
//   1. RAPID SWITCHES. Pressing Ctrl+Right twice fast sends two `switch` messages in
//      one tick. The server handler is a bare assignment with no queue, so the second
//      overwrites the first and only the final value is ever encoded. If a human press
//      rate can outrun the 30Hz encode, the intermediate press is invisible -- which
//      would present exactly as "sometimes it doesn't switch".
//   2. THE STEADY STATE. One switch, then wait for the patch. If p.weapon does not
//      become the requested gun, the server is dropping it and the TIMEOUT branch in
//      settlePending is the symptom.
//   3. OWNERSHIP GATING. Switch to a gun not owned must be ignored, not applied.
//   4. THE FULL CYCLE. Walk the guns-only list the stepper uses and confirm each one
//      lands, in order, with no duplicates or skips.
//
// Run with the game server up: node test-switch-live.mjs
import { Client } from 'colyseus.js';

const URL = 'ws://localhost:2567';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPhase(room, want, timeout = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (room.state.phase === want) return true;
    await sleep(60);
  }
  return room.state.phase === want;
}
const me = (room) => room.state.players.get(room.sessionId);

/** walk toward (tx,ty) until within `stop` px, or give up */
async function walkTo(room, tx, ty, stop = 22, timeout = 14000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const p = me(room);
    if (!p) return false;
    const dx = tx - p.x, dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d <= stop) { room.send('move', { dx: 0, dy: 0, angle: 0 }); return true; }
    room.send('move', { dx: dx / d, dy: dy / d, angle: Math.atan2(dy, dx) });
    await sleep(45);
  }
  room.send('move', { dx: 0, dy: 0, angle: 0 });
  return false;
}

/** send switch, then wait for the patch to reflect it. returns the observed weapon */
async function switchAndSettle(room, want, timeout = 1500) {
  room.send('switch', { weapon: want });
  const t0 = Date.now();
  let last = me(room)?.weapon;
  while (Date.now() - t0 < timeout) {
    last = me(room)?.weapon;
    if (last === want) return last;
    await sleep(25);
  }
  return last;
}

const client = new Client(URL);
// killTarget 2, as test-integration uses. A value of 99 left state.phase undefined --
// the room never became playable, so every later assertion failed for that reason
// rather than because switching is broken.
const room = await client.create('shooter', { name: 'switchtest', killTarget: 2 });

// The startGame handler is `if (this.state.players.size >= 2) this.startCountdown()`,
// so a solo client can never reach phase 'playing'. Every assertion below was failing
// because the match never started, not because switching misbehaves.
let guest = null;
try {
  const client2 = new Client(URL);
  guest = await client2.joinById(room.id, { name: 'guest' });

  for (let i = 0; i < 100 && room.state.phase === undefined; i++) await sleep(50);
  ok(room.state.phase === 'lobby', `joined into a lobby (phase=${room.state.phase})`);
  // NOT asserted on the tick we join: the guest's Player entity has not replicated yet,
  // so players.size legitimately reads 1 here even though startGame works a moment
  // later. Checking it immediately was my own bug and reported a false failure.
  for (let i = 0; i < 40 && room.state.players.size < 2; i++) await sleep(50);
  ok(room.state.players.size >= 2,
    `guest's Player entity replicated (${room.state.players.size} players) -- startGame needs >= 2`);
  room.send('startGame');
  ok(await waitPhase(room, 'countdown', 4000), 'countdown started');
  ok(await waitPhase(room, 'playing', 14000), 'match is live');
  await sleep(400);

  // --- get real ownership by walking onto a real pickup ------------------
  const rifles = [...room.state.pickups.values()].filter((p) => p.kind === 'rifle');
  ok(rifles.length > 0, `server spawned ${rifles.length} rifle pickups`);
  let owned = false;
  for (const pk of rifles) {
    const reached = await walkTo(room, pk.x, pk.y);
    for (let i = 0; i < 8 && !owned; i++) {
      room.send('interact', {});
      await sleep(140);
      if (me(room)?.rifle === true) owned = true;
    }
    if (owned) break;
  }
  ok(owned, `picked up a rifle by walking onto it and pressing E (rifle=${me(room)?.rifle})`);

  // --- 1. the steady state: one switch at a time --------------------------
  console.log('\n--- steady state: 12 single switches, 120ms apart ---');
  const seq = ['rifle', 'pistol', 'rifle', 'pistol', 'rifle', 'pistol',
    'rifle', 'pistol', 'rifle', 'pistol', 'rifle', 'pistol'];
  let misses = 0;
  for (const want of seq) {
    const got = await switchAndSettle(room, want);
    if (got !== want) { misses++; console.log(`     wanted ${want}, settled on ${got}`); }
    await sleep(120);
  }
  ok(misses === 0, `every single switch was acknowledged (${misses} missed of ${seq.length})`);

  // --- 2. rapid switches: two per tick ------------------------------------
  // This is the one that can legitimately be lossy and is NOT obviously a bug: the
  // server applies each `switch` immediately but Colyseus only encodes at the end of
  // the tick, so two switches inside one tick can only ever replicate the last.
  console.log('\n--- rapid: two switches with no wait between them ---');
  let rapidLost = 0;
  for (let i = 0; i < 10; i++) {
    room.send('switch', { weapon: 'rifle' });
    room.send('switch', { weapon: 'pistol' });   // final intent: pistol
    await sleep(200);
    const got = me(room)?.weapon;
    if (got !== 'pistol') { rapidLost++; console.log(`     rapid pair settled on ${got}, expected pistol`); }
  }
  console.log(`     ${rapidLost} of 10 rapid pairs did not settle on the final intent`);
  ok(rapidLost === 0,
    `rapid pairs settle on the FINAL intent -- the intermediate press is not lost`);

  // --- 3. one tick apart: the realistic double-press ----------------------
  console.log('\n--- two presses ~35ms apart (one frame at 30Hz) ---');
  let frameLost = 0;
  for (let i = 0; i < 10; i++) {
    room.send('switch', { weapon: 'rifle' });
    await sleep(35);
    room.send('switch', { weapon: 'pistol' });
    await sleep(200);
    if (me(room)?.weapon !== 'pistol') { frameLost++; console.log(`     settled on ${me(room)?.weapon}`); }
  }
  console.log(`     ${frameLost} of 10 lost a press one frame apart`);
  ok(frameLost === 0, `presses one frame apart both register`);

  // --- 4. ownership is still enforced -------------------------------------
  console.log('\n--- ownership gating ---');
  room.send('switch', { weapon: 'sniper' });
  await sleep(400);
  ok(me(room)?.weapon !== 'sniper',
    `switch to an unowned gun is refused (weapon=${me(room)?.weapon})`);

  // --- 5. an unknown id must not crash or corrupt -------------------------
  console.log('\n--- malformed input ---');
  room.send('switch', { weapon: 'not-a-gun' });
  await sleep(300);
  ok(typeof me(room)?.weapon === 'string', `a bogus id leaves a valid weapon (${me(room)?.weapon})`);
  room.send('switch', {});
  await sleep(300);
  ok(typeof me(room)?.weapon === 'string', `a missing field leaves a valid weapon (${me(room)?.weapon})`);
  await switchAndSettle(room, 'rifle');
  ok(me(room)?.weapon === 'rifle', 'and switching still works afterwards');

  // --- 6. the guns-only cycle the stepper walks ---------------------------
  console.log('\n--- the stepper cycle, against the server ---');
  const guns = ['pistol', 'rifle'];
  let cur = 'pistol', path = [cur];
  for (let i = 0; i < 6; i++) {
    const next = guns[(guns.indexOf(cur) + 1) % guns.length];
    const got = await switchAndSettle(room, next);
    path.push(`${next}${got === next ? '' : '(GOT ' + got + ')'}`);
    cur = got;
    await sleep(80);
  }
  console.log('     ' + path.join(' -> '));
  ok(!/GOT/.test(path.join(' ')), 'every step of the cycle was acknowledged by the server');

  room.send('leave', {});
} finally {
  try { guest?.leave(); } catch { /* already gone */ }
  try { room.leave(); } catch { /* already gone */ }
  await sleep(200);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
