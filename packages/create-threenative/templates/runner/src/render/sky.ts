import {
  BackSide,
  BufferAttribute,
  Color,
  Fog,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type Scene,
  SphereGeometry,
} from "three";
import { palette } from "./palette.js";

/**
 * A dusk gradient, and it is doing work.
 *
 * The horizon is the only thing on screen that does not move, so it is what tells the player they
 * are travelling forward rather than the track sliding underneath them. Warm at the bottom, deep
 * at the top, and the fog is tuned to hand the far chunks over to it rather than to a grey wash.
 */
export function setupSky(scene: Scene): void {
  const top = new Color(palette.skyHigh);
  const bottom = new Color(palette.skyLow);
  scene.background = top;
  // Far, on purpose. A near fog plane turned the whole track into the horizon's orange and
  // left nothing on screen that was not sky.
  scene.fog = new Fog(palette.skyHigh, 90, 260);

  const radius = 160;
  const geometry = new SphereGeometry(radius, 24, 12);
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  const color = new Color();
  for (let index = 0; index < positions.count; index += 1) {
    // The warm band is confined to just above the horizon. Spread across the whole dome it
    // filled four-fifths of the frame with one saturated orange.
    const height = MathUtils.clamp((positions.getY(index) / radius + 0.01) / 0.1, 0, 1);
    color.copy(bottom).lerp(top, height);
    colors.set([color.r, color.g, color.b], index * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));

  const dome = new Mesh(
    geometry,
    // `fog: false` because the dome is the horizon; fogging it collapses the gradient above back
    // into one flat wash, and then nothing on screen is stationary.
    new MeshBasicMaterial({ fog: false, side: BackSide, toneMapped: false, vertexColors: true }),
  );
  dome.frustumCulled = false;
  scene.add(dome);
}
