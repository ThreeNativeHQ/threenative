import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "point-light", ({ scene }) => {
    const mesh = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.62, 0.2, 96, 16),
      new THREE.MeshStandardMaterial({ color: 0x68d391, roughness: 0.48 }),
    );
    mesh.rotation.set(0.3, 0.45, 0);
    const light = new THREE.PointLight(0xfff5d6, 32, 12, 2);
    light.position.set(-2.2, 2.4, 3.2);
    scene.add(mesh, light, new THREE.AmbientLight(0x203050, 0.35));
    return { mesh, light };
  });
}
