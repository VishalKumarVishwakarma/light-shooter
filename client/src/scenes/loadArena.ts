// The arena is the heaviest module in the game (a ~2,400-line scene plus every
// combat FX). It is loaded on demand instead of shipping it in the first paint:
// the menu and lobby need none of it.
//
// It is registered under the SAME 'arena' key the rest of the app already calls
// scene.start('arena') with, so no caller changes and the transition is a plain
// scene switch — no loader scene, no black frame, no spinner.
import type Phaser from 'phaser';

let inflight: Promise<boolean> | null = null;

// Kick this off while the player is in the lobby: by the time the countdown
// ends the chunk is already in memory, so the switch costs nothing.
export function preloadArena(game: Phaser.Game) {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const m = await import('./ArenaScene');
      game.scene.add('arena', m.ArenaScene);
      return true;
    } catch (e) {
      console.warn('arena preload failed, will retry on demand', e);
      inflight = null;
      return false;
    }
  })();
  return inflight;
}

// Called by LobbyScene at the moment the match goes live. Resolves to true when
// 'arena' is registered and safe to start.
export async function ensureArena(game: Phaser.Game): Promise<boolean> {
  if (hasArena(game)) return true;
  await preloadArena(game);
  if (hasArena(game)) return true;
  try {
    const m = await import('./ArenaScene');
    game.scene.add('arena', m.ArenaScene);
    inflight = null;
    return true;
  } catch (e) {
    console.error('arena load failed', e);
    return false;
  }
}

// SceneManager has no public getter, so check the running/queued keys
function hasArena(game: Phaser.Game): boolean {
  const mgr: any = game.scene;
  return typeof mgr.getScene === 'function' && !!mgr.getScene('arena');
}
