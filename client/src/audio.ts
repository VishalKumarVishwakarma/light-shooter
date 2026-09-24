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

  private noise(dur: number, vol: number, lowpass = 3000, delay = 0, type: BiquadFilterType = 'lowpass', freqEnd = 0) {
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
    f.type = type; f.frequency.setValueAtTime(lowpass, t0);
    if (freqEnd > 0) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * this.volume, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t0);
  }

  click() { this.tone(700, 0.06, 'square', 0.12); }
  // PUBG-style gunfire: every shot = crack transient + chest body + mechanical
  // clack + tail. jitter() keeps full-auto from sounding machine-stamped.
  // bright (0..1) muffles highs for distant shots, like PUBG distance falloff.
  private jitter(f: number, amt = 0.05) {
    return f * (1 + (Math.random() - 0.5) * 2 * amt);
  }
  private clack(vol: number, delay = 0.012) {
    this.tone(this.jitter(1750, 0.08), 0.03, 'triangle', vol, -600, delay);
  }
  // Pistol (P92-ish): snappy close pop, light body, quick clack.
  shootPistol(g = 1, bright = 1) {
    this.noise(0.05, 0.55 * g, 6500 * bright); // crack
    this.noise(0.12, 0.4 * g, 1400 * bright, 0.01); // body
    this.tone(this.jitter(190, 0.06), 0.1, 'square', 0.26 * g, -110);
    this.clack(0.1 * g);
  }
  // Rifle (M416-ish): punchy bark — hard transient, mid chest, bolt clack.
  shootRifle(g = 1, bright = 1) {
    this.noise(0.045, 0.6 * g, 7500 * bright); // crack
    this.noise(0.1, 0.5 * g, 1800 * bright, 0.008); // body
    this.tone(this.jitter(320, 0.05), 0.07, 'sawtooth', 0.24 * g, -180);
    this.tone(this.jitter(1300, 0.06), 0.03, 'square', 0.09 * g, 0, 0.005); // ping
    this.clack(0.13 * g, 0.02);
  }
  // Shotgun (S686-ish): massive low boom, long smoky tail, pump clack.
  shootShotgun(g = 1, bright = 1) {
    this.noise(0.06, 0.65 * g, 6000 * bright); // crack
    this.tone(this.jitter(88, 0.05), 0.34, 'sine', 0.6 * g, -40); // sub thump
    this.noise(0.34, 0.55 * g, 700 * bright, 0.01); // blast body
    this.noise(0.16, 0.22 * g, 1800 * bright, 0.1); // smoke tail
    this.clack(0.12 * g, 0.09);
  }
  // Sniper (Kar98-ish): huge crack, deep body, double canyon echo.
  shootSniper(g = 1, bright = 1) {
    this.noise(0.06, 0.7 * g, 8000 * bright); // crack
    this.tone(this.jitter(880, 0.04), 0.18, 'sawtooth', 0.3 * g, -640);
    this.noise(0.24, 0.5 * g, 1500 * bright, 0.01); // body
    this.noise(0.34, 0.17 * g, 2200 * bright, 0.17); // echo 1
    this.tone(400, 0.24, 'triangle', 0.1 * g, -240, 0.17);
    this.noise(0.4, 0.09 * g, 1800 * bright, 0.38); // echo 2
    this.clack(0.11 * g, 0.12); // bolt
  }
  // Fire dispatcher: one call, correct gun every time.
  // g = distance gain 0..1 (far shots also lose their highs, PUBG-style).
  shoot(weapon: string, g = 1) {
    const gain = Math.max(0, Math.min(1, g));
    if (gain <= 0) return;
    const bright = 0.35 + 0.65 * gain;
    if (weapon === 'rifle') this.shootRifle(gain, bright);
    else if (weapon === 'shotgun') this.shootShotgun(gain, bright);
    else if (weapon === 'sniper') this.shootSniper(gain, bright);
    else this.shootPistol(gain, bright);
  }
  // Knife: fast bandpass whoosh sweeping up.
  melee() { this.noise(0.16, 0.32, 900, 0, 'bandpass', 3800); }
  // Dry fire: empty chamber click.
  empty() { this.tone(950, 0.04, 'square', 0.12); this.tone(500, 0.05, 'square', 0.1, 0, 0.05); }
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
