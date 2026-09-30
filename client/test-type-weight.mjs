// No faux bold, and no thin readouts.
//
// Reported as "make thin text some bold, premium". The cause was specific and is
// worth pinning, because the two halves of the bug look identical on screen and
// have opposite causes:
//
//   SYNTHESISED bold -- 7 text objects asked for fontStyle:'700' on Share Tech
//     Mono, which is a 400-ONLY font. Google Fonts answers HTTP 400 for
//     `wght@700`, and `wght@400;700` serves only 400. So the browser smeared the
//     400 outlines to fake a bolder shape. That fuzzes the counters and goes
//     soft at the 11-12px sizes the HUD actually uses -- the opposite of
//     premium, and it cannot be fixed by writing a bigger fontStyle.
//
//   genuinely thin -- 8 text objects set no fontStyle at all, so they rendered
//     at a real 400.
//
// The fix loads JetBrains Mono at a real 700 and points MONO at it. This suite
// fails if either half returns.
import fs from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const files = {
  fonts: read('./src/fonts.ts'),
  index: read('./index.html'),
  arena: read('./src/scenes/ArenaScene.ts'),
  lobby: read('./src/scenes/LobbyScene.ts'),
  menu: read('./src/scenes/MenuScene.ts'),
  boot: read('./src/scenes/BootScene.ts'),
  session: read('./src/net/Session.ts'),
  ui: read('./src/ui.ts'),
};

// --- 1. the font must actually have a bold cut -----------------------------
ok(/family=JetBrains\+Mono:wght@700/.test(files.index),
  'JetBrains Mono is requested at a real 700 from Google Fonts');
ok(/family=Share\+Tech\+Mono/.test(files.index),
  'Share Tech Mono stays loaded, as the fallback');
ok(!/family=Share\+Tech\+Mono:wght@/.test(files.index),
  'and is NOT asked for a weight it does not have (it is 400-only)');
// Compare the resolved stack rather than regexing quotes: the source is
//   export const MONO = '"JetBrains Mono", "Share Tech Mono", monospace';
// An earlier version of this assertion over-escaped the quotes and failed
// against correct code, which is the wrong direction for a guard to fail in.
const monoDecl = /export const MONO = (.+);/.exec(files.fonts)?.[1] ?? '';
ok(/"JetBrains Mono"/.test(monoDecl), 'MONO resolves to JetBrains Mono first, so 700 is a real cut');
ok(/"Share Tech Mono"/.test(monoDecl) && /monospace/.test(monoDecl),
  'with Share Tech Mono and a generic fallback behind it');
ok(monoDecl.indexOf('JetBrains') < monoDecl.indexOf('Share Tech'),
  'and JetBrains comes FIRST, or the 400-only font wins again');

// --- 2. no MONO text object may be thin ------------------------------------
// Every one of these is a HUD data readout: kill feed, cash, leaders ticker,
// pickup floats, lobby code, invite link, fps.
let total = 0;
const thin = [];
for (const [name, src] of Object.entries(files)) {
  if (name === 'index' || name === 'fonts') continue;
  src.split('\n').forEach((line, i) => {
    if (!/fontFamily:\s*MONO\b/.test(line)) return;
    total++;
    if (!/fontStyle:\s*'700'/.test(line)) thin.push(`${name}.ts:${i + 1}  ${line.trim().slice(0, 60)}`);
  });
}
ok(thin.length === 0,
  thin.length
    ? `${thin.length} of ${total} mono readouts are still thin: ${thin.join(' | ')}`
    : `all ${total} mono readouts carry a real 700 weight`);

// --- 3. the faux-bold footgun is documented where it will be hit -----------
ok(/400-ONLY|400-only/.test(files.fonts),
  'fonts.ts records WHY MONO is not Share Tech Mono, so nobody "simplifies" it back');
ok(/synthesised|SYNTHESISED/i.test(files.fonts),
  'and names the synthesised-bold failure it prevents');
ok(/metric-compatible/i.test(files.fonts),
  'and records that the swap cannot change text width (the kill feed plate)');

// --- 4. the families that DO have weights were not downgraded --------------
// Anton is 400-only by design (it is a single-weight display face) and is used
// for the extruded marquee titles, where the double-offset shadow carries the
// weight. It must NOT be given a fontStyle, which would smear it.
ok(!/fontFamily:\s*DISPLAY[^}]*fontStyle/.test(files.arena + files.lobby + files.menu),
  'Anton (DISPLAY, 400-only) is never given a fontStyle that would smear it');
// COND and BODY both have real 600/700 cuts, so their weights are legitimate.
ok(/Chakra\+Petch:wght@600;700/.test(files.index), 'COND has real 600 and 700 cuts');
ok(/Rajdhani:wght@500;600;700/.test(files.index), 'BODY has real 500/600/700 cuts');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
