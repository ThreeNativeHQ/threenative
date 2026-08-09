import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "spot-light", ({ scene, camera }) => {
    camera.position.set(2.4, 2.1, 4.2);
    camera.lookAt(0, 0, 0);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.75, 1.4, 32),
      new THREE.MeshStandardMaterial({ color: 0xfc8181, roughness: 0.6 }),
    );
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 5),
      new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.72;
    const light = new THREE.SpotLight(0xffffff, 35, 12, Math.PI / 5, 0.25, 2);
    light.position.set(-2, 3.5, 3);
    light.target = mesh;
    scene.add(mesh, floor, light, new THREE.AmbientLight(0x203050, 0.3));
    return { mesh, floor, light };
  });
}
