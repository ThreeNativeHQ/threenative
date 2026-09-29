// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// What every surface in the forest is made of. Colour and roughness live here and only here, so
// re-skinning the woods — autumn, snow, a burnt grove — is this file plus `palette.ts`. The wind is
// a node graph on the vertex stage (`three/tsl`), not a shader string, which is the one form that
// compiles for the browser's WebGPU and for the native host alike.
import { AdditiveBlending, DoubleSide, MeshBasicMaterial, type Texture } from "three";
import { cos, float, length, max, mix, oneMinus, positionLocal, positionWorld, sin, smoothstep, uniform, uv, vec3, color } from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { palette } from "./palette.js";
import { barkTexture, blobShadowTexture, bubbleTexture, fernTexture, glowTexture, groundTexture, leafTexture, stoneTexture } from "./textures.js";

/** The forest's clock, in seconds. The scene writes `.value` once a frame; wind and water read it. */
export const clock = uniform(0);

/**
 * Sway on the vertex stage. `amount` is metres at the tip. The bend grows with the mesh's own `uv.y`
 * (0 at the root, 1 at the tip), so a blade is pinned at the ground and a leaf card at its stem, and
 * the phase comes from where the instance stands, so a meadow ripples instead of nodding together.
 * `positionLocal` already carries the instance matrix by the time this node runs.
 */
export function withWind(material: MeshStandardNodeMaterial, amount: number): void {
  const phase = positionLocal.x.mul(0.47).add(positionLocal.z.mul(0.29));
  const tip = uv().y;
  material.positionNode = positionLocal.add(
    vec3(
      sin(clock.mul(1.35).add(phase)).mul(amount).mul(tip.mul(tip)),
      0,
      cos(clock.mul(0.83).add(phase)).mul(amount * 0.5).mul(tip),
    ),
  );
}

function standard(base: number, extras: ConstructorParameters<typeof MeshStandardNodeMaterial>[0] = {}): MeshStandardNodeMaterial {
  return new MeshStandardNodeMaterial({ color: base, roughness: 0.94, ...extras });
}

export interface IForestMaterials {
  readonly bark: MeshStandardNodeMaterial;
  /** A dark soft blob laid under a trunk or a rock. */
  readonly blob: MeshBasicMaterial;
  readonly bubble: Texture;
  readonly black: MeshStandardNodeMaterial;
  readonly brass: MeshStandardNodeMaterial;
  readonly darkStone: MeshStandardNodeMaterial;
  readonly darkWood: MeshStandardNodeMaterial;
  readonly fern: MeshStandardNodeMaterial;
  readonly flower: MeshStandardNodeMaterial;
  readonly glow: MeshStandardNodeMaterial;
  readonly grass: MeshStandardNodeMaterial;
  readonly ground: MeshStandardNodeMaterial;
  readonly leaf: MeshStandardNodeMaterial;
  readonly moss: MeshStandardNodeMaterial;
  readonly mushroom: MeshStandardNodeMaterial;
  readonly pale: MeshStandardNodeMaterial;
  readonly purple: MeshStandardNodeMaterial;
  readonly rope: MeshStandardNodeMaterial;
  readonly soil: MeshStandardNodeMaterial;
  readonly stem: MeshStandardNodeMaterial;
  readonly stone: MeshStandardNodeMaterial;
  readonly water: MeshStandardNodeMaterial;
  readonly wood: MeshStandardNodeMaterial;
  /** The soft white disc every glow sprite shares. */
  readonly glowMap: Texture;
  /** Frees every texture and material. */
  readonly dispose: () => void;
}

export function createForestMaterials(): IForestMaterials {
  const bark = barkTexture();
  const stone = stoneTexture();
  const ground = groundTexture();
  ground.repeat.set(39, 39);
  const leafMap = leafTexture();
  const fernMap = fernTexture();
  const glowMap = glowTexture();
  const blobMap = blobShadowTexture();
  const bubble = bubbleTexture();

  const leaf = standard(0xc6cd9b, {
    alphaTest: 0.48,
    emissive: 0x2c3a17,
    emissiveIntensity: 0.55,
    map: leafMap,
    roughness: 1,
    side: DoubleSide,
  });
  withWind(leaf, 0.13);
  const fern = standard(0xc6d6a7, { alphaTest: 0.43, map: fernMap, side: DoubleSide });
  withWind(fern, 0.075);
  const grass = standard(0xc9d39f, { side: DoubleSide, vertexColors: true });
  withWind(grass, 0.25);

  // Shallow brook: a ripple where two sine trains cross, faded to nothing at the rim so it meets the
  // bank without a visible edge. Lit like everything else, so the sky lies on it.
  const water = new MeshStandardNodeMaterial({ depthWrite: false, metalness: 0.05, roughness: 0.12, transparent: true });
  const wave = sin(positionWorld.x.mul(5.5).add(clock.mul(0.8)).add(sin(positionWorld.z.mul(3)))).add(
    sin(positionWorld.z.mul(8).sub(clock.mul(1.4)).add(cos(positionWorld.x.mul(2.2)))),
  );
  const ripple = max(wave.mul(0.5), float(0)).pow(9);
  water.colorNode = mix(color(0x47716a), color(0x8ec8b4), ripple);
  water.opacityNode = oneMinus(smoothstep(0.36, 0.5, length(uv().sub(0.5)))).mul(0.66);

  const materials: IForestMaterials = {
    bark: standard(0x8e7d5f, { bumpMap: bark, bumpScale: 0.13, map: bark }),
    blob: new MeshBasicMaterial({ depthWrite: false, map: blobMap, opacity: 0.55, transparent: true }),
    bubble,
    black: standard(0x272a1d),
    brass: standard(0xb7a468, { metalness: 0.43, roughness: 0.55 }),
    darkStone: standard(0x858b71, { bumpMap: stone, bumpScale: 0.16, map: stone }),
    darkWood: standard(0x615740, { bumpMap: bark, bumpScale: 0.08, map: bark }),
    fern,
    flower: standard(0xb9a6bc),
    glow: standard(0xffe2a0, { emissive: 0xf2af44, emissiveIntensity: 2.2, roughness: 0.42 }),
    glowMap,
    grass,
    ground: standard(0xffffff, { bumpMap: ground, bumpScale: 0.11, map: ground, vertexColors: true }),
    leaf,
    moss: standard(0x526139, { bumpMap: stone, bumpScale: 0.04, map: stone }),
    mushroom: standard(0x965d40),
    pale: standard(0xbdb08b),
    purple: standard(0x8e6aa3),
    rope: standard(0x827551),
    soil: standard(palette.bark, { bumpMap: ground, bumpScale: 0.1, map: ground }),
    stem: standard(0x53663c),
    stone: standard(0xdad3b6, { bumpMap: stone, bumpScale: 0.1, map: stone }),
    water,
    wood: standard(0xa59570, { bumpMap: bark, bumpScale: 0.07, map: bark }),
    dispose: () => {
      for (const texture of [bark, stone, ground, leafMap, fernMap, glowMap, blobMap, bubble]) texture.dispose();
      for (const value of Object.values(materials)) if ("isMaterial" in value) value.dispose();
    },
  };
  return materials;
}

/** Additive, depth-write-free settings shared by every glow sprite and mote. */
export const ADDITIVE = { blending: AdditiveBlending, depthWrite: false, transparent: true } as const;
