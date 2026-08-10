import * as THREE from "three/webgpu";
import { color, mix, time, uv } from "three/tsl";
import { startVisualScene } from "./scene-support.js";

export function assertTimeNodeProof(material, timeNode) {
  if (timeNode?.isNode !== true || material?.colorNode?.isNode !== true) {
    throw new Error("TSL time proof requires the render-updated time node in the color graph.");
  }
}

export async function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "tsl-time-node", ({ scene }) => {
    // Time is a live render-group uniform. The non-negative branch keeps captures deterministic.
    const deterministicPhase = time.greaterThanEqual(0).select(uv().x, uv().y);
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = mix(color(0x312e81), color(0xfacc15), deterministicPhase);
    assertTimeNodeProof(material, time);

    const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.95, 48), material);
    scene.add(mesh);
    return {
      mesh,
      material,
      detail: { timeNode: true, deterministicCapture: "time >= 0 ? uv.x : uv.y" },
    };
  });
}
