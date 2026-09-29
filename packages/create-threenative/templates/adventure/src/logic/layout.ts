// Where everything stands. One seeded stream, no three, no DOM: the rules read the obstacles off
// this table and the renderer reads the same rows to plant the same trees, so a trunk you cannot
// walk through is a trunk you can see, and moving one is one edit.
import type { IObstacle } from "./movement.js";
import { pathDistance } from "./terrain.js";

/** mulberry32: 32 bits of state, a fresh stream per call, identical on every JS engine. */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ITree {
  /** The one giant oak with the round window: bigger roots, more limbs. */
  readonly hero: boolean;
  /** Trunk height in metres. */
  readonly h: number;
  /** Trunk radius at the foot in metres. */
  readonly r: number;
  readonly x: number;
  readonly z: number;
}

export interface IRock {
  readonly r: number;
  readonly x: number;
  readonly z: number;
}

const HERO_TREE: ITree = { h: 19, hero: true, r: 2.25, x: -9, z: -20 };
/** The colossal elder at the head of the valley: far past the walkable rim, it is what the mist hides. */
const LANDMARK_TREE: ITree = { h: 52, hero: true, r: 7, x: 2, z: -56 };
const NAMED_TREES: readonly (readonly [number, number, number, number])[] = [
  [-16, 11, 1.2, 20],
  [18, 8, 1.4, 23],
  [-7, -6, 1.05, 19],
  [17, -13, 1.0, 21],
  [-26, -5, 1.3, 22],
  [-21, -19, 0.85, 19],
  [3, -35, 1.3, 23],
  [-29, 11, 0.85, 18],
  [27, 1, 1.05, 23],
  [-1, -12, 0.6, 18],
  [23, -25, 1.1, 24],
  [-19, -32, 0.9, 21],
  [-28, -29, 1.0, 24],
];
const NAMED_ROCKS: readonly (readonly [number, number, number])[] = [
  [3.6, 1.2, 1.45],
  [12.5, -3, 1.3],
  [-5, 6, 1.6],
  [-12, 7, 1.05],
  [15, 6, 1.1],
  [-23, 8, 1.7],
  [12, -18, 1.5],
];

export interface ILayout {
  /** Every body-blocking circle: trunks, big boulders, the keeper. */
  readonly obstacles: readonly IObstacle[];
  /** Trunks past the walkable rim that only read as forest. */
  readonly farTrunks: readonly { h: number; x: number; z: number }[];
  readonly rocks: readonly IRock[];
  readonly trees: readonly ITree[];
}

/** The keeper stands here; she is an obstacle so the hero walks round her. */
/** Flat, moss-capped rock ledges: `[x, z, width, depth, yaw]`. Each blocks like a boulder of its own size. */
export const LEDGES: readonly (readonly [number, number, number, number, number])[] = [
  [12.5, -18.5, 3.4, 2.4, 0.4],
  [-2.5, -13.5, 3, 2.2, -0.5],
  [-13, 12.5, 3.6, 2.6, 0.2],
  [22, -4.5, 3, 2.4, 1.1],
  [-26, -14, 3.4, 2.6, -0.3],
  [16.5, 12, 3, 2.2, 0.7],
];

export const KEEPER = { x: 13.2, z: 2 } as const;
export const ALTAR = { x: 3, z: -26 } as const;
export const CHEST = { x: -14, z: -14 } as const;
export const LAKE = { x: -20, z: 4, rx: 4.7, rz: 8 } as const;

export const GEMS: readonly (readonly [number, number])[] = [
  [0, 8],
  [-4, 5],
  [-7, 3],
  [-11, 1],
  [-16, 2],
  [10, 1],
  [14, 0],
  [18, -2],
  [19, -4],
  [8, -6],
  [8, -10],
  [4, -15],
  [-10, -15],
  [-15, -17],
  [-21, -10],
  [1, -24],
];
export const POTS: readonly (readonly [number, number])[] = [
  [-3, 10],
  [14, 2.5],
  [14.7, 2.8],
  [-6, -16],
  [-5.3, -16],
  [-22, -9],
  [14, -15],
];
export const ENEMIES: readonly (readonly [number, number])[] = [
  [-14, 2],
  [-22, -11],
  [17, -3],
  [21, -11],
  [-14, -20],
  [-20, -24],
];
export const LANTERNS: readonly (readonly [number, number, number])[] = [
  [-4, 9, 2.35],
  [13.1, 3.5, 2.6],
  [4, -10.4, 2.55],
  [12.1, -11, 2.6],
  [-8, -4, 2.4],
  [-23, -2, 2.3],
  [-13, -15, 2.45],
  [1, -25, 2.7],
  [20, -8, 2.8],
  [-5, -19, 2.4],
];
export const SIGIL_SITES = {
  briar: { color: 0xebc570, name: "Briar sigil", x: 19, z: -7 },
  brook: { color: 0x9edcde, name: "Brook sigil", x: -18, z: 3 },
  elder: { color: 0xb6b7f2, name: "Elder sigil", x: -17, z: -21 },
} as const;

/** Builds the seeded forest. Same seed, same trees. */
export function createLayout(seed = 147_923): ILayout {
  const rand = mulberry32(seed);
  const range = (a: number, b: number): number => a + (b - a) * rand();
  const trees: ITree[] = [
    HERO_TREE,
    LANDMARK_TREE,
    ...NAMED_TREES.map(([x, z, r, h]) => ({ h, hero: false, r, x, z })),
  ];
  for (let i = 0; i < 36; i += 1) {
    const a = (i / 36) * Math.PI * 2;
    const dist = range(34, 51);
    trees.push({ h: 0, hero: false, r: 0, x: Math.cos(a) * dist, z: Math.sin(a) * dist - 10 });
    const last = trees[trees.length - 1] as { h: number; r: number };
    last.r = range(0.38, 0.8);
    last.h = range(18, 29);
  }
  const farTrunks = Array.from({ length: 35 }, () => ({
    h: range(22, 33),
    x: range(-58, 58),
    z: range(-60, -40),
  }));
  const rocks: IRock[] = [];
  for (let i = 0; i < 170; i += 1) {
    const x = range(-32, 32);
    const z = range(-34, 22);
    const r = range(0.28, 1.3);
    if (pathDistance(x, z) < 3 || Math.hypot(x + 9, z + 20) < 3.5) continue;
    rocks.push({ r, x, z });
  }
  for (const [x, z, r] of NAMED_ROCKS) rocks.push({ r, x, z });
  const obstacles: IObstacle[] = [
    ...trees.map((tree) => ({ r: tree.r * 0.77, x: tree.x, z: tree.z })),
    ...rocks
      .filter((rock) => rock.r > 1.05)
      .map((rock) => ({ r: rock.r * 0.7, x: rock.x, z: rock.z })),
    ...LEDGES.map(([x, z, w, d]) => ({ r: Math.min(w, d) * 0.5, x, z })),
    { r: 0.39, x: KEEPER.x, z: KEEPER.z },
  ];
  return { farTrunks, obstacles, rocks, trees };
}
