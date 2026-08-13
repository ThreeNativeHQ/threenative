import { BackSide, Color, Fog, Mesh, MeshBasicMaterial, type Scene, SphereGeometry } from "three";
import { palette } from "./palette.js";

/**
 * The dungeon has no visible sky. This dome is the dark ambient envelope and fog colour;
 * the interior's key, rim, and fill lights do the actual work on the stone.
 */
export function setupSky(scene: Scene): void {
  const dome = new Mesh(
    new SphereGeometry(80, 8, 4),
    new MeshBasicMaterial({ color: palette.skyLow, side: BackSide, toneMapped: false }),
  );
  dome.frustumCulled = false;
  dome.name = "dungeon-ambient-dome";
  scene.background = new Color(palette.skyLow);
  scene.fog = new Fog(palette.skyLow, 18, 58);
  scene.add(dome);
}
