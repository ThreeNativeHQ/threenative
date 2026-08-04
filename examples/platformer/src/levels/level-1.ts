/**
 * The level, as a plain array.
 *
 * This is not a scene format and it never becomes one. It is data this game's
 * own `spawn()` understands, in this game's repository — no loader, no schema,
 * no editor. `spawn()` throws on a kind it does not know, so a typo stops the
 * run instead of quietly dropping a platform into the void.
 *
 * Geometry conventions: the fox runs along +X, the playable lane is z ≈ 0, and
 * an island's `y` is the height of the surface you stand on.
 */

export type Prefab =
  /** A floating grass island. `y` is the walkable surface. */
  | { kind: "island"; x: number; y: number; z?: number; width: number; depth: number; seed?: number }
  /** A rope bridge running from `x` to `x + length`. */
  | { kind: "bridge"; x: number; y: number; z?: number; length: number }
  /** A one-way lift that departs when ridden and holds at `to`. */
  | { kind: "ferry"; x: number; y: number; z?: number; to: number; speed: number }
  | { kind: "coin"; x: number; y: number; z?: number }
  /** `count` coins on a parabola `span` long, peaking `rise` above `y`. */
  | { kind: "coinArc"; x: number; y: number; z?: number; count: number; span: number; rise: number }
  | { kind: "gem"; x: number; y: number; z?: number }
  | { kind: "mushroom"; x: number; y: number; z?: number; range: number }
  | { kind: "snail"; x: number; y: number; z?: number; range: number }
  | { kind: "crate"; x: number; y: number; z?: number }
  /** Cosmetic only: trees, bushes, a fence run, a waterfall off an edge. */
  | { kind: "grove"; x: number; y: number; z?: number; width: number; depth: number; seed?: number }
  | { kind: "fence"; x: number; y: number; z?: number; length: number }
  | { kind: "waterfall"; x: number; y: number; z?: number; width: number; height: number }
  /** The flag at the end of the run. */
  | { kind: "goal"; x: number; y: number; z?: number };

export const SPAWN = { x: 0, y: 0.85, z: 0 } as const;

/** The chasm the ferry crosses. Wider than a running jump (≈5m), on purpose. */
export const level1: readonly Prefab[] = [
  // --- Meadow: where you learn that right is forward -------------------------
  { depth: 9, kind: "island", seed: 11, width: 13, x: 2, y: 0 },
  { kind: "grove", seed: 3, depth: 9, width: 13, x: 2, y: 0 },
  { kind: "fence", length: 6, x: -3.5, y: 0, z: -4 },
  { kind: "waterfall", height: 15, width: 2.6, x: 6.4, y: -0.95, z: 4.3 },
  { kind: "coin", x: 3, y: 1, z: 0 },
  { kind: "coin", x: 4.2, y: 1, z: 0 },
  { kind: "coin", x: 5.4, y: 1, z: 0 },
  { kind: "gem", x: 6.6, y: 1.05, z: 0 },
  { kind: "snail", range: 2.2, x: 5.5, y: 0.35, z: 2.6 },

  // --- The plank bridge, patrolled ------------------------------------------
  { kind: "bridge", length: 5, x: 8.5, y: 0 },
  { kind: "coinArc", count: 5, rise: 1.6, span: 4.4, x: 8.8, y: 1.1, z: 0 },
  // A corridor patroller: there is no way around it, which is exactly why the
  // enemy playtest uses this one.
  { kind: "mushroom", range: 1.8, x: 11, y: 0.75, z: 0 },

  // --- The plateau: coins, a crate, and two more mushrooms -------------------
  { depth: 10, kind: "island", seed: 27, width: 12, x: 19, y: 0 },
  { kind: "grove", seed: 41, depth: 10, width: 12, x: 19, y: 0 },
  { kind: "fence", length: 7, x: 15, y: 0, z: 4.4 },
  { kind: "waterfall", height: 20, width: 3.4, x: 21.6, y: -0.95, z: 4.8 },
  { kind: "coin", x: 14.4, y: 1, z: 0 },
  { kind: "coin", x: 15.6, y: 1, z: 0 },
  { kind: "coin", x: 16.8, y: 1, z: 0 },
  { kind: "coin", x: 21.4, y: 1, z: 0 },
  { kind: "coin", x: 22.6, y: 1, z: 0 },
  { kind: "coinArc", count: 4, rise: 1.4, span: 3, x: 19.6, y: 1, z: 0 },
  { kind: "gem", x: 18.4, y: 2.6, z: -2.6 },
  { kind: "gem", x: 21, y: 1.05, z: 3.2 },
  // Sits off the running lane so it is a detour, not a wall. Playtests pin the
  // fox against it, so this x is load-bearing — see examples/AGENTS.md.
  { kind: "crate", x: 18.4, y: 0.6, z: -2.6 },
  { kind: "mushroom", range: 2.4, x: 16.5, y: 0.75, z: -2.2 },
  { kind: "mushroom", range: 2.6, x: 21.5, y: 0.75, z: -1.4 },
  { kind: "snail", range: 1.8, x: 22.5, y: 0.35, z: 2 },

  // --- The chasm, and the lift across it ------------------------------------
  { kind: "ferry", speed: 2.2, to: 31.3, x: 26.7, y: 0 },
  { kind: "coin", x: 27.5, y: 1.6, z: 0 },
  { kind: "coin", x: 29.5, y: 1.6, z: 0 },

  // --- The far shore --------------------------------------------------------
  { depth: 8, kind: "island", seed: 57, width: 9, x: 37, y: 0 },
  { kind: "grove", seed: 63, depth: 8, width: 9, x: 37, y: 0 },
  { kind: "gem", x: 36, y: 1.05, z: 0 },
  { kind: "goal", x: 38.5, y: 0, z: 0 },
];
