import "./web.js";

/**
 * Detect overlaps without turning the body into a moving collider.
 * @situation detect when an enemy enters a trigger area
 * @situation react to a player entering a zone
 * @constraint add the area to the physics context before stepping the world
 * @example const area = new Area3D({ context, shape });
 */
export { Area3D } from "./Area3D.js";
/**
 * Move a character body with collision-aware sliding.
 * @situation move an enemy or player through a level
 * @situation keep a character from walking through walls
 * @constraint use moveAndSlide inside the physics update
 * @example const body = new CharacterBody3D({ context, object });
 */
export { CharacterBody3D } from "./CharacterBody3D.js";
/**
 * Give a physics body a Three.js collision shape.
 * @situation add a capsule or box collider to a character
 * @situation configure the shape used by a rigid body
 * @constraint create shapes through the owning physics context
 * @example const shape = new CollisionShape3D({ context, shape: "capsule" });
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
 * @constraint both bodies must belong to the same physics context
 * @example const joint = new Joint3D({ context, kind: "hinge" });
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
 * @constraint register rapier() in the game plugin list before using bodies
 * @example const crate = new RigidBody3D({ context, object, mode: "dynamic" });
 */
export { RigidBody3D } from "./RigidBody3D.js";
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
