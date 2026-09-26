import type { Camera, Material, Matrix4, Object3D, Scene } from "three";

import type { IGeometryOwnership } from "./geometry-capture.js";
import type { MatrixWorldPass } from "./matrix-world.js";
import { ProjectionMirror } from "./projection-apply.js";
import {
  createProjectionScanWorkspace,
  isRenderable,
  releaseProjectionScanWorkspace,
  scanProjection,
} from "./projection-plan.js";
import { VelocityTracker } from "./render/velocity.js";

/**
 * An optimizer that the game never has to know about.
 *
 * The pass this replaces reached its draw count by consuming the scene: it merged what it judged
 * static into one buffer and lifted the sources out of the graph. That is only correct while the
 * judgement holds, and the judgement is a guess made from eight frames about arbitrary JavaScript
 * that has not run yet. When it was wrong the game did not get a slow frame, it got a wrong one —
 * a mesh that stopped moving, a hidden prop that drew anyway, two of three instances gone — and
 * the pass still reported success.
 *
 * So the ownership is inverted here. **Correct rendering is unconditional; optimization is
 * opportunistic.** The game's scene stays exactly as the game authored it — same objects, same
 * parents, same names, same traversal, same `raycast` results — and the renderer is handed a
 * private mirror of it instead. Eligible meshes reach that mirror as instances of an
 * `InstancedMesh`, so thousands of them cost one draw each group; everything else reaches it as an
 * exact proxy. When the mirror cannot reproduce something faithfully, the mirror is abandoned for
 * that frame and the authored scene is rendered directly. That fallback is a correct slow path, not
 * an error, and nothing about it is configurable.
 *
 * `InstancedMesh` is stock `three`, and using it rather than a bespoke merge is the point:
 * per-object matrices and instance reuse are things it already does, and it points at the game's
 * own geometry rather than copying it. Reconciling a moved object is a matrix write, not a rebuild,
 * which is what makes "the game may change anything at any time" affordable rather than
 * aspirational.
 *
 * Since P2-3 the class composes two seams instead of owning every concern itself: the pure scan
 * and plan (`projection-plan.ts`) decides what a frame will do, and the mirror
 * (`projection-apply.ts`) applies it and owns every mutation and restoration path. This file keeps
 * the public API, the reconciliation loop, the report assembly and the deoptimization verdict.
 */

/** Why the projection gave a frame back to the authored scene, or declined an object. */
export type ProjectionReasonCode =
  | "projected"
  | "belowMeshFloor"
  | "renderHook"
  | "unsupportedLight"
  | "unsupportedObject"
  | "notWorthwhile"
  | "disabled";

export type ProjectionExactReason =
  | "instanced"
  | "skinned"
  | "morph"
  | "multiMaterial"
  | "drawRange"
  | "indirect"
  | "customDepthMaterial"
  | "lod"
  | "sprite"
  | "points"
  | "transparent"
  | "renderOrder"
  | "tooFewToBatch"
  | "batchOverflow"
  | "batchVelocityPatchMissing"
  | "negativeScale"
  | "unsupportedGeometry";

export interface IRenderProjectionReport {
  readonly schemaVersion: 1;
  /** True while the renderer is being handed the mirror rather than the authored scene. */
  readonly projecting: boolean;
  readonly reasonCode: ProjectionReasonCode;
  readonly reason?: string;
  /** Renderables the authored scene holds — what an unoptimized frame would walk and draw. */
  readonly sourceRenderables: number;
  /**
   * Objects the renderer will actually walk, counted from the scene it is handed rather than from
   * what this class believes it built. A count taken from intent rather than from the renderer's
   * input is how an optimizer reports a win it did not deliver.
   */
  readonly resultDrawCandidates: number;
  /** Sources folded into batched draws, and the number of draws they became. */
  readonly projectedObjects: number;
  readonly batches: number;
  /** The batch split by lane, so a report reader can tell which grouping did the folding. */
  readonly instancedBatches: number;
  readonly materialBatches: number;
  /** Sources that kept a draw of their own, with the reason each one did. */
  readonly exactObjects: number;
  readonly exact: Partial<Record<ProjectionExactReason, number>>;
  /**
   * What the plan believes this frame costs: one draw per batch plus one per exact-lane object.
   *
   * **A plan, not a measurement.** On WebGPU a `BatchedMesh` is one render object that issues one
   * `drawIndexed` per visible member, so a batch is not reliably one draw and this number can be
   * optimistic. The measured count comes from the renderer and is reported beside this one; a
   * divergence between them is a finding, not a rounding error.
   */
  readonly drawsPlanned: number;
  readonly timings: {
    readonly compileMs: number;
    readonly reconcileMs: number;
    readonly lastReconcileMs: number;
    readonly maxReconcileMs: number;
  };
}

export interface IRenderProjectionOptions {
  /**
   * Below this many eligible meshes the mirror costs more to maintain than the draws it saves, so
   * the authored scene is rendered directly and nothing is built.
   */
  readonly minMeshes?: number;
  /**
   * Whether the projection may run at all. Defaults true, the shipping behaviour; `false` is the
   * game's named opt-out. An opted-out projection builds no mirror and runs no eligibility scan —
   * the authored scene is handed to the renderer every frame — so declining costs nothing rather
   * than being re-judged each frame. The verdict is reported as `disabled`, not as one of the
   * measured declines.
   */
  readonly enabled?: boolean;
  /** Allocates per-sub-draw previous matrices for the material-batching lane. */
  readonly velocity?: boolean | (() => boolean);
  /**
   * The engine's world-matrix walk, when the frame owns one. The authored scene is refreshed here
   * rather than by three's renderer, because the renderer is handed the mirror: without this the
   * authored scene would never be walked and every proxy would be one frame stale.
   */
  readonly matrixWorld?: MatrixWorldPass;
  readonly onReport?: (report: IRenderProjectionReport) => void;
}

export { exactLaneReason } from "./projection-plan.js";

/**
 * How many settled-declined frames pass between classification re-walks.
 *
 * Growth past the mesh floor is noticed within this window; a scene that never changes pays one
 * walk per window instead of one per frame. Sub-second at frame rate, and invisible — the
 * alternative state it delays is "the optimizer has not engaged yet", not a wrong frame.
 */
const DECLINE_RESCAN_FRAMES = 60;

export class SceneRenderProjection {
  readonly #source: Scene;
  readonly #minMeshes: number;
  readonly #enabled: boolean;
  readonly #onReport: ((report: IRenderProjectionReport) => void) | undefined;
  /** Absent when the game opted out: an opted-out projection never builds one. */
  readonly #mirror: ProjectionMirror | undefined;
  readonly #velocity: boolean | (() => boolean);
  readonly #matrixWorld: MatrixWorldPass | undefined;
  readonly #velocityTracker = new VelocityTracker();
  readonly #scanWorkspace = createProjectionScanWorkspace();
  #deoptimized = true;
  #reasonCode: ProjectionReasonCode = "belowMeshFloor";
  #reason: string | undefined;
  #sourceRenderables = 0;
  #reconcileMs = 0;
  #lastReconcileMs = 0;
  #maxReconcileMs = 0;
  #reported = false;
  #lastAnnounced: ProjectionReasonCode | undefined;
  #framesSinceDeclineScan = DECLINE_RESCAN_FRAMES;
  #velocityActive: boolean;

  constructor(source: Scene, options: IRenderProjectionOptions = {}) {
    const minMeshes = options.minMeshes ?? 200;
    if (!Number.isInteger(minMeshes) || minMeshes < 1)
      throw new Error("SceneRenderProjection.minMeshes must be a positive integer.");
    this.#source = source;
    this.#minMeshes = minMeshes;
    this.#enabled = options.enabled ?? true;
    this.#velocity = options.velocity ?? false;
    this.#velocityActive = resolveVelocityEnabled(this.#velocity);
    this.#matrixWorld = options.matrixWorld;
    this.#mirror = this.#enabled ? new ProjectionMirror(this.#velocityActive) : undefined;
    this.#onReport = options.onReport;
  }

  /** True while the renderer is being handed the authored scene rather than the mirror. */
  get deoptimized(): boolean {
    return this.#deoptimized;
  }

  /**
   * The scene to draw this frame — the mirror when it is faithful, the authored scene when it is
   * not. Callers render whatever this returns and never branch on which one it was.
   */
  /**
   * Who owns each object the renderer is handed, for a per-object diagnostic. Empty when the
   * mirror is off or deoptimized — the authored scene is then what rendered, and every object
   * already is its own source. Built on demand and retained by nobody.
   */
  describeOwnership(): ReadonlyMap<Object3D, IGeometryOwnership> {
    if (this.#deoptimized || this.#mirror === undefined) return new Map();
    return this.#mirror.describeOwnership();
  }

  get root(): Scene {
    if (this.#deoptimized || this.#mirror === undefined) return this.#source;
    return this.#mirror.scene;
  }

  /**
   * Brings the mirror up to date with the authored scene, and must run before the frame draws.
   *
   * Everything the mirror asserts about a source is re-derived here rather than remembered from
   * startup: where it is, whether it is visible, what geometry and material it has, and whether it
   * is still in the scene at all. A source that did not change costs a compare.
   *
   * A settled decline costs almost nothing: the classification walk re-runs on a bounded cadence
   * rather than every frame, and the whole-scene matrix pass does not run at all — the frames the
   * authored scene draws are exactly the frames three's renderer refreshes its world matrices
   * anyway. The pass stays mandatory on any frame this class projects, because then the authored
   * scene is not what renders and nothing else refreshes it.
   */
  reconcile(): void {
    if (!this.#enabled) {
      // The game declined the projection: report the verdict once, then do nothing at all. No
      // mirror is built, no eligibility scan runs, and `root` is the authored scene — the opt-out
      // costs a compare, not a re-judged decline.
      this.#deoptimize("disabled", "the game set renderer.projection to false");
      this.#publish();
      return;
    }
    const mirror = this.#mirror;
    if (mirror === undefined) return;
    const startedAt = globalThis.performance?.now() ?? 0;
    const velocityEnabled = resolveVelocityEnabled(this.#velocity);
    if (this.#velocityActive !== velocityEnabled) {
      this.#velocityTracker.clear();
      this.#velocityActive = velocityEnabled;
    }
    if (mirror.setVelocityEnabled(velocityEnabled)) {
      this.#deoptimized = true;
      this.#framesSinceDeclineScan = DECLINE_RESCAN_FRAMES;
    }
    // Re-read every frame, not once at construction: a game that swaps its sky or turns fog on
    // mid-level would otherwise keep the look it happened to have when the mirror was built.
    const mirrorScene = mirror.scene;
    mirrorScene.background = this.#source.background;
    mirrorScene.environment = this.#source.environment;
    mirrorScene.fog = this.#source.fog;
    mirrorScene.backgroundBlurriness = this.#source.backgroundBlurriness;
    mirrorScene.backgroundIntensity = this.#source.backgroundIntensity;
    mirrorScene.environmentIntensity = this.#source.environmentIntensity;
    mirrorScene.overrideMaterial = this.#source.overrideMaterial;
    // A fresh `Scene` defaults both rotations to zero, so a game that turns its sky or its
    // environment lighting had that yaw snap back to zero the moment the mirror drew it — a
    // whole-image change with no frame where the game did anything. Copy value and order, into the
    // mirror's own Euler, so the source the game still mutates is never aliased.
    mirrorScene.backgroundRotation.copy(this.#source.backgroundRotation);
    mirrorScene.environmentRotation.copy(this.#source.environmentRotation);

    // A settled decline re-judges on a cadence, not per frame: most agent-built scenes sit below
    // the floor forever, and re-walking one every frame bought nothing. The counter starts at the
    // interval so the first reconcile always scans, and a deoptimization resets it.
    if (this.#deoptimized) {
      this.#framesSinceDeclineScan += 1;
      if (this.#framesSinceDeclineScan < DECLINE_RESCAN_FRAMES) {
        if (velocityEnabled) this.#velocityTracker.update(this.#source);
        return;
      }
    }

    // Scan and decide without touching the mirror; then either build the plan or decline whole.
    // The scan reads no world matrices, so it runs before the forced pass and the pass only runs
    // when its result is actually needed.
    try {
      const scan = scanProjection(this.#source, this.#minMeshes, this.#scanWorkspace);
      this.#sourceRenderables = scan.renderables;
      this.#framesSinceDeclineScan = 0;
      if (scan.plan.action === "decline") {
        mirror.releaseAll();
        this.#deoptimize(scan.plan.reasonCode, scan.plan.reason);
      } else {
        // The renderer is handed the mirror, so the authored scene's world matrices are refreshed
        // here. With the engine's walk installed that is the visible-only pass, which mirrors three
        // for every visible node and defers a hidden subtree until it shows; without it, honouring
        // `matrixWorldAutoUpdate` and Three's own `matrixWorldNeedsUpdate` propagation is the
        // contract every Three renderer uses. A game that turns the flag off has promised to update
        // the scene itself, and a subtree marked `matrixWorldAutoUpdate = false` under a still
        // parent is skipped instead of walked.
        if (this.#matrixWorld !== undefined) {
          this.#matrixWorld.apply(this.#source);
        } else if (this.#source.matrixWorldAutoUpdate === true) {
          this.#source.updateMatrixWorld();
        }
        mirror.prepare(scan.exactLane, scan.exactLaneCount);
        const lightFailure = mirror.apply(scan.plan);
        if (lightFailure !== undefined) {
          this.#deoptimize("unsupportedLight", lightFailure);
        } else {
          this.#deoptimized = false;
          this.#reasonCode = "projected";
          this.#reason = undefined;
        }
      }
    } finally {
      releaseProjectionScanWorkspace(this.#scanWorkspace);
    }

    if (velocityEnabled)
      this.#velocityTracker.update(this.#deoptimized ? this.#source : mirror.scene);
    else this.#velocityTracker.clear();

    const elapsed = (globalThis.performance?.now() ?? 0) - startedAt;
    this.#reconcileMs += elapsed;
    this.#lastReconcileMs = elapsed;
    this.#maxReconcileMs = Math.max(this.#maxReconcileMs, elapsed);
    this.#publish();
  }

  /** Commits the rendered transform snapshot after the colour and velocity passes consume it. */
  commit(): void {
    if (!this.#enabled || !this.#velocityActive) return;
    this.#velocityTracker.commit(this.root);
  }

  #publish(): void {
    // Re-announced when the verdict changes. A scene that projects at startup and gives up ten
    // minutes later has changed the thing worth knowing, and reporting only the first frame hides
    // exactly the transition a player would notice.
    if (this.#lastAnnounced !== this.#reasonCode) {
      this.#lastAnnounced = this.#reasonCode;
      this.#reported = false;
    }
    if (this.#reported) return;
    if (this.#onReport === undefined) {
      // Reported by default, exactly as the pass this replaced did, and for the reason that pass
      // did it: an optimizer that decides silently is one nobody can debug. The frame rate is
      // simply bad, or the screen is simply black, and the reason never leaves the process. A game
      // that had already merged its own scene was re-expanded into a thousand single-member draws
      // and stalled on its loading screen; the first person to know was the person holding the
      // phone, which is the wrong person.
      this.#reported = true;
      const r = this.report;
      console.info(
        `TN_RENDER_PROJECTION:${JSON.stringify({
          projecting: r.projecting,
          reasonCode: r.reasonCode,
          ...(r.reason === undefined ? {} : { reason: r.reason }),
          sourceRenderables: r.sourceRenderables,
          resultDrawCandidates: r.resultDrawCandidates,
          batches: r.batches,
          instancedBatches: r.instancedBatches,
          materialBatches: r.materialBatches,
          projectedObjects: r.projectedObjects,
          exactObjects: r.exactObjects,
          exact: r.exact,
        })}`,
      );
      return;
    }
    // Reported once the verdict is first reached, so a game waiting on startup is not woken by a
    // frame counter. Deoptimization after that is visible through `report`, which is live.
    this.#reported = true;
    this.#onReport(this.report);
  }

  get report(): IRenderProjectionReport {
    const exact: Partial<Record<ProjectionExactReason, number>> = {};
    for (const [reason, count] of this.#mirror?.exactCounts ?? []) exact[reason] = count;
    let resultDrawCandidates = 0;
    // Counted from the scene the renderer is actually handed. Anything else is this class marking
    // its own homework.
    this.root.traverse((object) => {
      if (isRenderable(object)) resultDrawCandidates += 1;
    });
    const batches = this.#deoptimized ? 0 : (this.#mirror?.batchCount ?? 0);
    const exactObjects = this.#deoptimized ? 0 : (this.#mirror?.proxyCount ?? 0);
    return {
      schemaVersion: 1,
      projecting: !this.#deoptimized,
      reasonCode: this.#reasonCode,
      ...(this.#reason === undefined ? {} : { reason: this.#reason }),
      sourceRenderables: this.#sourceRenderables,
      resultDrawCandidates,
      projectedObjects: this.#deoptimized ? 0 : (this.#mirror?.projectedObjects ?? 0),
      batches,
      instancedBatches: this.#deoptimized ? 0 : (this.#mirror?.instancedBatchCount ?? 0),
      materialBatches: this.#deoptimized ? 0 : (this.#mirror?.materialBatchCount ?? 0),
      exactObjects,
      // A declined frame renders the authored scene, so its plan is one draw per authored
      // renderable — the number the projection is trying to beat, not zero.
      drawsPlanned: this.#deoptimized ? this.#sourceRenderables : batches + exactObjects,
      exact,
      timings: {
        compileMs: this.#mirror?.compileMs ?? 0,
        reconcileMs: this.#reconcileMs,
        lastReconcileMs: this.#lastReconcileMs,
        maxReconcileMs: this.#maxReconcileMs,
      },
    };
  }

  /**
   * What the mirror currently holds for one source object, or `undefined` if it holds nothing.
   *
   * Bounded diagnostics, for the load test and the unit tests: it answers "is this object being
   * drawn, on which lane, and with what transform and visibility" without exposing the batches or
   * the reconciliation state. Games never call this — there is no optimizer API in generated
   * source, and this class is not part of the package's public surface — but a benchmark that
   * cannot ask what the renderer was given can only report intent, and intent is not evidence.
   */
  inspect(
    object: Object3D,
  ): { lane: "batched" | "exact"; matrixWorld: Matrix4; visible: boolean } | undefined {
    return this.#mirror?.inspect(object);
  }

  /** True when some batch in the mirror draws with this exact material instance. */
  drawsWith(material: Material): boolean {
    return this.#mirror?.drawsWith(material) ?? false;
  }

  /** Hands this frame back to the authored scene, naming why. */
  #deoptimize(reasonCode: ProjectionReasonCode, reason: string): void {
    this.#deoptimized = true;
    this.#reasonCode = reasonCode;
    this.#reason = reason;
  }

  /**
   * Releases everything the mirror owns.
   *
   * Only the batches are disposed. Every geometry and material in here came from the game and is
   * still the game's — disposing those would take a scene change down with it.
   */
  dispose(): void {
    this.#mirror?.releaseAll();
    this.#velocityTracker.clear();
    this.#deoptimized = true;
    this.#reasonCode = "belowMeshFloor";
    this.#reason = "the projection was disposed";
    this.#reported = false;
    this.#framesSinceDeclineScan = DECLINE_RESCAN_FRAMES;
  }
}

export type ProjectionCamera = Camera;

function resolveVelocityEnabled(value: boolean | (() => boolean)): boolean {
  const enabled = typeof value === "function" ? value() : value;
  if (typeof enabled !== "boolean")
    throw new Error(
      `SceneRenderProjection.velocity must resolve to a boolean, received ${String(enabled)}.`,
    );
  return enabled;
}
