// Fit check for the two rebuilt dialogs, using the same metrics the scene's
// planner uses (Rajdhani/Condensed; emoji render full width in the browser).
const rows = [
  ['\u270B', 'Move with WASD or arrows.'],
  ['\u{1F5B1}\uFE0F', 'Aim with the mouse, hold click to fire.'],
  ['\u{1F52B}', 'Grab guns with E. 1-0 or the wheel switches any slot.'],
  ['\u2194', 'Ctrl + Left/Right also switches guns and throwables.'],
  ['\u{1F52A}', 'F is a knife: 50 damage, and it pierces shields.'],
  ['\u26A1', 'Electric gun: every hit locks them for 2.5s.'],
  ['\u{1F6E1}\uFE0F', 'You spawn SHIELDED; a raised shield stops every bullet.'],
  ['\u{1F4A3}', 'G/X/C throw now; slots 7/8/9 arm one, click tosses.'],
  ['\u{1F39A}\uFE0F', 'Guns, throwables and the shield are all switchable slots.'],
  ['\u271A', 'Crosses heal 50, yellow boxes refill ammo.'],
  ['\u{1F9F1}', 'Bricks crumble, steel never does. Rivers block you.'],
  ['\u{1F3C6}', 'Most kills at the whistle, or first to the target.'],
];
const ctl = [
  'move WASD / arrows \u00b7 aim with mouse \u00b7 hold click to fire',
  'wheel, 1-0, or Ctrl+arrows switch guns and throwables \u00b7 R reloads \u00b7 Q shield',
  'G / X / C throw now \u00b7 F knife \u00b7 E grabs a gun',
];

function em(s) {
  let e = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c > 0x1f000 || (c >= 0x2600 && c <= 0x27bf)) e += 1.15;
    else if (c === 0xfe0f) e += 0.1; // variation selector
    else if (ch === ' ') e += 0.28;
    else if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) e += 0.56;
    else if ('\u00b7:.,/-\u2014()!'.includes(ch)) e += 0.30;
    else e += 0.50;
  }
  return e;
}
const LINE = (size) => size * 1.32 + 5;

function plan(list, W, size, gap, cols) {
  const colW = (W - 52) / cols;
  const per = Math.ceil(list.length / cols);
  let tallest = 0;
  const detail = [];
  for (let c = 0; c < cols; c++) {
    let y = 0;
    for (const [icon, txt] of list.slice(c * per, (c + 1) * per)) {
      const s = icon ? `${icon}   ${txt}` : txt;
      const w = em(s) * size;
      const n = Math.max(1, Math.ceil(w / (colW - 16)));
      detail.push({ s, n, w });
      y += n * LINE(size) + gap;
    }
    tallest = Math.max(tallest, y - gap);
  }
  return { tallest, colW, detail };
}

const W = 560;
const p = plan(rows, W, 15, 8, 1);
const h = Math.min(520, Math.max(300, p.tallest + 132));
const top = -h / 2 + 92;
const usable = h - 92 - 24;
const yTop = top + Math.max(0, (usable - p.tallest) / 2);
const worst = Math.max(...p.detail.map((d) => d.w));
const wraps = p.detail.filter((d) => d.n > 1).length;
console.log('HOW TO PLAY');
console.log(`  panel 560x${h.toFixed(0)}   content ${p.tallest.toFixed(0)}px, 1 column of ${(p.colW - 16).toFixed(0)}px`);
console.log(`  content ${yTop.toFixed(0)} .. ${(yTop + p.tallest).toFixed(0)}  |  body ${top.toFixed(0)} .. ${(top + usable).toFixed(0)}`);
console.log(`  FITS VERTICALLY: ${yTop >= top - 0.5 && yTop + p.tallest <= top + usable + 0.5 ? 'YES' : 'NO'}`);
console.log(`  widest row ${worst.toFixed(0)}px / ${(p.colW - 16).toFixed(0)}px -> ${wraps} row(s) wrap`);
console.log(`  panel on screen: y ${(300 - h / 2).toFixed(0)} .. ${(300 + h / 2).toFixed(0)} of 600 -> ${300 - h / 2 >= 0 ? 'YES' : 'NO'}`);

const pc = plan(ctl.map((s) => ['', s]), 520, 14, 7, 1);
const setH = Math.min(560, Math.max(320, 150 + 80 + 26 + pc.tallest + 34));
const bTop = -setH / 2 + 92;
const ctlStart = bTop + 40 + 40 + 22;
const resetY = bTop + setH - 96;
const ctlWraps = pc.detail.filter((d) => d.n > 1).length;
console.log('\nSETTINGS');
console.log(`  panel 520x${setH.toFixed(0)}   controls ${pc.tallest.toFixed(0)}px of ${(pc.colW - 16).toFixed(0)}px`);
console.log(`  labels ${bTop.toFixed(0)} / ${(bTop + 40).toFixed(0)} / ${(bTop + 80).toFixed(0)} (20px each)`);
console.log(`  controls ${ctlStart.toFixed(0)} .. ${(ctlStart + pc.tallest).toFixed(0)}   RESET ${resetY.toFixed(0)}`);
console.log(`  FITS: ${ctlStart + pc.tallest <= resetY - 14 ? 'YES' : 'NO'} (clears by ${(resetY - 14 - ctlStart - pc.tallest).toFixed(0)}px)`);
console.log(`  widest control ${Math.max(...pc.detail.map((d) => d.w)).toFixed(0)}px -> ${ctlWraps} wrap`);
console.log(`  panel on screen: y ${(300 - setH / 2).toFixed(0)} .. ${(300 + setH / 2).toFixed(0)} of 600 -> ${300 - setH / 2 >= 0 ? 'YES' : 'NO'}`);
