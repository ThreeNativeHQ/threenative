import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "pbr-material", ({ scene }) => {
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xb794f4,
      roughness: 0.22,
      metalness: 0.62,
      clearcoat: 0.8,
      clearcoatRoughness: 0.15,
    });
    const mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(0.6, 0.2, 96, 16), material);
    mesh.rotation.set(0.25, 0.4, 0);
    scene.add(mesh, new THREE.AmbientLight(0x7090c0, 1));
    const light = new THREE.PointLight(0xffffff, 28, 12, 2);
    light.position.set(-2.5, 3, 4);
    scene.add(light);
    return { mesh, material, light };
  });
}
