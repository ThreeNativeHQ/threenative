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

describe("Game", () => {
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

  it("should throw when goto names an unknown scene", async () => {
    let navigate: ((name: string) => Promise<void>) | undefined;

    class First extends Scene {
      override enter(ctx: Ctx): void {
        navigate = ctx.goto;
      }
    }

    const game = defineGame({
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
