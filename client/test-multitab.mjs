// Multi-tab and hidden-tab regressions.
//
// Reported as: 1 host + 7 joiners in 8 tabs, host entered the game, the other 7
// never did, and everything was heavily lagged. Two independent causes, and both
// lived in the CLIENT, so neither was ever a hosting problem.
//
// The hidden-tab bug is invisible to a headless sim by construction -- it needs a
// backgrounded tab -- so these are structural assertions, each naming the
// mechanism it pins.
import fs from 'node:fs';

const lobby = fs.readFileSync('src/scenes/LobbyScene.ts', 'utf8').replace(/\r\n/g, '\n');
const sess = fs.readFileSync('src/net/Session.ts', 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// strip comments so prose explaining a pitfall cannot satisfy an absence check
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
// INCLUSIVE of both anchors, and '' when the end marker comes first (which would
// silently produce an empty slice and a false pass).
const body = (src, start, end) => {
  const a = src.indexOf(start);
  if (a < 0) return '';
  const b = end ? src.indexOf(end, a) : -1;
  if (b < 0) return '';
  return src.slice(a, b + end.length);
};

// ---------------------------------------------------------------------------
// 1. Entering the arena must NOT depend on the render loop.
//
// Phaser pauses its loop when a tab is hidden (Game.js:590 onHidden ->
// loop.pause(); TimeStep.js:569 `if (this._coolDown > 0 || !this.inFocus)`).
// Of 8 tabs on one screen, one is foreground. If the lobby->arena transition is
// a poll inside update(), the 7 backgrounded tabs never run update(), never see
// phase === 'playing', and never enter the arena. Only the host tab does --
// exactly the reported symptom.
{
  // the transition is reached from a state listener, which fires on a WebSocket
  // patch and therefore runs with the render loop paused
  ok(/room\.state\.onChange\(\(\) => \{\s*if \(live\(\) && room\.state\.phase === 'playing'\) this\.enterArena\(\);/.test(lobby),
    'phase === "playing" is watched on a state change, so it fires in a hidden tab');
  ok(!/this\.scene\.start\('arena'\)/.test(body(lobby, 'private lastCdSec')),
    'the raw scene.start("arena") is not left inline in update()');

  // update() survives only as a backstop, and delegates
  const upd = lobby.slice(lobby.indexOf('  update() {'));
  ok(/if \(phase === 'playing'\) \{\s*\/\/ backstop only[\s\S]{0,200}this\.enterArena\(\);/.test(upd),
    'update() keeps a backstop that delegates to the same idempotent path');
  ok(/[Bb]ackstop only/.test(upd) && /hidden tab/.test(upd),
    'and the comment records WHY the backstop is not the primary route');

  // one entry point, guarded, so two routes cannot start the scene twice
  ok(/private enterArena\(\) \{\s*if \(this\.gone\) return;/.test(lobby),
    'enterArena() is guarded by `gone`, so the listener and the backstop are idempotent');
  ok((lobby.match(/this\.enterArena\(\)/g) || []).length >= 2,
    'both the listener and update() route through the same method');
  // the re-entrancy guard the original code had must survive the extraction
  ok(/if \(!this\.scene\.isActive\(\)\) return;/.test(lobby),
    'the post-await liveness re-check survived the extraction');
  ok(/this\.gone = true;/.test(lobby),
    '`gone` is still set before the await, closing the window a second call would slip through');
}

// ---------------------------------------------------------------------------
// 2. Every tab needs its own callsign.
//
// localStorage is shared by every tab on one origin, so all 8 tabs read the same
// shooter_name and the roster showed eight copies of one name -- which reads as
// "the join failed" even though the server keys players on sessionId and every
// seat was genuinely taken. sessionStorage is per-tab, so it is the right store.
{
  ok(!/localStorage\.getItem\('shooter_name'\)[^;]*\|\| randomName\(\)/.test(code(sess)),
    'the name no longer falls straight through to localStorage + randomName');
  ok(/sessionStorage\.getItem\('shooter_tab_name'\)/.test(sess),
    'a per-tab name is read from sessionStorage first');
  ok(/sessionStorage\.setItem\('shooter_tab_seq'/.test(sess),
    'a per-tab counter is kept, so each extra tab gets a distinct number');
  ok(/cleanName\(`\$\{saved\} \$\{n\}`\)/.test(sess),
    'a tab that does not own the saved name gets a numbered variant of it');
  ok(/sessionStorage\.setItem\('shooter_tab_name', this\.name\)/.test(sess),
    'setName marks the tab as the owner, so a returning player keeps their callsign');
  // and it must still be capped by cleanName, or "Swift Hawk 7" would overflow
  ok(/cleanName/.test(sess) && /slice\(0, 12\)/.test(sess),
    'the 12-char cap still applies, so a suffixed name cannot overflow the HUD');
}

// ---------------------------------------------------------------------------
// 3. Both fixes are idempotent under a rematch. A second LobbyScene must not
//    leave a stale watcher behind, and must not re-enter the arena.
{
  ok(/this\.gone = false/.test(lobby) || /private gone = false/.test(lobby),
    '`gone` is reset on scene entry, so a rematch can enter the arena again');
  ok(/if \(!this\.scene\.isActive\(\)\) return;/.test(lobby),
    'and a late arena-chunk promise cannot fire into a dead scene');
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
