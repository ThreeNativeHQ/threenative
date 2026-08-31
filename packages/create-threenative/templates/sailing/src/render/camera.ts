// Generated for you. Framing is a game-owned decision.
import type { PerspectiveCamera } from "three";

export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 48;
  camera.near = 0.1;
  camera.far = 120;
  camera.position.set(8, 7, 11);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

export function followShip(
  camera: PerspectiveCamera,
  target: { x: number; y: number; z: number },
): void {
  camera.position.x = target.x + 8;
  camera.position.y = target.y + 6;
  camera.position.z = target.z + 10;
  camera.lookAt(target.x, target.y, target.z - 2);
}
