// Generated for you. This ordinary Three.js sky is yours to rewrite.
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
  const radius = 90;
  // 4 x 3 segments is an eight-triangle blob, and a vertical gradient painted into its vertices
  // interpolates across faces that span sixty degrees of sky: the frame showed a black wedge cut
  // straight across the middle of the arena and green corners, both of which read as broken
  // geometry rather than as a sky. 16 x 8 is 256 triangles and the gradient is smooth.
  const geometry = new SphereGeometry(radius, 16, 8);
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  const high = new Color(palette.skyHigh);
  const low = new Color(palette.skyLow);
  const color = new Color();
  for (let index = 0; index < positions.count; index += 1) {
    const height = MathUtils.clamp((positions.getY(index) / radius + 0.2) / 0.65, 0, 1);
    color.copy(low).lerp(high, height);
    colors.set([color.r, color.g, color.b], index * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  const dome = new Mesh(
    geometry,
    new MeshBasicMaterial({ fog: false, side: BackSide, toneMapped: false, vertexColors: true }),
  );
  dome.frustumCulled = false;
  scene.background = high;
  scene.fog = new Fog(palette.skyLow, 24, 90);
  scene.add(dome);
}
