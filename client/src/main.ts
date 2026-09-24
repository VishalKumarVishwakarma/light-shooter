import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { LobbyScene } from './scenes/LobbyScene';
import { ArenaScene } from './scenes/ArenaScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 600,
  backgroundColor: '#0b0e14',
  physics: { default: 'arcade' }, // arcade only, no matter -> lightweight
  fps: { target: 60, smoothStep: true }, // clamp delta spikes so hitches don't cascade
  dom: { createContainer: true }, // required for the callsign <input/> overlay
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, MenuScene, LobbyScene, ArenaScene],
});
watchContextLoss(game);

// fatal-error overlay: never a silent black screen (message + stack for diagnosis)
window.addEventListener('error', (e) => showFatal(String(e.message || e), (e as any)?.error?.stack));
window.addEventListener('unhandledrejection', (e) => showFatal('async: ' + String((e as any)?.reason?.message || (e as any)?.reason || e), (e as any)?.reason?.stack));
function showFatal(msg: string, stack?: string) {
  try {
    console.error('[fatal]', msg, stack || '');
    let el = document.getElementById('fatal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fatal';
      el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);max-width:90vw;'
        + 'background:#7f1d1d;color:#fff;font:600 14px Rajdhani,sans-serif;padding:10px 18px;border-radius:10px;'
        + 'border:1px solid #ef4444;z-index:99;box-shadow:0 10px 30px rgba(0,0,0,.5);white-space:pre-wrap;';
      document.body.appendChild(el);
    }
    el.textContent = 'Something broke: ' + msg + ' — refresh the page.'
      + (stack ? '\n' + String(stack).split('\n').slice(0, 3).join('\n') : '');
  } catch { /* last resort */ }
}

// GPU context loss: the canvas is dead until refresh — say so plainly.
function watchContextLoss(game: Phaser.Game) {
  const canvas = game.canvas;
  if (!canvas) return;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    showFatal('GPU context lost (graphics driver hiccup)');
  });
}
