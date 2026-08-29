import { Group } from "three";
import { describe, expect, it } from "vitest";
import { ComputeDrivenRegistry, type IComputeDriven } from "../src/compute-driven.js";
import { defineGame } from "../src/game.js";
import type { IRendererLike } from "../src/renderer.js";
import { type ICtx, Scene } from "../src/scene.js";

const renderer = {} as IRendererLike;

function testCanvas(): HTMLCanvasElement {
  const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, value: 180 },
    clientWidth: { configurable: true, value: 320 },
    parentElement: { configurable: true, value: null },
  });
  return canvas as HTMLCanvasElement;
}

class ComputeProbe extends Group implements IComputeDriven {
  readonly warmupNodes: readonly unknown[];
  attached = 0;
  processed = 0;
  detached = 0;
  #released = false;
  readonly #order: string[];
  readonly #name: string;

  constructor(name: string, order: string[]) {
    super();
    this.#name = name;
    this.#order = order;
    this.warmupNodes = [`${name}:start`, `${name}:process`];
  }

  get released(): boolean {
    return this.#released;
  }

  attachRenderer(): void {
    this.attached += 1;
  }

  process(): void {
    this.processed += 1;
    this.#order.push(this.#name);
  }

  detach(): void {
    if (this.#released) return;
    this.#released = true;
    this.detached += 1;
  }
}

describe("ComputeDrivenRegistry", () => {
  it("should dispatch a non-particle implementer once per fixed step", async () => {
    let advance: ((ticks: number) => number) | undefined;
    const order: string[] = [];
    let field: ComputeProbe | undefined;
    class ComputeScene extends Scene {
      static override readonly initialState = {};

      override enter(ctx: ICtx): void {
        field = ctx.add(new ComputeProbe("field", order)) as ComputeProbe;
      }
    }
    const canvas = testCanvas();
    const game = defineGame({
      plugins: [
        {
          setup: (_ctx, runtime) => {
            advance = runtime?.fixedStep;
            return undefined;
          },
        },
      ],
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => undefined,
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        }),
      },
      scenes: { compute: ComputeScene },
      start: "compute",
    });

    await game.start();
    try {
      if (advance === undefined || field === undefined)
        throw new Error("Compute probe was not attached to the game.");
      advance(3);
      expect(field.attached).toBe(1);
      expect(field.processed).toBe(3);
      expect(order).toEqual(["field", "field", "field"]);
    } finally {
      game.stop();
    }
  });

  it("should dispatch implementers in scene-add order", () => {
    const scene = new Group();
    const order: string[] = [];
    const field = new ComputeProbe("field", order);
    scene.add(field);
    const registry = new ComputeDrivenRegistry();

    registry.add(field, renderer);
    registry.process(renderer);
    registry.process(renderer);
    registry.process(renderer);

    expect(field.attached).toBe(1);
    expect(field.processed).toBe(3);
    expect(order).toEqual(["field", "field", "field"]);
    expect(registry.warmupNodes).toEqual(["field:start", "field:process"]);
  });

  it("preserves scene-add order for multiple implementers", () => {
    const scene = new Group();
    const order: string[] = [];
    const first = new ComputeProbe("first", order);
    const second = new ComputeProbe("second", order);
    const third = new ComputeProbe("third", order);
    scene.add(first, second, third);
    const registry = new ComputeDrivenRegistry();

    registry.add(first, renderer);
    registry.add(second, renderer);
    registry.add(third, renderer);
    registry.process(renderer);

    expect(order).toEqual(["first", "second", "third"]);
    expect(registry.warmupNodes).toEqual([
      "first:start",
      "first:process",
      "second:start",
      "second:process",
      "third:start",
      "third:process",
    ]);
  });

  it("should release every implementer on a scene change", async () => {
    let field: ComputeProbe | undefined;
    class FirstScene extends Scene {
      static override readonly initialState = {};

      override enter(ctx: ICtx): void {
        field = ctx.add(new ComputeProbe("field", [])) as ComputeProbe;
      }
    }
    class NextScene extends Scene {
      static override readonly initialState = {};
    }
    const canvas = testCanvas();
    const game = defineGame({
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => undefined,
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        }),
      },
      scenes: { first: FirstScene, next: NextScene },
      start: "first",
    });

    await game.start();
    try {
      await game.goto("next");
      expect(field?.released).toBe(true);
    } finally {
      game.stop();
    }
  });

  it("releases an implementer removed from the scene and clears every remaining object", () => {
    const scene = new Group();
    const order: string[] = [];
    const removed = new ComputeProbe("removed", order);
    const remaining = new ComputeProbe("remaining", order);
    scene.add(removed, remaining);
    const registry = new ComputeDrivenRegistry();
    registry.add(removed, renderer);
    registry.add(remaining, renderer);

    scene.remove(removed);
    registry.process(renderer);
    expect(removed.released).toBe(true);
    expect(removed.processed).toBe(0);
    expect(remaining.processed).toBe(1);

    registry.clear();
    expect(remaining.released).toBe(true);
    expect(registry.size).toBe(0);
  });
});
