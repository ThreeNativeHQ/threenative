// The ground, as numbers. No three, no DOM: the render mesh, the hero, every enemy and the camera all
// ask this one function where the floor is, so the art and the walkable surface agree by
// construction — including the 20 log steps, whose profile is a formula here and a row of boxes
// in `src/render/forest.ts`.

export const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

export function smooth(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Where the walkable world ends. Past these the hero is stopped, not dropped. */
export const BOUNDS = { xMax: 32, xMin: -32, zMax: 24, zMin: -34 } as const;

/** The stair: 20 steps, 0.65 m deep and 0.225 m high, climbing north (−z) from z = 3. */
export const STAIR = { depth: 0.65, rise: 0.225, steps: 20, x0: 4.7, x1: 11.3, z0: 3, z1: -10 } as const;

/** The log bridge across the brook: a cambered deck, 17 m long, 3.1 m wide. */
export const BRIDGE = { halfWidth: 1.55, x0: -24, x1: -7, z: -5 } as const;

/** Bridge deck height at `x`: a gentle arch that peaks mid-span. */
export function bridgeDeck(x: number): number {
  return 3.35 + Math.sin(((x - BRIDGE.x0) / (BRIDGE.x1 - BRIDGE.x0)) * Math.PI) * 0.45;
}

export function terrainHeight(x: number, z: number): number {
  const rear = 1 - smooth(-13, 4, z);
  let h = 0.16 * Math.sin(x * 0.21) * Math.cos(z * 0.22) + 0.1 * Math.sin(x * 0.43 + z * 0.19);
  h += 4.2 * rear;
  h -= 1.9 * Math.exp(-(((x + 20) / 5.6) ** 2 + ((z - 4) / 8.4) ** 2));
  h += 1.5 * Math.exp(-(((x + 24) / 5) ** 2 + ((z + 5) / 5) ** 2));
  return h;
}

/** The ground including the stair. */
export function groundHeight(x: number, z: number): number {
  if (x > STAIR.x0 && x < STAIR.x1 && z <= STAIR.z0 && z >= STAIR.z1)
    return Math.min(STAIR.steps, Math.floor((STAIR.z0 - z) / STAIR.depth) + 1) * STAIR.rise + 0.025;
  return terrainHeight(x, z);
}

/** The floor a body at height `y` stands on: the bridge deck when it is on or above it. */
export function floorHeight(x: number, z: number, y = -100): number {
  if (x >= BRIDGE.x0 && x <= BRIDGE.x1 && Math.abs(z - BRIDGE.z) < BRIDGE.halfWidth) {
    const deck = bridgeDeck(x);
    if (y >= deck - 0.72) return deck;
  }
  return groundHeight(x, z);
}

/** Footpaths as polylines of [x, z]. They tint the ground, seed the flagstones and keep grass off. */
export const PATHS: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 22], [0, 12], [0, 6], [4, 3], [8, 2], [8, -10], [5, -17], [3, -26]],
  [[0, 7], [-6, 4], [-13, 1], [-18, 3], [-24, -3], [-23, -11], [-17, -15], [-9, -17], [3, -20]],
  [[5, 3], [13, 1], [18, -4], [19, -9], [15, -14], [8, -15]],
  [[-13, 1], [-10, -5], [-8, -10], [-9, -17]],
];

/** Distance in metres to the nearest footpath. */
export function pathDistance(x: number, z: number): number {
  let best = 100;
  for (const path of PATHS)
    for (let i = 1; i < path.length; i += 1) {
      const [ax, az] = path[i - 1] as readonly [number, number];
      const [bx, bz] = path[i] as readonly [number, number];
      const dx = bx - ax;
      const dz = bz - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
  return best;
}
