import { Vector2 } from "three";
import CanvasTarget from "three/src/renderers/common/CanvasTarget.js";
import WebGPUBackend from "three/src/renderers/webgpu/WebGPUBackend.js";
// @ts-expect-error Three's private texture allocator has no public declaration.
import WebGPUTextureUtils from "three/src/renderers/webgpu/utils/WebGPUTextureUtils.js";
// @ts-expect-error Three's private WebGPU utilities have no public declaration.
import WebGPUUtils from "three/src/renderers/webgpu/utils/WebGPUUtils.js";
import { WebGPURenderer } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";

interface IAllocation {
  readonly label: string;
  readonly size: { readonly width: number; readonly height: number };
  readonly sampleCount: number;
  readonly format: string;
  destroyed: number;
}

function fixture(mode: string) {
  vi.stubGlobal("GPUTextureUsage", {
    COPY_SRC: 1,
    COPY_DST: 2,
    TEXTURE_BINDING: 4,
    STORAGE_BINDING: 8,
    RENDER_ATTACHMENT: 16,
  });
  const canvas = { width: 1920, height: 1080 };
  const target = new CanvasTarget(canvas as HTMLCanvasElement);
  const data = new WeakMap<object, Record<string, unknown>>();
  const allocations: IAllocation[] = [];
  const renderer = {
    currentSamples: 4,
    depth: true,
    stencil: false,
    reversedDepthBuffer: false,
    getRenderTarget: () => null,
    getCanvasTarget: () => target,
  };
  const backend = {
    renderer,
    getDrawingBufferSize: () => target.getDrawingBufferSize(new Vector2()),
    get(object: object) {
      let entry = data.get(object);
      if (!entry) {
        entry = {};
        data.set(object, entry);
      }
      return entry;
    },
    delete: (object: object) => data.delete(object),
    context: { getCurrentTexture: () => ({ createView: () => ({}) }) },
    device: {
      features: new Set(),
      createTexture(descriptor: Omit<IAllocation, "destroyed">) {
        const allocation: IAllocation = { ...structuredClone(descriptor), destroyed: 0 };
        allocations.push(allocation);
        return {
          destroy: () => allocation.destroyed++,
          createView: () => ({ allocation }),
        };
      },
    },
    utils: undefined as unknown,
    textureUtils: undefined as unknown,
  };
  const utils = new WebGPUUtils(backend);
  utils.getPreferredCanvasFormat = () => "bgra8unorm";
  backend.utils = utils;
  // Construction does not initialize a GPU device. Exercise the shipped bundle as well as src.
  const compiledBackend =
    mode === "distribution"
      ? new WebGPURenderer({ canvas: canvas as HTMLCanvasElement }).backend
      : undefined;
  const textures = compiledBackend
    ? Reflect.get(compiledBackend, "textureUtils")
    : new WebGPUTextureUtils(backend);
  const passDescriptor = Reflect.get(
    compiledBackend ?? WebGPUBackend.prototype,
    "_getDefaultRenderPassDescriptor",
  );
  textures.backend = backend;
  backend.textureUtils = textures;
  return { canvas, target, renderer, backend, textures, passDescriptor, allocations };
}

afterEach(() => vi.unstubAllGlobals());

describe.each(["source", "distribution"])(
  "%s default canvas attachment allocation lifecycle",
  (mode) => {
    it("reuses an unchanged MSAA color attachment across repeated requests", () => {
      const state = fixture(mode);
      const first = state.textures.getColorBuffer();
      for (let call = 0; call < 50; call++) state.textures.getColorBuffer();
      expect(state.allocations).toHaveLength(1);
      expect(state.textures.getColorBuffer()).toBe(first);
      expect(state.allocations[0]?.destroyed).toBe(0);
      expect([state.target.colorTexture.width, state.target.colorTexture.height]).toEqual([
        1920, 1080,
      ]);
      expect(state.canvas).toEqual({ width: 1920, height: 1080 });
    });

    it("retains the same MSAA color texture across output and direct render passes", () => {
      const state = fixture(mode);
      for (let frame = 0; frame < 50; frame++) {
        for (const samples of [4, 0]) {
          state.renderer.currentSamples = samples;
          state.passDescriptor.call(state.backend);
        }
      }
      const color = state.allocations.filter((allocation) => allocation.label === "colorBuffer");
      const depth = state.allocations.filter((allocation) => allocation.label === "depthBuffer");
      expect(color).toHaveLength(1);
      expect(color[0]?.destroyed).toBe(0);
      expect(depth).toHaveLength(100);
      expect(depth.slice(0, -1).every((allocation) => allocation.destroyed === 1)).toBe(true);
      expect(depth.at(-1)?.destroyed).toBe(0);
      expect(depth.map((allocation) => allocation.sampleCount)).toEqual(
        Array.from({ length: 100 }, (_, index) => (index % 2 === 0 ? 4 : 1)),
      );
      expect(
        state.allocations.every(
          (allocation) => allocation.size.width === 1920 && allocation.size.height === 1080,
        ),
      ).toBe(true);
      state.textures.destroyTexture(state.target.colorTexture);
      state.textures.destroyTexture(state.target.depthTexture);
      expect(state.allocations.every((allocation) => allocation.destroyed === 1)).toBe(true);
    });

    it("replaces color attachments only when size or sample count changes", () => {
      const state = fixture(mode);
      for (const [width, height, samples] of [
        [1920, 1080, 4],
        [1280, 720, 4],
        [3, 3, 4],
        [1920, 1080, 4],
        [1920, 1080, 1],
      ] as const) {
        state.target.setSize(width, height, false);
        state.renderer.currentSamples = samples;
        state.textures.getColorBuffer();
        state.textures.getColorBuffer();
        expect(state.canvas).toEqual({ width, height });
      }
      expect(
        state.allocations.map(({ size, sampleCount }) => [size.width, size.height, sampleCount]),
      ).toEqual([
        [1920, 1080, 4],
        [1280, 720, 4],
        [3, 3, 4],
        [1920, 1080, 4],
        [1920, 1080, 1],
      ]);
      expect(state.allocations.slice(0, -1).every((allocation) => allocation.destroyed === 1)).toBe(
        true,
      );
      expect(state.allocations.at(-1)?.destroyed).toBe(0);
    });

    it("recreates a destroyed color attachment at the same size", () => {
      const state = fixture(mode);
      const first = state.textures.getColorBuffer();
      state.textures.destroyTexture(state.target.colorTexture);
      const replacement = state.textures.getColorBuffer();
      expect(replacement).toBeDefined();
      expect(replacement).not.toBe(first);
      expect(state.allocations).toHaveLength(2);
      expect(state.allocations[0]?.destroyed).toBe(1);
      expect(state.allocations[1]?.destroyed).toBe(0);
    });
  },
);
