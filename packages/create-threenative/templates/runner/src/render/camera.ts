import type { PerspectiveCamera, Vector3 } from "three";

const HEIGHT = 3;
const BACK = 6.4;
const LOOK_AHEAD = 22;
/** How high up the track the rig aims. Lower means more road and less sky in the frame. */
const LOOK_HEIGHT = -0.2;

export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 62;
  camera.near = 0.1;
  camera.far = 220;
  camera.position.set(0, HEIGHT, BACK);
  camera.lookAt(0, LOOK_HEIGHT, -LOOK_AHEAD);
  camera.updateProjectionMatrix();
}

/**
 * A chase rig that leads the runner rather than tracking it exactly.
 *
 * The lateral lag is deliberate: a camera locked to the lane makes a lane change invisible,
 * because the runner never moves on screen. Lagging it is what turns the change into motion.
 *
 * `offset` is the shake, supplied by the scene from `CameraShake.update`. It is added here and
 * nowhere else, so the rig has one place that decides where the camera is.
 */
export function chaseRunner(
  camera: PerspectiveCamera,
  target: Vector3,
  dt: number,
  offset: { readonly x: number; readonly y: number; readonly z: number },
): void {
  const blend = Math.min(1, Math.max(0, dt) * 6);
  camera.position.x += (target.x * 0.55 - camera.position.x) * blend;
  camera.position.y = HEIGHT + offset.y;
  camera.position.z = target.z + BACK;
  camera.position.x += offset.x;
  camera.lookAt(target.x * 0.35, LOOK_HEIGHT, target.z - LOOK_AHEAD);
}
