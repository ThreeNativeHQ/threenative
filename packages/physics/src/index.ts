import "./web.js";

/**
 * Detect overlaps without turning the body into a moving collider.
 * @situation detect when an enemy enters a trigger area
 * @situation react to a player entering a zone
 * @constraint add the area to the physics context before stepping the world
 * @example const goal = new Area3D({ physics: ctx.physics, shape: CollisionShape3D.sphere(1.2), position: { x: 0, y: 0.5, z: -8 } });
 */
export { Area3D } from "./Area3D.js";
/**
 * Move a character body with collision-aware sliding.
 * @situation move an enemy or player through a level
 * @situation keep a character from walking through walls
 * @constraint use moveAndSlide inside the physics update
 * @example const body = new CharacterBody3D({ object: hero, physics: ctx.physics, shape: CollisionShape3D.capsule(0.5, 0.35) });
 */
export { CharacterBody3D } from "./CharacterBody3D.js";
/**
 * Give a physics body a Three.js collision shape.
 * @situation add a capsule or box collider to a character
 * @situation configure the shape used by a rigid body
 * @constraint create shapes through the owning physics context
 * @example const shape = CollisionShape3D.capsule(0.5, 0.35);
 */
export { CollisionShape3D } from "./CollisionShape3D.js";
export type { ICollisionShapeHandle } from "./CollisionShape3D.js";
/**
 * Float a rigid body on a game-owned height source with fixed-step force ordering.
 * @situation float a boat on waves
 * @situation keep a hull above a moving water surface
 * @constraint supply hull points, density, drag, and the height source
 * @override buoyancy disables force application while submergedFraction remains measured
 * @example new Buoyancy3D({ body, surface: field, hullPoints, density: 1_000, drag: 4 });
 */
export { Buoyancy3D } from "./Buoyancy3D.js";
export type {
  BuoyancyPointPosition,
  IBuoyancy3DOptions,
  IBuoyancyHullPoint,
  IBuoyancySurface,
  IBuoyancySurfaceSample,
} from "./Buoyancy3D.js";
/**
 * Connect two physics bodies with a Godot-style joint.
 * @situation constrain a rigid body to another body
 * @situation build a hinge or pin mechanism
 * @situation swing a pendulum, wrecking ball, or hinged door on a joint
 * @constraint both bodies must belong to the same physics context
 * @example const hinge = Joint3D.hinge({ physics: ctx.physics, bodyA: beam, bodyB: bob, anchorA: { x: 0, y: 0, z: 0 }, anchorB: { x: 0, y: 2.4, z: 0 }, axis: { x: 1, y: 0, z: 0 } });
 */
export { Joint3D } from "./Joint3D.js";
export type {
  IFixedJoint3DOptions,
  IHingeJoint3DOptions,
  IJoint3DOptions,
  IPinJoint3DOptions,
  PhysicsJointBody,
} from "./Joint3D.js";
/**
 * Query the physics world without creating a body.
 * @situation raycast for visibility or aiming
 * @situation find bodies inside a shape or point query
 * @constraint query results are bounded by the configured result limit
 * @example const space = new PhysicsDirectSpaceState3D(context);
 */
export { PhysicsDirectSpaceState3D } from "./PhysicsDirectSpaceState3D.js";
/**
 * Build fixed trimesh bodies from the meshes a game authored in a scene root.
 * @situation make the level I built stop the player
 * @situation turn a cathedral or map scene into static collision
 * @constraint supply the game-owned predicate for decorative meshes; the helper throws when it selects nothing
 * @constraint generated bodies use trimesh geometry and world-space instance transforms
 * @example const colliders = buildStaticColliders(ctx, level, { predicate: (object) => object.name.startsWith("wall") });
 */
export { buildStaticColliders } from "./static-colliders.js";
export type {
  IBuildStaticCollidersOptions,
  IStaticColliderContext,
  StaticColliderPredicate,
} from "./static-colliders.js";
/**
 * Feed existing rigid-body boxes into `SoftBody3D` without inventing a second collider API.
 * @situation stop a cloth flag, cape, or curtain at an existing physics wall
 * @situation collide SoftBody3D with fixed box bodies
 * @constraint every body must use CollisionShape3D.box and retain its Three.js object transform
 * @constraint rotated boxes become conservative cloth-local axis-aligned bounds
 * @example const cloth = new SoftBody3D(mesh, { ...options, collision: softBodyCollision(wall) });
 */
export { softBodyCollision } from "./softbody-collision.js";
export type {
  IIntersectPointOptions,
  IIntersectRayOptions,
  IIntersectShapeOptions,
  IPointHit,
  IRayHit,
  IShapeHit,
  PhysicsQueryVector3,
} from "./PhysicsDirectSpaceState3D.js";
export type {
  IPhysicsBodyHandle,
  IPhysicsColliderHandle,
  IPhysicsHandle,
  IPhysicsWorldHandle,
} from "./handles.js";
/**
 * Encode collision layers and masks for Rapier groups.
 * @situation make an enemy collide with the world but not pickups
 * @situation configure which physics layers interact
 * @example const groups = interactionGroups(1, 3);
 */
export { interactionGroups } from "./collision.js";
/**
 * Simulate a dynamic or static rigid body.
 * @situation give a crate or prop physical motion
 * @situation create a body that collides with a character
 * @situation fire physical cannonballs that collide with ships or scenery
 * @situation fire a cannonball projectile with cannon smoke particles
 * @situation a bullet passes through a wall
 * @constraint register rapier() in the game plugin list before using bodies
 * @override continuousCollision: false opts one body out while body.continuousCollision still reports the effective setting
 * @example const crate = new RigidBody3D({ object, physics: ctx.physics, shape: CollisionShape3D.box(1, 1, 1), mass: 8 });
 */
export { RigidBody3D } from "./RigidBody3D.js";
export type { IRigidBody3DOptions, RigidBodyType } from "./RigidBody3D.js";
/**
 * Install the Rapier physics plugin and simulation backend.
 * @situation add physics to a portable game
 * @situation provide the context used by character and rigid bodies
 * @constraint place rapier() before recast() in the plugin list
 * @example const game = defineGame({ plugins: [rapier()] });
 */
export { rapier } from "./plugin.js";
export type { PhysicsBody3D, IPhysicsContext } from "./plugin.js";
export {
  MAX_PHYSICS_QUERY_RESULTS,
  PHYSICS_COLLISION_EVENT_STRIDE,
  PHYSICS_TRANSFORM_STRIDE,
} from "./simulation.js";
export type {
  IPhysicsBodyCreateOptions,
  IPhysicsCharacterOptions,
  IPhysicsInputSnapshot,
  IPhysicsJointCreateOptions,
  IPhysicsJointLimit,
  IPhysicsRuntimeSimulation,
  IPhysicsShapeDescriptor,
  PhysicsShapeKind,
  IPhysicsSimulation,
  IPhysicsPointQuery,
  IPhysicsQueryHit,
  IPhysicsRayHit,
  IPhysicsRayQuery,
  IPhysicsRotation,
  IPhysicsShapeQuery,
  IPhysicsVector3,
  PhysicsJointKind,
} from "./simulation.js";
