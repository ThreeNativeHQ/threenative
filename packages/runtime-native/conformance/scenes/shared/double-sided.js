import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "double-sided", ({ scene }) => {
    const material = new THREE.MeshBasicMaterial({ color: 0x4fd1c5, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.25), material);
    mesh.rotation.set(0.3, Math.PI + 0.55, 0.15);
    scene.add(mesh);
    return { mesh, material };
  });
}
