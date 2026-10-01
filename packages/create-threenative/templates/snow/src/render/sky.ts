// Generated for you. The sky is game-owned source, not an engine preset.
import {
  BackSide,
  BufferAttribute,
  Color,
  FogExp2,
  Mesh,
  MeshBasicMaterial,
  type Scene,
  SphereGeometry,
} from "three";
import { palette } from "./palette.js";

const CLEAR_FOG = new Color(palette.skyLow);
const STORM_FOG = new Color(0xafc3d1);

/** A graded dome with a warm sun glow, plus the haze; returns how to darken both for a storm. */
export function setupSky(scene: Scene): (storm: number) => void {
  const RADIUS = 450;
  const geometry = new SphereGeometry(RADIUS, 40, 24);
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  const top = new Color(palette.skyHigh);
  const bottom = new Color(0xd6e2ea);
  const sunGlow = new Color(0xffeedd);
  const sun = { x: -0.6, y: 0.57, z: -0.56 };
  const current = new Color();
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index) / RADIUS;
    const y = Math.max(0, positions.getY(index) / RADIUS);
    const z = positions.getZ(index) / RADIUS;
    current.copy(bottom).lerp(top, y ** 0.58);
    const toward = Math.max(0, x * sun.x + y * sun.y + z * sun.z);
    current.lerp(sunGlow, toward ** 20 * 0.35);
    colors.set([current.r, current.g, current.b], index * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  const material = new MeshBasicMaterial({
    fog: false,
    side: BackSide,
    toneMapped: false,
    vertexColors: true,
  });
  const dome = new Mesh(geometry, material);
  dome.frustumCulled = false;
  dome.renderOrder = -100;
  scene.background = bottom;
  scene.add(dome);
  const fog = new FogExp2(CLEAR_FOG.getHex(), 0.016);
  scene.fog = fog;
  return (storm) => {
    fog.color.copy(CLEAR_FOG).lerp(STORM_FOG, storm);
    fog.density = 0.016 + storm * 0.072;
    material.color.setScalar(1 - storm * 0.3);
  };
}
