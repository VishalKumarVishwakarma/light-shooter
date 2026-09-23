// Shared arena layout (Battle City style). NOTE: client/src/map.ts is a duplicate — keep in sync.
export type Rect = { x: number; y: number; w: number; h: number };

export const WORLD = { w: 1600, h: 1200 };
export const W = WORLD.w, H = WORLD.h;
export const SPEED = 260, RADIUS = 16;
// single muzzle point shared by server spawn + client flash (gun tip)
export const MUZZLE = 46;

// weapon rules: single source of truth (server enforces, client mirrors timing)
export const WEAPONS: Record<string, {
  dmg: number; interval: number; speed: number; life: number;
  auto: boolean; clip: number; reload: number;
}> = {
  pistol: { dmg: 25, interval: 0.28, speed: 700, life: 1.2, auto: false, clip: 12, reload: 1.2 },
  rifle: { dmg: 15, interval: 0.11, speed: 850, life: 1.0, auto: true, clip: 30, reload: 2 },
};

export const SPAWNS: Array<[number, number]> = [
  [200, 200], [1400, 200], [200, 1000], [1400, 1000],
  [800, 200], [800, 1000], [200, 420], [1400, 420],
];

// STEEL: indestructible, blocks players + bullets
export const STEEL: Rect[] = [
  { x: 700, y: 500, w: 200, h: 200 }, // center fortress
  { x: 60, y: 60, w: 80, h: 80 }, // corners
  { x: 1460, y: 60, w: 80, h: 80 },
  { x: 60, y: 1060, w: 80, h: 80 },
  { x: 1460, y: 1060, w: 80, h: 80 },
];

// BRICKS: destructible cover, 3 hits each (ids br_0.. in array order)
export const BRICK_HP = 3;
export const BRICKS: Rect[] = [
  { x: 300, y: 300, w: 200, h: 40 }, // upper covers
  { x: 1100, y: 300, w: 200, h: 40 },
  { x: 300, y: 860, w: 200, h: 40 }, // lower covers
  { x: 1100, y: 860, w: 200, h: 40 },
  { x: 600, y: 110, w: 140, h: 50 }, // top nook
  { x: 860, y: 1040, w: 140, h: 50 }, // bottom nook
  { x: 280, y: 540, w: 60, h: 120 }, // mid pillars
  { x: 1260, y: 540, w: 60, h: 120 },
];

// WATER: blocks players, bullets fly over
export const WATER: Rect[] = [
  { x: 0, y: 560, w: 440, h: 80 }, // west river (bridge gap x440-640)
  { x: 1160, y: 560, w: 440, h: 80 }, // east river
];

// ICE: slippery — velocity lags behind input (drift)
export const ICE: Rect[] = [
  { x: 420, y: 860, w: 180, h: 120 },
  { x: 1000, y: 860, w: 180, h: 120 },
];

// BUSH: stealth forest — no collision, drawn OVER players (hides them)
export const BUSH: Rect[] = [
  { x: 940, y: 380, w: 260, h: 120 },
  { x: 400, y: 700, w: 260, h: 120 },
  { x: 1150, y: 150, w: 200, h: 110 },
];

// fixed pickup spawns: [kind, x, y]
export const PICKUP_POINTS: Array<['health' | 'rifle' | 'ammo', number, number]> = [
  ['rifle', 400, 200],
  ['health', 200, 450],
  ['rifle', 1200, 1000],
  ['ammo', 800, 420],
  ['health', 1200, 200],
];

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function inRect(x: number, y: number, rects: Rect[]) {
  for (const rc of rects) {
    if (x >= rc.x && x <= rc.x + rc.w && y >= rc.y && y <= rc.y + rc.h) return true;
  }
  return false;
}

// Push a circle out of every overlapping rect. No sliding — server authoritative.
export function collideCircle(px: number, py: number, r: number, rects: Rect[]) {
  let x = px, y = py;
  for (const rc of rects) {
    const cx = clamp(x, rc.x, rc.x + rc.w);
    const cy = clamp(y, rc.y, rc.y + rc.h);
    const dx = x - cx, dy = y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    if (d2 === 0) {
      const l = x - rc.x, rr = rc.x + rc.w - x, t = y - rc.y, bb = rc.y + rc.h - y;
      const m = Math.min(l, rr, t, bb);
      if (m === l) x = rc.x - r;
      else if (m === rr) x = rc.x + rc.w + r;
      else if (m === t) y = rc.y - r;
      else y = rc.y + rc.h + r;
    } else {
      const d = Math.sqrt(d2);
      x = cx + (dx / d) * r;
      y = cy + (dy / d) * r;
    }
  }
  return { x, y };
}

export function pointInWall(x: number, y: number, rects: Rect[] = STEEL) {
  return inRect(x, y, rects);
}

// One movement integrator shared by server + client prediction.
// Ice: velocity eases toward input (drift). Everywhere else: instant.
export function stepMove(
  px: number, py: number, vx: number, vy: number,
  dx: number, dy: number, dt: number, solids: Rect[], onIce: boolean,
) {
  const k = onIce ? Math.min(1, dt * 5) : 1;
  const nvx = vx + (dx * SPEED - vx) * k;
  const nvy = vy + (dy * SPEED - vy) * k;
  const nx = clamp(px + nvx * dt, 20, W - 20);
  const ny = clamp(py + nvy * dt, 20, H - 20);
  const f = collideCircle(nx, ny, RADIUS, solids);
  return { x: f.x, y: f.y, vx: nvx, vy: nvy };
}
