import type { PerspectiveCamera } from "three";

/** Radians above the ground plane, and the yaw the game opens on. Bastion's own diorama angle. */
export const ELEVATION = 0.83;
export const START_YAW = 0.34;
/** Metres from the board's centre at zoom 1. Zoom divides it. */
const DISTANCE = 58;
export const ZOOM_MIN = 0.65;
export const ZOOM_MAX = 1.7;

export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 32;
  camera.near = 1;
  camera.far = 320;
  placeCamera(camera, START_YAW, 1);
}

/**
 * Puts the camera on its orbit: `yaw` around the point it looks at, `zoom` in and out, and that point
 * slid across the ground by (`panX`, `panZ`). It always looks at the board, never away from it.
 */
export function placeCamera(
  camera: PerspectiveCamera,
  yaw: number,
  zoom: number,
  panX = 0,
  panZ = 0,
): void {
  const distance = DISTANCE / zoom;
  const flat = Math.cos(ELEVATION) * distance;
  camera.position.set(
    panX + Math.sin(yaw) * flat,
    Math.sin(ELEVATION) * distance,
    panZ + Math.cos(yaw) * flat,
  );
  camera.lookAt(panX, 0, panZ + 1.2);
  camera.updateProjectionMatrix();
}
