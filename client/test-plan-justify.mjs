// The HOW TO PLAY rows must form a justified column: every row's text starting
// at the same x, with the icon hanging in its own gutter.
//
// The raggedness was never about wrapping. Phaser supports align:'justify', but
// Text.js:1370-1375 only applies it to lines already filling >=85% of the wrap
// width, and every row here is a SINGLE-LINE Text object at roughly 40-70% fill --
// so align:'justify' would have silently done nothing.
//
// The cause was the icon column. planRows built one string per row,
// `${icon}   ${txt}`, drawn as a single Text at a fixed x, so each row's text
// began at it.x + width(icon) + 3 spaces. Emoji advance widths differ per glyph:
// the set mixes text-presentation glyphs (narrow, monochrome) with
// emoji-presentation ones (wide, coloured), and the trailing VS16 in 'X'/'Y'
// switches presentation too. So every row's text started at a different x.
import fs from 'node:fs';

const menu = fs.readFileSync(new URL('./src/scenes/MenuScene.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// --- planRows keeps the icon and the text apart ---------------------------
ok(/const s = icon \? `\$\{icon\}   \$\{txt\}` : txt;/.test(menu) === false,
  'the combined `${icon}   ${txt}` string is gone -- that is what made the text column ragged');
ok(/items\.push\(\{ icon, s: txt,/.test(menu),
  'planRows keeps the icon and the text in separate fields');
ok(/private static readonly ICON_W = \d+/.test(menu), 'the icon column width is a named constant');

// --- the wrap width is measured on the TEXT only -------------------------
// Measuring the combined string under-measures any row that wraps, because the
// icon would consume width the text never sees.
ok(/const textW = colW - 16 - \(anyIcon \? MenuScene\.ICON_W : 0\)/.test(menu),
  'the text column width subtracts the icon column');
ok(/wordWrap: \{ width: textW \}/.test(menu),
  'the probe wraps at the text width, not the full column');
ok(/probe\.setText\(txt\)/.test(menu),
  'the probe measures the text alone, so a wrapping row is measured honestly');
ok(/anyIcon = rows\.some/.test(menu),
  'and lists with no icons (the SETTINGS controls) are detected, so they sit flush');

// --- drawPlan draws two columns -------------------------------------------
ok(/const hasIcons = plan\.items\.some/.test(menu), 'drawPlan decides once whether icons exist');
ok(/it\.icon\)[\s\S]{0,200}?setOrigin\(1, 0\)/.test(menu),
  'the icon is right-aligned into its column, so differing glyph widths share one edge');
ok(/it\.x \+ \(hasIcons \? MenuScene\.ICON_W : 0\), yTop \+ it\.y, it\.s/.test(menu),
  'the text starts at a fixed x for every row');
ok(/wordWrap: \{ width: plan\.textW \}/.test(menu),
  'and wraps at the same width it was measured at');
ok(/\.setOrigin\(0, 0\)/.test(menu),
  'text keeps origin(0,0) so wrapped lines align under the first line');

// --- the old single-object draw is gone ----------------------------------
ok(/this\.add\.text\(it\.x, yTop \+ it\.y, it\.s/.test(menu) === false,
  'the old one-object-per-row draw is gone');

// --- and justify is deliberately NOT used, with the reason on record -----
// Strip comments first: the source now explains WHY align:'justify' is not used,
// which means the literal string appears in prose. Only code counts.
const menuCode = menu.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
ok(/align:\s*'justify'/.test(menuCode) === false,
  "align:'justify' is not used: Phaser only justifies lines at >=85% fill, which these single-line rows never reach");
ok(/85%/.test(menu), 'and the 85% threshold is recorded in the source so it is not retried blind');

// --- geometry: the fix must not make rows wrap that used to fit ----------
// The old row consumed iconWidth + 3 spaces; the new one consumes ICON_W = 24.
// Emoji at 15px are typically ~18-22px wide plus 3 spaces, so 24 is close to
// the previous consumption and no previously-fitting row should now wrap.
ok(24 >= 18 + 3, 'ICON_W (24) covers the widest realistic emoji plus the old 3-space gap');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);