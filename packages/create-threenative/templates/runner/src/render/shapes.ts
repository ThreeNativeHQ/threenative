// Generated for you: ordinary Three.js. Every shape here is a box, cylinder or capsule, so the
// kit ships with no downloaded asset and nothing to license. Replace any of it with a loaded
// model when you have one; nothing here is framework API.
import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  type MeshStandardMaterial,
} from "three";
import { createMaterials } from "./materials.js";

export const LANE_WIDTH = 2.4;
export const TRACK_WIDTH = LANE_WIDTH * 3;
export const OBSTACLE_SIZE = { depth: 1.1, height: 1.5, width: 1.6 } as const;

function solid(mesh: Mesh): Mesh {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** One chunk's road surface. Chunks are recycled, so this is built once per pooled chunk. */
export function trackSlab(length: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(TRACK_WIDTH, 0.4, length), createMaterials().track);
  mesh.position.y = -0.2;
  mesh.receiveShadow = true;
  return mesh;
}

/** The rails that edge the road. They carry the sense of speed more than the road does. */
export function trackRails(length: number): Group {
  const group = new Group();
  const materials = createMaterials();
  for (const side of [-1, 1]) {
    const rail = solid(new Mesh(new BoxGeometry(0.22, 0.4, length), materials.rail));
    rail.position.set((side * (TRACK_WIDTH + 0.22)) / 2, 0.1, 0);
    group.add(rail);
  }
  return group;
}

/** One instanced obstacle's geometry and material, handed to an `InstancedBatch` per chunk. */
export function obstacleShape(): {
  geometry: BoxGeometry;
  material: MeshStandardMaterial;
} {
  return {
    geometry: new BoxGeometry(OBSTACLE_SIZE.width, OBSTACLE_SIZE.height, OBSTACLE_SIZE.depth),
    material: createMaterials().obstacle,
  };
}

/** The runner: a capsule on a skirt, so its lane and its height are both readable from behind. */
export function runner(): Group {
  const materials = createMaterials();
  const group = new Group();
  const body = solid(new Mesh(new CapsuleGeometry(0.34, 0.7, 6, 12), materials.runner));
  body.position.y = 0.72;
  const skirt = solid(new Mesh(new CylinderGeometry(0.5, 0.62, 0.16, 14), materials.rail));
  skirt.position.y = 0.1;
  // The fin is `rail`, not the accent: the accent belongs to hazards and to nothing else.
  const fin = solid(new Mesh(new BoxGeometry(0.1, 0.42, 0.5), materials.rail));
  fin.position.set(0, 1.05, -0.18);
  group.add(body, skirt, fin);
  return group;
}
