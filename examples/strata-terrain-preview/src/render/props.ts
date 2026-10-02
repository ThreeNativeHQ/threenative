// The starter props of the Temperate world: three seeded spruce variants, three boulders, grass
// clumps and poppy patches, each instanced through the engine's existing `InstancedBatch`.
//
// What lives here and what does not:
//
//   - The shapes, their variants, their materials and their placement rule are all this file's. They
//     are the picture, and the picture is the game's (AGENTS rule 3).
//   - Instancing, transform composition and ground contact are not. `InstancedBatch` collapses the
//     draws and `GroundSnap` grounds the model, and both are engine mechanisms this file calls.
//
// Every prop keeps the same contract the editor has always relied on: a placement resolves to a
// prepared matrix, that matrix is written into the instanced mesh by index, and the editor can read
// it back and overwrite it. Adding a variant changes the shape, never that contract.
import { GroundSnap, InstancedBatch, createRandom } from "@threenative/core";
import type { IPlacement, IPlacementOverride } from "@threenative/terrain";
import {
  type BufferGeometry,
  DoubleSide,
  Euler,
  Group,
  type InstancedMesh,
  type Material,
  type Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import { boulder, fernClump, grassClump, poppyCluster } from "./cover.js";
import { ATLAS_CELLS, spruceVariants } from "./spruce.js";

/** Which cell of the needle atlas the poppy petals sample. */
const POPPY_PETAL = { u0: 0.5, v0: 0, u1: 1, v1: 0.5 };

/** How many variants of each prop the starter builds, and the seed they are built from. */
export const VARIANTS = {
  boulder: 3,
  bush: 1,
  fern: 2,
  grass: 4,
  poppy: 4,
  sapling: 3,
  scrub: 3,
  spruce: 5,
  seed: 0x9e3779b9,
} as const;

/**
 * Metres at which a prepared prop steps down one detail level.
 *
 * `near` is 60, not the 22 the prepared pine was cut against: the only banded variants in the world
 * are the pack canopy's, and a twelve-metre pine at sixty metres is about eighty pixels tall in a
 * 1080-line frame — the same picture as its far level — while at twenty-two metres it is seven hundred
 * pixels tall and the swap is not a distance LOD at all, it is a visible substitution.
 */

/**
 * The assets whose draws skip the shadow pass.
 *
 * Seedlings and shrubs, and the reason is the cost rather than the look: a pine's shadow is a shape
 * on the meadow, and the shadow of a knee-high plant under a pine is already inside it. Wildwood's
 * `LAYERS` marks the same three layers `castShadows: false`, and its numbers agree.
 */
const DRAW_REACH: Record<string, number> = {
  grass: 112,
  scrub: 110,
  fern: 105,
  poppy: 65,
  sapling: 160,
  bush: 120,
  boulder: 170,
  riverrock: 100,
  scree: 190,
  cliff: 300,
  mountain: 650,
  volcanic: 400,
  reveal: 260,
};
const NO_SHADOW_ASSETS = new Set(["sapling", "scrub", "grass", "fern", "poppy"]);

/** One drawable piece of a prop: its geometry, and the role that decides its material. */
/** The share of a boulder's height that sits below the ground. */
const BOULDER_BURIAL = 0.32;

export type PropRole =
  | "bark"
  | "crown"
  | "fern"
  | "grass"
  | "impostor"
  | "needles"
  | "petal"
  | "pine"
  | "stem"
  | "stone";

/**
 * Metres at which a prepared prop steps down one detail level, and the slack that keeps a
 * camera walking the boundary from stepping it up and down again.
 *
 * The bands are the game's, because the triangle budget behind them is the game's: a prop is drawn
 * from its full prepared detail inside `near`, from the mid level past it, and from the far
 * cross-card past that. The hysteresis is a fifth of the band rather than a fixed number of
 * metres, so the same slack works for a two-metre rock, a fourteen-metre spruce and a
 * twenty-two-metre pine.
 */
export const LOD_BANDS = { far: 150, hysteresis: 0.2, mid: 60, near: 22 } as const;

export interface IPropPart {
  readonly geometry: BufferGeometry;
  /**
   * The surface this part draws with, when it is not one of the starter's.
   *
   * The CC0 prepared art and every procedural prop are re-dressed in the starter's own surfaces, so
   * a role decides them. A licensed pack species brings its own atlas and its own UVs and is not
   * re-dressed (`src/render/pack.ts`), so it carries the material it was authored with, and this
   * field is how the batch knows to leave that draw alone when the lit surfaces arrive.
   */
  readonly material?: Material;
  /** Which detail level this part is. `0` is the full one; a variant with only it never steps. */
  readonly level?: number;
  readonly role: PropRole;
  /** Which variant of the prop this part belongs to; parts of one variant always agree. */
  readonly variant: number;
}

/**
 * Build every variant of every prop, once, as flat parts.
 *
 * Building the whole set up front is what makes placement cheap and what keeps the draw count
 * bounded: three spruce variants times two parts is six draws for every tree in the world, not one
 * per tree. The caller decides which variant each placement gets.
 *
 * A `prepared` map replaces the variants it names: indices 0 and 1 of the spruce are the two
 * prepared CC0 firs and index 2 is the procedural one, so both sets are live at once and the
 * procedural tree stays a variant rather than becoming dead code. The indices it does not name
 * are still built, which is what the editor's own scene gets when it has no prepared art.
 */
export function buildPropVariants(
  prepared?: ReadonlyMap<string, IPropPart[]>,
  fallbackSaplingHeight?: number,
): Map<string, IPropPart[]> {
  if (
    fallbackSaplingHeight !== undefined &&
    (!Number.isFinite(fallbackSaplingHeight) || fallbackSaplingHeight <= 0)
  )
    throw new Error("Fallback sapling height must be positive and finite");
  const variants = new Map<string, IPropPart[]>();
  // Every index the layout knows about, so a prepared variant replaces the procedural one at the
  // same index rather than being appended: the placement hash is what picks a variant, and it
  // picks an index, so index 0 has to mean the pine on the machine that has the pine and the
  // procedural spruce on the machine that does not. The saplings' own variants come off the end of
  // the same seeded set, so a seedling and a tree are the same species at two sizes rather than two
  // unrelated shapes.
  const spruces = spruceVariants(PROP_COUNTS.spruce, VARIANTS.seed);
  const youngs = spruceVariants(PROP_COUNTS.sapling, VARIANTS.seed ^ 0x51ed3a7f);
  for (let index = 0; index < PROP_COUNTS.spruce; index += 1) {
    const ready = prepared?.get(`spruce:${index}`);
    if (ready) {
      variants.set(`spruce:${index}`, [...ready]);
      continue;
    }
    const spruce = spruces[index];
    if (spruce === undefined) continue;
    variants.set(`spruce:${index}`, [
      { geometry: spruce.trunk, role: "bark", variant: index },
      // Each variant leans on a different needle card, so three spruce silhouettes are three
      // textures rather than one texture at three sizes.
      { geometry: spruce.crown, role: "crown", variant: index },
    ]);
  }
  for (let i = 0; i < PROP_COUNTS.boulder; i += 1) {
    const ready = prepared?.get(`boulder:${i}`);
    if (ready) {
      variants.set(`boulder:${i}`, [...ready]);
      continue;
    }
    variants.set(`boulder:${i}`, [
      {
        geometry: boulder((VARIANTS.seed ^ (i * 0x85ebca6b)) >>> 0),
        role: "stone",
        variant: i,
      },
    ]);
  }
  for (let i = 0; i < VARIANTS.fern; i += 1)
    variants.set(
      `fern:${i}`,
      prepared?.get(`fern:${i}`) ?? [
        { geometry: fernClump((VARIANTS.seed ^ (i * 0x165667b1)) >>> 0), role: "fern", variant: i },
      ],
    );
  // The young generation and the two undergrowth niches, all three with the starter's own geometry
  // standing in: a machine with no licensed pack grows a small spruce, a fern-sized shrub and a
  // grass clump. That is a thinner wood, and it is never a broken one — which is the whole point of
  // the licensed art being optional rather than required.
  for (let i = 0; i < PROP_COUNTS.sapling; i += 1) {
    const ready = prepared?.get(`sapling:${i}`);
    if (ready) {
      variants.set(`sapling:${i}`, [...ready]);
      continue;
    }
    const young = youngs[i];
    if (young === undefined) continue;
    if (fallbackSaplingHeight !== undefined) {
      young.trunk.computeBoundingBox();
      young.crown.computeBoundingBox();
      const height = Math.max(
        young.trunk.boundingBox?.max.y ?? 0,
        young.crown.boundingBox?.max.y ?? 0,
      );
      if (!(height > 0)) throw new Error("Procedural sapling has no measurable height");
      const scale = fallbackSaplingHeight / height;
      young.trunk.scale(scale, scale, scale);
      young.crown.scale(scale, scale, scale);
    }
    variants.set(`sapling:${i}`, [
      { geometry: young.trunk, role: "bark", variant: i },
      { geometry: young.crown, role: "crown", variant: i },
    ]);
  }
  for (let i = 0; i < PROP_COUNTS.bush; i += 1) {
    const ready = prepared?.get(`bush:${i}`);
    if (ready) {
      variants.set(`bush:${i}`, [...ready]);
      continue;
    }
    variants.set(`bush:${i}`, [
      { geometry: fernClump((VARIANTS.seed ^ (i * 0x27d4eb2f)) >>> 0), role: "fern", variant: i },
    ]);
  }
  for (let i = 0; i < PROP_COUNTS.scrub; i += 1) {
    const ready = prepared?.get(`scrub:${i}`);
    if (ready) {
      variants.set(`scrub:${i}`, [...ready]);
      continue;
    }
    variants.set(`scrub:${i}`, [
      { geometry: grassClump((VARIANTS.seed ^ (i * 0x165667b1)) >>> 0), role: "grass", variant: i },
    ]);
  }
  for (let i = 0; i < VARIANTS.grass; i += 1) {
    const ready = prepared?.get(`grass:${i}`);
    const basal = grassClump((VARIANTS.seed ^ (i * 0xc2b2ae35)) >>> 0);
    // The photographed meadow atlas is seed stalks; a low blade layer closes the basal gaps.
    if (ready) {
      basal.scale(0.8, 0.32, 0.8);
      const colours = basal.getAttribute("color");
      for (let c = 0; c < colours.count; c++)
        colours.setXYZ(c, colours.getX(c) * 0.45, colours.getY(c) * 0.6, colours.getZ(c) * 0.35);
    }
    variants.set(`grass:${i}`, [...(ready ?? []), { geometry: basal, role: "grass", variant: i }]);
  }
  for (let i = 0; i < VARIANTS.poppy; i += 1) {
    const ready = prepared?.get(`poppy:${i}`);
    if (ready) {
      variants.set(`poppy:${i}`, [...ready]);
      continue;
    }
    const cluster = poppyCluster((VARIANTS.seed ^ (i * 0x27d4eb2f)) >>> 0, POPPY_PETAL);
    variants.set(`poppy:${i}`, [
      { geometry: cluster.stems, role: "stem", variant: i },
      { geometry: cluster.petals, role: "petal", variant: i },
    ]);
  }
  for (const asset of ["riverrock", "scree", "cliff", "mountain", "volcanic", "reveal"])
    for (
      let variant = 0;
      variant < (asset === "mountain" || asset === "reveal" ? 2 : asset === "volcanic" ? 4 : 1);
      variant++
    ) {
      const ready = prepared?.get(`${asset}:${variant}`);
      if (ready) {
        variants.set(`${asset}:${variant}`, ready);
        continue;
      }
      const fallback = boulder(VARIANTS.seed ^ variant);
      if (["mountain", "volcanic", "reveal"].includes(asset)) {
        if (asset === "mountain") fallback.scale(0.65, 1.45, 1.8);
        fallback.computeBoundingBox();
        const size = fallback.boundingBox?.getSize(new Vector3());
        const scale =
          (asset === "mountain" ? 24 : asset === "volcanic" ? 10 : 5) /
          Math.max(size?.x ?? 1, size?.y ?? 1, size?.z ?? 1);
        fallback.scale(scale, scale, scale);
      }
      variants.set(`${asset}:${variant}`, [{ geometry: fallback, role: "stone", variant }]);
    }
  return variants;
}

/**
 * The prop names this starter knows, and how many variants each has.
 *
 * A prepared variant is counted whether or not its model loaded: the count is the starter's
 * layout, and a game with no prepared art still hashes into the same five boulders.
 */
const PROP_COUNTS = {
  ...VARIANTS,
  riverrock: 1,
  scree: 1,
  cliff: 1,
  mountain: 2,
  volcanic: 4,
  reveal: 2,
};

export const PROP_ASSETS: Record<string, number> = Object.fromEntries(
  Object.entries(PROP_COUNTS).filter(([name]) => name !== "seed"),
);

export type PropGroundQuery = (
  placement: IPlacement,
  position: [number, number, number],
) => { height: number | null; offset: number };
export interface IPropInstance {
  mesh: InstancedMesh;
  index: number;
  placement: IPlacement;
  pose: Matrix4;
  geometry: BufferGeometry;
  grounding: boolean;
  clearance: number | null;
  cragBaseClearance?: number;
  cragRingSamples?: number;
  /** Every draw of this placement, so a transform write reaches all of them. */
  parts: { mesh: InstancedMesh; index: number }[];
}
function preparePose(
  geometry: BufferGeometry,
  material: Material,
  placement: IPlacement,
  transform: IPlacementOverride | undefined,
  groundAt: PropGroundQuery,
) {
  // This measurement mesh is never added to the scene; the actual draw stays instanced.
  const model = new Mesh(geometry, material);
  model.position.fromArray(transform?.position ?? placement.position);
  if (transform) {
    model.quaternion.fromArray(transform.quaternion);
    model.scale.fromArray(transform.scale);
  } else {
    const up = new Vector3(0, 1, 0);
    if (placement.alignToNormal)
      model.quaternion.setFromUnitVectors(up, new Vector3().fromArray(placement.normal));
    model.quaternion.multiply(new Quaternion().setFromAxisAngle(up, placement.rotation));
    model.scale.setScalar(placement.scale);
  }
  const grounding = transform?.grounding ?? true;
  const ground = groundAt(placement, model.position.toArray());
  const snap = new GroundSnap(model, { enabled: grounding });
  if (ground.height === null) {
    if (grounding)
      throw new Error(
        `Missing terrain ground for '${placement.id}' at ${JSON.stringify(model.position.toArray())}`,
      );
  } else {
    snap.apply(model, ground.height, 0);
    if (grounding && ground.offset !== 0) {
      model.position.y += ground.offset;
      snap.enabled = false;
      snap.apply(model, ground.height, 0);
    }
  }
  // A boulder is a rock that is part buried: GroundSnap puts its lowest point on the surface, and on a
  // slope the downhill side then hangs in the air. Sinking it by a share of its own height closes that.
  if (
    grounding &&
    !transform &&
    ["boulder", "riverrock", "scree", "cliff", "mountain", "volcanic", "reveal"].includes(
      placement.asset,
    ) &&
    ground.height !== null
  ) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box) {
      model.updateMatrix();
      const crag = ["mountain", "volcanic", "reveal"].includes(placement.asset);
      const height = crag
        ? box.clone().applyMatrix4(model.matrix).getSize(new Vector3()).y
        : (box.max.y - box.min.y) * model.scale.y;
      model.position.y -=
        (placement.asset === "mountain" ? 0.7 : crag ? 0.55 : BOULDER_BURIAL) * height;
    }
  }
  let cragBaseClearance: number | undefined;
  let cragRingSamples: number | undefined;
  if (grounding && !transform && placement.asset === "mountain") {
    // Probe the outermost vertices of the lowest ring, not a bounding-box centre.
    const box = geometry.boundingBox;
    if (!box) throw new Error(`Crag '${placement.id}' has no bounds`);
    const vertices = geometry.getAttribute("position");
    const ring: (Vector3 | undefined)[] = Array.from({ length: 16 });
    const centre = box.getCenter(new Vector3());
    for (let i = 0; i < vertices.count; i++) {
      const point = new Vector3().fromBufferAttribute(vertices, i);
      if (point.y > box.min.y + (box.max.y - box.min.y) * 0.18) continue;
      const angle = Math.atan2(point.z - centre.z, point.x - centre.x);
      const bin = Math.min(15, Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 16));
      const held = ring[bin];
      if (
        !held ||
        Math.hypot(point.x - centre.x, point.z - centre.z) >
          Math.hypot(held.x - centre.x, held.z - centre.z)
      )
        ring[bin] = point;
    }
    model.updateMatrix();
    let highestGap = Number.NEGATIVE_INFINITY;
    cragRingSamples = 0;
    for (const vertex of ring) {
      if (!vertex) continue;
      const point = vertex.applyMatrix4(model.matrix);
      const contact = groundAt(placement, point.toArray()).height;
      if (contact === null) throw new Error(`Missing ground under crag ring '${placement.id}'`);
      highestGap = Math.max(highestGap, point.y - contact);
      cragRingSamples++;
    }
    if (cragRingSamples < 4) throw new Error(`Incomplete base ring for crag '${placement.id}'`);
    const sink = Math.max(0, highestGap + 0.5);
    model.position.y -= sink;
    cragBaseClearance = highestGap - sink;
  }
  model.updateMatrix();
  if (!new Float32Array(model.matrix.elements).every(Number.isFinite))
    throw new Error(`Transform exceeds the renderer range for '${placement.id}'`);
  return {
    matrix: model.matrix.clone(),
    grounding,
    clearance: snap.clearance,
    cragBaseClearance,
    cragRingSamples,
  };
}
export function preparePropTransform(
  instance: IPropInstance,
  transform: IPlacementOverride | undefined,
  groundAt: PropGroundQuery,
) {
  const { material } = instance.mesh;
  if (Array.isArray(material))
    throw new Error(`Prop '${instance.placement.id}' has a multi-material draw`);
  return preparePose(instance.geometry, material, instance.placement, transform, groundAt);
}
let poseVersion = 0;

export function writePropTransform(
  instance: IPropInstance,
  prepared: ReturnType<typeof preparePropTransform>,
): void {
  instance.pose.copy(prepared.matrix);
  poseVersion++;
  // A spruce is a trunk draw and a crown draw, so a transform write has to reach both or the tree
  // comes apart when the editor drags it.
  for (const part of instance.parts) {
    part.mesh.setMatrixAt(part.index, prepared.matrix);
    part.mesh.instanceMatrix.needsUpdate = true;
    part.mesh.computeBoundingSphere();
  }
  instance.grounding = prepared.grounding;
  instance.clearance = prepared.clearance;
  instance.cragBaseClearance = prepared.cragBaseClearance;
  instance.cragRingSamples = prepared.cragRingSamples;
}
export function readPropTransform(instance: IPropInstance): IPlacementOverride {
  const matrix = instance.pose;
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  matrix.decompose(position, quaternion, scale);
  return {
    position: position.toArray(),
    quaternion: quaternion.normalize().toArray(),
    scale: scale.toArray(),
    grounding: instance.grounding,
  };
}

/**
 * Assign every placement a variant, deterministically from its own id.
 *
 * The id rather than the array order, so re-baking the terrain and getting the same candidates back
 * gives the same trees in the same places, and the editor's saved override for one placement still
 * describes the same shape it did last time.
 */
export function variantFor(placement: IPlacement, asset: string): number {
  const count = PROP_ASSETS[asset];
  if (count === undefined) throw new Error(`Unregistered prop asset '${asset}'`);
  let hash = 0x811c9dc5;
  for (let i = 0; i < placement.id.length; i += 1) {
    hash ^= placement.id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Full trees dominate; the two half-crown forms are occasional stand variation.
  return asset === "spruce" ? ([0, 1, 2, 0, 1, 2, 0, 1, 2, 3, 4][hash % 11] ?? 0) : hash % count;
}

export interface IPropMaterials {
  readonly bark: Material;
  readonly crown: Material;
  /** Bracken under the spruces, cut against Poly Haven's fern frond atlas. */
  readonly fern: Material;
  readonly grass: Material;
  /** The far cross-card: the whole tree past the last band, one card and eight triangles. */
  readonly impostor: Material;
  /** The prepared CC0 fir's own cutout, sampled against Poly Haven's twig atlas. */
  readonly needles: Material;
  readonly petal: Material;
  /** The prepared pine's own cutout, sampled against its own leaf atlas. */
  readonly pine: Material;
  readonly stem: Material;
  readonly stone: Material;
}

/**
 * A flat stand-in surface per role, drawn until the real ones arrive.
 *
 * The meshes exist on the first frame because `enter` is synchronous and the maps are not, and a
 * missing material has to mean "plain spruce" rather than "no forest". Vertex colours are on, so
 * grass and stems already read correctly from their own gradient.
 */
export function flatPropMaterials(): IPropMaterials & { dispose: () => void } {
  const materials: IPropMaterials = {
    bark: new MeshStandardMaterial({ color: 0x4a3428, roughness: 0.95 }),
    crown: new MeshStandardMaterial({ color: 0x2c4a2a, roughness: 0.9, side: DoubleSide }),
    fern: new MeshStandardMaterial({ color: 0x2f4d22, roughness: 0.9, side: DoubleSide }),
    grass: new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.93,
      side: DoubleSide,
      vertexColors: true,
    }),
    // The far card and the pine's crown are the same green: one is a picture of the other, so a
    // tree that steps down a band does not change colour on the way.
    impostor: new MeshStandardMaterial({ color: 0x24401f, roughness: 0.94, side: DoubleSide }),
    needles: new MeshStandardMaterial({ color: 0x24401f, roughness: 0.94, side: DoubleSide }),
    petal: new MeshStandardMaterial({ color: 0xb8181a, roughness: 0.75, side: DoubleSide }),
    pine: new MeshStandardMaterial({ color: 0x24401f, roughness: 0.94, side: DoubleSide }),
    stem: new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      side: DoubleSide,
      vertexColors: true,
    }),
    stone: new MeshStandardMaterial({ color: 0x6e6f62, roughness: 0.93 }),
  };
  return {
    ...materials,
    dispose: () => {
      for (const material of Object.values(materials)) material.dispose();
    },
  };
}

/** One variant's placements, their poses, and the draws each detail level of it owns. */
interface IVariantGroup {
  readonly entries: { instance: IPropInstance; pose: Matrix4 }[];
  /** One mesh per level per role, so a level is one draw and the matrix write reaches all of them. */
  readonly levels: Map<number, InstancedMesh[]>;
  /** Which level each placement drew last frame. The hysteresis reads it and writes it. */
  readonly state: Uint8Array;
  readonly asset: string;
}

/**
 * Which detail level a placement draws at, and when it is allowed to change its mind.
 *
 * A step down happens at the band for the level it is leaving, and a step back up only once the
 * camera has come a fifth further inside it. Without that slack a camera sitting on a boundary
 * assigns a different level to the same tree on alternate frames, which reads as the tree
 * flickering rather than as a change of detail.
 *
 * The bands are indexed by level rather than picked from a pair, because a variant may have two
 * levels or three: the pine has a far cross-card as well as a mid mesh, and a two-band ladder
 * would leave the third level unreachable or reachable at the wrong distance.
 */
export function levelFor(distance: number, current: number, levelCount: number): number {
  let level = current;
  const bands = [LOD_BANDS.mid, LOD_BANDS.far];
  while (level + 1 < levelCount && distance > (bands[level] ?? LOD_BANDS.far)) level++;
  while (level > 0 && distance < (bands[level - 1] ?? LOD_BANDS.mid) * (1 - LOD_BANDS.hysteresis))
    level--;
  return level;
}

/**
 * Place every prop and build one instanced mesh per (asset, variant, level, role).
 *
 * The grouping is what bounds the draw count: a forest of 200 spruces across three variants is six
 * draws, not six hundred, because every copy of a variant shares one geometry and one material and
 * differs only by its matrix. A variant with more than one detail level owns one mesh per level per
 * role, and {@link setPropLevels} refills them from the camera each frame; a variant with one never
 * touches its matrices again.
 */
export function createProps(
  placements: readonly IPlacement[],
  groundAt: PropGroundQuery,
  parts: Map<string, IPropPart[]>,
  materials: IPropMaterials,
) {
  const object = new Group();
  const meshes: InstancedMesh[] = [];
  const byId = new Map<string, IPropInstance>();

  // Group by variant first, then place once per group: the poses a group shares are the same
  // matrices written into every one of its draws.
  const groups = new Map<string, { instance: IPropInstance; pose: Matrix4 }[]>();
  for (const placement of placements) {
    const key = `${placement.asset}:${variantFor(placement, placement.asset)}`;
    const chosen = parts.get(key);
    if (!chosen) throw new Error(`Prop asset '${key}' was never built`);
    // Grounding measures the prop's own lowest point, so it measures the part that reaches the
    // ground: the trunk of a spruce, not its crown, and the body of a boulder.
    const foot = chosen.find((part) => part.role === "bark" || part.role === "stone") ?? chosen[0];
    if (!foot) throw new Error(`Prop asset '${key}' has no parts`);
    const pose = preparePose(
      foot.geometry,
      materials[foot.role],
      placement,
      placement.transform,
      groundAt,
    );
    const entries = groups.get(key) ?? [];
    entries.push({
      instance: {
        clearance: pose.clearance,
        cragBaseClearance: pose.cragBaseClearance,
        cragRingSamples: pose.cragRingSamples,
        grounding: pose.grounding,
        index: 0,
        // Filled in below once this group's meshes exist; the trunk draw is the one the editor
        // picks and measures against.
        mesh: undefined as unknown as InstancedMesh,
        parts: [],
        placement,
        pose: pose.matrix,
        geometry: foot.geometry,
      },
      pose: pose.matrix,
    });
    groups.set(key, entries);
  }

  function dispose(): void {
    for (const mesh of meshes) mesh.dispose();
    object.clear();
    byId.clear();
    groups.clear();
    banded.length = 0;
  }
  /** Every variant with more than one detail level, which is the only thing that refills. */
  const banded: IVariantGroup[] = [];
  try {
    for (const [key, entries] of groups) {
      const chosen = parts.get(key);
      if (!chosen) throw new Error(`Prop asset '${key}' was never built`);
      // Which role the editor treats as the prop's body: the part that touches the ground, because
      // that is the one whose bounds centre the selection gizmo on the tree rather than on its leaves.
      const bodyRole = chosen.some((part) => part.role === "bark")
        ? "bark"
        : chosen.some((part) => part.role === "stone")
          ? "stone"
          : chosen[0]?.role;
      const levels = [...new Set(chosen.map((part) => part.level ?? 0))].sort((a, b) => a - b);
      const byLevel = new Map<number, InstancedMesh[]>();
      for (const level of levels) {
        const levelParts = chosen.filter((part) => (part.level ?? 0) === level);
        for (const part of levelParts) {
          const batch = new InstancedBatch({
            geometry: part.geometry,
            // A pack species wears the material it was authored with; everything else wears the
            // starter's surface for its role, which is what the lit surfaces later swap in.
            material: part.material ?? materials[part.role],
          });
          for (const entry of entries) batch.add(entry.pose);
          const mesh = batch.build({
            name: `props:${key}:${part.role}`,
            parent: object,
            // Crowns and bark cast; grass does too, because its own shadow is most of its depth. The
            // poppy's petals and stems do not, at five centimetres they only cost the shadow pass —
            // and neither does the undergrowth that grew under the canopy, for the same reason one
            // order of magnitude up: a thousand seedlings and shrubs drawn a second time into a
            // shadow map is the single largest thing the pass could be asked to do, and none of it
            // reaches the ground the shadow is cast on.
            castShadow:
              part.role !== "petal" &&
              part.role !== "stem" &&
              !NO_SHADOW_ASSETS.has(key.split(":")[0] ?? ""),
            receiveShadow: true,
          });
          if (!mesh) throw new Error(`Empty prop batch '${key}:${part.role}'`);
          mesh.userData.placementIds = entries.map((entry) => entry.instance.placement.id);
          // Recorded rather than inferred later: the surface swap has to leave a pack species alone,
          // and "does the role name appear in the lit set" is not the same question.
          mesh.userData.ownMaterial = part.material !== undefined;
          mesh.userData.body = part.role === bodyRole;
          meshes.push(mesh);
          const list = byLevel.get(level) ?? [];
          list.push(mesh);
          byLevel.set(level, list);
          entries.forEach((entry, index) => {
            entry.instance.parts.push({ index, mesh });
            if (part.role === bodyRole) {
              entry.instance.mesh = mesh;
              entry.instance.index = index;
            }
          });
        }
      }
      // Every level's mesh was filled with every placement at build time, so the bounding sphere
      // `InstancedBatch` computed is already the union over the levels — the same bound, correct
      // for whichever subset a frame happens to draw, and computed once.
      banded.push({
        asset: key.split(":")[0] ?? "",
        entries,
        levels: byLevel,
        state: new Uint8Array(entries.length),
      });
      for (const entry of entries) {
        if (entry.instance.mesh === undefined)
          throw new Error(`Prop '${entry.instance.placement.id}' built no body draw`);
        byId.set(entry.instance.placement.id, entry.instance);
      }
    }
    const origin = new Vector3();
    const levelCount = new Map<IVariantGroup, number>();

    /**
     * Refill every banded variant from the camera.
     *
     * One pass over the placements per variant, one matrix write per draw the placement lands in,
     * and the draw counts follow. A frame that changes nothing still writes the same matrices,
     * which is the price of not sorting the placements by level: the work is a few hundred matrix
     * copies for a forest, against a sort that would move a tree's editor index every frame.
     */
    const seenFrom = new Vector3(Number.NaN, 0, 0);
    let seenPoseVersion = poseVersion;
    const setLevels = (camera: Vector3): void => {
      // Only when the eye has actually moved. A benchmark framing holds the camera still for
      // hundreds of frames and the assignment cannot change, and every refill re-uploads each
      // level's whole instance buffer — which is a cost the frame pays whether the answer moved
      // or not.
      const edited = seenPoseVersion !== poseVersion;
      if (!edited && seenFrom.distanceToSquared(camera) < 0.25 ** 2) return;
      seenFrom.copy(camera);
      seenPoseVersion = poseVersion;
      for (const group of banded) {
        const levels = levelCount.get(group) ?? 0;
        const counts = new Array<number>(levels).fill(0);
        for (const list of group.levels.values())
          for (const mesh of list) mesh.userData.placementIds = [];
        for (const [index, entry] of group.entries.entries()) {
          entry.instance.parts = [];
          origin.setFromMatrixPosition(entry.pose);
          const distance = origin.distanceTo(camera);
          const reach = DRAW_REACH[group.asset];
          if (reach !== undefined && distance > reach) continue;
          if (reach !== undefined && ["grass", "scrub", "fern"].includes(group.asset)) {
            // Stable density falloff: survivors keep their authored scale, never shrink into the floor.
            const fade = Math.max(0, (distance - 28) / (reach - 28));
            const seed = (Math.imul(index + 1, 2654435761) >>> 0) / 4294967296;
            if (seed > (1 - fade) ** 2) continue;
          }
          const level = levelFor(distance, group.state[index] ?? 0, levels);
          group.state[index] = level;
          const slot = counts[level] ?? 0;
          for (const mesh of group.levels.get(level) ?? []) {
            mesh.setMatrixAt(slot, entry.pose);
            mesh.userData.placementIds.push(entry.instance.placement.id);
            entry.instance.parts.push({ mesh, index: slot });
            if (mesh.userData.body) {
              entry.instance.mesh = mesh;
              entry.instance.index = slot;
            }
          }
          counts[level] = slot + 1;
        }
        for (const [level, list] of group.levels) {
          for (const mesh of list) {
            mesh.count = counts[level] ?? 0;
            mesh.instanceMatrix.needsUpdate = true;
            mesh.computeBoundingSphere();
          }
        }
      }
    };
    for (const group of banded) levelCount.set(group, group.levels.size);
    return { object, meshes, byId, dispose, setLevels };
  } catch (error) {
    dispose();
    throw error;
  }
}
