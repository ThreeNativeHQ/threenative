import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "ambient-light", ({ scene }) => {
    const mesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.9),
      new THREE.MeshStandardMaterial({ color: 0x63b3ed, roughness: 0.55 }),
    );
    mesh.rotation.set(0.2, 0.4, 0);
    const light = new THREE.AmbientLight(0xffe8cc, 2.4);
    scene.add(mesh, light);
    return { mesh, light };
  });
}
