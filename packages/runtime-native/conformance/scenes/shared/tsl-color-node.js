import * as THREE from "three/webgpu";
import { color, mix, uv } from "three/tsl";
import { startVisualScene } from "./scene-support.js";

export function assertColorNodeProof(material) {
  if (material?.isNodeMaterial !== true || material.colorNode?.isNode !== true) {
    throw new Error("TSL color proof requires a NodeMaterial with a compiled colorNode.");
  }
}

export async function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "tsl-color-node", ({ scene }) => {
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = mix(color(0xf97316), color(0x22d3ee), uv().x);
    assertColorNodeProof(material);

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.5, 8, 4), material);
    mesh.rotation.z = -0.08;
    scene.add(mesh);
    return { mesh, material, detail: { colorNode: true, gradientAxis: "uv.x" } };
  });
}
