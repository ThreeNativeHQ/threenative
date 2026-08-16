// Generated for you. The fog colour comes from the same palette as the sky.
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
  const radius = 90;
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
    new MeshBasicMaterial({ fog: false, side: BackSide, toneMapped: false, vertexColors: true }),
  );
  // The dome is authored at the origin and never moves; freeze only this
  // known-static render object, leaving gameplay transforms under user control.
  dome.updateMatrix();
  dome.matrixAutoUpdate = false;
  dome.frustumCulled = false;
  scene.background = top;
  scene.fog = new Fog(bottom, 18, 80);
  scene.add(dome);
}
