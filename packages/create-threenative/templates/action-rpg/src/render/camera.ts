import type { PerspectiveCamera, Vector3 } from "three";
import { Vector3 as Vec3 } from "three";

export interface ICameraRig {
  readonly follow: (target: Vector3, dt: number) => void;
  readonly snap: (target: Vector3) => void;
}

export function createDungeonCamera(camera: PerspectiveCamera): ICameraRig {
  // The rig has to clear the **south wall**, which stands at z = +6 and is now 5.2 m tall with a
  // cap on it. At 6.6/7.4 the eye sat outside that wall and below its top, so the lower half of
  // the frame was the wall's outer face and the room was hidden behind it. From 10.2/9.2 the
  // sightline passes over the cap with room to spare, and the far wall closes the top of the shot
  // instead of the empty sky the old 2.8 m walls left there.
  const offset = new Vec3(0, 10.2, 9.2);
  const lookAhead = new Vec3(0, 0.4, -1.8);
  const desired = new Vec3();
  const aim = new Vec3();
  const pose = (target: Vector3): void => {
    camera.position.copy(target).add(offset);
    camera.lookAt(aim.copy(target).add(lookAhead));
  };
  return {
    follow: (target, dt) => {
      desired.copy(target).add(offset);
      camera.position.lerp(desired, 1 - Math.exp(-dt / 0.2));
      camera.lookAt(aim.copy(target).add(lookAhead));
    },
    snap: pose,
  };
}
