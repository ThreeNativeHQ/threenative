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
  /** React to a deficit immediately; climb only on sustained evidence. Asymmetric by design. */
  downWindows: 1,
  upWindows: 4,
  /** The resize frame is itself a hitch and must never feed the controller. */
  cooldownWindows: 1,
  /**
   * Two down-up-down cycles across one boundary, each leg inside this many windows, pins it.
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

export interface IResolutionScalerOptions {
  /** The `display.maxFps` the loop is holding the budget against. */
  readonly targetFps: number;
  /** Which rung to start on. Must be one of the rungs; defaults to the ceiling. */
  readonly start?: number;
}

/** The only shape the scaler reads: one closed frame-budget window's fps and presented tail. */
export interface IScalerWindow {
  /** Frames per second this window achieved, from the mean presented interval. */
  readonly fps: number;
  readonly presented: { readonly p95: number };
}

export class ResolutionScaler {
  /** fps at or above this is meeting the target. */
  readonly targetFps: number;
  /** presented p95 above this is dropping frames, whatever the mean says. */
  readonly tailMs: number;
  #index: number;
  #scaleSource: Exclude<ScaleSource, "pinned"> = "auto";
  #cleanWindows = 0;
  #cooldown = 0;
  #windowIndex = 0;
  // Oscillation state. A "boundary" is the higher of the two rungs a step crossed, so a fall
  // from 1.0 and the climb back to it are recognised as the same boundary.
  #guardBoundary = -1;
  #guardDirection: -1 | 0 | 1 = 0;
  #guardLegs = 0;
  #guardCycles = 0;
  #guardWindow = 0;

  constructor(options: IResolutionScalerOptions) {
    const { start, targetFps } = options;
    if (!Number.isFinite(targetFps) || targetFps <= 0)
      throw new Error(
        `ResolutionScaler targetFps must be a finite number greater than zero, received ${String(targetFps)}.`,
      );
    this.targetFps = targetFps * RESOLUTION_SCALER.targetFpsFraction;
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
    if (this.#scaleSource === "auto-pinned") return undefined;
    if (this.#cooldown > 0) {
      this.#cooldown -= 1;
      return undefined;
    }
    if (window.fps < this.targetFps) {
      this.#cleanWindows = 0;
      if (this.#index >= RESOLUTION_SCALER.rungs.length - 1) {
        this.#atFloor = true;
        return undefined;
      }
      return this.#step(1);
    }
    this.#atFloor = false;
    if (window.presented.p95 > this.tailMs) {
      this.#cleanWindows = 0;
      return undefined;
    }
    this.#cleanWindows += 1;
    if (this.#cleanWindows < RESOLUTION_SCALER.upWindows) return undefined;
    this.#cleanWindows = 0;
    if (this.#index === 0) return undefined;
    return this.#step(-1);
  }

  #step(direction: 1 | -1): number {
    // The boundary a fall from rung n crosses is the same one the climb back to n crosses.
    const boundary = direction === 1 ? this.#index : this.#index - 1;
    this.#index += direction;
    this.#cooldown = RESOLUTION_SCALER.cooldownWindows;
    this.#noteForOscillationGuard(boundary, direction);
    return this.scale;
  }

  #noteForOscillationGuard(boundary: number, direction: 1 | -1): void {
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
    // A thermal edge produces exactly this, and a visibly pumping resolution is worse than a
    // marginally softer one. Hold the lower rung of the boundary for the rest of the session.
    this.#index = Math.max(this.#index, boundary + 1);
    this.#scaleSource = "auto-pinned";
  }
}
