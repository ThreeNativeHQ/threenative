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
    for (let index = 0; index < windows; index += 1) {
      time += presentedP95;
      frame(time);
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
      for (let index = 1; index <= 6; index += 1) frame(index * 40);
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
});
