import { describe, expect, it } from "vitest";
import { defineGame } from "../src/game.js";
import { Scene } from "../src/scene.js";
import { type ScheduleHandle, Scheduler } from "../src/schedule.js";

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

describe("Scheduler", () => {
  it("should fire after() in game-seconds, not wall-clock", () => {
    const scheduler = new Scheduler();
    let calls = 0;
    scheduler.after(0.3, () => calls++);

    scheduler.tick(0.1);
    scheduler.tick(0.1);
    expect(calls).toBe(0);
    scheduler.tick(0.1);

    expect(calls).toBe(1);
    expect(scheduler.size).toBe(0);
  });

  it("should cancel every registration on goto", async () => {
    let advance: ((ticks: number) => number) | undefined;
    let navigate: ((name: string) => Promise<void>) | undefined;
    let calls = 0;

    class First extends Scene {
      override enter(ctx: Parameters<Scene["enter"]>[0]): void {
        ctx.after(0, () => calls++);
        ctx.every(() => calls++);
        navigate = ctx.goto;
      }

      override exit(ctx: Parameters<Scene["exit"]>[0]): void {
        ctx.after(0, () => calls++);
        ctx.every(() => calls++);
      }
    }

    class Second extends Scene {}

    const game = defineGame({
      initialState: {},
      plugins: [
        {
          setup: (_ctx, runtime) => {
            advance = runtime?.fixedStep;
            return undefined;
          },
        },
      ],
      renderer: renderer(testCanvas()),
      scenes: { first: First, second: Second },
      start: "first",
    });

    await game.start();
    if (advance === undefined || navigate === undefined)
      throw new Error("Test scene was not initialized.");
    await navigate("second");
    advance(2);

    expect(calls).toBe(0);
    game.stop();
  });

  it("should not advance timers while paused", async () => {
    let advance: ((ticks: number) => number) | undefined;
    let position = 0;

    class TestScene extends Scene {
      override update(_ctx: Parameters<Scene["update"]>[0], dt: number): void {
        position += dt;
      }
    }

    const game = defineGame({
      initialState: {},
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
    });

    await game.start();
    if (advance === undefined) throw new Error("Test plugin did not receive fixedStep.");
    advance(6);
    game.pause();
    const pausedAt = position;
    advance(60);
    expect(position).toBe(pausedAt);
    game.resume();
    advance(1);
    expect(position).toBeGreaterThan(pausedAt);
    game.stop();
  });

  it("should reject a non-finite delay", () => {
    const scheduler = new Scheduler();

    expect(() => scheduler.after(Number.NaN, () => undefined)).toThrow(/finite/u);
    expect(() => scheduler.after(Number.POSITIVE_INFINITY, () => undefined)).toThrow(/finite/u);
  });

  it("should resolve tween() exactly once at the end", async () => {
    const scheduler = new Scheduler();
    const target = { x: 0 };
    let resolutions = 0;
    let resolved = false;
    const finished = scheduler.tween(target, { x: 10 }, 0.3).then(() => {
      resolved = true;
      resolutions += 1;
    });

    scheduler.tick(0.1);
    expect(target.x).toBeCloseTo(10 / 3);
    await Promise.resolve();
    expect(resolved).toBe(false);
    scheduler.tick(0.2);
    scheduler.tick(0.2);
    await finished;

    expect(target.x).toBe(10);
    expect(resolutions).toBe(1);
    expect(scheduler.size).toBe(0);
  });
});

describe("Scheduler tick ordering", () => {
  it("runs entries added during a tick starting on the next tick", () => {
    // Pinned before the copy-free iteration lands (PRD-173): a direct Set iteration would
    // otherwise visit mid-tick additions same-tick and silently change when they first fire.
    const fired: number[] = [];
    let tickCount = 0;
    const scheduler = new Scheduler();
    scheduler.every((dt) => {
      tickCount += 1;
      if (tickCount === 1) {
        scheduler.after(0, () => fired.push(tickCount));
      }
    });
    scheduler.tick(1 / 60);
    scheduler.tick(1 / 60);
    expect(fired).toEqual([2]);
  });

  it("keeps the next-tick invariant when a mid-tick cancellation compacts the set", () => {
    // Cancelling an unvisited entry mid-tick removes it from the Set, shifting the appended
    // entry into a visit slot the size bound still admits. The bound must not let an entry
    // appended during this tick fire during this tick.
    const fired: number[] = [];
    let tickCount = 0;
    const scheduler = new Scheduler();
    // Registration order is the point: the actor has to be visited first so the entry it
    // cancels is still unvisited. A holder keeps that order while the callback closes over a
    // handle that does not exist yet.
    const pending: { victim?: ScheduleHandle } = {};
    const actor = scheduler.every(() => {
      tickCount += 1;
      if (tickCount === 1) {
        pending.victim?.cancel();
        scheduler.after(0, () => fired.push(tickCount));
      }
    });
    pending.victim = scheduler.every(() => undefined);

    scheduler.tick(1 / 60);
    expect(actor.active ?? true).toBeDefined();
    expect(fired).toEqual([]);
    scheduler.tick(1 / 60);
    // Fires on tick 2 (the next tick), reporting the tick it ran in.
    expect(fired).toEqual([2]);
  });
});
