import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "mesh-standard-material", ({ scene }) => {
    const material = new THREE.MeshStandardMaterial({
      color: 0x50c878,
      roughness: 0.42,
      metalness: 0.08,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.86, 32, 20), material);
    scene.add(mesh, new THREE.AmbientLight(0x406080, 0.7));
    const light = new THREE.DirectionalLight(0xffffff, 3.2);
    light.position.set(-3, 4, 5);
    scene.add(light);
    return { mesh, material, light };
  });
}
