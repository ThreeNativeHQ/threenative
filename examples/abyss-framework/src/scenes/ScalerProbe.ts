import { type ICtx, type IFrameBudgetWindow, Scene, type SceneFrame } from "@threenative/core";
import {
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type PerspectiveCamera,
} from "three";

/**
 * Does the picture come back after the thing that cost the frame goes away?
 *
 * `renderer.resolutionScale: "auto"` buys the `display.maxFps` budget with pixels. Spending them
 * is easy to prove and easy to get right; **giving them back is the half that was broken**, and it
 * is the half a player notices — the owner's report on `sandbox/wildwood` was that the picture went
 * soft a few seconds in and never recovered, getting worse the longer they played.
 *
 * A unit test can put any window it likes in front of the controller. What it cannot do is prove
 * that a real loop, on a real renderer, with real presented intervals, climbs back out. This drives
 * that end to end in three phases, all self-driving off closed frame-budget windows so the scenario
 * only has to wait:
 *
 *  1. **Burn.** Every frame is deliberately taken past the 16.7 ms budget, so the scaler does what
 *     it is supposed to do and steps down. If this phase does not move the scale the run has proved
 *     nothing and `scaleMin` fails the scenario rather than passing on a scale that never left 1.
 *  2. **Recover, interrupted.** The burn stops — every frame is now far inside budget — but one
 *     frame in every third window blocks for `STALL_MS`. That is a scene streaming its next
 *     hillside, a late pipeline compile, a GC: an order of magnitude past the median, which the
 *     controller correctly declines to read as a frame rate.
 *  3. **Settle.** The interruptions stop, so a controller that merely needed a few more windows
 *     still gets them, and a failure here is a controller that cannot climb rather than one that
 *     ran out of room.
 *
 * Phase 2 is the whole test. Deferring a stalled window used to also reset the run of clean windows
 * the climb needs, so a game hitching more often than once every `cooldownWindows + upWindows`
 * windows could never climb, however fast every other frame was. Against that controller this scene
 * stays where the burn left it for the rest of the run.
 *
 * Nothing here decides how anything looks: the probe owns its own boxes and its own colours exactly
 * as any game would, and it reads the scale off the window the engine already reports.
 *
 * **Unfinished, and deliberately wired into no gate — `playtests/scaler-recovery.playtest.json`
 * is named by nothing.** The scene, the entry and the scenario are correct as far as they were
 * taken and the run completes, but the harness does not hand the engine anywhere near one frame
 * per `waitFrames`: 500 wait-frames with the burn off closed **zero** 60-frame windows, and a
 * 3,200-wait-frame run closed four. Until that mapping is understood the scenario cannot reach the
 * ~40 windows a climb needs, and a scenario that cannot reach its own precondition is not a gate —
 * it is a flake waiting to be believed. Measured 2026-09-03; `windows` is asserted with a floor
 * precisely so this fails closed rather than passing on an empty run.
 *
 * Two things the next person should check first: whether the playtest bridge's `runtime.fixedStep`
 * stepping is driving the loop instead of the page's own rAF, and whether the captured console tail
 * (7 entries in one observed report) is hiding markers that did fire. The `windows` counter here
 * comes from `onWindow` directly and is authoritative; the console marker count is not.
 */

/** Frames per reported window, set on the game's own frame budget. Short so the run is seconds. */
export const SCALER_PROBE_REPORT_EVERY = 60;
/**
 * Windows spent over budget. Warm-up eats one and every step costs its cooldown, so four windows
 * is about two rungs — enough to have something to climb, few enough that the climb is not the
 * length of the run. The burn is CPU work, so it does not get cheaper as the buffer shrinks: left
 * running it would walk to the floor, which is a different test.
 */
const BURN_WINDOWS = 4;
/** Windows spent recovering with one stall in every `STALL_EVERY`. */
const INTERRUPTED_WINDOWS = 18;
/** Windows spent recovering with nothing interrupting. */
const SETTLE_WINDOWS = 20;
/**
 * Milliseconds of real work per frame during the burn. Past a 16.7 ms budget by enough that the
 * median frame is over it — which is what makes the step down correct — and far under the
 * 10x-median line that would make the controller read the window as a stall instead.
 */
const BURN_MS = 24;
/**
 * One blocking frame, an order of magnitude past a recovered frame's median. Under the 2 s hitch
 * threshold on purpose: a hitch is excluded from the window outright, and the window this scene is
 * about is one that *keeps* the outlier and has to recognise it.
 */
const STALL_MS = 400;
/** A stall lands on the first frame of every third window. */
const STALL_EVERY = 3;

const initialState = {
  phase: "burn",
};

export type ScalerState = typeof initialState;
type ScalerCtx = ICtx<ScalerState>;

/**
 * What the probe measures. Shared with the entry module because the frame budget is configured on
 * `defineGame` and the components are published by the scene, and the two have to be the same run.
 */
export const scalerProbeMeasure = {
  /** Closed frame-budget windows the controller was handed. A floor on this fails the run closed. */
  windows: 0,
  /** Windows in which this scene deliberately blocked one frame. */
  stallsInjected: 0,
  /** The scale the last closed window was drawn at. */
  scaleNow: 1,
  /** The lowest scale any window reported. This is what proves the scale ever left the ceiling. */
  scaleMin: 1,
  /** Whether the engine reported it had run out of rungs. */
  atFloor: false,
  /** How the scale was arrived at. `auto-pinned` would mean the oscillation guard fired. */
  scaleSource: "auto",
};

/** Wired into `defineGame({ frameBudget: { onWindow } })`, which is the same window the marker prints. */
export function observeScalerWindow(window: IFrameBudgetWindow): void {
  scalerProbeMeasure.windows += 1;
  const surface = window.surface;
  if (surface === undefined) return;
  scalerProbeMeasure.scaleNow = surface.resolutionScale;
  scalerProbeMeasure.scaleMin = Math.min(scalerProbeMeasure.scaleMin, surface.resolutionScale);
  scalerProbeMeasure.atFloor = surface.atFloor === true;
  scalerProbeMeasure.scaleSource = surface.scaleSource;
}

/** Occupies the thread for `ms`, which is the only way to cost a frame something a renderer cannot skip. */
function block(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // Spin. `Atomics.wait` is unavailable on the main thread and a timer would yield the frame.
  }
}

export class ScalerProbe extends Scene<ScalerState> {
  static override readonly initialState = initialState;

  #stalledWindow = -1;

  override enter(ctx: ScalerCtx): SceneFrame<ScalerState> {
    const camera = ctx.camera as PerspectiveCamera;
    camera.position.set(0, 0, 18);
    camera.lookAt(0, 0, 0);
    ctx.scene.background = new Color(0x0b1a2a);

    // The probe's own appearance, as any game's would be: enough boxes that the frame is not empty,
    // and a palette so a capture can tell the frame from a blank one.
    const geometry = new BoxGeometry(0.6, 0.6, 0.6);
    const palette = Array.from(
      { length: 16 },
      (_unused, hue) => new MeshBasicMaterial({ color: new Color().setHSL(hue / 16, 0.7, 0.55) }),
    );
    const boxes: Object3D[] = Array.from({ length: 256 }, (_unused, index) => {
      const column = index % 32;
      const row = Math.floor(index / 32);
      const box = new Mesh(geometry, palette[(column + row) % palette.length]);
      box.position.set(column * 0.75 - 11.6, 6 - row * 0.75, 0);
      return box;
    });
    for (const box of boxes) ctx.add(box);

    ctx.entities.add("scaler", { debug: () => ({ ...scalerProbeMeasure }) });

    return (frameCtx) => {
      const window = scalerProbeMeasure.windows;
      const phase =
        window < BURN_WINDOWS
          ? "burn"
          : window < BURN_WINDOWS + INTERRUPTED_WINDOWS
            ? "interrupted"
            : window < BURN_WINDOWS + INTERRUPTED_WINDOWS + SETTLE_WINDOWS
              ? "settle"
              : "done";
      if (phase !== frameCtx.state.getState().phase) frameCtx.state.set({ phase });

      if (phase === "burn") {
        block(BURN_MS);
        return;
      }
      if (phase !== "interrupted") return;
      // One blocking frame per third window, on the first frame after that window closed, so the
      // outlier lands inside a window rather than on its boundary.
      if (window % STALL_EVERY !== 0 || window === this.#stalledWindow) return;
      this.#stalledWindow = window;
      scalerProbeMeasure.stallsInjected += 1;
      block(STALL_MS);
    };
  }
}
