import * as THREE from "three/webgpu";
import { instancedArray, instanceIndex, positionLocal } from "three/tsl";
import { startVisualScene } from "./scene-support.js";

export function assertStorageBufferProof(offsets, colors, material) {
  for (const [name, node] of [["offsets", offsets], ["colors", colors]]) {
    if (node?.isStorageBufferNode !== true || node.value?.isStorageInstancedBufferAttribute !== true) {
      throw new Error(`Storage-buffer proof requires a storage-backed ${name} node.`);
    }
    if (node.value.count !== 4) {
      throw new Error(`Storage-buffer proof expected four ${name} elements.`);
    }
  }
  if (material?.positionNode?.isNode !== true || material?.colorNode?.isNode !== true) {
    throw new Error("Storage-buffer proof must consume both buffers in the render graph.");
  }
}

export async function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "storage-buffer-smoke", ({ scene }) => {
    const offsets = instancedArray(new Float32Array([
      -0.9, -0.42, 0,
      -0.3, 0.42, 0,
      0.3, -0.42, 0,
      0.9, 0.42, 0,
    ]), "vec3");
    const colors = instancedArray(new Float32Array([
      0.95, 0.25, 0.18,
      0.12, 0.75, 0.38,
      0.16, 0.55, 0.95,
      0.92, 0.68, 0.12,
    ]), "vec3");
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionLocal.add(offsets.element(instanceIndex));
    material.colorNode = colors.element(instanceIndex);
    assertStorageBufferProof(offsets, colors, material);

    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.42, 0.18), material, 4);
    const identity = new THREE.Matrix4();
    for (let index = 0; index < 4; index += 1) mesh.setMatrixAt(index, identity);
    scene.add(mesh);
    return { mesh, offsets, colors, material, detail: { storageElements: 4, rendered: true } };
  });
}
