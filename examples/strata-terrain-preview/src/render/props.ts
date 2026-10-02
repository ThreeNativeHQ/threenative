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
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import { boulder, grassClump, poppyCluster } from "./cover.js";
import { ATLAS_CELLS, spruceVariants } from "./spruce.js";

/** Which cell of the needle atlas the poppy petals sample. */
const POPPY_PETAL = { u0: 0.5, v0: 0, u1: 1, v1: 0.5 };

/** How many variants of each prop the starter builds, and the seed they are built from. */
export const VARIANTS = {
  // One procedural boulder: the four prepared CC0 ones replace it as variants, and one is left so
  // the procedural path is a live variant rather than a fallback nothing reaches.
  boulder: 1,
  grass: 2,
  poppy: 2,
  spruce: 3,
  seed: 0x9e3779b9,
} as const;

/**
 * How many prepared CC0 variants of each prop the starter's prepared art provides.
 *
 * The fir's two variants are behind `SCATTER_PREPARED_FIR` in `prepared.ts`, which is off on the
 * measurement printed there, so the spruce count is the procedural tree's own.
 */
const PREPARED_VARIANTS = { boulder: 3, spruce: 0 } as const;

/** One drawable piece of a prop: its geometry, and the role that decides its material. */
/** The share of a boulder's height that sits below the ground. */
const BOULDER_BURIAL = 0.2;

export type PropRole = "bark" | "crown" | "needles" | "stone" | "grass" | "petal" | "stem";

/**
 * Metres at which a prepared prop steps down one detail level, and the slack that keeps a
 * camera walking the boundary from stepping it up and down again.
 *
 * The bands are the game's, because the triangle budget behind them is the game's: a prop is drawn
 * from its full prepared detail inside `near` and from the mid level past it. The hysteresis is a
 * fifth of the band rather than a fixed number of metres, so the same slack works for a two-metre
 * rock and a fourteen-metre tree.
 */
export const LOD_BANDS = { hysteresis: 0.2, mid: 60, near: 22 } as const;

export interface IPropPart {
  readonly geometry: BufferGeometry;
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
): Map<string, IPropPart[]> {
  const variants = new Map<string, IPropPart[]>();
  // Two seeds' worth, so a prepared variant does not cost a procedural one the indices after it
  // would have needed.
  const spruces = spruceVariants(PROP_COUNTS.spruce, VARIANTS.seed);
  for (let index = 0; index < PROP_COUNTS.spruce; index += 1) {
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
  for (let i = 0; i < VARIANTS.grass; i += 1)
    variants.set(`grass:${i}`, [
      { geometry: grassClump((VARIANTS.seed ^ (i * 0xc2b2ae35)) >>> 0), role: "grass", variant: i },
    ]);
  for (let i = 0; i < VARIANTS.poppy; i += 1) {
    const cluster = poppyCluster((VARIANTS.seed ^ (i * 0x27d4eb2f)) >>> 0, POPPY_PETAL);
    variants.set(`poppy:${i}`, [
      { geometry: cluster.stems, role: "stem", variant: i },
      { geometry: cluster.petals, role: "petal", variant: i },
    ]);
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
  boulder: VARIANTS.boulder + PREPARED_VARIANTS.boulder,
  grass: VARIANTS.grass,
  poppy: VARIANTS.poppy,
  spruce: VARIANTS.spruce + PREPARED_VARIANTS.spruce,
} as const;

export const PROP_ASSETS: Record<string, number> = PROP_COUNTS;

export type PropGroundQuery = (
  placement: IPlacement,
  position: [number, number, number],
) => { height: number | null; offset: number };
export interface IPropInstance {
  mesh: InstancedMesh;
  index: number;
  placement: IPlacement;
  grounding: boolean;
  clearance: number | null;
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
  if (grounding && !transform && placement.asset === "boulder" && ground.height !== null) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box) model.position.y -= BOULDER_BURIAL * (box.max.y - box.min.y) * model.scale.y;
  }
  model.updateMatrix();
  if (!new Float32Array(model.matrix.elements).every(Number.isFinite))
    throw new Error(`Transform exceeds the renderer range for '${placement.id}'`);
  return { matrix: model.matrix.clone(), grounding, clearance: snap.clearance };
}
export function preparePropTransform(
  instance: IPropInstance,
  transform: IPlacementOverride | undefined,
  groundAt: PropGroundQuery,
) {
  const { material } = instance.mesh;
  if (Array.isArray(material))
    throw new Error(`Prop '${instance.placement.id}' has a multi-material draw`);
  return preparePose(instance.mesh.geometry, material, instance.placement, transform, groundAt);
}
export function writePropTransform(
  instance: IPropInstance,
  prepared: ReturnType<typeof preparePropTransform>,
): void {
  // A spruce is a trunk draw and a crown draw, so a transform write has to reach both or the tree
  // comes apart when the editor drags it.
  for (const part of instance.parts) {
    part.mesh.setMatrixAt(part.index, prepared.matrix);
    part.mesh.instanceMatrix.needsUpdate = true;
    part.mesh.computeBoundingSphere();
  }
  instance.grounding = prepared.grounding;
  instance.clearance = prepared.clearance;
}
export function readPropTransform(instance: IPropInstance): IPlacementOverride {
  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  instance.mesh.getMatrixAt(instance.index, matrix);
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
  return hash % count;
}

export interface IPropMaterials {
  readonly bark: Material;
  readonly crown: Material;
  readonly grass: Material;
  /** The prepared CC0 fir's own cutout, sampled against Poly Haven's twig atlas. */
  readonly needles: Material;
  readonly petal: Material;
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
    grass: new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.93,
      side: DoubleSide,
      vertexColors: true,
    }),
    needles: new MeshStandardMaterial({ color: 0x24401f, roughness: 0.94, side: DoubleSide }),
    petal: new MeshStandardMaterial({ color: 0xb8181a, roughness: 0.75, side: DoubleSide }),
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
}

/**
 * Which detail level a placement draws at, and when it is allowed to change its mind.
 *
 * A step down happens at the band, and a step back up only once the camera has come a fifth
 * further inside it. Without that slack a camera sitting on a boundary assigns a different level
 * to the same tree on alternate frames, which reads as the tree flickering rather than as a
 * change of detail.
 */
export function levelFor(distance: number, current: number, levelCount: number): number {
  const band = current === 0 ? LOD_BANDS.near : LOD_BANDS.mid;
  if (distance > band && current + 1 < levelCount) return current + 1;
  if (distance < band * (1 - LOD_BANDS.hysteresis) && current > 0) return current - 1;
  return current;
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
    groups.set(key, [
      ...(groups.get(key) ?? []),
      {
        instance: {
          clearance: pose.clearance,
          grounding: pose.grounding,
          index: 0,
          // Filled in below once this group's meshes exist; the trunk draw is the one the editor
          // picks and measures against.
          mesh: undefined as unknown as InstancedMesh,
          parts: [],
          placement,
        },
        pose: pose.matrix,
      },
    ]);
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
            material: materials[part.role],
          });
          for (const entry of entries) batch.add(entry.pose);
          const mesh = batch.build({
            name: `props:${key}:${part.role}`,
            parent: object,
            // Crowns and bark cast; grass does too, because its own shadow is most of its depth. The
            // poppy's petals and stems do not, at five centimetres they only cost the shadow pass.
            castShadow: part.role !== "petal" && part.role !== "stem",
            receiveShadow: true,
          });
          if (!mesh) throw new Error(`Empty prop batch '${key}:${part.role}'`);
          mesh.userData.placementIds = entries.map((entry) => entry.instance.placement.id);
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
      if (levels.length > 1) {
        // Every level's mesh was filled with every placement at build time, so the bounding sphere
        // `InstancedBatch` computed is already the union over the levels — the same bound, correct
        // for whichever subset a frame happens to draw, and computed once.
        banded.push({ entries, levels: byLevel, state: new Uint8Array(entries.length) });
      }
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
    const setLevels = (camera: Vector3): void => {
      // Only when the eye has actually moved. A benchmark framing holds the camera still for
      // hundreds of frames and the assignment cannot change, and every refill re-uploads each
      // level's whole instance buffer — which is a cost the frame pays whether the answer moved
      // or not.
      if (seenFrom.distanceToSquared(camera) < 0.25 ** 2) return;
      seenFrom.copy(camera);
      for (const group of banded) {
        const levels = levelCount.get(group) ?? 0;
        const counts = new Array<number>(levels).fill(0);
        for (const [index, entry] of group.entries.entries()) {
          origin.setFromMatrixPosition(entry.pose);
          const level = levelFor(origin.distanceTo(camera), group.state[index] ?? 0, levels);
          group.state[index] = level;
          const slot = counts[level] ?? 0;
          for (const mesh of group.levels.get(level) ?? []) mesh.setMatrixAt(slot, entry.pose);
          counts[level] = slot + 1;
        }
        for (const [level, list] of group.levels) {
          for (const mesh of list) {
            mesh.count = counts[level] ?? 0;
            mesh.instanceMatrix.needsUpdate = true;
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
