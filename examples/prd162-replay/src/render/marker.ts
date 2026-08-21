import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";

export function createReplayMarker(): Mesh {
  const marker = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0x75d1c8 }));
  marker.position.z = -2;
  return marker;
}
