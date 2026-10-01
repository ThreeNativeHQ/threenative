// Generated for you. This is ordinary Three.js. Every shape here is a rounded box, cylinder or
// capsule, so the kit ships with no downloaded asset and nothing to license. Replace any of it
// with a loaded model when you have one; nothing here is framework API.
//
// The track is the arena's own plate: a light metre-grid top on a dark-grid body that reaches down.
// Two meshes, so the running surface reads as floor and the sides read as structure, and world-
// metre UVs (`worldGridUVs`) keep one grid tile one metre on every face however a chunk is resized.
import { Group, Mesh, type MeshStandardMaterial, PlaneGeometry } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { floorMaterial, propMaterial, structureMaterial, worldGridUVs } from "./materials.js";

export const LANE_WIDTH = 2.4;
export const TRACK_WIDTH = LANE_WIDTH * 3;
export const OBSTACLE_SIZE = { depth: 1.1, height: 1.5, width: 1.6 } as const;

/** The bevel that catches a line of sun and a line of sky, so a block reads as made. */
const BEVEL = 0.03;

function solid(mesh: Mesh): Mesh {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function rounded(
  size: readonly [number, number, number],
  at: readonly [number, number, number],
): RoundedBoxGeometry {
  return new RoundedBoxGeometry(size[0], size[1], size[2], 2, BEVEL).translate(at[0], at[1], at[2]);
}

/**
 * The ground that runs out past the track to the haze line, so the sky meets ground and not a
 * void. It carries no collider — the track is what you stand on.
 */
export function ground(): Mesh {
  const mesh = new Mesh(
    worldGridUVs(new PlaneGeometry(12_000, 12_000).rotateX(-Math.PI / 2)),
    floorMaterial,
  );
  mesh.position.y = -0.4;
  mesh.receiveShadow = true;
  return mesh;
}

/** One chunk's road: a light-grid plate on a dark-grid body. Built once per pooled chunk. */
export function trackSlab(length: number): Group {
  const group = new Group();
  const base = new Mesh(rounded([TRACK_WIDTH, 0.6, length], [0, -0.5, 0]), structureMaterial);
  base.receiveShadow = true;
  const plate = new Mesh(
    worldGridUVs(rounded([TRACK_WIDTH, 0.2, length], [0, -0.1, 0])),
    floorMaterial,
  );
  plate.receiveShadow = true;
  group.add(base, plate);
  return group;
}

/** The rails that edge the road. They carry the sense of speed more than the road does. */
export function trackRails(length: number): Group {
  const group = new Group();
  for (const side of [-1, 1]) {
    const rail = solid(
      new Mesh(
        rounded([0.22, 0.4, length], [(side * (TRACK_WIDTH + 0.22)) / 2, 0.1, 0]),
        structureMaterial,
      ),
    );
    group.add(rail);
  }
  return group;
}

/** One instanced obstacle's geometry and material, handed to an `InstancedBatch` per chunk. */
export function obstacleShape(): {
  geometry: RoundedBoxGeometry;
  material: MeshStandardMaterial;
} {
  return {
    geometry: new RoundedBoxGeometry(
      OBSTACLE_SIZE.width,
      OBSTACLE_SIZE.height,
      OBSTACLE_SIZE.depth,
      2,
      BEVEL,
    ),
    material: propMaterial,
  };
}
