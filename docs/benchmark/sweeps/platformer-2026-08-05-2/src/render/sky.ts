import {
  AmbientLight,
  BackSide,
  BufferAttribute,
  Color,
  DirectionalLight,
  Fog,
  Mesh,
  MeshBasicMaterial,
  type Scene,
  SphereGeometry,
} from "three";
import { palette } from "./palette.js";

function skyDome(): Mesh {
  const geometry = new SphereGeometry(180, 24, 12);
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  const high = new Color(palette.skyHigh);
  const low = new Color(palette.skyLow);
  const color = new Color();
  for (let index = 0; index < positions.count; index += 1) {
    const height = Math.max(0, Math.min(1, (positions.getY(index) / 180 + 0.18) / 0.58));
    color.copy(low).lerp(high, height);
    colors.set([color.r, color.g, color.b], index * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({ side: BackSide, toneMapped: false, vertexColors: true }),
  );
  mesh.frustumCulled = false;
  return mesh;
}

export function setupSky(scene: Scene): void {
  scene.background = new Color(palette.skyHigh);
  scene.fog = new Fog(palette.skyLow, 28, 180);
  scene.add(skyDome());
  scene.add(new AmbientLight(0xffffff, 0.35));
  scene.add(new DirectionalLight(0xfff0cf, 3));
  const bounce = new DirectionalLight(0x73c8ff, 0.8);
  bounce.position.set(-4, 5, -6);
  scene.add(bounce);
}
