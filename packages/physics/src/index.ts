import "./web.js";

export { Area3D } from "./Area3D.js";
export { CharacterBody3D } from "./CharacterBody3D.js";
export { CollisionShape3D } from "./CollisionShape3D.js";
export type { ICollisionShapeHandle } from "./CollisionShape3D.js";
export { PhysicsDirectSpaceState3D } from "./PhysicsDirectSpaceState3D.js";
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
export { interactionGroups } from "./collision.js";
export { RigidBody3D } from "./RigidBody3D.js";
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
} from "./simulation.js";
