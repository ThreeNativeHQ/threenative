export { A as Area3D, C as CharacterBody3D, a as CollisionShape3D, b as CollisionShapeHandle, P as PHYSICS_COLLISION_EVENT_STRIDE, c as PHYSICS_TRANSFORM_STRIDE, d as PhysicsBody3D, e as PhysicsBodyCreateOptions, f as PhysicsBodyHandle, g as PhysicsCharacterOptions, h as PhysicsColliderHandle, i as PhysicsContext, j as PhysicsHandle, k as PhysicsInputSnapshot, l as PhysicsRuntimeSimulation, m as PhysicsShapeDescriptor, n as PhysicsShapeKind, o as PhysicsSimulation, p as PhysicsWorldHandle, R as RigidBody3D, r as rapier } from './Area3D-m3JeDagX.js';
import 'three';
import '@threenative/core';
import 'recast-navigation';

/** Rapier packs membership in the high 16 bits and the filter in the low 16. */
declare function interactionGroups(layer: number, mask: number): number;

export { interactionGroups };
