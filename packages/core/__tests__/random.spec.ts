import { type IPlaytestBridgeV1, PLAYTEST_BRIDGE_GLOBAL } from "@threenative/playtest";
import type { Vector2 } from "three";
import { describe, expect, it } from "vitest";
import { defineGame } from "../src/game.js";
import { playtest } from "../src/playtest.js";
import { createRandom } from "../src/random.js";
import { Scene } from "../src/scene.js";
import { CORE_VERSION } from "../src/version.js";

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
      getDrawingBufferSize: (target: Vector2) => target.set(320, 180),
      render: () => undefined,
      setSize: () => undefined,
    }),
  };
}

function bridge(): IPlaytestBridgeV1 {
  const value = (globalThis as Record<string, unknown>)[PLAYTEST_BRIDGE_GLOBAL];
  if (typeof value !== "object" || value === null)
    throw new Error("Playtest bridge was not installed.");
  return value as IPlaytestBridgeV1;
}

describe("IRandom", () => {
  it("should produce an identical sequence for an identical seed", () => {
    const first = createRandom(90210);
    const second = createRandom(90210);

    for (let index = 0; index < 1_000; index += 1) expect(first()).toBe(second());
  });

  it("should reproduce the sequence when state is restored", () => {
    const random = createRandom(90210);
    for (let index = 0; index < 10; index += 1) random();
    const state = random.state;
    const expected = Array.from({ length: 10 }, () => random());

    random.state = state;

    expect(Array.from({ length: 10 }, () => random())).toEqual(expected);
  });

  it("should throw when reading or writing state from an unseeded random", () => {
    const random = createRandom();

    expect(() => random.state).toThrow(/unseeded/u);
    expect(() => {
      random.state = 1;
    }).toThrow(/unseeded/u);
  });

  it("should throw when state is set to a non-integer", () => {
    const random = createRandom(90210);

    expect(() => {
      random.state = 1.5;
    }).toThrow(TypeError);
    expect(() => {
      random.state = Number.POSITIVE_INFINITY;
    }).toThrow(TypeError);
  });

  it("should expose the configured deterministic stream through ICtx", async () => {
    const draws: number[] = [];
    class TestScene extends Scene {
      override enter(ctx: Parameters<Scene["enter"]>[0]): void {
        draws.push(ctx.random(), ctx.random.range(-2, 2), ctx.random.pick([3, 5, 7]));
      }
    }
    const game = defineGame({
      initialState: {},
      renderer: renderer(testCanvas()),
      scenes: { test: TestScene },
      seed: 90210,
      start: "test",
    });

    await game.start();
    game.stop();
    expect(draws).toEqual([0.19717242405749857, 0.6608891226351261, 5]);
  });

  it("should report seed: null when none is configured", async () => {
    class TestScene extends Scene {}
    const canvas = testCanvas();
    const game = defineGame({
      initialState: {},
      plugins: [playtest()],
      renderer: renderer(canvas),
      scenes: { test: TestScene },
      start: "test",
    });

    await game.start();
    try {
      const snapshot = await bridge().sample({});
      expect(
        (snapshot.gameplay as typeof snapshot.gameplay & { world: { seed: number | null } }).world
          .seed,
      ).toBeNull();
    } finally {
      game.stop();
    }
  });

  it("should expose the seeded replay runtime fingerprint", async () => {
    class TestScene extends Scene {}
    const canvas = testCanvas();
    const game = defineGame({
      initialState: {},
      plugins: [playtest()],
      renderer: renderer(canvas),
      scenes: { test: TestScene },
      seed: 90210,
      start: "test",
    });

    await game.start();
    try {
      const world = (await bridge().sample({})).gameplay?.world;
      expect(world).toEqual({
        runtime: {
          agent: typeof navigator === "undefined" ? "node" : navigator.userAgent,
          // The fingerprint reports the derived package version, not a hardcoded literal.
          core: CORE_VERSION,
          randomState: 90210,
          rapier: null,
          step: 1 / 60,
        },
        seed: 90210,
      });
    } finally {
      game.stop();
    }
  });

  it("should reject range(a, b) with b <= a", () => {
    const random = createRandom(1);

    expect(() => random.range(1, 1)).toThrow(/greater than/u);
    expect(() => random.range(2, 1)).toThrow(/greater than/u);
  });

  it("should reject pick() on an empty list", () => {
    const random = createRandom(1);

    expect(() => random.pick([])).toThrow(/non-empty/u);
  });
});
