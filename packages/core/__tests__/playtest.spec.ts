import {
  type IPlaytestBridgeV1,
  type IPlaytestSampleRequest,
  PLAYTEST_BRIDGE_GLOBAL,
} from "@threenative/playtest";
import {
  AnimationClip,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  type Vector2,
} from "three";
import { describe, expect, it } from "vitest";
import { AnimationPlayer } from "../src/animation.js";
import { type IGamePluginHooks, defineGame } from "../src/game.js";
import { playtest } from "../src/playtest.js";
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

function bridge(): IPlaytestBridgeV1 {
  const value = (globalThis as Record<string, unknown>)[PLAYTEST_BRIDGE_GLOBAL];
  if (typeof value !== "object" || value === null)
    throw new Error("Playtest bridge was not installed.");
  return value as IPlaytestBridgeV1;
}

describe("playtest plugin", () => {
  it("should not advertise runtime.physics without a contributing plugin", async () => {
    const game = defineGame({
      initialState: {},
      plugins: [playtest()],
      renderer: stubRenderer(testCanvas()),
      scenes: { test: class extends Scene {} },
      start: "test",
    });

    await game.start();
    try {
      expect((await bridge().describe()).capabilities).toEqual([
        "camera.observe",
        "entity.bounds",
        "entity.observe",
        "entity.setup",
        "runtime.fixedStep",
        "runtime.resources",
        "runtime.animation",
        "runtime.state",
        "runtime.performance",
        "runtime.renderChain",
        "runtime.startup",
        "runtime.contacts",
        "runtime.tags",
        "runtime.audio",
        "runtime.world",
      ]);
    } finally {
      game.stop();
    }
  });

  it("merges and deduplicates contributed capabilities and observation slices", async () => {
    let receivedLabel: string | undefined;
    const provider: IGamePluginHooks = {
      setup: (_ctx, runtime) =>
        runtime?.observations.contribute({
          capabilities: ["runtime.example", "runtime.example"],
          sample: (request) => {
            receivedLabel = request.label;
            return { exampleSeries: [{ value: 3 }] };
          },
        }),
    };
    const game = defineGame({
      initialState: {},
      plugins: [provider, playtest()],
      renderer: stubRenderer(testCanvas()),
      scenes: { test: class extends Scene {} },
      start: "test",
    });

    await game.start();
    try {
      expect((await bridge().describe()).capabilities).toEqual([
        "camera.observe",
        "entity.bounds",
        "entity.observe",
        "entity.setup",
        "runtime.fixedStep",
        "runtime.resources",
        "runtime.animation",
        "runtime.state",
        "runtime.performance",
        "runtime.renderChain",
        "runtime.startup",
        "runtime.contacts",
        "runtime.tags",
        "runtime.audio",
        "runtime.world",
        "runtime.example",
      ]);
      const request = { label: "after-step" } as IPlaytestSampleRequest & { label: string };
      expect(await bridge().sample(request)).toMatchObject({
        exampleSeries: [{ value: 3 }],
      });
      expect(receivedLabel).toBe("after-step");
    } finally {
      game.stop();
    }
  });

  it("fails closed when contributed observation keys collide", async () => {
    const provider: IGamePluginHooks = {
      setup: (_ctx, runtime) =>
        runtime?.observations.contribute({
          capabilities: [],
          sample: () => ({ gameplay: {} }),
        }),
    };
    const game = defineGame({
      initialState: {},
      plugins: [provider, playtest()],
      renderer: stubRenderer(testCanvas()),
      scenes: { test: class extends Scene {} },
      start: "test",
    });

    await game.start();
    try {
      await expect(bridge().sample({})).rejects.toThrow(/TN_PLAYTEST_OBSERVATION_COLLISION/u);
    } finally {
      game.stop();
    }
  });

  it("fails closed when contributed observations are not JSON-safe", async () => {
    const provider: IGamePluginHooks = {
      setup: (_ctx, runtime) =>
        runtime?.observations.contribute({
          capabilities: [],
          sample: () => ({ example: undefined }),
        }),
    };
    const game = defineGame({
      initialState: {},
      plugins: [provider, playtest()],
      renderer: stubRenderer(testCanvas()),
      scenes: { test: class extends Scene {} },
      start: "test",
    });

    await game.start();
    try {
      await expect(bridge().sample({})).rejects.toThrow(/must be JSON-safe/u);
    } finally {
      game.stop();
    }
  });

  it("reports loop frame timing and active renderer counts", async () => {
    const canvas = testCanvas();
    const callbacks: Array<(time: number) => void> = [];
    const requestFrame = globalThis.requestAnimationFrame;
    const cancelFrame = globalThis.cancelAnimationFrame;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: (time: number) => void) => {
        callbacks.push(callback);
        return callbacks.length;
      },
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      value: () => undefined,
    });
    const game = defineGame({
      initialState: {},
      // A second plugin plays the diagnostics consumer: announcing through
      // enableRuntimeDiagnostics turns collection on without the runner-expected global,
      // which would also put the bridge into hold-until-attached.
      plugins: [
        playtest(),
        {
          setup: (_ctx, runtime) => {
            runtime?.enableRuntimeDiagnostics?.();
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
          info: { render: { calls: 99, drawCalls: 7, triangles: 42 } },
          render: () => undefined,
          setSize: () => undefined,
          getDrawingBufferSize: (target: Vector2) => target.set(320, 180),
        }),
      },
      scenes: { test: class extends Scene {} },
      start: "test",
    });

    try {
      await game.start();
      callbacks.shift()?.(0);
      callbacks.shift()?.(16);
      const series = (await bridge().sample({})).runtimeDiagnosticsSeries ?? [];
      // The frame budget is on by default, so each sample also carries its phase split.
      expect(series.every(({ phases }) => phases !== undefined)).toBe(true);
      expect(series.map(({ phases: _phases, ...sample }) => sample)).toEqual([
        { drawCalls: 7, frameMs: 16, triangles: 42 },
      ]);
    } finally {
      game.stop();
      if (requestFrame === undefined) Reflect.deleteProperty(globalThis, "requestAnimationFrame");
      else Object.defineProperty(globalThis, "requestAnimationFrame", { value: requestFrame });
      if (cancelFrame === undefined) Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
      else Object.defineProperty(globalThis, "cancelAnimationFrame", { value: cancelFrame });
    }
  });

  it("observes registry entities and camera.main while advertising supplied channels only", async () => {
    const canvas = testCanvas();
    let drawingBufferReads = 0;
    class TestScene extends Scene<{ score: number }> {
      override enter(ctx: ICtx<{ score: number }>): void {
        const player = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        ctx.add(player);
        const animation = new AnimationPlayer({
          clips: [
            new AnimationClip("once", 1, [new NumberKeyframeTrack(".position[x]", [0, 1], [0, 1])]),
          ],
          root: player,
        });
        animation.play("once", { mode: "once" });
        animation.update(2);
        ctx.entities.add("player", { animation, mesh: player });
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
        "runtime.animation",
        "runtime.state",
        "runtime.performance",
        "runtime.renderChain",
        "runtime.startup",
        "runtime.contacts",
        "runtime.tags",
        "runtime.audio",
        "runtime.world",
      ];

      expect(description.capabilities).toEqual(expected);
      expect(snapshot.entities?.map(({ id }) => id)).toEqual(["camera.main", "player"]);
      expect(snapshot.entities?.find(({ id }) => id === "camera.main")?.transform).toBeDefined();
      expect(snapshot.gameplay).toEqual({
        animation: { player: { advancedFrames: 1, clip: "once", finished: true } },
        audio: { pooled: 0, queued: 0, voices: 0 },
        contacts: [],
        states: {},
        tags: {},
        world: { seed: null },
      });
      expect(snapshot.resources).toEqual({ GameState: { score: 0 }, state: { score: 0 } });
      expect(snapshot.runtimeDiagnosticsSeries).toEqual([]);
      expect(drawingBufferReads).toBeGreaterThan(0);
    } finally {
      game.stop();
    }
  });

  it("exposes registry fields as components only when fields exist", async () => {
    const canvas = testCanvas();
    class TestScene extends Scene {
      override enter(ctx: ICtx): void {
        const player = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        ctx.add(player);
        ctx.entities.add("player", { debug: () => ({ health: 2 }), mesh: player });
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
      expect((await installed.describe()).capabilities).toContain("runtime.components");
      expect((await installed.sample({})).components).toEqual({ player: { health: 2 } });
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
      override enter(ctx: ICtx): void {
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
      override enter(ctx: ICtx): void {
        const first = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        ctx.add(first);
        ctx.entities.add("first", { mesh: first });
        navigate = ctx.goto;
      }
    }

    class SecondScene extends Scene {
      override enter(ctx: ICtx): void {
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

  it("keeps state resource snapshots stable across a scene goto", async () => {
    type ScreenState = { characterName: string; screen: "menu" | "play" };
    class MenuScene extends Scene<ScreenState> {
      static override readonly initialState: ScreenState = { characterName: "", screen: "menu" };
    }
    class PlayScene extends Scene<ScreenState> {
      static override readonly initialState: ScreenState = { characterName: "", screen: "play" };
    }
    const game = defineGame<ScreenState>({
      plugins: [playtest()],
      renderer: stubRenderer(testCanvas()),
      scenes: { menu: MenuScene, play: PlayScene },
      start: "menu",
    });

    await game.start();
    try {
      const before = await bridge().sample({});
      await game.goto("play", { carry: { characterName: "Axo" } });
      const after = await bridge().sample({});
      expect(before.resources?.state).toEqual({ characterName: "", screen: "menu" });
      expect(after.resources?.state).toEqual({ characterName: "Axo", screen: "play" });
    } finally {
      game.stop();
    }
  });
});

function stubRenderer(canvas: HTMLCanvasElement) {
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

describe("playtest holdUntilAttached", () => {
  it("applies runner setup before the real start scene enters", async () => {
    const canvas = testCanvas();
    const authoritativeBody = { position: [0, 1.6, 0] as [number, number, number] };
    const events: string[] = [];
    class SetupScene extends Scene {
      override load(ctx: ICtx): void {
        const placeholder = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        placeholder.position.set(0, 1.6, 0);
        ctx.add(placeholder);
        ctx.entities.add("player", placeholder);
        events.push("load");
      }

      override enter(ctx: ICtx): void {
        const placeholder = ctx.entities.get<Mesh>("player");
        if (placeholder === undefined) throw new Error("Player placeholder was not registered.");
        authoritativeBody.position = placeholder.position.toArray() as [number, number, number];
        events.push("enter");
      }
    }
    const game = defineGame({
      initialState: {},
      plugins: [playtest({ holdUntilAttached: true, attachTimeoutMs: 5_000 })],
      renderer: stubRenderer(canvas),
      scenes: { main: SetupScene },
      start: "main",
    });
    const started = game.start();

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toEqual(["load"]);
      const installed = bridge();
      if (installed.applySetup === undefined) throw new Error("Setup channel was not installed.");
      await installed.applySetup({
        entities: [{ entity: "player", transform: { position: [7, 2.5, -3] } }],
      });
      const description = await installed.describe();
      events.push("describe returned");
      await started;

      expect(authoritativeBody.position).toEqual([7, 2.5, -3]);
      expect(events).toEqual(["load", "enter", "describe returned"]);
      expect(description.capabilities).toContain("runtime.components");
    } finally {
      game.stop();
    }
  });

  it("holds a native endpoint run until its no-setup describe handshake", async () => {
    const host = globalThis as Record<string, unknown>;
    const previousEndpoint = host.TN_PLAYTEST_ENDPOINT;
    host.TN_PLAYTEST_ENDPOINT = "native://test-mailbox";
    const events: string[] = [];
    class NativeScene extends Scene {
      override load(): void {
        events.push("load");
      }

      override enter(ctx: ICtx): void {
        ctx.entities.add("native-player", {
          health: 100,
          mesh: new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()),
        });
        events.push("enter");
      }
    }
    const game = defineGame({
      initialState: {},
      plugins: [playtest({ attachTimeoutMs: 5_000 })],
      renderer: stubRenderer(testCanvas()),
      scenes: { main: NativeScene },
      start: "main",
    });
    const started = game.start();

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toEqual(["load"]);
      const description = await bridge().describe();
      events.push("describe returned");
      await started;

      expect(events).toEqual(["load", "enter", "describe returned"]);
      expect(description.capabilities).toContain("runtime.components");
    } finally {
      game.stop();
      if (previousEndpoint === undefined) Reflect.deleteProperty(host, "TN_PLAYTEST_ENDPOINT");
      else host.TN_PLAYTEST_ENDPOINT = previousEndpoint;
    }
  });

  it("fails the held start immediately when setup application fails", async () => {
    let entered = false;
    class FailingSetupScene extends Scene {
      override enter(): void {
        entered = true;
      }
    }
    const game = defineGame({
      initialState: {},
      plugins: [playtest({ holdUntilAttached: true, attachTimeoutMs: 5_000 })],
      renderer: stubRenderer(testCanvas()),
      scenes: { main: FailingSetupScene },
      start: "main",
    });
    const started = game.start();

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const installed = bridge();
      if (installed.applySetup === undefined) throw new Error("Setup channel was not installed.");
      await expect(installed.applySetup({
        entities: [{ entity: "missing", transform: { position: [1, 2, 3] } }],
      })).rejects.toThrow(/missing/u);
      await expect(started).rejects.toThrow(/missing/u);
      expect(entered).toBe(false);
    } finally {
      game.stop();
    }
  });

  it("does not start the loop until a runner calls describe", async () => {
    const canvas = testCanvas();
    let steps = 0;
    class CountingScene extends Scene<{ score: number }> {
      override update(): void {
        steps += 1;
      }
    }
    const game = defineGame<{ score: number }>({
      initialState: { score: 0 },
      plugins: [playtest({ holdUntilAttached: true, attachTimeoutMs: 5_000 })],
      renderer: stubRenderer(canvas),
      scenes: { main: CountingScene },
      start: "main",
    });
    const started = game.start();
    let settled = false;
    void started.then(() => {
      settled = true;
    });

    // The bridge is installed, but start() must still be pending: nothing has attached.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    expect(steps).toBe(0);

    await bridge().describe();
    await started;
    expect(settled).toBe(true);
    await game.stop();
  });

  it("fails closed when no runner attaches before the timeout", async () => {
    const canvas = testCanvas();
    const game = defineGame<{ score: number }>({
      initialState: { score: 0 },
      plugins: [playtest({ holdUntilAttached: true, attachTimeoutMs: 40 })],
      renderer: stubRenderer(canvas),
      scenes: { main: class extends Scene<{ score: number }> {} },
      start: "main",
    });
    await expect(game.start()).rejects.toThrow(/TN_PLAYTEST_ATTACH_TIMEOUT/u);
    await game.stop();
  });

  it("rejects a non-positive attach timeout instead of holding forever", async () => {
    const canvas = testCanvas();
    const game = defineGame<{ score: number }>({
      initialState: { score: 0 },
      plugins: [playtest({ attachTimeoutMs: 0, holdUntilAttached: true })],
      renderer: stubRenderer(canvas),
      scenes: { main: class extends Scene<{ score: number }> {} },
      start: "main",
    });
    await expect(game.start()).rejects.toThrow(/TN_PLAYTEST_ATTACH_TIMEOUT_INVALID/u);
    await game.stop();
  });

  it("does not hold by default", async () => {
    const canvas = testCanvas();
    const game = defineGame<{ score: number }>({
      initialState: { score: 0 },
      plugins: [playtest()],
      renderer: stubRenderer(canvas),
      scenes: { main: class extends Scene<{ score: number }> {} },
      start: "main",
    });
    await game.start();
    await game.stop();
  });
});
