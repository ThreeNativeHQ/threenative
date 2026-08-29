// Generated for you. Camera framing is game-owned source; edit it to change the feel.
import type { PerspectiveCamera, Vector3 } from "three";
import { Vector3 as Vec3 } from "three";

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

export interface ICameraRig {
  readonly follow: (target: Vector3, dt: number, yaw?: number) => void;
  readonly snap: (target: Vector3, yaw?: number) => void;
}

const UP = new Vec3(0, 1, 0);

// These are game-owned feel decisions. CameraShake only applies the values and never chooses them.
export function createArenaShakeOptions(): ICameraShakeOptions {
  return {
    amplitude: new Vec3(0.08, 0.05, 0.03),
    rotationAmplitude: new Vec3(0.025, 0.04, 0.015),
    frequency: 17,
    decay: 7,
    curve: (phase) => Math.sin(phase) * 0.72 + Math.sin(phase * 0.43) * 0.28,
  };
}

export function createArenaCamera(camera: PerspectiveCamera, shake?: ICameraShakeLike): ICameraRig {
  const offset = new Vec3(0, 5.2, 9.2);
  const lookAhead = new Vec3(0, 0.4, -4.6);
  const desired = new Vec3();
  const aim = new Vec3();
  const rotatedOffset = new Vec3();
  const rotatedLookAhead = new Vec3();

  // `yaw` is the look angle the scene accumulated from relative mouse motion: positive turns
  // the view right. The orbit swings offset and look-ahead around the player by the same angle,
  // so aim direction and camera stay one rig.
  const pose = (target: Vector3, dt: number, yaw = 0): void => {
    rotatedOffset.copy(offset).applyAxisAngle(UP, -yaw);
    rotatedLookAhead.copy(lookAhead).applyAxisAngle(UP, -yaw);
    if (dt === 0) {
      camera.position.copy(target).add(rotatedOffset);
    } else {
      desired.copy(target).add(rotatedOffset);
      camera.position.lerp(desired, 1 - Math.exp(-dt / 0.2));
    }
    camera.lookAt(aim.copy(target).add(rotatedLookAhead));
    const shakeOffset = shake?.update(dt);
    if (shakeOffset === undefined) return;
    camera.position.add(shakeOffset.position);
    camera.rotation.x += shakeOffset.rotation.x;
    camera.rotation.y += shakeOffset.rotation.y;
    camera.rotation.z += shakeOffset.rotation.z;
  };

  return {
    follow: (target, dt, yaw = 0) => pose(target, dt, yaw),
    snap: (target, yaw = 0) => pose(target, 0, yaw),
  };
}
