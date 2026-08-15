// The whole room, derived from one seed. Nothing here reads Math.random, so the
// same seed builds a byte-identical world on every scene entry — which is what
// makes the two replay runs comparable at all.
import { makeRandom } from "../render/shapes.js";

export const WORLD_SEED = 6132;

export const ROOM_HALF = 7.2;
/**
 * The containment collider is taller than the parapet you can see.
 *
 * A wall high enough to look like a room is a wall that hides whatever stands in
 * front of it under a three-quarter camera, and the destination sits against the
 * far side. So the visible course is knee-high and the collider that keeps 38
 * loose bodies in the room is not — the standard isometric trade, and the
 * alternative is a screenshot with no character in it.
 */
export const WALL_HEIGHT = 2.6;
export const PARAPET_HEIGHT = 1.3;
export const WALL_THICKNESS = 0.6;
export const CRATE_SIZE = 0.8;

/** Collision layers. The character scans WORLD|SOLID only, so PHANTOM is walk-through. */
export const LAYER_WORLD = 1;
export const LAYER_SOLID = 2;
export const LAYER_PHANTOM = 4;
export const LAYER_PLAYER = 8;
export const LAYER_GOAL = 16;
export const LAYER_REACH = 32;

/** Screen-right on the fixed camera, on the ground plane. The route is laid out on it. */
const DIAG_X = Math.SQRT1_2;
const DIAG_Z = -Math.SQRT1_2;

export const SPAWN = { x: -4.6, y: 0.78, z: 4.6 } as const;

/**
 * Everything the character has to reach sits on one straight line from the spawn,
 * and that line is exactly the direction `ArrowRight` walks. Holding one key is
 * therefore a complete solution: the character shoves the keystone crate ahead of
 * it, walks through two glowing crates, and one of the two trips the pad.
 */
function at(distance: number, offset = 0): { x: number; z: number } {
  return {
    x: SPAWN.x + distance * DIAG_X + offset * Math.SQRT1_2,
    z: SPAWN.z + distance * DIAG_Z + offset * Math.SQRT1_2,
  };
}

const GOAL_DISTANCE = 8.6;
const goalCentre = at(GOAL_DISTANCE);

export const GOAL = { half: 1.9, x: goalCentre.x, z: goalCentre.z } as const;

export type CrateKind = "solid" | "phantom";

export interface ICrateSpec {
  /** Registry id. Uniform `crate-NN` so an anonymous body selector sees all of them. */
  readonly id: string;
  readonly kind: CrateKind;
  /** What this crate is for, reported to observers that want more than the id. */
  readonly role: string;
  /** Palette slot 0-2 for solids; ignored for phantoms. */
  readonly tint: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

/**
 * 38 dynamic bodies: a 27-crate stack that topples, three walk-through phantoms,
 * one keystone crate the character meets first, and seven strays.
 *
 * Every crate spawns above its resting height, so the room genuinely drops,
 * collides and settles instead of starting pre-solved.
 */
export function buildLayout(): readonly ICrateSpec[] {
  const random = makeRandom(WORLD_SEED);
  const specs: Omit<ICrateSpec, "id">[] = [];
  const half = CRATE_SIZE / 2;
  const step = CRATE_SIZE + 0.03;

  // Each layer is dropped higher and nudged further off-centre than the one
  // below, so the base holds and the top two shed crates on impact. A perfectly
  // aligned cube just lands; this one collapses into a pile and then stops,
  // which is the "stack, topple, collide, come to rest" the brief asks for.
  const stack = at(7, -5.4);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let layer = 0; layer < 3; layer += 1) {
        const scatter = layer * 0.13;
        specs.push({
          kind: "solid",
          role: "stack",
          tint: (row + column + layer) % 3,
          x: stack.x + (row - 1) * step + (random() - 0.5) * scatter,
          y: half + layer * (step + 0.34) + 0.15,
          z: stack.z + (column - 1) * step + (random() - 0.5) * scatter,
          yaw: (random() - 0.5) * (0.12 + layer * 0.5),
        });
      }
    }
  }

  const keystone = at(2.2);
  specs.push({
    kind: "solid",
    role: "keystone",
    tint: 2,
    x: keystone.x,
    y: half + 0.35,
    z: keystone.z,
    yaw: 0.18,
  });

  // Two straight down the route so walking through them is unmissable, and one
  // past the pad so the class is still on screen after the puzzle is solved.
  for (const [distance, offset] of [
    [3.3, 0],
    [4.6, 0],
    [11.2, 1.6],
  ] as const) {
    const spot = at(distance, offset);
    specs.push({
      kind: "phantom",
      role: "phantom",
      tint: 0,
      x: spot.x,
      y: half + 0.25,
      z: spot.z,
      yaw: 0,
    });
  }

  for (const [index, [distance, offset]] of (
    [
      [1.2, 2.6],
      [3.6, -5.0],
      [9.4, 3.4],
      [12.0, 2.2],
      [11.6, -2.6],
      [5.4, 4.8],
      [10.6, -3.8],
    ] as const
  ).entries()) {
    const spot = at(distance, offset);
    specs.push({
      kind: "solid",
      role: "stray",
      tint: index % 3,
      x: spot.x,
      y: half + 0.4 + random() * 0.9,
      z: spot.z,
      yaw: random() * Math.PI,
    });
  }

  const inner = ROOM_HALF - CRATE_SIZE;
  return specs.map((spec, index) => {
    // Fail closed: a crate authored outside the room would spawn inside a wall
    // and make the whole settle observation meaningless.
    if (Math.abs(spec.x) > inner || Math.abs(spec.z) > inner) {
      throw new RangeError(`Crate ${index} (${spec.role}) is outside the room.`);
    }
    return { ...spec, id: `crate-${String(index).padStart(2, "0")}` };
  });
}
