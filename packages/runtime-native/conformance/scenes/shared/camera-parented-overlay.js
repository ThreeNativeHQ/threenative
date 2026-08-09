import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "camera-parented-overlay", ({ scene, camera }) => {
    const world = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.62, 0.2, 96, 16),
      new THREE.MeshStandardMaterial({ color: 0x718096, roughness: 0.5 }),
    );
    world.rotation.set(0.3, 0.4, 0);
    const overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.22),
      new THREE.MeshBasicMaterial({ color: 0x48bb78, depthTest: false }),
    );
    overlay.position.set(0.72, 0.4, -1.4);
    overlay.renderOrder = 10;
    camera.add(overlay);
    scene.add(camera, world, new THREE.DirectionalLight(0xffffff, 3));
    return { world, overlay };
  });
}
