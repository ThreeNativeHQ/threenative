import { MathUtils, type PerspectiveCamera, Vector3 } from "three";

export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 56;
  camera.near = 0.1;
  camera.far = 180;
  camera.updateProjectionMatrix();
}

export function chaseCamera(
  camera: PerspectiveCamera,
  target: Vector3,
  heading: Vector3,
  dt: number,
): void {
  const behind = heading.clone().setY(0).normalize().multiplyScalar(-8.5);
  const desired = target
    .clone()
    .add(behind)
    .add(new Vector3(0, 5.8, 0));
  if (dt >= 1) camera.position.copy(desired);
  else camera.position.lerp(desired, 1 - Math.exp(-dt / 0.2));
  camera.lookAt(target.x, target.y + 0.65, target.z);
}

export function cameraRoll(camera: PerspectiveCamera, heading: Vector3): void {
  camera.rotation.z = MathUtils.clamp(-heading.x * 0.018, -0.035, 0.035);
}
