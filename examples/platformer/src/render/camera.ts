// Yours: ordinary Three.js. ThreeNative does not read this file.
//
// A spring arm, after Godot's SpringArm3D: the camera trails an anchor on a
// damped spring instead of being assigned its position every frame. A plain
// `camera.position.lerp(target, 0.1)` is framerate-dependent and reads as
// rubber-banding; the exponential below is stable at any dt.
//
// Camera framing is one of the loudest things in a screenshot, so it lives here
// in the game rather than behind a framework option. `ctx.camera` stays a plain
// PerspectiveCamera — this rig only writes to it.
import type { PerspectiveCamera, Vector3 } from "three";
import { Vector3 as Vec3 } from "three";

export interface SpringArmOptions {
  /** Where the camera sits relative to its target, before smoothing. */
  readonly offset?: Vector3;
  /** How far ahead of the target the camera looks. Lead the action. */
  readonly lookAhead?: Vector3;
  /** Seconds for the arm to close most of the distance. Higher trails more. */
  readonly damping?: number;
  /** The camera never drops below this, so a fall does not bury it in scenery. */
  readonly minHeight?: number;
}

export interface SpringArm {
  /** Call once per frame from `update(dt)`. */
  readonly follow: (target: Vector3, dt: number) => void;
  /** Jump the camera to its resting pose — use on spawn and respawn. */
  readonly snap: (target: Vector3) => void;
}

export function createSpringArm(
  camera: PerspectiveCamera,
  options: SpringArmOptions = {},
): SpringArm {
  // Behind and to the left, matching the reference frame: the fox runs to the
  // right of screen and slightly away from the lens.
  const offset = options.offset ?? new Vec3(-4.6, 5.6, 12.2);
  const lookAhead = options.lookAhead ?? new Vec3(2.4, 1.0, 0);
  const damping = options.damping ?? 0.22;
  const minHeight = options.minHeight ?? -6;

  const desired = new Vec3();
  const aim = new Vec3();

  const snap = (target: Vector3): void => {
    camera.position.copy(target).add(offset);
    camera.lookAt(aim.copy(target).add(lookAhead));
  };

  const follow = (target: Vector3, dt: number): void => {
    desired.copy(target).add(offset);
    desired.y = Math.max(desired.y, minHeight);
    // 1 - e^(-dt/damping): the frame-rate-independent form of a lerp. At 30fps
    // and 120fps the camera ends up in the same place after the same second.
    camera.position.lerp(desired, 1 - Math.exp(-dt / damping));
    camera.lookAt(aim.copy(target).add(lookAhead));
  };

  return { follow, snap };
}
