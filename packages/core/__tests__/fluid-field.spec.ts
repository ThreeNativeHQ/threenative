import { Group } from "three";
import { uv } from "three/tsl";
import { describe, expect, it, vi } from "vitest";
import { FluidField2D, mapVorticityForce } from "../src/fluid-field.js";
import type { IRendererLike } from "../src/renderer.js";

function renderer(names: string[]): IRendererLike {
  const canvas = new EventTarget() as HTMLCanvasElement;
  return {
    compileAsync: async () => undefined,
    compute: (node) => names.push((node as { name: string }).name),
    dispose: () => undefined,
    domElement: canvas,
    info: {},
    kind: "webgpu",
    raw: {},
    readback: async () => new ArrayBuffer(0),
    render: () => undefined,
    renderOverlay: () => undefined,
    setOutputNode: () => undefined,
    setSize: () => undefined,
    gpuFrameMs: () => undefined,
    resolveGpuFrame: () => undefined,
    setResolutionScale: () => undefined,
    surface: () => ({
      atFloor: false,
      drawingBufferHeight: 1,
      drawingBufferWidth: 1,
      resolutionScale: 1,
      sampleCount: 1,
      scaleSource: "pinned" as const,
    }),
  };
}

describe("FluidField2D", () => {
  it("fails closed for invalid solver options and exposes read-only field samplers", () => {
    expect(() => new FluidField2D({ resolution: 1 })).toThrow("FluidField2D.resolution");
    expect(() => new FluidField2D({ resolution: 8, pressureIterations: -1 })).toThrow(
      "FluidField2D.pressureIterations",
    );
    expect(() => new FluidField2D({ resolution: 8, viscosity: -1 })).toThrow(
      "FluidField2D.viscosity",
    );

    const field = new FluidField2D({ resolution: 8, pressureIterations: 2 });
    expect(field.velocity.sample(uv())).toMatchObject({ isStorageTextureNode: true });
    expect(field.dye.sample(uv())).toMatchObject({ isStorageTextureNode: true });
    expect(field.warmupNodes).toHaveLength(31);
    expect(field.processCadence).toBe("fixed");
  });

  it("keeps zero-amount input uniform and dispatches the fixed pass order", () => {
    const names: string[] = [];
    const field = new FluidField2D({ resolution: 8, pressureIterations: 2 });
    const gpu = renderer(names);

    field.attachRenderer(gpu);
    expect(names).toHaveLength(8);
    field.splat({ x: 0.5, y: 0.5 }, { x: 1, y: 0 }, 0);
    expect(field.queuedSplats).toBe(0);
    field.process(gpu);

    expect(field.steps).toBe(1);
    expect(field.splatsApplied).toBe(0);
    expect(names.slice(8)).toEqual([
      "fluid.splat.velocity.a",
      "fluid.splat.dye.a",
      "fluid.curl.b",
      "fluid.vorticity.b",
      "fluid.divergence.a",
      "fluid.pressure.reset",
      "fluid.pressure.solve.a",
      "fluid.pressure.solve.b",
      "fluid.gradient.a.a",
      "fluid.advect.velocity.b",
      "fluid.advect.dye.b.a",
    ]);
  });

  it("applies a non-zero splat once and releases resources on scene removal", () => {
    const names: string[] = [];
    const field = new FluidField2D({ resolution: 8, pressureIterations: 0 });
    const firstKernel = field.warmupNodes.at(0);
    if (firstKernel === undefined) throw new Error("test field did not create an initial pass");
    const firstKernelDispose = vi.spyOn(firstKernel, "dispose");
    const gpu = renderer(names);
    const parent = new Group();

    field.attachRenderer(gpu);
    field.splat({ x: 0.5, y: 0.5 }, { x: 0.3, y: -0.1 }, 1);
    expect(field.queuedSplats).toBe(1);
    field.process(gpu);
    expect(field.splatsApplied).toBe(1);
    parent.add(field);
    parent.remove(field);
    expect(field.released).toBe(true);
    expect(firstKernelDispose).toHaveBeenCalledOnce();
    expect(() => field.splat({ x: 0.5, y: 0.5 }, { x: 0, y: 0 }, 1)).toThrow(
      "FluidField2D cannot splat",
    );
  });

  it("maps a nonzero vorticity force to the reference tangent", () => {
    const field = new FluidField2D({
      resolution: 8,
      pressureIterations: 1,
      vorticity: 2,
      timeStep: 0.5,
    });
    const gradient = { x: 3, y: 4 };
    const magnitude = Math.hypot(gradient.x, gradient.y);
    const force = { x: gradient.x / magnitude, y: gradient.y / magnitude };
    const mapped = mapVorticityForce(force, (value) => -value);

    expect(field.vorticity).toBe(2);
    expect(mapped[0]).toBeCloseTo(force.x);
    expect(mapped[1]).toBeCloseTo(-force.y);
    expect(mapped[0] * field.vorticity * field.timeStep).toBeCloseTo(0.6);
    expect(mapped[1] * field.vorticity * field.timeStep).toBeCloseTo(-0.8);
  });

  it("builds the same named pass graph for the same options", () => {
    const first = new FluidField2D({ resolution: 16, viscosity: 0, pressureIterations: 4 });
    const second = new FluidField2D({ resolution: 16, viscosity: 0, pressureIterations: 4 });
    expect(first.warmupNodes.map((node) => node.name)).toEqual(
      second.warmupNodes.map((node) => node.name),
    );
    expect(first.warmupNodes.some((node) => node.name.includes("fade"))).toBe(false);
  });
});
