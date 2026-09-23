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
  it("reports the age of the resolved GPU frame without treating a repeated duration as fresh", async () => {
    const canvas = testCanvas();
    const info = { frame: 10, render: { timestamp: 6.25 } };
    let timestampFrames = [7, 8];
    const renderer = await createRenderer({
      canvas,
      preferWebGPU: false,
      webgl2Factory: () => ({
        domElement: canvas,
        info,
        backend: { getTimestampFrames: () => timestampFrames },
        render: () => undefined,
        setSize: () => undefined,
      }),
    });
    try {
      expect(renderer.gpuFrameAge?.()).toBe(2);
      info.frame = 310;
      expect(renderer.gpuFrameMs()).toBe(6.25);
      expect(renderer.gpuFrameAge?.()).toBe(302);
      timestampFrames = [309];
      expect(renderer.gpuFrameAge?.()).toBe(1);
      for (const invalid of [[], [Number.NaN], [311], [-1], [1.5]]) {
        timestampFrames = invalid;
        expect(renderer.gpuFrameAge?.()).toBeUndefined();
      }
      timestampFrames = [309];
      Reflect.deleteProperty(info, "frame");
      expect(renderer.gpuFrameAge?.()).toBeUndefined();
    } finally {
      renderer.dispose();
    }
  });

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
      expect(
        renderer.gpuFrameAge?.(),
        "a renderer without a timestamp backend has no age",
      ).toBeUndefined();
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
          compileAsync: async (...args: unknown[]) => {
            warmed.push(args);
          },
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        }),
      });
      const scene = {} as never;
      const camera = {} as never;
      const targetScene = {} as never;
      await renderer.compileAsync(scene, camera, targetScene);
      expect(warmed).toEqual([[scene, camera, targetScene]]);
      renderer.dispose();
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });

  it("binds the frame-buffer target while compiling, so a depth sampler is not compiled against the wrong sample count", async () => {
    const canvas = testCanvas();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    try {
      // three's own compile() reads the frame-buffer target for its render context but never binds
      // it, so a viewport-depth copy destination is sized from that target while the bind group
      // layout for the same binding is sized from `currentSamples`. Dawn refuses the bind group and
      // the device is lost. The wrapper has to bind what is being compiled for, and put back what
      // was bound.
      const frameBufferTarget = { samples: 4 };
      const seenDuringCompile: unknown[] = [];
      // What a concurrent frame sees. three's compile yields to the render loop between objects, so
      // this must not move while the compile runs.
      const rendered: unknown[] = [];
      const raw: Record<string, unknown> = {
        needsFrameBufferTarget: true,
        _renderTarget: null,
        getRenderTarget(this: Record<string, unknown>) {
          return this._renderTarget;
        },
        _getFrameBufferTarget: () => frameBufferTarget,
        compileAsync: async () => {
          seenDuringCompile.push((raw.getRenderTarget as () => unknown).call(raw));
          rendered.push(raw._renderTarget);
        },
        domElement: canvas,
        render: () => undefined,
        setSize: () => undefined,
      };
      const renderer = await createRenderer({
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => raw as never,
      });
      await renderer.compileAsync({} as never, {} as never);
      // The sample-count question is answered ...
      expect(seenDuringCompile).toEqual([frameBufferTarget]);
      // ... without moving what a frame arriving mid-compile renders into.
      expect(rendered).toEqual([null]);
      // and the accessor is handed back afterwards.
      expect((raw.getRenderTarget as () => unknown).call(raw)).toBe(null);
      renderer.dispose();
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });

  it("leaves no frame-buffer target behind when two compiles overlap", async () => {
    const canvas = testCanvas();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    try {
      // Two compiles do overlap in a real launch: the framework's own warm-up runs while a game
      // warms its own views, and this fork's compile yields to the frame loop between objects. The
      // second compile then captures the first one's override as "what was here before" and puts it
      // back when it finishes, so `getRenderTarget()` answers the frame-buffer target forever after.
      // Nothing is drawn into the swapchain from then on: measured as a game that renders at 59 fps
      // with its presents frozen at 160 and a five-second-old picture on the screen.
      const frameBufferTarget = { samples: 4 };
      let bound: unknown = null;
      let release: (() => void) | undefined;
      const firstCompileStarted = new Promise<void>((resolve) => {
        release = resolve;
      });
      let compiles = 0;
      const renderer = await createRenderer({
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          needsFrameBufferTarget: true,
          getRenderTarget: () => bound,
          setRenderTarget: (target: unknown) => {
            bound = target;
          },
          _getFrameBufferTarget: () => frameBufferTarget,
          compileAsync: async () => {
            compiles += 1;
            // The first compile stays open across the second one's whole lifetime.
            if (compiles === 1) await firstCompileStarted;
          },
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        }),
      });
      const first = renderer.compileAsync({} as never, {} as never);
      await renderer.compileAsync({} as never, {} as never);
      release?.();
      await first;
      // The renderer must be exactly as it was found: a frame that renders now goes to the screen.
      expect(renderer.raw.getRenderTarget()).toBe(null);
      renderer.dispose();
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });

  it("hides the compile-time render target from frames that run while the compile yields", async () => {
    const canvas = testCanvas();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    try {
      // This fork's compile yields to the frame loop between objects, so frames really do run
      // inside the window where `getRenderTarget` is answering the compile's question. three's own
      // reflector saves `renderer.getRenderTarget()` at the top of its `updateBefore` and restores
      // it after drawing its mirror — so if it sees the frame-buffer target it puts the
      // frame-buffer target back, and every later frame renders into it instead of the swapchain.
      //
      // Measured before this guard, on a game whose water has a reflection: the swapchain image
      // was never acquired again after the first world frame (`TN_FRAME_NOT_PRESENTED` with
      // `texture:false`), presents froze at 137 while the loop ran at 59 fps, and the window kept
      // showing the loading screen for the rest of the session.
      const frameBufferTarget = { samples: 4 };
      let bound: unknown = null;
      const seenByCompile: unknown[] = [];
      const seenByFrame: unknown[] = [];
      let renderDuringCompile: (() => void) | undefined;
      let reflectInsideFrame: (() => void) | undefined;
      const renderer = await createRenderer({
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          needsFrameBufferTarget: true,
          getRenderTarget: () => bound,
          setRenderTarget: (target: unknown) => {
            bound = target;
          },
          _getFrameBufferTarget: () => frameBufferTarget,
          compileAsync: async (): Promise<void> => {
            seenByCompile.push(
              (renderer.raw as { getRenderTarget: () => unknown }).getRenderTarget(),
            );
            // The yield three's compile makes between objects: a frame lands here.
            renderDuringCompile?.();
            await Promise.resolve();
          },
          domElement: canvas,
          render: () => reflectInsideFrame?.(),
          setSize: () => undefined,
        }),
      });
      // A frame, through the renderer the game holds — and inside it, what three's reflector does
      // exactly: save the bound target, draw its mirror elsewhere, put back what it saved.
      reflectInsideFrame = () => {
        const raw = renderer.raw as {
          getRenderTarget: () => unknown;
          setRenderTarget: (target: unknown) => void;
        };
        const saved = raw.getRenderTarget();
        seenByFrame.push(saved);
        raw.setRenderTarget({ mirror: true });
        raw.setRenderTarget(saved);
      };
      renderDuringCompile = () => renderer.render({} as never, {} as never);
      await renderer.compileAsync({} as never, {} as never);

      // The compile still gets its answer...
      expect(seenByCompile).toEqual([frameBufferTarget]);
      // ...and a frame running inside the same window sees the screen, and restores the screen.
      expect(seenByFrame).toEqual([null]);
      expect(renderer.raw.getRenderTarget()).toBe(null);
      renderer.dispose();
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });

  it("leaves the screen bound when a node's own pass saves and restores inside the compile", async () => {
    const canvas = testCanvas();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    try {
      // three's compile runs node `updateBefore` hooks, and a reflector's does exactly this: save
      // `getRenderTarget()`, draw its mirror into its own target, put back what it saved. Inside a
      // compile that answer is the frame-buffer target, so it gets *bound* and stays bound — and
      // every frame after it renders into that target instead of the swapchain. Measured: presents
      // frozen at 137 with the loop still at 59 fps, and the window stuck on the loading screen.
      const frameBufferTarget = { samples: 4 };
      let bound: unknown = null;
      const renderer = await createRenderer({
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          needsFrameBufferTarget: true,
          getRenderTarget: () => bound,
          setRenderTarget: (target: unknown) => {
            bound = target;
          },
          _getFrameBufferTarget: () => frameBufferTarget,
          compileAsync: async (): Promise<void> => {
            const raw = renderer.raw as {
              getRenderTarget: () => unknown;
              setRenderTarget: (target: unknown) => void;
            };
            const saved = raw.getRenderTarget();
            raw.setRenderTarget({ mirror: true });
            raw.setRenderTarget(saved);
            await Promise.resolve();
          },
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        }),
      });
      await renderer.compileAsync({} as never, {} as never);
      // Nothing is bound, so the next frame goes to the screen.
      expect(bound).toBe(null);
      renderer.dispose();
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });

  it("records the actual WebGPU adapter identity in the pipeline census", async () => {
    const canvas = testCanvas();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const adapter = {
      info: {
        architecture: "rdna3",
        description: "Acme Discrete GPU",
        device: "gpu-42",
        vendor: "acme",
      },
    };
    const requestAdapter = vi.fn(async () => adapter);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { gpu: { requestAdapter } },
    });

    try {
      const renderer = await createRenderer({
        canvas,
        webgpuFactory: () => ({
          backend: { gpu: { requestAdapter } },
          domElement: canvas,
          init: async () => undefined,
          render: () => undefined,
          setSize: () => undefined,
        }),
      });

      expect(renderer.pipelineCensus?.().adapter.identity).toContain("vendor=acme");
      expect(renderer.pipelineCensus?.().adapter.identity).toContain("device=gpu-42");
      expect(renderer.pipelineCensus?.().adapter.identity).not.toBe("webgpu:Object");
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
