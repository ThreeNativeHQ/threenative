export { Area3D } from "./Area3D.js";
export type { Area3DOptions, AreaContact, AreaEvent, AreaHandler } from "../Area3D.js";
export { CharacterBody3D } from "./CharacterBody3D.js";
export type { CharacterBody3DOptions } from "../CharacterBody3D.js";
export { CollisionShape3D } from "./CollisionShape3D.js";
export type { CollisionShapeHandle, CollisionShapeKind } from "../CollisionShape3D.js";
export type {
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  PhysicsHandle,
  PhysicsWorldHandle,
} from "../handles.js";
export { interactionGroups } from "../collision.js";
export { RigidBody3D } from "./RigidBody3D.js";
export type { RigidBody3DOptions, RigidBodyType } from "../RigidBody3D.js";
export { rapier } from "./plugin.js";
export type { PhysicsBody3D, PhysicsContext, PhysicsOptions, PhysicsPlugin } from "../plugin.js";
export { PHYSICS_TRANSFORM_STRIDE } from "../simulation.js";
export type { PhysicsInputSnapshot, PhysicsSimulation } from "../simulation.js";
