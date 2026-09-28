// Generated for you: this is the starter's game-owned water look.
// The WaveField itself is framework plumbing; the material, the colours and the foam are yours.
import { DoubleSide } from "three";
import { color, float, mix, smoothstep, transformNormalToView } from "three/tsl";
import type { Node } from "three/webgpu";
import { MeshStandardNodeMaterial } from "three/webgpu";

export interface IWaveDisplacementSource {
  displacementNode(): Node;
  heightNode(): Node<"float">;
  normalNode(): Node<"vec3">;
}

/**
 * The sea's own three colours, and deliberately not palette roles: the six in `palette.ts` are
 * the island's, and a watercolour beside a beach is a second opinion about sand. These are albedos,
 * not what the frame shows — a low-roughness surface under a bright sky reflects most of what
 * reaches it, so the body is a saturated sea colour precisely so the near water reads as sea and
 * not as a mirror of a cloud. Measured on a scaffolded starter: at the sky's own pale tones the
 * water came back as a white field.
 */
const DEEP = 0x0f4c5c;
const SHALLOW = 0x2e7f8c;
const FOAM = 0xe6f1f2;

/**
 * The sea, lit by the scene.
 *
 * Standard, not basic, and that is the whole point. A *basic* material takes no lights at all, so
 * the water could not respond to the sun or to the sky the rest of the scene is lit by, and its
 * brightness had to be hand-computed — a `pow(dot(n, sun), 48)` blob standing in for a specular
 * highlight. Water is one of the few surfaces where the specular *is* the material, so that read
 * as plastic. Here the sun is a light and the sky is an environment (`sky.ts`), and this surface
 * is a low-roughness physical one that reflects both.
 */
export function createWaterMaterial(source: IWaveDisplacementSource): MeshStandardNodeMaterial {
  const water = new MeshStandardNodeMaterial({
    metalness: 0,
    // Not a mirror. At 0.02 the sun landed as one blown white disc on the swell in front of the
    // camera; water this side of a dead calm scatters enough to spread it into a glitter path.
    roughness: 0.14,
    side: DoubleSide,
  });
  water.positionNode = source.displacementNode();
  // `transformNormalToView`, not the raw vector. `normalNode` overrides `normalView`, so a
  // material handed a world-space normal lights the surface in the camera's frame instead of the
  // world's: the sun's reflection stopped being a place on the sea and became a column of glare
  // pointing at the camera. The WaveField's `normalNode` is world-space, with up as +Y.
  water.normalNode = transformNormalToView(source.normalNode());

  // Colour by height: deep in the troughs, a lighter body on the shoulders, foam on the crests.
  // The band is narrower than the wave amplitude on purpose, so the tops read as foam-lit rather
  // than as a gentle gradient.
  const height = source.heightNode();
  const troughToCrest = smoothstep(-0.26, 0.26, height);
  const body = mix(color(DEEP), color(SHALLOW), troughToCrest);
  const crest = smoothstep(0.17, 0.27, height);
  water.colorNode = mix(body, color(FOAM), crest);
  // Foam is not a mirror. Roughening the crests is what stops them reading as chrome.
  water.roughnessNode = mix(float(0.14), float(0.7), crest);
  return water;
}
