import type { PerspectiveCamera, Vector3 } from "three";
import { Vector3 as Vec3 } from "three";

export interface ICameraRig {
  readonly follow: (target: Vector3, dt: number) => void;
  readonly snap: (target: Vector3) => void;
}

export function createDungeonCamera(camera: PerspectiveCamera): ICameraRig {
  const offset = new Vec3(0, 8.4, 8.8);
  const lookAhead = new Vec3(0, 0.2, -1.2);
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
