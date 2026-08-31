// Everything that decides how the quarry looks, as generated user source. The framework decides
// none of it: no material, light, colour, tonemapping or exposure below this file's line comes
// from a package, and every arm draws through exactly these surfaces so a frame-time comparison
// is a comparison of geometry submission and nothing else.
import {
  type Camera,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  HemisphereLight,
  type PerspectiveCamera,
  type Scene,
} from "three";
import { float, positionWorld } from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";

export interface IQuarryLook {
  readonly boulder: MeshStandardNodeMaterial;
  readonly cliff: MeshStandardNodeMaterial;
  readonly floor: MeshStandardNodeMaterial;
  readonly gantry: MeshStandardNodeMaterial;
  readonly grating: MeshStandardNodeMaterial;
}

const SKY = 0x8fa6bd;

/**
 * One lit look for the whole quarry: a low sun, a cool sky bounce, and four rock surfaces that
 * differ only in tint. Deliberately plain — two shaders would be two experiments.
 */
export function createQuarryLook(scene: Scene, camera: Camera): IQuarryLook {
  scene.background = new Color(SKY);
  scene.fog = new Fog(SKY, 60, 210);

  const sun = new DirectionalLight(0xfff0dd, 1.9);
  // Raking, the way light falls into a pit for most of a day, so relief reads as relief.
  sun.position.set(52, 33, 38);
  scene.add(sun);
  scene.add(new HemisphereLight(SKY, 0x3b3630, 0.75));

  // The framework hands back the base `Camera` type; the quarry authored a perspective one, and
  // the near plane matters here — the route ends 0.4 m from the rock.
  const lens = camera as PerspectiveCamera;
  lens.near = 0.08;
  lens.far = 420;
  lens.updateProjectionMatrix();

  return {
    boulder: rock(0x8d8378, 0.86),
    cliff: rock(0x9a8f80, 0.92),
    floor: rock(0x7d7568, 0.96),
    gantry: steel(),
    grating: cutGrating(),
  };
}

function rock(tint: number, roughness: number): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.color = new Color(tint);
  material.metalness = 0;
  material.roughness = roughness;
  return material;
}

/** The collapsed gantry's beams: thin, opaque, and the case a cluster bound is worst at. */
function steel(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.color = new Color(0x565049);
  material.metalness = 0.65;
  material.roughness = 0.6;
  return material;
}

/**
 * The grating panel: alpha-cut from world position rather than from a texture, so the hazard case
 * is real masked geometry without the quarry carrying a UV set it has no other use for.
 * `alphaTest` keeps it in the opaque pass, which is where a grating belongs.
 */
function cutGrating(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.color = new Color(0x6e6a63);
  material.metalness = 0.7;
  material.roughness = 0.55;
  material.side = DoubleSide;
  material.alphaTest = 0.5;
  const bars = positionWorld.x.mul(9).fract().step(0.42);
  const rungs = positionWorld.y.mul(9).fract().step(0.42);
  material.opacityNode = float(1).sub(bars.mul(rungs));
  return material;
}
