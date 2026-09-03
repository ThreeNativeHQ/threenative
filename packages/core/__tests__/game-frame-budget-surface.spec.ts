import { describe, expect, it } from "vitest";
import { FRAME_BUDGET_MARKER } from "../src/frame-budget.js";
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
 * The reporting half of PRD-228's Change A. The scale field already shipped; nothing downstream
 * could see it, so the perf record drifted to `0.36` while the tree held `0.32` for a session.
 * The loop is the only place that knows both the renderer and the window boundary, so it is the
 * only place this can be wired — and it must be wired whether the scale was pinned or chosen.
 */
describe("the frame budget names the surface the game's own loop drew", () => {
  it("carries the applied scale and drawing buffer into every reported window", async () => {
    const canvas = testCanvas();
    let frame: ((time: number) => void) | undefined;
    const lines: string[] = [];
    class Empty extends Scene {
      static override readonly initialState = {};
    }
    const game = defineGame({
      frameBudget: { report: (line) => lines.push(line), reportEvery: 2 },
      render: { android: { resolutionScale: 0.32 }, resolutionScale: 0.5 },
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
      for (let index = 1; index <= 4; index += 1) frame(index * 16.7);
      const marker = lines.find((line) => line.startsWith(`${FRAME_BUDGET_MARKER}:`));
      expect(marker, "no frame-budget window was reported").toBeDefined();
      const reported = JSON.parse(marker?.slice(FRAME_BUDGET_MARKER.length + 1) ?? "{}");
      expect(reported.surface).toEqual({
        atFloor: false,
        drawingBufferHeight: 540,
        drawingBufferWidth: 1200,
        resolutionScale: 0.5,
        sampleCount: 1,
        scaleSource: "pinned",
      });
    } finally {
      await game.stop();
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: requestFrame,
      });
    }
  });

  it("carries a positive GPU timestamp into the reported frame window", async () => {
    const canvas = testCanvas();
    let frame: ((time: number) => void) | undefined;
    const lines: string[] = [];
    class Empty extends Scene {
      static override readonly initialState = {};
    }
    const game = defineGame({
      frameBudget: { report: (line) => lines.push(line), reportEvery: 2 },
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          domElement: canvas,
          info: { render: { timestamp: 6.25 } },
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
      frame(16.7);
      frame(33.4);

      const marker = lines.find((line) => line.startsWith(`${FRAME_BUDGET_MARKER}:`));
      expect(marker).toBeDefined();
      expect(JSON.parse(marker?.slice(FRAME_BUDGET_MARKER.length + 1) ?? "{}")).toMatchObject({
        gpuMs: 6.25,
        frames: 2,
      });
    } finally {
      await game.stop();
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: requestFrame,
      });
    }
  });

  it("keeps rendering and omits GPU time when timestamp resolution rejects", async () => {
    const canvas = testCanvas();
    let frame: ((time: number) => void) | undefined;
    let renders = 0;
    const lines: string[] = [];
    class Empty extends Scene {
      static override readonly initialState = {};
    }
    const game = defineGame({
      frameBudget: { report: (line) => lines.push(line), reportEvery: 2 },
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          domElement: canvas,
          info: { render: { timestamp: 0 } },
          render: () => {
            renders += 1;
          },
          resolveTimestampsAsync: () => Promise.reject(new Error("timestamp unavailable")),
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
      frame(16.7);
      frame(33.4);
      await Promise.resolve();

      const marker = lines.find((line) => line.startsWith(`${FRAME_BUDGET_MARKER}:`));
      expect(renders).toBe(2);
      expect(marker).toBeDefined();
      expect(JSON.parse(marker?.slice(FRAME_BUDGET_MARKER.length + 1) ?? "{}")).not.toHaveProperty(
        "gpuMs",
      );
    } finally {
      await game.stop();
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: requestFrame,
      });
    }
  });
});
