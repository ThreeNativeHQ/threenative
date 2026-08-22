import type { BufferGeometry, Light, Material, Mesh, Object3D, Scene } from "three";

import type { ProjectionExactReason, ProjectionReasonCode } from "./renderProjection.js";

/**
 * The scan-and-plan seam of the render projection (P2-3).
 *
 * Reading the authored scene and deciding what the mirror should do are pure: nothing here
 * touches the mirror, allocates a buffer, or mutates anything. The output is an immutable plan —
 * either a decline naming why the frame goes back to the authored scene, or a project description
 * the apply seam (`projection-apply.ts`) executes. Keeping the decision here means the kill-switch
 * ratio, the mesh floor and the exact-lane classification are testable without a mirror at all.
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

/**
 * Everything that has to agree before two meshes may share one draw.
 *
 * A batch is a single object to the renderer, so every property the renderer reads per object
 * rather than per vertex has to be identical across the batch or one of them is being overruled.
 * Keying on the material alone merges a shadow caster with a non-caster and silently picks one
 * behaviour for both — a level that set five hundred casters rendering two of them, which is
 * exactly the class of "reports success, draws the wrong thing" this design exists to prevent.
 */
function batchKeyOf(mesh: Mesh): string {
  const material = mesh.material as Material;
  return [
    mesh.geometry.uuid,
    material.uuid,
    mesh.castShadow ? "cast" : "-",
    mesh.receiveShadow ? "receive" : "-",
    mesh.layers.mask,
  ].join("|");
}

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

/**
 * Why a renderable cannot join a batch, or `undefined` when it can.
 *
 * Every entry is a semantic a batched draw provably does not carry. They are named individually
 * because a report saying "12 objects were not batched" is not evidence, and §4.3 requires the
 * ineligible set to be enumerated before a low draw count means anything.
 */
export function exactLaneReason(object: Object3D): ProjectionExactReason | undefined {
  const candidate = object as Mesh & {
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
  if (candidate.isSprite === true) return "sprite";
  if (candidate.isPoints === true || candidate.isLine === true) return "points";
  if (candidate.isInstancedMesh === true || candidate.isBatchedMesh === true) return "instanced";
  if (candidate.isSkinnedMesh === true) return "skinned";
  // An array material has no single batched equivalent, and the geometry's groups are not the
  // test: three consults them only for array materials, and a stock BoxGeometry carries six.
  if (Array.isArray(candidate.material)) return "multiMaterial";
  if (candidate.customDepthMaterial != null || candidate.customDistanceMaterial != null) {
    return "customDepthMaterial";
  }
  for (let node: Object3D | null = object; node !== null; node = node.parent) {
    if ((node as { isLOD?: boolean }).isLOD === true) return "lod";
  }
  const geometry = candidate.geometry;
  if (geometry === undefined) return "unsupportedGeometry";
  if (geometry.getAttribute("position") === undefined) return "unsupportedGeometry";
  if (Object.keys(geometry.morphAttributes ?? {}).length > 0) return "morph";
  const range = geometry.drawRange;
  if (range !== undefined && (range.start !== 0 || Number.isFinite(range.count)))
    return "drawRange";
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
  readonly object: Object3D;
  readonly reason: ProjectionExactReason;
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
  /** Groups worth batching, keyed by their batch key, sized before anything is built. */
  readonly batchGroups: ReadonlyMap<string, Mesh[]>;
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
  /** Exact-lane tallies from the walk alone, before batching decisions add more. */
  readonly exactEntries: readonly ProjectionExactReason[];
  /** Decline without touching the mirror, or build what the plan describes. */
  readonly plan: IProjectionPlan;
  /** Renderables the authored scene holds — what an unoptimized frame would walk and draw. */
  readonly renderables: number;
  readonly seen: ReadonlySet<Object3D>;
}

/**
 * Walks the authored scene once and decides what this frame's projection will do.
 *
 * One traversal does all of it: classification, dirty detection and removal. Walking it twice
 * would double the only cost that scales with the scene. An explicit walk rather than
 * `Object3D.traverse`, because some subtrees must be mirrored whole and not descended into — an
 * `LOD` chooses one level per frame on itself, so its levels belong to its stand-in.
 */
export function scanProjection(source: Scene, minMeshes: number): IProjectionScanResult {
  const seen = new Set<Object3D>();
  const eligible: Mesh[] = [];
  const exactLane: IProjectionExactEntry[] = [];
  const lights: Light[] = [];
  let renderables = 0;
  let blocked: { code: ProjectionReasonCode; reason: string } | undefined;

  const walk = (object: Object3D): void => {
    // A hook is handed the object being drawn, and neither a batch nor a proxy can hand back the
    // game's own object. The frame goes to the authored scene instead.
    if (blocked === undefined && hasRenderHook(object)) {
      blocked = {
        code: "renderHook",
        reason: "an object carries its own onBeforeRender/onAfterRender",
      };
    }
    if (isLight(object)) {
      lights.push(object);
      return;
    }
    if ((object as { isLOD?: boolean }).isLOD === true) {
      renderables += 1;
      seen.add(object);
      exactLane.push({ object, reason: "lod" });
      return;
    }
    if (isRenderable(object)) {
      renderables += 1;
      seen.add(object);
      const reason = exactLaneReason(object);
      if (reason === undefined && isMesh(object)) eligible.push(object);
      else exactLane.push({ object, reason: reason ?? "unsupportedGeometry" });
    }
    for (const child of object.children) walk(child);
  };
  for (const child of source.children) walk(child);

  const exactEntries = exactLane.map((entry) => entry.reason);

  if (blocked !== undefined) {
    return {
      exactEntries,
      plan: { action: "decline", reasonCode: blocked.code, reason: blocked.reason },
      renderables,
      seen,
    };
  }
  if (eligible.length < minMeshes) {
    return {
      exactEntries,
      plan: {
        action: "decline",
        reasonCode: "belowMeshFloor",
        reason: `fewer than ${minMeshes} batchable meshes; the mirror would cost more than it saves`,
      },
      renderables,
      seen,
    };
  }

  // Grouped before anything is built, so each batch is created once at the size it actually
  // needs. Sizing from the first mesh and growing into the rest rebuilds the batch repeatedly
  // during the very frame that populates it.
  const byKey = new Map<string, Mesh[]>();
  for (const mesh of eligible) {
    const key = batchKeyOf(mesh);
    const group = byKey.get(key);
    if (group === undefined) byKey.set(key, [mesh]);
    else group.push(mesh);
  }

  // Predicted before anything is built, because building is the expensive part. A group too small
  // to be worth an instanced draw contributes one draw per member exactly as it does now; a group
  // worth batching contributes one.
  let predictedDraws = exactLane.length;
  const worthBatching = new Map<string, Mesh[]>();
  for (const [key, group] of byKey) {
    if (group.length < MIN_BATCH_MEMBERS) {
      predictedDraws += group.length;
      continue;
    }
    worthBatching.set(key, group);
    predictedDraws += 1;
  }

  // The kill switch, applied per frame rather than per release. An optimizer that does not
  // measurably reduce the renderer's work has no reason to run, and one that increases it is a
  // defect however correct its output would have been.
  if (predictedDraws > renderables * WORTHWHILE_DRAW_RATIO) {
    return {
      exactEntries,
      plan: {
        action: "decline",
        reasonCode: "notWorthwhile",
        reason: `projecting would draw ${predictedDraws} of ${renderables} candidates, which is not worth its own cost`,
      },
      renderables,
      seen,
    };
  }

  // Groups below the floor join the objects that were never eligible. They keep their own draw,
  // which is what they had.
  const belowFloor: Mesh[] = [];
  for (const [key, group] of byKey) {
    if (worthBatching.has(key)) continue;
    for (const mesh of group) belowFloor.push(mesh);
  }

  return {
    exactEntries,
    plan: { action: "project", batchGroups: worthBatching, belowFloor, exactLane, lights, seen },
    renderables,
    seen,
  };
}
