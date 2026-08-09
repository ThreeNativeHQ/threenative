import type { Mesh } from "three";
import type { CollisionShapeKind } from "../CollisionShape3D.js";
import type { NativeShapeDescriptor } from "./host.js";

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`CollisionShape3D.${label} requires a positive finite value.`);
  return value;
}

export class CollisionShape3D {
  /** Native: a portable descriptor. Web: `RAPIER.ColliderDesc`. */
  readonly raw: NativeShapeDescriptor;

  private constructor(raw: NativeShapeDescriptor) {
    this.raw = raw;
  }

  static box(width: number, height: number, depth: number): CollisionShape3D {
    return new CollisionShape3D({
      collisionLayer: 1,
      collisionMask: 0xffff,
      kind: "box",
      sensor: false,
      x: finitePositive(width, "box") / 2,
      y: finitePositive(height, "box") / 2,
      z: finitePositive(depth, "box") / 2,
    });
  }

  static sphere(radius: number): CollisionShape3D {
    return new CollisionShape3D({
      collisionLayer: 1,
      collisionMask: 0xffff,
      kind: "sphere",
      sensor: false,
      x: finitePositive(radius, "sphere"),
      y: 0,
      z: 0,
    });
  }

  static capsule(halfHeight: number, radius: number): CollisionShape3D {
    if (!Number.isFinite(halfHeight) || halfHeight < 0)
      throw new Error("CollisionShape3D.capsule requires a finite non-negative halfHeight.");
    return new CollisionShape3D({
      collisionLayer: 1,
      collisionMask: 0xffff,
      kind: "capsule",
      sensor: false,
      x: halfHeight,
      y: finitePositive(radius, "capsule"),
      z: 0,
    });
  }

  static heightfield(): never {
    throw new Error("TN_NATIVE_PHYSICS_SHAPE_UNSUPPORTED: heightfield remains OPEN on native");
  }

  static fromMesh(mesh: Mesh, kind?: CollisionShapeKind): CollisionShape3D {
    if (kind === "trimesh" || kind === "convexHull" || kind === "heightfield") {
      throw new Error(`TN_NATIVE_PHYSICS_SHAPE_UNSUPPORTED: ${kind} remains OPEN on native`);
    }
    mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    if (bounds === null) throw new Error("CollisionShape3D.fromMesh requires a bounding box.");
    const width = (bounds.max.x - bounds.min.x) * Math.abs(mesh.scale.x);
    const height = (bounds.max.y - bounds.min.y) * Math.abs(mesh.scale.y);
    const depth = (bounds.max.z - bounds.min.z) * Math.abs(mesh.scale.z);
    const inferred =
      kind ?? (mesh.geometry.type.toLowerCase().includes("sphere") ? "sphere" : "box");
    if (inferred === "sphere") return CollisionShape3D.sphere(Math.max(width, height, depth) / 2);
    if (inferred === "capsule") {
      const radius = Math.min(width, depth) / 2;
      return CollisionShape3D.capsule(Math.max(0, height / 2 - radius), radius);
    }
    return CollisionShape3D.box(width, height, depth);
  }

  setCollisionGroups(groups: number): this {
    this.raw.collisionLayer = groups >>> 16;
    this.raw.collisionMask = groups & 0xffff;
    return this;
  }

  setSensor(sensor: boolean): this {
    this.raw.sensor = sensor;
    return this;
  }
}
