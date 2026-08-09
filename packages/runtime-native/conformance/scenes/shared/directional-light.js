import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "directional-light", ({ scene }) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 32, 20),
      new THREE.MeshStandardMaterial({ color: 0xf6ad55, roughness: 0.5 }),
    );
    const light = new THREE.DirectionalLight(0xd6ecff, 3.5);
    light.position.set(-4, 3, 5);
    scene.add(mesh, light);
    return { mesh, light };
  });
}
