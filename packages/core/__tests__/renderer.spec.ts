import { Object3D, PerspectiveCamera, Scene } from "three";
import { pass } from "three/tsl";
import { RenderPipeline } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { createRenderer, prewarm } from "../src/renderer.js";

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
  it("defers platform resize and reports the old buffer until compilation releases it", async () => {
    const canvas = testCanvas();
    let resize = () => {};
    let width = 320;
    let finish = () => {};
    const sizes: number[] = [];
    const renderer = await createRenderer({
      source: {
        createCanvas: () => canvas,
        hasWebGPU: () => false,
        readSize: () => [width, 180],
        observeResize: (_canvas, callback) => {
          resize = callback;
          return () => {};
        },
      },
      webgl2Factory: () => ({
        domElement: canvas,
        render: () => undefined,
        setSize: (nextWidth: number) => {
          sizes.push(nextWidth);
        },
        compileAsync: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      }),
    });
    const compilation = renderer.compileAsync(new Scene(), new PerspectiveCamera());
    try {
      width = 640;
      resize();
      width = 800;
      resize();
      expect(sizes).toEqual([320]);
      expect(renderer.surface().drawingBufferWidth).toBe(320);
      finish();
      await compilation;
      expect(sizes).toEqual([320, 800]);
      expect(renderer.surface().drawingBufferWidth).toBe(800);
    } finally {
      finish();
      await compilation;
      renderer.dispose();
    }
  });

  it("stops scheduling hidden-root compilation and deferred resize after disposal", async () => {
    const canvas = testCanvas();
    let finish = () => {};
    const calls: Object3D[] = [];
    const sizes: number[] = [];
    let disposed = false;
    const first = new Object3D();
    const second = new Object3D();
    const hidden = new Object3D();
    hidden.visible = false;
    hidden.add(first, second);
    const scene = new Scene();
    scene.add(hidden);
    prewarm([first, second]);
    const renderer = await createRenderer({
      canvas,
      preferWebGPU: false,
      webgl2Factory: () => ({
        domElement: canvas,
        render: () => undefined,
        dispose: () => {
          disposed = true;
        },
        setSize: (width: number) => {
          sizes.push(width);
        },
        compileAsync: async (root: Object3D) => {
          calls.push(root);
          if (calls.length === 1)
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
        },
      }),
    });
    const compilation = renderer.compileAsync(scene, new PerspectiveCamera());
    renderer.setResolutionScale(0.61, "auto");
    renderer.dispose();
    expect(disposed).toBe(true);
    finish();
    await compilation;
    expect(calls).toEqual([first]);
    expect(sizes).toEqual([320]);
  });
  it.each([false, true])(
    "keeps resolution targets alive until pending compilation settles (reject=%s)",
    async (reject) => {
      const canvas = testCanvas();
      let finish: (() => void) | undefined;
      let targetAlive = true;
      let compiling = false;
      const renderer = await createRenderer({
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          domElement: canvas,
          render: () => undefined,
          setSize: () => {
            if (compiling) targetAlive = false;
          },
          compileAsync: async () => {
            compiling = true;
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
            const retained = targetAlive;
            compiling = false;
            if (!retained) throw new Error("compile read a disposed depth target");
            if (reject) throw new Error("compile failed independently");
          },
        }),
      });
      const compilation = renderer.compileAsync(new Scene(), new PerspectiveCamera());
      const settled = compilation.catch((error: Error) => error.message);
      try {
        expect(renderer.compiling).toBe(true);
        expect(renderer.surface()).toMatchObject({ compiling: true });
        renderer.setResolutionScale(0.61, "auto");
        expect(renderer.surface()).toMatchObject({ resolutionScale: 1, drawingBufferWidth: 320 });
        finish?.();
        expect(await settled).toBe(reject ? "compile failed independently" : undefined);
        expect(renderer.compiling).toBe(false);
        expect(renderer.surface()).toMatchObject({
          resolutionScale: 0.61,
          drawingBufferWidth: 195,
        });
      } finally {
        finish?.();
        await settled;
        renderer.dispose();
      }
    },
  );
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

  it("should use an explicit resolution scale while keeping CSS size unchanged", async () => {
    const canvas = testCanvas();
    const sizes: Array<[number, number]> = [];
    const renderer = await createRenderer({
      canvas,
      preferWebGPU: false,
      resolutionScale: 0.5,
      webgl2Factory: () => ({
        dispose: () => undefined,
        domElement: canvas,
        render: () => undefined,
        setSize: (width: number, height: number) => sizes.push([width, height]),
      }),
    });

    expect(sizes).toEqual([[160, 90]]);
    renderer.dispose();
  });

  it("forwards the requested antialias setting to renderer backends", async () => {
    const canvas = testCanvas();
    const received: boolean[] = [];
    const renderer = await createRenderer({
      antialias: false,
      canvas,
      preferWebGPU: false,
      webgl2Factory: (_canvas, options) => {
        received.push(options.antialias);
        return {
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        };
      },
    });

    expect(received).toEqual([false]);
    renderer.dispose();
  });

  it("should reject an invalid resolution scale at construction", async () => {
    await expect(createRenderer({ resolutionScale: 0 })).rejects.toThrow(
      "renderer.resolutionScale must be finite and positive.",
    );
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

  it("retargets the explicit world pass when the rendered scene changes", async () => {
    const canvas = testCanvas();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { gpu: {} },
    });
    const renderPipeline = vi
      .spyOn(RenderPipeline.prototype, "render")
      .mockImplementation(() => {});

    try {
      const renderer = await createRenderer({
        canvas,
        webgpuFactory: () => ({
          dispose: () => undefined,
          domElement: canvas,
          init: async () => undefined,
          render: () => undefined,
          setSize: () => undefined,
        }),
      });
      const sceneA = new Scene();
      const sceneB = new Scene();
      const cameraA = new PerspectiveCamera();
      const cameraB = new PerspectiveCamera();
      const worldPass = pass(sceneA, cameraA);
      const auxiliaryPass = pass(new Scene(), new PerspectiveCamera());
      const outputNode = worldPass.add(auxiliaryPass);

      renderer.setOutputNode(outputNode, worldPass);
      renderer.render(sceneA, cameraA);
      renderer.render(sceneB, cameraB);

      expect(renderPipeline).toHaveBeenCalledTimes(2);
      expect(worldPass.scene).toBe(sceneB);
      expect(worldPass.camera).toBe(cameraB);
      expect(auxiliaryPass.scene).not.toBe(sceneB);
      renderer.dispose();
    } finally {
      renderPipeline.mockRestore();
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });

  it("rejects an output graph with multiple passes when no world pass is named", async () => {
    const canvas = testCanvas();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { gpu: {} },
    });

    try {
      const renderer = await createRenderer({
        canvas,
        webgpuFactory: () => ({
          dispose: () => undefined,
          domElement: canvas,
          init: async () => undefined,
          render: () => undefined,
          setSize: () => undefined,
        }),
      });
      const outputNode = pass(new Scene(), new PerspectiveCamera()).add(
        pass(new Scene(), new PerspectiveCamera()),
      );

      expect(() => renderer.setOutputNode(outputNode)).toThrow("TN_RENDER_OUTPUT_PASS_AMBIGUOUS");
      renderer.dispose();
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });

  it("feeds automatic render-chain tiers from the renderer's frame-budget observer", async () => {
    const canvas = testCanvas();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { gpu: {} },
    });

    try {
      const renderer = await createRenderer({
        canvas,
        webgpuFactory: () => ({
          domElement: canvas,
          init: async () => undefined,
          render: () => undefined,
          setSize: () => undefined,
        }),
      });
      const chain = renderer.createRenderChain?.({
        input: {},
        request: { stages: ["bloom"], tier: "auto" },
        stages: [{ build: (input) => input, name: "bloom" }],
      });
      if (chain === undefined || renderer.observeRenderChainBudget === undefined)
        throw new Error("render-chain observer is unavailable");

      renderer.observeRenderChainBudget({ phases: { render: { p95: 30 } } });
      renderer.observeRenderChainBudget({ phases: { render: { p95: 30 } } });

      expect(chain.applied.tier).toBe("medium");
      renderer.dispose();
      expect(chain.disposed).toBe(true);
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });

  it("draws an overlay without clearing or entering the world output pipeline", async () => {
    const canvas = testCanvas();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { gpu: {} },
    });
    const calls: Array<{ autoClear: boolean | undefined; camera: unknown; scene: unknown }> = [];

    try {
      const raw = {
        autoClear: true,
        compute: () => undefined,
        domElement: canvas,
        init: async () => undefined,
        render(scene: unknown, camera: unknown) {
          calls.push({ autoClear: this.autoClear, camera, scene });
        },
        setSize: () => undefined,
      };
      const renderer = await createRenderer({ canvas, webgpuFactory: () => raw });
      const scene = {} as never;
      const camera = {} as never;
      renderer.setOutputNode({});

      renderer.renderOverlay(scene, camera);

      expect(calls).toEqual([{ autoClear: false, camera, scene }]);
      expect(raw.autoClear).toBe(true);
      renderer.dispose();
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });
});

describe("renderer info", () => {
  it("exposes the underlying renderer's info through the wrapper", async () => {
    const canvas = testCanvas();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    try {
      const info = { render: { drawCalls: 7, triangles: 12 } };
      const renderer = await createRenderer({
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
          info,
        }),
      });
      expect(renderer.info).toBe(info);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });

  it("throws when the underlying renderer has no info instead of returning undefined", async () => {
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
      expect(() => renderer.info).toThrow(/info is unavailable on the webgl2 renderer/u);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });
});
