import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "mesh-basic-material", ({ scene }) => {
    const mesh = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.62, 0.2, 96, 16),
      new THREE.MeshBasicMaterial({ color: 0x49a6e9 }),
    );
    mesh.rotation.set(0.35, 0.45, 0);
    scene.add(mesh);
    return mesh;
  });
}
