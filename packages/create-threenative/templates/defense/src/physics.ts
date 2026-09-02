/**
 * Collision layers, and only collision layers.
 *
 * Which bit means what is a game decision — the framework never names your layers — so the four
 * live here where a scene, a tower and an attacker all read the same numbers. Everything else
 * this file used to hold (a `directSpaceState` accessor, a `RigidBody3D` wrapper that only added
 * `entity`) is now first-class on `@threenative/physics`: query through `ctx.physics.directSpaceState`
 * and pass `entity` straight to `RigidBody3D`.
 */
export const GROUND_LAYER = 1;
export const ROUTE_LAYER = 2;
export const TOWER_LAYER = 4;
export const ATTACKER_LAYER = 8;
