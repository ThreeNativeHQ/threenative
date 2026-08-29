// Generated for you. Camera framing is yours to edit.
import type { PerspectiveCamera } from "three";

export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 54;
  camera.near = 0.1;
  camera.far = 20_000;
  camera.position.set(0, 3, 9);
  camera.lookAt(0, 1, 0);
  camera.updateProjectionMatrix();
}
