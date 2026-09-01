import type { IRenderProjectionReport, ProjectionExactReason } from "./renderProjection.js";

/**
 * The per-window projection line.
 *
 * `TN_RENDER_PROJECTION` announces the verdict once, when it is first reached — the right shape
 * for "did the optimizer engage", and the wrong one for "what is it still leaving on the table
 * while the game runs". This marker is emitted on every frame-budget window instead, so a run
 * produces a series rather than a single sentence, and it carries the one thing the projection
 * cannot know on its own: how many draws the renderer was actually handed.
 */
export const PROJECTION_MARKER = "TN_PROJECTION";

export interface IProjectionWindowJson {
  /** Draw calls the renderer counted for the world pass, or absent when nothing measured them. */
  readonly drawsActual?: number;
  /** One per batch plus one per exact-lane object; the plan, which WebGPU need not honour. */
  readonly drawsPlanned: number;
  readonly exact: Partial<Record<ProjectionExactReason, number>>;
  readonly exactObjects: number;
  readonly projecting: boolean;
  readonly reason?: string;
  readonly reasonCode: string;
  readonly sourceRenderables: number;
  readonly window: number;
}

/**
 * Orders the exact lane by how many draws each reason costs.
 *
 * This is the whole point of the marker: the next thing worth folding is whichever reason is at
 * the top of this list in a game that is actually slow, and picking it any other way is picking it
 * by intuition — which has been wrong twice here.
 */
export function rankExactReasons(
  exact: Partial<Record<ProjectionExactReason, number>>,
): { count: number; reason: string }[] {
  return Object.entries(exact)
    .filter(([, count]) => typeof count === "number" && count > 0)
    .map(([reason, count]) => ({ count: count as number, reason }))
    .sort((left, right) => right.count - left.count || (left.reason < right.reason ? -1 : 1));
}

/**
 * Builds the line. Emitted on a declined frame too, with its reason code — a decline is the most
 * useful line in the log, and suppressing it is how "it did nothing" gets read as "it had nothing
 * to do".
 */
export function formatProjectionWindow(
  report: IRenderProjectionReport,
  window: number,
  drawsActual: number | undefined,
): string {
  const payload: IProjectionWindowJson = {
    ...(drawsActual === undefined ? {} : { drawsActual }),
    drawsPlanned: report.drawsPlanned,
    exact: report.exact,
    exactObjects: report.exactObjects,
    projecting: report.projecting,
    ...(report.reason === undefined ? {} : { reason: report.reason }),
    reasonCode: report.reasonCode,
    sourceRenderables: report.sourceRenderables,
    window,
  };
  return `${PROJECTION_MARKER}:${JSON.stringify(payload)}`;
}
