// Procedural WebAudio SFX: zero downloads. Master mute + volume persisted.
type Osc = OscillatorType;

class SFX {
  private ctx: AudioContext | null = null;
  muted = false;
  volume = 0.7;

  constructor() {
    try {
      this.muted = localStorage.getItem('shooter_mute') === '1';
      this.volume = Number(localStorage.getItem('shooter_vol') || 0.7);
    } catch { /* private mode */ }
  }

  private ac() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setMuted(m: boolean) {
    this.muted = m;
    try { localStorage.setItem('shooter_mute', m ? '1' : '0'); } catch { /* noop */ }
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    try { localStorage.setItem('shooter_vol', String(this.volume)); } catch { /* noop */ }
  }

  private tone(freq: number, dur: number, type: Osc, vol: number, slide = 0, delay = 0) {
    if (this.muted) return;
    const ctx = this.ac();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol * this.volume, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol: number, lowpass = 3000, delay = 0) {
    if (this.muted) return;
    const ctx = this.ac();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lowpass;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * this.volume, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t0);
  }

  click() { this.tone(700, 0.06, 'square', 0.12); }
  shootPistol() { this.noise(0.12, 0.5, 2500); this.tone(220, 0.1, 'square', 0.25, -140); }
  shootRifle() { this.noise(0.09, 0.4, 3500); this.tone(330, 0.07, 'sawtooth', 0.2, -180); }
  reload() { this.tone(300, 0.07, 'square', 0.15); this.tone(450, 0.07, 'square', 0.15, 0, 0.12); }
  hit() { this.tone(1100, 0.05, 'square', 0.18); }
  hurt() { this.tone(160, 0.2, 'sawtooth', 0.3, -60); }
  death() { this.tone(400, 0.4, 'sawtooth', 0.3, -320); this.noise(0.3, 0.3, 900); }
  pickup() { this.tone(520, 0.09, 'sine', 0.25, 260); }
  ready() { this.tone(660, 0.08, 'sine', 0.2); }
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.25, 0, i * 0.11)); }
  streak(n: number) {
    this.tone(660, 0.09, 'square', 0.2);
    this.tone(660 + n * 90, 0.14, 'square', 0.2, 0, 0.09);
  }
  count(final: boolean) { this.tone(final ? 880 : 440, final ? 0.3 : 0.12, 'square', 0.22); }
}

export const sfx = new SFX();
