export { A as Area3D, a as Area3DOptions, b as AreaContact, c as AreaEvent, d as AreaHandler, C as CharacterBody3D, e as CharacterBody3DOptions, P as PhysicsBody3D, f as PhysicsContext, g as PhysicsOptions, h as PhysicsPlugin, R as RigidBody3D, i as RigidBody3DOptions, j as RigidBodyType, r as rapier } from './Area3D-DX70zE-Y.js';
import * as RAPIER from '@dimforge/rapier3d-compat';
import { Mesh } from 'three';
import '@threenative/core';
import 'recast-navigation';

type CollisionShapeKind = "box" | "sphere" | "capsule" | "trimesh" | "convexHull" | "heightfield";
declare class CollisionShape3D {
    static box(width: number, height: number, depth: number): RAPIER.ColliderDesc;
    static sphere(radius: number): RAPIER.ColliderDesc;
    static capsule(halfHeight: number, radius: number): RAPIER.ColliderDesc;
    static heightfield(rows: number, columns: number, heights: Float32Array, scale: {
        x: number;
        y: number;
        z: number;
    }): RAPIER.ColliderDesc;
    static fromMesh(mesh: Mesh, kind?: CollisionShapeKind): RAPIER.ColliderDesc;
}

/** Rapier packs membership in the high 16 bits and the filter in the low 16. */
declare function interactionGroups(layer: number, mask: number): number;

export { CollisionShape3D, type CollisionShapeKind, interactionGroups };
