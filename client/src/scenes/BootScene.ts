import Phaser from 'phaser';
import { ensureTextures } from '../textures';
import { BODY, COND, SUB, TXT, displayText, kicker } from '../fonts';
import { SERVER_HTTP } from '../net/serverUrl';

const TIPS = [
  'TIP: walls block bullets — flank, don\'t trade through cover.',
  'TIP: the rifle melts — grab it with E at the gold ring.',
  'TIP: green crosses heal 50 HP. Fight near one when hurt.',
  'TIP: 2+ kill streak earns a golden aura. You\'re the target.',
  'TIP: first to 3 round-wins takes the tournament.',
  'TIP: low HP? The bar pulses red — disengage and heal.',
];

export class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }

  create() {
    ensureTextures(this);
    this.add.image(480, 300, 'menubg').setDisplaySize(960, 600);
    displayText(this, 480, 220, 'LIGHT SHOOTER', 54);
    kicker(this, 480, 262, '8 - P L A Y E R   R E A L T I M E   A R E N A', '#7dd3fc', 14);
    // progress bar
    this.add.rectangle(480, 360, 420, 18, 0x0b1220, 0.9).setStrokeStyle(1, 0x22d3ee, 0.5);
    const fill = this.add.rectangle(272, 360, 0, 12, 0x22d3ee).setOrigin(0, 0.5);
    const pct = this.add.text(480, 388, '0%', {
      fontFamily: COND, fontSize: '15px', fontStyle: '700', color: SUB,
    }).setOrigin(0.5);
    pct.setStroke('#020617', 3);
    const tip = this.add.text(480, 430, TIPS[0], {
      fontFamily: BODY, fontSize: '15px', fontStyle: '600', color: TXT,
    }).setOrigin(0.5);
    tip.setStroke('#020617', 3);
    let ti = 0;
    const tipTimer = this.time.addEvent({
      delay: 2000, loop: true,
      callback: () => { ti = (ti + 1) % TIPS.length; tip.setText(TIPS[ti]); },
    });
    const status = this.add.text(480, 470, '', {
      fontFamily: BODY, fontSize: '13px', fontStyle: '600', color: '#fca5a5',
    }).setOrigin(0.5);
    status.setStroke('#020617', 3);

    const stages: Array<[string, () => Promise<void>]> = [
      ['loading fonts', async () => {
        try { await (document as any).fonts?.ready; } catch { /* fallback fonts */ }
      }],
      ['painting arena', async () => { ensureTextures(this); }],
      ['pinging server', async () => {
        // deadline-bounded: a connection that is accepted but never answered
        // left this promise pending forever, so the loop stalled at 67% and
        // scene.start('menu') below never ran -- the player never saw a menu.
        const res = await fetch(`${SERVER_HTTP}/`, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) throw new Error('unreachable');
      }],
    ];
    (async () => {
      for (let i = 0; i < stages.length; i++) {
        try { await stages[i][1](); }
        catch {
          status.setText('server unreachable — menu loads, matches need :2567 up');
        }
        const p = (i + 1) / stages.length;
        fill.displayWidth = Math.max(1, 416 * p);
        pct.setText(`${Math.round(p * 100)}%`);
        await new Promise((r) => setTimeout(r, 250));
      }
      tipTimer.destroy();
      this.cameras.main.fadeOut(350, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('menu'));
    })();
  }
}
