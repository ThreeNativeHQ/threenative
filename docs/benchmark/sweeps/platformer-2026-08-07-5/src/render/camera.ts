import { PerspectiveCamera, Vector3 } from "three";

const desired = new Vector3();
const target = new Vector3();

export function updateFollowCamera(camera: PerspectiveCamera, player: Vector3, dt: number): void {
  desired.set(player.x * 0.35, player.y + 6.4, player.z + 9.2);
  const alpha = 1 - Math.exp(-dt * 4.8);
  camera.position.lerp(desired, alpha);
  target.set(player.x * 0.18, player.y + 1.15, player.z - 3.3);
  camera.lookAt(target);
}
