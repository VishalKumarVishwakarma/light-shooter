// Phaser Text after scene teardown.
//
//     TypeError: Cannot read properties of null (reading 'drawImage')
//       at Frame.updateUVs
//       at Frame.setCutPosition
//
// Text.preDestroy() does texture.destroy() → Frame.data = null. Any later
// setText() that resizes the canvas calls frame.setSize → updateUVs and reads
// this.data.drawImage. The CREATE LOBBY click races GET /lobbies: pingLobbies
// resolves after the menu is already gone. Same for boot's async progress bar.
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const boot = read('./src/scenes/BootScene.ts');
const menu = read('./src/scenes/MenuScene.ts');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS: ${m}`); } else { fail++; console.log(`FAIL: ${m}`); } };

ok(/const live = \(\) => this\.sys\.settings\.active/.test(boot),
  'boot liveness is settings.active (isActive is RUNNING-only and false during create)');
ok(/if \(!live\(\)\) return;/.test(boot), '...and bails after every await');
ok(/\)\(\)\.catch\(/.test(boot), '...and the IIFE cannot become an unhandled rejection');

const ping = menu.slice(menu.indexOf('const pingLobbies'), menu.indexOf('void pingLobbies()'));
ok(/if \(!this\.sys\.isActive\(\)\) return;/.test(ping),
  'the lobby ticker does not setText on a destroyed Text');
ok((ping.match(/if \(!this\.sys\.isActive\(\)\) return;/g) || []).length >= 2,
  '...on both the success and the catch path');

ok(/await Session\.createLobby\(\);\s*\n\s*if \(!this\.sys\.isActive\(\)\) return;/.test(menu),
  'CREATE LOBBY does not start lobby after the menu died');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
