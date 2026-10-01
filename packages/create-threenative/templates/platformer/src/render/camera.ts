// Generated for you. This is ordinary Three.js — edit or delete it freely.
//
// One side-on camera that trails the fox and leads the run. It is called from `afterPhysics` in
// `scenes/Play.ts`, never from the scene's own frame function: `moveAndSlide` only queues motion,
// so a camera written before the physics step frames where the body was, not where it ended up.
import type { PerspectiveCamera, Vector3 } from "three";

/** Behind and above, in metres, from the fox. */
const CAMERA_OFFSET = { x: -5.5, y: 5.2, z: 14.5 } as const;
/** Rate the camera closes on its target. Above 0 the frame time is treated as seconds. */
const FOLLOW_RATE = 0.0018;

export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 52;
  camera.near = 0.1;
  camera.far = 900;
  camera.updateProjectionMatrix();
}

export function followCamera(
  camera: PerspectiveCamera,
  player: Vector3,
  velocityX: number,
  dt: number,
): void {
  camera.position.x += (player.x + CAMERA_OFFSET.x - camera.position.x) * (1 - FOLLOW_RATE ** dt);
  camera.position.y +=
    (Math.max(player.y + CAMERA_OFFSET.y, player.y + 2.2) - camera.position.y) *
    (1 - FOLLOW_RATE ** dt);
  camera.position.z = player.z + CAMERA_OFFSET.z;
  // Look ahead of the run, so the next gap is on screen before the fox reaches it.
  camera.lookAt(player.x + 3.4 + velocityX * 0.14, player.y + 2.6, player.z * 0.5);
}
