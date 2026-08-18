export { A as Area3D, C as CharacterBody3D, a as CollisionShape3D, I as ICollisionShapeHandle, b as IIntersectPointOptions, c as IIntersectRayOptions, d as IIntersectShapeOptions, e as IPhysicsBodyCreateOptions, f as IPhysicsBodyHandle, g as IPhysicsCharacterOptions, h as IPhysicsColliderHandle, i as IPhysicsContext, j as IPhysicsHandle, k as IPhysicsInputSnapshot, l as IPhysicsPointQuery, m as IPhysicsQueryHit, n as IPhysicsRayHit, o as IPhysicsRayQuery, p as IPhysicsRotation, q as IPhysicsRuntimeSimulation, r as IPhysicsShapeDescriptor, s as IPhysicsShapeQuery, t as IPhysicsSimulation, u as IPhysicsVector3, v as IPhysicsWorldHandle, w as IPointHit, x as IRayHit, y as IShapeHit, M as MAX_PHYSICS_QUERY_RESULTS, P as PHYSICS_COLLISION_EVENT_STRIDE, z as PHYSICS_TRANSFORM_STRIDE, B as PhysicsBody3D, D as PhysicsDirectSpaceState3D, E as PhysicsQueryVector3, F as PhysicsShapeKind, R as RigidBody3D, G as rapier } from './Area3D-CvwDbfU6.js';
import 'three';
import '@threenative/core';
import 'recast-navigation';

/** Rapier packs membership in the high 16 bits and the filter in the low 16. */
declare function interactionGroups(layer: number, mask: number): number;

export { interactionGroups };
