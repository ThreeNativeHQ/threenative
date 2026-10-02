// The prepared props of the Temperate starter, loaded as models: the CC0 rocks and firs that ship
// with the terrain package, and the licensed Fab Scots pine this example prepared for itself.
//
// What this file is: the bridge between a GLB somebody else authored and the starter's prop
// contract. A placement resolves to a variant, a variant resolves to parts, and a part is a
// geometry plus the role that decides its material. This file turns the prepared files into
// exactly that, and nothing else:
//
//   - the tree's trunk and branches are one role (`bark`) with the model's own unwrap, because the
//     game's bark map is sampled in UV and a trunk it cannot sample is a grey pole;
//   - the crown is one role (`pine`) cut against the prepared atlas;
//   - the far band is one role (`impostor`) cut against a card baked from the *uncut* crown, which
//     is the only version of this tree that survives being a few hundred pixels tall;
//   - the rocks carry no UVs at all, because the starter's rock surface is triplanar and a
//     photoscanned unwrap on a boulder is stripes;
//   - every part carries the `sway` attribute the wind reads, as a share of the prop's own height,
//     so the wind in `propMaterials.ts` moves a prepared tree exactly as it moves a procedural one.
//
// A file that is not there is not an error, and that is load-bearing rather than defensive. The
// licensed pine is prepared by `scripts/prep-fab-pines.py` into this example's gitignored
// `local-assets/prepared/`, so the folder does not exist on CI, on a fresh clone, or in a review;
// the starter ships a procedural spruce and a procedural boulder for exactly this reason. A game
// with no prepared art still has a forest. An unregistered asset id still fails by name, in
// `props.ts`, because that is a mistake rather than a missing optional file.
import type { IAssetLoader } from "@threenative/core";
import { BufferAttribute, type BufferGeometry, type Group, type Mesh, type Object3D } from "three";
import type { IPropPart, PropRole } from "./props.js";

/** Where the prepared CC0 art lives, relative to the served starter-asset root. */
const FIR = "fir_tree_01";
const ROCKS = "rocks";

/**
 * Where the prepared pine lives, relative to the served root.
 *
 * A second static root, added by `preparedAssets()` in `vite.config.ts`, because the bytes are
 * licensed and cannot sit in the committed starter-asset folder the CC0 art is served from.
 */
const PINE = "prepared";

/** One prepared file: the path it is served at, the variant it is, and its level. */
interface IPreparedFile {
  readonly asset: string;
  readonly level: number;
  readonly path: string;
  readonly variant: number;
}

/**
 * Whether the prepared fir is scattered, or only prepared.
 *
 * `false`, and the reason is a measurement rather than a preference. `scripts/prep-trees.py`
 * rasterises the front view of what it cut and reports the coverage: fir_tree_01's crown is 437,376
 * needle cards about a centimetre across, the six-thousand-triangle near budget buys four hundred
 * of them, and that is 0.3% of the silhouette — a bare tree with a haze on it. At the mid level's
 * fifteen hundred triangles it is 2.2% even with the cards enlarged twenty-four times, which is
 * still a bare tree at forty metres. So the starter keeps its procedural spruce, the prepared fir
 * ships as prepared art with its credits, and this is the one constant that puts it in the world.
 */
const SCATTER_PREPARED_FIR = false;

/**
 * Whether the licensed Fab pine is scattered on a machine that prepared it.
 *
 * `false` after three judged rounds: cut to the six-thousand-triangle budget, its crown of small
 * sparse leaf cards reads as a bare tree with confetti, a dark inner cone reads as a cone, and the
 * cross-card reads as a striped tower at distance. The preparation and the loader stay, because
 * they are how the next source is measured; this constant is what keeps the meadow on the spruce.
 */
const SCATTER_FAB_PINE = false;

/**
 * The prepared files, in the order they are asked for.
 *
 * Three rocks at both of their levels, the two firs behind the constant above, and the pine at all
 * three of its levels. Every level of one variant is asked for together, because a variant with a
 * near level and no mid level is a variant whose middle distance pops. Three rocks, because a
 * fourth is a tenth draw for a boulder the eye cannot tell from the other three at meadow distance,
 * and the starter's draw budget is a playtest assertion rather than a preference.
 *
 * The pine's three levels are near, mid and the far cross-card, and the bands that pick between
 * them are `LOD_BANDS` in `props.ts`. The pine is the only variant with three, which is why the
 * other two variants are the procedural spruce: a pine at three levels is five draws, a procedural
 * spruce at one is two, and the starter's ceiling is twenty-four prop draws for the whole meadow.
 */
const PREPARED: readonly IPreparedFile[] = [
  { asset: "boulder", level: 0, path: `${ROCKS}/rock01-near.glb`, variant: 0 },
  { asset: "boulder", level: 1, path: `${ROCKS}/rock01-mid.glb`, variant: 0 },
  { asset: "boulder", level: 0, path: `${ROCKS}/rock04-near.glb`, variant: 1 },
  { asset: "boulder", level: 1, path: `${ROCKS}/rock04-mid.glb`, variant: 1 },
  { asset: "boulder", level: 0, path: `${ROCKS}/boulder-near.glb`, variant: 2 },
  { asset: "boulder", level: 1, path: `${ROCKS}/boulder-mid.glb`, variant: 2 },
  // ScotsPineTall_01, prepared by `scripts/prep-fab-pines.py`. The other prepared pine is not
  // scattered, and the measurement is in that script's own summary: ScotsPine_01's crown is 18.3 m
  // across on a 7.5 m spacing, which is a closed canopy rather than a meadow, and scattering it
  // would also cost the five draws the draw ceiling does not have.
  ...(SCATTER_FAB_PINE
    ? [
        { asset: "spruce", level: 0, path: `${PINE}/pine-tall-near.glb`, variant: 0 },
        { asset: "spruce", level: 1, path: `${PINE}/pine-tall-mid.glb`, variant: 0 },
        { asset: "spruce", level: 2, path: `${PINE}/pine-tall-impostor.glb`, variant: 0 },
      ]
    : []),
  ...(SCATTER_PREPARED_FIR
    ? [
        { asset: "spruce", level: 0, path: `${FIR}/fir-b-near.glb`, variant: 1 },
        { asset: "spruce", level: 1, path: `${FIR}/fir-b-mid.glb`, variant: 1 },
        { asset: "spruce", level: 0, path: `${FIR}/fir-c-near.glb`, variant: 2 },
        { asset: "spruce", level: 1, path: `${FIR}/fir-c-mid.glb`, variant: 2 },
      ]
    : []),
];

/**
 * Which role a prepared material name draws with.
 *
 * Three crowns, three atlases, so the names are read apart rather than lumped: Poly Haven's twig
 * atlas is `needles`, the Fab pine's own leaf atlas is `pine`, and the far card is `impostor`. The
 * pine's crown keeps the upstream material name because that atlas *is* that material's, and the
 * upstream word for needles is `Leaves` — matched on both spellings, because `leaf` is not a
 * substring of `leaves` and a crown that misses its role falls through to `stone` and comes out as
 * a pine drawn in mossy rock.
 */
function roleFor(name: string): PropRole {
  const lowered = name.toLowerCase();
  if (lowered.includes("impostor")) return "impostor";
  if (lowered.includes("bark") || lowered.includes("wood")) return "bark";
  if (lowered.includes("twig")) return "needles";
  // Both spellings, and deliberately: `leaf` is not a substring of `leaves`, and a
  // crown that misses its role falls through to `stone` and comes out as a pine
  // drawn in mossy rock. That is not a hypothetical — it is what two runs of this
  // change measured before the condition was spelled out.
  if (
    lowered.includes("leaves") ||
    lowered.includes("leaf") ||
    lowered.includes("needl") ||
    lowered.includes("crown")
  )
    return "pine";
  return "stone";
}

/**
 * Bake one loaded mesh's world transform into a geometry the starter can instance.
 *
 * `InstancedBatch` places a geometry, not an object, so the node transform the file was
 * authored with has to be in the vertices. `clone().applyMatrix4` is the whole of it, and it
 * is also why the origin of every prepared file is its own base: the game's grounding, not
 * the file, decides where it meets the ground.
 */
function flatten(object: Object3D): BufferGeometry | undefined {
  object.updateWorldMatrix(true, true);
  const mesh = object as Mesh;
  const source = mesh.geometry;
  if (!source || source.index === null) return undefined;
  const geometry = source.clone();
  geometry.applyMatrix4(object.matrixWorld);
  return geometry;
}

/**
 * The wind weight, baked per vertex as a share of the prop's own height.
 *
 * The same envelope `spruce.ts` writes by hand, and for the same reason: an instanced tree's
 * vertices are shared by every copy of it, so the weight has to be a share of the variant's
 * own height rather than a world Y, or every tree in the world would bend by the same amount.
 */
function addSway(geometry: BufferGeometry, height: number): void {
  const position = geometry.getAttribute("position");
  const sway = new Float32Array(position.count);
  for (let index = 0; index < position.count; index += 1) {
    const share = Math.min(1, Math.max(0, position.getY(index) / Math.max(height, 1e-6)));
    sway[index] = share * share;
  }
  geometry.setAttribute("sway", new BufferAttribute(sway, 1));
}

/**
 * Both prepared-tree defects, measured on the geometries the starter will actually draw.
 *
 * The flattened mesh is the only place either is visible: `GroundSnap` reads the trunk a
 * level's own geometry puts lowest, and the prep wrote a node translation per level that is
 * exactly as easy to get wrong as a base offset. Neither is a diff you can read.
 */
function measureLevels(parts: ReadonlyMap<string, IPropPart[]>): {
  lodBaseSpread: number;
  levelsWithoutSolid: number;
} {
  let lodBaseSpread = 0;
  let levelsWithoutSolid = 0;
  for (const chosen of parts.values()) {
    const base = new Map<number, number>();
    const solid = new Set<number>();
    for (const part of chosen) {
      const level = part.level ?? 0;
      part.geometry.computeBoundingBox();
      const min = part.geometry.boundingBox?.min.y ?? 0;
      base.set(level, Math.min(base.get(level) ?? Number.POSITIVE_INFINITY, min));
      if (part.role === "bark" || part.role === "stone") solid.add(level);
    }
    // The far card is one quad whose trunk is baked into its own pixels, so a level made only
    // of impostor parts is not a headless tree.
    const cards = new Set(
      chosen.filter((part) => part.role === "impostor").map((part) => part.level ?? 0),
    );
    for (const [level, min] of base) {
      lodBaseSpread = Math.max(lodBaseSpread, min - Math.min(...base.values()));
      if (!solid.has(level) && !cards.has(level)) levelsWithoutSolid += 1;
    }
  }
  return { lodBaseSpread, levelsWithoutSolid };
}

export interface IPreparedProps {
  /** Parts keyed the same way `buildPropVariants` keys them: `asset:variant`. */
  readonly parts: Map<string, IPropPart[]>;
  /**
   * The widest gap, in metres, between any two detail levels' own base Y in one variant.
   *
   * A prop's grounding puts the *lowest point of its trunk* on the terrain and every
   * level is drawn with that one matrix, so a level authored a little off the ground is
   * a tree whose crown floats above it while its neighbours stand correctly — and it is
   * invisible in a diff and obvious in a capture. The gate is five centimetres, which is
   * the width of the shadow a trunk casts at the near band and nothing more.
   */
  readonly lodBaseSpread: number;
  /**
   * How many detail levels carry no solid part at all.
   *
   * A level with only cutout geometry is a crown with nothing holding it up, which is
   * the same failure seen from the other side. The far cross-card is exempt: its trunk
   * is baked into its own card, so there is no second mesh to carry one.
   */
  readonly levelsWithoutSolid: number;
  readonly dispose: () => void;
}

/**
 * Load every prepared file, and hand back the parts that arrived.
 *
 * Loads in parallel and fails soft per file: a missing or broken prepared model leaves that
 * variant to the procedural one, which is the difference between a starter with no forest and
 * a starter whose forest is not the one the owner picked.
 */
export async function loadPreparedProps(assets?: IAssetLoader): Promise<IPreparedProps> {
  const parts = new Map<string, IPropPart[]>();
  const geometries: BufferGeometry[] = [];
  if (assets === undefined)
    return { parts, dispose: () => undefined, lodBaseSpread: 0, levelsWithoutSolid: 0 };

  const loaded = await Promise.all(
    PREPARED.map(async (file) => {
      try {
        return { file, gltf: await assets.model<{ scene?: Group }>(file.path) };
      } catch {
        return { file, gltf: undefined };
      }
    }),
  );

  for (const { file, gltf } of loaded) {
    const root = gltf?.scene;
    if (root === undefined) continue;
    const meshes: Mesh[] = [];
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh) meshes.push(mesh);
    });
    // One height for the whole file, so the trunk and the crown of one tree agree on what a
    // full sway weight is; each level of a variant measures the same way, so a tree does not
    // change its wind envelope when the camera steps it down a level.
    let height = 0;
    for (const mesh of meshes) {
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox;
      if (box) height = Math.max(height, box.max.y - box.min.y);
    }
    const key = `${file.asset}:${file.variant}`;
    const entry = parts.get(key) ?? [];
    for (const mesh of meshes) {
      const material = mesh.material;
      const name = Array.isArray(material)
        ? (material[0]?.name ?? "")
        : ((material?.name ?? "") as string);
      const geometry = flatten(mesh);
      if (geometry === undefined) continue;
      addSway(geometry, height);
      geometries.push(geometry);
      entry.push({ geometry, role: roleFor(name), level: file.level, variant: file.variant });
    }
    if (entry.length > 0) parts.set(key, entry);
    // The loaded scene is only a carrier. Its own geometries are copied by `flatten`, and the
    // loader caches by path and hands the same scene to the next caller, so nothing here may
    // dispose anything the file brought with it.
  }

  const measured = measureLevels(parts);

  return {
    parts,
    lodBaseSpread: measured.lodBaseSpread,
    levelsWithoutSolid: measured.levelsWithoutSolid,
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      geometries.length = 0;
      parts.clear();
    },
  };
}
