// Generated for you. The sky is game-owned source, not an engine preset.
import {
  BackSide,
  BufferAttribute,
  Color,
  Mesh,
  MeshBasicMaterial,
  type Scene,
  SphereGeometry,
} from "three";
import { palette } from "./palette.js";

export function setupSky(scene: Scene): void {
  const geometry = new SphereGeometry(70, 24, 12);
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  const top = new Color(palette.skyHigh);
  const bottom = new Color(palette.skyLow);
  const current = new Color();
  for (let index = 0; index < positions.count; index += 1) {
    current.copy(bottom).lerp(top, Math.max(0, Math.min(1, positions.getY(index) / 70 + 0.42)));
    colors.set([current.r, current.g, current.b], index * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  const dome = new Mesh(
    geometry,
    new MeshBasicMaterial({ fog: false, side: BackSide, toneMapped: false, vertexColors: true }),
  );
  dome.frustumCulled = false;
  scene.background = top;
  scene.add(dome);
}
