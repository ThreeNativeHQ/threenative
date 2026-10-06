import type { PerspectiveCamera, Vector3 } from "three";
/** Correctness-only close view; paired workload cameras keep the full visible crowd. */
export function qualificationCamera(camera: PerspectiveCamera, root: Vector3, outside: boolean) {
  camera.fov = 50;
  camera.updateProjectionMatrix();
  if (outside) {
    camera.position.set(18, 10, 16);
    camera.lookAt(18, 0, 16); // Course edge remains visible while wolves leave the frustum.
  } else {
    camera.position.set(root.x + 3, root.y + 2.2, root.z + 4);
    camera.lookAt(root.x, root.y - 0.15, root.z);
  }
  camera.updateMatrixWorld();
}
