import { Rng } from "./rng.js";

export const WORLD_SEED = 6132;

/** One physics tick. The whole game advances in multiples of this and nothing else. */
export const FIXED_STEP = 1 / 60;

export const ROOM = {
  halfX: 9,
  halfZ: 6.5,
  wallHeight: 3,
  wallThickness: 0.5,
} as const;

export const PLAYER = {
  spawn: { x: -5.2, y: 1.05, z: 1.2 },
  radius: 0.32,
  halfHeight: 0.42,
  speed: 4.6,
  mass: 3.4,
} as const;

/** The destination. A sensor volume — nothing here is a distance check. */
export const GOAL = {
  center: { x: 5.8, y: 0, z: -0.2 },
  halfX: 2.6,
  halfZ: 2.8,
  halfY: 1.15,
} as const;

export const CRATE_SIZE = 1;
export const CRATE_COUNT = 40;

/** Crate tints, read off the reference: crate orange, crate red, crate teal. */
export const CRATE_TINTS = [0xd98a34, 0xc0533f, 0x3f8c86] as const;

export interface ICrateSpec {
  readonly index: number;
  readonly tint: number;
  readonly x: number;
  readonly y: number;
  readonly yaw: number;
  readonly z: number;
}

export interface IGhostSpec {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly yaw: number;
  readonly z: number;
}

export interface ILayout {
  readonly crates: readonly ICrateSpec[];
  readonly ghosts: readonly IGhostSpec[];
}

/** Crates the player meets walking straight out of the spawn, before the stack. */
const LANE_CRATES: readonly { x: number; z: number }[] = [
  { x: -3.6, z: 1.2 },
  { x: 1.4, z: 1.1 },
];

/**
 * The pass-through class: a short wall of ghost crates standing between the room and the pad.
 * Solid crates stop the character; these do not, and they are the only glowing blue bodies in
 * the room, so the difference is visible before it is felt.
 */
const GHOST_LANE = [-1.6, -0.55, 0.5, 1.55, 2.6] as const;

const STACK_ORIGIN = { x: -1.2, z: -1.6 } as const;
const STACK_COLUMNS = 3;
const STACK_ROWS = 3;
const STACK_LAYERS = 3;

/**
 * Builds the level from the supplied seeded stream. Pure: no clock, no DOM, no renderer — the
 * replay check rebuilds the whole world from this and must land on the same floats.
 */
export function buildLayout(rng: Rng): ILayout {
  const crates: ICrateSpec[] = [];

  // The stack. Each crate starts a hair above its slot with a little yaw, so the opening
  // drop actually stacks, topples and settles instead of snapping into a perfect lattice.
  for (let layer = 0; layer < STACK_LAYERS; layer += 1) {
    for (let row = 0; row < STACK_ROWS; row += 1) {
      for (let column = 0; column < STACK_COLUMNS; column += 1) {
        crates.push({
          index: crates.length,
          tint: pickTint(rng),
          x: STACK_ORIGIN.x + (column - 1) * 1.04 + rng.jitter(0.035),
          y: 0.5 + layer * 1.06 + 0.08,
          yaw: rng.jitter(0.05),
          z: STACK_ORIGIN.z + (row - 1) * 1.04 + rng.jitter(0.035),
        });
      }
    }
  }

  for (const lane of LANE_CRATES) {
    crates.push({
      index: crates.length,
      tint: pickTint(rng),
      x: lane.x,
      y: 0.62,
      yaw: rng.jitter(0.25),
      z: lane.z,
    });
  }

  // The rest are scattered around the room, clear of the spawn, the stack and the pad.
  while (crates.length < CRATE_COUNT) {
    const candidate = {
      x: rng.range(-ROOM.halfX + 1.4, ROOM.halfX - 1.4),
      z: rng.range(-ROOM.halfZ + 1.4, ROOM.halfZ - 1.4),
    };
    if (!isScatterSlotFree(candidate, crates)) continue;
    crates.push({
      index: crates.length,
      tint: pickTint(rng),
      x: candidate.x,
      y: 0.62 + rng.range(0, 0.5),
      yaw: rng.jitter(Math.PI),
      z: candidate.z,
    });
  }

  return {
    crates,
    ghosts: GHOST_LANE.map((z, index) => ({ index, x: 2.6, y: 0.5, yaw: 0, z })),
  };
}

function pickTint(rng: Rng): number {
  return CRATE_TINTS[rng.int(CRATE_TINTS.length)] ?? CRATE_TINTS[0];
}

function isScatterSlotFree(
  candidate: { x: number; z: number },
  placed: readonly ICrateSpec[],
): boolean {
  const nearSpawn = Math.hypot(candidate.x - PLAYER.spawn.x, candidate.z - PLAYER.spawn.z) < 2;
  const onStack =
    Math.abs(candidate.x - STACK_ORIGIN.x) < 2.6 && Math.abs(candidate.z - STACK_ORIGIN.z) < 2.6;
  const onGoal =
    Math.abs(candidate.x - GOAL.center.x) < GOAL.halfX + 1 &&
    Math.abs(candidate.z - GOAL.center.z) < GOAL.halfZ + 1;
  const onGhostLane = Math.abs(candidate.x - 2.6) < 1.5;
  // The run from the spawn to the pad stays clear, so the crates the character meets are the
  // ones the level put there on purpose rather than whatever the scatter happened to drop.
  const onRunLane = candidate.z > -0.3 && candidate.z < 2.9;
  if (nearSpawn || onStack || onGoal || onGhostLane || onRunLane) return false;
  return placed.every((crate) => Math.hypot(crate.x - candidate.x, crate.z - candidate.z) > 1.5);
}
