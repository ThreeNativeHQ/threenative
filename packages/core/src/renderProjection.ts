import type { Camera, Material, Matrix4, Object3D, Scene } from "three";

import { ProjectionMirror } from "./projection-apply.js";
import { isRenderable, scanProjection } from "./projection-plan.js";

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
  | "notWorthwhile";

export type ProjectionExactReason =
  | "instanced"
  | "skinned"
  | "morph"
  | "multiMaterial"
  | "drawRange"
  | "customDepthMaterial"
  | "lod"
  | "sprite"
  | "points"
  | "transparent"
  | "renderOrder"
  | "tooFewToBatch"
  | "batchOverflow"
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
  /** Sources that kept a draw of their own, with the reason each one did. */
  readonly exactObjects: number;
  readonly exact: Partial<Record<ProjectionExactReason, number>>;
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
  readonly onReport?: (report: IRenderProjectionReport) => void;
}

export { exactLaneReason } from "./projection-plan.js";

export class SceneRenderProjection {
  readonly #source: Scene;
  readonly #minMeshes: number;
  readonly #onReport: ((report: IRenderProjectionReport) => void) | undefined;
  readonly #mirror = new ProjectionMirror();
  #deoptimized = true;
  #reasonCode: ProjectionReasonCode = "belowMeshFloor";
  #reason: string | undefined;
  #sourceRenderables = 0;
  #reconcileMs = 0;
  #lastReconcileMs = 0;
  #maxReconcileMs = 0;
  #reported = false;
  #lastAnnounced: ProjectionReasonCode | undefined;

  constructor(source: Scene, options: IRenderProjectionOptions = {}) {
    const minMeshes = options.minMeshes ?? 200;
    if (!Number.isInteger(minMeshes) || minMeshes < 1)
      throw new Error("SceneRenderProjection.minMeshes must be a positive integer.");
    this.#source = source;
    this.#minMeshes = minMeshes;
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
  get root(): Scene {
    return this.#deoptimized ? this.#source : this.#mirror.scene;
  }

  /**
   * Brings the mirror up to date with the authored scene, and must run before the frame draws.
   *
   * Everything the mirror asserts about a source is re-derived here rather than remembered from
   * startup: where it is, whether it is visible, what geometry and material it has, and whether it
   * is still in the scene at all. A source that did not change costs a compare.
   */
  reconcile(): void {
    const startedAt = globalThis.performance?.now() ?? 0;
    // The authored scene is not what the renderer is given, so nothing else refreshes its world
    // matrices. Every world transform the mirror copies is read after this call.
    this.#source.updateMatrixWorld(true);
    // Re-read every frame, not once at construction: a game that swaps its sky or turns fog on
    // mid-level would otherwise keep the look it happened to have when the mirror was built.
    const mirrorScene = this.#mirror.scene;
    mirrorScene.background = this.#source.background;
    mirrorScene.environment = this.#source.environment;
    mirrorScene.fog = this.#source.fog;
    mirrorScene.backgroundBlurriness = this.#source.backgroundBlurriness;
    mirrorScene.backgroundIntensity = this.#source.backgroundIntensity;
    mirrorScene.environmentIntensity = this.#source.environmentIntensity;
    mirrorScene.overrideMaterial = this.#source.overrideMaterial;

    // Scan and decide without touching the mirror; then either build the plan or decline whole.
    const scan = scanProjection(this.#source, this.#minMeshes);
    this.#sourceRenderables = scan.renderables;
    this.#mirror.prepare(scan.exactEntries);
    if (scan.plan.action === "decline") {
      this.#mirror.releaseAll();
      this.#deoptimize(scan.plan.reasonCode, scan.plan.reason);
    } else {
      const lightFailure = this.#mirror.apply(scan.plan);
      if (lightFailure !== undefined) {
        this.#deoptimize("unsupportedLight", lightFailure);
      } else {
        this.#deoptimized = false;
        this.#reasonCode = "projected";
        this.#reason = undefined;
      }
    }

    const elapsed = (globalThis.performance?.now() ?? 0) - startedAt;
    this.#reconcileMs += elapsed;
    this.#lastReconcileMs = elapsed;
    this.#maxReconcileMs = Math.max(this.#maxReconcileMs, elapsed);
    this.#publish();
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
    for (const [reason, count] of this.#mirror.exactCounts) exact[reason] = count;
    let resultDrawCandidates = 0;
    // Counted from the scene the renderer is actually handed. Anything else is this class marking
    // its own homework.
    this.root.traverse((object) => {
      if (isRenderable(object)) resultDrawCandidates += 1;
    });
    return {
      schemaVersion: 1,
      projecting: !this.#deoptimized,
      reasonCode: this.#reasonCode,
      ...(this.#reason === undefined ? {} : { reason: this.#reason }),
      sourceRenderables: this.#sourceRenderables,
      resultDrawCandidates,
      projectedObjects: this.#deoptimized ? 0 : this.#mirror.projectedObjects,
      batches: this.#deoptimized ? 0 : this.#mirror.batchCount,
      exactObjects: this.#deoptimized ? 0 : this.#mirror.proxyCount,
      exact,
      timings: {
        compileMs: this.#mirror.compileMs,
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
    return this.#mirror.inspect(object);
  }

  /** True when some batch in the mirror draws with this exact material instance. */
  drawsWith(material: Material): boolean {
    return this.#mirror.drawsWith(material);
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
    this.#mirror.releaseAll();
    this.#deoptimized = true;
    this.#reasonCode = "belowMeshFloor";
    this.#reason = "the projection was disposed";
    this.#reported = false;
  }
}

export type ProjectionCamera = Camera;
