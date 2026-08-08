import { Mesh, OrthographicCamera, PerspectiveCamera, SphereGeometry } from "three";
import { describe, expect, it } from "vitest";
import { defineGame } from "../src/game.js";
import { type Ctx, Scene } from "../src/scene.js";

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

describe("Game", () => {
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

      override enter(): (ctx: Ctx, dt: number) => void {
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

      override enter(ctx: Ctx): void {
        void ctx.goto("play");
      }
    }

    class Play extends Scene {
      override enter(): (ctx: Ctx, dt: number) => void {
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

  it("exposes goto on Game, reconstructs the current scene, and clears its scheduler", async () => {
    let advance: ((ticks: number) => number) | undefined;
    let enters = 0;
    let scheduled = 0;

    class Restartable extends Scene {
      static override readonly initialState = {};

      override enter(ctx: Ctx): void {
        enters += 1;
        ctx.entities.add(`entity-${enters}`, {});
        ctx.every(() => scheduled++);
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
      scenes: { play: Restartable },
      start: "play",
    });

    expect(() => game.goto("play")).toThrow("before start");
    await game.start();
    if (advance === undefined) throw new Error("Plugin did not receive the fixed-step runtime.");
    advance(1);
    expect(scheduled).toBe(1);

    const firstScene = game.scene;
    await game.goto("play");
    expect(game.scene).not.toBe(firstScene);
    expect(enters).toBe(2);
    expect(game.ctx?.entities.snapshot()).toEqual({ "entity-2": {} });
    advance(1);
    expect(scheduled).toBe(2);
    game.stop();
  });

  it("does not run plugins against a destination during a frame navigation", async () => {
    let advance: ((ticks: number) => number) | undefined;
    let destinationUpdates = 0;
    let pluginUpdates = 0;

    class First extends Scene {
      static override readonly initialState = {};

      override enter(ctx: Ctx): (ctx: Ctx, dt: number) => void {
        return () => {
          void ctx.goto("second");
          return;
        };
      }
    }

    class Second extends Scene {
      override enter(): (ctx: Ctx, dt: number) => void {
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
    expect(pluginUpdates).toBe(0);
    advance(1);
    expect(destinationUpdates).toBe(1);
    expect(pluginUpdates).toBe(1);
    game.stop();
  });

  it("should run exit, clear, load, and enter in order on goto", async () => {
    const events: string[] = [];
    let navigate: ((name: string) => Promise<void>) | undefined;

    class First extends Scene {
      override load(): void {
        events.push("first.load");
      }

      override enter(ctx: Ctx): void {
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

      override enter(ctx: Ctx): void {
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
      override enter(ctx: Ctx): void {
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
      override enter(ctx: Ctx): void {
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

  it("should forward a configured step to scene updates", async () => {
    let observedStep = 0;
    let advance: ((ticks: number) => number) | undefined;

    class TestScene extends Scene {
      override update(_ctx: Ctx, dt: number): void {
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
});
