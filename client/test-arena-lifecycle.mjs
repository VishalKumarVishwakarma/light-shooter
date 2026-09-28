// Arena lifecycle regressions.
//
// Every bug here survived the whole test suite because all six are invisible to
// a headless sim: they only show up on the SECOND run of a scene (a rematch), in
// a DOM click handler, or as frame-rate decay. So the assertions here are
// structural, and each one names the mechanism it is pinning.
import fs from 'node:fs';

const src = fs.readFileSync('src/scenes/ArenaScene.ts', 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };
// body() is INCLUSIVE of both anchors, and returns '' when the end marker comes
// before the start (which silently produced empty slices and false passes).
const body = (start, end) => {
  const a = src.indexOf(start);
  if (a < 0) return '';
  const b = end ? src.indexOf(end, a) : -1;
  if (b < 0) return '';
  return src.slice(a, b + end.length);
};

// ---------------------------------------------------------------------------
// 1. Keyboard shortcuts must survive a rematch.
//    KeyboardPlugin is cached per InputPlugin instance and its shutdown() calls
//    removeAllListeners(), but the instance is reused by the next create(). The
//    kbWired guard therefore has to be cleared on shutdown or every keydown-*
//    handler is dead after one rematch (WASD survives, which hides it).
const shutdown = body("this.events.once('shutdown'", 'this.cameras.main.setBounds');
ok(/this\.kbWired = false;/.test(shutdown),
  'the shutdown handler clears kbWired (or every shortcut dies after a rematch)');
ok(/global KeyboardPlugin outlives the scene/.test(src),
  '...and the stale comment claiming it is global is gone');
const wiring = body('if (!this.kbWired) {', '// ---- READOUTS');
ok((wiring.match(/kb\.on\(/g) || []).length >= 6,
  `the guarded block still wires the shortcuts (${(wiring.match(/kb\.on\(/g) || []).length} handlers)`);
ok(/this\.input\.keyboard!\.addKeys\(/.test(src),
  'addKeys is outside the guard, so WASD works on every visit');
ok(/this\.kbWired = true;/.test(wiring), 'the guard still prevents double-wiring within one visit');

// ---------------------------------------------------------------------------
// 2. One click must produce one shot.
//    The DOM pointerdown handler runs BETWEEN frames, so calling fireNow() there
//    and again from update()'s edge both saw edge=true. Guns hid it behind the
//    rate limit; the one-shot branches return before it, so a click threw two
//    grenades and two `guard` toggles cancelled out.
const pdown = body("this.input.on('pointerdown'", "this.input.on('pointerup'");
ok(!/this\.fireNow\(\)/.test(pdown),
  'the DOM pointerdown handler does not call fireNow (it fires twice per click)');
ok(/this\.firing = true;/.test(pdown), '...it only raises the flag that update() consumes');
const upd = body('const edge = this.firing && !this.fireWas;', 'if (this.firing) this.fireNow(edge);');
ok(/this\.fireWas = this\.firing;/.test(upd), 'update() still derives the trigger edge');
ok(/if \(this\.firing\) this\.fireNow\(edge\);/.test(upd), '...and still owns the single call');
// the one-shot branches must be edge-gated (they are the ones that double-fired)
const fire = body('private fireNow(', '// steel + standing bricks');
ok(/slot\.kind === 'ord'\) \{\s*if \(!edge\) return;/.test(fire), 'throwables are edge-gated');
ok(/slot\.kind === 'shield'\) \{\s*if \(!edge\) return;/.test(fire), 'the shield stance is edge-gated');
ok(/if \(slot && slot\.kind === 'ord'\)/.test(fire), 'the ord branch is reached (its `slot &&` guard is intact)');
ok(/now - this\.lastFire < w\.interval/.test(fire), 'guns keep their rate limit as the second line of defence');

// ---------------------------------------------------------------------------
// 3. The timer plate must be drawn on every visit.
//    layoutClock() early-returns on an unchanged star count and is the only
//    thing that draws the plate and positions liveDot, so a stale clockStars
//    left the timer undrawn and the dot at its constructor x=0 (a red dot on
//    the HP bar) for a whole match.
const resets = src.slice(src.indexOf('this.prevStreak = 0;'), src.indexOf('this.prevStreak = 0;') + 800);
ok(/this\.clockStars = -1;/.test(resets),
  'create() resets clockStars (else the timer plate is missing after a rematch)');
const layout = body('private layoutClock(', '// one status segment');
ok(/if \(this\.clockStars === \(withStars \? 1 : 0\)\) return;/.test(layout),
  'layoutClock still early-returns on an unchanged star count (it is a redraw gate)');
ok(/this\.liveDot\.setPosition\(x \+ 20, 18\)/.test(layout), '...and still positions the live dot');
ok(/this\.add\.circle\(0, 18, 4\.5/.test(src), 'the dot is still created at x=0, so the reset above is load-bearing');

// ---------------------------------------------------------------------------
// 4. The HP bar must run one tween pair, not twenty.
//    killTweensOf only matches the object the tween actually targets, and the
//    tweens targeted throwaway proxies, not hpFill/hpGhost -- so both kills were
//    no-ops and ~20 tweens (60 allocations/second at 30Hz) fought over the ghost
//    bar. The proxies now live on the instance.
const hp = body('private drawHp(', 'private paintHp(');
ok(/private hpProxy = \{ v: 100 \}/.test(src) && /private hpGhostProxy = \{ v: 100 \}/.test(src),
  'the HP tween proxies are held on the instance');
ok(/killTweensOf\(this\.hpProxy\)/.test(hp), 'drawHp kills the previous main-bar tween by its real target');
ok(/killTweensOf\(this\.hpGhostProxy\)/.test(hp), '...and the ghost tween too');
ok(/targets: this\.hpProxy,/.test(hp), 'the main tween targets the instance proxy');
ok(/targets: this\.hpGhostProxy,/.test(hp), '...and so does the ghost tween');
ok(!/killTweensOf\(this\.hpFill\)/.test(hp) && !/killTweensOf\(this\.hpGhost\)/.test(hp),
  'the mismatched killTweensOf(hpFill/hpGhost) calls are gone');
ok(!/const proxy = \{ v: from \}/.test(hp) && !/const gproxy = /.test(hp),
  'no per-call throwaway proxies remain');

// ---------------------------------------------------------------------------
// 5. The scoreboard must not rebuild at the patch rate.
//    drawBoard() destroys and re-mints ~30 canvas-backed Text objects, and it
//    was called from a 30Hz onChange handler.
ok(/if \(this\.boardVisible && this\.time\.now - this\.boardAt > \d+\)/.test(src),
  'the board rebuild is throttled, not run per patch');
ok(/private boardAt = -1e9;/.test(src), '...with a timestamp that starts expired');
ok(!/if \(this\.boardVisible\) this\.drawBoard\(\);/.test(src),
  'the un-throttled per-patch rebuild is gone');

// ---------------------------------------------------------------------------
// 6. Leaving must not strand the shock-aura tweens.
//    Phaser never reclaims a tween whose target was destroyed, and zapAura is
//    entered once per player so its own killTweensOf never ran.
const onRemove = body('p.onRemove(() => {', 'this.foeArcs.delete(id);');
ok(/if \(o\?\.zap\) this\.tweens\.killTweensOf\(o\.zap\);/.test(onRemove), 'onRemove kills the departed player\'s first aura tween');
ok(/if \(o\?\.zap2\) this\.tweens\.killTweensOf\(o\.zap2\);/.test(onRemove), '...and the second');
ok(/o\?\.gfx\.destroy\(true\);/.test(onRemove), '...after the container is destroyed, so no tween is left on a dead object');

// ---------------------------------------------------------------------------
// 7. Colyseus subscriptions must be detached on the way out.
//    @colyseus/schema's addCallback() returns a real disposer, but all 18
//    subscriptions threw theirs away -- and the $callbacks arrays hang off the
//    STATE object, which outlives the scene. onAdd defaults to triggerAll=true,
//    so each rematch added a handler per entity. live() stopped them drawing, so
//    it was a slow tax, not a visible bug: invisible to every headless suite.
const connect = body('async connect() {', '\n  }\n');
const keeps = (connect.match(/this\.keep\(/g) || []).length;
ok(keeps === 18, `all 18 Colyseus subscriptions are kept (${keeps}/18)`);
// every collection-level hook, or entities would keep re-binding on each visit
for (const coll of ['bricks', 'pickups', 'players', 'bullets', 'throws', 'clouds']) {
  ok(new RegExp(`this\\.keep\\(room\\.state\\.${coll}\\.onAdd\\(`).test(connect),
    `the ${coll} collection subscription is disposable`);
}
ok(/this\.keep\(room\.state\.onChange\(/.test(connect), 'the state onChange is disposable');
// the ENTITY-level hooks matter just as much: disposing the collection's ADD
// callback does not remove the handler it registered on the entity
ok(/this\.keep\(p\.onChange\(/.test(connect) && /this\.keep\(p\.onRemove\(/.test(connect),
  "the per-player onChange/onRemove are disposable too (they live on the entity, not the room)");
ok(/private colyOff: Array<\(\) => void> = \[\];/.test(src), 'the disposer list exists');
ok(/private keep\(d: unknown\)/.test(src) && /typeof d === 'function'/.test(src),
  '...and only stores real disposers, so a void return cannot crash the flush');
ok(/for \(const d of this\.colyOff\) \{ try \{ d\(\); \} catch/.test(src), 'the flush runs every disposer');
ok(/this\.colyOff = \[\];/.test(src), '...and clears the list so a second shutdown cannot double-dispose');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
