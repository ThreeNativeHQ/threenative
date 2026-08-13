import { BackSide, Color, Fog, Mesh, MeshBasicMaterial, type Scene, SphereGeometry } from "three";
import { palette } from "./palette.js";

export function setupSky(scene: Scene): void {
  scene.background = new Color(palette.skyHigh);
  scene.fog = new Fog(palette.skyHigh, 34, 90);
  const dome = new Mesh(
    new SphereGeometry(80, 24, 12),
    new MeshBasicMaterial({ color: palette.skyLow, side: BackSide, toneMapped: false }),
  );
  dome.frustumCulled = false;
  scene.add(dome);
}
