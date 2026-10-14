// Run the actual scene methods against real Colyseus state/signals. Only the
// renderer is replaced: these tests need no GPU, browser, or listening server.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
import { Room } from 'colyseus.js';

const require = createRequire(import.meta.url);
const { ShooterState, Player } = require('../server/dist/schema/ShooterState.js');
const { Schema } = createRequire(new URL('../server/package.json', import.meta.url))('@colyseus/schema');

function loadScene(name, Session) {
  const exports = {};
  const source = fs.readFileSync(new URL(`src/scenes/${name}.ts`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const phaser = { Scene: class {}, BlendModes: { ADD: 1 }, Scenes: { Events: { SHUTDOWN: 'shutdown' } } };
  vm.runInNewContext(output, {
    exports, console, Date, Math, performance,
    require(id) {
      if (id === 'phaser') return { default: phaser };
      if (id === '../net/Session') return { Session };
      if (id === '../audio') return { sfx: { ready() {}, count() {} } };
      if (id === '../ui') return { toast() {} };
      if (id === '../panel') return { drawPanel() {} };
      return {};
    },
  }, { filename: name });
  return exports[name];
}

function setup(name, players = 0) {
  const authoritative = new ShooterState();
  for (let i = 0; i < players; i++) {
    const p = new Player(); p.name = `Player${i}`;
    authoritative.players.set(`p${i}`, p);
  }
  const state = new ShooterState();
  state.decode(authoritative.encodeAll()); authoritative.discardAllChanges();
  const room = new Room('shooter');
  Object.defineProperty(room, 'state', { value: state });
  room.sessionId = 'p0';
  const Session = { room, isHost: true };
  const Scene = loadScene(name, Session);
  const scene = new Scene();
  const events = new EventEmitter();
  let active = true, created = 0, destroyed = false;
  const object = new Proxy({}, { get(_, key) {
    if (key === 'getAll') return () => [];
    return () => { if (destroyed) throw new Error('rendering destroyed lobby'); return object; };
  } });
  scene.events = events;
  scene.sys = { settings: { active: true }, isActive: () => active };
  scene.scene = { isActive: () => active, start() {} };
  scene.add = new Proxy({}, { get: () => () => { created++; return object; } });
  scene.tweens = { killTweensOf() {}, add: () => ({ stop() {} }) };
  for (const key of ['rowsBox', 'readyLabel', 'readyBg', 'startLabel', 'startBg', 'statusText']) scene[key] = object;
  scene.startBtn = { c: object };
  const timers = [];
  scene.time = { addEvent(options) {
    const timer = { ...options, removed: false, remove() { this.removed = true; } };
    timers.push(timer); return timer;
  } };
  scene.drawScore = () => {};
  scene.showFight = () => {};
  scene.setT = () => { if (!active) throw new Error('updating destroyed ping text'); };
  return {
    scene, room, state, authoritative, Session, timers,
    created: () => created,
    shutdown() {
      active = false; scene.sys.settings.active = false;
      events.emit('shutdown'); destroyed = true;
    },
    patch(change) {
      change(authoritative);
      const errors = [];
      const previous = Schema.onError;
      Schema.onError = e => errors.push(e.message);
      try { state.decode(authoritative.encode()); }
      finally { Schema.onError = previous; authoritative.discardAllChanges(); }
      assert.deepEqual(errors, [], 'state callbacks must not throw');
    },
  };
}

test('lobby stops rendering and releases player callbacks after entering arena', () => {
  const h = setup('LobbyScene', 2);
  h.scene.wire();
  h.shutdown();
  const before = h.created();
  h.patch(s => { s.players.get('p1').x += 10; s.timeLeft -= 1; });
  assert.equal(h.created(), before);
  assert.equal(Object.values(h.state.players.get('p1').$callbacks || {}).flat().length, 0,
    'player subscriptions must be removed, not just ignored');
});

test('lobby does not rebuild every roster row for countdown or movement patches', () => {
  const h = setup('LobbyScene', 8);
  h.scene.wire();
  const before = h.created();
  for (let tick = 0; tick < 30; tick++) h.patch(s => {
    s.countdown = 3 - tick / 30;
    s.players.forEach(p => { p.x += 1; });
  });
  assert.equal(h.created(), before, 'unchanged roster should allocate zero new display objects');
  h.patch(s => { s.players.get('p1').ready = true; });
  assert.ok(h.created() > before, 'ready changes must still redraw the roster');
});

test('arena releases message handlers and ping timer on shutdown', async () => {
  const h = setup('ArenaScene');
  h.state.phase = 'playing';
  await h.scene.connect();
  const pendingPong = h.room.onMessageHandlers.events['pong']?.[0]
    || Object.entries(h.room.onMessageHandlers.events).find(([key]) => key.includes('pong'))[1][0];
  h.shutdown();
  assert.doesNotThrow(() => pendingPong({ t: Date.now() % 1000000 }));
  const retained = Object.values(h.room.onMessageHandlers.events).flat().length;
  assert.equal(retained, 0, 'rematches must not accumulate message callbacks');
  assert.ok(h.timers.every(t => t.removed), 'shutdown must stop probing the old room');
});
