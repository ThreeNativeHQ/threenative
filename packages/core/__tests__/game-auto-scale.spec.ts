import { describe, expect, it } from "vitest";
import { defineGame } from "../src/game.js";
import { Scene } from "../src/scene.js";

function testCanvas(): HTMLCanvasElement {
  const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, value: 1080 },
    clientWidth: { configurable: true, value: 2400 },
    parentElement: { configurable: true, value: null },
  });
  return canvas as HTMLCanvasElement;
}

class Empty extends Scene {
  static override readonly initialState = {};
}

/**
 * `resolutionScale: "auto"` has to move the drawing buffer, and a pinned number has to stop it
 * dead. Both halves are the contract; the second is what makes the first safe to ship on by
 * default, because a game that found its own constant keeps exactly the frame it tuned.
 */
async function run(
  render: Record<string, unknown>,
  presentedP95: number,
  windows: number,
): Promise<{ scale: number; scaleSource: string }> {
  const canvas = testCanvas();
  let frame: ((time: number) => void) | undefined;
  const game = defineGame({
    display: { maxFps: 60 },
    frameBudget: { report: () => {}, reportEvery: 1 },
    render,
    renderer: {
      canvas,
      preferWebGPU: false,
      webgl2Factory: () => ({
        domElement: canvas,
        render: () => undefined,
        setSize: () => undefined,
      }),
    },
    scenes: { test: Empty },
    start: "test",
  });
  const requestFrame = globalThis.requestAnimationFrame;
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: (time: number) => void) => {
      frame = callback;
      return 1;
    },
  });
  try {
    await game.start();
    if (frame === undefined) throw new Error("Game did not start its loop.");
    let time = 0;
    // Reach readiness before measuring anything. The scaler deliberately ignores windows that
    // close before the world is up — the ones that close during a launch are asset decode, scene
    // construction and first-use compilation, not the game — and this harness used to drive
    // straight past that and assert on windows the scaler now refuses. Its assertions were
    // therefore passing *because* of the defect: on a real 46,190-instance forest the first two
    // windows reported 18.8 and 27.3 fps and the buffer fell three rungs before the player had
    // control. So the ramp is in-budget frames, awaited so the readiness promise chain can settle.
    for (let index = 0; index < 10; index += 1) {
      time += 8;
      frame(time);
      await Promise.resolve();
    }
    await game.ctx?.startup.whenReady();
    for (let index = 0; index < windows; index += 1) {
      time += presentedP95;
      frame(time);
      await Promise.resolve();
    }
    const surface = game.ctx?.renderer.surface();
    return {
      scale: surface?.resolutionScale ?? Number.NaN,
      scaleSource: surface?.scaleSource ?? "?",
    };
  } finally {
    await game.stop();
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: requestFrame,
    });
  }
}

describe('resolutionScale: "auto"', () => {
  it("falls off the ceiling when the presented tail is over the budget", async () => {
    const result = await run({ resolutionScale: "auto" }, 40, 6);
    expect(result.scale).toBeLessThan(1);
    expect(result.scaleSource).toBe("auto");
  });

  it("does not move a pinned scale, however far over budget the frame runs", async () => {
    const result = await run({ resolutionScale: 0.44 }, 40, 12);
    expect(result).toEqual({ scale: 0.44, scaleSource: "pinned" });
  });

  it("reports atFloor once the scaler has run out of rungs and the frame is still over budget", async () => {
    // Measured on a physical Pixel 8 the same day: Bayview walked all ten rungs to 0.23 and was
    // still under 60 fps, because 13.79 ms of its frame does not scale with pixels at all. A
    // window reporting 0.23 and nothing else would read as a budget met at a low resolution.
    const canvas = testCanvas();
    let frame: ((time: number) => void) | undefined;
    const windows: Array<{ surface?: { atFloor: boolean; resolutionScale: number } }> = [];
    const game = defineGame({
      display: { maxFps: 60 },
      frameBudget: { onWindow: (w) => windows.push(w), report: () => {}, reportEvery: 1 },
      render: { resolutionScale: "auto" },
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        }),
      },
      scenes: { test: Empty },
      start: "test",
    });
    const requestFrame = globalThis.requestAnimationFrame;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: (time: number) => void) => {
        frame = callback;
        return 1;
      },
    });
    try {
      await game.start();
      if (frame === undefined) throw new Error("Game did not start its loop.");
      // Ten rungs at one step plus one cooldown window each, then a few windows at the floor.
      for (let index = 1; index <= 30; index += 1) frame(index * 60);
      const last = windows.at(-1);
      expect(last?.surface?.resolutionScale).toBe(0.23);
      expect(last?.surface?.atFloor).toBe(true);
      expect(windows[0]?.surface?.atFloor).toBe(false);
    } finally {
      await game.stop();
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: requestFrame,
      });
    }
  });

  it("moves only the 3D drawing buffer: not the camera, the aspect or the CSS surface", async () => {
    // The arrangement the device ladder measured and accepted. A scaler that reframed the shot or
    // shrank the UI would buy its frame budget by changing the game, which is not mechanism.
    const canvas = testCanvas();
    let frame: ((time: number) => void) | undefined;
    const sized: Array<readonly [number, number, boolean | undefined]> = [];
    const game = defineGame({
      display: { maxFps: 60 },
      frameBudget: { report: () => {}, reportEvery: 1 },
      render: { resolutionScale: "auto" },
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          domElement: canvas,
          render: () => undefined,
          setSize: (width: number, height: number, updateStyle?: boolean) => {
            sized.push([width, height, updateStyle]);
          },
        }),
      },
      scenes: { test: Empty },
      start: "test",
    });
    const requestFrame = globalThis.requestAnimationFrame;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: (time: number) => void) => {
        frame = callback;
        return 1;
      },
    });
    try {
      await game.start();
      if (frame === undefined) throw new Error("Game did not start its loop.");
      const camera = game.ctx?.camera as { aspect?: number } | undefined;
      const aspectBefore = camera?.aspect;
      // Same readiness ramp as `run()` above, and for the same reason: the scaler ignores windows
      // that close before the world is up, so a loop that never reaches readiness measures a
      // scaler that was never allowed to act.
      let time = 0;
      for (let index = 0; index < 10; index += 1) {
        time += 8;
        frame(time);
        await Promise.resolve();
      }
      await game.ctx?.startup.whenReady();
      for (let index = 0; index < 6; index += 1) {
        time += 40;
        frame(time);
        await Promise.resolve();
      }
      expect(sized.length).toBeGreaterThan(1);
      // Every resize leaves the CSS/UI surface alone; only the drawing buffer moves.
      expect(sized.every(([, , updateStyle]) => updateStyle === false)).toBe(true);
      expect(sized.at(-1)?.[0]).toBeLessThan(2400);
      expect(camera?.aspect).toBe(aspectBefore);
    } finally {
      await game.stop();
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: requestFrame,
      });
    }
  });

  it("does not sell resolution for frames measured before the world was up", async () => {
    // The blur bug, as a gate. The owner's report was "after a while everything becomes blurry,
    // and keeps getting worse", and the mechanism was measured on a 46,190-instance forest: the
    // first frame-budget windows close during asset decode, scene construction and first-use
    // compilation, they reported 18.8 and 27.3 fps against a 60 fps budget, `#rungsToDrop` crossed
    // three rungs on a deficit that large, and the drawing buffer went 1600x900 -> 976x549 before
    // the player had control. It then settled at 0.72 — 52% of the pixels — re-probed 0.85 every
    // thirty seconds, missed, and fell back, so the picture never fully recovered.
    //
    // Those windows are not the game. This asserts the scaler never acts on them.
    const canvas = testCanvas();
    let frame: ((time: number) => void) | undefined;
    let releaseTier: () => void = () => undefined;
    class Streaming extends Scene {
      static override readonly initialState = {};
      override load(ctx: Parameters<Scene["load"]>[0]): void {
        ctx.startup.hold(
          "detail-tier",
          new Promise<void>((resolve) => {
            releaseTier = resolve;
          }),
        );
      }
    }
    const game = defineGame({
      display: { maxFps: 60 },
      frameBudget: { report: () => {}, reportEvery: 1 },
      render: { resolutionScale: "auto" },
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        }),
      },
      scenes: { test: Streaming },
      start: "test",
    });
    const requestFrame = globalThis.requestAnimationFrame;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: (time: number) => void) => {
        frame = callback;
        return 1;
      },
    });
    try {
      await game.start();
      if (frame === undefined) throw new Error("Game did not start its loop.");
      // Frames far over a 60 fps budget — 100 ms apart, which is the shape of a launch window.
      // Twenty of them is many more rungs than the scaler needs to reach its floor.
      //
      // The scene holds startup, which is what keeps this window pre-readiness. That is not a
      // contrivance: it is exactly what a game with a second asset tier does, and it is why the
      // real forest spent twenty seconds before readiness with its slowest windows inside that
      // span. Note also that readiness cannot be held off simply by driving slow frames here —
      // `observe()` measures the frame callback's own duration, not the interval between frames,
      // and this fake callback is nearly free.
      let time = 0;
      for (let index = 0; index < 20; index += 1) {
        time += 100;
        frame(time);
        await Promise.resolve();
      }
      const duringLoad = game.ctx?.renderer.surface();
      expect(duringLoad?.resolutionScale).toBe(1);
      expect(duringLoad?.atFloor).toBe(false);

      // And the control: the same over-budget windows *after* readiness must still scale, or this
      // test would pass just as well against a scaler that had been switched off entirely.
      releaseTier();
      await game.ctx?.startup.whenReady();
      for (let index = 0; index < 6; index += 1) {
        time += 100;
        frame(time);
        await Promise.resolve();
      }
      expect(game.ctx?.renderer.surface().resolutionScale).toBeLessThan(1);
    } finally {
      await game.stop();
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: requestFrame,
      });
    }
  });
});
