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

/**
 * Three's `WebGPUTimestampQueryPool` holds 2048 queries and spends two per render pass. A
 * scene with a post-processing chain runs tens of passes per frame — a cathedral with SSGI,
 * denoise, godrays, SSR and bloom measured 27 — so the pool fills in under forty frames:
 *
 *   2048 queries / (2 per pass x 27 passes) = 37.9 frames
 *
 * Once full, three warns `Maximum number of queries exceeded` and stops recording, so
 * `renderer.info.render.timestamp` — the only thing `gpuFrameMs()` reads — goes stale and
 * every reported window carries `gpuMs: undefined`.
 *
 * The resolve was wired to the frame-budget window boundary, which is 300 frames by default.
 * That is eight times too slow to keep the pool from overflowing, and it defeats the stated
 * reason `trackTimestamp` is on unconditionally: *"This is the measurement itself"*, replacing
 * a record where "every GPU number was wall-clock algebra".
 *
 * `resolveTimestampsAsync` is fire-and-forget and already `.catch()`-guarded, so resolving per
 * frame does not put the GPU on the frame path — which was the original cadence's whole
 * concern.
 */
describe("GPU timestamp queries are resolved often enough to stay readable", () => {
  it("resolves once per rendered frame, not once per frame-budget window", async () => {
    const canvas = testCanvas();
    let frame: ((time: number) => void) | undefined;
    let resolves = 0;
    class Empty extends Scene {
      static override readonly initialState = {};
    }
    const game = defineGame({
      // Deliberately larger than the frame count below: if the resolve is wired to the window
      // boundary, no window closes and the count stays at zero.
      frameBudget: { report: () => undefined, reportEvery: 1000 },
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          domElement: canvas,
          info: { render: { timestamp: 0 } },
          render: () => undefined,
          resolveTimestampsAsync: () => {
            resolves += 1;
            return Promise.resolve(undefined);
          },
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
      const frames = 30;
      for (let index = 1; index <= frames; index += 1) frame(index * 16.7);

      // The bound that matters is not "exactly once per frame" — it is "often enough that a
      // pass-heavy scene never fills the pool". Thirty frames of a 27-pass scene is 1,620
      // queries against a 2,048 capacity, so at least one resolve must have happened well
      // inside that window.
      expect(
        resolves,
        `resolveTimestampsAsync ran ${resolves} times across ${frames} frames; the query pool fills in ~38`,
      ).toBeGreaterThanOrEqual(frames - 2);
    } finally {
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: requestFrame,
      });
      await game.stop();
    }
  });
});
