// The electric gun must fire a BOLT, never a bullet.
//
// Regression guard: an electric shot used to spawn a travelling 'bolt' sprite
// on top of the arc, so the gun read as throwing a round AND shooting lightning.
// The fix is render-only -- the server still simulates a projectile (it carries
// the damage, the lock, and the stops at bodies/walls) -- so these assertions
// pin BOTH halves: the client never draws a slug, and the server never stops
// simulating the bolt's path.
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const arena = read('./src/scenes/ArenaScene.ts');
const room = read('../server/src/rooms/ShooterRoom.ts');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

// ---- client: no bullet sprite on an electric shot -----------------------------
const onAdd = arena.slice(arena.indexOf('room.state.bullets.onAdd'), arena.indexOf('room.state.throws.onAdd'));
ok(onAdd.length > 0, 'found the bullet spawn block');
ok(/const isArc = bw === 'electric';/.test(onAdd), 'electric is branched on at spawn');
ok(/isArc \? 'zap' : 'bolt'/.test(onAdd), 'electric tip uses the charge glow, not the bolt round');
ok(!/setTint\(0xc084fc\)/.test(onAdd), 'no violet slug tint left on the electric path');
ok(/if \(isArc\) img\.setScale\(0\.5\)/.test(onAdd), 'arc tip is a soft head, not a full-size round');
ok(/arc: isArc \? b\.ownerId : undefined/.test(onAdd), 'electric shot remembers its owner so the bolt can be anchored');
ok(/if \(!o\.arc\) o\.img\.setRotation/.test(onAdd), 'the round charge head is not spun like a tracer');
// non-electric guns must be completely untouched
ok(/else if \(foe && !isArc\) img\.setTint\(0xfb923c\)/.test(onAdd), 'foe rounds still tint orange');
ok(/img\.setScale\(bw === 'laser' \? 1\.4 : 1\.0, 1\.0\)/.test(onAdd), 'other guns keep their round scale');

// ---- client: the bolt is current from the muzzle to the tip ------------------
ok(/private drawArcTethers\(\)/.test(arena), 'tether pass exists');
const tether = arena.slice(arena.indexOf('private drawArcTethers()'), arena.indexOf('// jagged 3-pass lightning path'));
ok(tether.length > 0, 'found the tether pass body');
ok(/this\.players\.get\(o\.arc\)/.test(tether), 'tether anchors on the owner, not a free-floating point');
ok(/own\.gfx\.x \+ Math\.cos\(a\) \* MUZZLE/.test(tether) && /own\.gfx\.y \+ Math\.sin\(a\) \* MUZZLE/.test(tether),
  'tether starts at the owner\'s barrel, so it is one continuous bolt');
ok(/reach - MUZZLE/.test(tether), 'tether length runs muzzle -> discharge tip');
ok(/drawn >= ARC_TETHER_MAX/.test(tether), 'tether count is capped (a 0.14s burst cannot flood the frame)');
ok(/0\.85, false\);/.test(tether), 'tether draws without clearing, so bolts share one Graphics');
ok(/this\.boltG\?\.setVisible\(false\)/.test(tether), 'tether graphics is hidden when nothing is in flight');

// ---- the tether must be drawn AFTER dead-reckoning, or it trails the tip ------
const update = arena.slice(arena.indexOf('update(_t: number, dtMs: number)'));
const deadIdx = update.indexOf('o.img.x += o.vx * step;');
const tetherIdx = update.indexOf('this.drawArcTethers();');
ok(deadIdx > 0 && tetherIdx > 0, 'found both the dead-reckon and the tether call in update()');
ok(tetherIdx > deadIdx, 'tether is drawn after dead-reckoning, so it ends exactly at the rendered tip');
// ...and it has to run every frame, exactly once
ok((arena.match(/this\.drawArcTethers\(\);/g) || []).length === 1,
  'tether is called exactly once per frame (never orphaned or doubled)');

// ---- arcStream must not clear a shared Graphics -------------------------------
const stream = arena.slice(arena.indexOf('private arcStream('), arena.indexOf('// per-shot discharge accent'));
ok(/clearFirst = true/.test(stream), 'arcStream takes a clearFirst flag');
ok(/if \(alpha <= 0\) \{ if \(clearFirst\) g\.clear\(\); return; \}/.test(stream), 'a zero-alpha bolt leaves other bolts intact');
ok(/if \(clearFirst\) g\.clear\(\);\n    const dx/.test(stream), 'clear happens before drawing, only when asked');// every pre-existing caller still gets the old clearing behaviour
const arcCallers = [...arena.matchAll(/this\.arcStream\(([^;]*?)\);/g)].map((m) => m[1]);
ok(arcCallers.length >= 4, `arcStream still has its original callers (${arcCallers.length})`);
ok(arcCallers.filter((c) => c.includes(', false')).length === 1, 'exactly one caller opts out of clearing (the tether pass)');

// ---- the arc must stop where the bolt stops ----------------------------------
// The muzzle streams used to draw a fixed 190px regardless of what was in the
// way, so the arc phased through bodies, walls and crates while the shot itself
// was being absorbed by them.
ok(/private arcReach\(x: number, y: number, ang: number, want: number, skipId: string\)/.test(arena),
  'arcReach exists: clip the arc to the first blocker');
const reach = arena.slice(arena.indexOf('private arcReach('), arena.indexOf('// Every in-flight electric shot'));
ok(/this\.rayEnd\(x, y, Math\.cos\(ang\), Math\.sin\(ang\), want, skipId\)/.test(reach),
  'arcReach marches with the same raycast the laser beam uses');
ok(/Math\.min\(want, Math\.hypot\(end\.x - x, end\.y - y\)\)/.test(reach), 'arc never reaches past the blocker');
ok(/if \(want <= 0\) return 0;/.test(reach), 'a zero-length want cannot loop the march');

// my own live stream
const drive = arena.slice(arena.indexOf('private driveArc('), arena.indexOf('// scene teardown'));
ok(/const reach = this\.arcReach\(mx, my, ang, 190, this\.meId\)/.test(drive),
  'my muzzle stream is clipped (skips only me)');
ok(/this\.arcStream\(this\.arcG, mx, my, ang, reach, flick\)/.test(drive),
  'my stream draws the clipped reach, not the raw 190');
ok(/Math\.random\(\) < 0\.55 && reach > 8/.test(drive), 'shed sparks ride the clipped arc, not through the wall');
ok(!/MUZZLE \+ 190 \* t/.test(drive), 'no spark is thrown past the blocker any more');

// a foe's live stream
const foe = arena.slice(arena.indexOf('private tickFoeArcs('), arena.indexOf('// The arc is current, not a ghost'));
ok(/const reach = this\.arcReach\(mx, my, ang, 190, id\)/.test(foe),
  "a foe's stream is clipped too (skips them, stops at me)");
ok(/this\.arcStream\(a\.g, mx, my, ang, reach,/.test(foe), "a foe's stream draws the clipped reach");

// the per-shot lance
const lance = arena.slice(arena.indexOf('private arcBolt('), arena.indexOf('// electric impact'));
ok(/this\.rayEnd\(x1, y1, Math\.cos\(ang\), Math\.sin\(ang\), reach, skipId\)/.test(lance),
  'the per-shot lance is clipped as well');
// rayEnd must test bodies at the server's own collision radius
const ray = arena.slice(arena.indexOf('private rayEnd('), arena.indexOf('private beam('));
ok(/Math\.hypot\(px - b\.x, py - b\.y\) < 22/.test(ray),
  'body stop uses the server 22px radius, so the arc ends where the bolt does');
ok(/id !== skipId && o\.alive/.test(ray), 'only living, non-owner bodies stop the arc (matches the sim)');
ok(/pointInWall\(px, py, walls\)/.test(ray), 'standing steel and brick stop the arc');

// nothing may reintroduce a hard-coded arc reach
ok(!/arcStream\([^)]*,\s*190\s*,/.test(arena), 'no caller hard-codes the 190px reach any more');
ok(!/arcStream\([^)]*,\s*280\s*,/.test(arena), 'no caller hard-codes the 280px lance reach any more');

// ---- server: the projectile is still authoritative ----------------------------
ok(/b\.weapon === 'electric'\) p\.slowT = ELECTRIC_SLOW/.test(room),
  'server still applies the electric lock on contact (render-only change)');
ok(!/electric[\s\S]{0,200}skipBullet|bulletless/i.test(room), 'server does not special-case electric into no projectile');
const fire = room.slice(room.indexOf("'shoot'"), room.indexOf("'reload'"));
ok(/this\.spawnBullet\(c, base \+ off, w, p\.weapon\)/.test(fire),
  'the fire handler still spawns a projectile for the held weapon (electric included)');
const spawn = room.slice(room.indexOf('private spawnBullet'), room.indexOf('// grenade blast'));
ok(/b\.weapon = weapon;/.test(spawn), 'server tags the bullet with its weapon, so electric is identifiable in flight');

// ---- no stray 'electric' bullet tint/render path elsewhere --------------------
const electricRenders = [...arena.matchAll(/electric[^\n]*/g)].map((m) => m[0]);
ok(!electricRenders.some((l) => /setScale\(1\.2\)|setTint\(0xc084fc\)/.test(l)),
  'no leftover electric bullet scale/tint anywhere in the scene');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
