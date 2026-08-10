import type { PerspectiveCamera } from "three";

export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 54;
  camera.near = 0.1;
  camera.far = 220;
  camera.updateProjectionMatrix();
}
