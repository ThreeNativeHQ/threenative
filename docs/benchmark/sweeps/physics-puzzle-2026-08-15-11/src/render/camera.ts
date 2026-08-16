// A fixed three-quarter view of the whole vault, after the reference frame:
// high, angled, and yawed enough to show two walls. Nothing follows the player,
// because the puzzle is only readable when the whole stack is on screen.
//
// The one thing this does track is aspect ratio: a 900x600 window sees a
// narrower slice than 1600x900, so the rig pulls back until the room's width
// fits the frustum instead of cropping the goal off the right edge.
import { PerspectiveCamera, Vector3 } from "three";

const TARGET = new Vector3(-0.3, 0.8, 0.0);
const DIRECTION = new Vector3(0.34, 0.74, 0.86).normalize();
/** Rotates WASD into camera space so "up" is away from the viewer. */
export const CAMERA_YAW = Math.atan2(0.34, 0.86);
/** Distance that fills a 16:9 frame; narrower windows back off just enough. */
const BASE_DISTANCE = 20.5;

export interface IRoomCamera {
  readonly frame: () => void;
}

export function createRoomCamera(camera: PerspectiveCamera): IRoomCamera {
  const frame = (): void => {
    camera.fov = 36;
    camera.near = 0.5;
    camera.far = 200;
    const aspect = Math.max(camera.aspect, 0.6);
    const distance = BASE_DISTANCE * Math.min(1.55, Math.max(1, 1.78 / aspect));
    camera.position.copy(TARGET).addScaledVector(DIRECTION, distance);
    camera.lookAt(TARGET);
    camera.updateProjectionMatrix();
  };
  frame();
  return { frame };
}

export function isPerspective(camera: unknown): camera is PerspectiveCamera {
  return camera instanceof PerspectiveCamera;
}
