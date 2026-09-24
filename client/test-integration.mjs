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

// settle: wait until a player is actually still. CALLER MUST HAVE STOPPED
// all inputs first, or this burns the full window while the bot keeps walking.
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

  // 1. CREATE generates a lobby code, creator is host (kill target 2 for a fast duel)
  const host = new Client(URL);
  const hr = await host.create('shooter', { name: 'host1', killTarget: 2 });
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
  ok(hr.state.timeLeft === 300, `lobby previews match length (${hr.state.timeLeft}s)`);

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

  // 7. FFA duel: chase bot guns the guest down twice (kill target 2) -> ended + winner
  const pos = (room, id) => room.state.players.get(id)?.toJSON();
  async function duelKill(shooter, victim, wantKills, timeoutMs = 90000) {
    // shooter chases + fires, victim holds still; wall unstick via sidestep
    let stall = 0, lx = 0, ly = 0, mode = 'chase', modeN = 0, side = 1;
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const s = pos(shooter.room, shooter.id);
      const v = pos(victim.room, victim.id);
      if (!s || !v || shooter.room.state.phase !== 'playing') { await sleep(300); continue; }
      if (s.kills >= wantKills) return true;
      const dx = v.x - s.x, dy = v.y - s.y, d = Math.hypot(dx, dy) || 1;
      const ang = Math.atan2(dy, dx);
      if (mode === 'chase') {
        shooter.room.send('move', { dx: dx / d, dy: dy / d, angle: ang });
        if (Math.hypot(s.x - lx, s.y - ly) < 4) stall++; else stall = 0;
        lx = s.x; ly = s.y;
        if (stall >= 4) { mode = 'slide'; modeN = 0; side = -side; }
      } else {
        shooter.room.send('move', { dx: -dy / d * side, dy: dx / d * side, angle: ang });
        if (++modeN >= 5) { mode = 'chase'; stall = 0; }
      }
      shooter.room.send('shoot', { angle: ang });
      await sleep(300);
    }
    return pos(shooter.room, shooter.id)?.kills >= wantKills;
  }
  const feed = [];
  const hits = [];
  hr.onMessage('kill', (k) => feed.push(k));
  hr.onMessage('hit', (h) => hits.push(h));
  ok(await duelKill({ room: hr, id: hr.sessionId }, { room: gr, id: gr.sessionId }, 1),
    'chase bot scores kill #1');
  ok(feed.length >= 1 && feed[0].killer === 'host1' && feed[0].victim === 'guest1',
    `kill feed broadcast (${JSON.stringify(feed[0] || null)})`);
  ok(hits.length >= 4, `hit sparks broadcast (${hits.length} impacts)`);
  ok(hr.state.players.get(hr.sessionId).damage >= 100, `damage tracked (${hr.state.players.get(hr.sessionId).damage})`);
  ok(hr.state.players.get(hr.sessionId).kills === 1, 'kill counter increments');
  ok(hr.state.players.get(hr.sessionId).cash === 120, 'elimination pays $120');
  ok(hr.state.players.get(hr.sessionId).streak === 1, 'kill streak tracked (1)');
  ok(hr.state.phase === 'playing', 'no elimination end in FFA (respawn instead)');
  // victim respawns with full hp and keeps playing
  let back = false;
  for (let i = 0; i < 25; i++) {
    const g = pos(gr, gr.sessionId);
    if (g && g.alive && g.hp === 100) { back = true; break; }
    await sleep(300);
  }
  ok(back, 'victim respawns full-hp mid-match');
  ok(gr.state.players.get(gr.sessionId).streak === 0, 'victim streak reset');
  // kill #2 hits the target -> match ends, winner declared
  ok(await duelKill({ room: hr, id: hr.sessionId }, { room: gr, id: gr.sessionId }, 2),
    'chase bot scores kill #2 (kill target reached)');
  ok(hr.state.phase === 'ended', `match ends at kill target (phase=${hr.state.phase})`);
  ok(hr.state.winnerName === 'host1', `winner is kill leader (${hr.state.winnerName})`);
  ok(hr.state.players.get(hr.sessionId).cash === 240, 'second payout lands ($240)');

  // 8. Rematch: guest cannot, host can -> back to lobby, winner cleared
  gr.send('rematch');
  await sleep(500);
  ok(hr.state.phase === 'ended', 'guest rematch ignored (host-only)');
  hr.send('rematch');
  ok(await waitPhase(hr, 'lobby', 3000), 'host rematch returns to lobby');
  ok(hr.state.winnerName === '', 'winner cleared for next game');

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

  // 8b. Timeout with a kills leader: leader wins (not a draw)
  const k1 = new Client(URL);
  const k1r = await k1.create('shooter', { name: 'lead1', matchSeconds: 12, killTarget: 50 });
  const k2 = new Client(URL);
  const k2r = await k2.joinById(k1r.id, { name: 'lead2' });
  await sleep(400);
  k1r.send('startGame');
  ok(await waitPhase(k1r, 'playing', 9000), 'leader match goes live');
  for (let i = 0; i < 15; i++) { // host east to nook, guest west toward mid
    const a = k1r.state.players.get(k1r.sessionId).toJSON();
    if (a.x > 540) break;
    k1r.send('move', { dx: 1, dy: 0, angle: 0 });
    const b = k2r.state.players.get(k2r.sessionId).toJSON();
    if (b.x > 1030) k2r.send('move', { dx: -1, dy: 0, angle: Math.PI });
    await sleep(200);
  }
  k1r.send('move', { dx: 0, dy: 0, angle: 0 });
  k2r.send('move', { dx: 0, dy: 0, angle: Math.PI });
  for (let i = 0; i < 25; i++) { // one kill, then the clock decides
    const kk = k1r.state.players.get(k1r.sessionId).toJSON();
    if (kk.kills >= 1) break;
    const gg = k2r.state.players.get(k2r.sessionId).toJSON();
    k1r.send('shoot', { angle: Math.atan2(gg.y - kk.y, gg.x - kk.x) });
    await sleep(300);
  }
  ok(k1r.state.players.get(k1r.sessionId).kills === 1, 'leader banks one kill');
  ok(await waitPhase(k1r, 'ended', 20000), 'timeout ends the match');
  ok(k1r.state.winnerName === 'lead1', `kills leader wins on time (${k1r.state.winnerName})`);
  await k1r.leave(); await k2r.leave();

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

  // 18. Shotgun spread, sniper one-shot, knife melee + cooldown (no shield here)
  const s1 = new Client(URL);
  const s1r = await s1.create('shooter', { name: 'boom1', killTarget: 30, shieldSeconds: 0 });
  const s2 = new Client(URL);
  const s2r = await s2.joinById(s1r.id, { name: 'boom2' });
  await sleep(400);
  s1r.send('startGame');
  ok(await waitPhase(s1r, 'playing', 9000), 'arms-race match goes live');
  for (let i = 0; i < 8; i++) { // host grabs shotgun 100px east of spawn
    const p = s1r.state.players.get(s1r.sessionId).toJSON();
    if (p.x > 270) break;
    s1r.send('move', { dx: 1, dy: 0, angle: 0 });
    await sleep(200);
  }
  s1r.send('move', { dx: 0, dy: 0, angle: 0 });
  s1r.send('interact', {});
  await sleep(400);
  const sg = s1r.state.players.get(s1r.sessionId).toJSON();
  ok(sg.weapon === 'shotgun' && sg.sammo === 6, `shotgun equipped (${sg.weapon} ${sg.sammo}/6)`);
  for (let i = 0; i < 20; i++) { // host east to the open pocket x~740 (clear lane y=200)
    const a = s1r.state.players.get(s1r.sessionId).toJSON();
    if (a.x > 720) break;
    s1r.send('move', { dx: 1, dy: 0, angle: 0 });
    await sleep(200);
  }
  s1r.send('move', { dx: 0, dy: 0, angle: 0 });
  for (let i = 0; i < 20; i++) { // guest west to x~860 (clear of everything)
    const b = s2r.state.players.get(s2r.sessionId).toJSON();
    if (b.x < 880) break;
    s2r.send('move', { dx: -1, dy: 0, angle: Math.PI });
    await sleep(200);
  }
  s2r.send('move', { dx: 0, dy: 0, angle: Math.PI });
  // blast until pellets land (re-aimed retries defeat poll/stop-lag variance)
  let lastGap = -1;
  for (let round = 0; round < 4; round++) {
    const sa = await settle(s1r, s1r.sessionId);
    const sb = await settle(s2r, s2r.sessionId);
    const gap = Math.hypot(sb.x - sa.x, sb.y - sa.y);
    lastGap = gap;
    console.log(`  sg-round ${round}: h=(${sa.x.toFixed(0)},${sa.y.toFixed(0)}) g=(${sb.x.toFixed(0)},${sb.y.toFixed(0)}) gap=${gap.toFixed(0)}`);
    if (gap < 70) { // too close: muzzle would spawn past the target
      s1r.send('move', { dx: sa.x >= sb.x ? 1 : -1, dy: 0, angle: 0 });
      await sleep(300);
      s1r.send('move', { dx: 0, dy: 0, angle: 0 }); // stop, or settle() below never converges
      continue;
    }
    s1r.send('shoot', { angle: Math.atan2(sb.y - sa.y, sb.x - sa.x) });
    await sleep(700);
    if (s2r.state.players.get(s2r.sessionId).hp <= 76) break;
  }
  const spread = s2r.state.players.get(s2r.sessionId).toJSON();
  ok(spread.hp <= 76, `shotgun spread lands (guest hp=${spread.hp} gap=${lastGap.toFixed(0)})`);
  for (let i = 0; i < 18; i++) { // guest retreats east to the sniper nest
    const b = s2r.state.players.get(s2r.sessionId).toJSON();
    if (b.x > 1285) break;
    s2r.send('move', { dx: 1, dy: 0, angle: 0 });
    await sleep(200);
  }
  // home precisely onto the nest (interact radius is 30px; generous cap: guest may start anywhere)
  for (let i = 0; i < 30; i++) {
    const b = s2r.state.players.get(s2r.sessionId).toJSON();
    const dx = 1300 - b.x, dy = 200 - b.y, d = Math.hypot(dx, dy);
    if (d < 22) break;
    s2r.send('move', { dx: dx / d, dy: dy / d, angle: Math.atan2(dy, dx) });
    await sleep(200);
  }
  s2r.send('move', { dx: 0, dy: 0, angle: 0 });
  await sleep(300);
  for (let i = 0; i < 3; i++) {
    s2r.send('interact', {});
    await sleep(400);
    if (s2r.state.players.get(s2r.sessionId).weapon === 'sniper') break;
  }
  const sn = s2r.state.players.get(s2r.sessionId).toJSON();
  ok(sn.weapon === 'sniper' && sn.nammo === 5, `sniper equipped (${sn.weapon} ${sn.nammo}/5)`);
  const snipeFeed = [];
  s1r.onMessage('kill', (k) => snipeFeed.push(k));
  for (let round = 0; round < 3; round++) {
    const v1 = await settle(s1r, s1r.sessionId);
    const v2 = await settle(s2r, s2r.sessionId);
    s2r.send('shoot', { angle: Math.atan2(v1.y - v2.y, v1.x - v2.x) });
    await sleep(1200); // sniper interval is 1.6s: spacing keeps every retry live
    if (!s1r.state.players.get(s1r.sessionId).alive) break;
  }
  const down = s1r.state.players.get(s1r.sessionId).toJSON();
  ok(down.alive === false && down.hp === 0, 'sniper one-shots full hp');
  ok(snipeFeed.some((k) => k.w === 'sniper'), 'sniper kill in feed');
  let alive = false; // respawn path still works after the new weapons
  for (let i = 0; i < 20; i++) {
    const r = s1r.state.players.get(s1r.sessionId).toJSON();
    if (r.alive && r.hp === 100) { alive = true; break; }
    await sleep(300);
  }
  ok(alive, 'host respawns after sniper death');
  // top-up: home onto the (1200,200) health pad from any side. Airtight invariant:
  // shotgun left guest in [28,76]; the pad is either active (collect +50 here)
  // or was consumed by this same guest within 15s (+50 then). Either way hp >= 78.
  const tu0 = s2r.state.players.get(s2r.sessionId).hp;
  for (let i = 0; i < 30; i++) {
    const b = s2r.state.players.get(s2r.sessionId).toJSON();
    const dx = 1200 - b.x, dy = 200 - b.y, d = Math.hypot(dx, dy);
    if (d < 25) break;
    s2r.send('move', { dx: dx / d, dy: dy / d, angle: Math.atan2(dy, dx) });
    await sleep(200);
  }
  s2r.send('move', { dx: 0, dy: 0, angle: Math.PI });
  await sleep(500);
  const tu1 = s2r.state.players.get(s2r.sessionId).hp;
  ok(tu1 >= 78, `guest healthy for melee (hp=${tu1}, was ${tu0})`);
  // knife: close to <45 (margin inside the 70 range), face, F. Retry: it must land.
  let landed = false, kBefore = 0, kAfter = 0;
  for (let round = 0; round < 3 && !landed; round++) {
    for (let i = 0; i < 30; i++) {
      const a = s1r.state.players.get(s1r.sessionId).toJSON();
      const b = s2r.state.players.get(s2r.sessionId).toJSON();
      if (Math.hypot(b.x - a.x, b.y - a.y) < 45) break;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      s1r.send('move', { dx: dx / d, dy: dy / d, angle: Math.atan2(dy, dx) });
      await sleep(200);
    }
    s1r.send('move', { dx: 0, dy: 0, angle: 0 });
    await sleep(300);
    const pre = s2r.state.players.get(s2r.sessionId).toJSON();
    const pf = s1r.state.players.get(s1r.sessionId).toJSON();
    s1r.send('move', { dx: 0, dy: 0, angle: Math.atan2(pre.y - pf.y, pre.x - pf.x) });
    await sleep(250); // face the victim (melee is a frontal arc)
    s1r.send('melee', {});
    await sleep(400);
    const post = s2r.state.players.get(s2r.sessionId).toJSON();
    if (pre.hp - post.hp === 50) { landed = true; kBefore = pre.hp; kAfter = post.hp; }
  }
  ok(landed, `knife deals 50 (${kBefore} -> ${kAfter})`);
  s1r.send('melee', {});
  await sleep(400);
  const q2 = s2r.state.players.get(s2r.sessionId).toJSON();
  ok(q2.hp === kAfter, `knife cooldown blocks instant second swing (hp=${q2.hp})`);
  await s1r.leave(); await s2r.leave();

  // 19. Shield + speed powerups: absorb, haste, timers
  const f1 = new Client(URL);
  const f1r = await f1.create('shooter', { name: 'buff1', killTarget: 30, shieldSeconds: 0 });
  const f2 = new Client(URL);
  const f2r = await f2.joinById(f1r.id, { name: 'buff2' });
  await sleep(400);
  f1r.send('startGame');
  ok(await waitPhase(f1r, 'playing', 9000), 'buff match goes live');
  for (let i = 0; i < 10; i++) { // host south to the shield pad (200,320)
    const p = f1r.state.players.get(f1r.sessionId).toJSON();
    if (p.y > 300) break;
    f1r.send('move', { dx: 0, dy: 1, angle: Math.PI / 2 });
    await sleep(200);
  }
  f1r.send('move', { dx: 0, dy: 0, angle: Math.PI / 2 });
  await sleep(400);
  ok(f1r.state.players.get(f1r.sessionId).shieldPts === 100, 'shield pad grants 100pts');
  for (let i = 0; i < 10; i++) { // guest south to the speed pad (1400,450)
    const p = f2r.state.players.get(f2r.sessionId).toJSON();
    if (p.y > 430) break;
    f2r.send('move', { dx: 0, dy: 1, angle: Math.PI / 2 });
    await sleep(200);
  }
  f2r.send('move', { dx: 0, dy: 0, angle: Math.PI / 2 });
  await sleep(400);
  const spd = f2r.state.players.get(f2r.sessionId).speedT;
  ok(spd > 0 && spd <= 8, `speed pad grants haste (${spd.toFixed(1)}s)`);
  // guest sprints west 2s boosted: must outrun the 520px unboosted ceiling
  const g0 = f2r.state.players.get(f2r.sessionId).toJSON();
  for (let i = 0; i < 10; i++) {
    f2r.send('move', { dx: -1, dy: 0, angle: Math.PI });
    await sleep(200);
  }
  f2r.send('move', { dx: 0, dy: 0, angle: Math.PI });
  await sleep(300);
  const g1 = f2r.state.players.get(f2r.sessionId).toJSON();
  ok(g0.x - g1.x > 600, `haste outruns base speed (${(g0.x - g1.x).toFixed(0)}px)`);
  // formation for the absorb shot: host east lane, guest holds west
  for (let i = 0; i < 20; i++) {
    const a = f1r.state.players.get(f1r.sessionId).toJSON();
    if (a.x > 540 && a.y < 250) break;
    f1r.send('move', { dx: a.x < 540 ? 1 : 0, dy: a.y > 210 ? -1 : 0, angle: 0 });
    await sleep(200);
  }
  f1r.send('move', { dx: 0, dy: 0, angle: 0 });
  await sleep(400);
  const fa = f1r.state.players.get(f1r.sessionId).toJSON();
  const fb = f2r.state.players.get(f2r.sessionId).toJSON();
  f2r.send('shoot', { angle: Math.atan2(fa.y - fb.y, fa.x - fb.x) });
  await sleep(600);
  const after = f1r.state.players.get(f1r.sessionId).toJSON();
  ok(after.hp === 100 && after.shieldPts === 75, `shield absorbs pistol hit (hp=${after.hp} pts=${after.shieldPts})`);
  await f1r.leave(); await f2r.leave();

  // 20. Maze run: east lane -> south -> west -> north through the maze, grab the prize
  const z1 = new Client(URL);
  const z1r = await z1.create('shooter', { name: 'maze1', killTarget: 30, shieldSeconds: 0 });
  const z2 = new Client(URL);
  const z2r = await z2.joinById(z1r.id, { name: 'maze2' });
  await sleep(400);
  z1r.send('startGame');
  ok(await waitPhase(z1r, 'playing', 9000), 'maze match goes live');
  const nav = async (room, id, tx, ty, cap = 30) => {
    for (let i = 0; i < cap; i++) {
      const p = room.state.players.get(id).toJSON();
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
      if (d < 30) break;
      room.send('move', { dx: dx / d, dy: dy / d, angle: Math.atan2(dy, dx) });
      await sleep(200);
      const q = room.state.players.get(id).toJSON();
      if (Math.hypot(q.x - p.x, q.y - p.y) < 3 && d > 60) break; // walled: stop pushing
    }
    room.send('move', { dx: 0, dy: 0, angle: 0 });
    await sleep(300);
    return room.state.players.get(id).toJSON();
  };
  let zp = await nav(z1r, z1r.sessionId, 1050, 200); // east along the north lane
  ok(zp.x > 900, `reached east staging (${zp.x.toFixed(0)},${zp.y.toFixed(0)})`);
  zp = await nav(z1r, z1r.sessionId, 1050, 1010); // south down x=1050 (clear of maze walls/covers)
  ok(zp.y > 980, `reached south lane (${zp.x.toFixed(0)},${zp.y.toFixed(0)})`);
  zp = await nav(z1r, z1r.sessionId, 800, 1010); // west to the maze mouth
  ok(Math.abs(zp.x - 800) < 60, `at the maze mouth (${zp.x.toFixed(0)},${zp.y.toFixed(0)})`);
  zp = await nav(z1r, z1r.sessionId, 800, 985); // step onto the prize pad
  z1r.send('interact', {});
  await sleep(400);
  const zw0 = z1r.state.players.get(z1r.sessionId).toJSON();
  ok(zw0.rifle === true && zw0.weapon === 'rifle', `maze prize claimed (${zw0.weapon})`);
  zp = await nav(z1r, z1r.sessionId, 800, 700); // north through the gates
  ok(zp.y < 720 && Math.abs(zp.x - 800) < 70, `threaded the maze (${zp.x.toFixed(0)},${zp.y.toFixed(0)})`);
  const zw = z1r.state.players.get(z1r.sessionId).toJSON();
  ok(zw.rifle === true, 'kept the prize rifle');
  await z1r.leave(); await z2r.leave();

  for (const r of [hr, gr, g2r, g3r, ...extra]) { try { await r.leave(); } catch {} }
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
