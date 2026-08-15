// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import {
  BackSide,
  BufferAttribute,
  Color,
  type ColorRepresentation,
  Fog,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type Scene,
  SphereGeometry,
} from "three";
import { palette } from "./palette.js";

type SkyOptions = { readonly bottom: ColorRepresentation; readonly top: ColorRepresentation };

export function setupSky(scene: Scene, options?: SkyOptions): void {
  const resolved = options ?? { bottom: palette.skyLow, top: palette.skyHigh };
  if (resolved.top === undefined || resolved.bottom === undefined)
    throw new TypeError("setupSky requires both top and bottom colors.");

  const top = new Color(resolved.top);
  const bottom = new Color(resolved.bottom);
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
    new MeshBasicMaterial({ side: BackSide, toneMapped: false, vertexColors: true }),
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
