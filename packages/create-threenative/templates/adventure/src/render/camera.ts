// Generated for you. Camera framing is yours to edit.
//
// A third-person orbit camera: low and close behind the hero so the boots, the cap tail and the
// shield fill the lower third and the path runs away over her head — the framing of the reference.
// It never clips: a trunk between the hero and the lens pulls the camera in, and the ground pushes
// it up. Both tests are analytic (circles and the ground function), not raycasts.
import { MathUtils, type PerspectiveCamera, Vector3 } from "three";
import type { ITree } from "../logic/layout.js";
import { groundHeight } from "../logic/terrain.js";

/** What the player steers: mouse, right stick and touch drag write these, `R` resets them. */
export interface IOrbit {
  distance: number;
  pitch: number;
  yaw: number;
}

export const DEFAULT_ORBIT: Readonly<IOrbit> = { distance: 5.3, pitch: 0.19, yaw: 0.035 };
export const ORBIT_LIMITS = { distance: [2.6, 11], pitch: [0.05, 0.85] } as const;
/** How far above the boots the camera looks, in metres: over the hero's head, so the horizon sits mid-frame and the canopy comes into view. */
const FOCUS = 1.95;

export interface ICameraRig {
  /** Moves the camera toward the shot for a hero at (x, y, z). `snap` jumps there. */
  readonly follow: (hero: { x: number; y: number; z: number }, orbit: IOrbit, dt: number, time: number, snap?: boolean) => void;
  /** Kicks the camera; it decays on its own. */
  readonly shake: (amount: number) => void;
}

export function createCameraRig(camera: PerspectiveCamera, trees: readonly ITree[]): ICameraRig {
  const focus = new Vector3();
  const smoothed = new Vector3();
  const offset = new Vector3();
  const desired = new Vector3();
  const sample = new Vector3();
  let shaking = 0;
  camera.fov = 52;
  camera.near = 0.08;
  camera.far = 160;
  camera.updateProjectionMatrix();

  /** How far along the ray from `focus` the first trunk is, or `limit` when it is clear. */
  const trunkDistance = (dir: Vector3, limit: number): number => {
    for (let d = 0.4; d < limit; d += 0.25) {
      const x = focus.x + dir.x * d;
      const y = focus.y + dir.y * d;
      const z = focus.z + dir.z * d;
      for (const tree of trees) {
        if (Math.hypot(x - tree.x, z - tree.z) < tree.r * 0.95 + 0.25 && y < groundHeight(tree.x, tree.z) + tree.h) return Math.max(1.4, d - 0.3);
      }
    }
    return limit;
  };

  return {
    follow: (hero, orbit, dt, time, snap = false) => {
      focus.set(hero.x, hero.y + FOCUS, hero.z);
      smoothed.lerp(focus, snap ? 1 : 1 - Math.exp(-dt * 12));
      const cosPitch = Math.cos(orbit.pitch);
      offset.set(Math.sin(orbit.yaw) * cosPitch, Math.sin(orbit.pitch), Math.cos(orbit.yaw) * cosPitch);
      const reach = trunkDistance(offset, orbit.distance);
      desired.copy(focus).addScaledVector(offset, reach);
      // Keep every point along the boom above the ground.
      for (let i = 1; i <= 8; i += 1) {
        sample.copy(focus).lerp(desired, i / 8);
        const floor = groundHeight(sample.x, sample.z) + 0.25;
        if (sample.y < floor) desired.y += floor - sample.y + 0.1;
      }
      camera.position.lerp(desired, snap ? 1 : 1 - Math.exp(-dt * 8));
      if (shaking > 0) {
        camera.position.x += Math.sin(time * 120) * shaking;
        camera.position.y += Math.cos(time * 100) * shaking * 0.6;
        shaking = Math.max(0, shaking - dt * 0.3);
      }
      camera.lookAt(smoothed);
    },
    shake: (amount) => {
      shaking = MathUtils.clamp(Math.max(shaking, amount), 0, 0.2);
    },
  };
}
