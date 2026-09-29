// Shared arena layout (Battle City style). NOTE: client/src/map.ts is a duplicate — keep in sync.
export type Rect = { x: number; y: number; w: number; h: number };

export const WORLD = { w: 1600, h: 1200 };
export const W = WORLD.w, H = WORLD.h;
export const SPEED = 260, RADIUS = 16;
// single muzzle point shared by server spawn + client flash (gun tip)
export const MUZZLE = 46;

// weapon rules: single source of truth (server enforces, client mirrors timing)
// effective range = speed x life: shotgun 250 < pistol 525 < electric 920 <
// rifle 1080 < laser 1260 < sniper 1690 (cross-map). Every gun is unique.
// One world tile is 60px, so the electric rail covers 800 + 2 tiles.
export const WEAPONS: Record<string, {
  dmg: number; interval: number; speed: number; life: number;
  auto: boolean; clip: number; reload: number; pellets?: number; spread?: number;
}> = {
  pistol: { dmg: 25, interval: 0.28, speed: 700, life: 0.75, auto: false, clip: 12, reload: 1.2 },
  rifle: { dmg: 15, interval: 0.11, speed: 900, life: 1.2, auto: true, clip: 30, reload: 2 },
  shotgun: { dmg: 12, interval: 0.9, speed: 780, life: 0.32, auto: false, clip: 6, reload: 2.5, pellets: 6, spread: 0.18 },
  sniper: { dmg: 100, interval: 1.6, speed: 1300, life: 1.3, auto: false, clip: 5, reload: 3 },
  laser: { dmg: 12, interval: 0.09, speed: 1400, life: 0.9, auto: true, clip: 25, reload: 2.2 },
  electric: { dmg: 12, interval: 0.14, speed: 1000, life: 0.92, auto: true, clip: 30, reload: 2.2 },
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
  { x: 725, y: 815, w: 30, h: 70 }, // maze heart pillars
  { x: 845, y: 815, w: 30, h: 70 },
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
  { x: 280, y: 470, w: 60, h: 80 }, // mid pillars: clear of the walk lane above
  // and the river below, so neither is sealed and neither lane is blocked
  { x: 1260, y: 470, w: 60, h: 80 },
  { x: 600, y: 740, w: 160, h: 30 }, // maze north wall (gap x760-840)
  { x: 840, y: 740, w: 160, h: 30 },
  { x: 600, y: 925, w: 160, h: 30 }, // maze south wall (gap x760-840)
  { x: 840, y: 925, w: 160, h: 30 },
  { x: 680, y: 770, w: 30, h: 130 }, // maze inner west
  { x: 890, y: 770, w: 30, h: 130 }, // maze inner east
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
export const PICKUP_POINTS: Array<
  ['health' | 'rifle' | 'ammo' | 'shotgun' | 'sniper' | 'laser' | 'electric' | 'shield' | 'speed' | 'grenade' | 'smoke' | 'molly', number, number]
> = [
  ['rifle', 400, 200],
  ['health', 200, 450],
  ['rifle', 1200, 1000],
  ['ammo', 800, 420],
  ['health', 1200, 200],
  ['shotgun', 300, 200],
  ['sniper', 1350, 300], // east perch, clear of the bush so the ring shows
  ['sniper', 250, 1000], // west twin — both teams get a long gun
  ['laser', 800, 300], // center-north lab — fastest gun on the map
  ['electric', 1100, 1000], // south-east lab — locks victims down
  ['grenade', 200, 700], // west woods edge — pierces shields
  ['smoke', 1400, 700], // east woods edge — hides you
  ['molly', 800, 1100], // south gate — fire burns through shields
  ['shield', 200, 320],
  ['speed', 1400, 450],
  ['rifle', 800, 985], // maze-heart prize (grab it threading the south gap)
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
// How far a circle is buried in a rect set (0 = free).
function penDepth(x: number, y: number, r: number, rects: Rect[]) {
  let worst = 0;
  for (const rc of rects) {
    const cx = clamp(x, rc.x, rc.x + rc.w);
    const cy = clamp(y, rc.y, rc.y + rc.h);
    const d = Math.hypot(x - cx, y - cy);
    if (d < r && r - d > worst) worst = r - d;
  }
  return worst;
}

// The single position that would clear one rect.
function escape(x: number, y: number, r: number, rc: Rect): [number, number] {
  const cx = clamp(x, rc.x, rc.x + rc.w);
  const cy = clamp(y, rc.y, rc.y + rc.h);
  const dx = x - cx, dy = y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 === 0) {
    const l = x - rc.x, rr = rc.x + rc.w - x, t = y - rc.y, bb = rc.y + rc.h - y;
    const m = Math.min(l, rr, t, bb);
    if (m === l) return [rc.x - r, y];
    if (m === rr) return [rc.x + rc.w + r, y];
    if (m === t) return [x, rc.y - r];
    return [x, rc.y + rc.h + r];
  }
  const d = Math.sqrt(d2);
  return [cx + (dx / d) * r, cy + (dy / d) * r];
}

// Settle a body that is already buried. Search the space the walls are arguing
// over - each wall's demand, every midpoint between two demands (for two walls
// squeezing from opposite sides that midpoint IS the least-buried spot
// available), and the centroid - and keep whichever is shallowest. Ties take the
// earlier candidate so the result stays deterministic.
//
// This is a pure function of (x, y, rects): a body already at the settled spot
// regenerates that same candidate and stays exactly there. That matters. When
// the push-out passes ran first, a wedged body was dragged off the settled spot
// on every call and crept several pixels per frame while the player stood
// perfectly still.
function settle(x: number, y: number, r: number, rects: Rect[]) {
  const cand: Array<[number, number]> = [[x, y]];
  for (const rc of rects) {
    const cx = clamp(x, rc.x, rc.x + rc.w);
    const cy = clamp(y, rc.y, rc.y + rc.h);
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy >= r * r) continue;
    // the nearest face, plus the four axis-aligned escapes: the nearest face of
    // one wall is often the interior of another (the river's bottom edge is the
    // pillar standing on its south bank), and only a sideways option escapes
    cand.push(escape(x, y, r, rc));
    cand.push([rc.x - r, y], [rc.x + rc.w + r, y], [x, rc.y - r], [x, rc.y + rc.h + r]);
  }
  // NB: iterate a snapshot length -- cand grows as midpoints are pushed, so
  // looping on cand.length directly would never terminate.
  const base = cand.length;
  for (let i = 0; i < base; i++) {
    for (let j = i + 1; j < base; j++) {
      cand.push([(cand[i][0] + cand[j][0]) / 2, (cand[i][1] + cand[j][1]) / 2]);
    }
  }
  if (cand.length > 1) {
    let sx = 0, sy = 0;
    for (const c of cand) { sx += c[0]; sy += c[1]; }
    cand.push([sx / cand.length, sy / cand.length]);
  }
  // Least buried wins; ties go to the NEAREST spot. Every exit of a body inside
  // a river is equally clear, and without the distance tie-break the first one
  // generated won -- which could be 300px along the river instead of 80px up.
  // Candidates are clamped into the world: escaping a rect whose edge IS the
  // world boundary would otherwise put the body outside the map.
  let bi = -1, bestD = Infinity, bestDist = Infinity;
  for (let i = 0; i < cand.length; i++) {
    const cx2 = clamp(cand[i][0], 20, W - 20);
    const cy2 = clamp(cand[i][1], 20, H - 20);
    const d = penDepth(cx2, cy2, r, rects);
    const dist = Math.hypot(cx2 - x, cy2 - y);
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && dist < bestDist)) {
      bestD = d; bestDist = dist; bi = i;
      cand[i] = [cx2, cy2];
    }
  }
  return bi < 0 ? { x, y } : { x: cand[bi][0], y: cand[bi][1] };
}

export function collideCircle(px: number, py: number, r: number, rects: Rect[]) {
  if (penDepth(px, py, r, rects) > 0) {
    const cur = penDepth(px, py, r, rects);
    const s = settle(px, py, r, rects);
    // already sitting at the best spot in the neighbourhood: stay exactly put,
    // or the body creeps a little on every call while the player stands still
    if (Math.hypot(s.x - px, s.y - py) < 0.01) return { x: px, y: py };
    // a strictly better local spot exists (the two-walls-squeezing case)
    if (penDepth(s.x, s.y, r, rects) < cur - 1e-9) return s;
    // Nothing nearby is better, so the body is ENCLOSED rather than wedged --
    // e.g. brick7 sits inside the east river and blocks it completely, so every
    // local escape lands in the other obstacle. Fall through: the passes walk
    // the body along the surface and out the far side, which is the only thing
    // that can free it.
  }
  let x = px, y = py;
  // repeated passes: pushing out of one rect can push the circle into another,
  // and a single in-order sweep leaves it overlapping a rect it already walked
  // past. The maze's sub-diameter slots are why this is not optional.
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const rc of rects) {
      const cx = clamp(x, rc.x, rc.x + rc.w);
      const cy = clamp(y, rc.y, rc.y + rc.h);
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy >= r * r) continue;
      const e = escape(x, y, r, rc);
      if (e[0] !== x || e[1] !== y) moved = true;
      x = e[0]; y = e[1];
    }
    if (!moved) return { x, y }; // clear of everything
  }
  // the passes kept shoving us between two walls: take the best available spot
  return settle(x, y, r, rects);
}

export function pointInWall(x: number, y: number, rects: Rect[] = STEEL) {
  return inRect(x, y, rects);
}

// Random open respawn spot: rejection-sample against solids with a body margin.
// rng is injectable for tests; server passes Math.random (synced via state).
export function randomSpot(
  rng: () => number, solids: Rect[],
  w = W, h = H, margin = 34, tries = 40,
): { x: number; y: number } {
  let fx = w / 2, fy = h / 2;
  for (let i = 0; i < tries; i++) {
    const x = 60 + rng() * (w - 120);
    const y = 60 + rng() * (h - 120);
    let clear = true;
    for (const rc of solids) {
      const cx = Math.max(rc.x, Math.min(x, rc.x + rc.w));
      const cy = Math.max(rc.y, Math.min(y, rc.y + rc.h));
      if (Math.hypot(x - cx, y - cy) < margin) { clear = false; break; }
    }
    fx = x; fy = y;
    if (clear) return { x, y };
  }
  return { x: fx, y: fy };
}

// One movement integrator shared by server + client prediction.
// Ice: velocity eases toward input (drift). mult: speed buffs. Everywhere else: instant.
// One movement integrator shared by server + client prediction.
// Ice: velocity eases toward input (drift). mult: speed buffs. Everywhere else: instant.
//
// Collision is resolved only at the destination, so a single long step can land
// clear on the FAR side of a rect and never see it. The thinnest steel here is
// 30px and a 16px body needs 62px of travel to clear it, so anything longer than
// one 30Hz tick is sliced into safe sub-steps. At a normal tick this is a single
// step and the behaviour is unchanged; only a stall (GC pause, blocked event
// loop, tab wake) gets sliced -- which is what stops a lag spike walking you
// through indestructible steel.
const MOVE_STEP = 1 / 30;
const MOVE_SUBSTEPS_MAX = 8;
export function stepMove(
  px: number, py: number, vx: number, vy: number,
  dx: number, dy: number, dt: number, solids: Rect[], onIce: boolean, mult = 1,
) {
  const n = Math.max(1, Math.min(MOVE_SUBSTEPS_MAX, Math.ceil(dt / MOVE_STEP)));
  // sub is capped as well as n, so a pathological stall can never resolve into
  // one huge step again: the player then covers less ground that tick, which is
  // invisible, instead of being teleported through a wall.
  const sub = Math.min(dt / n, MOVE_STEP);
  let x = px, y = py, cx = vx, cy = vy;
  for (let i = 0; i < n; i++) {
    const k = onIce ? Math.min(1, sub * 5) : 1;
    const nvx = cx + (dx * SPEED * mult - cx) * k;
    const nvy = cy + (dy * SPEED * mult - cy) * k;
    const nx = clamp(x + nvx * sub, 20, W - 20);
    const ny = clamp(y + nvy * sub, 20, H - 20);
    const f = collideCircle(nx, ny, RADIUS, solids);
    x = f.x; y = f.y; cx = nvx; cy = nvy;
  }
  return { x, y, vx: cx, vy: cy };
}
