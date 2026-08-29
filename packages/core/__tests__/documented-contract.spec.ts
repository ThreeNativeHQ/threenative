import { type IPlaytestBridgeV1, PLAYTEST_BRIDGE_GLOBAL } from "@threenative/playtest";
import type { Vector2 } from "three";
import { describe, expect, it, vi } from "vitest";
import { defineGame } from "../src/game.js";
import { playtest } from "../src/playtest.js";
import { Scene } from "../src/scene.js";
import { createGameStore } from "../src/state.js";

const DOCUMENTED_RESOURCE_IDS = ["state", "GameState"] as const;
const DOCUMENTED_FLUSH_INTERVAL_MS = 100;

function testCanvas(): HTMLCanvasElement {
  const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, value: 180 },
    clientWidth: { configurable: true, value: 320 },
    parentElement: { configurable: true, value: null },
  });
  return canvas as HTMLCanvasElement;
}

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

function bridge(): IPlaytestBridgeV1 {
  const value = (globalThis as Record<string, unknown>)[PLAYTEST_BRIDGE_GLOBAL];
  if (typeof value !== "object" || value === null)
    throw new Error("Playtest bridge was not installed.");
  return value as IPlaytestBridgeV1;
}

describe("documented runtime contracts", () => {
  it("keeps the documented state resource ids exact", async () => {
    const game = defineGame({
      initialState: { score: 0 },
      plugins: [playtest()],
      renderer: stubRenderer(testCanvas()),
      scenes: { test: class extends Scene {} },
      start: "test",
    });

    await game.start();
    try {
      const resources = (await bridge().sample({})).resources;
      expect(Object.keys(resources ?? {}).sort()).toEqual([...DOCUMENTED_RESOURCE_IDS].sort());
      expect(resources?.state).toEqual(resources?.GameState);
    } finally {
      game.stop();
    }
  });

  it("keeps the default state flush interval at the documented 100ms", () => {
    vi.useFakeTimers();
    const store = createGameStore({ score: 0 });
    let notifications = 0;
    const unsubscribe = store.subscribe(() => notifications++);
    store.start();
    store.set({ score: 1 });

    try {
      vi.advanceTimersByTime(DOCUMENTED_FLUSH_INTERVAL_MS - 1);
      expect(notifications).toBe(0);
      vi.advanceTimersByTime(1);
      expect(notifications).toBe(1);
    } finally {
      unsubscribe();
      store.stop();
      vi.useRealTimers();
    }
  });

  it("keeps the documented pointer surface on a running context", async () => {
    class PointerContractScene extends Scene {
      static override readonly initialState = {};
    }

    const game = defineGame({
      renderer: stubRenderer(testCanvas()),
      scenes: { test: PointerContractScene },
      start: "test",
    });

    await game.start();
    try {
      expect(typeof game.ctx?.pointer.on).toBe("function");
      expect(typeof game.ctx?.pointer.drag).toBe("function");
    } finally {
      game.stop();
    }
  });
});
