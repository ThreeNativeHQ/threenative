import "./web.js";

export { Area3D } from "./Area3D.js";
export { CharacterBody3D } from "./CharacterBody3D.js";
export { CollisionShape3D } from "./CollisionShape3D.js";
export type { CollisionShapeHandle } from "./CollisionShape3D.js";
export type {
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  PhysicsHandle,
  PhysicsWorldHandle,
} from "./handles.js";
export { interactionGroups } from "./collision.js";
export { RigidBody3D } from "./RigidBody3D.js";
export { rapier } from "./plugin.js";
export type { PhysicsBody3D, PhysicsContext } from "./plugin.js";
export { PHYSICS_COLLISION_EVENT_STRIDE, PHYSICS_TRANSFORM_STRIDE } from "./simulation.js";
export type {
  PhysicsBodyCreateOptions,
  PhysicsCharacterOptions,
  PhysicsInputSnapshot,
  PhysicsRuntimeSimulation,
  PhysicsShapeDescriptor,
  PhysicsShapeKind,
  PhysicsSimulation,
} from "./simulation.js";
