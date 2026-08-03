import { describe, expect, it } from "vitest";
import { createRenderer } from "../src/renderer.js";

function testCanvas(): HTMLCanvasElement {
  const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, value: 180 },
    clientWidth: { configurable: true, value: 320 },
    parentElement: { configurable: true, value: null },
  });
  return canvas as HTMLCanvasElement;
}

describe("createRenderer", () => {
  it("should fall back to WebGL2 when navigator.gpu is absent", async () => {
    const canvas = testCanvas();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    let size: [number, number] | undefined;
    let disposed = false;

    try {
      const renderer = await createRenderer({
        canvas,
        preferWebGPU: true,
        webgl2Factory: () => ({
          dispose: () => {
            disposed = true;
          },
          domElement: canvas,
          render: () => undefined,
          setSize: (width: number, height: number) => {
            size = [width, height];
          },
        }),
      });

      expect(renderer.kind).toBe("webgl2");
      expect(size).toEqual([320, 180]);
      renderer.dispose();
      expect(disposed).toBe(true);
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });
});
