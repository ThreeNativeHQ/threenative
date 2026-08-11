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
  // Without this on the wrapper a game must cast through `.raw` to warm up, and a game that
  // cannot warm up without a cast will not warm up. 2,500 ms of a 2,882 ms Pixel 8 cold start is
  // spent compiling pipelines on first draw.
  it("forwards compileAsync so a game can warm up pipelines before the first visible frame", async () => {
    const canvas = testCanvas();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    try {
      const warmed: unknown[] = [];
      const renderer = await createRenderer({
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          compileAsync: async (scene: unknown, camera: unknown) => {
            warmed.push([scene, camera]);
          },
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        }),
      });
      const scene = {} as never;
      const camera = {} as never;
      await renderer.compileAsync(scene, camera);
      expect(warmed).toEqual([[scene, camera]]);
      renderer.dispose();
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });

  // A renderer that compiles on first draw needs no warm-up and must not fail one. Throwing here
  // would push a platform branch into every game that calls it.
  it("resolves quietly when the renderer has no compileAsync of its own", async () => {
    const canvas = testCanvas();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    try {
      const renderer = await createRenderer({
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        }),
      });
      await expect(renderer.compileAsync({} as never, {} as never)).resolves.toBeUndefined();
      renderer.dispose();
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });

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

  it("dispatches compute only through WebGPU and fails closed on WebGL2", async () => {
    const canvas = testCanvas();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const dispatched: unknown[] = [];
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { gpu: {} },
    });

    try {
      const webgpu = await createRenderer({
        canvas,
        webgpuFactory: () => ({
          compute: (node: unknown) => dispatched.push(node),
          dispose: () => undefined,
          domElement: canvas,
          init: async () => undefined,
          render: () => undefined,
          setSize: () => undefined,
        }),
      });
      const node = {};
      webgpu.compute(node);
      expect(dispatched).toEqual([node]);
      const originalRender = (webgpu.raw as { render: () => void }).render;
      expect(() => webgpu.setOutputNode({})).not.toThrow();
      expect((webgpu.raw as { render: () => void }).render).toBe(originalRender);
      webgpu.dispose();

      const webgl = await createRenderer({
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => undefined,
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        }),
      });
      expect(() => webgl.compute(node)).toThrow("webgl2");
      expect(() => webgl.setOutputNode({})).toThrow("webgl2");
      webgl.dispose();
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });

  it("replaces and disposes only the framework-owned output pipeline", async () => {
    const canvas = testCanvas();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { gpu: {} },
    });
    let disposed = 0;
    const originalRender = () => undefined;

    try {
      const renderer = await createRenderer({
        canvas,
        webgpuFactory: () => ({
          compute: () => undefined,
          dispose: () => {
            disposed += 1;
          },
          domElement: canvas,
          init: async () => undefined,
          render: originalRender,
          setSize: () => undefined,
          toneMapping: 0,
        }),
      });
      const raw = renderer.raw as { render: () => void };
      expect(raw.render).toBe(originalRender);
      renderer.setOutputNode({});
      renderer.setOutputNode({});
      expect(raw.render).toBe(originalRender);
      renderer.dispose();
      expect(disposed).toBe(1);
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });
});
