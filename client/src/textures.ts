import Phaser from 'phaser';

// Procedural textures: realistic shading with zero asset downloads.
function cv(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas 2D unavailable (GPU/memory pressure?)');
  return { c, ctx };
}

function put(scene: Phaser.Scene, key: string, c: HTMLCanvasElement) {
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, c);
}

// Chibi army kid: oversized TEAM-COLORED helmet (the big read), peeking face,
// tiny uniformed body. Whole silhouette carries the squad color.
function soldier(base: string, dark: string, light: string, _head: string, badge: string | null) {
  const { c, ctx } = cv(56, 56);
  const cx = 28, cy = 28; // texture centre == the collision point
  const skin = '#f2c89b';
  const OUT = 'rgba(0,0,0,0.55)';
  const BOOT = '#2e2318', BOOT_HI = '#4c3a28';
  // CHIBI PROPORTIONS, 3/4 view facing east (the whole roster faces right --
  // only the RIFLE rotates, so the body art is fixed-orientation by design):
  //
  //   head    y -22..0    half the figure: the instant read at 32px on screen
  //   torso   y  -2..+9
  //   legs    y  +7..+14  boots on the baseline, sitting in the ground shadow
  //
  // The rifle is a separate sprite that pivots at (8,0) and carries its own
  // hands, so the arms here are SLEeves that end where the trigger hand lands at
  // rest aim. A fixed arm gripping a rotating gun would visibly detach at every
  // angle except pointing right.
  const ARM_X = 10, ARM_Y = 1; // sleeve end, in the gun hand's rest position

  // ---- contact shadow: grounds the figure, sits under the boots -------------
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 13, 11, 3.4, 0, 0, Math.PI * 2);
  ctx.fill();

  // ---- backpack (behind everything, west) -----------------------------------
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.roundRect(cx - 21, cy - 4, 11, 15, 3);
  ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(cx - 18, cy - 1); ctx.lineTo(cx - 13, cy - 1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 18, cy + 7); ctx.lineTo(cx - 13, cy + 7); ctx.stroke();

  // ---- far arm (behind the torso) ------------------------------------------
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.arc(cx - 10, cy + 1, 4.6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = 1.4; ctx.stroke();

  // ---- legs + boots ---------------------------------------------------------
  const leg = (x: number, shade: number) => {
    ctx.fillStyle = shade ? dark : base;
    ctx.beginPath(); ctx.roundRect(x, cy + 6, 5, 8, 2); ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = 1.3; ctx.stroke();
    // boot: chunky, with a lit toe and a dark sole so the feet read as FEET
    ctx.fillStyle = BOOT;
    ctx.beginPath(); ctx.roundRect(x - 0.6, cy + 12, 6.4, 4.2, 1.6); ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = 1.3; ctx.stroke();
    ctx.fillStyle = BOOT_HI;
    ctx.fillRect(x + 0.4, cy + 12.6, 4, 1.2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - 0.6, cy + 15.2, 6.4, 1.2);
  };
  leg(cx - 7, 1); // far leg, in shadow
  leg(cx + 1, 0); // near leg, lit

  // ---- torso: compact, lit from above ---------------------------------------
  const tg = ctx.createLinearGradient(0, cy - 4, 0, cy + 9);
  tg.addColorStop(0, light); tg.addColorStop(0.45, base); tg.addColorStop(1, dark);
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(cx - 9, cy - 1);
  ctx.quadraticCurveTo(cx - 10, cy + 7, cx - 6, cy + 8.5);
  ctx.lineTo(cx + 7, cy + 8.5);
  ctx.quadraticCurveTo(cx + 10.5, cy + 6, cx + 9, cy - 1);
  ctx.quadraticCurveTo(cx + 4, cy - 4.5, cx - 9, cy - 1);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = 1.8; ctx.stroke();

  // rim light down the lit (right) edge -- the cinematic separation
  ctx.strokeStyle = 'rgba(255,255,255,0.30)'; ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx + 9, cy - 1);
  ctx.quadraticCurveTo(cx + 10.5, cy + 6, cx + 7, cy + 8.5);
  ctx.stroke();

  // ---- plate carrier, pouches, belt -----------------------------------------
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.beginPath(); ctx.roundRect(cx - 7, cy - 1, 14, 8, 2); ctx.fill();
  const pouch = (x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 1.4); ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.26)';
    ctx.fillRect(x + 0.6, y + 0.5, w - 1.2, 1); // flap highlight
  };
  pouch(cx + 2, cy, 3.6, 3.2);
  pouch(cx + 2, cy + 4, 3.6, 3.2);
  pouch(cx - 6, cy + 3, 3.2, 3.6); // mag pouch
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(cx - 8, cy + 7, 16, 2.4); // belt
  ctx.fillStyle = light;
  ctx.fillRect(cx - 1.4, cy + 7, 2.8, 2.4); // buckle

  // ---- near arm: short sleeve reaching to the rifle's grip ------------------
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.moveTo(cx + 5, cy - 2);
  ctx.quadraticCurveTo(cx + ARM_X - 1, cy - 3, cx + ARM_X, cy + ARM_Y);
  ctx.quadraticCurveTo(cx + ARM_X, cy + ARM_Y + 4.5, cx + 6, cy + 4);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.moveTo(cx + 6, cy - 1.4);
  ctx.quadraticCurveTo(cx + ARM_X - 1, cy - 2.2, cx + ARM_X - 0.4, cy + ARM_Y);
  ctx.lineTo(cx + ARM_X - 0.4, cy + ARM_Y + 1.2);
  ctx.quadraticCurveTo(cx + 6, cy + 0.4, cx + 6, cy - 1.4);
  ctx.closePath(); ctx.fill();

  // ---- neck + face ----------------------------------------------------------
  ctx.fillStyle = 'rgba(0,0,0,0.30)'; // contact shadow from the helmet
  ctx.beginPath(); ctx.roundRect(cx - 3, cy - 4, 8, 4, 1.5); ctx.fill();
  const fg = ctx.createLinearGradient(cx, cy - 20, cx + 8, cy - 4);
  fg.addColorStop(0, '#ffd9b0'); fg.addColorStop(1, skin);
  ctx.fillStyle = fg;
  ctx.beginPath(); ctx.ellipse(cx + 2.5, cy - 12, 8.4, 9.2, -0.12, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = 'rgba(240,120,120,0.55)'; // blush
  ctx.beginPath(); ctx.arc(cx + 0.5, cy - 9, 2, 0, Math.PI * 2); ctx.fill();

  // ---- helmet: dome over the top, brim jutting east -------------------------
  const hg = ctx.createRadialGradient(cx - 6, cy - 18, 2, cx - 1, cy - 12, 14);
  hg.addColorStop(0, light); hg.addColorStop(0.55, base); hg.addColorStop(1, dark);
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.ellipse(cx - 1, cy - 12.5, 11.4, 10.6, 0, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = dark; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.ellipse(cx - 1, cy - 12.5, 11.4, 10.6, 0, Math.PI, 0); ctx.stroke();
  // brim, angled down-right over the eyes
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy - 13);
  ctx.quadraticCurveTo(cx + 6, cy - 18, cx + 11.5, cy - 12.5);
  ctx.quadraticCurveTo(cx + 5, cy - 10.5, cx - 9, cy - 11);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; // brim shadow across the face
  ctx.beginPath();
  ctx.ellipse(cx + 2.5, cy - 12, 8.4, 9.2, -0.12, -1.25, -0.1);
  ctx.closePath(); ctx.fill();
  // helmet band + chin strap
  ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.ellipse(cx - 1, cy - 12.5, 9.4, 8.6, 0, 0.25, Math.PI - 0.25); ctx.stroke();
  ctx.strokeStyle = OUT; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(cx - 8, cy - 8); ctx.quadraticCurveTo(cx + 1, cy - 4, cx + 7, cy - 8); ctx.stroke();
  // team star: the instant team read
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
  star(ctx, cx - 4, cy - 17, 4.2); ctx.stroke();
  // gloss streak + rim light
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx - 1, cy - 12.5, 8.6, Math.PI * 1.08, Math.PI * 1.42); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.34)'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(cx - 1, cy - 12.5, 10.8, Math.PI * 1.62, Math.PI * 1.86); ctx.stroke();

  // ---- face: determined, set slightly under the brim ------------------------
  ctx.fillStyle = '#20242e';
  ctx.beginPath(); ctx.ellipse(cx + 5, cy - 12.5, 1.5, 1.8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 0.5, cy - 13, 1.5, 1.8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(cx - 0.4, cy - 16.4, 3.4, 1.1); // brows, angled in
  ctx.fillRect(cx + 3.8, cy - 16.2, 3.4, 1.1);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.1; // confident smirk
  ctx.beginPath(); ctx.arc(cx + 3.4, cy - 8.4, 2.4, 0.35, 1.5); ctx.stroke();

  // ---- chest patch: squad number (moved off the belly onto the vest) --------
  if (badge) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath(); ctx.arc(cx - 3, cy + 3.2, 5, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = light;
    ctx.beginPath(); ctx.arc(cx - 3, cy + 3.2, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(badge, cx - 3, cy + 3.6);
  }

  // ---- team trim arcs: the outer identity read -------------------------------
  ctx.lineWidth = 3; ctx.strokeStyle = light;
  ctx.beginPath(); ctx.arc(cx, cy, 15.5, 2.35, 2.85); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 15.5, -2.85, -2.35); ctx.stroke();
  return c;
}
function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const a2 = a + Math.PI / 5;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    ctx.lineTo(x + Math.cos(a2) * r * 0.45, y + Math.sin(a2) * r * 0.45);
  }
  ctx.closePath(); ctx.fill();
}

function gun() {
  const { c, ctx } = cv(52, 18);
  // chunky toy rifle: wooden stock + gradient metal body + dark outline
  ctx.fillStyle = '#7c4a21';
  ctx.beginPath();
  ctx.moveTo(0, 5); ctx.lineTo(12, 5); ctx.lineTo(14, 2); ctx.lineTo(2, 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; // wood grain
  ctx.fillRect(2, 7, 8, 1); ctx.fillRect(1, 9.5, 9, 1);
  ctx.fillStyle = '#5b3416';
  ctx.fillRect(0, 11, 12, 4);
  const metal = ctx.createLinearGradient(0, 3, 0, 15);
  metal.addColorStop(0, '#4b5563'); metal.addColorStop(0.45, '#232a36'); metal.addColorStop(1, '#11151d');
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.moveTo(10, 3); ctx.lineTo(46, 3); ctx.lineTo(48, 6); ctx.lineTo(48, 12);
  ctx.lineTo(46, 15); ctx.lineTo(10, 15); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(10, 3); ctx.lineTo(46, 3); ctx.lineTo(48, 6); ctx.lineTo(48, 12);
  ctx.lineTo(46, 15); ctx.lineTo(10, 15); ctx.closePath(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; // top shine
  ctx.fillRect(12, 3.5, 32, 2);
  ctx.fillStyle = '#161b24'; // chunky magazine
  ctx.fillRect(24, 12, 8, 6);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(24, 12, 2, 6);
  ctx.fillStyle = '#9ca3af'; // sight dot + muzzle
  ctx.beginPath(); ctx.arc(36, 6, 2.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(35.4, 5.4, 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#6b7280';
  ctx.fillRect(48, 5, 4, 8);
  // gripping hands (ride WITH the rifle, so aim never detaches from the kid)
  const skin = '#f2c89b';
  const hand = (x: number, y: number, r: number) => {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.arc(x, y, r + 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(x - 1, y - 1, r * 0.4, 0, Math.PI * 2); ctx.fill();
  };
  hand(19, 10, 4); // trigger hand
  hand(37, 11, 3.6); // foregrip hand
  return c;
}

function egun() {
  const { c, ctx } = cv(54, 20);
  // coil rail: dark chassis, two tesla coils, arcing capacitor core
  const body = ctx.createLinearGradient(0, 3, 0, 17);
  body.addColorStop(0, '#3b2f55'); body.addColorStop(0.5, '#1b1630'); body.addColorStop(1, '#0b0916');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(8, 4); ctx.lineTo(48, 4); ctx.lineTo(51, 7); ctx.lineTo(51, 13);
  ctx.lineTo(48, 16); ctx.lineTo(8, 16); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 2; ctx.stroke();
  // grip
  ctx.fillStyle = '#241b3d';
  ctx.beginPath();
  ctx.moveTo(6, 7); ctx.lineTo(14, 7); ctx.lineTo(12, 15); ctx.lineTo(4, 15);
  ctx.closePath(); ctx.fill();
  // tesla coils (violet rings)
  for (const cx of [20, 34]) {
    const ring = ctx.createLinearGradient(0, 2, 0, 18);
    ring.addColorStop(0, '#e9d5ff'); ring.addColorStop(0.5, '#a855f7'); ring.addColorStop(1, '#4c1d95');
    ctx.fillStyle = ring;
    ctx.fillRect(cx, 2, 4, 16);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(cx, 2, 1.4, 16);
  }
  // capacitor core (glowing orb between the coils)
  const core = ctx.createRadialGradient(27, 10, 0.5, 27, 10, 9);
  core.addColorStop(0, '#ffffff'); core.addColorStop(0.35, '#c4b5fd');
  core.addColorStop(0.7, 'rgba(168,85,247,0.55)'); core.addColorStop(1, 'rgba(168,85,247,0)');
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(27, 10, 9, 0, Math.PI * 2); ctx.fill();
  // arcing filaments off the rails
  ctx.strokeStyle = 'rgba(216,180,254,0.9)'; ctx.lineWidth = 1.2;
  const arc = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.beginPath(); ctx.moveTo(x0, y0);
    const n = 4;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      ctx.lineTo(x0 + (x1 - x0) * t + (Math.random() - 0.5) * 6,
        y0 + (y1 - y0) * t + (Math.random() - 0.5) * 6);
    }
    ctx.stroke();
  };
  arc(14, 9, 24, 12); arc(30, 12, 42, 8); arc(22, 5, 32, 16);
  // emitter prongs at the muzzle
  ctx.strokeStyle = '#ddd6fe'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(50, 6); ctx.lineTo(53, 8); ctx.moveTo(50, 14); ctx.lineTo(53, 12);
  ctx.stroke();
  // hands ride the rail
  const skin = '#f2c89b';
  const hand = (x: number, y: number, r: number) => {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.arc(x, y, r + 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(x - 1, y - 1, r * 0.4, 0, Math.PI * 2); ctx.fill();
  };
  hand(18, 12, 4); hand(37, 12, 3.6);
  return c;
}

// crackling arc ball (additive): spiky lightning burst used for muzzle charge,
// the lock aura on a slowed body, and hit sparks
function zap() {
  const { c, ctx } = cv(48, 48);
  const halo = ctx.createRadialGradient(24, 24, 1, 24, 24, 23);
  halo.addColorStop(0, 'rgba(255,255,255,0.9)');
  halo.addColorStop(0.25, 'rgba(216,180,254,0.7)');
  halo.addColorStop(0.6, 'rgba(168,85,247,0.28)');
  halo.addColorStop(1, 'rgba(168,85,247,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(24, 24, 23, 0, Math.PI * 2); ctx.fill();
  // jagged spokes
  ctx.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? 'rgba(255,255,255,0.95)' : 'rgba(196,181,253,0.75)';
    ctx.lineWidth = pass ? 1.4 : 2.6;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + Math.random() * 0.4;
      const r0 = 5 + Math.random() * 3, r1 = 15 + Math.random() * 8;
      ctx.beginPath();
      ctx.moveTo(24 + Math.cos(a) * r0, 24 + Math.sin(a) * r0);
      let px = 24 + Math.cos(a) * r0, py = 24 + Math.sin(a) * r0;
      for (let s = 1; s <= 3; s++) {
        const rr = r0 + ((r1 - r0) * s) / 3;
        const aa = a + (Math.random() - 0.5) * 0.5;
        px = 24 + Math.cos(aa) * rr; py = 24 + Math.sin(aa) * rr;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
  return c;
}

function muzzle() {
  const { c, ctx } = cv(40, 40);
  const g = ctx.createRadialGradient(20, 20, 1, 20, 20, 19);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.45, 'rgba(253,224,71,0.85)');
  g.addColorStop(1, 'rgba(249,115,22,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(20, 20, 19, 0, Math.PI * 2); ctx.fill();
  // spikes
  ctx.strokeStyle = 'rgba(254,240,138,0.9)'; ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(20 + Math.cos(a) * 6, 20 + Math.sin(a) * 6);
    ctx.lineTo(20 + Math.cos(a) * 19, 20 + Math.sin(a) * 19);
    ctx.stroke();
  }
  // white-hot core + ember dots
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath(); ctx.arc(20, 20, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(253,224,71,0.9)';
  for (const [x, y] of [[9, 12], [31, 27], [28, 9]] as Array<[number, number]>) {
    ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

function glow() {
  const { c, ctx } = cv(24, 24);
  const g = ctx.createRadialGradient(12, 12, 0.5, 12, 12, 11);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(253,224,71,0.85)');
  g.addColorStop(1, 'rgba(249,115,22,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(12, 12, 11, 0, Math.PI * 2); ctx.fill();
  return c;
}

function dot() {
  const { c, ctx } = cv(12, 12);
  const g = ctx.createRadialGradient(6, 6, 0.5, 6, 6, 5.5);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(6, 6, 5.5, 0, Math.PI * 2); ctx.fill();
  return c;
}

// BGMI smoke puff: dense blotchy ball (tintable gray), soft dissipating edge
function puff() {
  const { c, ctx } = cv(48, 48);
  const g = ctx.createRadialGradient(24, 24, 2, 24, 24, 23);
  g.addColorStop(0, 'rgba(235,235,235,0.85)');
  g.addColorStop(0.55, 'rgba(220,220,220,0.5)');
  g.addColorStop(1, 'rgba(210,210,210,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(24, 24, 23, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; // lit blotches
  for (const [x, y, r] of [[17, 18, 6], [30, 26, 7], [22, 32, 5]] as Array<[number, number, number]>) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(120,120,120,0.3)'; // soot blotches
  for (const [x, y, r] of [[28, 15, 5], [16, 28, 6], [32, 34, 4]] as Array<[number, number, number]>) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

// BGMI flame tongue: blue hydrocarbon base, white-hot core, orange body,
// red tip with a heat wisp (points UP)
function flame() {
  const { c, ctx } = cv(28, 52);
  // outer heat shimmer
  const glow = ctx.createRadialGradient(14, 28, 2, 14, 28, 22);
  glow.addColorStop(0, 'rgba(249,115,22,0.5)');
  glow.addColorStop(1, 'rgba(249,115,22,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(14, 28, 22, 0, Math.PI * 2); ctx.fill();
  // body: teardrop
  const body = ctx.createLinearGradient(0, 50, 0, 8);
  body.addColorStop(0, '#7c2d12');
  body.addColorStop(0.3, '#ea580c');
  body.addColorStop(0.65, '#fbbf24');
  body.addColorStop(1, '#ef4444');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(14, 8);
  ctx.bezierCurveTo(22, 20, 23, 32, 14, 50);
  ctx.bezierCurveTo(5, 32, 6, 20, 14, 8);
  ctx.fill();
  // blue base (hydrocarbon burn)
  ctx.fillStyle = 'rgba(96,165,250,0.75)';
  ctx.beginPath();
  ctx.moveTo(9, 50); ctx.lineTo(19, 50); ctx.lineTo(16, 42); ctx.lineTo(12, 42);
  ctx.closePath(); ctx.fill();
  // white-hot core
  const core = ctx.createRadialGradient(14, 38, 1, 14, 38, 9);
  core.addColorStop(0, 'rgba(255,255,255,0.95)');
  core.addColorStop(1, 'rgba(254,240,138,0)');
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(14, 38, 9, 0, Math.PI * 2); ctx.fill();
  // heat wisp above the tip
  ctx.fillStyle = 'rgba(252,165,165,0.4)';
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.bezierCurveTo(17, 3, 17, 6, 14, 9);
  ctx.bezierCurveTo(11, 6, 11, 3, 14, 0);
  ctx.fill();
  return c;
}

// explosion scorch: dark ground stain that fades over seconds
function scorch() {
  const { c, ctx } = cv(96, 48);
  const g = ctx.createRadialGradient(48, 24, 4, 48, 24, 46);
  g.addColorStop(0, 'rgba(10,8,6,0.85)');
  g.addColorStop(0.6, 'rgba(15,12,8,0.55)');
  g.addColorStop(1, 'rgba(15,12,8,0)');
  ctx.fillStyle = g;
  ctx.save(); ctx.scale(1, 0.5); ctx.translate(0, 24);
  ctx.beginPath(); ctx.arc(48, 24, 46, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; // debris specks
  for (const [x, y, r] of [[30, 18, 2], [62, 28, 2.5], [48, 12, 1.5], [70, 16, 2]] as Array<[number, number, number]>) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

// ballistic riot shield: transparent armored glass in a steel frame (tall axis
// = perpendicular to aim). Soldier shows through the glass.
function guardTex() {
  const { c, ctx } = cv(24, 56);
  const OUT = 'rgba(0,0,0,0.6)';
  // The whole shield is one rounded silhouette. Radius 9 on a 24-wide panel is
  // the proportion of a real shield's corners, and it is what stops the sprite
  // reading as a rectangle with the corners painted in.
  const R = 9;
  const body = () => {
    ctx.beginPath();
    ctx.roundRect(1.5, 1.5, 21, 53, R);
  };

  // ---- cast edge, so the shield sits in front of the carrier ---------------
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.roundRect(2.5, 3, 21, 53, R);
  ctx.fill();

  // ---- clear polycarbonate: a barely-there tint, lighter through the middle
  const glass = ctx.createLinearGradient(1.5, 0, 22.5, 0);
  glass.addColorStop(0, 'rgba(150,195,225,0.34)');
  glass.addColorStop(0.45, 'rgba(214,240,252,0.10)');
  glass.addColorStop(1, 'rgba(150,195,225,0.34)');
  ctx.fillStyle = glass;
  body();
  ctx.fill();

  // ---- slim frame: a 2.5px metal edge, bright on top, dark underneath ------
  const frame = ctx.createLinearGradient(0, 1.5, 0, 54.5);
  frame.addColorStop(0, '#c3ccd9');
  frame.addColorStop(0.35, '#7d8797');
  frame.addColorStop(0.8, '#454d5a');
  frame.addColorStop(1, '#2b323c');
  ctx.strokeStyle = frame;
  ctx.lineWidth = 2.5;
  body();
  ctx.stroke();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 0.9;
  body();
  ctx.stroke();

  // ---- viewport: the signature feature, high on the panel -------------------
  const vx = 4.5, vy = 8.5, vw = 15, vh = 6.5;
  ctx.fillStyle = 'rgba(8,20,34,0.42)'; // the slot reads darker than the glass
  ctx.beginPath();
  ctx.roundRect(vx, vy, vw, vh, 3);
  ctx.fill();
  ctx.strokeStyle = '#aeb8c6'; // machined surround
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(vx - 0.6, vy - 0.6, vw + 1.2, vh + 1.2, 3.4);
  ctx.stroke();
  // a highlight along the top lip, so it reads as a cut edge
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(vx + 1.4, vy + 0.7);
  ctx.lineTo(vx + vw - 1.4, vy + 0.7);
  ctx.stroke();

  // ---- grip: a handle bar with a forearm cuff, at the bottom --------------
  ctx.fillStyle = '#39414d';
  ctx.beginPath();
  ctx.roundRect(6, 42, 12, 3.4, 1.4);
  ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = 0.8; ctx.stroke();
  ctx.fillStyle = '#8d97a5'; // knuckles
  ctx.beginPath();
  ctx.roundRect(6, 42, 12, 1.1, 0.5);
  ctx.fill();
  // the cuff: two straps running down to the bottom rail
  ctx.strokeStyle = '#4c5561';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(8.4, 45.4); ctx.lineTo(8, 50.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(15.6, 45.4); ctx.lineTo(16, 50.5); ctx.stroke();
  ctx.fillStyle = '#39414d';
  ctx.beginPath();
  ctx.roundRect(7.2, 49.4, 9.6, 2.2, 1);
  ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.stroke();

  // ---- one soft reflection band, kept weak so the carrier reads through ---
  ctx.save();
  body();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.moveTo(3, 54); ctx.lineTo(12, 2); ctx.lineTo(16.5, 2); ctx.lineTo(7.5, 54);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  ctx.moveTo(11, 54); ctx.lineTo(20, 2); ctx.lineTo(22, 2); ctx.lineTo(13, 54);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // ---- two small frame bolts, and nothing else: no spine, no rivet grid ----
  ctx.fillStyle = '#cbd3de';
  for (const [x, y] of [[12, 4.6], [12, 51.4]] as Array<[number, number]>) {
    ctx.beginPath(); ctx.arc(x, y, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.6; ctx.stroke();
  }
  return c;
}

function bolt() {
  const { c, ctx } = cv(40, 14);
  const g = ctx.createLinearGradient(0, 0, 40, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(1, 2, 38, 10, 5);
  else ctx.rect(1, 2, 38, 10);
  ctx.fill();
  // bright core line
  const core = ctx.createLinearGradient(0, 0, 40, 0);
  core.addColorStop(0, 'rgba(255,255,255,0)');
  core.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  core.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = core;
  ctx.fillRect(4, 6, 34, 3);
  return c;
}

function shadow() {
  const { c, ctx } = cv(64, 32);
  const g = ctx.createRadialGradient(32, 16, 2, 32, 16, 30);
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.save(); ctx.scale(1, 0.5); ctx.translate(0, 16);
  ctx.beginPath(); ctx.arc(32, 16, 30, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  return c;
}

function noise() {
  const { c, ctx } = cv(128, 128);
  const img = ctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 140 + Math.floor(Math.random() * 115);
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v;
    img.data[i + 3] = 22;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function vignette() {
  const { c, ctx } = cv(480, 300);
  const g = ctx.createRadialGradient(240, 150, 90, 240, 150, 290);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 480, 300);
  return c;
}

// little army boot, faces +y (movement direction handled by rotating holder)
function boot() {
  const { c, ctx } = cv(14, 18);
  ctx.fillStyle = '#232a36';
  ctx.beginPath();
  ctx.moveTo(2, 0); ctx.lineTo(12, 0); ctx.lineTo(13, 12);
  ctx.arcTo(13, 17, 8, 17, 4); ctx.arcTo(1, 17, 1, 12, 4);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#4b5563'; // toe cap
  ctx.beginPath(); ctx.arc(7, 12.5, 5, 0.3, Math.PI - 0.3); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(3, 6); ctx.lineTo(11, 6); ctx.stroke(); // sole line
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(3, 1, 8, 2); // top shine
  return c;
}

// ---- Battle City 8-bit tiles (40-60px, tileable) ----
function brickTile(variant: number) {
  const { c, ctx } = cv(40, 40);
  ctx.fillStyle = '#33190f'; // mortar
  ctx.fillRect(0, 0, 40, 40);
  const base = variant % 2 ? '#c65a1e' : '#b44e18';
  const lite = variant % 2 ? '#ef9a4e' : '#e88a3c';
  const off = variant % 2 ? 10 : 0; // staggered courses
  ctx.fillStyle = base;
  for (let row = 0; row < 4; row++) {
    const y = 1 + row * 10;
    for (let k = -1; k < 3; k++) {
      const x = ((k * 20 + (row % 2 ? off : 0)) % 40 + 40) % 40;
      ctx.fillRect(x + 1, y, 18, 8);
    }
  }
  ctx.fillStyle = lite; // top light per course
  for (let row = 0; row < 4; row++) {
    const y = 1 + row * 10;
    for (let k = -1; k < 3; k++) {
      const x = ((k * 20 + (row % 2 ? off : 0)) % 40 + 40) % 40;
      ctx.fillRect(x + 1, y, 18, 2);
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; // chips + wear
  const chips: Array<[number, number, number, number]> = variant % 2
    ? [[5, 14, 3, 2], [28, 33, 4, 2], [16, 24, 2, 3]]
    : [[12, 4, 3, 2], [33, 22, 2, 3], [6, 34, 4, 2]];
  for (const [x, y, w, h] of chips) ctx.fillRect(x, y, w, h);
  return c;
}

function steelTile() {
  const { c, ctx } = cv(40, 40);
  ctx.fillStyle = '#8b95a5';
  ctx.fillRect(0, 0, 40, 40);
  ctx.fillStyle = '#c9d1dc'; // brushed top half
  ctx.fillRect(0, 0, 40, 18);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; // brushed lines
  for (const y of [4, 8, 12, 16, 24, 28, 32, 36]) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(40, y); ctx.stroke();
  }
  ctx.strokeStyle = '#525b68'; ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 38, 38);
  ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(40, 20); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(20, 40); ctx.stroke();
  ctx.fillStyle = '#eef2f7'; // rivets with glint
  for (const [x, y] of [[5, 5], [35, 5], [5, 35], [35, 35], [20, 20]] as Array<[number, number]>) {
    ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x - 0.7, y - 0.7, 0.9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#eef2f7';
  }
  return c;
}

function bushTile() {
  const { c, ctx } = cv(60, 60);
  const S = 60;
  // Deterministic, so the canopy is byte-identical every run (textures are
  // generated once and cached; Math.random here would churn the atlas).
  let seed = 0x2f6b2d1;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  // Wrap-aware draw. A clump within r of an edge is redrawn on the far side, so
  // the 60px repeat has no seam: the rects are 4.3 x 2 tiles, which would
  // otherwise show a grid straight across the forest.
  const wrap = (x: number, y: number, r: number, draw: (px: number, py: number) => void) => {
    const xs = x - r < 0 ? [x, x + S] : x + r > S ? [x, x - S] : [x];
    const ys = y - r < 0 ? [y, y + S] : y + r > S ? [y, y - S] : [y];
    for (const px of xs) for (const py of ys) draw(px, py);
  };

  // ---- forest floor: the dark bed the canopy sits on ------------------------
  ctx.fillStyle = '#0b1f10';
  ctx.fillRect(0, 0, S, S);
  // leaf litter, so the bed is not a flat void where it shows through
  for (let i = 0; i < 14; i++) {
    const x = rnd() * S, y = rnd() * S, r = 0.7 + rnd() * 1.5;
    wrap(x, y, r + 1, (px, py) => {
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(74,52,28,0.5)' : 'rgba(20,42,22,0.6)';
      ctx.beginPath(); ctx.ellipse(px, py, r * 1.6, r, rnd() * 3, 0, Math.PI * 2); ctx.fill();
    });
  }

  // ---- one clump of foliage -------------------------------------------------
  // lit: the upper-left face; mid: the body; dark: the underside/occlusion.
  // The leaves around the rim are what break the circular outline.
  const clump = (x: number, y: number, r: number, lit: string, mid: string, dark: string,
    leafA: string, leafB: string, leaves: number) => {
    wrap(x, y, r * 1.35, (px, py) => {
      // body: lit from the upper left, falling to dark at the lower right
      const g = ctx.createRadialGradient(px - r * 0.38, py - r * 0.42, r * 0.1, px, py, r * 1.06);
      g.addColorStop(0, lit);
      g.addColorStop(0.45, mid);
      g.addColorStop(1, dark);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      // occlusion crescent: the underside, where this clump meets the one behind
      ctx.fillStyle = 'rgba(4,16,8,0.30)';
      ctx.beginPath();
      ctx.arc(px, py, r * 0.99, 0.25, Math.PI * 1.25);
      ctx.closePath(); ctx.fill();
    });
    // leaves: small teardrops around the rim, denser on the lit side, each
    // sticking out past the circle so the silhouette is ragged
    for (let i = 0; i < leaves; i++) {
      const a = (i / leaves) * Math.PI * 2 + rnd() * 0.5;
      const rr = r * (0.9 + rnd() * 0.22);
      const lx = x + Math.cos(a) * rr, ly = y + Math.sin(a) * rr;
      const ls = 1.5 + rnd() * 1.7;
      // the lit upper-left quadrant gets the brighter leaf
      const bright = Math.cos(a) < -0.15 && Math.sin(a) < 0.15;
      wrap(lx, ly, ls + 1, (px, py) => {
        ctx.fillStyle = bright ? leafB : leafA;
        ctx.beginPath();
        ctx.ellipse(px, py, ls * 1.5, ls, a, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    // specular dabs: the wet highlight on the upper-left leaves
    for (let i = 0; i < 3; i++) {
      const a = -2.6 + rnd() * 1.5;
      const rr = r * (0.35 + rnd() * 0.4);
      const sx = x + Math.cos(a) * rr, sy = y + Math.sin(a) * rr;
      wrap(sx, sy, 2, (px, py) => {
        ctx.fillStyle = 'rgba(196,236,150,0.55)';
        ctx.beginPath(); ctx.ellipse(px, py, 1.5, 0.9, a, 0, Math.PI * 2); ctx.fill();
      });
    }
  };

  // ---- the canopy: back clumps first, front clumps over them ---------------
  // Back: dark, small, low in the tile -- the shadowed understorey.
  clump(14, 40, 13, '#1d4423', '#173a1f', '#0d2614', '#1a3d1f', '#24512a', 10);
  clump(46, 44, 12, '#1d4423', '#173a1f', '#0d2614', '#1a3d1f', '#24512a', 9);
  clump(30, 12, 12, '#1a3f21', '#153520', '#0c2413', '#18381d', '#214c28', 9);
  // Middle: the body of the canopy, offset so nothing is concentric.
  clump(30, 32, 16, '#3a7534', '#2a5c29', '#16361c', '#2a5f2b', '#3d7f39', 14);
  clump(8, 16, 12, '#356d31', '#265527', '#14311a', '#265427', '#387a34', 10);
  clump(54, 20, 11, '#356d31', '#265527', '#14311a', '#265427', '#387a34', 9);
  // Front: the two big lit masses, up and toward the light, drawn last so they
  // overlap everything and cast the occlusion that gives the canopy depth.
  clump(22, 24, 17, '#4c8f40', '#356f31', '#1b401f', '#3a7534', '#59a04a', 15);
  clump(44, 34, 14, '#48893d', '#31692e', '#183c1d', '#357030', '#529a45', 12);

  // ---- gaps in the canopy, so it is not a solid mass ----------------------
  // A real crown is not continuous: a few holes let the dark bed through and
  // give the eye somewhere to rest.
  for (const [x, y, r] of [[37, 52, 3.4], [12, 36, 2.6], [52, 8, 2.2]] as Array<[number, number, number]>) {
    wrap(x, y, r, (px, py) => {
      ctx.fillStyle = 'rgba(6,20,10,0.72)';
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      // a lit leaf edge on the upper side of each gap, or it reads as a stain
      ctx.strokeStyle = 'rgba(120,170,90,0.4)';
      ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.arc(px, py, r, Math.PI * 0.9, Math.PI * 1.9); ctx.stroke();
    });
  }
  return c;
}

function waterTile() {
  const { c, ctx } = cv(60, 60);
  const deep = ctx.createLinearGradient(0, 0, 0, 60);
  deep.addColorStop(0, '#1d6fae');
  deep.addColorStop(0.5, '#155e9c');
  deep.addColorStop(1, '#0e4a80');
  ctx.fillStyle = deep;
  ctx.fillRect(0, 0, 60, 60);
  ctx.strokeStyle = 'rgba(2,20,40,0.5)'; ctx.lineWidth = 3; // dark under-wave
  for (const y of [14, 32, 50]) {
    ctx.beginPath();
    for (let x = 0; x <= 60; x += 6) ctx.lineTo(x, y + 2 + Math.sin(x / 8 + y) * 3);
    ctx.stroke();
  }
  ctx.strokeStyle = '#bae6fd'; ctx.lineWidth = 2.5; // foam crest
  for (const y of [12, 30, 48]) {
    ctx.beginPath();
    for (let x = 0; x <= 60; x += 6) ctx.lineTo(x, y + Math.sin(x / 8 + y) * 3);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; // sparkle dots
  for (const [x, y] of [[10, 8], [34, 22], [50, 40], [18, 52]] as Array<[number, number]>) {
    ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

function iceTile() {
  const { c, ctx } = cv(60, 60);
  const sheen = ctx.createLinearGradient(0, 0, 60, 60);
  sheen.addColorStop(0, '#c4e2f2');
  sheen.addColorStop(0.5, '#a9d3e8');
  sheen.addColorStop(1, '#8fc3dd');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, 60, 60);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(6, 44); ctx.lineTo(30, 20); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(28, 54); ctx.lineTo(54, 28); ctx.stroke();
  ctx.strokeStyle = 'rgba(70,130,170,0.55)'; ctx.lineWidth = 1.5; // cracks
  ctx.beginPath(); ctx.moveTo(4, 10); ctx.lineTo(22, 26); ctx.lineTo(16, 44); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(40, 6); ctx.lineTo(48, 24); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(0, 58); ctx.lineTo(20, 38); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; // glints
  for (const [x, y] of [[14, 32], [44, 44], [52, 12]] as Array<[number, number]>) {
    ctx.beginPath(); ctx.arc(x, y, 1.3, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

function rubble() {
  const { c, ctx } = cv(60, 44);
  ctx.fillStyle = '#7a3a1a';
  const chunks: Array<[number, number, number, number]> = [
    [4, 22, 16, 12], [22, 12, 18, 14], [42, 22, 14, 12], [14, 30, 20, 10], [36, 32, 16, 8],
  ];
  for (const [x, y, w, h] of chunks) {
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#e88a3c';
    ctx.fillRect(x, y, w, 2);
    ctx.fillStyle = '#7a3a1a';
  }
  return c;
}

// faint scanlines overlay for the war-room HUD feel
function halo() {
  const { c, ctx } = cv(128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return c;
}

function scan() {
  const { c, ctx } = cv(4, 4);
  ctx.clearRect(0, 0, 4, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, 4, 1);
  return c;
}

function ring() {
  const { c, ctx } = cv(72, 72);
  ctx.save();
  ctx.shadowColor = 'rgba(250,204,21,0.9)';
  ctx.shadowBlur = 10;
  const g = ctx.createLinearGradient(0, 0, 72, 72);
  g.addColorStop(0, '#fef08a'); g.addColorStop(0.5, '#facc15'); g.addColorStop(1, '#ea580c');
  ctx.strokeStyle = g; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(36, 36, 27, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = 'rgba(250,204,21,0.10)';
  ctx.beginPath(); ctx.arc(36, 36, 25, 0, Math.PI * 2); ctx.fill();
  return c;
}

function pool() {
  const { c, ctx } = cv(64, 36);
  const g = ctx.createRadialGradient(32, 18, 2, 32, 18, 30);
  g.addColorStop(0, 'rgba(127,29,29,0.85)');
  g.addColorStop(0.6, 'rgba(127,29,29,0.5)');
  g.addColorStop(1, 'rgba(127,29,29,0)');
  ctx.fillStyle = g;
  ctx.save(); ctx.scale(1, 0.55); ctx.translate(0, 15);
  ctx.beginPath(); ctx.arc(32, 18, 30, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // clots
  ctx.fillStyle = 'rgba(69,10,10,0.8)';
  for (const [x, y, r] of [[20, 14, 3], [44, 20, 2.5], [32, 26, 2]] as Array<[number, number, number]>) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

function menubg() {
  const { c, ctx } = cv(64, 600);
  const g = ctx.createLinearGradient(0, 0, 0, 600);
  g.addColorStop(0, '#101a30');
  g.addColorStop(0.5, '#0b0e14');
  g.addColorStop(1, '#070a10');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 600);
  return c;
}

// Premium HQ button shell: sculpted face, gloss + sheen, deep bottom weight.
// Kept light-based so per-use tint() colors it cleanly (green/blue/gold).
function btn(w: number, h: number) {
  const { c, ctx } = cv(w + 16, h + 16);
  const ox = 8, oy = 8, r = 12;
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(ox + r, oy);
    ctx.arcTo(ox + w, oy, ox + w, oy + r, r);
    ctx.arcTo(ox + w, oy + h, ox + w - r, oy + h, r);
    ctx.arcTo(ox, oy + h, ox, oy + h - r, r);
    ctx.arcTo(ox, oy, ox + r, oy, r);
    ctx.closePath();
  };
  // soft drop shadow (twice for diffusion)
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  path(); ctx.save(); ctx.translate(0, 4); ctx.fill(); ctx.restore();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  path(); ctx.save(); ctx.translate(0, 2); ctx.fill(); ctx.restore();
  // sculpted face: bright crown -> mid -> deep base
  const g = ctx.createLinearGradient(0, oy, 0, oy + h);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, '#eef2f8');
  g.addColorStop(0.8, '#c6cfdd');
  g.addColorStop(1, '#a9b4c8');
  ctx.fillStyle = g;
  path(); ctx.fill();
  // top gloss: rounded highlight band
  ctx.save();
  path(); ctx.clip();
  const gloss = ctx.createLinearGradient(0, oy, 0, oy + h * 0.52);
  gloss.addColorStop(0, 'rgba(255,255,255,0.85)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(ox, oy, w, h * 0.52);
  // diagonal sheen
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.moveTo(ox + w * 0.12, oy + h);
  ctx.lineTo(ox + w * 0.34, oy);
  ctx.lineTo(ox + w * 0.46, oy);
  ctx.lineTo(ox + w * 0.24, oy + h);
  ctx.closePath(); ctx.fill();
  // bottom weight bar (the GTA heft)
  ctx.fillStyle = 'rgba(2,6,23,0.30)';
  ctx.fillRect(ox + 6, oy + h - 13, w - 12, 9);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(ox + 6, oy + h - 14, w - 12, 1.5);
  ctx.restore();
  // crisp top light + dark rim
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.moveTo(ox + r, oy + 1.2);
  ctx.lineTo(ox + w - r, oy + 1.2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#0b1220';
  path(); ctx.stroke();
  // inner rim light (bottom bounce)
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(ox + r, oy + h - 1.2);
  ctx.lineTo(ox + w - r, oy + h - 1.2);
  ctx.stroke();
  return c;
}

// dark glass pill for the lobby code
export function ensureTextures(scene: Phaser.Scene) {
  put(scene, 'soldier_me', soldier('#22d3ee', '#0e7490', '#a5f3fc', '#083344', null));
  put(scene, 'soldier_foe', soldier('#ef4444', '#991b1b', '#fecaca', '#450a0a', null));
  put(scene, 'gun', gun());
  put(scene, 'egun', egun());
  put(scene, 'zap', zap());
  put(scene, 'bolt', bolt());
  put(scene, 'puff', puff());
  put(scene, 'flame', flame());
  put(scene, 'scorch', scorch());
  put(scene, 'guard', guardTex());
  put(scene, 'muzzle', muzzle());
  put(scene, 'glow', glow());
  put(scene, 'dot', dot());
  put(scene, 'shadow', shadow());
  put(scene, 'noise', noise());
  put(scene, 'halo', halo());
  put(scene, 'vignette', vignette());
  put(scene, 'pool', pool());
  put(scene, 'ring', ring());
  put(scene, 'boot', boot());
  put(scene, 'brickTileA', brickTile(0));
  put(scene, 'brickTileB', brickTile(1));
  put(scene, 'scan', scan());
  put(scene, 'steelTile', steelTile());
  put(scene, 'bushTile', bushTile());
  put(scene, 'waterTile', waterTile());
  put(scene, 'iceTile', iceTile());
  put(scene, 'rubble', rubble());
  put(scene, 'menubg', menubg());
  put(scene, 'btn320', btn(320, 56));
  put(scene, 'btn220', btn(220, 52));
}

// Numbered squad avatar, generated lazily per team/index (join order 1-8).
// Self is always cyan; every foe gets a distinct uniform from the wheel.
const FOE_COLORS: Array<[string, string, string, string, number]> = [
  // base, dark, light, label-css, blip-num
  ['#ef4444', '#991b1b', '#fecaca', '#f87171', 0xef4444], // red
  ['#f97316', '#9a3412', '#fed7aa', '#fb923c', 0xf97316], // orange
  ['#a855f7', '#6b21a8', '#ddd6fe', '#c084fc', 0xa855f7], // violet
  ['#eab308', '#854d0e', '#fef08a', '#facc15', 0xeab308], // gold
  ['#ec4899', '#9d174d', '#fbcfe8', '#f9a8d4', 0xec4899], // pink
  ['#84cc16', '#3f6212', '#d9f99d', '#bef264', 0x84cc16], // lime
  ['#3b82f6', '#1e3a8a', '#bfdbfe', '#93c5fd', 0x3b82f6], // blue
  ['#10b981', '#065f46', '#a7f3d0', '#6ee7b7', 0x10b981], // emerald
];
export function foeColor(idx: number): [string, string, string, string, number] {
  return FOE_COLORS[(Math.max(1, idx) - 1) % FOE_COLORS.length];
}
export function avatarTex(scene: Phaser.Scene, team: 'me' | 'foe', idx: number) {
  const key = `soldier_${team}_${idx}`;
  if (!scene.textures.exists(key)) {
    const args: string[] = team === 'me'
      ? ['#22d3ee', '#0e7490', '#a5f3fc', '#083344']
      : foeColor(idx).slice(0, 4).map(String);
    put(scene, key, soldier(args[0], args[1], args[2], args[3], String(idx)));
  }
  return key;
}
