import {
  BackSide,
  Color,
  Fog,
  Mesh,
  MeshBasicMaterial,
  type Scene,
  SphereGeometry,
} from "three";
import { palette } from "./palette.js";

export function setupSky(scene: Scene): void {
  const sky = new Color(palette.sky);
  scene.background = sky;
  scene.fog = new Fog(sky, 48, 115);
  const dome = new Mesh(
    new SphereGeometry(130, 24, 12),
    new MeshBasicMaterial({ color: palette.sky, side: BackSide, toneMapped: false }),
  );
  dome.frustumCulled = false;
  scene.add(dome);
}
