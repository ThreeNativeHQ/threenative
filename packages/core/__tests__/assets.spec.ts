import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Texture } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssetLoader } from "../src/assets.js";
import { defineGame } from "../src/game.js";
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

describe("IAssetLoader", () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it("should dispose a texture once and ignore a double release", async () => {
    const texture = new Texture();
    const dispose = vi.spyOn(texture, "dispose");
    const assets = createAssetLoader({ texture: async () => texture });

    await assets.texture("albedo.png");

    expect(assets.release("texture", "albedo.png")).toBe(true);
    expect(assets.release("texture", "albedo.png")).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("should dispose model geometry, material, and material textures once on clear", async () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const texture = new Texture();
    const material = new MeshBasicMaterial({ map: texture });
    const mesh = new Mesh(geometry, material);
    const scene = new Group().add(mesh);
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");
    const assets = createAssetLoader({ model: async () => ({ scene }) });

    await assets.model("model.glb");
    assets.clear();
    assets.clear();

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });

  it("loads textures through fetch and createImageBitmap when Image is unavailable", async () => {
    const bitmap = { height: 16, width: 16 } as ImageBitmap;
    const createBitmap = vi.fn(async () => bitmap);
    const fetchAsset = vi.fn(
      async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 }),
    );
    vi.stubGlobal("Image", undefined);
    vi.stubGlobal("createImageBitmap", createBitmap);
    vi.stubGlobal("fetch", fetchAsset);

    const texture = await createAssetLoader().texture("native-proof.png");

    expect(fetchAsset).toHaveBeenCalledWith("native-proof.png");
    expect(createBitmap).toHaveBeenCalledOnce();
    expect(texture.image).toBe(bitmap);
    expect(texture.version).toBe(1);
  });

  it("should enter the scene only after load resolves", async () => {
    const events: string[] = [];
    class OrderedScene extends Scene<{ loaded: boolean }> {
      override async load(_ctx: ICtx<{ loaded: boolean }>): Promise<void> {
        await Promise.resolve();
        events.push("load");
      }

      override enter(_ctx: ICtx<{ loaded: boolean }>): void {
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
