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
  boulder: 3,
  grass: 2,
  poppy: 2,
  spruce: 3,
  seed: 0x9e3779b9,
} as const;

/** The atlas cell each variant of a spruce uses for its crown, so a variant reads as one tree. */
const SPRUCE_CELLS = [ATLAS_CELLS.dense, ATLAS_CELLS.open, ATLAS_CELLS.tip];

/** One drawable piece of a prop: its geometry, and the role that decides its material. */
export type PropRole = "bark" | "crown" | "stone" | "grass" | "petal" | "stem";

export interface IPropPart {
  readonly geometry: BufferGeometry;
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
 */
export function buildPropVariants(): Map<string, IPropPart[]> {
  const variants = new Map<string, IPropPart[]>();
  const spruces = spruceVariants(VARIANTS.spruce, VARIANTS.seed);
  for (const [index, spruce] of spruces.entries()) {
    variants.set(`spruce:${index}`, [
      { geometry: spruce.trunk, role: "bark", variant: index },
      // Each variant leans on a different needle card, so three spruce silhouettes are three
      // textures rather than one texture at three sizes.
      { geometry: spruce.crown, role: "crown", variant: index },
    ]);
  }
  for (let i = 0; i < VARIANTS.boulder; i += 1)
    variants.set(`boulder:${i}`, [
      { geometry: boulder((VARIANTS.seed ^ (i * 0x85ebca6b)) >>> 0), role: "stone", variant: i },
    ]);
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

/** The prop names this starter knows, and how many variants each has. */
export const PROP_ASSETS: Record<string, number> = {
  boulder: VARIANTS.boulder,
  grass: VARIANTS.grass,
  poppy: VARIANTS.poppy,
  spruce: VARIANTS.spruce,
};

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

/**
 * Place every prop and build one instanced mesh per (asset, variant, role).
 *
 * The grouping is what bounds the draw count: a forest of 200 spruces across three variants is six
 * draws, not six hundred, because every copy of a variant shares one geometry and one material and
 * differs only by its matrix.
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
  }
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
      for (const part of chosen) {
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
        entries.forEach((entry, index) => {
          entry.instance.parts.push({ index, mesh });
          if (part.role === bodyRole) {
            entry.instance.mesh = mesh;
            entry.instance.index = index;
          }
        });
      }
      for (const entry of entries) {
        if (entry.instance.mesh === undefined)
          throw new Error(`Prop '${entry.instance.placement.id}' built no body draw`);
        byId.set(entry.instance.placement.id, entry.instance);
      }
    }
    return { object, meshes, byId, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
