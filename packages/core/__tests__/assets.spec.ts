import { describe, expect, it } from "vitest";
import { createAssetLoader } from "../src/assets.js";
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

describe("AssetLoader", () => {
  it("should return the same promise for a repeated model request", async () => {
    const requests: string[] = [];
    const assets = createAssetLoader({
      basePath: "/assets",
      model: async (url) => {
        requests.push(url);
        return { url };
      },
    });

    const first = assets.model<{ url: string }>("a.glb");
    const second = assets.model<{ url: string }>("a.glb");

    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ url: "/assets/a.glb" });
    expect(requests).toEqual(["/assets/a.glb"]);
  });

  it("should release one cached asset and reload it on the next request", async () => {
    const requests: string[] = [];
    const assets = createAssetLoader({
      basePath: "/assets",
      model: async (url) => {
        requests.push(url);
        return { url };
      },
    });

    await assets.model("a.glb");

    expect(assets.release("model", "a.glb")).toBe(true);
    expect(assets.release("model", "a.glb")).toBe(false);
    await assets.model("a.glb");

    expect(requests).toEqual(["/assets/a.glb", "/assets/a.glb"]);
  });

  it("should enter the scene only after load resolves", async () => {
    const events: string[] = [];
    class OrderedScene extends Scene<{ loaded: boolean }> {
      override async load(_ctx: Ctx<{ loaded: boolean }>): Promise<void> {
        await Promise.resolve();
        events.push("load");
      }

      override enter(_ctx: Ctx<{ loaded: boolean }>): void {
        events.push("enter");
      }
    }

    const canvas = testCanvas();
    const game = defineGame<{ loaded: boolean }>({
      initialState: { loaded: false },
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
      scenes: { ordered: OrderedScene },
      start: "ordered",
    });

    await game.start();

    expect(events).toEqual(["load", "enter"]);
    game.stop();
  });
});
