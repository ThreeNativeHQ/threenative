/**
 * Per-presented-frame cost attribution, on by default, for every platform.
 *
 * A device once read 18.3 fps with nothing in the repository able to say where the frame went;
 * the answer took a hand-written 468-line probe that monkey-patched `requestAnimationFrame` and
 * `renderer.render` from inside the game. That probe had to guess the phase boundaries because it
 * lived outside the loop. This lives inside the loop, so it knows them: the framework owns the
 * simulation/render split, the render call and the frame's start and end, and no game should ever
 * write this again.
 *
 * Two consumers, one measurement:
 *
 *  - a windowed `TN_FRAME_BUDGET` marker line, printed periodically on stdout (and therefore in
 *    logcat on Android), so a cold agent reading standard device-lane output sees the attribution
 *    without instrumenting anything;
 *  - a per-frame sample carried into the playtest render series, so `assert.performance` can bound
 *    an fps floor and a per-phase ceiling and a mobile regression is a red gate rather than a vibe.
 *
 * Fail closed: malformed options throw at construction rather than silently disabling the budget,
 * and a phase that was never measured reports zero samples so a consumer asserting on it fails
 * instead of skipping.
 */

/** Marker printed once per report window. */
export const FRAME_BUDGET_MARKER = "TN_FRAME_BUDGET";
/** Marker printed the moment a gap between presented frames exceeds `hitchMs`. */
export const FRAME_HITCH_MARKER = "TN_FRAME_HITCH";

/**
 * The named parts of one presented frame. They partition the frame: `hostGap` is the time before
 * the callback (present wait plus whatever the host did between callbacks), and `update`,
 * `render`, `overlay` and `residual` sum to the callback's own duration.
 */
export const FRAME_BUDGET_PHASES = ["hostGap", "update", "render", "overlay", "residual"] as const;

export type FrameBudgetPhase = (typeof FRAME_BUDGET_PHASES)[number];

/** One frame's cost, split by phase. Every field is milliseconds. */
export interface IFramePhaseSample {
  readonly hostGap: number;
  readonly update: number;
  readonly render: number;
  readonly overlay: number;
  readonly residual: number;
}

/**
 * What the frame the window measured was actually drawn at.
 *
 * A resolution number without its sample count does not describe an image, and neither of them
 * describes anything at all unless the window that carries the fps also carries them. This is
 * reported whether the scale was pinned by the game or chosen by the engine: turning the
 * convention off does not turn its measurement off.
 */
export interface IFrameSurfaceState {
  /** The applied drawing-buffer scale, in `(0, 1]`. */
  readonly resolutionScale: number;
  /** `"pinned"` when the game fixed the number, `"auto"` when the engine chose it. */
  readonly scaleSource: "pinned" | "auto";
  /** Multisample count of the 3D drawing buffer; 1 when sampling is off. */
  readonly sampleCount: number;
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;
}

const SCALE_SOURCES: readonly IFrameSurfaceState["scaleSource"][] = ["pinned", "auto"];

/** Fail closed: a surface that cannot describe an image is never reported as one. */
function requireSurface(surface: IFrameSurfaceState): IFrameSurfaceState {
  const { drawingBufferHeight, drawingBufferWidth, resolutionScale, sampleCount, scaleSource } =
    surface;
  if (!Number.isFinite(resolutionScale) || resolutionScale <= 0 || resolutionScale > 1)
    throw new Error(
      `Frame budget surface resolutionScale must be within (0, 1], received ${String(resolutionScale)}.`,
    );
  if (!SCALE_SOURCES.includes(scaleSource))
    throw new Error(
      `Frame budget surface scaleSource must name how the scale was chosen, received ${String(scaleSource)}.`,
    );
  if (!Number.isInteger(sampleCount) || sampleCount < 1)
    throw new Error(
      `Frame budget surface sampleCount must be an integer of at least one, received ${String(sampleCount)}.`,
    );
  for (const [name, value] of [
    ["drawingBufferWidth", drawingBufferWidth],
    ["drawingBufferHeight", drawingBufferHeight],
  ] as const) {
    if (!Number.isInteger(value) || value < 1)
      throw new Error(
        `Frame budget surface ${name} must be an integer of at least one, received ${String(value)}.`,
      );
  }
  return { drawingBufferHeight, drawingBufferWidth, resolutionScale, sampleCount, scaleSource };
}

export interface IFrameBudgetSummary {
  readonly samples: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export interface IFrameBudgetWindow {
  /** 1 for the first reported window, incrementing thereafter. */
  readonly window: number;
  /** Presented frames counted in this window, hitches excluded. */
  readonly frames: number;
  /** Frames excluded from the window because their present gap exceeded `hitchMs`. */
  readonly hitches: number;
  /** Derived from the mean presented interval: the number a player would read off a counter. */
  readonly fps: number;
  /** Interval between presented frames — the honest frame period. */
  readonly presented: IFrameBudgetSummary;
  /** Duration of the frame callback itself, entry to exit. */
  readonly frame: IFrameBudgetSummary;
  /** Fixed simulation steps executed in the callback. */
  readonly substeps: IFrameBudgetSummary;
  readonly phases: Readonly<Record<FrameBudgetPhase, IFrameBudgetSummary>>;
  /** Each phase's mean as a fraction of the mean presented interval. */
  readonly shares: Readonly<Record<FrameBudgetPhase, number>>;
  /**
   * The resolution and sampling this window's frames were drawn at, when the loop reported one.
   * Absent rather than defaulted: a consumer asserting on it must fail loudly instead of reading
   * a fabricated `1.0` that no frame was ever drawn at.
   */
  readonly surface?: IFrameSurfaceState;
}

export interface IFrameBudgetOptions {
  /** Presented frames per report window. Default 300. */
  readonly reportEvery?: number;
  /** A present gap at or above this is a hitch, not a frame. Default 2000 ms. */
  readonly hitchMs?: number;
  /** Ring capacity per series. Default 1024. */
  readonly capacity?: number;
  /** Where marker lines go. Default `console.log`. */
  readonly report?: (line: string) => void;
  /** Wall clock for hitch markers. Default `Date.now`. */
  readonly wallClock?: () => number;
  /**
   * Called with each completed window, after its marker line. A HUD reads it to show the split
   * on screen; a measurement run reads it to advance in lockstep with the instrument instead of
   * guessing when a window closed.
   */
  readonly onWindow?: (window: IFrameBudgetWindow) => void;
  /**
   * Reads what the frames were drawn at, called once per reported window. Wired by the frame
   * loop, which is the only place that knows both the renderer and the window boundary.
   */
  readonly readSurface?: () => IFrameSurfaceState;
}

const DEFAULT_REPORT_EVERY = 300;
const DEFAULT_HITCH_MS = 2_000;
const DEFAULT_CAPACITY = 1_024;

function requirePositiveInteger(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1)
    throw new Error(
      `Frame budget ${name} must be an integer of at least one, received ${String(value)}.`,
    );
  return value;
}

function requirePositiveNumber(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(
      `Frame budget ${name} must be a finite number greater than zero, received ${String(value)}.`,
    );
  return value;
}

/** A fixed-capacity ring of milliseconds. Never allocates after construction. */
class Ring {
  readonly #buffer: Float64Array;
  #count = 0;
  #cursor = 0;
  #total = 0;

  constructor(capacity: number) {
    this.#buffer = new Float64Array(capacity);
  }

  push(value: number): void {
    // A non-finite sample means a clock the host did not deliver; dropping it silently would
    // manufacture a clean percentile out of a broken measurement.
    if (!Number.isFinite(value))
      throw new Error(`Frame budget received a non-finite sample: ${String(value)}.`);
    const capacity = this.#buffer.length;
    const index = this.#cursor % capacity;
    if (this.#count === capacity) this.#total -= this.#buffer[index] ?? 0;
    this.#buffer[index] = value;
    this.#total += value;
    this.#cursor += 1;
    if (this.#count < capacity) this.#count += 1;
  }

  reset(): void {
    this.#count = 0;
    this.#cursor = 0;
    this.#total = 0;
  }

  summarize(scratch: Float64Array): IFrameBudgetSummary {
    const count = this.#count;
    if (count === 0) return { max: 0, mean: 0, p50: 0, p95: 0, p99: 0, samples: 0 };
    for (let index = 0; index < count; index += 1) scratch[index] = this.#buffer[index] ?? 0;
    const view = scratch.subarray(0, count);
    view.sort();
    const rank = (fraction: number): number =>
      round(view[Math.min(count - 1, Math.ceil(fraction * count) - 1)] ?? 0);
    return {
      max: round(view[count - 1] ?? 0),
      mean: round(this.#total / count),
      p50: rank(0.5),
      p95: rank(0.95),
      p99: rank(0.99),
      samples: count,
    };
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Accumulates one frame at a time and reports windowed attribution.
 *
 * The caller is the frame loop; the sequence per frame is
 * `beginFrame` → `markSimulationEnd` → (`addRender` / `addOverlay`) → `endFrame`.
 * Calling them out of order throws rather than producing a plausible-looking split.
 */
export class FrameBudget {
  readonly reportEvery: number;
  readonly hitchMs: number;
  #report: (line: string) => void;
  #wallClock: () => number;
  #onWindow: ((window: IFrameBudgetWindow) => void) | undefined;
  #readSurface: (() => IFrameSurfaceState) | undefined;
  #scratch: Float64Array;
  #presented: Ring;
  #frame: Ring;
  #substeps: Ring;
  #phaseRings: Record<FrameBudgetPhase, Ring>;
  #open = false;
  #frameStart = 0;
  #simulationEnd: number | undefined;
  #renderMs = 0;
  #overlayMs = 0;
  #substepCount = 0;
  #hostGap = 0;
  #presentedDelta = 0;
  #lastTimestamp: number | undefined;
  #lastFrameEnd: number | undefined;
  #framesInWindow = 0;
  #hitchesInWindow = 0;
  #windowIndex = 0;

  constructor(options: IFrameBudgetOptions = {}) {
    this.reportEvery = requirePositiveInteger(
      options.reportEvery,
      DEFAULT_REPORT_EVERY,
      "reportEvery",
    );
    this.hitchMs = requirePositiveNumber(options.hitchMs, DEFAULT_HITCH_MS, "hitchMs");
    const capacity = requirePositiveInteger(options.capacity, DEFAULT_CAPACITY, "capacity");
    this.#report = options.report ?? ((line) => console.log(line));
    this.#wallClock = options.wallClock ?? (() => Date.now());
    this.#onWindow = options.onWindow;
    this.#readSurface = options.readSurface;
    this.#scratch = new Float64Array(capacity);
    this.#presented = new Ring(capacity);
    this.#frame = new Ring(capacity);
    this.#substeps = new Ring(capacity);
    this.#phaseRings = {
      hostGap: new Ring(capacity),
      overlay: new Ring(capacity),
      render: new Ring(capacity),
      residual: new Ring(capacity),
      update: new Ring(capacity),
    };
  }

  /**
   * @param timestampMs the frame timestamp the host handed the callback — the presented-frame
   *   clock, which is not the same as `nowMs` and is what the interval between frames comes from.
   * @param nowMs the monotonic clock at callback entry.
   */
  beginFrame(timestampMs: number, nowMs: number): void {
    if (this.#open)
      throw new Error("FrameBudget.beginFrame called before the previous frame ended.");
    this.#open = true;
    this.#frameStart = nowMs;
    this.#simulationEnd = undefined;
    this.#renderMs = 0;
    this.#overlayMs = 0;
    this.#substepCount = 0;
    this.#hostGap = this.#lastFrameEnd === undefined ? 0 : Math.max(0, nowMs - this.#lastFrameEnd);
    this.#presentedDelta =
      this.#lastTimestamp === undefined ? 0 : Math.max(0, timestampMs - this.#lastTimestamp);
    this.#lastTimestamp = timestampMs;
  }

  /** The boundary between the fixed-step simulation and everything the render phase does. */
  markSimulationEnd(nowMs: number, substeps: number): void {
    if (!this.#open) throw new Error("FrameBudget.markSimulationEnd called outside a frame.");
    this.#simulationEnd = nowMs;
    this.#substepCount = substeps;
  }

  addRender(ms: number): void {
    if (!this.#open) throw new Error("FrameBudget.addRender called outside a frame.");
    this.#renderMs += ms;
  }

  addOverlay(ms: number): void {
    if (!this.#open) throw new Error("FrameBudget.addOverlay called outside a frame.");
    this.#overlayMs += ms;
  }

  /**
   * Closes the frame and returns its phase split, or `undefined` when the frame was a hitch and
   * therefore excluded — a 27-second startup stall is not a frame time and must not enter a
   * percentile anybody is asked to act on.
   */
  endFrame(nowMs: number): IFramePhaseSample | undefined {
    if (!this.#open) throw new Error("FrameBudget.endFrame called outside a frame.");
    this.#open = false;
    const simulationEnd = this.#simulationEnd ?? this.#frameStart;
    const frameMs = Math.max(0, nowMs - this.#frameStart);
    this.#lastFrameEnd = nowMs;

    const isHitch = this.#presentedDelta >= this.hitchMs;
    if (isHitch) {
      this.#hitchesInWindow += 1;
      this.#report(
        `${FRAME_HITCH_MARKER}:${JSON.stringify({
          gapMs: round(this.#presentedDelta),
          uptimeMs: round(nowMs),
          wallClock: this.#wallClock(),
        })}`,
      );
      this.#maybeReport();
      return undefined;
    }

    const update = Math.max(0, simulationEnd - this.#frameStart);
    const tail = Math.max(0, nowMs - simulationEnd);
    const residual = Math.max(0, tail - this.#renderMs - this.#overlayMs);
    const sample: IFramePhaseSample = {
      hostGap: round(this.#hostGap),
      overlay: round(this.#overlayMs),
      render: round(this.#renderMs),
      residual: round(residual),
      update: round(update),
    };
    this.#frame.push(frameMs);
    this.#substeps.push(this.#substepCount);
    // The first frame has no predecessor, so it has neither an interval nor a host gap; pushing a
    // zero there would drag every percentile toward a frame that never happened.
    if (this.#presentedDelta > 0) this.#presented.push(this.#presentedDelta);
    if (this.#hostGap > 0) this.#phaseRings.hostGap.push(this.#hostGap);
    this.#phaseRings.update.push(update);
    this.#phaseRings.render.push(this.#renderMs);
    this.#phaseRings.overlay.push(this.#overlayMs);
    this.#phaseRings.residual.push(residual);
    this.#framesInWindow += 1;
    this.#maybeReport();
    return sample;
  }

  /** Reads the window in progress without disturbing it. */
  window(): IFrameBudgetWindow {
    const presented = this.#presented.summarize(this.#scratch);
    const phases = {
      hostGap: this.#phaseRings.hostGap.summarize(this.#scratch),
      overlay: this.#phaseRings.overlay.summarize(this.#scratch),
      render: this.#phaseRings.render.summarize(this.#scratch),
      residual: this.#phaseRings.residual.summarize(this.#scratch),
      update: this.#phaseRings.update.summarize(this.#scratch),
    };
    const share = (value: number): number =>
      presented.mean === 0 ? 0 : Math.round((value / presented.mean) * 1_000) / 1_000;
    const surface =
      this.#readSurface === undefined ? undefined : requireSurface(this.#readSurface());
    return {
      fps: presented.mean === 0 ? 0 : round(1_000 / presented.mean),
      frame: this.#frame.summarize(this.#scratch),
      frames: this.#framesInWindow,
      hitches: this.#hitchesInWindow,
      phases,
      presented,
      shares: {
        hostGap: share(phases.hostGap.mean),
        overlay: share(phases.overlay.mean),
        render: share(phases.render.mean),
        residual: share(phases.residual.mean),
        update: share(phases.update.mean),
      },
      substeps: this.#substeps.summarize(this.#scratch),
      ...(surface === undefined ? {} : { surface }),
      window: this.#windowIndex + 1,
    };
  }

  #maybeReport(): void {
    if (this.#framesInWindow < this.reportEvery) return;
    const completed = this.window();
    this.#report(`${FRAME_BUDGET_MARKER}:${JSON.stringify(completed)}`);
    this.#windowIndex += 1;
    this.#presented.reset();
    this.#frame.reset();
    this.#substeps.reset();
    for (const phase of FRAME_BUDGET_PHASES) this.#phaseRings[phase].reset();
    this.#framesInWindow = 0;
    this.#hitchesInWindow = 0;
    // After the reset, so a consumer that changes the scene from this callback changes it for the
    // window that starts now rather than for the one just reported.
    this.#onWindow?.(completed);
  }
}
