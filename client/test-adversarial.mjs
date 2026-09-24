import { Client } from 'colyseus.js';

// Adversarial + edge-case suite: malformed input, capacity, lifecycle races.
const URL = 'ws://localhost:2567';
let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`PASS: ${msg}`); }
  else { fail++; console.log(`FAIL: ${msg}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// gunMode: everyone spawns shielded — bots that shoot must lower first.
async function gunMode(room) {
  const me = room.state.players.get(room.sessionId).toJSON();
  if (me.guard) {
    room.send('guard', {});
    await sleep(300);
  }
  return room.state.players.get(room.sessionId).toJSON().guard === false;
}
const finite = (p) => Number.isFinite(p.x) && Number.isFinite(p.y);

async function waitPhase(room, want, timeout = 9000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (room.state.phase === want) return true;
    await sleep(150);
  }
  return room.state.phase === want;
}

async function main() {
  // 1. Poison inputs: NaN/Infinity/strings/empty must not corrupt state or crash.
  // Unknown message types get the sender KICKED (framework production behavior);
  // the room must stay healthy for everyone else.
  console.log('--- section 1: poison inputs');
  {
    const a = new Client(URL), b = new Client(URL);
    const r1 = await a.create('shooter', { name: 'evil1' });
    const r2 = await b.joinById(r1.id, { name: 'evil2' });
    await sleep(300);
    r1.send('startGame');
    await waitPhase(r1, 'playing');
    r1.send('move', { dx: NaN, dy: Infinity, angle: 'north' });
    r1.send('shoot', {});
    r1.send('shoot', { angle: NaN });
    r1.send('switch', { weapon: 12345 });
    r1.send('switch', {});
    r1.send('reload', {});
    r1.send('interact', {});
    await sleep(700);
    const p = r1.state.players.get(r1.sessionId).toJSON();
    ok(finite(p) && r1.state.phase === 'playing', 'poison inputs rejected, state finite');
    ok(p.weapon === 'pistol', `bad switch ignored (weapon=${p.weapon})`);
    let kicked = false;
    r1.onLeave(() => { kicked = true; });
    r1.send('bogus-type', { x: 1 });
    for (let i = 0; i < 20 && !kicked; i++) await sleep(200);
    ok(kicked, 'unknown message type gets sender kicked');
    await sleep(400);
    ok(Object.keys(r2.state.players.toJSON()).length === 1, 'room survives for the innocent peer');
    ok(r2.state.phase === 'lobby', 'kicked cheater dissolves the match safely');
    console.log('sec1 cleanup...');
    const lv = (prm, tag) => Promise.race([
      prm.then(() => `OK ${tag}`, (e) => `ERR ${tag}: ${e.message}`),
      sleep(8000).then(() => `HANG ${tag}`),
    ]);
    // kicked socket is already gone: leave() has nothing to confirm
    console.log(kicked ? 'SKIP r1leave (kicked)' : await lv(r1.leave(), 'r1leave'));
    console.log(await lv(r2.leave(), 'r2leave'));
    console.log('sec1 cleanup done');
  }

  // 2. Capacity: 8 in, 9th rejected
  console.log('--- section 2: capacity');
  {
    console.log('sec2 creating...');
    const room0 = await new Client(URL).create('shooter', { name: 'cap0' });
    console.log('sec2 created', room0.id);
    const extra = [];
    for (let i = 1; i < 8; i++) {
      extra.push(await new Client(URL).joinById(room0.id, { name: 'cap' + i }));
      await sleep(100);
    }
    await sleep(400);
    ok(Object.keys(room0.state.players.toJSON()).length === 8, 'room fills to 8/8');
    try {
      await new Client(URL).joinById(room0.id, { name: 'cap9' });
      ok(false, '9th join should be rejected');
    } catch (e) {
      ok(true, `9th join rejected (${e.code || 'no-seat'})`);
    }
    await room0.leave();
    for (const r of extra) { try { await r.leave(); } catch {} }
  }

  // 3. Solo host cannot start; host leaving mid-countdown dissolves to lobby
  console.log('--- section 3: solo + countdown race');
  {
    const h = new Client(URL);
    const hr = await h.create('shooter', { name: 'solo' });
    await sleep(300);
    hr.send('startGame');
    await sleep(600);
    ok(hr.state.phase === 'lobby', 'solo start ignored (needs 2+)');
    const g = new Client(URL);
    const gr = await g.joinById(hr.id, { name: 'solo2' });
    await sleep(400);
    hr.send('startGame');
    ok(await waitPhase(hr, 'countdown', 3000), 'countdown begins with 2');
    await hr.leave(); // host bails mid-countdown
    ok(await waitPhase(gr, 'lobby', 8000), 'countdown with 1 left falls back to lobby');
    ok(gr.state.hostId === gr.sessionId, 'guest promoted to host');
    await gr.leave();
  }

  // 4. Double start / stray rematch are no-ops
  console.log('--- section 4: double start');
  {
    const h = new Client(URL);
    const hr = await h.create('shooter', { name: 'dbl1' });
    const g = new Client(URL);
    const gr = await g.joinById(hr.id, { name: 'dbl2' });
    await sleep(400);
    hr.send('startGame');
    hr.send('startGame');
    ok(await waitPhase(hr, 'countdown', 3000), 'double start still one countdown');
    gr.send('rematch', {});
    await sleep(400);
    ok(hr.state.phase === 'countdown' || hr.state.phase === 'playing', 'stray rematch ignored');
    ok(await waitPhase(hr, 'playing', 8000), 'match proceeds');
    gr.send('startGame', {});
    await sleep(400);
    ok(hr.state.phase === 'playing', 'start during play ignored');
    await hr.leave(); await gr.leave();
  }

  // 5. Empty rooms expire (roomEmptySeconds=6) and vanish from browser
  console.log('--- section 5: empty expiry');
  {
    const h = new Client(URL);
    const hr = await h.create('shooter', { name: 'ghost', roomEmptySeconds: 6 });
    const code = hr.id;
    await hr.leave();
    await sleep(9000);
    const list = await (await fetch('http://localhost:2567/lobbies')).json();
    ok(!list.some((l) => l.code === code), 'emptied room leaves the browser');
    try {
      await new Client(URL).joinById(code, { name: 'late' });
      ok(false, 'expired room should refuse joins');
    } catch {
      ok(true, 'expired room refuses joins');
    }
  }

  // 7. Spawn shield absorbs hits; XSS names stripped; ping works; speed bounded
  console.log('--- section 7: shield + sanitize + ping + speed');
  {
    const h = new Client(URL);
    const hr = await h.create('shooter', { name: '<script>alert(1)</script>', shieldSeconds: 30 });
    const g = new Client(URL);
    const gr = await g.joinById(hr.id, { name: 'victim1' });
    await sleep(400);
    const hn = hr.state.players.get(hr.sessionId).name;
    ok(!hn.includes('<') && !hn.includes('>') && hn.length <= 12, `name sanitized ("${hn}")`);
    hr.send('startGame');
    ok(await waitPhase(hr, 'playing', 9000), 'shield match goes live');
    ok(await gunMode(hr), 'shooter lowers shield (victim keeps spawn shield)');
    // ping round-trip (mod-1M timestamps stay 32-bit for the codec)
    let rtt = -1;
    hr.onMessage('pong', (m) => {
      const now = Date.now() % 1000000;
      rtt = (now - (typeof m?.t === 'number' ? m.t : now) + 1000000) % 1000000;
    });
    hr.send('ping', { t: Date.now() % 1000000 });
    await sleep(600);
    ok(rtt >= 0 && rtt < 2000, `ping/pong works (${rtt}ms)`);
    // walk host east into pistol range of the guest (B5 lane is clear)
    for (let i = 0; i < 20; i++) {
      const p = hr.state.players.get(hr.sessionId).toJSON();
      if (p.x > 990) break;
      hr.send('move', { dx: 1, dy: 0, angle: 0 });
      await sleep(200);
    }
    hr.send('move', { dx: 0, dy: 0, angle: 0 });
    await sleep(400);
    const hp = hr.state.players.get(hr.sessionId).toJSON();
    const gp = gr.state.players.get(gr.sessionId).toJSON();
    const hits = [];
    hr.onMessage('hit', (m) => hits.push(m));
    hr.send('shoot', { angle: Math.atan2(gp.y - hp.y, gp.x - hp.x) });
    await sleep(600);
    const after = gr.state.players.get(gr.sessionId).toJSON();
    ok(after.hp === 100, `shield absorbs hit (guest hp=${after.hp})`);
    ok(hits.some((m) => m.dmg === 0), 'shielded impact reports 0 dmg');
    // speed bound: spam moves for 1s, displacement must respect 260px/s + margin
    const p0 = hr.state.players.get(hr.sessionId).toJSON();
    for (let i = 0; i < 10; i++) {
      hr.send('move', { dx: 1, dy: 1, angle: 0 });
      await sleep(100);
    }
    hr.send('move', { dx: 0, dy: 0, angle: 0 });
    await sleep(300);
    const p1 = hr.state.players.get(hr.sessionId).toJSON();
    const moved = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    ok(moved <= 420, `speed bounded (${moved.toFixed(0)}px in ~1.3s)`);
    await hr.leave(); await gr.leave();
  }

  // 8. /metrics contract
  console.log('--- section 8: metrics');
  {
    const m = await (await fetch('http://localhost:2567/metrics')).json();
    ok(Number.isFinite(m.roomsCreated) && m.roomsCreated >= 1
      && Number.isFinite(m.matchesStarted) && Number.isFinite(m.liveRooms),
      `metrics live (rooms=${m.roomsCreated} started=${m.matchesStarted})`);
  }
  // 9. /health contract
  console.log('--- section 9: health');
  {
    const res = await fetch('http://localhost:2567/health');
    const j = await res.json();
    ok(j.status === 'ok' && Number.isFinite(j.uptime) && Number.isFinite(j.activeRooms),
      `health ok (uptime=${j.uptime}s rooms=${j.activeRooms})`);
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
