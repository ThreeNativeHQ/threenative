import { PerspectiveCamera, Vector3 } from "three";

const desired = new Vector3();
const target = new Vector3();

export function updateFollowCamera(camera: PerspectiveCamera, player: Vector3): void {
  desired.set(player.x, player.y + 6.4, player.z + 9.2);
  camera.position.copy(desired);
  target.set(player.x, player.y + 1.15, player.z - 3.3);
  camera.lookAt(target);
}
