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
  const cx = 28, cy = 28;
  const skin = '#f2c89b';
  // team backpack (behind torso, west)
  ctx.fillStyle = dark;
  const bx = cx - 22, by = cy - 8;
  ctx.fillRect(bx, by, 12, 16);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(bx + 3, by + 3); ctx.lineTo(bx + 9, by + 3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx + 3, by + 13); ctx.lineTo(bx + 9, by + 13); ctx.stroke();
  // tiny torso with radial shading + dark rim
  const g = ctx.createRadialGradient(cx - 3, cy - 4, 2, cx, cy, 13);
  g.addColorStop(0, light); g.addColorStop(0.6, base); g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.stroke();
  // mini vest + pouches with flaps
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(cx - 6, cy - 5, 12, 10);
  ctx.fillStyle = dark;
  ctx.fillRect(cx + 2, cy - 4, 4, 4); ctx.fillRect(cx + 2, cy + 1, 4, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(cx + 2, cy - 4, 4, 1); ctx.fillRect(cx + 2, cy + 1, 4, 1);
  // collar + belt (uniform reads, not a plain ball)
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx + 4, cy - 9); ctx.lineTo(cx + 8, cy - 5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 4, cy + 9); ctx.lineTo(cx + 8, cy + 5); ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(cx - 9, cy - 2, 18, 3);
  ctx.fillStyle = light;
  ctx.fillRect(cx - 2, cy - 2, 3, 3); // belt buckle
  // shoulder nubs where the (separately rotating) rifle sits
  ctx.fillStyle = base;
  ctx.beginPath(); ctx.arc(cx + 1, cy - 9, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 1, cy + 9, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.arc(cx + 1, cy - 9, 4.5, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx + 1, cy + 9, 4.5, 0, Math.PI * 2); ctx.stroke();
  // big team helmet (the instant read: light crown -> base -> dark rim)
  const hg = ctx.createRadialGradient(cx - 5, cy - 7, 2, cx, cy, 15);
  hg.addColorStop(0, light); hg.addColorStop(0.6, base); hg.addColorStop(1, dark);
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.arc(cx - 2, cy, 14, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = dark;
  ctx.beginPath(); ctx.arc(cx - 2, cy, 14, 0, Math.PI * 2); ctx.stroke();
  // helmet band + white squad star
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.arc(cx - 2, cy, 11, 0.4, Math.PI * 2 - 0.4); ctx.stroke();
  // team star decal on top (bold white)
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
  star(ctx, cx - 4, cy - 6, 4.5);
  ctx.stroke();
  // helmet gloss streak (sun from the top-left)
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx - 2, cy, 10, Math.PI * 1.05, Math.PI * 1.45); ctx.stroke();
  // cute face peeking east from under the brim + chin strap
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(cx + 9, cy, 5.5, -1.2, 1.2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; // brim shadow over the face top
  ctx.beginPath(); ctx.arc(cx + 9, cy, 5.5, -1.2, -0.4); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.5; // chin strap
  ctx.beginPath(); ctx.moveTo(cx + 5, cy - 8); ctx.lineTo(cx + 8, cy + 5); ctx.stroke();
  ctx.fillStyle = '#20242e'; // determined eyes + brows
  ctx.beginPath(); ctx.arc(cx + 11, cy - 2, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 11, cy + 2, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(cx + 9, cy - 4.5, 3, 1); ctx.fillRect(cx + 9, cy + 3.5, 3, 1);
  ctx.fillStyle = 'rgba(240,120,120,0.8)'; // rosy cheek
  ctx.beginPath(); ctx.arc(cx + 8.5, cy + 3.5, 1.6, 0, Math.PI * 2); ctx.fill();
  // squad number belly patch (bold: thick rim, big numeral)
  if (badge) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath(); ctx.arc(cx, cy + 13, 7, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = light;
    ctx.beginPath(); ctx.arc(cx, cy + 13, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(badge, cx, cy + 13.5);
  }
  // team trim arcs (thick)
  ctx.lineWidth = 3.5; ctx.strokeStyle = light;
  ctx.beginPath(); ctx.arc(cx, cy, 15.5, 2.3, 2.9); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 15.5, -2.9, -2.3); ctx.stroke();
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

// BGMI flame tongue: white-hot base, orange body, red tip (points UP)
function flame() {
  const { c, ctx } = cv(28, 46);
  // outer heat shimmer
  const glow = ctx.createRadialGradient(14, 26, 2, 14, 26, 20);
  glow.addColorStop(0, 'rgba(249,115,22,0.5)');
  glow.addColorStop(1, 'rgba(249,115,22,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(14, 26, 20, 0, Math.PI * 2); ctx.fill();
  // body: teardrop
  const body = ctx.createLinearGradient(0, 44, 0, 2);
  body.addColorStop(0, '#7c2d12');
  body.addColorStop(0.35, '#ea580c');
  body.addColorStop(0.7, '#fbbf24');
  body.addColorStop(1, '#ef4444');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(14, 2);
  ctx.bezierCurveTo(22, 16, 23, 28, 14, 44);
  ctx.bezierCurveTo(5, 28, 6, 16, 14, 2);
  ctx.fill();
  // white-hot core at the base
  const core = ctx.createRadialGradient(14, 34, 1, 14, 34, 9);
  core.addColorStop(0, 'rgba(255,255,255,0.95)');
  core.addColorStop(1, 'rgba(254,240,138,0)');
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(14, 34, 9, 0, Math.PI * 2); ctx.fill();
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

// tracer bolt: hot capsule with a white core (tint colors the whole bolt)
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
  ctx.clearRect(0, 0, 60, 60);
  ctx.fillStyle = 'rgba(10,30,12,0.55)'; // deep bed
  ctx.fillRect(0, 0, 60, 60);
  const blobs: Array<[number, number, number, string]> = [
    [8, 8, 9, '#1d4d1f'], [24, 6, 11, '#256b24'], [44, 8, 10, '#1d4d1f'],
    [56, 18, 9, '#2f7f2c'], [6, 26, 11, '#256b24'], [24, 24, 13, '#2f7f2c'],
    [44, 32, 12, '#1d4d1f'], [10, 44, 11, '#256b24'], [30, 46, 12, '#37963a'],
    [52, 50, 9, '#1d4d1f'], [20, 56, 9, '#256b24'], [42, 58, 8, '#2f7f2c'],
  ];
  for (const [x, y, r, col] of blobs) {
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.94;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(190,242,150,0.5)'; // sun flecks
  for (const [x, y] of [[18, 12], [38, 28], [14, 44], [48, 14]] as Array<[number, number]>) {
    ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
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
function pill() {
  const w = 440, h = 44;
  const { c, ctx } = cv(w + 16, h + 16);
  const ox = 8, oy = 8, r = 20;
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(ox + r, oy);
    ctx.arcTo(ox + w, oy, ox + w, oy + r, r);
    ctx.arcTo(ox + w, oy + h, ox + w - r, oy + h, r);
    ctx.arcTo(ox, oy + h, ox, oy + h - r, r);
    ctx.arcTo(ox, oy, ox + r, oy, r);
    ctx.closePath();
  };
  ctx.save();
  ctx.shadowColor = 'rgba(34,211,238,0.8)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#0f172a';
  path(); ctx.fill();
  ctx.restore();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(34,211,238,0.65)';
  path(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath();
  ctx.moveTo(ox + r, oy + 1.5);
  ctx.arcTo(ox + w, oy + 1.5, ox + w, oy + 12, r);
  ctx.lineTo(ox + w, oy + 12); ctx.lineTo(ox, oy + 12); ctx.lineTo(ox, oy + 1.5);
  ctx.arcTo(ox, oy + 1.5, ox + r, oy + 1.5, r);
  ctx.closePath(); ctx.fill();
  return c;
}

export function ensureTextures(scene: Phaser.Scene) {
  put(scene, 'soldier_me', soldier('#22d3ee', '#0e7490', '#a5f3fc', '#083344', null));
  put(scene, 'soldier_foe', soldier('#ef4444', '#991b1b', '#fecaca', '#450a0a', null));
  put(scene, 'gun', gun());
  put(scene, 'bolt', bolt());
  put(scene, 'puff', puff());
  put(scene, 'flame', flame());
  put(scene, 'scorch', scorch());
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
  put(scene, 'pill', pill());
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
