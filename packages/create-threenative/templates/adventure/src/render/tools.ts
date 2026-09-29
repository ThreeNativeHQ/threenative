// The two engine helpers this folder needs and may not import: `src/render/` imports no framework
// package (it is plain Three.js the game owns), so the scene passes them in. `Play.ts` builds one
// of these from `mergeByMaterial` and `InstancedBatch` in `@threenative/core` — the capability
// search's answers for "one draw per material" and "thousands of copies, count unknown".
import type { BufferGeometry, InstancedMesh, Material, Matrix4, Mesh, Object3D } from "three";

export interface IBatch {
  /** Adds one instance from a matrix the game composed, and returns its index. */
  readonly add: (matrix: Matrix4) => number;
  /** Adds one instance and returns its index. */
  readonly place: (instance: {
    position: readonly [number, number, number];
    rotation?: readonly [number, number, number];
    scale?: readonly [number, number, number] | number;
  }) => number;
  /** Builds the one instanced mesh, or `undefined` when nothing was placed. */
  readonly build: (options: {
    castShadow?: boolean;
    name?: string;
    parent?: Object3D;
    receiveShadow?: boolean;
  }) => InstancedMesh | undefined;
}

export interface IRenderTools {
  /** Starts an instanced batch of one shape and one surface. */
  readonly batch: (geometry: BufferGeometry, material: Material) => IBatch;
  /** Bakes a group's static meshes into one mesh per material, in the group's local space. */
  readonly merge: (root: Object3D, label: string) => Mesh[];
}
