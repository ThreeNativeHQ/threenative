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
  Color,
  DoubleSide,
  FrontSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  type Texture,
  Vector3,
} from "three";
import {
  abs,
  attribute,
  bumpMap,
  cameraPosition,
  color,
  dFdx,
  dFdy,
  dot,
  float,
  length,
  log2,
  max,
  mix,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  smoothstep,
  texture,
  textureSize,
  transformNormalToView,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
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

/**
 * Sun through a needle card, in this game's units.
 *
 * A spruce needle is one cell thick and translucent, and the light that comes *through* it is most
 * of what a canopy is lit by — a backlit spruce is bright at its edges and near-black underneath,
 * which is exactly the failure the judges described. Two terms buy it, and neither needs a second
 * light or a custom BRDF:
 *
 *   - a wrapped diffuse, `N·L` remapped from -1..1 onto 0..1, which lights the faces turned away
 *     from the sun at a fraction of the ones turned towards it. The knob is how much of the wrap;
 *     a needle wraps almost all the way, a leaf halfway.
 *   - a backlight through the card, strongest where the eye is looking along the sun's direction
 *     through the foliage. That is the silver rim on a backlit branch, and it is what separates a
 *     crown from a green cutout.
 *
 * Both read the sun as a *world-space direction towards it*, which is the same vector the sky rig
 * puts on its own uniforms, so the `L` key moves the translucency with everything else.
 */
const CANOPY = {
  /** How far past the terminator a needle is still lit, 0..1. Nearly a leaf, nearly not a card. */
  wrap: 0.55,
  /** The lit-through share, and how tightly it is aimed at the eye. */
  backlight: { strength: 0.5, focus: 5 },
  /** The colour of the light coming through a needle: yellow-green, because that is what a leaf is
   *  transmitting and not because it is a constant anybody chose. */
  tint: 0xa8d05a,
  /** The floor no needle falls below, in linear albedo. Judged at 0.14: dark, never near-black. */
  floor: 0.14,
} as const;

/** The sun as a world-space direction towards it, written by `src/render/sky.ts`. */
const sunDirection = uniform(new Vector3(-180, 240, 120).normalize()) as unknown as Node<"vec3">;

/**
 * Point the shared canopy uniform at the sun. One call, from the rig that owns the sun.
 *
 * A module-level uniform rather than a parameter, because the fog, the cloud deck and the canopy
 * light all need the same sun and passing one through every builder would be three ways to get it
 * subtly out of step.
 */
export function setCanopySun(direction: Vector3): void {
  (sunDirection as unknown as { value: Vector3 }).value.copy(direction).normalize();
}

/**
 * The wrapped two-sided translucency of a needle card, as an emissive node.
 *
 * Emissive rather than a light contribution, and that is not a cheat: a card has no thickness to
 * integrate through, so any "transmission" here is an artistic term, and adding it after the standard
 * shading keeps the standard shading's own shadow, its hemisphere fill and its tone curve intact.
 */
function canopyTranslucency(amount: number, tint: number = CANOPY.tint): Node<"vec3"> {
  // The eye's direction, away from the camera towards the fragment.
  const toEye = cameraPosition.sub(positionWorld).normalize();
  // `normalWorld` on a double-sided card points whichever way the geometry was wound, so a card seen
  // from behind would be lit from its own interior. The wrap is remapped through the sign of the
  // facing, which is the whole of the two-sided half of this effect: the back of a crown catches
  // the light that came through it.
  const facing = normalWorld.dot(sunDirection).abs();
  // Wrapped diffuse: -1..1 becomes 0..1, lifted so a needle facing away is still lit a little.
  const wrapped = facing.add(CANOPY.wrap).div(float(1).add(CANOPY.wrap));
  // Backlight: the sun is behind the card and behind the eye, so light is travelling towards the
  // camera through the needles. Raised to a power because the effect is a rim, not a wash.
  const back = pow(toEye.dot(sunDirection).clamp(0, 1), float(CANOPY.backlight.focus));
  return color(new Color(tint)).mul(
    wrapped.mul(amount).add(back.mul(CANOPY.backlight.strength).mul(amount)),
  );
}

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
/** Its relief: RG a tangent-space normal per needle, B the occlusion the canopy drops on itself. */
const NEEDLE_SURFACE = "needle-surface.png";

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
 * How much of a card one pixel covers, read from the card's own UV derivatives.
 *
 * Two answers, because a card is a rectangle and a pixel is a square, and the two axes of a card seen
 * from a meadow are rarely the same length. `worst` is the deeper of the two levels: that is the
 * right question for a cutoff, because a card compressed along one axis still has to keep its
 * needles. `area` is the geometric mean, which is how many texels the pixel really lands on, and the
 * only honest answer to how far away the tree is — a card seen edge-on covers a sliver of the screen
 * however far away it is, and a sliver does not need to be a solid mass.
 *
 * The atlas is generated at 1024x1024 by `scripts/make-needle-atlas.mjs`, and the chain is read from
 * the texture's own dimensions so a regenerated atlas at another size still measures itself.
 */
function mipLevels(atlas: Texture): { area: Node<"float">; worst: Node<"float"> } {
  const image = atlas.image as { width?: number; height?: number } | undefined;
  const size = vec2(image?.width ?? 1024, image?.height ?? 1024);
  const x = length(dFdx(uv()).mul(size));
  const y = length(dFdy(uv()).mul(size));
  const level = (texels: Node<"float">): Node<"float"> =>
    max(log2(max(texels, float(1))), float(0));
  return { area: level(x.mul(y).sqrt()), worst: level(max(x, y)) };
}

/**
 * The alpha cutoff as a node, falling with the mip level the fragment is really sampling.
 *
 * Ben Golus's compensation: the deeper the mip the smaller the effective cutoff, because a deeper mip
 * is a coarser question about the same texel rather than a stricter one. A needle card forty metres
 * away is sampled from mip three or four, where its alpha has averaged down towards 0.2, and a
 * `discard` at 0.42 throws the needles away and leaves a forest of bare trunks.
 */
function mipCompensatedCutoff(mip: Node<"float">) {
  // Golus's compensation in its cutoff form: divide the cutoff by the mip's alpha scale.
  const scale = float(1).add(mip.mul(MIP_ALPHA_SCALE));
  return float(CUTOUT).div(scale) as unknown as Node<"float">;
}

/**
 * How far a cutout has become a solid mass instead of a spray of separate needles, 0..1.
 *
 * Lowering the cutoff alone is half a fix, and the half that is left produces the failure this exists
 * to remove: a crown that is a lace of surviving specks. A needle card is mostly empty, so its mip
 * average is a low number everywhere, and what clears a threshold there is chosen by noise — which is
 * stipple, not foliage, and it is worst exactly where a tree is smallest on screen.
 *
 * Coverage is not a constant, though. A card sampled from a deep mip *is* a distant tree, and a
 * distant tree is a mass, not a spray of needles: the mip average of a card is the fraction of the
 * card that card covers, and the further off it is the less that fraction matters. So the alpha
 * ramps towards solid as the footprint grows, and the cutoff ramp above keeps the fringe crisp where
 * the fringe is still readable. The two together are the distance LOD in the shader: needles under
 * thirty metres, mass past a hundred and fifty, and a crown that gains density all the way between.
 *
 * The ramp starts where a card's cell is about eight texels across on screen, which is the point
 * where separate needles stop being resolvable and start being texture. Start it earlier and the
 * near trees stop being trees: the cards fill in, and a spruce becomes a stack of solid leaves.
 */
const SOLID = { from: 3, to: 5.5 } as const;

/** The colour a poppy is at the far edge of a meadow, where its petal is a handful of texels. */
const POPPY_RED = 0xe23a2c;

/** What a petal transmits: the sun through one cell of pigment, which is red and not green. */
const PETAL_RED_TINT = 0xd8523a;

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
  const [bark, stone, atlas, relief] = await Promise.all([
    surfaceMaps(assets, MAPS.bark),
    surfaceMaps(assets, MAPS.stone),
    map(assets, NEEDLE_ATLAS, false),
    map(assets, NEEDLE_SURFACE, true),
  ]);
  const textures: Texture[] = [
    bark.diffuse,
    bark.normal,
    bark.roughness,
    stone.diffuse,
    stone.normal,
    atlas,
    relief,
  ].filter((found): found is Texture => found !== undefined);

  const barkMaterial = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.95 });
  if (bark.diffuse === undefined) barkMaterial.colorNode = vec3(0.26, 0.15, 0.11);
  else {
    barkMaterial.map = bark.diffuse;
    // Bark Brown 02 is a dark, damp-looking bark, and a spruce trunk spends most of its visible
    // length inside its own crown's shadow: untinted it renders as a black pole with a silhouette.
    // The lift is warm and well under 2, which keeps the plates legible without turning the trunk
    // into a highlight.
    // A set colorNode replaces `map`, so the lift multiplies the sampled bark instead of standing in for it.
    barkMaterial.colorNode = texture(bark.diffuse).rgb.mul(vec3(1.85, 1.7, 1.55));
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
    const mip = mipLevels(atlas);
    const card = texture(atlas);
    const solid = smoothstep(float(SOLID.from), float(SOLID.to), mip.area);
    crownMaterial.map = atlas;
    crownMaterial.alphaTestNode = mipCompensatedCutoff(mip.worst);
    // The card's own occlusion, from the relief atlas's blue channel: how much sky a texel buried in
    // the spray can see. This is the "near-black undersides" fix as a *texture* rather than as a
    // colour lift — the interior of a spray is darker than its fringe because its neighbours are in
    // the way, which is a fact about the geometry of the needles rather than a constant.
    const occlusion = relief === undefined ? float(1) : texture(relief).b;
    // New growth at the tips is lighter than the shaded interior: the same gradient the grass has,
    // driven by the sway weight, which is a share of the tree's own height. Both ends stay under 1 —
    // a tint above white is not a lighter needle, it is a blown highlight, and a forest of them
    // reads as a field of white cutouts.
    const needle = card.rgb
      .mul(
        mix(
          vec3(0.9, 1.0, 0.86),
          vec3(1.28, 1.34, 1.12),
          smoothstep(float(0.15), float(0.95), attribute<"float">("sway", "float")),
        ),
      )
      .mul(occlusion);
    // The floor. Nothing in a canopy is black: a needle in the shade is lit by the needles around it
    // and by the ground under the tree, so the shaded half of a crown has to keep a floor or it goes
    // to ink against the sky — which is what the last captures showed.
    //
    // It is a *scale* towards the colour's own peak, not a per-channel maximum, and that distinction
    // is the whole of it: a floor applied per channel lifts a dark needle's blue and red along with
    // its green, and the darkest texels come out grey, so the crown washes to pale sage the moment
    // the floor goes up. Scaling until the brightest channel reaches the floor keeps the hue and the
    // saturation, and still only touches the texels that are below it.
    const peak = needle.r.max(needle.g).max(needle.b).max(float(0.0001));
    const lifted = needle.mul(float(CANOPY.floor).div(peak).max(float(1)));
    crownMaterial.colorNode = vec4(lifted, mix(card.a, float(1), solid));
    // The needle relief. `bumpMap` perturbs the surface normal from the height derivatives of the
    // texture, so one generated normal per needle is what gives each card a surface; without it a
    // crown is a stack of flat quads, which is exactly what the last captures showed.
    if (relief !== undefined) crownMaterial.normalNode = bumpMap(texture(relief), float(0.55));
    // And the light coming *through* the card, which the standard shading cannot produce.
    crownMaterial.emissiveNode = canopyTranslucency(0.1);
  }
  // A needle is waxy, not varnished, and at 0.87 the relief's own highlights came back as a silver
  // wash over every card facing the sun. Rougher than the bark below it on purpose.
  crownMaterial.roughness = 0.96;
  sway(crownMaterial, seconds, WIND.amplitude.crown);

  const grassMaterial = new MeshStandardNodeMaterial({
    metalness: 0,
    roughness: 0.93,
    side: DoubleSide,
    vertexColors: true,
  });
  // Sun through a blade. A grass blade is one cell thick and translucent, and the light that comes
  // through the top half of it is most of what a meadow looks lit by — the vertex colour already
  // grades every blade from a dark root to a bright tip, so the tip's share of that light is a
  // channel away, and no second texture is spent on it.
  const blade = attribute<"vec3">("color", "vec3");
  grassMaterial.emissiveNode = canopyTranslucency(0.16).mul(blade.g.mul(2.2).min(float(1)));
  sway(grassMaterial, seconds, WIND.amplitude.grass);

  const stemMaterial = new MeshStandardNodeMaterial({
    metalness: 0,
    roughness: 0.9,
    side: DoubleSide,
    vertexColors: true,
  });
  // A poppy's stem and its leaves are as translucent as its petals, and a patch whose stems are
  // black rods under red flowers reads as wires with beads on them.
  stemMaterial.emissiveNode = canopyTranslucency(0.1);
  sway(stemMaterial, seconds, WIND.amplitude.stem);

  const petalMaterial = new MeshStandardNodeMaterial({
    metalness: 0,
    roughness: 0.74,
    side: DoubleSide,
  });
  petalMaterial.alphaTest = CUTOUT;
  if (atlas === undefined) petalMaterial.colorNode = vec3(0.72, 0.09, 0.08);
  else {
    // A poppy is five centimetres across: at any distance past twenty metres its petal is a handful
    // of texels, and a cutout that keeps only the texels which happen to clear the threshold is a
    // grey smudge where a red one should be. The same coverage ramp the crown uses is what makes a
    // patch of poppies read as red at the far edge of a meadow.
    const mip = mipLevels(atlas);
    const petal = texture(atlas);
    const solid = smoothstep(float(SOLID.from), float(SOLID.to), mip.area);
    petalMaterial.map = atlas;
    petalMaterial.alphaTestNode = mipCompensatedCutoff(mip.worst);
    // The colour goes with the coverage: a petal cell is mostly empty, so its mip average is a dark
    // red, and a patch of poppies that goes solid at sixty metres would go black with it. The
    // sampled colour is faded into the red the game wants at that distance instead.
    petalMaterial.colorNode = vec4(
      mix(petal.rgb, color(POPPY_RED), solid),
      mix(petal.a, float(1), solid),
    );
    // A poppy petal is the most translucent thing in a meadow and the most saturated, and it is the
    // one surface whose colour has to survive the tone curve: lit by the fill alone, a dark red
    // petal takes the sky's blue and a patch of poppies goes violet, which is what the first capture
    // of this lane showed. Light comes *through* a petal, so it is emissive, and by exactly as much
    // as the distance fade asks for.
    // A poppy petal is the most translucent thing in a meadow, so it gets the same two-sided
    // wrap the canopy does — at a higher share, because a petal is one cell of pigment thin — with
    // the distance fade still folded in, so a patch stays red rather than violet at the far edge.
    petalMaterial.emissiveNode = canopyTranslucency(0.22, PETAL_RED_TINT).add(
      color(POPPY_RED).mul(float(0.18).add(solid.mul(0.4))),
    );
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
