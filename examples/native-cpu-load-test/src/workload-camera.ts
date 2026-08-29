import type { PerspectiveCamera } from "three";

const DEFAULT_CAMERA_Z = 135;
const GRID_DEPTH = 4;
const MAX_OBJECT_SCALE = 1.25;
const OBJECT_BOUNDING_RADIUS = Math.sqrt(3) * 0.4 * MAX_OBJECT_SCALE;
const X_JITTER = 0.15;

export function fitWorkloadCamera(camera: PerspectiveCamera, objectCount: number): void {
  const columns = Math.ceil(Math.sqrt(objectCount));
  const rows = Math.ceil(objectCount / columns);
  const gridHalfWidth = columns - 1 + X_JITTER;
  const gridHalfHeight = rows - 1;
  const halfViewExtent = Math.max(gridHalfHeight, gridHalfWidth / camera.aspect);
  const requiredZ =
    GRID_DEPTH +
    OBJECT_BOUNDING_RADIUS +
    (halfViewExtent + OBJECT_BOUNDING_RADIUS) / Math.tan((camera.fov * Math.PI) / 360);

  camera.position.set(0, 0, Math.max(DEFAULT_CAMERA_Z, requiredZ));
  camera.lookAt(0, 0, 0);
}
