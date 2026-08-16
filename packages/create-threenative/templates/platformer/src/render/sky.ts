import {
  BackSide,
  BufferAttribute,
  Color,
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
    new MeshBasicMaterial({ fog: false, side: BackSide, toneMapped: false, vertexColors: true }),
  );
  // The dome is authored at the origin and never moves; freeze only this
  // known-static render object, leaving gameplay transforms under user control.
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  return mesh;
}

export function setupSky(scene: Scene): void {
  scene.background = new Color(palette.skyHigh);
  // Fog starting 28 units out reached the playable middle distance and pulled ground, platforms
  // and props toward the same pale sky colour: a blind score of the first frame measured mean
  // luminance 0.77, the highest of the seven templates, with the palette collapsed to one value
  // band. Start it past where the next jump is and let the horizon fade instead. Tune both numbers
  // to your level — this is your file.
  scene.fog = new Fog(palette.skyLow, 90, 240);
  scene.add(skyDome());
}
