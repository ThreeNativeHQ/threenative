import type { PerspectiveCamera, Vector3 } from "three";

const HEIGHT = 20;
const BACK = 17;
/** How far the rig is allowed to lean toward the claw. A puzzle is read by comparing two things
 * that are not moving, so the frame must stay still enough to compare them. */
const LEAN = 2.4;
// Biased toward the far half, but not so far that the claw's spawn sits on the bottom edge —
// which is exactly where the first framing put it.
const LOOK_AT = { x: 0, y: 0.4, z: 0.6 };

export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 42;
  camera.near = 0.1;
  camera.far = 120;
  camera.position.set(0, HEIGHT, BACK);
  camera.lookAt(LOOK_AT.x, LOOK_AT.y, LOOK_AT.z);
  camera.updateProjectionMatrix();
}

/**
 * A fixed three-quarter rig that leans toward the claw and never leaves the room.
 *
 * The lean is clamped and the look-at target is constant. An earlier version scaled both the
 * position and the target by the claw's position; walking to a wall then swung the whole frame
 * outside the room and tipped the floor plane, which looked like a broken scene and was a broken
 * camera. Damping a bounded offset around a fixed target cannot do that.
 */
export function followGripper(camera: PerspectiveCamera, target: Vector3, dt: number): void {
  const blend = Math.min(1, Math.max(0, dt) * 3);
  const wantX = Math.max(-LEAN, Math.min(LEAN, target.x * 0.3));
  const wantZ = BACK + Math.max(-LEAN, Math.min(LEAN, target.z * 0.2));
  camera.position.x += (wantX - camera.position.x) * blend;
  camera.position.z += (wantZ - camera.position.z) * blend;
  camera.position.y = HEIGHT;
  camera.lookAt(LOOK_AT.x, LOOK_AT.y, LOOK_AT.z);
}
