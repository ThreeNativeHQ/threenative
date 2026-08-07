import { type IPlaytestBridgeV1, PLAYTEST_BRIDGE_GLOBAL } from "@threenative/playtest";
import { BoxGeometry, Mesh, MeshBasicMaterial, type Vector2 } from "three";
import { describe, expect, it } from "vitest";
import { defineGame } from "../src/game.js";
import { playtest } from "../src/playtest.js";
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

function bridge(): IPlaytestBridgeV1 {
  const value = (globalThis as Record<string, unknown>)[PLAYTEST_BRIDGE_GLOBAL];
  if (typeof value !== "object" || value === null)
    throw new Error("Playtest bridge was not installed.");
  return value as IPlaytestBridgeV1;
}

describe("playtest plugin", () => {
  it("observes registry entities and camera.main while advertising supplied channels only", async () => {
    const canvas = testCanvas();
    let drawingBufferReads = 0;
    class TestScene extends Scene<{ score: number }> {
      override enter(ctx: Ctx<{ score: number }>): void {
        const player = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        ctx.add(player);
        ctx.entities.add("player", { mesh: player });
      }
    }
    const game = defineGame<{ score: number }>({
      initialState: { score: 0 },
      plugins: [playtest()],
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => undefined,
          domElement: canvas,
          getDrawingBufferSize: (target: Vector2) => {
            drawingBufferReads += 1;
            return target.set(320, 180);
          },
          render: () => undefined,
          setSize: () => undefined,
        }),
      },
      scenes: { test: TestScene },
      start: "test",
    });

    await game.start();
    try {
      const installed = bridge();
      const description = await installed.describe();
      const snapshot = await installed.sample({});
      const expected = [
        "camera.observe",
        "entity.bounds",
        "entity.observe",
        "entity.setup",
        "runtime.fixedStep",
        "runtime.resources",
        "runtime.diagnostics",
        "runtime.animation",
        "runtime.state",
        "runtime.contacts",
        "runtime.tags",
        "runtime.audio",
        "runtime.world",
      ];

      expect(description.capabilities).toEqual(expected);
      expect(snapshot.entities?.map(({ id }) => id)).toEqual(["camera.main", "player"]);
      expect(snapshot.entities?.find(({ id }) => id === "camera.main")?.transform).toBeDefined();
      expect(snapshot.gameplay).toEqual({
        animation: {},
        audio: { queued: 0, voices: 0 },
        contacts: [],
        states: {},
        tags: {},
        world: { seed: null },
      });
      expect(snapshot.resources).toEqual({ GameState: { score: 0 }, state: { score: 0 } });
      expect(drawingBufferReads).toBeGreaterThan(0);
    } finally {
      game.stop();
    }
  });

  it("publishes registry tags and drained contacts through gameplay channels", async () => {
    const canvas = testCanvas();
    const body = {};
    const area = {
      drainContacts: () => [{ body, entity: "coin.3", started: true }],
    };
    class TestScene extends Scene {
      override enter(ctx: Ctx): void {
        const fox = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        const coin = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        ctx.add(fox);
        ctx.add(coin);
        ctx.entities.add("fox", { body, mesh: fox });
        ctx.entities.add("coin.3", { area, mesh: coin, tags: ["coin"] });
      }
    }
    const game = defineGame({
      initialState: {},
      plugins: [playtest()],
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => undefined,
          domElement: canvas,
          getDrawingBufferSize: (target: Vector2) => target.set(320, 180),
          render: () => undefined,
          setSize: () => undefined,
        }),
      },
      scenes: { test: TestScene },
      start: "test",
    });

    await game.start();
    try {
      const gameplay = (await bridge().sample({})).gameplay;
      expect(gameplay?.contacts).toEqual([{ entity: "fox", kind: "trigger", with: "coin.3" }]);
      expect(gameplay?.tags).toEqual({ coin: { count: 1 } });
    } finally {
      game.stop();
    }
  });

  it("advances the running game through the fixed-step bridge", async () => {
    const canvas = testCanvas();
    let updates = 0;
    class TestScene extends Scene<Record<string, unknown>> {
      override update(): void {
        updates += 1;
      }
    }
    const game = defineGame({
      initialState: {},
      plugins: [playtest()],
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => undefined,
          domElement: canvas,
          getDrawingBufferSize: (target: Vector2) => target.set(320, 180),
          render: () => undefined,
          setSize: () => undefined,
        }),
      },
      scenes: { test: TestScene },
      start: "test",
    });

    await game.start();
    try {
      const installed = bridge();
      await installed.advance?.(4);

      expect(updates).toBe(4);
      expect((await installed.sample({})).clock).toEqual({ mode: "fixed-step", tick: 4 });
    } finally {
      game.stop();
    }
  });

  it("should re-register only the active scene entities after goto", async () => {
    const canvas = testCanvas();
    let navigate: ((name: string) => Promise<void>) | undefined;

    class FirstScene extends Scene {
      override enter(ctx: Ctx): void {
        const first = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        ctx.add(first);
        ctx.entities.add("first", { mesh: first });
        navigate = ctx.goto;
      }
    }

    class SecondScene extends Scene {
      override enter(ctx: Ctx): void {
        const second = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        ctx.add(second);
        ctx.entities.add("second", { mesh: second });
      }
    }

    const game = defineGame({
      initialState: {},
      plugins: [playtest()],
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => undefined,
          domElement: canvas,
          getDrawingBufferSize: (target: Vector2) => target.set(320, 180),
          render: () => undefined,
          setSize: () => undefined,
        }),
      },
      scenes: { first: FirstScene, second: SecondScene },
      start: "first",
    });

    await game.start();
    try {
      if (navigate === undefined) throw new Error("First scene did not expose ctx.goto.");
      await navigate("second");
      const snapshot = await bridge().sample({});
      expect(snapshot.entities?.map(({ id }) => id)).toEqual(["camera.main", "second"]);
    } finally {
      game.stop();
    }
  });
});
