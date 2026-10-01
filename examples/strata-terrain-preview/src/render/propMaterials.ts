// The surfaces the starter props draw with, and the wind that moves them.
//
// All of it is appearance and all of it is this game's: which CC0 map goes on the bark, how the
// rock is projected onto three axes, how hard the wind pushes and how fast it cycles. ThreeNative
// supplies the instancing, the lighting and the alpha test's discard; nothing here is a preset the
// engine chose.
//
// Two decisions are worth stating because they are the ones a screenshot proves or refuses:
//
//   1. Foliage is alpha-tested, never blended. A cutout writes depth and casts a real shadow; a
//      blended card sorts against every other card in the crown and the tree turns to soup the
//      moment two branches cross on screen.
//   2. The wind is a vertex-stage displacement weighted by the baked `sway` attribute, so a branch
//      card and the trunk it hangs from move as one and the base of the tree never moves at all.
import type { IAssetLoader } from "@threenative/core";
import {
  DoubleSide,
  FrontSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  type Texture,
} from "three";
import {
  abs,
  attribute,
  dFdx,
  dFdy,
  float,
  length,
  log2,
  max,
  mix,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  smoothstep,
  texture,
  textureSize,
  transformNormalToView,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { MeshStandardNodeMaterial } from "three/webgpu";
import type { IPropMaterials } from "./props.js";

/** How much a mip level shrinks a needle card's alpha; see {@link mipCompensatedCutoff}. */
const MIP_ALPHA_SCALE = 0.25;

/** The wind, in metres and seconds. Its direction is world space. */
export const WIND = {
  direction: [0.82, 0.57] as const,
  /** Peak displacement at a full sway weight, in metres. A boulder does not move. */
  amplitude: { bark: 0.05, crown: 0.34, grass: 0.14, petal: 0.2, stem: 0.16, stone: 0 },
  /** Cycles per second. A tree in a stiff breeze is around one cycle every two seconds. */
  rate: 0.42,
} as const;

/** Alpha cutoff for every cutout surface. Half coverage: a needle card is mostly empty. */
const CUTOUT = 0.42;

/** Which CC0 starter maps each surface binds. This mapping is the game's, not the package's. */
interface ISurfaceMaps {
  readonly diffuse: string;
  readonly normal: string;
  readonly roughness: string;
}

const MAPS: Record<"bark" | "stone", ISurfaceMaps> = {
  bark: {
    diffuse: "bark_brown_02/bark_brown_02_diff_1k.jpg",
    normal: "bark_brown_02/bark_brown_02_nor_gl_1k.jpg",
    roughness: "bark_brown_02/bark_brown_02_rough_1k.jpg",
  },
  stone: {
    diffuse: "mossy_rock/mossy_rock_diff_1k.jpg",
    normal: "mossy_rock/mossy_rock_nor_gl_1k.jpg",
    roughness: "mossy_rock/mossy_rock_rough_1k.jpg",
  },
};

/** Metres one tile of each mapped surface spans. Bark plates are a hand wide; rock is metres. */
const TILE = { bark: 1.6, stone: 2.4 } as const;

/** The generated needle atlas, served beside the starter maps. */
const NEEDLE_ATLAS = "needle-atlas.png";

/** Load one starter map, or nothing. A prop still draws without it, on its own colours. */
async function map(assets: IAssetLoader | undefined, path: string, data: boolean) {
  if (assets === undefined) return undefined;
  const found = await assets.texture(path, { data }).catch(() => undefined);
  if (found === undefined) return undefined;
  // Cutout maps need mips and an anisotropy filter: a needle card sampled without them shimmers at
  // a grazing angle, which is exactly the angle a meadow is viewed from.
  found.minFilter = LinearMipmapLinearFilter;
  found.magFilter = LinearFilter;
  found.anisotropy = 8;
  found.needsUpdate = true;
  return found;
}

async function surfaceMaps(assets: IAssetLoader | undefined, set: ISurfaceMaps) {
  if (assets === undefined) return {};
  const [diffuse, normal, roughness] = await Promise.all([
    map(assets, set.diffuse, false),
    map(assets, set.normal, true),
    map(assets, set.roughness, true),
  ]);
  return { diffuse, normal, roughness };
}

/**
 * The wind's displacement, as a TSL node.
 *
 * The envelope is the baked `sway` weight, so a branch card and the trunk behind it move together
 * and nothing at the base of the tree moves at all. The phase carries a per-position term so a stand
 * of trees does not sway as one rigid block: the phase difference between two trunks twelve metres
 * apart is more than half a cycle at this rate, which is what a real gust does.
 */
function windOffset(clock: Node<"float">, amplitude: number) {
  const weight = attribute<"float">("sway", "float");
  const wave = clock
    .mul(WIND.rate * Math.PI * 2)
    .add(positionWorld.x.mul(0.31))
    .add(positionWorld.z.mul(0.24))
    .sin()
    .mul(amplitude)
    .mul(weight);
  // A second, slower term at a different spatial frequency: one sine is a pendulum, and a forest
  // that only pendulums reads as a row of metronomes.
  const gust = clock
    .mul(WIND.rate * 0.37 * Math.PI * 2)
    .add(positionWorld.x.mul(0.07))
    .add(positionWorld.z.mul(0.11))
    .sin()
    .mul(amplitude * 0.55)
    .mul(weight);
  return vec3(WIND.direction[0], 0, WIND.direction[1]).mul(wave.add(gust));
}

/** Attach the wind to a material's vertex stage, and to its shadow pass so the shadow sways too. */
function sway(base: MeshStandardNodeMaterial, clock: Node<"float">, amplitude: number) {
  const offset = windOffset(clock, amplitude);
  base.positionNode = positionLocal.add(offset);
  // Without this the tree's shadow stays put while the tree moves, and a windy meadow is covered in
  // shadows belonging to trees that are no longer there.
  base.castShadowPositionNode = positionLocal.add(offset);
}

/**
 * Triplanar albedo and relief for the boulders, from one set of mossy-rock maps.
 *
 * Projected on all three axes rather than wrapped in UV, because a boulder is displaced noise with
 * no sensible unwrap: a single planar projection smears the top of a round rock into stripes. Each
 * axis owns a different pair of world axes and the three are recombined by the surface's own blend
 * weights, which is what `src/render/terrain.ts` already does for its cliff layer.
 */
function stoneSurface(maps: { diffuse?: Texture; normal?: Texture }) {
  const material = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.93, side: FrontSide });
  const tile = float(TILE.stone);
  const weight = abs(normalWorld).normalize();
  const up = smoothstep(float(0.3), float(0.8), weight.y);
  if (maps.diffuse === undefined) material.colorNode = vec3(0.42, 0.43, 0.38);
  else {
    // Moss grows on the upward faces and washes off the steep ones, and that difference is also the
    // cue that makes a boulder read as sitting in a meadow rather than resting on one.
    const steep = texture(maps.diffuse, positionWorld.xz.div(tile.mul(0.55)));
    const flat = texture(maps.diffuse, positionWorld.xz.div(tile.mul(1.6)));
    material.colorNode = mix(steep, flat, up);
  }
  if (maps.normal !== undefined) {
    const source = maps.normal;
    const x = texture(source, positionWorld.yz.div(tile)).xy.mul(2).sub(1);
    const y = texture(source, positionWorld.zx.div(tile)).xy.mul(2).sub(1);
    const z = texture(source, positionWorld.xy.div(tile)).xy.mul(2).sub(1);
    const relief = weight.x
      .mul(vec3(0, x.x, x.y))
      .add(weight.y.mul(vec3(y.y, 0, y.x)))
      .add(weight.z.mul(vec3(z.x, z.y, 0)))
      .mul(1.15);
    material.normalNode = transformNormalToView(normalize(normalWorld.add(relief)));
  }
  return material;
}

/**
 * The alpha cutoff as a node, falling with the mip level the fragment is really sampling.
 *
 * Ben Golus's compensation: the deeper the mip the smaller the effective cutoff, because a deeper mip
 * is a coarser question about the same texel rather than a stricter one. A needle card forty metres
 * away is sampled from mip four or five, where its alpha has averaged down towards 0.1, and a
 * `discard` at 0.42 throws the needles away and leaves a forest of bare trunks. The ramp
 * `smoothstep(cutoff, cutoff + fwidth(alpha), alpha)` is the same author's alpha-to-coverage edge,
 * and three resolves that itself once the cutoff is a node.
 */
function mipCompensatedCutoff(atlas: Texture) {
  const image = atlas.image as { width?: number; height?: number } | undefined;
  // The atlas is generated at 1024x1024 by `scripts/make-needle-atlas.mjs`; the mip chain is read
  // from the texture's own dimensions so a regenerated atlas at another size still compensates.
  const size = vec2(image?.width ?? 1024, image?.height ?? 1024);
  const footprint = max(length(dFdx(uv()).mul(size)), length(dFdy(uv()).mul(size)));
  // Golus's compensation in its cutoff form: divide the cutoff by the mip's alpha scale. A card
  // forty metres away is sampled from mip four or five, where its alpha has averaged towards 0.1,
  // and a flat discard at 0.42 would throw the needles away and leave a forest of bare trunks.
  const scale = float(1).add(max(log2(footprint), float(0)).mul(MIP_ALPHA_SCALE));
  return float(CUTOUT).div(scale) as unknown as Node<"float">;
}

/** Every prop surface, plus the one uniform the wind reads. */
export interface IPropSurfaces {
  readonly advance: (elapsed: number) => void;
  readonly dispose: () => void;
  readonly materials: IPropMaterials;
}

/**
 * Build every prop surface, loading the starter maps in the background.
 *
 * A map that never arrives leaves the prop drawn on its own colours rather than missing: the trunk is
 * still a trunk and the needles are still needles, which is the difference between a host with no
 * asset server and a broken scene.
 */
export async function createPropSurfaces(assets?: IAssetLoader): Promise<IPropSurfaces> {
  const seconds = uniform(0) as unknown as Node<"float">;
  const [bark, stone, atlas] = await Promise.all([
    surfaceMaps(assets, MAPS.bark),
    surfaceMaps(assets, MAPS.stone),
    map(assets, NEEDLE_ATLAS, false),
  ]);
  const textures: Texture[] = [
    bark.diffuse,
    bark.normal,
    bark.roughness,
    stone.diffuse,
    stone.normal,
    atlas,
  ].filter((found): found is Texture => found !== undefined);

  const barkMaterial = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.95 });
  if (bark.diffuse === undefined) barkMaterial.colorNode = vec3(0.26, 0.15, 0.11);
  else {
    barkMaterial.map = bark.diffuse;
    // Bark Brown 02 is a dark, damp-looking bark, and a spruce trunk spends most of its visible
    // length inside its own crown's shadow: untinted it renders as a black pole with a silhouette.
    // The lift is warm and well under 2, which keeps the plates legible without turning the trunk
    // into a highlight.
    barkMaterial.colorNode = vec3(1.85, 1.7, 1.55);
  }
  if (bark.normal !== undefined) barkMaterial.normalMap = bark.normal;
  if (bark.roughness !== undefined) barkMaterial.roughnessMap = bark.roughness;
  sway(barkMaterial, seconds, WIND.amplitude.bark);

  const crownMaterial = new MeshStandardNodeMaterial({
    metalness: 0,
    // Double-sided: the far side of a spruce from across a meadow is mostly the backs of its
    // cards, and a single-sided crown shows its own absence there.
    side: DoubleSide,
  });
  crownMaterial.alphaTest = CUTOUT;
  if (atlas === undefined) crownMaterial.colorNode = vec3(0.09, 0.24, 0.11);
  else {
    crownMaterial.map = atlas;
    crownMaterial.alphaTestNode = mipCompensatedCutoff(atlas);
  }
  // New growth at the tips is lighter than the shaded interior: the same gradient the grass has,
  // driven by the sway weight, which is a share of the tree's own height. Both ends stay under 1 —
  // a tint above white is not a lighter needle, it is a blown highlight, and a forest of them reads
  // as a field of white cutouts.
  if (atlas !== undefined)
    crownMaterial.colorNode = mix(
      vec3(0.62, 0.74, 0.58),
      vec3(0.86, 0.94, 0.78),
      smoothstep(float(0.15), float(0.95), attribute<"float">("sway", "float")),
    );
  crownMaterial.roughness = 0.87;
  sway(crownMaterial, seconds, WIND.amplitude.crown);

  const grassMaterial = new MeshStandardNodeMaterial({
    metalness: 0,
    roughness: 0.93,
    side: DoubleSide,
    vertexColors: true,
  });
  sway(grassMaterial, seconds, WIND.amplitude.grass);

  const stemMaterial = new MeshStandardNodeMaterial({
    metalness: 0,
    roughness: 0.9,
    side: DoubleSide,
    vertexColors: true,
  });
  sway(stemMaterial, seconds, WIND.amplitude.stem);

  const petalMaterial = new MeshStandardNodeMaterial({
    metalness: 0,
    roughness: 0.74,
    side: DoubleSide,
  });
  petalMaterial.alphaTest = CUTOUT;
  if (atlas === undefined) petalMaterial.colorNode = vec3(0.72, 0.09, 0.08);
  else {
    petalMaterial.map = atlas;
    petalMaterial.alphaTestNode = mipCompensatedCutoff(atlas);
  }
  sway(petalMaterial, seconds, WIND.amplitude.petal);

  const materials: IPropMaterials = {
    bark: barkMaterial,
    crown: crownMaterial,
    grass: grassMaterial,
    petal: petalMaterial,
    stem: stemMaterial,
    stone: stoneSurface(stone),
  };
  let disposed = false;
  return {
    advance: (elapsed: number) => {
      (seconds as unknown as { value: number }).value = elapsed;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const material of Object.values(materials) as Material[]) material.dispose();
      for (const texture of textures) texture.dispose();
    },
    materials,
  };
}
