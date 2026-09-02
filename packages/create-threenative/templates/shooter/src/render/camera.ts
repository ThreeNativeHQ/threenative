// Generated for you. Camera framing is game-owned source; edit it to change the feel.
import { type PerspectiveCamera, Vector3 as Vec3, type Vector3 } from "three";

export interface ICameraShakeOffset {
  readonly position: Vector3;
  readonly rotation: Vector3;
}

export interface ICameraShakeLike {
  readonly update: (dt: number) => ICameraShakeOffset;
}

export interface ICameraShakeOptions {
  readonly amplitude: Vector3;
  readonly rotationAmplitude: Vector3;
  readonly frequency: number;
  readonly decay: number;
  readonly curve: (phase: number) => number;
}

/** Anything that can put the camera at its own eye. `Player` is the one that does. */
export interface IEyeSource {
  readonly syncCamera: () => void;
}

export interface ICameraRig {
  /** Place the eye for this frame, then add whatever the shake is currently worth. */
  readonly follow: (eye: IEyeSource, dt: number) => void;
  /** Place the eye with no smoothing and no shake — use on spawn and respawn. */
  readonly snap: (eye: IEyeSource) => void;
}

/**
 * These are game-owned feel decisions. `CameraShake` only applies the values and never chooses
 * them. First-person amplitudes are much smaller than a third-person rig's: the whole frame is
 * the shake, so a centimetre reads as a punch where a third-person camera needs ten.
 */
export function createArenaShakeOptions(): ICameraShakeOptions {
  return {
    amplitude: new Vec3(0.022, 0.016, 0.01),
    rotationAmplitude: new Vec3(0.012, 0.016, 0.02),
    frequency: 21,
    decay: 8.5,
    curve: (phase) => Math.sin(phase) * 0.72 + Math.sin(phase * 0.43) * 0.28,
  };
}

/**
 * Both halves of a shake, in one place.
 *
 * Position and rotation are applied together because applying only the first is the shake bug
 * that reads as the camera sliding rather than being hit.
 */
function composeCameraShake(camera: PerspectiveCamera, offset: ICameraShakeOffset): void {
  camera.position.add(offset.position);
  camera.rotation.set(
    camera.rotation.x + offset.rotation.x,
    camera.rotation.y + offset.rotation.y,
    camera.rotation.z + offset.rotation.z,
    camera.rotation.order,
  );
}

/**
 * The first-person rig.
 *
 * There is no smoothing here on purpose. A third-person camera lerps towards its target because
 * the target is something it is watching; the eye *is* the player, and easing it turns every step
 * into a swim. What does get added is the hit shake, composed on top of the pose the player just
 * wrote, so the shake decays back to exactly where the player is aiming.
 */
export function createFirstPersonRig(
  camera: PerspectiveCamera,
  shake?: ICameraShakeLike,
): ICameraRig {
  const pose = (eye: IEyeSource, dt: number): void => {
    eye.syncCamera();
    // A snap is a respawn, and a respawn should not arrive pre-shaken.
    if (dt === 0) return;
    const shakeOffset = shake?.update(dt);
    if (shakeOffset === undefined) return;
    composeCameraShake(camera, shakeOffset);
  };

  return {
    follow: (eye, dt) => pose(eye, dt),
    snap: (eye) => pose(eye, 0),
  };
}
