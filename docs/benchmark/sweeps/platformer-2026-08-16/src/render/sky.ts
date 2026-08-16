// A bright vertical-gradient dome plus fat cumulus clouds. The clouds are
// sphere clusters, not a texture: `CanvasTexture` samples black under
// WebGPURenderer, and a cluster of balls catches the key light so the sky has
// depth instead of being a flat wash behind the level.
import {
  BackSide,
  BufferAttribute,
  Color,
  Fog,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  type Scene,
  SphereGeometry,
} from "three";
import { palette } from "./palette.js";
import { makeRandom } from "./shapes.js";

export function setupSky(scene: Scene, cloudMaterial: MeshStandardMaterial): Group {
  const top = new Color(palette.skyHigh);
  const bottom = new Color(palette.skyLow);
  const radius = 260;
  const geometry = new SphereGeometry(radius, 32, 16);
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  const color = new Color();
  for (let index = 0; index < positions.count; index += 1) {
    // The camera sits near the horizon, so the gradient has to reach full
    // saturation within the first few degrees of sky or the whole frame is the
    // pale horizon band.
    const height = MathUtils.clamp((positions.getY(index) / radius + 0.015) / 0.16, 0, 1);
    // Smoothstep keeps the horizon band wide and the zenith saturated, which is
    // what a clear midday sky actually does.
    const eased = height * height * (3 - 2 * height);
    color.copy(bottom).lerp(top, eased);
    colors.set([color.r, color.g, color.b], index * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  // `fog: false` is load-bearing. The dome sits at radius 260, past the fog's
  // far plane, so with fog enabled the entire sky renders as the flat fog
  // colour and the gradient you carefully authored above never appears.
  const dome = new Mesh(
    geometry,
    new MeshBasicMaterial({
      fog: false,
      side: BackSide,
      toneMapped: false,
      vertexColors: true,
    }),
  );
  dome.name = "sky-dome";
  dome.updateMatrix();
  dome.matrixAutoUpdate = false;
  dome.frustumCulled = false;
  scene.background = new Color(palette.skyHigh);
  // Fog tinted to the horizon band, starting far enough out that the playable
  // route is never hazy — only the distant scenery softens into the sky.
  // Aerial perspective: the distant terrace stack has to wash toward the sky or
  // it crowds the frame as one grey mass. Near is beyond the playable route.
  scene.fog = new Fog(0x9fd3f5, 55, 210);
  scene.add(dome);

  const clouds = new Group();
  clouds.name = "clouds";
  const random = makeRandom(4211);
  for (let index = 0; index < 30; index += 1) {
    const puff = new Group();
    const scale = 5.5 + random() * 6;
    const lobes = 4 + Math.floor(random() * 4);
    for (let lobe = 0; lobe < lobes; lobe += 1) {
      const ballGeometry = new SphereGeometry(scale * (0.5 + random() * 0.5), 12, 8);
      const mesh = new Mesh(ballGeometry, cloudMaterial);
      mesh.position.set(
        (lobe - lobes / 2) * scale * 0.72 + random() * scale * 0.3,
        random() * scale * 0.34,
        random() * scale * 0.5,
      );
      mesh.scale.y = 0.68;
      puff.add(mesh);
    }
    const angle = random() * Math.PI * 2;
    const distance = 70 + random() * 110;
    puff.position.set(
      Math.cos(angle) * distance + 20,
      18 + random() * 40,
      Math.sin(angle) * distance - 30,
    );
    clouds.add(puff);
  }
  scene.add(clouds);
  return clouds;
}
