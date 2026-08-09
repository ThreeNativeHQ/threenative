import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "transparent-material", ({ scene }) => {
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(1.35, 1.35, 0.25),
      new THREE.MeshBasicMaterial({ color: 0x2b6cb0 }),
    );
    back.position.z = -0.35;
    const front = new THREE.Mesh(
      new THREE.CircleGeometry(0.72, 48),
      new THREE.MeshBasicMaterial({ color: 0xf6ad55, transparent: true, opacity: 0.48 }),
    );
    front.position.set(0.3, 0.15, 0.05);
    scene.add(back, front);
    return { back, front };
  });
}
