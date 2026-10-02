// The licensed Landscape Pro 2.0 vegetation, loaded as models and drawn as props.
//
// The owner bought this pack (Fab listing `1ac647da-b1bc-4e72-a56d-60aaeb6918e1`) and the answer to
// "trees are not ok, leaves look like crap; why insist on procedural trees?" is its own meshes, not
// better procedural ones. `scripts/prep-landscape-pro.mjs` copies the species this world grows out of
// the owner's Fab import into this example's gitignored `local-assets/landscape-pro/`; nothing here
// is committed but the loader, and a machine without that folder loads nothing and draws the
// procedural spruce, boulder, fern, grass and poppy exactly as before.
//
// What this file adds over `prepared.ts` is one decision: a pack section keeps **its own** material.
// The CC0 prepared art is re-dressed in the starter's surfaces — one bark map, one triplanar rock, one
// needle atlas — because that is what makes six species look like one world. A paid pack is already a
// finished art direction with its own atlas per niche, sampled by the pack's own UVs, so re-dressing
// it in the starter's surfaces would throw away the thing that was bought. The rock is the exception,
// and it is the exception Wildwood's `retextureSpecies` documents: its material binds a packed
// height/AO/curvature map as a base colour, which renders every boulder radioactive green, so the
// rocks take the starter's triplanar stone surface and contribute their photoscanned geometry.
//
// Three more things are carried across from Wildwood's `foliage.ts`, which is the reference look:
//
//   - the **gain**: Unreal-authored albedo is dark for the exposure it was shot at, so a section's
//     colour is multiplied by a lift (bark `[3.9, 3.4, 2.7]`, leaf `[3.3, 3.6, 2.8]`). Those are
//     Wildwood's numbers under Wildwood's sky; `src/render/sky.ts` is ours, so they are the first
//     thing a capture argues with.
//   - the **wind**: a vertex-stage bend proportional to height above the instance's own origin, so
//     trunks stay planted and only the crown moves, with a per-instance phase so a stand of pines
//     does not sway as one rigid block. TSL, because this game runs on `WebGPURenderer` where GLSL
//     chunk injection does nothing at all, silently.
//   - the **cutout**: alpha-tested and double-sided, never blended. A blended card sorts against
//     every other card in the crown and the tree turns to soup the moment two branches cross.
import type { IAssetLoader } from "@threenative/core";
import {
  type BufferGeometry,
  DoubleSide,
  type Group,
  type Material,
  type Mesh,
  type Texture,
  Vector3,
} from "three";
import {
  dFdx,
  dFdy,
  float,
  instanceIndex,
  length,
  log2,
  max,
  positionGeometry,
  positionLocal,
  sin,
  texture,
  time,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import type { IPropPart, PropRole } from "./props.js";

/** Where the prepared pack lives, relative to the served root (`local-assets/landscape-pro`). */
const PACK = "landscape-pro";

/** The Fab listing, in the path the asset pipeline's own layout gives it. */
const LISTING = "fab/1ac647da-b1bc-4e72-a56d-60aaeb6918e1/Models";

/**
 * The species this world draws, as the prop asset each one becomes.
 *
 * Nine meshes out of the pack's 52, and the omission is a measurement rather than a preference:
 * `SM_pine02/04/05` are 12–20k triangles each against `SM_pine01`'s 12.5k and `SM_pine03`'s 9.3k,
 * and the meadow is judged at eye height, where a third canopy silhouette buys nothing a second one
 * does not. Sizes are the pack's own, in metres, as they ship — a pine is 9.5–10 m tall and a
 * `SM_pine-small01` is 3.1 m — so `scatter.ts` asks for a spread around one and the authored size is
 * the size. `SM_RockGroup01` is 0.6 m of loose stones, which is scatter rather than scenery.
 *
 * The indices are the prop contract's: `asset:variant`, and the index a placement hashes into has to
 * mean the same thing on a machine with the pack and one without. So indices 0 and 1 of `spruce` are
 * pack pines here and procedural spruces on CI, `boulder:0` is always procedural, and the three
 * undergrowth assets fall back to the starter's own clumps.
 */
const SPECIES: readonly IPackSpecies[] = [
  // The canopy, as two of the pack's five pines and, past the far band, its own young pine at the
  // same two heights. Two species and one distance level rather than three species: the meadow is
  // judged at eye height, where a third silhouette buys nothing a second one does not, and the
  // twenty-four-draw ceiling does not have the two draws a third variant at two levels would cost.
  { metres: 12, on: "height", species: "SM_pine01", to: { asset: "spruce", variant: 0 } },
  {
    level: 1,
    metres: 12,
    on: "height",
    species: "SM_pine-small01",
    to: { asset: "spruce", variant: 0 },
  },
  { metres: 10.5, on: "height", species: "SM_pine03", to: { asset: "spruce", variant: 1 } },
  {
    level: 1,
    metres: 10.5,
    on: "height",
    species: "SM_pine-small01",
    to: { asset: "spruce", variant: 1 },
  },
  // The young generation, and the same mesh a fourth time: a wood's depth comes from one species at
  // three sizes, and this pack has no more species to give.
  { metres: 2.6, on: "height", species: "SM_pine-small01", to: { asset: "sapling", variant: 0 } },
  // The thicket: waist-to-shoulder, which is 1.8x the 1.24 m the pack ships it at.
  { metres: 2.2, on: "height", species: "SM_bush01", to: { asset: "bush", variant: 0 } },
  // Ground cover over the grass, at the metre the pack authored rather than inflated.
  {
    metres: 0.85,
    on: "height",
    species: "SM_grass_bush01_lod00",
    to: { asset: "scrub", variant: 0 },
  },
  // Rocks bring geometry only: their material is the packed data map described above. Normalised on
  // their longest side, because a boulder is read by how far across it is and not by how tall it is —
  // `SM_RockGroup01` is 0.6 m of loose stones and 0.19 m of nothing.
  { metres: 1.7, on: "size", species: "SM_rock01_lod000", to: { asset: "boulder", variant: 1 } },
  { metres: 1.7, on: "size", species: "SM_rock04_lod000", to: { asset: "boulder", variant: 2 } },
  { metres: 0.95, on: "size", species: "SM_RockGroup01", to: { asset: "boulder", variant: 3 } },
];

/** One species of the pack, and the prop variant it becomes at a size this world plants it. */
interface IPackSpecies {
  /**
   * Which detail level this species is, in the sense `props.ts` uses: `0` is the one drawn up close.
   *
   * The canopy's far level is the pack's own young pine at the canopy's own height, which is the whole
   * of the distance LOD and it costs no new art: `SM_pine-small01` is 530 triangles against
   * `SM_pine01`'s 12,535, so a stand of pines past `LOD_BANDS.mid` costs a fortieth of the geometry
   * and, at the sixty metres where the band sits, is a green mass of the same silhouette. The
   * alternative — twelve thousand triangles per tree for a shape a hundred metres away is forty pixels
   * tall — is what the overview framing was spending 4.3 ms on.
   */
  readonly level?: number;
  /** Which prop asset and variant this species fills. */
  readonly to: { readonly asset: string; readonly variant: number };
  /**
   * How `metres` is read off the species: its own height, or its longest side.
   *
   * Trees want height and ground cover wants size, and the difference is not a detail — normalising a
   * tree on its longest side plants a fifteen-metre `SM_green-tree01` (18% wider than it is tall)
   * beside a `SM_pine01` that took the same number as its height.
   */
  readonly on: "height" | "size";
  /** The size it is planted at, in metres. The geometry is scaled to it here, once. */
  readonly metres: number;
  readonly species: string;
}

/** How a niche moves: peak bend as a share of height, its exponent on height, and cycles a second. */
interface IWind {
  readonly speed: number;
  readonly stiffness: number;
  readonly strength: number;
}

/** Trunks and boughs: a slow, stiff sway with all the motion in the crown. */
const TREE_WIND: IWind = { speed: 0.11, stiffness: 1.8, strength: 0.011 };
/** Cut-out foliage: a slow shiver. The old values moved three times too fast for real plants. */
const CANOPY_WIND: IWind = { speed: 0.1, stiffness: 1.6, strength: 0.013 };

/**
 * How far each surface's albedo is lifted, as a per-channel gain.
 *
 * Wildwood's numbers are `[3.9, 3.4, 2.7]` for bark and `[3.3, 3.6, 2.8]` for leaf, and they are the
 * first thing this file got wrong here: under *this* sky — a 3.2-intensity sun, a 1.45 hemisphere and
 * an AgX curve at 2^-0.18 EV — they render a crown at nearly paper white, and a wood of paper-white
 * conifers is worse than the procedural spruce they replaced. What is left is a third of Wildwood's
 * lift: the pack's albedo is genuinely dark for Unreal's exposure and still wants one, but a much
 * smaller one under a rig this much brighter.
 */
const BARK_GAIN = [1.85, 1.6, 1.3] as const;
const LEAF_GAIN = [1.18, 1.32, 0.95] as const;

interface IFoliageMaterial extends MeshStandardNodeMaterial {
  wind?: IWind;
}

/**
 * One vertex graph serves every pack material, and the numbers ride on the material.
 *
 * The three uniforms are written from whichever object is being drawn, so six species with two wind
 * settings cost one graph. `positionGeometry.y` is the section's own height above the instance's
 * origin, which is why a pine a hundred metres away bends exactly as much as one at the player's feet.
 */
const wind = { speed: uniform(0), stiffness: uniform(0), strength: uniform(0) };
wind.speed.onObjectUpdate(({ material }) => {
  wind.speed.value = (material as IFoliageMaterial).wind?.speed ?? 0;
});
wind.stiffness.onObjectUpdate(({ material }) => {
  wind.stiffness.value = (material as IFoliageMaterial).wind?.stiffness ?? 0;
});
wind.strength.onObjectUpdate(({ material }) => {
  wind.strength.value = (material as IFoliageMaterial).wind?.strength ?? 0;
});
const phase = float(instanceIndex).mul(12.9898).sin().mul(43_758.545).fract().mul(6.2831);
const gust = sin(time.mul(wind.speed).add(phase))
  .mul(0.82)
  .add(sin(time.mul(wind.speed.mul(1.73)).add(phase.mul(1.7))).mul(0.18));
const bend = gust.mul(positionGeometry.y.max(float(0)).pow(wind.stiffness)).mul(wind.strength);

/**
 * How deep a mip this fragment is really sampling, 0 at the card's own resolution.
 *
 * Read from the card's own UV derivatives against its own dimensions, which is the geometric mean of
 * the two axes: how many texels this pixel lands on, and therefore how far away the card is.
 */
function mipLevel(map: Texture): Node<"float"> {
  const image = map.image as { width?: number; height?: number } | undefined;
  const size = vec2(image?.width ?? 1024, image?.height ?? 1024);
  const x = length(dFdx(uv()).mul(size));
  const y = length(dFdy(uv()).mul(size));
  return max(log2(max(x.mul(y).sqrt(), float(1))), float(0));
}

/** The pack section this file turns into a prop part. */
interface IPackSection {
  readonly alphaCutoff: number;
  readonly cutout: boolean;
  readonly map: Texture;
  readonly name: string;
  readonly normal: Texture | undefined;
}

/**
 * A section's own material: its own map, lifted for this scene's exposure, wearing its niche's wind.
 *
 * Cut-out sections are double-sided **including `shadowSide`**, because a leaf card seen from beneath
 * is a hole in the crown, and a hole in the crown is a hole in the canopy's shadow.
 */
function sectionMaterial(
  section: IPackSection,
  breeze: IWind,
  gain: readonly [number, number, number],
): MeshStandardNodeMaterial {
  const material: IFoliageMaterial = new MeshStandardNodeMaterial({
    metalness: 0,
    roughness: 0.92,
  });
  const sample = texture(section.map, uv());
  material.colorNode = sample.rgb.mul(vec3(...gain));
  if (section.normal !== undefined) material.normalMap = section.normal;
  section.map.anisotropy = 8;
  if (section.cutout) {
    material.side = DoubleSide;
    material.shadowSide = DoubleSide;
    material.alphaTestNode = float(section.alphaCutoff).div(
      // Ben Golus's mip compensation, and the reason a distant crown is a mass rather than a lace of
      // surviving specks: a leaf card is mostly empty, so its mip average is a low number everywhere,
      // and a fixed discard throws the needles of every tree past thirty metres away away with it.
      // `propMaterials.ts` carries the same correction for the starter's own crowns.
      float(1).add(mipLevel(section.map).mul(0.25)),
    );
    material.opacityNode = sample.a;
  }
  material.wind = breeze;
  const offset = vec3(
    positionLocal.x.add(bend),
    positionLocal.y,
    positionLocal.z.add(bend.mul(0.55)),
  );
  material.positionNode = offset;
  // Without this the crown's shadow stays put while the crown moves, and a windy wood is covered in
  // shadows belonging to trees that are no longer there.
  material.castShadowPositionNode = offset;
  return material;
}

/**
 * Which prop role a section plays, which is what picks its fallback material and its ground contact.
 *
 * Cut-out is the pack's own alpha mode, with the name test Wildwood's loader carries because a
 * section authored opaque can still be a leaf card. Opaque rock becomes `stone`, so grounding and
 * the editor's gizmo treat a boulder as a body rather than as a plant.
 */
function roleFor(section: IPackSection): PropRole {
  if (section.cutout) return "pine";
  return /rock|stone|boulder/i.test(section.name) ? "stone" : "bark";
}

/** A pack material as the GLTFLoader hands it over: the three fields this file reads. */
type IPackMeshMaterial = {
  alphaTest?: number;
  map?: Texture | null;
  name?: string;
  normalMap?: Texture | null;
  transparent?: boolean;
};

/**
 * Scale one section so the world plants it at one size, whatever the pack authored.
 *
 * Landscape Pro ships its meshes at their own authored size — a pine at 10 m is already a tree, a
 * `SM_grass_bush` at a metre is already ground cover — and a few of them (the small pine, the bush)
 * are authored as young plants that this world wants older. Scaling the geometry once at load is
 * cheaper and far clearer than a per-placement divisor: after this, `scatter.ts` asks for a spread
 * around one, and every consumer downstream (grounding, the editor gizmo, the wind's height
 * envelope) reads the size that will actually be drawn.
 */
function resize(geometry: BufferGeometry, metres: number, on: "height" | "size"): void {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box === null) return;
  const size = new Vector3();
  box.getSize(size);
  const current = on === "height" ? size.y : Math.max(size.x, size.y, size.z);
  if (!(current > 1e-6)) return;
  const factor = metres / current;
  // Every pack tree is authored with its root plate about 0.1 m below its own origin, so the base is
  // lifted back onto the ground plane as the geometry is scaled — or the plant floats by the
  // difference and grounding buries it to compensate.
  const shift = box.min.y * factor;
  geometry.scale(factor, factor, factor);
  if (shift > 1e-6) geometry.translate(0, shift, 0);
  geometry.computeBoundingBox();
}

/**
 * The material a section's own alpha mode asks for.
 *
 * `MASK` in the pack is `alphaTest` with a cutoff the pack chose, and `BLEND` never survives a
 * cutout material, so this is the whole decision: above the threshold it is a leaf card, below it is
 * air. The name test catches the sections authored `OPAQUE` that are foliage anyway.
 */
function isCutout(material: IPackMeshMaterial | undefined): boolean {
  return (
    (material?.alphaTest ?? 0) > 0 ||
    material?.transparent === true ||
    /leaf|grass|plant|fern|flower|clover|nettle|bush/i.test(material?.name ?? "")
  );
}

export interface IPackProps {
  /** Parts keyed the way `buildPropVariants` keys them: `asset:variant`. */
  readonly parts: Map<string, IPropPart[]>;
  readonly dispose: () => void;
}

/**
 * Load the pack species that are on this machine, and hand back the parts that arrived.
 *
 * Fails soft per species, exactly like `loadPreparedProps`: a missing folder, a refused model or a
 * broken one leaves that index to the procedural variant, which is the difference between a starter
 * with no forest and a starter whose forest is not the one the owner picked.
 */
export async function loadPack(assets?: IAssetLoader): Promise<IPackProps> {
  const parts = new Map<string, IPropPart[]>();
  const built: { geometry: BufferGeometry; material: Material }[] = [];
  if (assets === undefined) return { dispose: () => undefined, parts };

  const loaded = await Promise.all(
    SPECIES.map(async ({ species }) => {
      // The asset pipeline's own layout, which is what `scripts/prep-landscape-pro.mjs` copies: a
      // cooked model names its textures `../../../shared/images/<hash>`, and reproducing that layout
      // is what lets the file resolve its own images without being repacked.
      for (const path of [`${PACK}/${LISTING}/${species}.glb`, `${PACK}/${species}.glb`]) {
        try {
          return await assets.model<{ scene?: Group }>(path);
        } catch {
          // The next layout, or none: a refused model is a missing optional file, not an error.
        }
      }
      return undefined;
    }),
  );

  loaded.forEach((gltf, index) => {
    const { level = 0, metres, on, species, to } = SPECIES[index] as IPackSpecies;
    const root = gltf?.scene;
    if (root === undefined) return;
    const meshes: Mesh[] = [];
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh) meshes.push(mesh);
    });
    const entry = parts.get(`${to.asset}:${to.variant}`) ?? [];
    for (const mesh of meshes) {
      const loaded0 = mesh.material as IPackMeshMaterial | IPackMeshMaterial[] | undefined;
      if (Array.isArray(loaded0)) continue;
      const map = loaded0?.map;
      if (map === undefined || map === null) continue;
      mesh.updateWorldMatrix(true, false);
      // `InstancedBatch` places a geometry, not an object, so the node transform the file was
      // authored with has to be in the vertices. The clone is the part; the loaded scene is only a
      // carrier and the loader caches it by path, so nothing here disposes what the file brought.
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrixWorld);
      resize(geometry, metres, on);
      const cutout = isCutout(loaded0);
      const section: IPackSection = {
        alphaCutoff: (loaded0?.alphaTest ?? 0) > 0 ? Number(loaded0?.alphaTest) : 0.5,
        cutout,
        map,
        name: loaded0?.name ?? species,
        normal: loaded0?.normalMap ?? undefined,
      };
      // Rock keeps the starter's stone surface: see the header.
      if (roleFor(section) === "stone") {
        entry.push({ geometry, level, role: "stone", variant: to.variant });
        continue;
      }
      const material = sectionMaterial(
        section,
        cutout ? CANOPY_WIND : TREE_WIND,
        cutout ? LEAF_GAIN : BARK_GAIN,
      );
      built.push({ geometry, material });
      entry.push({ geometry, level, material, role: roleFor(section), variant: to.variant });
    }
    if (entry.length > 0) parts.set(`${to.asset}:${to.variant}`, entry);
  });

  return {
    dispose: () => {
      for (const one of built) {
        one.geometry.dispose();
        one.material.dispose();
      }
      built.length = 0;
      parts.clear();
    },
    parts,
  };
}
