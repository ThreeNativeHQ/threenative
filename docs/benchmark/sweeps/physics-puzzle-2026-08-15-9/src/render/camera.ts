// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// One fixed three-quarter shot of the whole vault. A trailing spring arm is the
// right answer for a runner; for a pushing puzzle it is the wrong one, because
// the thing you are reasoning about is the *relationship* between the character,
// the stack and the pad, and a camera that chases the character hides two of the
// three. Fixed also means a screenshot of frame one is a screenshot of the level.
import { PerspectiveCamera, Vector2, Vector3 } from "three";

export interface IIsometricView {
  /** Ground-plane basis for input, so "right" on the keyboard is right on screen. */
  readonly forward: Vector3;
  readonly right: Vector3;
  /** Turns a +y-is-up action vector into a world direction on the XZ plane. */
  readonly project: (input: Vector2, out: Vector3) => Vector3;
  readonly apply: () => void;
}

const EYE = new Vector3(14.7, 15.3, 14.7);
const TARGET = new Vector3(0, 0.1, 0);

export function createIsometricView(camera: PerspectiveCamera): IIsometricView {
  const forward = new Vector3(TARGET.x - EYE.x, 0, TARGET.z - EYE.z).normalize();
  // right = forward × up, so screen-right and world-right agree at any azimuth.
  const right = new Vector3(-forward.z, 0, forward.x);

  const apply = (): void => {
    camera.position.copy(EYE);
    camera.lookAt(TARGET);
    camera.fov = 38;
    camera.near = 0.5;
    camera.far = 120;
    camera.updateProjectionMatrix();
  };

  const project = (input: Vector2, out: Vector3): Vector3 =>
    out
      .set(0, 0, 0)
      .addScaledVector(right, input.x)
      .addScaledVector(forward, input.y)
      .setY(0);

  return { apply, forward, project, right };
}
