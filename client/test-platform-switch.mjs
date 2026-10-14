// Exercise the production keyboard handlers and slot selection without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('src/scenes/ArenaScene.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
function setup() {
  const handlers = new Map(), sent = [], exports = {};
  const room = { state: { players: new Map([['me', { rifle: true }]]) },
    send: (...message) => sent.push(message) };
  vm.runInNewContext(code, {
    exports, console, Date, Math,
    window: {
      addEventListener: (type, callback) => handlers.set(type, callback),
      removeEventListener: type => handlers.delete(type),
    },
    require(id) {
      if (id === 'phaser') return { default: { Scene: class {} } };
      if (id === '../net/Session') return { Session: { room } };
      if (id === '../audio') return { sfx: { click() {}, guard() {} } };
      return {};
    },
  });
  const scene = new exports.ArenaScene();
  scene.meId = 'me'; scene.activeSlot = 'pistol'; scene.time = { now: 1000 };
  const key = () => ({ isDown: false, reset() { this.isDown = false; } });
  scene.keys = { CTRL: key(), LEFT: key(), RIGHT: key() };
  scene.bindRawSlotChord();
  return { scene, sent, event(type, code, modifiers = {}) {
    const event = { code, key: code, ctrlKey: false, metaKey: false, repeat: false,
      prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...modifiers };
    handlers.get(type)(event);
    return event;
  } };
}

for (const [modifier, flag] of [['ControlLeft', 'ctrlKey'], ['ControlRight', 'ctrlKey'], ['MetaLeft', 'metaKey'], ['MetaRight', 'metaKey']]) {
  for (const arrowFirst of [false, true]) {
    test(`${modifier} + Right cycles gun then throwable, ${arrowFirst ? 'arrow' : 'modifier'} pressed first`, () => {
      const h = setup();
      if (arrowFirst) {
        h.event('keydown', 'ArrowRight');
        h.event('keydown', modifier, { [flag]: true });
      } else {
        h.event('keydown', modifier, { [flag]: true });
        h.event('keydown', 'ArrowRight', { [flag]: true });
      }
      assert.equal(h.scene.activeSlot, 'rifle');
      assert.equal(h.sent[0][0], 'switch');
      assert.equal(h.sent[0][1].weapon, 'rifle');
      h.event('keyup', 'ArrowRight', { [flag]: true });
      h.event('keydown', 'ArrowRight', { [flag]: true });
      assert.equal(h.scene.activeSlot, 'grenade');
      assert.ok(!h.sent.some(([type]) => type === 'throw'), 'switching arms a throwable without throwing it');
      h.event('keyup', 'ArrowRight', { [flag]: true });
      h.event('keydown', 'ArrowLeft', { [flag]: true });
      assert.equal(h.scene.activeSlot, 'rifle', 'Left cycles backwards');
    });
  }
}

test('Command repeat is consumed without repeated switches or browser navigation', () => {
  const h = setup();
  h.event('keydown', 'ArrowRight', { metaKey: true });
  const repeat = h.event('keydown', 'ArrowRight', { metaKey: true, repeat: true });
  assert.equal(h.scene.activeSlot, 'rifle');
  assert.equal(repeat.prevented, true);
});

test('Command release clears arrows whose keyup macOS may omit', () => {
  const h = setup();
  h.event('keydown', 'ArrowRight');
  h.scene.keys.RIGHT.isDown = true;
  h.event('keydown', 'MetaLeft', { metaKey: true });
  assert.equal(h.scene.slotModifier, true, 'movement sees Command while switching');
  h.event('keyup', 'MetaLeft');
  assert.equal(h.scene.slotModifier, false);
  assert.equal(h.scene.keys.RIGHT.isDown, false, 'no stuck strafe after Command release');
  assert.equal(h.scene.rawHeld.has('ArrowRight'), false);
  h.event('keydown', 'MetaLeft', { metaKey: true });
  assert.equal(h.scene.activeSlot, 'rifle', 'a stale arrow cannot switch again');
});

test('bare arrows do not switch; blur clears the modifier', () => {
  const h = setup();
  h.event('keydown', 'ArrowLeft');
  assert.equal(h.scene.activeSlot, 'pistol');
  h.event('keydown', 'MetaLeft', { metaKey: true });
  h.event('blur', '');
  assert.equal(h.scene.slotModifier, false);
  assert.equal(h.scene.rawHeld.size, 0);
});
