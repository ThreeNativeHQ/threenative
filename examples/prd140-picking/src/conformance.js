import {
  assertCondition,
  startVisualScene,
} from "../../../packages/runtime-native/conformance/scenes/shared/scene-support.js";
import { createGpuSceneBvhDemo, loadGpuSceneBvhModel } from "./render/gpu-scene-bvh.ts";

export async function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "gpu-scene-bvh", async ({ camera, scene }) => {
    camera.position.set(0, 7.5, 10);
    camera.lookAt(0, 0, -0.3);
    const loadedScene = await loadGpuSceneBvhModel();
    const subject = createGpuSceneBvhDemo(
      scene,
      (object) => {
        scene.add(object);
        return object;
      },
      loadedScene,
    );
    assertCondition(
      subject.bvh.objectCount === 5,
      "GPUSceneBVH must pack four loaded meshes and one instanced mesh",
    );
    assertCondition(
      subject.bvh.triangleCount === 72,
      "GPUSceneBVH must pack every indexed GLTF and instance triangle",
    );
    assertCondition(
      subject.bvh.nodes.isStorageBufferNode === true,
      "native proof must consume BVH node storage",
    );
    assertCondition(
      subject.bvh.positions.isStorageBufferNode === true,
      "native proof must consume position storage",
    );
    assertCondition(
      subject.bvh.indices.isStorageBufferNode === true,
      "native proof must consume index storage",
    );
    assertCondition(
      subject.bvh.normals.isStorageBufferNode === true,
      "native proof must pack normal storage",
    );
    return {
      ...subject,
      detail: {
        bvhObjects: subject.bvh.objectCount,
        bvhTriangles: subject.bvh.triangleCount,
        gpuTrace: "three-mesh-bvh/webgpu bvhIntersectFirstHit",
        selectedBy: "userData.traceable predicate",
        target: "desktop",
      },
    };
  });
}
