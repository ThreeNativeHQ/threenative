/**
 * The adaptive drawing-buffer scale: PRD-228 Change A's loop.
 *
 * A game reaches its `display.maxFps` target without hand-authoring a resolution constant.
 * Bayview's own constant took an afternoon and three ladder rungs to find on a physical Pixel 8;
 * the next game would have repeated that from scratch, which is what makes the loop framework
 * work rather than game work.
 *
 * Every number below is pre-registered in the PRD before this file existed and is read from one
 * constant block. A controller tuned inside its own implementation until a playtest went green is
 * a controller nobody can argue with afterwards, so the values move by editing the PRD.
 *
 * Nothing here touches the overlay surface, the camera or the aspect ratio: only the 3D drawing
 * buffer moves, which is the arrangement the device ladder measured and accepted.
 */

/** How the active scale was arrived at, reported beside every fps number. */
export type ScaleSource = "pinned" | "auto" | "auto-pinned";

export const RESOLUTION_SCALER = {
  /**
   * Ratio 0.85 linear, so each step is 0.72x the pixels. Coarse on purpose: every step
   * reallocates render targets on WebGPU, and fine granularity buys smoothness with hitches.
   */
  rungs: [1.0, 0.85, 0.72, 0.61, 0.52, 0.44, 0.38, 0.32, 0.27, 0.23] as const,
  /**
   * The signal is **fps against the configured target**, not the presented interval.
   *
   * Amended 2026-08-28 from a device arm, before the second implementation. The original triggers
   * were `presented p95 > 14 ms` down and `< 11.5 ms` up. Under FIFO the presented interval is the
   * *panel's* period, not the game's cost: a game locked at 60 fps on a 60 Hz panel reports
   * presented p95 around 17.5 ms, so `> 14` is true forever. A scaffolded template holding
   * 59.99 fps with a `frame p95` of 7.99 ms out of 16.67 was walked to 552x248 and then told it
   * had run out of room. fps is correct in both regimes: it comes from the mean presented
   * interval, so dropped frames pull it down on their own, and a missed target is missed whether
   * or not a panel caps the top.
   */
  targetFpsFraction: 0.98,
  /**
   * The tail guard on the up-step only. A frame that hits its average target while dropping frames
   * has headroom on paper and none in the hand. A vsync-capped panel's own p95 floor sits near
   * 1.05x the budget, comfortably inside this.
   */
  upTailFraction: 1.15,
  /**
   * A window whose presented p99 is at least this many times its p50 is measuring a **stall**, not
   * a frame rate, and the controller defers on it rather than acting.
   *
   * Amended 2026-08-30 from a browser arm, and this is the second time the fps signal has needed
   * correcting for the same underlying reason: `fps` is `1000 / mean`, and a mean is not robust.
   * `sandbox/lumen-hall` on an NVIDIA Turing at 1600x900 spent its second window building WebGPU
   * pipelines for a five-stage TSL chain. Four of that window's 300 frames took about two seconds
   * each — under `hitchMs`, so they stayed in the window and were averaged. The window reported
   * **22.6 fps** with a **p50 of 9.8 ms**, which is 102 fps. The controller read a 2.6x deficit,
   * took its maximum four-rung jump to 0.52, and the game held 145 fps at 832x468 for the next
   * forty seconds — a third of its pixels surrendered to fix a frame rate that was never missed.
   * The window's own record carried the contradiction the whole time and nothing read it.
   *
   * A down-step is also the wrong medicine specifically here: the resize reallocates every render
   * target, which rebuilds pipelines, which is what stalled in the first place.
   *
   * Ten is chosen to separate the two regimes rather than to tune a result, and the numbers are
   * not close. A vsync-capped panel dropping frames — the case `fps`-from-mean exists to catch —
   * has a p99 of one extra panel period, so a ratio near 2; a game that is simply slow has a ratio
   * near 1. The lumen-hall window's ratio was 200. Nothing real sits between.
   */
  stallP99Multiple: 10,
  /**
   * p99 needs at least three bad samples in a 300-frame window. One profiler or debugger pause can
   * still pull fps-from-mean below the down threshold, so the maximum gets the same stall test.
   * Ordinary missed presents are around 2x p50 and stay far below this boundary.
   */
  stallMaxMultiple: 10,
  /** React to a deficit immediately; climb only on sustained evidence. Asymmetric by design. */
  downWindows: 1,
  upWindows: 4,
  /** Asynchronous timestamp queries may trail the draw by several Three.js frame IDs. */
  maxGpuAgeFrames: 8,
  /** The resize frame is itself a hitch and must never feed the controller. */
  cooldownWindows: 1,
  /**
   * Windows discarded outright at the start. "Window 1 always lies" is already the perf CLI's
   * rule; the controller was the one consumer that believed it. A scaffolded template took its
   * only down-step from a cold-start window reading 51.52 fps while still loading, then spent
   * four windows climbing back to where it started.
   */
  warmupWindows: 1,
  /**
   * The most rungs one down-step may cross. Applies only when fresh GPU timing sizes the
   * jump; without it the fallback below probes a single rung and refunds what earns nothing.
   *
   * Falling one rung per decision costs about twenty seconds per rung at the top of the ladder,
   * and the ladder is ten rungs deep — a game starting at DPR-1 physical spent about three
   * minutes visibly at 29 fps before settling. The jump size comes from the deficit: one window
   * cannot separate the fixed cost from the pixel cost, so it attributes the whole deficit to
   * pixels when GPU timing is unavailable. With fresh GPU timing, the GPU deficit sizes the
   * jump instead: host delay cannot be recovered by surrendering pixels.
   */
  maxDownRungs: 4,
  /**
   * Two down-up-down cycles across one boundary inhibit upward probes for this many windows.
   *
   * The PRD pre-registered this reach as 3 windows. That value cannot fire: a down-then-up leg
   * costs at least `cooldownWindows + upWindows` = 5 windows by the rest of this same table, so a
   * 3-window reach only ever sees the up-then-down leg and the guard is dead code. The reach is
   * therefore derived from the table rather than picked — the tightest a down-up leg can be, plus
   * one — and the correction is recorded in the PRD instead of being tuned in here.
   */
  oscillationCycles: 2,
  oscillationWindows: 1 + 4 + 1,
} as const;

/** Pixels retained per rung: 0.85 linear on each axis. */
const RUNG_PIXEL_RATIO = 0.85 * 0.85;

export interface IResolutionScalerOptions {
  /** The `display.maxFps` the loop is holding the budget against. */
  readonly targetFps: number;
  /** Which rung to start on. Must be one of the rungs; defaults to the ceiling. */
  readonly start?: number;
}

/** A closed frame-budget window's presentation distribution and optional GPU observation. */
export interface IScalerWindow {
  /** The last resolved GPU duration and its age; absent/old observations may only probe. */
  readonly gpuMs?: number;
  readonly gpuAgeFrames?: number;
  /** Frames per second this window achieved, from the mean presented interval. */
  readonly fps: number;
  /**
   * `p50` says what an ordinary frame cost; `p99` and `max` expose recurring and isolated stalls.
   * The controller needs them to tell a slow game from a stalled one: `fps` alone cannot, because
   * it comes from a mean.
   */
  readonly presented: {
    readonly max: number;
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
  };
}

export class ResolutionScaler {
  /** fps at or above this is meeting the target. */
  readonly targetFps: number;
  /**
   * A presented interval above this is a frame that cost more than the target allows: the same
   * bar `targetFps` is, read as a period instead of a rate. Nothing new is chosen here — it is
   * `targetFpsFraction` again, applied to the statistic a mean cannot speak for.
   */
  readonly budgetMs: number;
  /** presented p95 above this is dropping frames, whatever the mean says. */
  readonly tailMs: number;
  #index: number;
  #scaleSource: Exclude<ScaleSource, "pinned"> = "auto";
  #cleanWindows = 0;
  #cooldown = 0;
  #warmup = RESOLUTION_SCALER.warmupWindows;
  #windowIndex = 0;
  // Oscillation state. A "boundary" is the higher of the two rungs a step crossed, so a fall
  // from 1.0 and the climb back to it are recognised as the same boundary.
  #guardBoundary = -1;
  #guardDirection = 0;
  #guardLegs = 0;
  #guardCycles = 0;
  #guardWindow = 0;
  #pinWindows = 0;
  // Unknown-GPU probe state. A down-step taken without fresh GPU timing is a hypothesis —
  // fewer pixels will recover the frame rate — and the next decided window tests it against
  // the fps that motivated it. `#probeBlind` records a failed hypothesis: reprobing the same
  // host-bound workload would only flicker, so unknown-GPU probes stop until fresh timing or
  // a recovered frame rate reopens the question. `#lastHealthyWindow` records the last window
  // whose fresh GPU timing showed headroom, so a single gap after healthy timing holds
  // instead of probing.
  #probeFps: number | undefined = undefined;
  #probeBlind = false;
  #lastHealthyWindow = 0;

  constructor(options: IResolutionScalerOptions) {
    const { start, targetFps } = options;
    if (!Number.isFinite(targetFps) || targetFps <= 0)
      throw new Error(
        `ResolutionScaler targetFps must be a finite number greater than zero, received ${String(targetFps)}.`,
      );
    this.targetFps = targetFps * RESOLUTION_SCALER.targetFpsFraction;
    this.budgetMs = 1000 / this.targetFps;
    this.tailMs = (1000 / targetFps) * RESOLUTION_SCALER.upTailFraction;
    const index = start === undefined ? 0 : RESOLUTION_SCALER.rungs.indexOf(start as never);
    if (index < 0)
      throw new Error(
        `ResolutionScaler start must be one of the pre-registered rung values, received ${String(start)}.`,
      );
    this.#index = index;
  }

  /** The scale the renderer should be applying right now. */
  get scale(): number {
    return RESOLUTION_SCALER.rungs[this.#index] ?? 1;
  }

  get scaleSource(): Exclude<ScaleSource, "pinned"> {
    return this.#scaleSource;
  }

  /**
   * True when the floor is reached and the tail is still over budget. The window keeps reporting
   * the true scale: a scaler that ran out of room must say so rather than let the number read as
   * a met budget.
   */
  get atFloor(): boolean {
    return this.#atFloor;
  }
  #atFloor = false;

  /**
   * Feeds one completed frame-budget window. Returns the new scale when this window caused a
   * step, `undefined` otherwise. Allocation-free: no object is constructed on the steady path.
   */
  observe(window: IScalerWindow): number | undefined {
    this.#windowIndex += 1;
    if (this.#scaleSource === "auto-pinned" && --this.#pinWindows === 0) {
      this.#scaleSource = "auto";
      this.#guardLegs = this.#guardCycles = this.#cleanWindows = 0;
      // The loop propagates scaleSource only when a scale is returned, including an unchanged one.
      return this.scale;
    }
    if (this.#warmup > 0) {
      this.#warmup -= 1;
      return undefined;
    }
    if (this.#cooldown > 0) {
      this.#cooldown -= 1;
      return undefined;
    }
    // A stalled window is not a measurement of the frame rate, in either direction: acting on the
    // mean would cut resolution the game did not need, and counting it clean would climb on a
    // window that was mostly spent stopped. Deferring means neither — the clean run it interrupts
    // is left standing rather than thrown away. Resetting it made the up-path unreachable for any
    // game that hitches more often than once every `cooldownWindows + upWindows` windows: one
    // 400 ms frame every third window pinned a scaler at 0.44 through seventeen minutes of
    // otherwise perfect 60 fps, which is a forest streaming its next hillside.
    if (this.#stalled(window)) return undefined;
    const gpuMs = this.#freshGpuMs(window);
    this.#noteGpuObservation(window, gpuMs);
    if (window.fps < this.targetFps && (gpuMs === undefined || gpuMs > this.budgetMs)) {
      // **Only the mean is under target: hold.** `fps` is `1000 / mean`, and on the one panel
      // arrangement every game actually ships into — `display.maxFps` equal to the refresh rate,
      // vsync on — the mean is the only statistic with any room to move. fps is bounded *above*
      // by the target there, so the whole test lives in the 2% under it, and each present the
      // compositor drops spends a third of a percent. Seven doubled intervals out of 300 crossed
      // the bar on `sandbox/wildwood` while the median and the tail both sat on the panel period,
      // and fewer pixels do not bring a dropped present back: the step won nothing, the next
      // window spent another rung, and the picture walked to 5% of its pixels in 140 seconds.
      // This is `stallP99Multiple`'s lesson at 2x rather than at 10x.
      //
      // Deferred rather than merely not acted on, and the difference is the whole repair. Such a
      // window says nothing about the pixel cost **in either direction**, which is exactly what
      // the stall guard above says about its own case — so it is neither grounds to fall nor a
      // reason to throw away the clean run a climb needs. Counting it against the climb stops the
      // descent and never gives the pixels back: replayed against the state `sandbox/wildwood`'s
      // own record documents — parked at 0.61 while holding 60.0 fps — that reading held 0.61 for
      // five minutes. The picture stops getting worse and never gets sharp again, which is half a
      // fix and the wrong half.
      if (!this.#overBudget(window)) return undefined;
      this.#cleanWindows = 0;
      // Unknown GPU timing is not evidence of a GPU bottleneck: an adapter without timestamp
      // queries reports nothing either way, and neither this window's fps nor its presentation
      // tail can separate fixed host cost from pixel cost. So the fallback may only probe —
      // one rung down, refunded unless fewer pixels earn a better frame rate.
      if (gpuMs === undefined) return this.#probeUnknown(window);
      if (this.#index >= RESOLUTION_SCALER.rungs.length - 1) {
        this.#atFloor = true;
        return undefined;
      }
      return this.#step(this.#rungsToDrop(1000 / gpuMs));
    }
    this.#atFloor = false;
    if (this.#scaleSource === "auto-pinned") return undefined;
    const nextScale = RESOLUTION_SCALER.rungs[Math.max(0, this.#index - 1)] ?? 1;
    const canClimb =
      gpuMs === undefined
        ? window.presented.p95 <= this.tailMs
        : gpuMs * (nextScale / this.scale) ** 2 <= this.budgetMs;
    if (!canClimb) {
      this.#cleanWindows = 0;
      return undefined;
    }
    this.#cleanWindows += 1;
    if (this.#cleanWindows < RESOLUTION_SCALER.upWindows) return undefined;
    this.#cleanWindows = 0;
    if (this.#index === 0) return undefined;
    return this.#step(-1);
  }

  /**
   * Records what this window's GPU observation settles about earlier inferences. Fresh timing
   * supersedes everything drawn from its absence; a recovered frame rate reopens a question a
   * failed probe closed, because the workload changed.
   */
  #noteGpuObservation(window: IScalerWindow, gpuMs: number | undefined): void {
    if (gpuMs !== undefined) {
      this.#probeFps = undefined;
      this.#probeBlind = false;
      if (gpuMs <= this.budgetMs) this.#lastHealthyWindow = this.#windowIndex;
    } else if (window.fps >= this.targetFps) {
      this.#probeFps = undefined;
      this.#probeBlind = false;
    }
  }

  /**
   * One decided over-budget window with no fresh GPU timing. Returns the new scale when this
   * window caused a step, `undefined` otherwise.
   */
  #probeUnknown(window: IScalerWindow): number | undefined {
    // A pending probe is evaluated before the floor guard: parking at the final rung must
    // not strand the hypothesis that fewer pixels would help. Improvement counts only when
    // the new deficit prices fewer rungs than the old one — the same rung table as every
    // sized jump, so timing noise that never crosses a rung boundary refunds instead of
    // ratcheting the ladder down one tremor at a time.
    if (this.#probeFps !== undefined) {
      const earned = this.#rungsToDrop(window.fps) < this.#rungsToDrop(this.#probeFps);
      this.#probeFps = undefined;
      if (!earned) {
        this.#probeBlind = true;
        return this.#step(-1, false);
      }
      if (this.#index >= RESOLUTION_SCALER.rungs.length - 1) {
        this.#atFloor = true;
        return undefined;
      }
      this.#probeFps = window.fps;
      return this.#step(1);
    }
    if (this.#index >= RESOLUTION_SCALER.rungs.length - 1) {
      this.#atFloor = true;
      return undefined;
    }
    // A gap immediately after fresh-healthy timing is transient, not a new bottleneck.
    if (this.#windowIndex - this.#lastHealthyWindow <= 1) return undefined;
    if (this.#probeBlind) return undefined;
    this.#probeFps = window.fps;
    return this.#step(1);
  }
  /**
   * True when the median or tail corroborates the missed presentation budget. This alone cannot
   * identify a pixel bottleneck; fresh GPU timing takes precedence in observe().
   *
   * Two independent witnesses, each already carrying its own pre-registered bar, and either is
   * enough:
   *
   *  - **the median present is over the target's period.** An unlocked renderer holding a steady
   *    17.24 ms against a 16.67 ms budget shows up here and nowhere else: its tail is as tight as
   *    its middle, and it is simply doing too much work every frame.
   *  - **the tail is past `tailMs`.** Under FIFO an interval is a whole number of panel periods,
   *    so a game that misses a real share of its vsyncs moves p95 to two periods in one jump —
   *    the 45 fps window the device arm chose the mean signal for. There is nothing in between to
   *    fall through: `upTailFraction` sits in the empty gap between one period and two.
   *
   * When neither speaks, the deficit is a handful of doubled intervals in an otherwise on-budget
   * window: jitter from the compositor, a GC, an input burst, an audio callback. None of that is
   * bought back with pixels, and spending a rung on it is how the picture walks to the floor.
   */
  #overBudget(window: IScalerWindow): boolean {
    return window.presented.p50 > this.budgetMs || window.presented.p95 > this.tailMs;
  }

  #freshGpuMs({ gpuMs, gpuAgeFrames }: IScalerWindow): number | undefined {
    return gpuMs !== undefined &&
      Number.isFinite(gpuMs) &&
      gpuMs > 0 &&
      gpuAgeFrames !== undefined &&
      Number.isInteger(gpuAgeFrames) &&
      gpuAgeFrames >= 0 &&
      gpuAgeFrames <= RESOLUTION_SCALER.maxGpuAgeFrames
      ? gpuMs
      : undefined;
  }

  /**
   * True when this window's recurring tail or single worst sample is an order of magnitude past
   * its middle, which is a stall rather than a frame rate. A window with no p50 to compare against
   * says nothing either way.
   */
  #stalled(window: IScalerWindow): boolean {
    const { max, p50, p99 } = window.presented;
    if (!(p50 > 0) || !Number.isFinite(p99) || !Number.isFinite(max)) return false;
    return (
      p99 >= p50 * RESOLUTION_SCALER.stallP99Multiple ||
      max >= p50 * RESOLUTION_SCALER.stallMaxMultiple
    );
  }

  /**
   * How many rungs one down-step should cross, from the fps deficit alone.
   *
   * Each rung is `0.72x` the pixels, so closing a deficit of `target / measured` needs
   * `log(deficit) / log(1 / 0.72)` rungs if the whole frame scaled with pixels. It does not — but
   * a single window cannot say how much of it does, and the up-step is there to give back what
   * this takes too eagerly.
   */
  #rungsToDrop(fps: number): number {
    if (!(fps > 0)) return RESOLUTION_SCALER.maxDownRungs;
    const deficit = this.targetFps / fps;
    if (!(deficit > 1)) return 1;
    const rungs = Math.ceil(Math.log(deficit) / Math.log(1 / RUNG_PIXEL_RATIO));
    return Math.min(Math.max(1, rungs), RESOLUTION_SCALER.maxDownRungs);
  }

  #step(direction: number, countGuard = true): number {
    // The boundary a fall from rung n crosses is the same one the climb back to n crosses.
    const boundary = direction > 0 ? this.#index : this.#index - 1;
    this.#index = Math.min(
      RESOLUTION_SCALER.rungs.length - 1,
      Math.max(0, this.#index + direction),
    );
    this.#cooldown = RESOLUTION_SCALER.cooldownWindows;
    // A refund is a measurement correction, not workload oscillation: counting it would let
    // probe/refund cycles pin the scaler at a rung pixels were just proven not to earn.
    if (countGuard) this.#noteForOscillationGuard(boundary, direction);
    return this.scale;
  }

  #noteForOscillationGuard(boundary: number, direction: number): void {
    const withinReach =
      this.#windowIndex - this.#guardWindow <= RESOLUTION_SCALER.oscillationWindows;
    const continues =
      boundary === this.#guardBoundary && withinReach && direction !== this.#guardDirection;
    this.#guardLegs = continues ? this.#guardLegs + 1 : 1;
    this.#guardBoundary = boundary;
    this.#guardDirection = direction;
    this.#guardWindow = this.#windowIndex;
    // down, up, down is one cycle. The next cycle reuses this leg as its first.
    if (this.#guardLegs < 3) return;
    this.#guardLegs = 1;
    this.#guardCycles += 1;
    if (this.#guardCycles < RESOLUTION_SCALER.oscillationCycles) return;
    // Suppress upward probes temporarily; neither recovery nor later overload may be locked out
    // for the rest of a session because the workload once sat near a thermal edge.
    this.#index = Math.max(this.#index, boundary + 1);
    this.#scaleSource = "auto-pinned";
    this.#pinWindows = RESOLUTION_SCALER.oscillationWindows;
  }
}
