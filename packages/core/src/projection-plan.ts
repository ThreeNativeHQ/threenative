import type { BufferGeometry, Light, Material, Mesh, Object3D, Scene } from "three";

import type { ProjectionExactReason, ProjectionReasonCode } from "./renderProjection.js";

/**
 * The scan-and-plan seam of the render projection (P2-3).
 *
 * Reading the authored scene and deciding what the mirror should do does not touch the mirror or
 * allocate a buffer. The scan owns one caller-provided workspace: its collections are cleared and
 * refilled in place, and the returned plan is consumed before the next scan. Keeping the decision
 * here means the kill-switch ratio, the mesh floor and the exact-lane classification are testable
 * without a mirror at all.
 */

/**
 * Fewer members than this and a group is not worth batching.
 *
 * An instanced draw of one object is one draw, exactly like the object was, except it also costs a
 * private buffer, a slot table and a per-frame matrix compare. A game whose meshes each carry their
 * own geometry — which is most games that build geometry procedurally, and every game that has
 * already merged its own scene — produces nothing but one-member groups, so batching it converts a
 * cheap scene into an expensive one that draws the same number of times.
 */
const MIN_BATCH_MEMBERS = 4;

/**
 * The projection must be meaningfully better than doing nothing, or it does nothing.
 *
 * This is the rule that was missing, and its absence is the whole of the defect it was added for: a
 * real game that had already merged its own scene from 1,698 meshes to 254 was re-expanded into
 * 1,251 single-member instanced draws — the same draw count as the authored scene, plus a rebuild
 * of every batch on the frame that discovered them. The frame never finished and the screen stayed
 * black. Nothing in the design forbade it, because nothing compared the result against the input.
 *
 * Now everything is predicted from the grouping before a single buffer is allocated, and a
 * projection that cannot beat this ratio is abandoned before it costs anything.
 */
const WORTHWHILE_DRAW_RATIO = 0.75;

function isMesh(object: Object3D): object is Mesh {
  return (object as Mesh).isMesh === true;
}

export function isLight(object: Object3D): object is Light {
  return (object as Light).isLight === true;
}

/** True when the object draws something, whether or not this class can batch it. */
export function isRenderable(object: Object3D): boolean {
  const candidate = object as Mesh & { isSprite?: boolean; isPoints?: boolean; isLine?: boolean };
  return (
    candidate.isMesh === true ||
    candidate.isSprite === true ||
    candidate.isPoints === true ||
    candidate.isLine === true
  );
}

type ProjectionCandidate = Mesh & {
  isInstancedMesh?: boolean;
  isBatchedMesh?: boolean;
  isSkinnedMesh?: boolean;
  isSprite?: boolean;
  isPoints?: boolean;
  isLine?: boolean;
  isLOD?: boolean;
  customDepthMaterial?: unknown;
  customDistanceMaterial?: unknown;
};

function specializedLaneReason(
  object: Object3D,
  candidate: ProjectionCandidate,
): ProjectionExactReason | undefined {
  if (candidate.isSprite === true) return "sprite";
  if (candidate.isPoints === true || candidate.isLine === true) return "points";
  if (candidate.isInstancedMesh === true || candidate.isBatchedMesh === true) return "instanced";
  if (candidate.isSkinnedMesh === true) return "skinned";
  if (Array.isArray(candidate.material)) return "multiMaterial";
  if (candidate.customDepthMaterial != null || candidate.customDistanceMaterial != null) {
    return "customDepthMaterial";
  }
  for (let node: Object3D | null = object; node !== null; node = node.parent) {
    if ((node as { isLOD?: boolean }).isLOD === true) return "lod";
  }
  return undefined;
}

function hasMorphAttributes(geometry: BufferGeometry): boolean {
  for (const name in geometry.morphAttributes) {
    if (Object.hasOwn(geometry.morphAttributes, name)) return true;
  }
  return false;
}

function geometryLaneReason(geometry: BufferGeometry): ProjectionExactReason | undefined {
  if (geometry.getAttribute("position") === undefined) return "unsupportedGeometry";
  if (hasMorphAttributes(geometry)) return "morph";
  const range = geometry.drawRange;
  if (range !== undefined && (range.start !== 0 || Number.isFinite(range.count))) {
    return "drawRange";
  }
  return undefined;
}

/**
 * Why a renderable cannot join a batch, or `undefined` when it can.
 *
 * Every entry is a semantic a batched draw provably does not carry. They are named individually
 * because a report saying "12 objects were not batched" is not evidence, and §4.3 requires the
 * ineligible set to be enumerated before a low draw count means anything.
 */
export function exactLaneReason(object: Object3D): ProjectionExactReason | undefined {
  const candidate = object as ProjectionCandidate;
  const specialized = specializedLaneReason(object, candidate);
  if (specialized !== undefined) return specialized;
  const geometry = candidate.geometry;
  if (geometry === undefined) return "unsupportedGeometry";
  const geometryReason = geometryLaneReason(geometry);
  if (geometryReason !== undefined) return geometryReason;
  // A batch is one draw, so it has one place in the transparency sort. Objects that asked for a
  // specific place keep their own draw and their own place in it.
  if ((object.renderOrder ?? 0) !== 0) return "renderOrder";
  const material = candidate.material as Material | undefined;
  if (material === undefined) return "unsupportedGeometry";
  if (material.transparent === true) return "transparent";
  return undefined;
}

/**
 * True when the object carries a render callback of its own.
 *
 * Three.js hands `onBeforeRender` the object it is about to draw. A proxy would hand it the proxy,
 * and a batch would not call it at all, so a game that hooks a draw gets its own object back or the
 * frame is not projected. There is no third option that is honest, and this is rare enough that
 * whole-scene fallback is the right price.
 */
function hasRenderHook(object: Object3D): boolean {
  return Object.hasOwn(object, "onBeforeRender") || Object.hasOwn(object, "onAfterRender");
}

/** Why a source cannot share a batch, or the whole classification for one frame. */
export interface IProjectionExactEntry {
  object: Object3D | undefined;
  reason: ProjectionExactReason;
}

/** A reusable identity group for one (geometry, material, flags) combination. */
export interface IProjectionBatchGroup {
  readonly geometry: BufferGeometry;
  readonly material: Material;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  readonly layersMask: number;
  readonly members: Mesh[];
  activeScan: number;
}

/** All scan-owned storage. It never escapes the synchronous reconcile that owns it. */
export interface IProjectionScanWorkspace {
  readonly seen: Set<Object3D>;
  readonly eligible: Mesh[];
  readonly exactLane: IProjectionExactEntry[];
  readonly exactEntryPool: IProjectionExactEntry[];
  readonly lights: Light[];
  readonly batchGroups: IProjectionBatchGroup[];
  readonly belowFloor: Mesh[];
  readonly activeGroups: IProjectionBatchGroup[];
  readonly walkStack: Object3D[];
  readonly groupsByGeometry: WeakMap<
    BufferGeometry,
    WeakMap<Material, Map<number, IProjectionBatchGroup>>
  >;
  scanNumber: number;
}

/** Gives the frame back to the authored scene, naming why. */
export interface IProjectionDeclinePlan {
  readonly action: "decline";
  readonly reasonCode: ProjectionReasonCode;
  readonly reason: string;
}

/** Everything the apply seam needs to build and maintain this frame's mirror. */
export interface IProjectionProjectPlan {
  readonly action: "project";
  /** Groups worth batching, sized before anything is built. */
  readonly batchGroups: readonly IProjectionBatchGroup[];
  /** Group members below the batching floor: released from batches, drawn on the exact lane. */
  readonly belowFloor: readonly Mesh[];
  /** Objects keeping a draw of their own, with the reason each one did. */
  readonly exactLane: readonly IProjectionExactEntry[];
  /** The scene's lights, to be mirrored rather than moved out of the game's graph. */
  readonly lights: readonly Light[];
  /** Every object the walk saw, for the retirement sweep against sources that left the scene. */
  readonly seen: ReadonlySet<Object3D>;
}

export type IProjectionPlan = IProjectionDeclinePlan | IProjectionProjectPlan;

export interface IProjectionScanResult {
  /** Exact-lane entries from the walk alone, before batching decisions add more. */
  readonly exactLane: readonly IProjectionExactEntry[];
  /** Decline without touching the mirror, or build what the plan describes. */
  readonly plan: IProjectionPlan;
  /** Renderables the authored scene holds — what an unoptimized frame would walk and draw. */
  readonly renderables: number;
  readonly seen: ReadonlySet<Object3D>;
}

export function createProjectionScanWorkspace(): IProjectionScanWorkspace {
  return {
    seen: new Set(),
    eligible: [],
    exactLane: [],
    exactEntryPool: [],
    lights: [],
    batchGroups: [],
    belowFloor: [],
    activeGroups: [],
    walkStack: [],
    groupsByGeometry: new WeakMap(),
    scanNumber: 0,
  };
}

/**
 * Releases source references from the reusable scan storage after its plan is consumed.
 *
 * The arrays and identity maps stay reusable, but their members are borrowed from the authored
 * scene. Keeping those members in an inactive group or pooled exact entry would make a streamed
 * scene retain every mesh it had ever contained.
 */
export function releaseProjectionScanWorkspace(workspace: IProjectionScanWorkspace): void {
  for (let index = 0; index < workspace.exactEntryPool.length; index += 1) {
    const entry = workspace.exactEntryPool[index] as IProjectionExactEntry;
    entry.object = undefined;
  }
  for (let index = 0; index < workspace.activeGroups.length; index += 1) {
    const group = workspace.activeGroups[index] as IProjectionBatchGroup;
    group.members.length = 0;
  }
  workspace.seen.clear();
  workspace.eligible.length = 0;
  workspace.exactLane.length = 0;
  workspace.lights.length = 0;
  workspace.batchGroups.length = 0;
  workspace.belowFloor.length = 0;
  workspace.activeGroups.length = 0;
  workspace.walkStack.length = 0;
}

function addExactEntry(
  workspace: IProjectionScanWorkspace,
  object: Object3D,
  reason: ProjectionExactReason,
): void {
  const index = workspace.exactLane.length;
  let entry = workspace.exactEntryPool[index];
  if (entry === undefined) {
    entry = { object, reason };
    workspace.exactEntryPool.push(entry);
  } else {
    entry.object = object;
    entry.reason = reason;
  }
  workspace.exactLane.push(entry);
}

function batchFlagsOf(mesh: Mesh): number {
  return (mesh.layers.mask >>> 0) * 4 + (mesh.castShadow ? 2 : 0) + (mesh.receiveShadow ? 1 : 0);
}

function addToBatchGroup(
  workspace: IProjectionScanWorkspace,
  mesh: Mesh,
  scanNumber: number,
): void {
  const geometry = mesh.geometry;
  const material = mesh.material as Material;
  let byMaterial = workspace.groupsByGeometry.get(geometry);
  if (byMaterial === undefined) {
    byMaterial = new WeakMap();
    workspace.groupsByGeometry.set(geometry, byMaterial);
  }
  let byFlags = byMaterial.get(material);
  if (byFlags === undefined) {
    byFlags = new Map();
    byMaterial.set(material, byFlags);
  }
  const flags = batchFlagsOf(mesh);
  let group = byFlags.get(flags);
  if (group === undefined) {
    group = {
      geometry,
      material,
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
      layersMask: mesh.layers.mask,
      members: [],
      activeScan: 0,
    };
    byFlags.set(flags, group);
  }
  if (group.activeScan !== scanNumber) {
    group.activeScan = scanNumber;
    group.members.length = 0;
    workspace.activeGroups.push(group);
  }
  group.members.push(mesh);
}

interface IProjectionWalkState {
  renderables: number;
  blocked?: { code: ProjectionReasonCode; reason: string };
}

function visitProjectionObject(
  object: Object3D,
  workspace: IProjectionScanWorkspace,
  state: IProjectionWalkState,
): void {
  // A hook is handed the object being drawn, and neither a batch nor a proxy can hand back the
  // game's own object. The frame goes to the authored scene instead.
  if (state.blocked === undefined && hasRenderHook(object)) {
    state.blocked = {
      code: "renderHook",
      reason: "an object carries its own onBeforeRender/onAfterRender",
    };
  }
  if (isLight(object)) {
    workspace.lights.push(object);
    return;
  }
  if ((object as { isLOD?: boolean }).isLOD === true) {
    state.renderables += 1;
    workspace.seen.add(object);
    addExactEntry(workspace, object, "lod");
    return;
  }
  if (!isRenderable(object)) return;
  state.renderables += 1;
  workspace.seen.add(object);
  const reason = exactLaneReason(object);
  if (reason === undefined && isMesh(object)) workspace.eligible.push(object);
  else addExactEntry(workspace, object, reason ?? "unsupportedGeometry");
}

function walkProjection(source: Scene, workspace: IProjectionScanWorkspace): IProjectionWalkState {
  const state: IProjectionWalkState = { renderables: 0 };
  for (let index = source.children.length - 1; index >= 0; index -= 1) {
    workspace.walkStack.push(source.children[index] as Object3D);
  }
  while (workspace.walkStack.length > 0) {
    const object = workspace.walkStack.pop() as Object3D;
    visitProjectionObject(object, workspace, state);
    if (isLight(object) || (object as { isLOD?: boolean }).isLOD === true) continue;
    for (let index = object.children.length - 1; index >= 0; index -= 1) {
      workspace.walkStack.push(object.children[index] as Object3D);
    }
  }
  return state;
}

function groupEligibleMeshes(workspace: IProjectionScanWorkspace, scanNumber: number): void {
  for (let index = 0; index < workspace.eligible.length; index += 1) {
    addToBatchGroup(workspace, workspace.eligible[index] as Mesh, scanNumber);
  }
}

function predictDraws(workspace: IProjectionScanWorkspace): number {
  let predictedDraws = workspace.exactLane.length;
  for (let index = 0; index < workspace.activeGroups.length; index += 1) {
    const group = workspace.activeGroups[index] as IProjectionBatchGroup;
    if (group.members.length < MIN_BATCH_MEMBERS) predictedDraws += group.members.length;
    else {
      workspace.batchGroups.push(group);
      predictedDraws += 1;
    }
  }
  return predictedDraws;
}

function collectBelowFloor(workspace: IProjectionScanWorkspace): void {
  for (let index = 0; index < workspace.activeGroups.length; index += 1) {
    const group = workspace.activeGroups[index] as IProjectionBatchGroup;
    if (group.members.length >= MIN_BATCH_MEMBERS) continue;
    for (let member = 0; member < group.members.length; member += 1) {
      workspace.belowFloor.push(group.members[member] as Mesh);
    }
  }
}

/**
 * Walks the authored scene once and decides what this frame's projection will do.
 *
 * One traversal does all of it: classification, dirty detection and removal. Walking it twice
 * would double the only cost that scales with the scene. An explicit walk rather than
 * `Object3D.traverse`, because some subtrees must be mirrored whole and not descended into — an
 * `LOD` chooses one level per frame on itself, so its levels belong to its stand-in.
 */
export function scanProjection(
  source: Scene,
  minMeshes: number,
  workspace: IProjectionScanWorkspace,
): IProjectionScanResult {
  releaseProjectionScanWorkspace(workspace);
  workspace.scanNumber += 1;
  const state = walkProjection(source, workspace);

  if (state.blocked !== undefined) {
    return {
      exactLane: workspace.exactLane,
      plan: {
        action: "decline",
        reasonCode: state.blocked.code,
        reason: state.blocked.reason,
      },
      renderables: state.renderables,
      seen: workspace.seen,
    };
  }
  if (workspace.eligible.length < minMeshes) {
    return {
      exactLane: workspace.exactLane,
      plan: {
        action: "decline",
        reasonCode: "belowMeshFloor",
        reason: `fewer than ${minMeshes} batchable meshes; the mirror would cost more than it saves`,
      },
      renderables: state.renderables,
      seen: workspace.seen,
    };
  }

  groupEligibleMeshes(workspace, workspace.scanNumber);
  const predictedDraws = predictDraws(workspace);
  if (predictedDraws > state.renderables * WORTHWHILE_DRAW_RATIO) {
    return {
      exactLane: workspace.exactLane,
      plan: {
        action: "decline",
        reasonCode: "notWorthwhile",
        reason: `projecting would draw ${predictedDraws} of ${state.renderables} candidates, which is not worth its own cost`,
      },
      renderables: state.renderables,
      seen: workspace.seen,
    };
  }

  collectBelowFloor(workspace);
  return {
    exactLane: workspace.exactLane,
    plan: {
      action: "project",
      batchGroups: workspace.batchGroups,
      belowFloor: workspace.belowFloor,
      exactLane: workspace.exactLane,
      lights: workspace.lights,
      seen: workspace.seen,
    },
    renderables: state.renderables,
    seen: workspace.seen,
  };
}
