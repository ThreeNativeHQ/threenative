import * as THREE from "three/webgpu";
import {
  float,
  Fn,
  instancedArray,
  instanceIndex,
  positionLocal,
  vec3,
} from "three/tsl";
import { startVisualScene } from "./scene-support.js";

export function assertComputeProof(computeNode, positions, completion) {
  if (computeNode?.isComputeNode !== true || positions?.isStorageBufferNode !== true) {
    throw new Error("Compute proof requires a ComputeNode writing a storage buffer.");
  }
  if (completion === null || typeof completion?.then !== "function") {
    throw new Error("Compute proof requires observable computeAsync completion.");
  }
}

export async function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "compute-smoke", async ({ renderer, scene }) => {
    const positions = instancedArray(4, "vec3");
    const computeNode = Fn(() => {
      const index = float(instanceIndex);
      positions.element(instanceIndex).assign(vec3(index.mul(0.62).sub(0.93), index.sin().mul(0.38), 0));
    })().compute(4);
    const completion = renderer.computeAsync(computeNode);
    assertComputeProof(computeNode, positions, completion);
    await completion;

    const colors = instancedArray(new Float32Array([
      0.96, 0.32, 0.2,
      0.2, 0.84, 0.5,
      0.18, 0.58, 0.98,
      0.92, 0.7, 0.16,
    ]), "vec3");
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionLocal.add(positions.element(instanceIndex));
    material.colorNode = colors.element(instanceIndex);
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 16, 10), material, 4);
    const identity = new THREE.Matrix4();
    for (let index = 0; index < 4; index += 1) mesh.setMatrixAt(index, identity);
    scene.add(mesh);
    return {
      mesh,
      computeNode,
      positions,
      detail: { dispatchCount: 4, completionObserved: true, renderedStorage: true },
    };
  });
}
