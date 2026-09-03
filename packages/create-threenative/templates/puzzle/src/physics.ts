import type { IPhysicsContext } from "@threenative/physics";

/**
 * One bit per thing that can touch another thing.
 *
 * Layers are the game's, not the framework's: `interactionGroups` from `@threenative/physics`
 * encodes whichever numbers you put here into a Rapier group. Keep them powers of two and keep
 * the meaning in one place — a mask assembled inline at three call sites is how a crate quietly
 * stops colliding with the ball.
 */
export const ROOM_LAYER = 1;
export const CRATE_LAYER = 2;
export const BALL_LAYER = 4;
export const WEIGHT_LAYER = 8;

export const CRATE_MASK = ROOM_LAYER | CRATE_LAYER | BALL_LAYER | WEIGHT_LAYER;
export const BALL_MASK = ROOM_LAYER | CRATE_LAYER | BALL_LAYER | WEIGHT_LAYER;

export type PuzzlePhysics = IPhysicsContext;
