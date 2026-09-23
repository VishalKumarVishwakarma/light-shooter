import Phaser from 'phaser';

// Procedural textures: realistic shading with zero asset downloads.
function cv(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, ctx: c.getContext('2d')! };
}

function put(scene: Phaser.Scene, key: string, c: HTMLCanvasElement) {
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, c);
}

// Chibi army kid: oversized olive helmet, peeking face, tiny uniformed body.
// Helmet is shared army issue; uniform/star/trim carry the team color.
function soldier(base: string, dark: string, light: string, _head: string, badge: string | null) {
  const { c, ctx } = cv(56, 56);
  const cx = 28, cy = 28;
  const skin = '#f2c89b', olive = '#5b6636', oliveDark = '#333b1f', oliveLight = '#9aa468';
  // oversized backpack (behind torso, west)
  ctx.fillStyle = oliveDark;
  const bx = cx - 22, by = cy - 8;
  ctx.fillRect(bx, by, 12, 16);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(bx + 3, by + 3); ctx.lineTo(bx + 9, by + 3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx + 3, by + 13); ctx.lineTo(bx + 9, by + 13); ctx.stroke();
  // tiny torso with radial shading
  const g = ctx.createRadialGradient(cx - 3, cy - 4, 2, cx, cy, 13);
  g.addColorStop(0, light); g.addColorStop(0.6, base); g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
  // mini vest + pouches
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(cx - 6, cy - 5, 12, 10);
  ctx.fillStyle = dark;
  ctx.fillRect(cx + 2, cy - 4, 4, 4); ctx.fillRect(cx + 2, cy + 1, 4, 4);
  // stubby arms reaching east
  ctx.strokeStyle = base; ctx.lineCap = 'round'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(cx - 1, cy - 8); ctx.lineTo(cx + 11, cy - 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 1, cy + 8); ctx.lineTo(cx + 11, cy + 4); ctx.stroke();
  ctx.fillStyle = skin; // kid hands (big, chunky)
  ctx.beginPath(); ctx.arc(cx + 12, cy - 4, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 12, cy + 4, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = light; ctx.lineWidth = 1.5; // sleeve cuffs
  ctx.beginPath(); ctx.arc(cx + 12, cy - 4, 4.1, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx + 12, cy + 4, 4.1, 0, Math.PI * 2); ctx.stroke();
  // big army helmet
  const hg = ctx.createRadialGradient(cx - 5, cy - 7, 2, cx, cy, 15);
  hg.addColorStop(0, oliveLight); hg.addColorStop(0.6, olive); hg.addColorStop(1, oliveDark);
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.arc(cx - 2, cy, 14, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = oliveDark;
  ctx.beginPath(); ctx.arc(cx - 2, cy, 14, 0, Math.PI * 2); ctx.stroke();
  // helmet band
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.arc(cx - 2, cy, 11, 0.4, Math.PI * 2 - 0.4); ctx.stroke();
  // team star decal on top
  ctx.fillStyle = light;
  star(ctx, cx - 4, cy - 6, 4);
  // cute face peeking east from under the brim
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(cx + 9, cy, 5.5, -1.2, 1.2); ctx.fill();
  ctx.fillStyle = '#20242e'; // determined eyes
  ctx.beginPath(); ctx.arc(cx + 11, cy - 2, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 11, cy + 2, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(240,120,120,0.8)'; // rosy cheek
  ctx.beginPath(); ctx.arc(cx + 8.5, cy + 3.5, 1.4, 0, Math.PI * 2); ctx.fill();
  // squad number belly patch
  if (badge) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath(); ctx.arc(cx, cy + 13, 6, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = light;
    ctx.beginPath(); ctx.arc(cx, cy + 13, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = light;
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(badge, cx, cy + 13.5);
  }
  // team trim arcs
  ctx.lineWidth = 2.5; ctx.strokeStyle = light;
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
  // chunky toy rifle: wooden stock + thick metal body
  ctx.fillStyle = '#7c4a21';
  ctx.beginPath();
  ctx.moveTo(0, 5); ctx.lineTo(12, 5); ctx.lineTo(14, 2); ctx.lineTo(2, 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5b3416';
  ctx.fillRect(0, 11, 12, 4);
  ctx.fillStyle = '#232a36';
  ctx.beginPath();
  ctx.moveTo(10, 3); ctx.lineTo(46, 3); ctx.lineTo(48, 6); ctx.lineTo(48, 12);
  ctx.lineTo(46, 15); ctx.lineTo(10, 15); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#4b5563'; // top shine
  ctx.fillRect(12, 3.5, 32, 2.5);
  ctx.fillStyle = '#161b24'; // chunky magazine
  ctx.fillRect(24, 12, 8, 6);
  ctx.fillStyle = '#9ca3af'; // sight dot + muzzle
  ctx.beginPath(); ctx.arc(36, 6, 2.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(48, 5, 4, 8);
  return c;
}

function muzzle() {
  const { c, ctx } = cv(40, 40);
  const g = ctx.createRadialGradient(20, 20, 1, 20, 20, 19);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(253,224,71,0.9)');
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
  ctx.beginPath(); ctx.arc(7, 12.5, 4.5, 0.3, Math.PI - 0.3); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(3, 6); ctx.lineTo(11, 6); ctx.stroke(); // sole line
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(3, 1, 8, 2); // top shine
  return c;
}

// ---- Battle City 8-bit tiles (40-60px, tileable) ----
function brickTile() {
  const { c, ctx } = cv(40, 40);
  ctx.fillStyle = '#3a1f14'; // mortar
  ctx.fillRect(0, 0, 40, 40);
  ctx.fillStyle = '#c65a1e'; // bricks
  ctx.fillRect(1, 1, 18, 8); ctx.fillRect(21, 1, 18, 8);
  ctx.fillRect(1, 11, 18, 8); ctx.fillRect(21, 11, 18, 8);
  ctx.fillRect(1, 21, 18, 8); ctx.fillRect(21, 21, 18, 8);
  ctx.fillRect(1, 31, 18, 8); ctx.fillRect(21, 31, 18, 8);
  ctx.fillStyle = '#e88a3c'; // top light on each brick
  for (const y of [1, 11, 21, 31]) { ctx.fillRect(1, y, 18, 2); ctx.fillRect(21, y, 18, 2); }
  return c;
}

function steelTile() {
  const { c, ctx } = cv(40, 40);
  ctx.fillStyle = '#9aa3b2';
  ctx.fillRect(0, 0, 40, 40);
  ctx.fillStyle = '#c9d1dc';
  ctx.fillRect(0, 0, 40, 18);
  ctx.strokeStyle = '#5b6470'; ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 38, 38);
  ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(40, 20); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(20, 40); ctx.stroke();
  ctx.fillStyle = '#eef2f7'; // rivets
  for (const [x, y] of [[5, 5], [35, 5], [5, 35], [35, 35], [20, 20]] as Array<[number, number]>) {
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

function bushTile() {
  const { c, ctx } = cv(60, 60);
  ctx.clearRect(0, 0, 60, 60);
  const blobs: Array<[number, number, number, string]> = [
    [14, 14, 12, '#1d4d1f'], [34, 10, 14, '#256b24'], [48, 22, 11, '#1d4d1f'],
    [10, 36, 13, '#256b24'], [30, 32, 15, '#2f7f2c'], [50, 44, 12, '#256b24'],
    [20, 52, 10, '#1d4d1f'], [42, 54, 9, '#2f7f2c'],
  ];
  for (const [x, y, r, col] of blobs) {
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.92;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  return c;
}

function waterTile() {
  const { c, ctx } = cv(60, 60);
  ctx.fillStyle = '#155e9c';
  ctx.fillRect(0, 0, 60, 60);
  ctx.strokeStyle = '#7dd3fc'; ctx.lineWidth = 2.5;
  for (const y of [12, 30, 48]) {
    ctx.beginPath();
    for (let x = 0; x <= 60; x += 6) ctx.lineTo(x, y + Math.sin(x / 8 + y) * 3);
    ctx.stroke();
  }
  return c;
}

function iceTile() {
  const { c, ctx } = cv(60, 60);
  ctx.fillStyle = '#a9d3e8';
  ctx.fillRect(0, 0, 60, 60);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(6, 44); ctx.lineTo(30, 20); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(28, 54); ctx.lineTo(54, 28); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(0, 58); ctx.lineTo(20, 38); ctx.stroke();
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
  ctx.strokeStyle = g; ctx.lineWidth = 4;
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

// GTA-flat button shell: matte face, thick bottom edge, hard top light.
// Tinted per use; shading multiplies so it takes the button color.
function btn(w: number, h: number) {
  const { c, ctx } = cv(w + 12, h + 12);
  const ox = 6, oy = 6, r = 5;
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(ox + r, oy);
    ctx.arcTo(ox + w, oy, ox + w, oy + r, r);
    ctx.arcTo(ox + w, oy + h, ox + w - r, oy + h, r);
    ctx.arcTo(ox, oy + h, ox, oy + h - r, r);
    ctx.arcTo(ox, oy, ox + r, oy, r);
    ctx.closePath();
  };
  // hard drop shadow for punch
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  path(); ctx.save(); ctx.translate(0, 3); ctx.fill(); ctx.restore();
  // matte face: barely-there gradient
  const g = ctx.createLinearGradient(0, oy, 0, oy + h);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.75, '#e8edf4');
  g.addColorStop(1, '#c3ccd9');
  ctx.fillStyle = g;
  path(); ctx.fill();
  // thick bottom edge (the GTA weight)
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fillRect(ox + 3, oy + h - 10, w - 6, 8);
  // thin top light + dark rim
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.moveTo(ox + r, oy + 1);
  ctx.lineTo(ox + w - r, oy + 1);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#0b1220';
  path(); ctx.stroke();
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
  put(scene, 'muzzle', muzzle());
  put(scene, 'glow', glow());
  put(scene, 'dot', dot());
  put(scene, 'shadow', shadow());
  put(scene, 'noise', noise());
  put(scene, 'vignette', vignette());
  put(scene, 'pool', pool());
  put(scene, 'ring', ring());
  put(scene, 'boot', boot());
  put(scene, 'scan', scan());
  put(scene, 'brickTile', brickTile());
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
export function avatarTex(scene: Phaser.Scene, team: 'me' | 'foe', idx: number) {
  const key = `soldier_${team}_${idx}`;
  if (!scene.textures.exists(key)) {
    const args = team === 'me'
      ? ['#22d3ee', '#0e7490', '#a5f3fc', '#083344']
      : ['#ef4444', '#991b1b', '#fecaca', '#450a0a'];
    put(scene, key, soldier(args[0], args[1], args[2], args[3], String(idx)));
  }
  return key;
}
