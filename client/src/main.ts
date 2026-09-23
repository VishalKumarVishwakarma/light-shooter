import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { LobbyScene } from './scenes/LobbyScene';
import { ArenaScene } from './scenes/ArenaScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 600,
  backgroundColor: '#0b0e14',
  physics: { default: 'arcade' }, // arcade only, no matter -> lightweight
  dom: { createContainer: true }, // required for the callsign <input/> overlay
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, MenuScene, LobbyScene, ArenaScene],
});

// fatal-error overlay: never a silent black screen
window.addEventListener('error', (e) => showFatal(String(e.message || e)));
window.addEventListener('unhandledrejection', (e) => showFatal('async: ' + String((e as any)?.reason?.message || (e as any)?.reason || e)));
function showFatal(msg: string) {
  try {
    console.error('[fatal]', msg);
    let el = document.getElementById('fatal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fatal';
      el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);max-width:90vw;'
        + 'background:#7f1d1d;color:#fff;font:600 14px Rajdhani,sans-serif;padding:10px 18px;border-radius:10px;'
        + 'border:1px solid #ef4444;z-index:99;box-shadow:0 10px 30px rgba(0,0,0,.5);';
      el.textContent = 'Something broke: ' + msg + ' — refresh the page.';
      document.body.appendChild(el);
    } else {
      el.textContent = 'Something broke: ' + msg + ' — refresh the page.';
    }
  } catch { /* last resort */ }
}
