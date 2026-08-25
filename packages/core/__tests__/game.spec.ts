import { readFileSync } from "node:fs";
import {
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  SphereGeometry,
} from "three";
import { describe, expect, it, vi } from "vitest";
import { type IGamePlatformSource, defineGame } from "../src/game.js";
import { InputMap } from "../src/input.js";
import type { IRenderPerformanceSample } from "../src/loop.js";
import { type ICtx, Scene } from "../src/scene.js";

function testCanvas(): HTMLCanvasElement {
  const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, value: 180 },
    clientWidth: { configurable: true, value: 320 },
    parentElement: { configurable: true, value: null },
  });
  return canvas as HTMLCanvasElement;
}

function renderer(canvas: HTMLCanvasElement) {
  return {
    canvas,
    preferWebGPU: false,
    webgl2Factory: () => ({
      dispose: () => undefined,
      domElement: canvas,
      render: () => undefined,
      setSize: () => undefined,
    }),
  };
}

class TrackingResizeObserver {
  static instances: TrackingResizeObserver[] = [];
  disconnected = false;

  constructor(_callback: ResizeObserverCallback) {
    TrackingResizeObserver.instances.push(this);
  }

  observe(_target: Element): void {}

  disconnect(): void {
    this.disconnected = true;
  }
}

class EmptyScene extends Scene {
  static override readonly initialState = {};
}

describe("IGame", () => {
  it("returns no render metrics object on either disabled render path", () => {
    const source = readFileSync(new URL("../src/game.ts", import.meta.url), "utf8");

    expect(source).toContain("if (!this.#renderMetricsEnabled) return undefined;");
    expect(source).toContain("return this.#renderMetricsEnabled ? worldMetrics : undefined;");
    expect(source).not.toContain("if (!this.#renderMetricsEnabled) return {};");
    expect(source).not.toContain("return this.#renderMetricsEnabled ? worldMetrics : {};");
  });

  it("executes the ordinary no-overlay render path with diagnostics disabled", async () => {
    const canvas = testCanvas();
    let frame: ((time: number) => void) | undefined;
    let worldRenders = 0;
    let sceneRenders = 0;
    class OrdinaryScene extends Scene {
      static override readonly initialState = {};

      override render(): void {
        sceneRenders += 1;
      }
    }
    const game = defineGame({
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          domElement: canvas,
          render: () => {
            worldRenders += 1;
          },
          setSize: () => undefined,
        }),
      },
      scenes: { test: OrdinaryScene },
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
      const ctx = game.ctx;
      if (ctx === undefined || frame === undefined) throw new Error("Game did not start its loop.");

      frame(16);
      expect(ctx.canvasLayer.scene.children).toHaveLength(0);
      expect(worldRenders).toBe(1);
      expect(sceneRenders).toBe(1);
    } finally {
      game.stop();
      if (requestFrame === undefined) Reflect.deleteProperty(globalThis, "requestAnimationFrame");
      else Object.defineProperty(globalThis, "requestAnimationFrame", { value: requestFrame });
    }
  });

  it("draws only the CanvasLayer on every opaque frame and draws it last otherwise", async () => {
    const canvas = testCanvas();
    const draws: unknown[] = [];
    const renderInfo = { drawCalls: 0, triangles: 0 };
    let diagnostics: (() => readonly IRenderPerformanceSample[]) | undefined;
    let frame: ((time: number) => void) | undefined;
    let renderHooks = 0;
    class LayerScene extends Scene {
      static override readonly initialState = {};

      override enter(ctx: ICtx): void {
        ctx.scene.add(new Mesh());
        ctx.canvasLayer.scene.add(new Mesh());
        ctx.canvasLayer.scene.name = "overlay";
        ctx.canvasLayer.opaque = true;
      }

      override render(): void {
        renderHooks += 1;
      }
    }
    const game = defineGame({
      plugins: [
        {
          setup: (_ctx, runtime) => {
            // This plugin is the diagnostics consumer; say so or nothing is collected.
            runtime?.enableRuntimeDiagnostics?.();
            diagnostics = runtime?.runtimeDiagnosticsSeries;
            return undefined;
          },
        },
      ],
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          domElement: canvas,
          info: { render: renderInfo },
          render: (scene: unknown) => {
            draws.push(scene);
            const overlay = (scene as { name?: string }).name === "overlay";
            renderInfo.drawCalls = overlay ? 1 : 3;
            renderInfo.triangles = overlay ? 2 : 30;
          },
          setSize: () => undefined,
        }),
      },
      scenes: { test: LayerScene },
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
      const ctx = game.ctx;
      if (ctx === undefined || frame === undefined) throw new Error("Game did not start its loop.");

      frame(16);
      frame(32);
      expect(draws).toEqual([ctx.canvasLayer.scene, ctx.canvasLayer.scene]);
      expect(renderHooks).toBe(0);

      draws.length = 0;
      ctx.canvasLayer.opaque = false;
      frame(48);
      expect(draws).toEqual([ctx.scene, ctx.canvasLayer.scene]);
      expect(renderHooks).toBe(1);

      draws.length = 0;
      ctx.canvasLayer.scene.clear();
      frame(64);
      expect(draws).toEqual([ctx.scene]);
      expect(renderHooks).toBe(2);
      const series = diagnostics?.() ?? [];
      // The frame budget ships on by default, so every sample carries its phase split; the
      // render-metric fields below are what this test is about.
      expect(series.every((sample) => sample.phases !== undefined)).toBe(true);
      expect(series.map(({ phases: _phases, ...sample }) => sample)).toEqual([
        { drawCalls: 1, frameMs: 16, triangles: 2 },
        { drawCalls: 4, frameMs: 16, triangles: 32 },
        { drawCalls: 3, frameMs: 16, triangles: 30 },
      ]);
    } finally {
      game.stop();
      if (requestFrame === undefined) Reflect.deleteProperty(globalThis, "requestAnimationFrame");
      else Object.defineProperty(globalThis, "requestAnimationFrame", { value: requestFrame });
    }
  });

  it("should read input from a custom target when inputTarget is provided", async () => {
    const customTarget = new EventTarget();
    const unrelatedTarget = new EventTarget();
    let advance: ((ticks: number) => number) | undefined;
    let pressed = false;
    class InputScene extends Scene {
      static override readonly initialState = {};

      override update(ctx: ICtx): void {
        pressed = ctx.input.pressed("move");
      }
    }
    const game = defineGame({
      inputTarget: customTarget,
      plugins: [
        {
          setup: (_ctx, runtime) => {
            advance = runtime?.fixedStep;
            return undefined;
          },
        },
      ],
      renderer: renderer(testCanvas()),
      scenes: { test: InputScene },
      start: "test",
    });

    await game.start();
    if (advance === undefined) throw new Error("Plugin did not receive the fixed-step runtime.");
    const keydown = new Event("keydown");
    Object.defineProperty(keydown, "code", { value: "KeyW" });
    unrelatedTarget.dispatchEvent(keydown);
    advance(1);
    expect(pressed).toBe(false);
    customTarget.dispatchEvent(keydown);
    advance(1);
    expect(pressed).toBe(true);
    game.stop();
  });

  it("should default to window when inputTarget is omitted", async () => {
    const originalWindow = globalThis.window;
    const windowTarget = new EventTarget();
    Object.defineProperty(globalThis, "window", { configurable: true, value: windowTarget });
    let advance: ((ticks: number) => number) | undefined;
    let pressed = false;
    class InputScene extends Scene {
      static override readonly initialState = {};

      override update(ctx: ICtx): void {
        pressed = ctx.input.pressed("move");
      }
    }
    const game = defineGame({
      plugins: [
        {
          setup: (_ctx, runtime) => {
            advance = runtime?.fixedStep;
            return undefined;
          },
        },
      ],
      renderer: renderer(testCanvas()),
      scenes: { test: InputScene },
      start: "test",
    });

    try {
      await game.start();
      if (advance === undefined) throw new Error("Plugin did not receive the fixed-step runtime.");
      const keydown = new Event("keydown");
      Object.defineProperty(keydown, "code", { value: "KeyW" });
      windowTarget.dispatchEvent(keydown);
      advance(1);
      expect(pressed).toBe(true);
    } finally {
      game.stop();
      if (originalWindow === undefined) Reflect.deleteProperty(globalThis, "window");
      else
        Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
  });

  it("should leave no renderer or loop when stopped during an in-flight start", async () => {
    let disposed = 0;
    let frames = 0;
    class LoadingScene extends Scene {
      static override readonly initialState = {};
    }
    const canvas = testCanvas();
    const game = defineGame({
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => {
            disposed += 1;
          },
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        }),
      },
      scenes: { test: LoadingScene },
      start: "test",
    });

    const requestFrame = globalThis.requestAnimationFrame;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: () => {
        frames += 1;
        return frames;
      },
    });
    try {
      const start = game.start();
      game.stop();
      await start;
      expect(disposed).toBe(1);
      expect(frames).toBe(0);
      expect(game.ctx).toBeUndefined();
    } finally {
      if (requestFrame === undefined) Reflect.deleteProperty(globalThis, "requestAnimationFrame");
      else Object.defineProperty(globalThis, "requestAnimationFrame", { value: requestFrame });
    }
  });

  it("sweeps queued entities after a frame", async () => {
    let advance: ((ticks: number) => number) | undefined;
    let disposed = 0;
    let queued = false;
    class QueueScene extends Scene {
      static override readonly initialState = {};

      override enter(ctx: ICtx): void {
        ctx.entities.add("coin", {
          dispose: () => {
            disposed += 1;
          },
        });
      }

      override update(ctx: ICtx): void {
        if (queued) return;
        queued = true;
        ctx.entities.queueFree("coin");
      }
    }
    const game = defineGame({
      plugins: [
        {
          setup: (_ctx, runtime) => {
            advance = runtime?.fixedStep;
            return undefined;
          },
        },
      ],
      renderer: renderer(testCanvas()),
      scenes: { test: QueueScene },
      start: "test",
    });

    await game.start();
    try {
      expect(game.ctx?.entities.get("coin")).toBeDefined();
      if (advance === undefined) throw new Error("Plugin did not receive the fixed-step runtime.");
      advance(1);
      expect(disposed).toBe(1);
      expect(game.ctx?.entities.get("coin")).toBeUndefined();
    } finally {
      game.stop();
    }
  });

  it("should dispose plugins exactly once when stopped during setup", async () => {
    let releaseSetup!: () => void;
    let disposed = 0;
    const setup = new Promise<undefined>((resolve) => {
      releaseSetup = () => resolve(undefined);
    });
    class LoadingScene extends Scene {
      static override readonly initialState = {};
    }
    const game = defineGame({
      plugins: [
        {
          setup: () => setup,
          dispose: () => {
            disposed += 1;
          },
        },
      ],
      renderer: renderer(testCanvas()),
      scenes: { test: LoadingScene },
      start: "test",
    });

    const start = game.start();
    await Promise.resolve();
    game.stop();
    releaseSetup();
    await start;
    expect(disposed).toBe(1);
  });

  it("should stay idempotent when stop is called twice", async () => {
    let disposed = 0;
    class TestScene extends Scene {
      static override readonly initialState = {};
    }
    const game = defineGame({
      plugins: [
        {
          setup: () => undefined,
          dispose: () => {
            disposed += 1;
          },
        },
      ],
      renderer: renderer(testCanvas()),
      scenes: { test: TestScene },
      start: "test",
    });

    await game.start();
    game.stop();
    game.stop();
    expect(disposed).toBe(1);
  });

  it("should fail closed after completing teardown when scene objects remain", async () => {
    class LeakyScene extends Scene {
      static override readonly initialState = {};

      override enter(ctx: ICtx): void {
        ctx.add(new Mesh());
      }
    }
    const game = defineGame({
      renderer: renderer(testCanvas()),
      scenes: { test: LeakyScene },
      start: "test",
    });
    await game.start();
    const scene = game.ctx?.scene;
    if (scene === undefined) throw new Error("IGame did not expose its scene.");
    scene.clear = () => scene;

    expect(() => game.stop()).toThrow("IGame teardown leaked scene objects.");
    expect(game.ctx).toBeUndefined();
  });

  it("should run every cleanup when an earlier cleanup throws", async () => {
    const events: string[] = [];
    let disposed = 0;
    const canvas = testCanvas();
    class TestScene extends Scene {
      static override readonly initialState = {};
    }
    const game = defineGame({
      plugins: [
        {
          setup: () => () => {
            events.push("first");
            throw new Error("first cleanup exploded");
          },
        },
        {
          setup: () => () => {
            events.push("second");
          },
        },
      ],
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => {
            disposed += 1;
          },
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        }),
      },
      scenes: { test: TestScene },
      start: "test",
    });

    await game.start();
    expect(() => game.stop()).toThrow("first cleanup exploded");
    expect(events).toEqual(["first", "second"]);
    expect(disposed).toBe(1);
    expect(game.ctx).toBeUndefined();
  });

  it("should report the first failing cleanup, not the leak check, when both would fire", async () => {
    let disposed = 0;
    const canvas = testCanvas();
    class LeakyScene extends Scene {
      static override readonly initialState = {};

      override enter(ctx: ICtx): void {
        ctx.add(new Mesh());
      }
    }
    const game = defineGame({
      plugins: [
        {
          setup: () => () => {
            throw new Error("cleanup exploded before the leak check");
          },
        },
      ],
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => {
            disposed += 1;
          },
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        }),
      },
      scenes: { test: LeakyScene },
      start: "test",
    });

    await game.start();
    const scene = game.ctx?.scene;
    if (scene === undefined) throw new Error("IGame did not expose its scene.");
    scene.clear = () => scene;
    expect(() => game.stop()).toThrow("cleanup exploded before the leak check");
    // Both failures fired: the cleanup threw AND the scene leaked. Teardown must still have
    // completed every step after the throwing one — the error reported is the cleanup's.
    // Scalar assertions: a failing matcher handed the live ctx would crash vitest's diff
    // printer on the renderer's fail-closed info getter instead of showing this.
    expect(disposed).toBe(1);
    expect(game.ctx).toBeUndefined();
  });

  it("should dispose renderer, input and run cleanups when plugin.setup throws", async () => {
    const boom = new Error("plugin setup exploded");
    const events: string[] = [];
    let disposed = 0;
    const canvas = testCanvas();
    const removeCanvas = vi.fn();
    Object.defineProperty(canvas, "remove", { configurable: true, value: removeCanvas });
    const inputDispose = vi.spyOn(InputMap.prototype, "dispose");
    class TestScene extends Scene {
      static override readonly initialState = {};
    }
    const game = defineGame({
      plugins: [
        {
          setup: () => () => {
            events.push("cleanup");
          },
        },
        {
          setup: () => {
            throw boom;
          },
        },
      ],
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => {
            disposed += 1;
          },
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        }),
      },
      scenes: { test: TestScene },
      start: "test",
    });

    try {
      await expect(game.start()).rejects.toBe(boom);
      expect(events).toEqual(["cleanup"]);
      expect(disposed).toBe(1);
      expect(inputDispose).toHaveBeenCalledTimes(1);
      expect(removeCanvas).toHaveBeenCalledTimes(1);
      expect(game.ctx).toBeUndefined();
    } finally {
      inputDispose.mockRestore();
    }
  });

  it("should tear down when scene.load rejects", async () => {
    const boom = new Error("scene load exploded");
    const events: string[] = [];
    let disposed = 0;
    const canvas = testCanvas();
    const removeCanvas = vi.fn();
    Object.defineProperty(canvas, "remove", { configurable: true, value: removeCanvas });
    class LoadingScene extends Scene {
      static override readonly initialState = {};

      override load(): Promise<void> {
        return Promise.reject(boom);
      }
    }
    const game = defineGame({
      plugins: [
        {
          setup: () => () => {
            events.push("cleanup");
          },
        },
      ],
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => {
            disposed += 1;
          },
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        }),
      },
      scenes: { test: LoadingScene },
      start: "test",
    });

    await expect(game.start()).rejects.toBe(boom);
    expect(events).toEqual(["cleanup"]);
    expect(disposed).toBe(1);
    expect(removeCanvas).toHaveBeenCalledTimes(1);
    expect(game.ctx).toBeUndefined();
  });

  it("keeps the existing perspective camera when no camera config is supplied", async () => {
    const game = defineGame({
      initialState: {},
      renderer: renderer(testCanvas()),
      scenes: { test: EmptyScene },
      start: "test",
    });

    await game.start();
    const camera = game.ctx?.camera;
    expect(camera).toBeInstanceOf(PerspectiveCamera);
    expect((camera as PerspectiveCamera).fov).toBe(60);
    expect((camera as PerspectiveCamera).near).toBe(0.1);
    expect((camera as PerspectiveCamera).far).toBe(2_000);
    game.stop();
  });

  it("creates and resizes an orthogonal camera from config", async () => {
    const game = defineGame({
      camera: { projection: "orthogonal", size: 10 },
      renderer: renderer(testCanvas()),
      scenes: { test: EmptyScene },
      start: "test",
    });

    await game.start();
    const camera = game.ctx?.camera;
    expect(camera).toBeInstanceOf(OrthographicCamera);
    expect((camera as OrthographicCamera).top).toBe(10);
    expect((camera as OrthographicCamera).bottom).toBe(-10);
    expect((camera as OrthographicCamera).right).toBeCloseTo(10 * (320 / 180));
    game.stop();
  });

  it("validates camera dimensions at defineGame time", () => {
    expect(() =>
      defineGame({
        camera: { projection: "orthogonal", size: 0 },
        renderer: renderer(testCanvas()),
        scenes: { test: EmptyScene },
        start: "test",
      }),
    ).toThrow("camera.size");
    expect(() =>
      defineGame({
        camera: { far: -1, projection: "perspective" },
        renderer: renderer(testCanvas()),
        scenes: { test: EmptyScene },
        start: "test",
      }),
    ).toThrow("camera.far");
  });

  it("uses scene initial state when config state is absent and lets config win", async () => {
    class StatefulScene extends Scene<{ value: number }> {
      static override readonly initialState = { value: 7 };
    }
    const fromScene = defineGame<{ value: number }>({
      renderer: renderer(testCanvas()),
      scenes: { test: StatefulScene },
      start: "test",
    });
    await fromScene.start();
    expect(fromScene.state.getState()).toEqual({ value: 7 });
    fromScene.stop();

    const fromConfig = defineGame<{ value: number }>({
      initialState: { value: 11 },
      renderer: renderer(testCanvas()),
      scenes: { test: StatefulScene },
      start: "test",
    });
    await fromConfig.start();
    expect(fromConfig.state.getState()).toEqual({ value: 11 });
    fromConfig.stop();
  });

  it("fails closed when neither config nor the start scene declares state", () => {
    class NoStateScene extends Scene {}
    expect(() =>
      defineGame({
        renderer: renderer(testCanvas()),
        scenes: { test: NoStateScene },
        start: "test",
      }),
    ).toThrow("static initialState");
  });

  it("uses a frame function returned by enter and rejects another return value", async () => {
    let calls = 0;
    let advance: ((ticks: number) => number) | undefined;
    class ReturnedScene extends Scene<Record<string, unknown>> {
      static override readonly initialState = {};

      override enter(): (ctx: ICtx, dt: number) => void {
        return () => {
          calls += 1;
        };
      }

      override update(): void {
        calls += 100;
      }
    }
    const game = defineGame({
      plugins: [
        {
          setup: (_ctx, runtime) => {
            advance = runtime?.fixedStep;
            return undefined;
          },
        },
      ],
      renderer: renderer(testCanvas()),
      scenes: { test: ReturnedScene },
      start: "test",
    });
    await game.start();
    if (advance === undefined) throw new Error("Plugin did not receive the fixed-step runtime.");
    advance(1);
    expect(calls).toBe(1);
    game.stop();

    class InvalidScene extends Scene {
      static override readonly initialState = {};

      override enter(): never {
        return 1 as never;
      }
    }
    const invalid = defineGame({
      renderer: renderer(testCanvas()),
      scenes: { test: InvalidScene },
      start: "test",
    });
    await expect(invalid.start()).rejects.toThrow("frame function");
  });

  it("preserves the destination frame when enter navigates synchronously", async () => {
    let advance: ((ticks: number) => number) | undefined;
    let updates = 0;

    class Boot extends Scene {
      static override readonly initialState = {};

      override enter(ctx: ICtx): void {
        void ctx.goto("play");
      }
    }

    class Play extends Scene {
      override enter(): (ctx: ICtx, dt: number) => void {
        return () => {
          updates += 1;
        };
      }
    }

    const game = defineGame({
      plugins: [
        {
          setup: (_ctx, runtime) => {
            advance = runtime?.fixedStep;
            return undefined;
          },
        },
      ],
      renderer: renderer(testCanvas()),
      scenes: { boot: Boot, play: Play },
      start: "boot",
    });

    await game.start();
    if (advance === undefined) throw new Error("Plugin did not receive the fixed-step runtime.");
    advance(1);
    expect(updates).toBe(1);
    game.stop();
  });

  it("exposes goto on IGame, reconstructs the current scene, and clears its scheduler", async () => {
    let advance: ((ticks: number) => number) | undefined;
    let enters = 0;
    let scheduled = 0;

    class Restartable extends Scene<{ score: number }> {
      static override readonly initialState = { score: 0 };

      override enter(ctx: ICtx): void {
        enters += 1;
        ctx.entities.add(`entity-${enters}`, {});
        ctx.every(() => scheduled++);
      }
    }

    const game = defineGame<{ score: number }>({
      plugins: [
        {
          setup: (_ctx, runtime) => {
            advance = runtime?.fixedStep;
            return undefined;
          },
        },
      ],
      renderer: renderer(testCanvas()),
      scenes: { play: Restartable },
      start: "play",
    });

    expect(() => game.goto("play")).toThrow("before start");
    await game.start();
    if (advance === undefined) throw new Error("Plugin did not receive the fixed-step runtime.");
    advance(1);
    expect(scheduled).toBe(1);

    game.state.set({ score: 7 });
    game.state.flush();
    const firstScene = game.scene;
    await game.goto("play");
    expect(game.scene).not.toBe(firstScene);
    expect(game.state.getState().score).toBe(0);
    expect(enters).toBe(2);
    expect(game.ctx?.entities.snapshot()).toEqual({ "entity-2": {} });
    advance(1);
    expect(scheduled).toBe(2);
    game.stop();
  });

  /**
   * PRD-152 Phase 2. The projection is only worth anything if `defineGame` is what routes through
   * it. These drive the real frame loop and assert on the scene the renderer was handed, because a
   * projection that works in isolation and is not wired in is a module, not an optimization.
   */
  it("hands the renderer the projection, not the authored scene, and draws far fewer objects", async () => {
    let renderFrame: ((time: number) => void) | undefined;
    const drawn: { candidates: number; scene: unknown }[] = [];
    const canvas = testCanvas();
    let authored: unknown;

    class Level extends Scene {
      static override readonly initialState = {};

      override enter(ctx: ICtx): void {
        authored = ctx.scene;
        const geometry = new SphereGeometry(0.1, 3, 2);
        const material = new MeshBasicMaterial();
        for (let index = 0; index < 400; index += 1) {
          const mesh = new Mesh(geometry, material);
          mesh.position.set(index % 20, Math.floor(index / 20), 0);
          ctx.add(mesh);
        }
      }
    }

    const requestFrame = globalThis.requestAnimationFrame;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: (time: number) => void) => {
        renderFrame = callback;
        return 1;
      },
    });
    const game = defineGame({
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => undefined,
          domElement: canvas,
          render: (scene: { traverse(cb: (o: { isMesh?: boolean }) => void): void }) => {
            let candidates = 0;
            scene.traverse((object) => {
              if (object.isMesh === true) candidates += 1;
            });
            drawn.push({ candidates, scene });
          },
          setSize: () => undefined,
        }),
      },
      scenes: { play: Level },
      start: "play",
    });

    try {
      await game.start();
      if (renderFrame === undefined) throw new Error("Game did not schedule a frame.");
      renderFrame(17);

      const last = drawn.at(-1);
      expect(last).toBeDefined();
      // The renderer was handed something other than the game's own scene...
      expect(last?.scene).not.toBe(authored);
      // ...and what it was handed draws a fraction of the objects the game authored.
      expect(last?.candidates).toBe(1);
      // The authored scene still holds every one of them, untouched.
      let sourceMeshes = 0;
      (authored as { traverse(cb: (o: { isMesh?: boolean }) => void): void }).traverse((object) => {
        if (object.isMesh === true) sourceMeshes += 1;
      });
      expect(sourceMeshes).toBe(400);
    } finally {
      game.stop();
      if (requestFrame === undefined) Reflect.deleteProperty(globalThis, "requestAnimationFrame");
      else Object.defineProperty(globalThis, "requestAnimationFrame", { value: requestFrame });
    }
  });

  it("stops projecting the previous scene's objects after goto disposes them", async () => {
    let renderFrame: ((time: number) => void) | undefined;
    const drawn: number[] = [];
    const canvas = testCanvas();
    // Counted through the prototype because the projection is private to the game, which is the
    // point — a game has no optimizer handle to call, so the proof has to be observable from the
    // outside like this.
    let disposals = 0;
    const batchedDispose = InstancedMesh.prototype.dispose;
    InstancedMesh.prototype.dispose = function disposeCounted(this: InstancedMesh) {
      disposals += 1;
      return batchedDispose.call(this);
    };

    class Level extends Scene {
      static override readonly initialState = {};

      override enter(ctx: ICtx): void {
        const geometry = new SphereGeometry(0.1, 3, 2);
        const material = new MeshBasicMaterial();
        for (let index = 0; index < 300; index += 1) ctx.add(new Mesh(geometry, material));
      }
    }

    const requestFrame = globalThis.requestAnimationFrame;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: (time: number) => void) => {
        renderFrame = callback;
        return 1;
      },
    });
    const game = defineGame({
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => undefined,
          domElement: canvas,
          render: (scene: { traverse(cb: (o: { isMesh?: boolean }) => void): void }) => {
            let candidates = 0;
            scene.traverse((object) => {
              if (object.isMesh === true) candidates += 1;
            });
            drawn.push(candidates);
          },
          setSize: () => undefined,
        }),
      },
      scenes: { empty: EmptyScene, play: Level },
      start: "play",
    });

    try {
      await game.start();
      if (renderFrame === undefined) throw new Error("Game did not schedule a frame.");
      renderFrame(17);
      expect(drawn.at(-1)).toBe(1);

      // Released by `goto` itself, before another frame is drawn. Waiting for the next reconcile
      // to notice the scene emptied would hold a level's worth of GPU buffers across the whole
      // load of the next one, which on a phone is where a scene change runs out of memory.
      await game.goto("empty");
      expect(disposals).toBeGreaterThan(0);

      renderFrame(34);
      // And the batch built from the previous level's geometry is not still drawing it.
      expect(drawn.at(-1)).toBe(0);
    } finally {
      InstancedMesh.prototype.dispose = batchedDispose;
      game.stop();
      if (requestFrame === undefined) Reflect.deleteProperty(globalThis, "requestAnimationFrame");
      else Object.defineProperty(globalThis, "requestAnimationFrame", { value: requestFrame });
    }
  });

  it("stops updating detached collapse parts when goto clears the previous scene", async () => {
    let renderFrame: ((time: number) => void) | undefined;
    const movingRoot = new Group();
    const moving = new Mesh(new SphereGeometry(0.1, 3, 2), new MeshBasicMaterial());
    movingRoot.matrixAutoUpdate = false;
    movingRoot.add(moving);
    const updateMatrixWorld = vi.spyOn(movingRoot, "updateMatrixWorld");

    class Collapsed extends Scene {
      static override readonly initialState = {};

      override enter(ctx: ICtx): void {
        const geometry = new SphereGeometry(0.1, 3, 2);
        const material = new MeshBasicMaterial();
        ctx.add(movingRoot);
        for (let index = 1; index < 200; index += 1) {
          ctx.add(new Mesh(geometry, material));
        }
      }
    }

    const requestFrame = globalThis.requestAnimationFrame;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: (time: number) => void) => {
        renderFrame = callback;
        return 1;
      },
    });
    const game = defineGame({
      renderer: renderer(testCanvas()),
      scenes: { next: EmptyScene, play: Collapsed },
      start: "play",
    });

    try {
      await game.start();
      for (let index = 1; index <= 16 && game.ctx?.startup.phase !== "ready"; index += 1) {
        if (renderFrame === undefined) throw new Error("Game did not schedule a frame.");
        movingRoot.matrix.elements[12] = index;
        renderFrame(index * 17);
      }
      expect(game.ctx?.startup.phase).toBe("ready");

      updateMatrixWorld.mockClear();
      await game.goto("next");
      if (renderFrame === undefined) throw new Error("Game did not schedule a frame.");
      renderFrame(17 * 17);
      expect(updateMatrixWorld).not.toHaveBeenCalled();
    } finally {
      game.stop();
      if (requestFrame === undefined) Reflect.deleteProperty(globalThis, "requestAnimationFrame");
      else Object.defineProperty(globalThis, "requestAnimationFrame", { value: requestFrame });
    }
  });

  it("does not run plugins against a destination during a frame navigation", async () => {
    let advance: ((ticks: number) => number) | undefined;
    let destinationUpdates = 0;
    let beforePluginUpdates = 0;
    let pluginUpdates = 0;

    class First extends Scene {
      static override readonly initialState = {};

      override enter(ctx: ICtx): (ctx: ICtx, dt: number) => void {
        return () => {
          void ctx.goto("second");
          return;
        };
      }
    }

    class Second extends Scene {
      override enter(): (ctx: ICtx, dt: number) => void {
        return () => {
          destinationUpdates += 1;
        };
      }
    }

    const game = defineGame({
      plugins: [
        {
          setup: (_ctx, runtime) => {
            advance = runtime?.fixedStep;
            return undefined;
          },
          beforeUpdate: () => {
            beforePluginUpdates += 1;
          },
          update: () => {
            pluginUpdates += 1;
          },
        },
      ],
      renderer: renderer(testCanvas()),
      scenes: { first: First, second: Second },
      start: "first",
    });

    await game.start();
    if (advance === undefined) throw new Error("Plugin did not receive the fixed-step runtime.");
    advance(1);
    expect(destinationUpdates).toBe(0);
    expect(beforePluginUpdates).toBe(1);
    expect(pluginUpdates).toBe(0);
    advance(1);
    expect(destinationUpdates).toBe(1);
    expect(beforePluginUpdates).toBe(2);
    expect(pluginUpdates).toBe(1);
    game.stop();
  });

  it("does not update or render an incoming scene before enter() has run", async () => {
    const events: string[] = [];
    let releaseLoad: (() => void) | undefined;
    let advance: ((ticks: number) => number) | undefined;
    let navigation: Promise<void> | undefined;

    class Boot extends Scene {
      static override readonly initialState = {};

      override enter(ctx: ICtx): void {
        navigation = ctx.goto("play");
      }
    }

    class Play extends Scene {
      static override readonly initialState = {};

      override load(): Promise<void> {
        events.push("play.load");
        return new Promise((resolve) => {
          releaseLoad = resolve;
        });
      }

      override enter(): void {
        events.push("play.enter");
      }

      override update(): void {
        events.push("play.update");
      }

      override render(): void {
        events.push("play.render");
      }
    }

    const game = defineGame({
      plugins: [
        {
          setup: (_ctx, runtime) => {
            advance = runtime?.fixedStep;
            return undefined;
          },
        },
      ],
      renderer: renderer(testCanvas()),
      scenes: { boot: Boot, play: Play },
      start: "boot",
    });

    await game.start();
    if (advance === undefined) throw new Error("Plugin did not receive the fixed-step runtime.");
    if (navigation === undefined) throw new Error("Boot did not navigate.");

    advance(1);
    // While play.load is still pending the incoming scene is not entered: no update, no render.
    expect(events).toEqual(["play.load"]);

    releaseLoad?.();
    await navigation;
    advance(1);
    expect(events).toContain("play.enter");
    expect(events).toContain("play.update");
    game.stop();
  });

  it("should run exit, clear, load, and enter in order on goto", async () => {
    const events: string[] = [];
    let navigate: ((name: string) => Promise<void>) | undefined;

    class First extends Scene {
      override load(): void {
        events.push("first.load");
      }

      override enter(ctx: ICtx): void {
        events.push("first.enter");
        ctx.entities.add("first", {});
        navigate = ctx.goto;
      }

      override exit(): void {
        events.push("first.exit");
      }
    }

    class Second extends Scene {
      override load(): void {
        events.push("second.load");
      }

      override enter(ctx: ICtx): void {
        events.push("second.enter");
        expect(ctx.entities.get("first")).toBeUndefined();
        ctx.entities.add("second", {});
      }
    }

    const game = defineGame({
      initialState: {},
      renderer: renderer(testCanvas()),
      scenes: { first: First, second: Second },
      start: "first",
    });

    await game.start();
    if (navigate === undefined) throw new Error("First scene did not expose ctx.goto.");
    await navigate("second");

    expect(events).toEqual([
      "first.load",
      "first.enter",
      "first.exit",
      "second.load",
      "second.enter",
    ]);
    expect(game.ctx?.entities.snapshot()).toEqual({ second: {} });
    game.stop();
  });

  it("clears scene objects, disposes entities, and calls plugin sceneExit on goto", async () => {
    let navigate: ((name: string) => Promise<void>) | undefined;
    let disposed = 0;
    let child: Mesh | undefined;
    let sceneExits = 0;

    class First extends Scene {
      override enter(ctx: ICtx): void {
        child = new Mesh(new SphereGeometry(1), undefined);
        ctx.add(child);
        ctx.entities.add("resource", {
          dispose: () => {
            disposed += 1;
          },
        });
        navigate = ctx.goto;
      }
    }

    class Second extends Scene {}
    const game = defineGame({
      initialState: {},
      plugins: [
        {
          sceneExit: () => {
            sceneExits += 1;
          },
        },
      ],
      renderer: renderer(testCanvas()),
      scenes: { first: First, second: Second },
      start: "first",
    });

    await game.start();
    if (navigate === undefined || child === undefined)
      throw new Error("First scene did not start.");
    await navigate("second");
    expect(child.parent).toBeNull();
    expect(disposed).toBe(1);
    expect(sceneExits).toBe(1);
    game.stop();
  });

  it("should throw when goto names an unknown scene", async () => {
    let navigate: ((name: string) => Promise<void>) | undefined;

    class First extends Scene {
      override enter(ctx: ICtx): void {
        navigate = ctx.goto;
      }
    }

    const game = defineGame({
      initialState: {},
      renderer: renderer(testCanvas()),
      scenes: { first: First },
      start: "first",
    });

    await game.start();
    if (navigate === undefined) throw new Error("First scene did not expose ctx.goto.");
    const goto = navigate;
    expect(() => goto("missing")).toThrow("Unknown scene 'missing'.");
    game.stop();
  });

  it("should keep state intact when goto names an unknown scene", async () => {
    class Restartable extends Scene<{ score: number }> {
      static override readonly initialState = { score: 0 };
    }
    const game = defineGame<{ score: number }>({
      renderer: renderer(testCanvas()),
      scenes: { play: Restartable },
      start: "play",
    });

    await game.start();
    game.state.set({ score: 42 });
    const liveScene = game.scene;
    expect(() => game.goto("typo")).toThrow("Unknown scene 'typo'.");
    // The typo must not cost the session: state keeps its in-flight value and the running
    // scene is untouched...
    expect(game.state.getState()).toEqual({ score: 42 });
    expect(game.scene).toBe(liveScene);
    // ...and navigation still works afterwards.
    await game.goto("play");
    expect(game.scene).not.toBe(liveScene);
    expect(game.state.getState()).toEqual({ score: 0 });
    game.stop();
  });

  it("should forward a configured step to scene updates", async () => {
    let observedStep = 0;
    let advance: ((ticks: number) => number) | undefined;

    class TestScene extends Scene {
      override update(_ctx: ICtx, dt: number): void {
        observedStep = dt;
      }
    }

    const game = defineGame({
      plugins: [
        {
          setup: (_ctx, runtime) => {
            advance = runtime?.fixedStep;
            return undefined;
          },
        },
      ],
      initialState: {},
      renderer: renderer(testCanvas()),
      scenes: { test: TestScene },
      start: "test",
      step: 1 / 30,
    });

    await game.start();
    if (advance === undefined) throw new Error("Plugin did not receive the fixed-step runtime.");
    advance(1);
    expect(observedStep).toBeCloseTo(1 / 30);
    game.stop();
  });

  it("should dispose the viewport observer when stopped", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: TrackingResizeObserver,
    });

    try {
      TrackingResizeObserver.instances = [];
      class TestScene extends Scene {}
      const game = defineGame({
        initialState: {},
        renderer: renderer(testCanvas()),
        scenes: { test: TestScene },
        start: "test",
      });

      await game.start();
      expect(TrackingResizeObserver.instances).toHaveLength(2);
      game.stop();
      expect(TrackingResizeObserver.instances.every((observer) => observer.disconnected)).toBe(
        true,
      );
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "ResizeObserver");
      else Object.defineProperty(globalThis, "ResizeObserver", descriptor);
    }
  });

  it("starts and stops through injected platform sources without DOM globals", async () => {
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "window");

    const canvas = new EventTarget() as HTMLCanvasElement;
    const inputTarget = new EventTarget();
    let size = { aspect: 16 / 9, height: 180, width: 320 };
    let rendererResize: (() => void) | undefined;
    let viewportResize: (() => void) | undefined;
    let mounted = 0;
    let unmounted = 0;
    let disposed = 0;
    let resizeDisposals = 0;
    const rendererSizes: Array<[number, number]> = [];
    const platform: IGamePlatformSource = {
      input: () => [{ axes: [0.5, -0.25], buttons: [{ pressed: true }] }],
      inputTarget,
      mountCanvas: (mountedCanvas) => {
        expect(mountedCanvas).toBe(canvas);
        mounted += 1;
      },
      renderer: {
        createCanvas: () => canvas,
        hasWebGPU: () => false,
        observeResize: (_canvas, resize) => {
          rendererResize = resize;
          return () => {
            resizeDisposals += 1;
          };
        },
        readSize: () => [size.width, size.height],
      },
      unmountCanvas: (unmountedCanvas) => {
        expect(unmountedCanvas).toBe(canvas);
        unmounted += 1;
      },
      viewport: {
        observeResize: (_canvas, resize) => {
          viewportResize = resize;
          return () => {
            resizeDisposals += 1;
          };
        },
        readSize: () => size,
      },
    };
    const game = defineGame({
      input: { jump: { buttons: [0] } },
      platform,
      renderer: {
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => {
            disposed += 1;
          },
          domElement: canvas,
          render: () => undefined,
          setSize: (width: number, height: number) => rendererSizes.push([width, height]),
        }),
      },
      scenes: { test: EmptyScene },
      start: "test",
    });

    try {
      await game.start();
      expect(mounted).toBe(1);
      expect(rendererSizes).toEqual([[320, 180]]);
      expect(game.ctx?.viewport.size).toEqual(size);

      game.ctx?.input.tick();
      expect(game.ctx?.input.pressed("jump")).toBe(true);
      expect(game.ctx?.input.vector("move").toArray()).toEqual([0.5, 0.25]);

      size = { aspect: 2, height: 320, width: 640 };
      rendererResize?.();
      viewportResize?.();
      expect(rendererSizes.at(-1)).toEqual([640, 320]);
      expect(game.ctx?.viewport.size).toEqual(size);

      game.stop();
      expect(game.ctx).toBeUndefined();
      expect(disposed).toBe(1);
      expect(resizeDisposals).toBe(2);
      expect(unmounted).toBe(1);
    } finally {
      game.stop();
      if (documentDescriptor !== undefined)
        Object.defineProperty(globalThis, "document", documentDescriptor);
      if (windowDescriptor !== undefined)
        Object.defineProperty(globalThis, "window", windowDescriptor);
    }
  });

  it("draws the overlay while the start scene is still loading, without stepping the simulation", async () => {
    // A phone has no DOM, so the render loop is the only thing that can put a loading screen on
    // the screen. Booting with the loop stopped until `scene.load` resolves means every native
    // game shows a black screen for its whole asset load, and the HUD's own !ready branch is
    // unreachable. The loop must run during load; the simulation must not.
    let releaseLoad: () => void = () => undefined;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    let updates = 0;
    let renders = 0;
    class SlowScene extends Scene {
      static override readonly initialState = {};
      override load(): Promise<void> {
        return loadGate;
      }
      override update(): void {
        updates += 1;
      }
    }
    const canvas = testCanvas();
    const game = defineGame({
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => undefined,
          domElement: canvas,
          render: () => {
            renders += 1;
          },
          setSize: () => undefined,
        }),
      },
      scenes: { test: SlowScene },
      start: "test",
    });
    const pending: FrameRequestCallback[] = [];
    const requestFrame = globalThis.requestAnimationFrame;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        pending.push(callback);
        return pending.length;
      },
    });
    try {
      const started = game.start();
      for (let flush = 0; flush < 20; flush += 1) await Promise.resolve();
      // Drive real frames while `load` is still outstanding.
      for (let frame = 1; frame <= 6; frame += 1) {
        const callback = pending.shift();
        if (callback === undefined) break;
        callback(frame * 32);
        for (let flush = 0; flush < 4; flush += 1) await Promise.resolve();
      }
      expect(renders).toBeGreaterThan(0);
      expect(updates).toBe(0);
      releaseLoad();
      await started;
      game.stop();
    } finally {
      if (requestFrame === undefined) Reflect.deleteProperty(globalThis, "requestAnimationFrame");
      else Object.defineProperty(globalThis, "requestAnimationFrame", { value: requestFrame });
    }
  });
});
