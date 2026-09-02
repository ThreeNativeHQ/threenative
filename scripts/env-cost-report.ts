/**
 * The arithmetic behind `scripts/env-cost-probe.ts`, separated so it can be tested without a GPU.
 *
 * Every function here fails closed. The probe answers a question — *can baking the environment
 * prefilter win frame time?* — whose wrong answer is expensive: PRD-307 proposed a whole build-time
 * pass on the strength of it. A silently-empty arm, or a difference reported out of the noise, is
 * how that answer goes wrong, so both are errors rather than defaults.
 */

/** One parsed `TN_FRAME_BUDGET` window. */
export interface IFrameWindow {
  readonly gpuMs: number;
  readonly fps: number;
}

/** One arm's steady-window `gpuMs` sample. */
export interface IArmSample {
  readonly label: string;
  readonly gpuMs: readonly number[];
}

/** What the five arms together do and do not establish. */
export interface IEnvironmentSummary {
  /** The smallest difference this run may honestly claim, in ms. */
  readonly floor: number;
  /** Whether `none` did read at or below `static`, as strictly-less-work requires. */
  readonly controlHeld: boolean;
  /** `dirty/1 - static`: what re-prefiltering every frame costs. Undefined if under the floor. */
  readonly prefilterPerFrame: number | undefined;
  /** `static - none`: per-fragment sampling, which baking cannot win. Undefined if under the floor. */
  readonly samplingPerFrame: number | undefined;
}

const MARKER = "TN_FRAME_BUDGET:";

/**
 * Parse the frame-budget markers out of a page's console lines and drop the first window.
 *
 * Window 1 covers startup — shader compilation, first-use pipeline creation, texture upload — and
 * always lies; the playtest `perf` reader discards it for the same reason. An arm left with nothing
 * after that discard is **unmeasured**, and an unmeasured arm throws rather than returning `[]`,
 * because an empty array flows downstream as a zero difference and reads as "no effect".
 */
export function steadyWindows(lines: readonly string[]): readonly IFrameWindow[] {
  const parsed: IFrameWindow[] = [];
  for (const line of lines) {
    const at = line.indexOf(MARKER);
    if (at === -1) continue;
    const payload = line.slice(at + MARKER.length);
    let window: { gpuMs?: unknown; fps?: unknown };
    try {
      window = JSON.parse(payload) as { gpuMs?: unknown; fps?: unknown };
    } catch {
      throw new Error(`A ${MARKER} line could not be parsed as JSON: ${payload}`);
    }
    if (typeof window.gpuMs !== "number") {
      throw new Error(
        `A ${MARKER} window reported no numeric gpuMs: ${payload}. The meter is not running; an unmeasured window is never a zero one.`,
      );
    }
    parsed.push({
      fps: typeof window.fps === "number" ? window.fps : Number.NaN,
      gpuMs: window.gpuMs,
    });
  }
  const steady = parsed.slice(1);
  if (steady.length === 0) {
    throw new Error(
      `No steady ${MARKER} window: ${parsed.length} window(s) seen, and window 1 is discarded as startup. The arm did not run long enough, or the page never rendered.`,
    );
  }
  return steady;
}

/** Read a quantile from an already-sorted sample, clamped to the last element. */
export function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) throw new Error("Quantile of an empty sample.");
  const value = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  if (value === undefined) throw new Error("Quantile of an empty sample.");
  return value;
}

/**
 * The noise floor, in ms, from the run's own negative control.
 *
 * `none` (no environment at all) does strictly less GPU work than `static` (environment set once),
 * so `none <= static` must hold. Any amount by which `none` reads *higher* is measurement noise
 * this run demonstrably contains, and nothing smaller may be claimed as a difference. A control
 * that holds yields a floor of zero — which is a claim about this run, not about the meter.
 */
export function noiseFloor(staticMedian: number, noneMedian: number): number {
  return Math.max(0, noneMedian - staticMedian);
}

/** A difference, or `undefined` when it is not larger than the floor. */
export function resolveDelta(delta: number, floor: number): number | undefined {
  return Math.abs(delta) > floor ? delta : undefined;
}

/** Reduce the arms to what they establish, refusing to conclude from an arm that never reported. */
export function summarise(arms: readonly IArmSample[]): IEnvironmentSummary {
  const median = (label: string): number => {
    const arm = arms.find((candidate) => candidate.label === label);
    if (arm === undefined) {
      throw new Error(`Arm ${label} never reported; the summary depends on it and will not guess.`);
    }
    return quantile(
      [...arm.gpuMs].sort((a, b) => a - b),
      0.5,
    );
  };
  const staticMedian = median("static");
  const noneMedian = median("none");
  const floor = noiseFloor(staticMedian, noneMedian);
  return {
    controlHeld: noneMedian <= staticMedian,
    floor,
    prefilterPerFrame: resolveDelta(median("dirty/1") - staticMedian, floor),
    samplingPerFrame: resolveDelta(staticMedian - noneMedian, floor),
  };
}
