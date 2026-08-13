import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { Registry } from "../src/entities.js";
import { defineGame } from "../src/game.js";
import { Scene } from "../src/scene.js";

function testCanvas(): HTMLCanvasElement {
  const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, value: 180 },
    clientWidth: { configurable: true, value: 320 },
    parentElement: { configurable: true, value: null },
  });
  return canvas as HTMLCanvasElement;
}

describe("Registry", () => {
  it("resolves a registered entity by name", () => {
    const registry = new Registry();
    const player = { hull: 100 };

    expect(registry.add("player", player)).toBe(player);
    expect(registry.get("player")).toBe(player);
  });

  it("throws when a name is registered twice", () => {
    const registry = new Registry();
    registry.add("player", {});

    expect(() => registry.add("player", {})).toThrow('Entity "player" already registered.');
  });

  it("prefers debug() over autoFields", () => {
    const registry = new Registry();
    registry.add("player", {
      hull: 100,
      debug: () => ({ hull: 97, pos: [1, 2, 3] }),
    });

    expect(registry.snapshot()).toEqual({ player: { hull: 97, pos: [1, 2, 3] } });
  });

  it("does not serialize a THREE.Mesh into the snapshot", () => {
    const registry = new Registry();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.position.set(1, 2, 3);
    registry.add("mesh", mesh);

    const fields = registry.snapshot().mesh ?? {};
    expect(Object.keys(fields).length).toBeLessThanOrEqual(24);
    expect(fields).not.toHaveProperty("geometry");
    expect(fields.position).toEqual([1, 2, 3]);
  });

  it("supports vector toArray values without walking prototypes", () => {
    const registry = new Registry();
    registry.add("player", { position: new Vector3(1, 2, 3), inherited: undefined });

    expect(registry.snapshot()).toEqual({ player: { position: [1, 2, 3] } });
  });

  it("includes entity tags in the snapshot", () => {
    const registry = new Registry();
    registry.add("coin.3", { tags: ["coin"] });

    expect(registry.snapshot()).toEqual({ "coin.3": { tags: ["coin"] } });
  });

  it("disposes registered resources when removed or cleared", () => {
    const registry = new Registry();
    let removed = 0;
    let cleared = 0;
    registry.add("removed", {
      dispose: () => {
        removed += 1;
      },
    });
    registry.add("cleared", {
      dispose: () => {
        cleared += 1;
      },
    });
    registry.remove("removed");
    registry.clear();
    expect(removed).toBe(1);
    expect(cleared).toBe(1);
  });

  it("should dispose a queued entity when the frame sweeps", () => {
    const registry = new Registry();
    let disposed = 0;
    const coin = {
      dispose: () => {
        disposed += 1;
      },
    };
    registry.add("coin.3", coin);

    registry.queueFree(coin);
    registry.sweep();

    expect(disposed).toBe(1);
    expect(registry.get("coin.3")).toBeUndefined();
  });

  it("should keep the entity live until the sweep runs", () => {
    const registry = new Registry();
    const coin = {};
    registry.add("coin.3", coin);

    registry.queueFree("coin.3");

    expect(registry.get("coin.3")).toBe(coin);
  });

  it("should throw when remove is called during iteration", () => {
    const registry = new Registry();
    registry.add("observer", {
      debug: () => {
        registry.remove("other");
        return {};
      },
    });
    registry.add("other", {});

    expect(() => registry.snapshot()).toThrow(TypeError);
  });

  it("empties the registry when a scene exits", async () => {
    let sceneRegistry: Registry | undefined;
    class RegisteredScene extends Scene<Record<string, unknown>> {
      override enter(ctx: { entities: Registry }): void {
        sceneRegistry = ctx.entities;
        ctx.entities.add("player", { hull: 100 });
      }
    }
    const canvas = testCanvas();
    const game = defineGame({
      initialState: {},
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
      scenes: { registered: RegisteredScene },
      start: "registered",
    });

    await game.start();
    expect(sceneRegistry?.snapshot()).toEqual({ player: { hull: 100 } });
    game.stop();
    expect(sceneRegistry?.snapshot()).toEqual({});
  });
});
