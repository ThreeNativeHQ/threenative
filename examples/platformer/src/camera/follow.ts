// Generated for you. Ordinary Three.js: the framework never frames a shot.
import type { PerspectiveCamera, Vector3 } from "three";
import { Vector3 as Vec3 } from "three";

/** Behind, above, and biased so the fox sits left of centre facing the level. */
const OFFSET = new Vec3(0.2, 2.65, 7.2);
const LOOK_AHEAD = new Vec3(1.5, 1.15, 0);

export interface FollowCamera {
  snap(target: Vector3): void;
  update(target: Vector3, dt: number): void;
}

export function createFollowCamera(camera: PerspectiveCamera): FollowCamera {
  const desired = new Vec3();
  const aim = new Vec3();
  const place = (target: Vector3, weight: number) => {
    desired.copy(target).add(OFFSET);
    camera.position.lerp(desired, weight);
    camera.lookAt(aim.copy(target).add(LOOK_AHEAD));
  };
  return {
    snap: (target) => place(target, 1),
    // Frame-rate independent damping: the same easing at any step size.
    update: (target, dt) => place(target, 1 - 0.0002 ** dt),
  };
}
