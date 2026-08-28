import { describe, expect, it } from "vitest";
import { createRenderer } from "../src/renderer.js";

/**
 * PRD-228 Phase 1's last item. Native now reports a real `devicePixelRatio` and a canvas measured
 * in logical (CSS) pixels, as the web platform defines them. The drawing buffer must not move a
 * pixel for that: `logical × ratio` is the same physical surface it always was, and every game
 * that tuned a scale against it keeps the frame it tuned.
 */
function testCanvas(logicalWidth: number, logicalHeight: number): HTMLCanvasElement {
  const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, value: logicalHeight },
    clientWidth: { configurable: true, value: logicalWidth },
    parentElement: { configurable: true, value: null },
  });
  return canvas as HTMLCanvasElement;
}

async function renderer(
  options: { pixelRatio?: number; resolutionScale?: number },
  canvas: HTMLCanvasElement,
) {
  return createRenderer({
    ...options,
    canvas,
    preferWebGPU: false,
    webgl2Factory: () => ({
      domElement: canvas,
      render: () => undefined,
      setSize: () => undefined,
    }),
  });
}

describe("renderer pixel ratio", () => {
  it("draws into logical × ratio × scale, which is the physical surface it always used", async () => {
    // A Pixel 8: 2400×1080 physical at 2.625 device pixels per CSS pixel, so 914×411 logical.
    const created = await renderer(
      { pixelRatio: 2.625, resolutionScale: 0.32 },
      testCanvas(914, 411),
    );
    // 914 × 2.625 × 0.32 = 767.8 -> 768, the exact buffer every pinned 0.32 arm measured.
    expect(created.surface().drawingBufferWidth).toBe(768);
    created.dispose();
  });

  it("defaults to a ratio of one, so web keeps its intentional DPR-1 buffer", async () => {
    // Web ships DPR 1 deliberately; unifying it onto real device density is a separate decision
    // with its own visuals gate, and this option is where that decision would be made.
    const created = await renderer({ resolutionScale: 1 }, testCanvas(1280, 720));
    expect(created.surface().drawingBufferWidth).toBe(1280);
    expect(created.surface().drawingBufferHeight).toBe(720);
    created.dispose();
  });

  it("refuses a ratio that cannot describe a display", async () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        renderer({ pixelRatio: bad }, testCanvas(100, 100)),
        `ratio ${String(bad)}`,
      ).rejects.toThrow(/pixelRatio/u);
    }
  });
});
