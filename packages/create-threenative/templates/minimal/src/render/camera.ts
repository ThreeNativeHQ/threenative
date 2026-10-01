// Generated for you. Camera framing is yours to edit.
import { type PerspectiveCamera, Vector3 } from "three";

/** Where the camera sits relative to the player's body centre: up and behind, over the shoulder. */
const OFFSET = new Vector3(0.6, 1.4, 4.6);
/** What it looks at relative to the same centre: just above the head, so the floor fills the frame. */
const AIM = new Vector3(0, 0.7, 0);
const _desired = new Vector3();
const _aim = new Vector3();

export function setupCamera(camera: PerspectiveCamera): void {
  // 60° vertical is Unreal's 90° horizontal at 16:9 — the framing a third-person game is judged by.
  camera.fov = 60;
  camera.near = 0.1;
  camera.far = 20_000;
  camera.position.set(-2 + OFFSET.x, 1 + OFFSET.y, OFFSET.z);
  camera.lookAt(-2, 1 + AIM.y, 0);
  camera.updateProjectionMatrix();
}

/**
 * A spring-arm follow: eases toward the offset behind `target` (framerate-independent) and aims
 * above it. Call it after physics has moved the body, or the camera trails a frame behind.
 */
export function followCamera(camera: PerspectiveCamera, target: Vector3, dt: number): void {
  _desired.copy(target).add(OFFSET);
  camera.position.lerp(_desired, 1 - Math.exp(-dt * 8));
  camera.lookAt(_aim.copy(target).add(AIM));
}
