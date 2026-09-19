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

import {
  FRAME_PASS_KINDS,
  type FramePassKind,
  type IRenderPassSample,
} from "./render-pass-budget.js";

/** Marker printed once per report window. */
export const FRAME_BUDGET_MARKER = "TN_FRAME_BUDGET";
/** Marker printed the moment a gap between presented frames exceeds `hitchMs`. */
export const FRAME_HITCH_MARKER = "TN_FRAME_HITCH";

/**
 * The named parts of one presented frame. They partition the frame: `hostGap` is the time before
 * the callback (present wait plus whatever the host did between callbacks), and `update`,
 * `render`, `overlay`, `ui` and `residual` sum to the callback's own duration.
 *
 * `overlay` and `ui` are two different draws that happen to sit next to each other. `overlay` is
 * the three.js HUD pass; `ui` is the native UI layer's composite of the page's pixels into the
 * game's own frame — one upload and one quad — which is why it is a phase of its own and not part
 * of `overlay`.
 */
export const FRAME_BUDGET_PHASES = [
  "hostGap",
  "update",
  "render",
  "overlay",
  "ui",
  "residual",
] as const;

export type FrameBudgetPhase = (typeof FRAME_BUDGET_PHASES)[number];

/** One frame's cost, split by phase. Every field is milliseconds. */
export interface IFramePhaseSample {
  readonly hostGap: number;
  readonly update: number;
  readonly render: number;
  readonly overlay: number;
  readonly ui: number;
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
  /**
   * `"pinned"` when the game fixed the number, `"auto"` when the engine chose it, and
   * `"auto-pinned"` when the engine chose it and then stopped moving it — the oscillation guard
   * holding a rung is a different state from a game that pinned one, and reads as one.
   */
  readonly scaleSource: "pinned" | "auto" | "auto-pinned";
  /** Multisample count of the 3D drawing buffer; 1 when sampling is off. */
  readonly sampleCount: number;
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;
  /**
   * True when the scaler is at its lowest rung and the tail is still over budget.
   *
   * A window that reports 0.23 and nothing else reads as a met budget at a low resolution. It is
   * the opposite: the engine ran out of room and the game is still missing its target. Always
   * false under a pinned scale, which has no floor to reach.
   */
  readonly atFloor: boolean;
  /** Compilation overlapped the measured window; automatic scaling waits for a clean window. */
  readonly compiling?: boolean;
}

const SCALE_SOURCES: readonly IFrameSurfaceState["scaleSource"][] = [
  "pinned",
  "auto",
  "auto-pinned",
];

/** Fail closed: a surface that cannot describe an image is never reported as one. */
function requireSurface(surface: IFrameSurfaceState): IFrameSurfaceState {
  const {
    atFloor,
    compiling,
    drawingBufferHeight,
    drawingBufferWidth,
    resolutionScale,
    sampleCount,
    scaleSource,
  } = surface;
  if (compiling !== undefined && typeof compiling !== "boolean")
    throw new Error("Frame budget surface compiling must be a boolean when observed.");
  if (typeof atFloor !== "boolean")
    throw new Error(
      `Frame budget surface atFloor must say whether the scaler had room left, received ${String(atFloor)}.`,
    );
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
  return {
    atFloor,
    ...(compiling === undefined ? {} : { compiling }),
    drawingBufferHeight,
    drawingBufferWidth,
    resolutionScale,
    sampleCount,
    scaleSource,
  };
}

export interface IFrameBudgetSummary {
  readonly samples: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

/**
 * One render-pass kind's submissions across a window, so a change that trades triangles for CPU is
 * visible in the same report as the milliseconds it traded for.
 */
export interface IFrameBudgetPassSummary {
  readonly draws: IFrameBudgetSummary;
  /** Frames in the window that submitted a pass of this kind. */
  readonly frames: number;
  readonly triangles: IFrameBudgetSummary;
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
   * Draw calls and triangles submitted per render pass, when a pass recorder was installed.
   *
   * Absent rather than defaulted: a renderer whose submissions nothing measured and a frame that
   * submitted nothing are different facts, and a zero would merge them. A kind no frame submitted
   * is absent; `frames` says how many frames did.
   */
  readonly passes?: Readonly<Partial<Record<FramePassKind, IFrameBudgetPassSummary>>>;
  /**
   * The resolution and sampling this window's frames were drawn at, when the loop reported one.
   * Absent rather than defaulted: a consumer asserting on it must fail loudly instead of reading
   * a fabricated `1.0` that no frame was ever drawn at.
   */
  readonly surface?: IFrameSurfaceState;
  /**
   * GPU milliseconds per resolved frame in this window, from `timestamp-query`, summarised like a
   * phase — mean/p50/p95/p99/max over the frames the device actually reported.
   *
   * A single instantaneous `info.render.timestamp` read is lagged by up to `gpuAgeFrames` and
   * spread 3.5x between consecutive reads of one steady frame, so it is not the frame's GPU cost
   * and is not what this reports. Absent rather than zero when no frame resolved a reading: an
   * adapter without timestamps and a frame that genuinely cost no GPU time are different facts,
   * and a zero would merge them.
   */
  readonly gpu?: IFrameBudgetSummary;
  /**
   * Frames in the window whose GPU reading had not advanced since the previous frame, or was
   * absent. `gpu.samples + gpuStale` is the frames the device was asked about; a window where
   * every frame is stale reports `gpu` absent rather than the last reading looking current.
   */
  readonly gpuStale: number;
  /**
   * The window mean of `gpu`, when present. The scalar the resolution scaler reads.
   *
   * It is the same number as `gpu.mean`; a single field keeps the scaler and the perf report on
   * one series rather than a second instantaneous read.
   */
  readonly gpuMs?: number;
  /** Age of the most recent resolved GPU timestamp in Three.js frame IDs; absent means unobservable. */
  readonly gpuAgeFrames?: number;
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
  /** Reads the successful GPU query frame age, not the age of the last resolve attempt. */
  readonly readGpuAgeFrames?: () => number | undefined;
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
 * `beginFrame` → `markSimulationEnd` → (`addRender` / `addOverlay` / `addUi`) → `endFrame`.
 * Calling them out of order throws rather than producing a plausible-looking split.
 */
export class FrameBudget {
  readonly reportEvery: number;
  readonly hitchMs: number;
  #report: (line: string) => void;
  #wallClock: () => number;
  #onWindow: ((window: IFrameBudgetWindow) => void) | undefined;
  #readSurface: (() => IFrameSurfaceState) | undefined;
  #readGpuAgeFrames: (() => number | undefined) | undefined;
  #scratch: Float64Array;
  #presented: Ring;
  #frame: Ring;
  #substeps: Ring;
  #phaseRings: Record<FrameBudgetPhase, Ring>;
  #gpu: Ring;
  #passDrawRings: Record<FramePassKind, Ring>;
  #passTriangleRings: Record<FramePassKind, Ring>;
  #passFrames: Record<FramePassKind, number> = { main: 0, nested: 0, reflection: 0, shadow: 0 };
  #passesThisFrame: IRenderPassSample[] = [];
  // The resolved frame the last sample belonged to, so a reading still in flight is not measured
  // twice. It survives a window boundary: the first frame of a new window can still be showing the
  // previous window's resolved frame.
  #lastGpuFrame: number | undefined;
  #gpuThisFrame: number | undefined;
  #gpuStaleThisFrame = false;
  #gpuStaleInWindow = 0;
  #open = false;
  #frameStart = 0;
  #simulationEnd: number | undefined;
  #renderMs = 0;
  #overlayMs = 0;
  #uiMs = 0;
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
    this.#readGpuAgeFrames = options.readGpuAgeFrames;
    this.#scratch = new Float64Array(capacity);
    this.#presented = new Ring(capacity);
    this.#frame = new Ring(capacity);
    this.#substeps = new Ring(capacity);
    this.#gpu = new Ring(capacity);
    this.#phaseRings = {
      hostGap: new Ring(capacity),
      overlay: new Ring(capacity),
      render: new Ring(capacity),
      residual: new Ring(capacity),
      ui: new Ring(capacity),
      update: new Ring(capacity),
    };
    this.#passDrawRings = {
      main: new Ring(capacity),
      nested: new Ring(capacity),
      reflection: new Ring(capacity),
      shadow: new Ring(capacity),
    };
    this.#passTriangleRings = {
      main: new Ring(capacity),
      nested: new Ring(capacity),
      reflection: new Ring(capacity),
      shadow: new Ring(capacity),
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
    this.#uiMs = 0;
    this.#substepCount = 0;
    this.#gpuThisFrame = undefined;
    this.#gpuStaleThisFrame = false;
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

  addUi(ms: number): void {
    if (!this.#open) throw new Error("FrameBudget.addUi called outside a frame.");
    this.#uiMs += ms;
  }

  /**
   * Records one presented frame's GPU duration, from a resolved `timestamp-query`.
   *
   * `ms` is `undefined` when the device reported no reading for the frame. `frame` is the
   * Three.js frame id the duration belongs to — `gpuFrameSample`/`gpuFrameAge` on the renderer.
   * A reading whose `frame` has not advanced since the previous frame is the previous frame's
   * resolve still in flight, so it is counted as stale and not pushed again; that repetition was
   * what made one lagged sample read as the current frame's cost. Without a `frame` a reading is
   * always taken as fresh, since there is nothing to tell repeats from a genuine re-measurement.
   *
   * Once per frame. A window with no reading at all reports `gpu` absent, never a zero.
   */
  addGpuMs(ms: number | undefined, frame?: number): void {
    if (!this.#open) throw new Error("FrameBudget.addGpuMs called outside a frame.");
    if (ms === undefined) {
      this.#gpuStaleThisFrame = true;
      return;
    }
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(`Frame budget gpuMs must be a non-negative number, received ${String(ms)}.`);
    }
    if (frame !== undefined) {
      if (!Number.isInteger(frame) || frame < 0) {
        throw new Error(
          `Frame budget gpu frame must be a non-negative integer, received ${String(frame)}.`,
        );
      }
      if (frame === this.#lastGpuFrame) {
        this.#gpuStaleThisFrame = true;
        return;
      }
      this.#lastGpuFrame = frame;
    }
    this.#gpuThisFrame = ms;
  }

  /**
   * Records the frame's per-pass submissions, from `RenderPassBudget` or any other source. At most
   * one entry per kind per frame is meaningful; a second of the same kind is summed by the caller.
   * An unknown kind throws rather than being dropped, the same fail-closed rule as a phase.
   */
  addRenderPasses(passes: readonly IRenderPassSample[]): void {
    if (!this.#open) throw new Error("FrameBudget.addRenderPasses called outside a frame.");
    for (const pass of passes) {
      if (!(FRAME_PASS_KINDS as readonly string[]).includes(pass.kind))
        throw new Error(
          `FrameBudget received an unknown pass kind: ${String(pass.kind)}. Expected one of: ${FRAME_PASS_KINDS.join(", ")}.`,
        );
      this.#passesThisFrame.push(pass);
    }
  }

  /**
   * Closes the frame and returns its phase split, or `undefined` when the frame was a hitch and
   * therefore excluded — a 27-second startup stall is not a frame time and must not enter a
   * percentile anybody is asked to act on.
   *
   * `wantSample` is false when the caller is going to discard the split, which is the default
   * shipping configuration. The object is small but it escapes this method, so V8 cannot scalar-
   * replace it, and building one per frame is one dead allocation per frame in every game. The
   * window meters below are pushed either way: turning the sample off must not turn measurement
   * off, and `window()` reads the same numbers whichever way this is called.
   */
  endFrame(nowMs: number, wantSample = true): IFramePhaseSample | undefined {
    if (!this.#open) throw new Error("FrameBudget.endFrame called outside a frame.");
    this.#open = false;
    const simulationEnd = this.#simulationEnd ?? this.#frameStart;
    const frameMs = Math.max(0, nowMs - this.#frameStart);
    this.#lastFrameEnd = nowMs;

    const isHitch = this.#presentedDelta >= this.hitchMs;
    if (isHitch) {
      this.#passesThisFrame.length = 0;
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
    const residual = Math.max(0, tail - this.#renderMs - this.#overlayMs - this.#uiMs);
    const sample: IFramePhaseSample | undefined = wantSample
      ? {
          hostGap: round(this.#hostGap),
          overlay: round(this.#overlayMs),
          render: round(this.#renderMs),
          residual: round(residual),
          ui: round(this.#uiMs),
          update: round(update),
        }
      : undefined;
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
    this.#phaseRings.ui.push(this.#uiMs);
    if (this.#gpuThisFrame !== undefined) this.#gpu.push(this.#gpuThisFrame);
    if (this.#gpuStaleThisFrame) this.#gpuStaleInWindow += 1;
    for (const pass of this.#passesThisFrame) {
      this.#passDrawRings[pass.kind].push(pass.draws);
      this.#passTriangleRings[pass.kind].push(pass.triangles);
      this.#passFrames[pass.kind] += 1;
    }
    this.#passesThisFrame.length = 0;
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
      ui: this.#phaseRings.ui.summarize(this.#scratch),
      update: this.#phaseRings.update.summarize(this.#scratch),
    };
    const share = (value: number): number =>
      presented.mean === 0 ? 0 : Math.round((value / presented.mean) * 1_000) / 1_000;
    const passes: Partial<Record<FramePassKind, IFrameBudgetPassSummary>> = {};
    for (const kind of FRAME_PASS_KINDS) {
      if (this.#passFrames[kind] === 0) continue;
      passes[kind] = {
        draws: this.#passDrawRings[kind].summarize(this.#scratch),
        frames: this.#passFrames[kind],
        triangles: this.#passTriangleRings[kind].summarize(this.#scratch),
      };
    }
    const surface =
      this.#readSurface === undefined ? undefined : requireSurface(this.#readSurface());
    const gpuAgeFrames = this.#readGpuAgeFrames?.();
    if (gpuAgeFrames !== undefined && (!Number.isInteger(gpuAgeFrames) || gpuAgeFrames < 0))
      throw new Error(
        `Frame budget gpuAgeFrames must be a non-negative integer, received ${String(gpuAgeFrames)}.`,
      );
    const gpuSummary = this.#gpu.summarize(this.#scratch);
    const gpu = gpuSummary.samples === 0 ? undefined : gpuSummary;
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
        ui: share(phases.ui.mean),
        update: share(phases.update.mean),
      },
      substeps: this.#substeps.summarize(this.#scratch),
      ...(Object.keys(passes).length === 0 ? {} : { passes }),
      // One series, two readers: `gpu` is the distribution and `gpuMs` is its mean for the scaler
      // and the perf record, which want a single number.
      ...(gpu === undefined ? {} : { gpu }),
      gpuStale: this.#gpuStaleInWindow,
      ...(gpu === undefined ? {} : { gpuMs: gpu.mean }),
      ...(gpuAgeFrames === undefined ? {} : { gpuAgeFrames }),
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
    this.#gpu.reset();
    this.#gpuStaleInWindow = 0;
    for (const phase of FRAME_BUDGET_PHASES) this.#phaseRings[phase].reset();
    for (const kind of FRAME_PASS_KINDS) {
      this.#passDrawRings[kind].reset();
      this.#passTriangleRings[kind].reset();
      this.#passFrames[kind] = 0;
    }
    this.#framesInWindow = 0;
    this.#hitchesInWindow = 0;
    // After the reset, so a consumer that changes the scene from this callback changes it for the
    // window that starts now rather than for the one just reported.
    this.#onWindow?.(completed);
  }
}
