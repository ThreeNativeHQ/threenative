// Generated for you. Framing is a game-owned decision.
import type { PerspectiveCamera } from "three";

export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 52;
  camera.near = 0.1;
  camera.far = 420;
  camera.position.set(5.2, 2.6, 6.4);
  camera.lookAt(0, 0.6, -2);
  camera.updateProjectionMatrix();
}

/**
 * Follow from off the starboard quarter, near the water.
 *
 * Held at eight up and six across the ship was a speck in the middle of an empty sea and the rig —
 * the thing that makes it a ship — was too small to read at all. Low and close puts the sails
 * against the sky, which is the shot this game is about.
 */
export function followShip(
  camera: PerspectiveCamera,
  target: { x: number; y: number; z: number },
): void {
  camera.position.x = target.x + 5.2;
  camera.position.y = target.y + 2.6;
  camera.position.z = target.z + 6.4;
  camera.lookAt(target.x, target.y + 0.9, target.z - 2.4);
}
