import type { PerspectiveCamera } from "three";

export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 48;
  camera.near = 0.1;
  camera.far = 400;
  // Lower and further back than the old 22/19, so the horizon and the hills behind the sector are
  // in frame. Pitched straight down the terrain filled the picture edge to edge and the board had
  // a ground but still no *place*.
  camera.position.set(0, 14.5, 26);
  camera.lookAt(0, 0, -2.5);
  // `playtests/pointer-placement.playtest.json` clicks a screen fraction and asserts it lands on
  // `build-tile-2-3` (world -9, -3). Those fractions are a projection of *this* camera: move it and
  // they must be recomputed, not nudged by eye.
  camera.updateProjectionMatrix();
}
