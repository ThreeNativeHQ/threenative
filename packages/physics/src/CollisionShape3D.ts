import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Mesh } from "three";

export type CollisionShapeKind =
  | "box"
  | "sphere"
  | "capsule"
  | "trimesh"
  | "convexHull"
  | "heightfield";

function geometryVertices(mesh: Mesh): Float32Array {
  const position = mesh.geometry.getAttribute("position");
  if (position === undefined)
    throw new Error("CollisionShape3D.fromMesh requires vertex positions.");
  const vertices = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index++) {
    vertices[index * 3] = position.getX(index) * mesh.scale.x;
    vertices[index * 3 + 1] = position.getY(index) * mesh.scale.y;
    vertices[index * 3 + 2] = position.getZ(index) * mesh.scale.z;
  }
  return vertices;
}

function geometryIndices(mesh: Mesh): Uint32Array {
  const index = mesh.geometry.getIndex();
  if (index !== null)
    return Uint32Array.from({ length: index.count }, (_, offset) => index.getX(offset));
  const count = mesh.geometry.getAttribute("position")?.count ?? 0;
  if (count === 0 || count % 3 !== 0)
    throw new Error("CollisionShape3D.fromMesh requires triangle indices.");
  return Uint32Array.from({ length: count }, (_, offset) => offset);
}

// biome-ignore lint/complexity/noStaticOnlyClass: The public Godot-shaped API is intentionally a static class.
export class CollisionShape3D {
  static box(width: number, height: number, depth: number): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2);
  }

  static sphere(radius: number): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.ball(radius);
  }

  static capsule(halfHeight: number, radius: number): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.capsule(halfHeight, radius);
  }

  static heightfield(
    rows: number,
    columns: number,
    heights: Float32Array,
    scale: { x: number; y: number; z: number },
  ): RAPIER.ColliderDesc {
    if (!Number.isInteger(rows) || rows < 2)
      throw new Error("CollisionShape3D.heightfield requires at least 2 rows.");
    if (!Number.isInteger(columns) || columns < 2)
      throw new Error("CollisionShape3D.heightfield requires at least 2 columns.");
    if (heights.length !== rows * columns)
      throw new Error(
        `CollisionShape3D.heightfield expected ${rows * columns} heights, received ${heights.length}.`,
      );
    return RAPIER.ColliderDesc.heightfield(rows - 1, columns - 1, heights, scale);
  }

  static fromMesh(mesh: Mesh, kind?: CollisionShapeKind): RAPIER.ColliderDesc {
    const geometry = mesh.geometry;
    const inferred =
      kind ??
      (geometry.type.toLowerCase().includes("sphere")
        ? "sphere"
        : geometry.type.toLowerCase().includes("capsule")
          ? "capsule"
          : "box");
    if (inferred === "trimesh")
      return RAPIER.ColliderDesc.trimesh(geometryVertices(mesh), geometryIndices(mesh));
    if (inferred === "convexHull") {
      const shape = RAPIER.ColliderDesc.convexHull(geometryVertices(mesh));
      if (shape === null)
        throw new Error("CollisionShape3D.fromMesh could not build a convex hull.");
      return shape;
    }

    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (bounds === null) throw new Error("CollisionShape3D.fromMesh requires a bounding box.");
    const width = (bounds.max.x - bounds.min.x) * Math.abs(mesh.scale.x);
    const height = (bounds.max.y - bounds.min.y) * Math.abs(mesh.scale.y);
    const depth = (bounds.max.z - bounds.min.z) * Math.abs(mesh.scale.z);
    if (inferred === "sphere") {
      geometry.computeBoundingSphere();
      const radius =
        (geometry.boundingSphere?.radius ?? Math.max(width, height, depth) / 2) *
        Math.max(Math.abs(mesh.scale.x), Math.abs(mesh.scale.y), Math.abs(mesh.scale.z));
      return CollisionShape3D.sphere(radius);
    }
    if (inferred === "capsule") {
      const radius = Math.min(width, depth) / 2;
      return CollisionShape3D.capsule(Math.max(0, height / 2 - radius), radius);
    }
    return CollisionShape3D.box(width, height, depth);
  }
}
