import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "hemisphere-light", ({ scene }) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 32, 20),
      new THREE.MeshStandardMaterial({ color: 0xf7fafc, roughness: 0.65 }),
    );
    const light = new THREE.HemisphereLight(0x63b3ed, 0x9c4221, 3);
    scene.add(mesh, light);
    return { mesh, light };
  });
}
