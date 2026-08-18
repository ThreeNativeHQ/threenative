import "../native.js";

export { Area3D } from "../Area3D.js";
export type { IArea3DOptions, IAreaContact, AreaEvent, AreaHandler } from "../Area3D.js";
export { CharacterBody3D } from "../CharacterBody3D.js";
export type { ICharacterBody3DOptions } from "../CharacterBody3D.js";
export { CollisionShape3D } from "../CollisionShape3D.js";
export type { CollisionShapeKind } from "../CollisionShape3D.js";
export { Joint3D } from "../Joint3D.js";
export type {
  IFixedJoint3DOptions,
  IHingeJoint3DOptions,
  IJoint3DOptions,
  IPinJoint3DOptions,
  PhysicsJointBody,
} from "../Joint3D.js";
export { PhysicsDirectSpaceState3D } from "../PhysicsDirectSpaceState3D.js";
export type {
  IIntersectPointOptions,
  IIntersectRayOptions,
  IIntersectShapeOptions,
  IPointHit,
  IRayHit,
  IShapeHit,
  PhysicsQueryVector3,
} from "../PhysicsDirectSpaceState3D.js";
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
  MAX_PHYSICS_QUERY_RESULTS,
  PHYSICS_COLLISION_EVENT_STRIDE,
  PHYSICS_TRANSFORM_STRIDE,
} from "../simulation.js";
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
} from "../simulation.js";
