import { MathUtils, type PerspectiveCamera, Vector3 } from "three";

// Chase height and distance. At 5.8 up and 8.5 back the camera looked down on the roof, which is
// the one angle from which every car in the world reads as a rectangle; 3.3 and 7.4 put the eye
// near the rear wing where the wedge, the arches and the flank are all in view.
const SCRATCH_UP = new Vector3(0, 3.0, 0);

export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 56;
  camera.near = 0.1;
  camera.far = 340;
  camera.updateProjectionMatrix();
}

// Reused across frames — the starter camera shows the same pattern. This runs per frame for
// every racing game built from this template; three Vector clones a frame was pure garbage.
const behind = new Vector3();
const desired = new Vector3();

export function chaseCamera(
  camera: PerspectiveCamera,
  target: Vector3,
  heading: Vector3,
  dt: number,
): void {
  behind.copy(heading).setY(0).normalize().multiplyScalar(-6.6);
  desired.copy(target).add(behind).add(SCRATCH_UP);
  if (dt >= 1) camera.position.copy(desired);
  else camera.position.lerp(desired, 1 - Math.exp(-dt / 0.2));
  camera.lookAt(target.x, target.y + 1.15, target.z);
}

export function cameraRoll(camera: PerspectiveCamera, heading: Vector3): void {
  camera.rotateZ(MathUtils.clamp(-heading.x * 0.018, -0.035, 0.035));
}
