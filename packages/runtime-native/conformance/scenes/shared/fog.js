import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "fog", ({ scene, camera }) => {
    scene.fog = new THREE.Fog(0x718096, 2.2, 8.5);
    scene.background = new THREE.Color(0x718096);
    camera.position.set(0, 0.5, 3.6);
    const material = new THREE.MeshBasicMaterial({ color: 0x9f1239 });
    const meshes = [-1, -3.2, -5.4].map((z, index) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      mesh.position.set((index - 1) * 0.75, 0, z);
      mesh.rotation.set(0.2, 0.35, 0);
      scene.add(mesh);
      return mesh;
    });
    return meshes;
  });
}
