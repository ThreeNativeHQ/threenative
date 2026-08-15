// A fixed three-quarter view of the whole vault, drifting a little toward the
// player so the action never sits in a corner. Long lens: at fov 30 the room
// flattens toward the isometric read of the reference instead of fanning out.
import type { PerspectiveCamera, Vector3 } from "three";
import { MathUtils, Vector3 as Vec3 } from "three";

const EYE = new Vec3(-0.8, 15.4, 17.8);
const FOCUS = new Vec3(0, 0.4, -0.6);

export interface IVaultCamera {
  readonly follow: (target: Vector3, dt: number) => void;
  readonly snap: (target: Vector3) => void;
}

export function createVaultCamera(camera: PerspectiveCamera): IVaultCamera {
  camera.fov = 32;
  camera.near = 0.5;
  camera.far = 200;
  camera.updateProjectionMatrix();

  const eye = new Vec3();
  const aim = new Vec3();

  const place = (target: Vector3, weight: number): void => {
    eye.copy(EYE).addScaledVector(target, weight * 0.1);
    aim.copy(FOCUS).addScaledVector(target, weight * 0.14);
  };

  return {
    snap(target: Vector3): void {
      place(target, 1);
      camera.position.copy(eye);
      camera.lookAt(aim);
    },
    follow(target: Vector3, dt: number): void {
      place(target, 1);
      const rate = 1 - Math.exp(-dt / 0.5);
      camera.position.lerp(eye, rate);
      const x = MathUtils.damp(camera.position.x, eye.x, 2, dt);
      camera.position.x = x;
      camera.lookAt(aim);
    },
  };
}
