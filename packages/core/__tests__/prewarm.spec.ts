import {
  AmbientLight,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Sprite,
  SpriteMaterial,
} from "three";
import { describe, expect, it, vi } from "vitest";
import type { IComputeDriven } from "../src/compute-driven.js";
import { defineGame } from "../src/game.js";
import { prewarm } from "../src/index.js";
import { createRenderer } from "../src/renderer.js";
import type { IRendererLike } from "../src/renderer.js";
import { Scene as GameScene, type ICtx } from "../src/scene.js";
import { warmUpScene } from "../src/warmup.js";

function testCanvas(): HTMLCanvasElement {
  const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, value: 180 },
    clientWidth: { configurable: true, value: 320 },
    parentElement: { configurable: true, value: null },
  });
  return canvas as HTMLCanvasElement;
}

function effectivelyVisible(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current !== null) {
    if (current.visible === false) return false;
    current = current.parent;
  }
  return true;
}

class StartupComputeProbe extends Group implements IComputeDriven {
  readonly warmupNodes: readonly unknown[] = ["startup-kernel"];
  #released = false;

  get released(): boolean {
    return this.#released;
  }

  attachRenderer(_renderer: IRendererLike): void {}

  process(_renderer: IRendererLike): void {}

  detach(): void {
    this.#released = true;
  }
}

describe("prewarm", () => {
  it("should compile compute kernels before startup reports ready", async () => {
    const canvas = testCanvas();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { gpu: {} },
    });
    let resolveCompute: () => void = () => undefined;
    const computePromise = new Promise<void>((resolve) => {
      resolveCompute = resolve;
    });
    const computeAsync = vi.fn(() => computePromise);
    const compileAsync = vi.fn(() => Promise.resolve());
    const raw = {
      compileAsync,
      compute: () => undefined,
      computeAsync,
      dispose: () => undefined,
      domElement: canvas,
      init: async () => undefined,
      render: () => undefined,
      setSize: () => undefined,
    };
    const frames: Array<(time: number) => void> = [];
    const previousFrame = globalThis.requestAnimationFrame;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: (time: number) => void) => {
        frames.push(callback);
        return frames.length;
      },
    });
    class ComputeScene extends GameScene {
      static override readonly initialState = {};

      override enter(ctx: ICtx): void {
        ctx.add(new StartupComputeProbe());
        ctx.canvasLayer.opaque = true;
      }
    }
    const game = defineGame({
      renderer: {
        canvas,
        webgpuFactory: () => raw,
      },
      scenes: { compute: ComputeScene },
      start: "compute",
    });

    try {
      await game.start();
      const ctx = game.ctx;
      if (ctx === undefined || frames.length === 0)
        throw new Error("Game did not start its render loop.");
      let ready = false;
      const readiness = ctx.startup.whenReady().then(() => {
        ready = true;
      });

      frames[0]?.(16);
      await Promise.resolve();
      await Promise.resolve();
      expect(computeAsync).toHaveBeenCalledWith("startup-kernel");
      expect(compileAsync).not.toHaveBeenCalled();
      expect(ready).toBe(false);

      resolveCompute();
      for (let index = 1; index < 20; index += 1) {
        await Promise.resolve();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        frames[index]?.(16 + index * 16);
      }
      await readiness;
      expect(compileAsync).toHaveBeenCalledWith(ctx.scene, ctx.camera);
      expect(computeAsync.mock.invocationCallOrder[0]).toBeLessThan(
        compileAsync.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
    } finally {
      game.stop();
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", descriptor);
      if (previousFrame === undefined) Reflect.deleteProperty(globalThis, "requestAnimationFrame");
      else Object.defineProperty(globalThis, "requestAnimationFrame", { value: previousFrame });
    }
  });

  it("should still resolve when a kernel fails to compile", async () => {
    const report = await warmUpScene(
      {
        compileAsync: async () => undefined,
        computeAsync: async () => {
          throw new Error("compute backend rejected the kernel");
        },
      },
      {} as never,
      {} as never,
      { computeNodes: ["broken-kernel"] },
    );

    expect(report.computeCompiled).toBe(0);
    expect(report.computeAbandoned).toBe(1);
    expect(report.computeUnsupported).toBe(false);
    expect(report.timedOut).toBe(false);
  });

  it("keeps meshes visible while setting their material opacity to zero", () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.visible = false;

    prewarm(mesh);

    const material = mesh.material as MeshBasicMaterial;
    expect(mesh.visible).toBe(true);
    expect(material.opacity).toBe(0);
  });

  it("marks the blended pipeline for compilation", () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());

    prewarm([mesh]);

    expect((mesh.material as MeshBasicMaterial).transparent).toBe(true);
  });

  it("isolates a shared material from the unrelated mesh", () => {
    const sharedMaterial = new MeshBasicMaterial({ opacity: 0.65 });
    const transient = new Mesh(new BoxGeometry(1, 1, 1), sharedMaterial);
    const unrelated = new Mesh(new BoxGeometry(1, 1, 1), sharedMaterial);

    prewarm(transient);

    expect(transient.material).not.toBe(sharedMaterial);
    expect((transient.material as MeshBasicMaterial).opacity).toBe(0);
    expect(unrelated.material).toBe(sharedMaterial);
    expect((unrelated.material as MeshBasicMaterial).opacity).toBe(0.65);
  });

  it("preserves shared material aliasing within the requested set", () => {
    const sharedMaterial = new MeshBasicMaterial();
    const meshA = new Mesh(new BoxGeometry(1, 1, 1), sharedMaterial);
    const meshB = new Mesh(new BoxGeometry(1, 1, 1), sharedMaterial);

    prewarm([meshA, meshB]);

    const warmedMaterialA = meshA.material as MeshBasicMaterial;
    const warmedMaterialB = meshB.material as MeshBasicMaterial;
    expect(warmedMaterialA).toBe(warmedMaterialB);
    expect(warmedMaterialA).not.toBe(sharedMaterial);
    expect(warmedMaterialB).not.toBe(sharedMaterial);
    warmedMaterialA.opacity = 0.35;
    expect(warmedMaterialB.opacity).toBe(0.35);
  });

  it("isolates every material in a material array", () => {
    const first = new MeshBasicMaterial({ opacity: 0.4 });
    const second = new MeshBasicMaterial({ opacity: 0.8 });
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), [first, second]);

    prewarm(mesh);

    const materials = mesh.material as MeshBasicMaterial[];
    expect(materials[0]).not.toBe(first);
    expect(materials[1]).not.toBe(second);
    expect(materials.map((material) => material.opacity)).toEqual([0, 0]);
  });

  it("warms the requested subtree without revealing siblings under a hidden ancestor", async () => {
    const ancestor = new Group();
    const target = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    const visibleSibling = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    const hiddenSibling = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    const visibleSprite = new Sprite(new SpriteMaterial());
    const hiddenSprite = new Sprite(new SpriteMaterial());
    const visibleLight = new AmbientLight();
    const nonMeshSibling = new AmbientLight();
    ancestor.visible = false;
    target.visible = false;
    mesh.visible = false;
    hiddenSibling.visible = false;
    hiddenSprite.visible = false;
    nonMeshSibling.visible = false;
    ancestor.add(
      target,
      visibleSibling,
      hiddenSibling,
      visibleSprite,
      hiddenSprite,
      visibleLight,
      nonMeshSibling,
    );
    target.add(mesh);
    const scene = new Scene();
    scene.add(ancestor);
    const compiled: Object3D[] = [];
    const renderer = await createRenderer({
      canvas: testCanvas(),
      preferWebGPU: false,
      webgl2Factory: () => ({
        compileAsync: async (candidate: Object3D) => {
          candidate.traverseVisible((object) => compiled.push(object));
        },
        domElement: testCanvas(),
        render: () => undefined,
        setSize: () => undefined,
      }),
    });

    prewarm(target);
    await renderer.compileAsync(scene, new PerspectiveCamera());

    expect(ancestor.visible).toBe(false);
    expect(target.visible).toBe(true);
    expect(mesh.visible).toBe(true);
    expect((mesh.material as MeshBasicMaterial).opacity).toBe(0);
    expect(visibleSibling.visible).toBe(true);
    expect(hiddenSibling.visible).toBe(false);
    expect(visibleSprite.visible).toBe(true);
    expect(hiddenSprite.visible).toBe(false);
    expect(visibleLight.visible).toBe(true);
    expect(nonMeshSibling.visible).toBe(false);
    expect(effectivelyVisible(visibleSibling)).toBe(false);
    expect(effectivelyVisible(hiddenSibling)).toBe(false);
    expect(effectivelyVisible(visibleSprite)).toBe(false);
    expect(effectivelyVisible(hiddenSprite)).toBe(false);
    expect(effectivelyVisible(visibleLight)).toBe(false);
    expect(effectivelyVisible(nonMeshSibling)).toBe(false);
    expect(compiled.filter((object) => object === mesh)).toHaveLength(1);
    expect(compiled).not.toContain(visibleSibling);
    expect(compiled).not.toContain(hiddenSibling);
    expect(compiled).not.toContain(visibleSprite);
    expect(compiled).not.toContain(hiddenSprite);
    expect(compiled).not.toContain(visibleLight);
    expect(compiled).not.toContain(nonMeshSibling);

    renderer.dispose();
  });
});
