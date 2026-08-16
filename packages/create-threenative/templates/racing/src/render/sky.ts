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

export function setupSky(scene: Scene): void {
  const top = new Color(palette.skyHigh);
  const bottom = new Color(palette.skyLow);
  scene.background = top;
  scene.fog = new Fog(bottom, 36, 150);

  // A vertical gradient, not a flat fill. This dome used to be one solid colour, and a blind score
  // of the first frame read it as exactly that: the sky sampled CEE6EA byte-identical at four
  // different heights.
  // Sky is most of the frame, so a flat one costs more than anything else here. Edit or delete
  // this — it is your file.
  const radius = 120;
  const geometry = new SphereGeometry(radius, 24, 12);
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  const color = new Color();
  for (let index = 0; index < positions.count; index += 1) {
    const height = MathUtils.clamp((positions.getY(index) / radius + 0.2) / 0.65, 0, 1);
    color.copy(bottom).lerp(top, height);
    colors.set([color.r, color.g, color.b], index * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));

  const dome = new Mesh(
    geometry,
    // `fog: false` because the dome is the horizon; fogging it collapses the gradient above back
    // into the single wash this replaced.
    new MeshBasicMaterial({ fog: false, side: BackSide, toneMapped: false, vertexColors: true }),
  );
  dome.frustumCulled = false;
  scene.add(dome);
}
