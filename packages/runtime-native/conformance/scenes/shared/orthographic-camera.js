import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(
    canvas,
    dimensions,
    "orthographic-camera",
    ({ scene }) => {
      const left = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 1.4, 0.3),
        new THREE.MeshBasicMaterial({ color: 0x4299e1 }),
      );
      left.position.x = -0.65;
      const right = new THREE.Mesh(
        new THREE.CircleGeometry(0.55, 40),
        new THREE.MeshBasicMaterial({ color: 0xf6ad55 }),
      );
      right.position.x = 0.65;
      scene.add(left, right);
      return { left, right };
    },
    {
      camera: (size) => {
        const aspect = size.width / size.height;
        const camera = new THREE.OrthographicCamera(-2 * aspect, 2 * aspect, 2, -2, 0.1, 10);
        camera.position.z = 4;
        return camera;
      },
    },
  );
}
