/**
 * The level is a TypeScript array, read by `spawn()` in this same example.
 * Deliberately not a scene format and not a framework feature: adding a prefab
 * kind here means adding a case to `spawn()`, which is where a reader can see
 * exactly what it builds.
 */
export type Vec3 = readonly [number, number, number];

export type LevelEntry =
  | { readonly kind: "block"; readonly id: string; readonly position: Vec3 }
  | {
      readonly kind: "bridge";
      readonly id: string;
      readonly position: Vec3;
      readonly size: Vec3;
    }
  | { readonly kind: "coin"; readonly id: string; readonly position: Vec3 }
  | { readonly kind: "flag"; readonly id: string; readonly position: Vec3 }
  | { readonly kind: "gem"; readonly id: string; readonly position: Vec3 }
  | {
      readonly kind: "island";
      readonly id: string;
      readonly position: Vec3;
      readonly size: Vec3;
      readonly trees?: Vec3[];
      readonly bushes?: Vec3[];
    }
  | {
      readonly kind: "lift";
      readonly id: string;
      readonly position: Vec3;
      readonly size: Vec3;
      readonly travel: Vec3;
      readonly seconds: number;
    }
  | {
      readonly kind: "mushroom";
      readonly id: string;
      readonly position: Vec3;
      readonly axis: "x" | "z";
      readonly distance: number;
    }
  | {
      readonly kind: "snail";
      readonly id: string;
      readonly position: Vec3;
      readonly axis: "x" | "z";
      readonly distance: number;
    };

export const SPAWN: Vec3 = [0, 0.55, 0];

/** An arc of coins over a gap, the shape the reference draws between islands. */
function arc(prefix: string, from: number, to: number, y: number, z: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    return {
      id: `${prefix}.${index + 1}`,
      kind: "coin",
      position: [from + (to - from) * t, y + Math.sin(t * Math.PI) * 1.4, z],
    } as const satisfies LevelEntry;
  });
}

function row(prefix: string, from: number, to: number, y: number, z: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    return {
      id: `${prefix}.${index + 1}`,
      kind: "coin",
      position: [from + (to - from) * t, y, z],
    } as const satisfies LevelEntry;
  });
}

export const LEVEL_1: readonly LevelEntry[] = [
  // ---------------------------------------------------------- the main run
  {
    bushes: [
      [-3.2, 0, 2.6],
      [2.8, 0, 3.4],
    ],
    id: "island.1",
    kind: "island",
    position: [0, -1, 0],
    size: [9, 2, 10],
    trees: [
      [-3.4, 0, -1.6],
      [3.4, 0, -4],
    ],
  },
  { id: "bridge.1", kind: "bridge", position: [7.4, -0.15, 0], size: [7.2, 0.3, 2.8] },
  {
    bushes: [[13.4, 0, 2.4]],
    id: "island.2",
    kind: "island",
    position: [15, -1, 0],
    size: [8, 2, 8],
    trees: [[17.6, 0, -2.4]],
  },
  {
    bushes: [[25.6, 0, -2.8]],
    id: "island.3",
    kind: "island",
    position: [24, -1, 0],
    size: [7, 2, 8],
    trees: [[21.6, 0, -3]],
  },
  { id: "island.4", kind: "island", position: [32, -0.2, 0], size: [6, 2, 6] },
  {
    id: "island.5",
    kind: "island",
    position: [39, 0.4, 0],
    size: [5, 2, 5],
    trees: [[40.4, 0, -1.6]],
  },
  {
    bushes: [[43.6, 0, 2.6]],
    id: "island.6",
    kind: "island",
    position: [46, 1, 0],
    size: [8, 2, 8],
    trees: [
      [48.6, 0, -2.6],
      [43.4, 0, -3],
    ],
  },

  // ------------------------------------------- the ferry to the side island
  {
    id: "lift.1",
    kind: "lift",
    position: [0, -0.25, -7],
    seconds: 3,
    size: [4.5, 0.5, 4.5],
    travel: [0, 0, -7],
  },
  {
    id: "island.7",
    kind: "island",
    position: [0, -1, -16],
    size: [7, 2, 7],
    trees: [[2.4, 0, -17.6]],
  },

  { id: "block.1", kind: "block", position: [38, 2.9, 0] },
  { id: "block.2", kind: "block", position: [39.3, 2.9, 0] },
  // A crate to jump, not walk, past: it is also what pins the fox to a known
  // spot in the traverse and collect scenarios, whatever the frame rate.
  { id: "block.3", kind: "block", position: [18.4, 0.6, 0] },
  { id: "flag.1", kind: "flag", position: [48, 2, 0] },

  { axis: "x", distance: 3.5, id: "mushroom.1", kind: "mushroom", position: [-3.5, 0, 0] },
  { axis: "x", distance: 4, id: "mushroom.2", kind: "mushroom", position: [21.5, 0, 0] },
  { axis: "x", distance: 3, id: "snail.1", kind: "snail", position: [30, 0.8, -1.4] },

  ...row("coin", 5.2, 7.6, 1.1, 0, 3),
  ...arc("coin.gap", 19.2, 20.4, 0.9, 0, 3),
  ...row("coin.ledge", 22, 26, 1.1, 2.6, 4),
  ...arc("coin.rise", 35.2, 36.6, 1.8, 0, 3),
  ...row("coin.top", 43.5, 48.5, 2.9, -1.4, 4),

  { id: "gem.1", kind: "gem", position: [15, 1.2, -2.6] },
  { id: "gem.2", kind: "gem", position: [24, 1.2, 2.8] },
  { id: "gem.3", kind: "gem", position: [32, 2, 0] },
  { id: "gem.4", kind: "gem", position: [46, 3.2, 1.6] },
  { id: "gem.5", kind: "gem", position: [0, 1.2, -16] },
];
