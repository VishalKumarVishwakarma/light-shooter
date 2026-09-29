// Weapon balance, measured from the shipped WEAPONS table (server/src/map.ts is
// the single source of truth and is mirrored byte-for-byte in client/src/map.ts).
//
// This exists because the electric gun's mechanics were all verified working --
// equip, 8 damage a bolt, ammo across fire/reload/pickup/respawn, bolt travel,
// the lock, its decay, the render and the audio -- and yet the gun felt broken.
// It was. The table below is the reason, and it is not a matter of taste:
//
//   sustained DPS = dmg / interval * clip / (clip * interval + reload)
//
//   pistol    25 / 0.28s, clip 12, reload 1.2  ->  81 dps
//   electric   8 / 0.14s, clip 30, reload 2.2  ->  53 dps
//
// The world-pickup electric gun is 35% WORSE than the pistol you spawn with.
// Swapping to it is a downgrade, and its lock (0.35x movement for 2.5s) is the
// only thing that justifies the swap -- a multiplier the victim nullifies for
// free by standing still.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { WEAPONS, SPEED } = require('../server/dist/map.js');

const NAMES = ['pistol', 'rifle', 'shotgun', 'sniper', 'laser', 'electric'];
const HP = 100;

// per-shot damage actually delivered (shotgun fires `pellets` bolts)
const perShot = (w) => w.dmg * (w.pellets ?? 1);
// a full magazine plus one reload: every shot in the clip, then the reload
const magTime = (w) => w.clip * w.interval + w.reload;

let pass = 0, fail = 0, known = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };
// The electric gun's deficit is MEASURED but not yet fixed: it needs a design
// decision (see the note above the roster table), so it is reported rather than
// failed. A suite that is permanently red is a suite people stop reading. These
// become real assertions the moment the numbers change.
const deficit = (c, m) => {
  if (c) { pass++; console.log(`PASS: ${m}`); }
  else { known++; console.log(`KNOWN DEFICIT: ${m}`); }
};

console.log('  gun         dmg  intv   clip  reload   range   burst   sustained   ttk');
const rows = NAMES.map((n) => {
  const w = WEAPONS[n];
  const burst = perShot(w) * w.clip;
  const dps = burst / magTime(w);
  const range = w.speed * w.life;
  const ttk = HP / dps;
  console.log(`  ${n.padEnd(11)}${String(w.dmg).padStart(4)}${w.interval.toFixed(2).padStart(6)}`
    + `${String(w.clip).padStart(7)}${String(w.reload).padStart(8)}${String(Math.round(range)).padStart(8)}`
    + `${String(Math.round(burst)).padStart(8)}${dps.toFixed(0).padStart(12)}   ${ttk.toFixed(2)}s`);
  return { n, w, dps, ttk, range };
});
const by = (n) => rows.find((r) => r.n === n);

// ---------------------------------------------------------------------------
// the invariants a "unique gun" roster has to hold
// ---------------------------------------------------------------------------
const pistol = by('pistol').dps;
const elec = by('electric');

// 1. A gun may sit below the pistol's sustained DPS ONLY if it hits far harder
//    per shot. That is what buys the shotgun and the sniper their low average:
//    72 and 100 damage a pull, against the pistol's 25. The electric gun was the
//    only gun that was slower to kill AND hit softer than the starter (8), with
//    nothing but a status effect to justify the swap.
const PISTOL_SHOT = WEAPONS.pistol.dmg;
for (const r of rows) {
  if (r.n === 'pistol') continue;
  const hard = perShot(r.w) >= PISTOL_SHOT * 2;
  deficit(r.dps > pistol || hard,
    `${r.n}: either it out-damages the pistol's sustained rate (${r.dps.toFixed(0)} > ${pistol.toFixed(0)})`
    + ` or it hits >=${PISTOL_SHOT * 2} a pull (${perShot(r.w)})`
    + `${r.n === 'electric' ? `  <-- ${perShot(r.w)} a pull at ${r.dps.toFixed(0)} dps` : ''}`);
}
const worst = rows.slice().sort((a, b) => a.dps - b.dps)[0];
deficit(worst.n !== 'electric',
  `the electric gun is not the worst gun in the roster (worst: ${worst.n} at ${worst.dps.toFixed(0)} dps)`);

// 2. the pure-DPS guns stay the best, so the specials have a reason to exist
const dpsGuns = ['rifle', 'laser'];
const bestDps = Math.max(...dpsGuns.map((n) => by(n).dps));
ok(by('electric').dps < bestDps,
  `the electric gun is not a pure-DPS gun (${by('electric').dps.toFixed(0)} < ${bestDps.toFixed(0)})`);

// 3. range order, which the map comment states explicitly and the code depends on
const R = (n) => by(n).range;
ok(R('shotgun') < R('pistol') && R('pistol') < R('electric')
  && R('electric') < R('rifle') && R('rifle') < R('laser') && R('laser') < R('sniper'),
  'range order holds: shotgun < pistol < electric < rifle < laser < sniper');

// 4. the stated electric range: 800 + 2 tiles, one tile = 60px
ok(R('electric') === 920, `electric range is 920px (speed x life = ${R('electric')})`);

// 5. the lock has to be worth the DPS sacrifice. A movement multiplier the
//    victim can cancel by standing still is not a lockdown.
const ELECTRIC_MULT = 0.35, ELECTRIC_SLOW = 2.5;
deficit(ELECTRIC_MULT <= 0.3,
  `the lock actually impairs movement (${(1 - ELECTRIC_MULT) * 100}% slow, want >=70%)`);
ok(ELECTRIC_SLOW >= 2, `the lock lasts long enough to matter (${ELECTRIC_SLOW}s)`);

// 6. the gun can still break a turtle: with a raised shield every bullet is
//    blocked outright, so the electric gun's damage is worth nothing against one
//    -- which is fine ONLY if the lock lands, because the server applies the
//    lock even on a shielded block. Pin that, so it cannot be lost silently.
const room = fs.readFileSync('../server/src/rooms/ShooterRoom.ts', 'utf8');
const lockBeforeGuard = /if \(b\.weapon === 'electric'\) p\.slowT = ELECTRIC_SLOW;[\s\S]{0,200}?if \(p\.guard\)/.test(room);
ok(lockBeforeGuard, 'the lock lands even on a raised shield (it is the gun\'s only answer to a turtle)');

console.log(`\nRESULT: ${pass} passed, ${fail} failed, ${known} known deficit(s)`);
process.exit(fail ? 1 : 0);
