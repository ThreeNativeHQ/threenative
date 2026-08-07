import { BackSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry } from "three";
import { ball } from "./shapes.js";
import { palette } from "./materials.js";

export function createSky(): Group {
  const group = new Group();
  const dome = new Mesh(new SphereGeometry(90, 24, 16), new MeshBasicMaterial({ color: palette.sky, side: BackSide }));
  group.add(dome);

  const clouds: Array<[number, number, number, number]> = [
    [-15, 14, -18, 2.2], [10, 17, -28, 3], [23, 12, -10, 2.4], [-25, 10, 2, 2.6],
  ];
  for (const [x, y, z, scale] of clouds) {
    const cloud = new Group();
    for (const [dx, dy, size] of [[-0.9, 0, 0.8], [0, 0.3, 1.1], [1, 0, 0.75]] as const) {
      const puff = ball(size * scale, 0xffffff);
      (puff.material as MeshStandardMaterial).roughness = 1;
      puff.position.set(dx * scale, dy * scale, 0);
      cloud.add(puff);
    }
    cloud.position.set(x, y, z);
    group.add(cloud);
  }
  return group;
}
