import {
  type CanvasTexture,
  type Mesh,
  type MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
} from "three";
import { expect, it, vi } from "vitest";
import {
  createLoadingScreen,
  createSpawnReadiness,
} from "../../../examples/strata-terrain-preview/src/render/loading.js";

function host(ready: Promise<void>) {
  return {
    camera: new PerspectiveCamera(),
    scene: new Scene(),
    renderer: { compileAsync: vi.fn(async () => undefined) },
    canvasLayer: {
      scene: new Scene(),
      camera: new OrthographicCamera(-400, 400, 300, -300, 0, 2),
      opaque: false,
      keepWorldRendering: false,
    },
    startup: { progress: 0.5, whenReady: () => ready },
  };
}

it("uploads the status canvas only when its displayed text changes", async () => {
  const drawn: string[] = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      clearRect: () => undefined,
      fillText: (text: string) => drawn.push(text),
    }),
  };
  vi.stubGlobal("document", { createElement: () => canvas });
  let reject: (reason: Error) => void = () => undefined;
  const source = host(
    new Promise<void>((_resolve, fail) => {
      reject = fail;
    }),
  );
  const screen = createLoadingScreen(source);
  try {
    const status = source.canvasLayer.scene.children[3] as Mesh<never, MeshBasicMaterial>;
    const texture = status.material.map as CanvasTexture;
    source.startup.progress = 0.95;
    screen.update();
    const version = texture.version;
    for (let frame = 0; frame < 100; frame += 1) screen.update();
    source.startup.progress = 0.951;
    screen.update();
    expect(texture.version).toBe(version);
    expect(drawn).toEqual(["0%", "95%"]);
    source.startup.progress = 0.96;
    screen.update();
    expect(texture.version).toBe(version + 1);
    expect(drawn).toEqual(["0%", "95%", "96%"]);
    reject(new Error("Forest spawn: missing cell"));
    await Promise.resolve();
    screen.update();
    expect(texture.version).toBe(version + 2);
    expect(drawn.at(-1)).toBe("Forest spawn: missing cell");
    expect(source.canvasLayer.opaque).toBe(true);
  } finally {
    screen.finish();
    vi.unstubAllGlobals();
  }
});

it("keeps the curtain and names a failed spawn even after framework readiness fails open", async () => {
  let reject: (reason: Error) => void = () => undefined;
  const source = host(
    new Promise<void>((_resolve, fail) => {
      reject = fail;
    }),
  );
  const screen = createLoadingScreen(source);
  reject(new Error("Spawn terrain: missing tile 0:0"));
  await Promise.resolve();
  await Promise.resolve();
  screen.update();
  expect(source.canvasLayer.opaque).toBe(true);
  expect(source.canvasLayer.keepWorldRendering).toBe(false);
  const backdrop = source.canvasLayer.scene.children[0] as Mesh;
  expect(backdrop.userData.loadingError).toBe("Spawn terrain: missing tile 0:0");
  const fill = source.canvasLayer.scene.children[2] as Mesh;
  expect((fill.material as MeshBasicMaterial).color.getHex()).toBe(0xe36b5c);
  screen.finish();
  expect(source.canvasLayer.scene.children).toHaveLength(0);
});

it("releases its layer only after the combined spawn and startup promise resolves", async () => {
  let resolve: () => void = () => undefined;
  const source = host(
    new Promise<void>((done) => {
      resolve = done;
    }),
  );
  const screen = createLoadingScreen(source);
  screen.update();
  expect(source.canvasLayer.opaque).toBe(true);
  resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(source.canvasLayer.opaque).toBe(false);
  expect(source.canvasLayer.scene.children).toHaveLength(0);
});

it("latches playable coverage so later spawn eviction never disables controls", async () => {
  const spawn = createSpawnReadiness("Strata spawn");
  expect(spawn.ready).toBe(false);
  spawn.observe(false);
  expect(spawn.ready).toBe(false);
  spawn.observe(true);
  await spawn.promise;
  spawn.observe(false, 1);
  expect(spawn.ready).toBe(true);
  expect(spawn.error).toBe("");
  spawn.cancel();
});

it("rejects a timed out spawn and never treats later coverage as playable", async () => {
  vi.useFakeTimers();
  const spawn = createSpawnReadiness("Forest spawn", 100);
  const rejection = expect(spawn.promise).rejects.toThrow("Forest spawn admission exceeded 100 ms");
  await vi.advanceTimersByTimeAsync(100);
  await rejection;
  spawn.observe(true);
  expect(spawn.ready).toBe(false);
  expect(spawn.error).toContain("exceeded");
  spawn.cancel();
  vi.useRealTimers();
});

it("cancels a pending scene without leaving its readiness promise or timer behind", async () => {
  vi.useFakeTimers();
  const spawn = createSpawnReadiness("Forest spawn");
  const rejection = expect(spawn.promise).rejects.toThrow("Forest spawn cancelled");
  spawn.cancel();
  await rejection;
  expect(vi.getTimerCount()).toBe(0);
  expect(spawn.ready).toBe(false);
  vi.useRealTimers();
});

it("keeps even an empty-message rejection failed after late coverage", async () => {
  const spawn = createSpawnReadiness("Strata spawn");
  const rejection = expect(spawn.promise).rejects.toThrow("Strata spawn failed");
  spawn.fail(new Error());
  await rejection;
  spawn.observe(true);
  expect(spawn.ready).toBe(false);
  spawn.cancel();
});
