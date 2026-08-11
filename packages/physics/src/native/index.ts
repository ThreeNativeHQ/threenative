import "../native.js";

export { Area3D } from "../Area3D.js";
export type { IArea3DOptions, IAreaContact, AreaEvent, AreaHandler } from "../Area3D.js";
export { CharacterBody3D } from "../CharacterBody3D.js";
export type { ICharacterBody3DOptions } from "../CharacterBody3D.js";
export { CollisionShape3D } from "../CollisionShape3D.js";
export type { CollisionShapeKind } from "../CollisionShape3D.js";
export type {
  IPhysicsBodyHandle,
  IPhysicsColliderHandle,
  IPhysicsHandle,
  IPhysicsWorldHandle,
} from "../handles.js";
export { interactionGroups } from "../collision.js";
export { RigidBody3D } from "../RigidBody3D.js";
export type { IRigidBody3DOptions, RigidBodyType } from "../RigidBody3D.js";
export { rapier } from "../plugin.js";
export type { PhysicsBody3D, IPhysicsContext, IPhysicsOptions, PhysicsPlugin } from "../plugin.js";
export {
  PHYSICS_COLLISION_EVENT_STRIDE,
  PHYSICS_TRANSFORM_STRIDE,
} from "../simulation.js";
export type {
  IPhysicsBodyCreateOptions,
  IPhysicsCharacterOptions,
  IPhysicsInputSnapshot,
  IPhysicsRuntimeSimulation,
  IPhysicsShapeDescriptor,
  PhysicsShapeKind,
  IPhysicsSimulation,
} from "../simulation.js";
