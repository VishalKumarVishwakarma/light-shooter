import { Client } from 'colyseus.js';

const URL = 'ws://localhost:2567';
let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`PASS: ${msg}`); }
  else { fail++; console.log(`FAIL: ${msg}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPhase(room, want, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (room.state.phase === want) return true;
    await sleep(150);
  }
  return room.state.phase === want;
}

async function settle(room, id) {
  // wait until the server-side body actually stops (stop-command latency)
  for (let i = 0; i < 12; i++) {
    const a = room.state.players.get(id).toJSON();
    await sleep(300);
    const b = room.state.players.get(id).toJSON();
    if (Math.hypot(b.x - a.x, b.y - a.y) < 5) return b;
  }
  return room.state.players.get(id).toJSON();
}

async function main() {
  try {
    const res = await fetch('http://localhost:2567/');
    ok((await res.text()).includes('shooter-server'), 'server HTTP ok');
  } catch (e) { ok(false, `server HTTP: ${e.message}`); }

  // 1. CREATE generates a lobby code, creator is host
  const host = new Client(URL);
  const hr = await host.create('shooter', { name: 'host1' });
  await sleep(300);
  ok(typeof hr.id === 'string' && hr.id.length >= 5, `create returns lobby code (${hr.id})`);
  ok(hr.state.hostId === hr.sessionId, 'creator is host');
  ok(hr.state.players.get(hr.sessionId).name === 'host1', 'callsign reaches server');
  // long callsign capped at 12 chars server-side
  const long = new Client(URL);
  const longr = await long.joinById(hr.id, { name: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' });
  await sleep(300);
  ok(longr.state.players.get(longr.sessionId).name === 'ABCDEFGHIJKL', 'callsign capped at 12');
  await longr.leave();
  await sleep(300);

  // 2. JOIN with code lands in same lobby
  const guest = new Client(URL);
  const gr = await guest.joinById(hr.id, { name: 'guest1' });
  await sleep(500);
  ok(gr.id === hr.id, 'join-by-code lands in same lobby');
  ok(Object.keys(hr.state.players.toJSON()).length === 2, '2 players in lobby');
  ok(hr.state.phase === 'lobby', `starts in lobby (phase=${hr.state.phase})`);
  ok(hr.state.timeLeft === 120, `lobby previews match length (${hr.state.timeLeft}s)`);

  // 3. Bad code rejected
  try {
    await new Client(URL).joinById('NOPE12345', { name: 'x' });
    ok(false, 'bad code should be rejected');
  } catch { ok(true, 'bad code rejected'); }

  // 4. Non-host CANNOT start
  gr.send('startGame');
  await sleep(600);
  ok(hr.state.phase === 'lobby', 'guest start ignored (host-only)');

  // 5. Host starts -> countdown -> playing
  hr.send('startGame');
  ok(await waitPhase(hr, 'countdown', 3000), 'host start begins countdown');
  ok(await waitPhase(hr, 'playing', 8000), 'game goes live');

  // 6. Combat live
  const m0 = hr.state.players.get(hr.sessionId).toJSON();
  hr.send('move', { dx: 1, dy: 0, angle: 0 });
  await sleep(600);
  const m1 = hr.state.players.get(hr.sessionId).toJSON();
  ok(m1.x > m0.x, `movement live x ${m0.x.toFixed(1)} -> ${m1.x.toFixed(1)}`);

  // 7. Last-man-standing: route around cover, gun the guest down -> ended + winner
  const pos = () => ({
    h: hr.state.players.get(hr.sessionId).toJSON(),
    g: hr.state.players.get(gr.sessionId)?.toJSON(),
  });
  const gapOf = (p) => (p.g ? Math.hypot(p.g.x - p.h.x, p.g.y - p.h.y) : 1e9);
  let p = pos();
  // leg 1: push east until in range or blocked by cover
  let stall = 0, lastX = p.h.x;
  for (let i = 0; i < 40 && gapOf(p) > 450 && stall < 3; i++) {
    hr.send('move', { dx: 1, dy: 0, angle: 0 });
    await sleep(200);
    p = pos();
    stall = Math.abs(p.h.x - lastX) < 3 ? stall + 1 : 0;
    lastX = p.h.x;
  }
  // leg 2: blocked -> dip south below the upper covers (bottom edge 370 + margin)
  for (let i = 0; i < 20 && gapOf(p) > 450 && p.h.y < 410; i++) {
    hr.send('move', { dx: 0, dy: 1, angle: Math.PI / 2 });
    await sleep(200);
    p = pos();
  }
  // leg 3: east along the y~410 lane, past cover3 (ends x1220), then stop
  for (let i = 0; i < 60 && p.h.x < 1225; i++) {
    hr.send('move', { dx: 1, dy: 0, angle: 0 });
    await sleep(200);
    p = pos();
  }
  hr.send('move', { dx: 0, dy: 0, angle: 0 });
  p = { h: await settle(hr, hr.sessionId), g: await settle(gr, gr.sessionId) };
  ok(p.g && gapOf(p) < 600, `closed in for duel (gap=${gapOf(p).toFixed(0)})`);
  const feed = [];
  const hits = [];
  hr.onMessage('kill', (k) => feed.push(k));
  hr.onMessage('hit', (h) => hits.push(h));
  const aim = Math.atan2(p.g.y - p.h.y, p.g.x - p.h.x);
  for (let i = 0; i < 60 && hr.state.phase === 'playing'; i++) {
    hr.send('shoot', { angle: aim });
    await sleep(250);
  }
  ok(hr.state.phase === 'ended', `game ends with one survivor (phase=${hr.state.phase})`);
  ok(hr.state.winnerName === 'host1', `winner is survivor (${hr.state.winnerName})`);
  ok(feed.length >= 1 && feed[0].killer === 'host1' && feed[0].victim === 'guest1',
    `kill feed broadcast (${JSON.stringify(feed[0] || null)})`);
  ok(hits.length >= 4, `hit sparks broadcast (${hits.length} impacts)`);
  ok(hr.state.players.get(hr.sessionId).damage >= 100, `damage tracked (${hr.state.players.get(hr.sessionId).damage})`);
  ok(hr.state.players.get(hr.sessionId).wins === 1, 'round win scored (1W)');
  ok(hr.state.players.get(hr.sessionId).cash === 120, 'elimination pays $120');
  ok(hr.state.players.get(hr.sessionId).streak === 1, 'kill streak tracked (1)');
  ok(gr.state.players.get(gr.sessionId).streak === 0, 'victim streak reset');

  // 8. Rematch: guest cannot, host can -> back to lobby, winner cleared
  gr.send('rematch');
  await sleep(500);
  ok(hr.state.phase === 'ended', 'guest rematch ignored (host-only)');
  hr.send('rematch');
  ok(await waitPhase(hr, 'lobby', 3000), 'host rematch returns to lobby');
  ok(hr.state.winnerName === '', 'winner cleared for next game');
  ok(hr.state.players.get(hr.sessionId).wins === 1, 'wins carry across rounds');

  // 9. Lobby browser lists the live room with phase + counts
  const lobbies = await (await fetch('http://localhost:2567/lobbies')).json();
  const mine = lobbies.find((l) => l.code === hr.id);
  ok(!!mine && mine.players === 2 && mine.max === 8 && mine.phase === 'lobby',
    `browser lists lobby (${JSON.stringify(mine || null)})`);

  // 10. Match timer: short game, both idle -> timeout DRAW
  const t1 = new Client(URL);
  const t1r = await t1.create('shooter', { name: 'timer1', matchSeconds: 8 });
  const t2 = new Client(URL);
  const t2r = await t2.joinById(t1r.id, { name: 'timer2' });
  await sleep(400);
  t1r.send('startGame');
  ok(await waitPhase(t1r, 'playing', 8000), 'timed match goes live');
  ok(t1r.state.timeLeft > 0 && t1r.state.timeLeft <= 8, `timer running (${t1r.state.timeLeft.toFixed(1)}s)`);
  // muzzle origin: bullet appears at the gun tip, on the aim line
  const sh0 = t1r.state.players.get(t1r.sessionId).toJSON();
  t1r.send('shoot', { angle: 0 });
  await sleep(120);
  const blist = Object.values(t1r.state.bullets.toJSON());
  ok(blist.length >= 1, 'shot visible');
  if (blist.length) {
    const b0 = blist[0];
    const dx = b0.x - sh0.x, dy = Math.abs(b0.y - sh0.y);
    ok(dx > 40 && dx < 170 && dy < 30, `bullet at gun tip (dx=${dx.toFixed(0)}, dy=${dy.toFixed(0)})`);
  }
  ok(await waitPhase(t1r, 'ended', 15000), 'timer expiry ends match');
  ok(t1r.state.winnerName === 'DRAW', `idle timeout is a draw (${t1r.state.winnerName})`);
  await t1r.leave(); await t2r.leave();

  // 11. Host migration: fresh lobby, host leaves, guest becomes host and can start
  const h2 = new Client(URL);
  const h2r = await h2.create('shooter', { name: 'host2' });
  const g2 = new Client(URL);
  const g2r = await g2.joinById(h2r.id, { name: 'guest2' });
  await sleep(500);
  await h2r.leave();
  await sleep(500);
  ok(g2r.state.hostId === g2r.sessionId, 'host migrates to remaining player');
  const g3 = new Client(URL);
  const g3r = await g3.joinById(g2r.id, { name: 'guest3' });
  await sleep(500);
  g2r.send('startGame');
  ok(await waitPhase(g2r, 'playing', 9000), 'migrated host can start');

  // 12. Cap still 8 in main lobby
  const extra = [];
  for (let i = 0; i < 6; i++) {
    const c = new Client(URL);
    extra.push(await c.joinById(hr.id, { name: 'extra' + i }));
    await sleep(150);
  }
  ok(Object.keys(hr.state.players.toJSON()).length <= 8, `cap enforced (${Object.keys(hr.state.players.toJSON()).length}/8)`);

  // 13. Full rooms lock (auto) and leave the browser — documented engine behavior
  const full = await (await fetch('http://localhost:2567/lobbies')).json();
  ok(!full.some((l) => l.code === hr.id), 'full 8/8 lobby hidden from browser');

  // 14. Late join during play: start a fresh match, join mid-game, newcomer plays
  const w1 = new Client(URL);
  const w1r = await w1.create('shooter', { name: 'war1' });
  const w2 = new Client(URL);
  const w2r = await w2.joinById(w1r.id, { name: 'war2' });
  await sleep(400);
  w1r.send('startGame');
  ok(await waitPhase(w1r, 'playing', 9000), 'war match goes live');
  const late = new Client(URL);
  const later = await late.joinById(w1r.id, { name: 'late1' });
  await sleep(600);
  ok(Object.keys(w1r.state.players.toJSON()).length === 3, 'late join accepted mid-game');
  ok(later.state.phase === 'playing', 'newcomer sees live phase');
  const lx0 = later.state.players.get(later.sessionId).toJSON().x;
  later.send('move', { dx: 1, dy: 0, angle: 0 });
  await sleep(600);
  const lx1 = later.state.players.get(later.sessionId).toJSON().x;
  ok(lx1 > lx0, `newcomer moves mid-game x ${lx0.toFixed(1)} -> ${lx1.toFixed(1)}`);
  await later.leave(); await w1r.leave(); await w2r.leave();

  // 15. Battle City bricks stop movement: east, then south past the river gap
  const a1 = new Client(URL);
  const a1r = await a1.create('shooter', { name: 'wall1' });
  const a2 = new Client(URL);
  const a2r = await a2.joinById(a1r.id, { name: 'wall2' });
  await sleep(400);
  a1r.send('startGame');
  ok(await waitPhase(a1r, 'playing', 9000), 'wall-test match goes live');
  for (let i = 0; i < 20; i++) { // east to x~550 (clear of B5 above)
    const ap = a1r.state.players.get(a1r.sessionId).toJSON();
    if (ap.x > 540) break;
    a1r.send('move', { dx: 1, dy: 0, angle: 0 });
    await sleep(200);
  }
  for (let i = 0; i < 20; i++) { // south to y~880 (river gap x>440)
    const ap = a1r.state.players.get(a1r.sessionId).toJSON();
    if (ap.y > 860) break;
    a1r.send('move', { dx: 0, dy: 1, angle: Math.PI / 2 });
    await sleep(200);
  }
  for (let i = 0; i < 20; i++) { // south past the river gap into B3's band
    const ap = a1r.state.players.get(a1r.sessionId).toJSON();
    if (ap.y > 860) break;
    a1r.send('move', { dx: 0, dy: 1, angle: Math.PI / 2 });
    await sleep(200);
  }
  a1r.send('move', { dx: 0, dy: 0, angle: Math.PI / 2 });
  const wp = await settle(a1r, a1r.sessionId);
  ok(wp.x > 500 && wp.y > 750, `crossed open ground to (${wp.x.toFixed(0)},${wp.y.toFixed(0)})`);

  // 16. Bricks crumble: aim at B3's center, hits demolish it, then walk through
  const b0 = a1r.state.bricks.get('br_2').hp;
  ok(b0 === 3, `brick starts at 3hp (${b0})`);
  const chips = [];
  a1r.onMessage('chip', (c) => chips.push(c));
  const me = a1r.state.players.get(a1r.sessionId).toJSON();
  const aimBrick = Math.atan2(880 - me.y, 400 - me.x);
  for (let i = 0; i < 5; i++) { a1r.send('shoot', { angle: aimBrick }); await sleep(300); }
  await sleep(400);
  const b1 = a1r.state.bricks.get('br_2').hp;
  ok(b1 === 0, `hits demolish the brick (hp=${b1})`);
  ok(chips.length >= 3, `impact chips broadcast (${chips.length})`);
  for (let i = 0; i < 15; i++) { // rubble is passable: walk west through it
    const ap = a1r.state.players.get(a1r.sessionId).toJSON();
    if (ap.x < 380) break;
    a1r.send('move', { dx: -1, dy: 0, angle: Math.PI });
    await sleep(200);
  }
  const wp2 = a1r.state.players.get(a1r.sessionId).toJSON();
  ok(wp2.x < 380, `walks through rubble (x=${wp2.x.toFixed(0)})`);
  const guard = a2r.state.players.get(a2r.sessionId).toJSON();
  ok(guard.hp === 100 && a1r.state.phase === 'playing', `no collateral (guest hp=${guard.hp})`);
  await a1r.leave(); await a2r.leave();

  // 17. Weapons+pickups: rate limit, locked rifle, E-grab, drain, reload, switch, heal
  const u1 = new Client(URL);
  const u1r = await u1.create('shooter', { name: 'gun1', pickupSeconds: 2, reloadSeconds: 1 });
  const u2 = new Client(URL);
  const u2r = await u2.joinById(u1r.id, { name: 'gun2' });
  await sleep(400);
  u1r.send('startGame');
  ok(await waitPhase(u1r, 'playing', 9000), 'arms match goes live');
  // pistol fire-rate limit: 8 instant shots -> only a couple of bullets
  for (let i = 0; i < 8; i++) u1r.send('shoot', { angle: 0 });
  await sleep(300);
  let nb = Object.keys(u1r.state.bullets.toJSON()).length;
  ok(nb >= 1 && nb <= 4, `pistol rate-limited (${nb} bullets)`);
  await sleep(1300); // let tracers expire
  // rifle locked until picked up
  u1r.send('switch', { weapon: 'rifle' });
  await sleep(300);
  ok(u1r.state.players.get(u1r.sessionId).weapon === 'pistol', 'rifle locked before pickup');
  // pistol has a 12-round clip too: 3 spaced shots drain exactly 3 (rate test spent 1 already)
  const p0 = u1r.state.players.get(u1r.sessionId).toJSON().pammo;
  for (let i = 0; i < 3; i++) { u1r.send('shoot', { angle: Math.PI }); await sleep(350); }
  const pempty = u1r.state.players.get(u1r.sessionId).toJSON();
  ok(p0 - pempty.pammo === 3, `pistol drains clip (${p0} -> ${pempty.pammo})`);
  u1r.send('reload', {});
  await sleep(1600);
  const pfull = u1r.state.players.get(u1r.sessionId).toJSON();
  ok(pfull.pammo === 12 && pfull.reloading === false, `pistol reloads (${pfull.pammo}/12)`);
  // rifle grab from spawn: point is 200px east, E to grab
  for (let i = 0; i < 10; i++) {
    const hp0 = u1r.state.players.get(u1r.sessionId).toJSON();
    if (hp0.x > 370) break;
    u1r.send('move', { dx: 1, dy: 0, angle: 0 });
    await sleep(200);
  }
  u1r.send('move', { dx: 0, dy: 0, angle: 0 });
  u1r.send('interact', {});
  await sleep(400);
  const armed = u1r.state.players.get(u1r.sessionId).toJSON();
  ok(armed.rifle === true && armed.weapon === 'rifle' && armed.ammo === 30,
    `E grabs rifle (weapon=${armed.weapon} ammo=${armed.ammo})`);
  // drain 3 -> 27, reload -> 30, switch both ways
  for (let i = 0; i < 3; i++) { u1r.send('shoot', { angle: Math.PI }); await sleep(200); }
  const drained = u1r.state.players.get(u1r.sessionId).toJSON();
  ok(drained.ammo === 27, `rifle drains ammo (${drained.ammo})`);
  u1r.send('reload', {});
  await sleep(300);
  ok(u1r.state.players.get(u1r.sessionId).reloading === true, 'reload starts');
  ok(u1r.state.players.get(u1r.sessionId).reloadLeft > 0, 'reload progress syncs');
  await sleep(1200);
  const fresh = u1r.state.players.get(u1r.sessionId).toJSON();
  ok(fresh.ammo === 30 && fresh.reloading === false, `reload refills (${fresh.ammo})`);
  u1r.send('switch', { weapon: 'pistol' });
  await sleep(250);
  ok(u1r.state.players.get(u1r.sessionId).weapon === 'pistol', 'switch to pistol');
  u1r.send('switch', { weapon: 'rifle' });
  await sleep(250);
  ok(u1r.state.players.get(u1r.sessionId).weapon === 'rifle', 'switch back to rifle');
  // walk into formation: guest holds the north lane, host flanks via the south lane
  for (let i = 0; i < 15; i++) { // guest west to x~1000
    const gp = u2r.state.players.get(u2r.sessionId).toJSON();
    if (gp.x < 1030) break;
    u2r.send('move', { dx: -1, dy: 0, angle: Math.PI });
    await sleep(200);
  }
  u2r.send('move', { dx: 0, dy: 0, angle: Math.PI });
  let uh = u1r.state.players.get(u1r.sessionId).toJSON();
  let ux = uh.x, pux = ux, ustall = 0;
  for (let i = 0; i < 20 && ux < 540 && ustall < 3; i++) { // host east to the nook
    u1r.send('move', { dx: 1, dy: 0, angle: 0 });
    await sleep(200);
    ux = u1r.state.players.get(u1r.sessionId).toJSON().x;
    ustall = Math.abs(ux - pux) < 3 ? ustall + 1 : 0;
    pux = ux;
  }
  for (let i = 0; i < 12; i++) { // dip south to the y410 lane
    uh = u1r.state.players.get(u1r.sessionId).toJSON();
    if (uh.y > 400) break;
    u1r.send('move', { dx: 0, dy: 1, angle: Math.PI / 2 });
    await sleep(200);
  }
  for (let i = 0; i < 20; i++) { // east to x~1000, clear of the nook
    uh = u1r.state.players.get(u1r.sessionId).toJSON();
    if (uh.x > 980) break;
    u1r.send('move', { dx: 1, dy: 0, angle: 0 });
    await sleep(200);
  }
  u1r.send('move', { dx: 0, dy: 0, angle: 0 });
  const up = {
    h: await settle(u1r, u1r.sessionId),
    g: await settle(u2r, u2r.sessionId),
  };
  const ugap = Math.hypot(up.g.x - up.h.x, up.g.y - up.h.y);
  ok(ugap < 400, `closed distance for live-fire heal test (gap=${ugap.toFixed(0)})`);
  // aimed rifle hit on guest -> 85hp (retry with fresh aim; single bullets can graze)
  let hurt = u2r.state.players.get(u2r.sessionId).toJSON();
  for (let i = 0; i < 3 && hurt.hp === 100; i++) {
    const a = u1r.state.players.get(u1r.sessionId).toJSON();
    const b = u2r.state.players.get(u2r.sessionId).toJSON();
    u1r.send('shoot', { angle: Math.atan2(b.y - a.y, b.x - a.x) });
    await sleep(500);
    hurt = u2r.state.players.get(u2r.sessionId).toJSON();
  }
  ok(hurt.hp === 85, `guest wounded to 85hp (hp=${hurt.hp})`);
  // guest walks east to health pack (1200,200) -> auto-collect to full
  for (let i = 0; i < 20; i++) {
    const gp = u2r.state.players.get(u2r.sessionId).toJSON();
    if (gp.x > 1170) break;
    u2r.send('move', { dx: 1, dy: 0, angle: 0 });
    await sleep(200);
  }
  u2r.send('move', { dx: 0, dy: 0, angle: 0 });
  await sleep(400);
  const healed = u2r.state.players.get(u2r.sessionId).toJSON();
  ok(healed.hp === 100, `health pack heals to full (hp=${healed.hp})`);
  await sleep(2600); // pickupSeconds=2 -> respawns
  await u1r.leave(); await u2r.leave();

  for (const r of [hr, gr, g2r, g3r, ...extra]) { try { await r.leave(); } catch {} }
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
