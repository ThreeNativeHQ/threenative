import type { PerspectiveCamera } from "three";

export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 48;
  camera.near = 0.1;
  camera.far = 120;
  camera.position.set(0, 22, 19);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}
