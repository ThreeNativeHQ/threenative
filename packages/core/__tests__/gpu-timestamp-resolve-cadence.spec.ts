import { PerspectiveCamera, Scene as ThreeScene } from "three";
import { describe, expect, it } from "vitest";
import { defineGame } from "../src/game.js";
import { createRenderer } from "../src/renderer.js";
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
    const resolveTypes: string[] = [];
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
          async resolveTimestampsAsync(this: { info?: unknown } | undefined, type = "render") {
            // Three's real method reads this.backend. An arrow stub hid a detached call.
            if (this === undefined || this.info === undefined)
              throw new Error("lost renderer receiver");
            resolves += 1;
            resolveTypes.push(type);
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
      ).toBeGreaterThanOrEqual((frames - 2) * 2);
      expect(resolveTypes.filter((type) => type === "render").length).toBeGreaterThanOrEqual(
        frames - 2,
      );
      expect(resolveTypes.filter((type) => type === "compute").length).toBeGreaterThanOrEqual(
        frames - 2,
      );
    } finally {
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: requestFrame,
      });
      await game.stop();
    }
  });
});

/**
 * Three writes `info.frame` only inside its own animation loop, and the engine deliberately does
 * not run it -- the game drives frames through the wrapper. So the 1-in-N sampler that derived its
 * frame from `raw.info.frame` read 0 forever, `0 % 8 === 0` tracked a timestamp on *every* frame, the
 * 2048-query pool filled in ~38 frames, and every reading after that was null: about 15 timestamps
 * in a 300-frame window where 37 were asked for. The sampler has to count the frames the wrapper
 * drew.
 */
describe("the GPU timestamp sampler counts the frames the engine draws", () => {
  it("tracks one frame in eight and reads a strictly advancing sample without three's animation loop", async () => {
    const canvas = testCanvas();
    const tracked: boolean[] = [];
    // Nothing advances `info.frame` but the wrapper: exactly what the engine's own frame loop not
    // running looks like. The pool is modelled as three's own shape — it keys every query by
    // `info.frame`, so the frames it resolves are the ones that recorded.
    const info = { frame: 0, render: { timestamp: 0 } };
    const resolved: number[] = [];
    const backend = { getTimestampFrames: () => resolved.slice(-1), trackTimestamp: false };
    const raw = {
      backend,
      domElement: canvas,
      info,
      init: async () => {
        backend.trackTimestamp = true;
      },
      render: () => {
        tracked.push(backend.trackTimestamp);
        if (backend.trackTimestamp) resolved.push(info.frame);
        info.render.timestamp = 5 + resolved.length * 0.01;
      },
      setSize: () => undefined,
    };
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { gpu: {} } });
    try {
      const renderer = await createRenderer({ canvas, webgpuFactory: () => raw });
      const samples: Array<number | undefined> = [];
      const frames = 40;
      for (let frame = 0; frame < frames; frame += 1) {
        renderer.render(new ThreeScene(), new PerspectiveCamera());
        samples.push(renderer.gpuFrameSample?.()?.frame);
      }

      expect(tracked.filter(Boolean)).toHaveLength(frames / 8);
      // The id has to move with the recording frames, or every read is a repeat of the first one
      // and the frame budget counts the rest stale: ~15 readings in a 300-frame window.
      const distinct = [...new Set(samples)];
      expect(distinct).toEqual([...tracked.keys()].filter((index) => tracked[index] === true));
      expect(samples.at(-1)).toBe(tracked.lastIndexOf(true));
      renderer.dispose();
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });
});
