import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "shadow-map", ({ renderer, scene, camera }) => {
    renderer.shadowMap.enabled = true;
    camera.position.set(2.8, 2.3, 4.2);
    camera.lookAt(0, 0, 0);
    const object = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.52, 0.17, 80, 14),
      new THREE.MeshStandardMaterial({ color: 0xed8936, roughness: 0.6 }),
    );
    object.position.y = 0.35;
    object.castShadow = true;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 5),
      new THREE.MeshStandardMaterial({ color: 0x718096, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.75;
    floor.receiveShadow = true;
    const light = new THREE.DirectionalLight(0xffffff, 3.5);
    light.position.set(-2.5, 4, 3);
    light.castShadow = true;
    scene.add(object, floor, light, new THREE.AmbientLight(0x405070, 0.45));
    return { object, floor, light };
  });
}
