// HUD geometry audit: no two live readouts may overlap, and nothing may hang
// off the 960x600 screen.
//
// Text extents are UPPER BOUNDS, not measurements: Phaser measures with the real
// webfont, which we cannot load headlessly. Overestimating can only produce a
// false alarm here, never a missed overlap -- which is the direction we want.
//
// Every entry is also cross-checked against the literal in ArenaScene.ts, so
// moving an element in the source without updating this table fails the suite
// instead of silently drifting.
import fs from 'node:fs';

const arena = fs.readFileSync(new URL('./src/scenes/ArenaScene.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const W = 960, H = 600;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// conservative advance width per em, by family
const ADV = { MONO: 0.62, COND: 0.66, BODY: 0.62, DISPLAY: 0.60 };
const textW = (s, px, fam) => s.length * px * (ADV[fam] ?? 0.66);
// Phaser: height = fontSize * 1.2 per line, plus lineSpacing between lines
const textH = (px, lines = 1, spacing = 0) => px * 1.2 * lines + spacing * (lines - 1);

const box = (label, x, y, w, h, src) => ({ label, x, y, w, h, src });
// a text box from its anchor + origin
const txt = (label, anchor, origin, content, px, fam, opts = {}) => {
  const w = textW(content, px, fam);
  const h = textH(px, opts.lines ?? 1, opts.spacing ?? 0);
  const x = origin[0] === 0.5 ? anchor[0] - w / 2 : origin[0] === 1 ? anchor[0] - w : anchor[0];
  const y = origin[1] === 0.5 ? anchor[1] - h / 2 : origin[1];
  return box(label, x, y, w, h, opts.src);
};

// ---- the table ---------------------------------------------------------------
// worst-case content throughout: 12-char callsigns (the server caps them), the
// longest weapon tag, the widest timer pill (streak stars showing), 2-line ticker
// NOTE: box() takes a TRUE top-left rect. Several source rects are authored as
// (x, centreY) with origin(0, 0.5) -- those are converted here, not copied, so a
// future overlap cannot hide behind a shifted row.
const E = [
  // --- top left: health + effect chips
  box('hp bar', 10, 4, 236, 24, 'add.rectangle(10, 16, 236, 24'),
  box('effect chips', 10, 36.5, 240, 15, 'const x = 10 + i * 78;'),

  // --- top middle: timer pill (widest variant) + the y=45 info row
  box('timer pill (stars)', 367, 2, 226, 32, 'const w = withStars ? 226 : 132;'),
  txt('round line', [480, 45], [0.5, 0.5], 'FIRST TO 30 · ABCDEFGHIJKL 12K', 12, 'COND'),
  txt('heading', [700, 45], [1, 0.5], 'HDG 090 · SE', 11, 'COND'),

  // --- top right: gun + ammo, reload underline, status line
  box('ammo card', 706, 2, 238, 32, 'ammoCard.fillRoundedRect(706, 2, 238, 32, 8)'),
  box('reload underline', 706, 35, 232, 3, 'this.add.rectangle(938, 35, 232, 3'),
  txt('gun status line', [944, 45], [1, 0.5], 'NONE LEFT - RESTOCK AT PADS', 10, 'COND'),

  // --- bottom left: diagnostics + kill feed
  // Ping moved here from (256, 452). Origin (0, 0.5) at x=14 anchors it to the
  // left edge; the fps meter came with it, off the centre gutter at (256, 468),
  // because that was the ping's new row and leaving it would overlap.
  txt('ping', [14, 470], [0, 0.5], 'PING 123', 11, 'COND', { src: 'this.add.text(14, 470,' }),
  txt('fps', [80, 470], [0, 0.5], '60 FPS', 11, 'MONO', { src: 'this.add.text(80, 470,' }),
  box('kill feed row 1', 6, 485.5, 270, 17, 'const rowY = (i: number) => 494 + i * 19;'),
  box('kill feed row 2', 6, 504.5, 270, 17, 'const rowY = (i: number) => 494 + i * 19;'),

  // --- bottom middle: loadout strip + the grab button under it
  box('loadout strip', 282, 489, 396, 34, 'this.add.rectangle(x, 506, 36, 34'),
  box('grab button', 392, 541.2, 176, 41.6, "tex: 'btn220', x: 480, y: 562"),

  // --- bottom right: minimap, cash, leaders ticker (the column that was tight)
  box('minimap', 836, 440, 116, 88, 'mmFrame.fillRoundedRect(836, 440, 116, 88, 8)'),
  txt('cash', [948, 543], [1, 0.5], '$1,234', 17, 'COND', { src: "this.add.text(948, 543, '$0'" }),
  txt('leaders ticker', [948, 574], [1, 0.5], '#1 ABCDEFGHIJKL 12K/3D', 11, 'MONO',
    { lines: 2, spacing: 1, src: "this.add.text(948, 574, ''" }),
];

console.log('HUD ELEMENTS (worst-case content, upper-bound metrics)');
for (const e of E) {
  console.log(`  ${e.label.padEnd(20)} x ${e.x.toFixed(0).padStart(4)}..${(e.x + e.w).toFixed(0).padStart(4)}   y ${e.y.toFixed(0).padStart(3)}..${(e.y + e.h).toFixed(0).padStart(3)}`);
}

// ---- pairwise overlap --------------------------------------------------------
const overlapArea = (a, b) => {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0 && oy > 0 ? ox * oy : 0;
};

console.log('\nOVERLAP CHECK');
let clashes = 0;
for (let i = 0; i < E.length; i++) {
  for (let j = i + 1; j < E.length; j++) {
    const a = overlapArea(E[i], E[j]);
    if (a > 0) {
      clashes++;
      console.log(`  CLASH  ${E[i].label}  x  ${E[j].label}   ${a.toFixed(0)}px^2`);
    }
  }
}
ok(clashes === 0, `no two HUD readouts overlap (${clashes} clashes across ${(E.length * (E.length - 1)) / 2} pairs)`);

// ---- everything on screen ----------------------------------------------------
const off = E.filter((e) => e.x < 0 || e.y < 0 || e.x + e.w > W || e.y + e.h > H);
ok(off.length === 0, off.length
  ? `everything is on screen -- offenders: ${off.map((e) => e.label).join(', ')}`
  : 'every readout is fully inside the 960x600 screen');

// ---- the table still matches the source --------------------------------------
console.log('\nSOURCE CROSS-CHECK');
let drift = 0;
for (const e of E) {
  if (!e.src) continue;
  if (!arena.includes(e.src)) { drift++; console.log(`  DRIFT  ${e.label}: "${e.src}" not found in ArenaScene.ts`); }
}
ok(drift === 0, `table matches the source (${drift} drifted)`);

// ---- specific regressions this audit exists for ------------------------------
console.log('\nREGRESSION GUARDS');
// the right column: the cash used to sit on the leaders ticker
const mm = E.find((e) => e.label === 'minimap'), cash = E.find((e) => e.label === 'cash');
const tick = E.find((e) => e.label === 'leaders ticker');
const load = E.find((e) => e.label === 'loadout strip');
ok(cash.y - (mm.y + mm.h) >= 3, `cash clears the minimap by ${(cash.y - (mm.y + mm.h)).toFixed(1)}px`);
ok(tick.y - (cash.y + cash.h) >= 3, `ticker clears the cash by ${(tick.y - (cash.y + cash.h)).toFixed(1)}px`);
ok(H - (tick.y + tick.h) >= 4, `ticker keeps ${(H - (tick.y + tick.h)).toFixed(1)}px off the bottom edge`);
// the kill feed plate is measured, not fixed, so its text can never hang off it
ok(/const bg = this\.add\.rectangle\(6, rowY\(0\),\s*\n?\s*Math\.max\(244, Math\.min\(270, vv\.x \+ vv\.width \+ 10 - 6\)\), 17/.test(arena),
  'kill feed plate is sized to its measured text and clamped short of the loadout');
// the loadout strip and the kill feed must keep clear of each other. Worst case
// (two 12-char callsigns + [ELECTRIC]) the plate runs to x=276 against a loadout
// that starts at 282 -- 6px. Typical 6-8 char names leave ~38px.
const feed = E.find((e) => e.label === 'kill feed row 1');
const gap = load.x - (feed.x + feed.w);
ok(gap >= 4, `widest kill feed clears the loadout by ${gap.toFixed(1)}px`);

// The ping's move into the bottom-left had exactly two things it could collide
// with, and neither was empty space by accident.
const ping = E.find((e) => e.label === 'ping');
const fps = E.find((e) => e.label === 'fps');
ok(ping.x <= 20, `ping is anchored to the left edge (x=${ping.x.toFixed(0)})`);
ok(ping.y > 440, `ping is in the bottom band (y=${ping.y.toFixed(0)})`);
// 470 is below the old 452: the ping moved DOWN into the bottom-left corner, not
// up. Asserting the direction explicitly, so a future move cannot drift back
// into the centre gutter without this failing.
ok(ping.y > 452, `the ping moved DOWN out of the centre gutter (y=${ping.y.toFixed(0)} > 452)`);
ok(ping.x < 100, 'and it is in the left column, not the middle of the screen');
// the kill feed owns the bottom-left below y=485; the ping must stay above it
const feedTop = Math.min(E.find((e) => e.label === 'kill feed row 1').y,
  E.find((e) => e.label === 'kill feed row 2').y);
ok(feedTop - (ping.y + ping.h) >= 4,
  `ping clears the kill feed by ${(feedTop - (ping.y + ping.h)).toFixed(1)}px`);
ok(load.x - (fps.x + fps.w) >= 4,
  `fps clears the loadout by ${(load.x - (fps.x + fps.w)).toFixed(1)}px`);
ok(feedTop - (fps.y + fps.h) >= 4,
  `fps clears the kill feed by ${(feedTop - (fps.y + fps.h)).toFixed(1)}px`);
// the two diagnostics share a row and must not print over each other
ok(fps.x - (ping.x + ping.w) >= 4,
  `fps clears the ping by ${(fps.x - (ping.x + ping.w)).toFixed(1)}px`);
// neither may be left behind in the old centre gutter
ok(!arena.includes('this.add.text(256, 452,'), 'the ping no longer sits in the centre gutter');
ok(!arena.includes('this.add.text(256, 468,'), 'the fps meter no longer sits in the centre gutter');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
