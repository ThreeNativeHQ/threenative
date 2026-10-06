import { afterEach, describe, expect, it, vi } from "vitest";
import { GpuSolver3D } from "../src/physics/vendor/avbd3d/gpu/solver.js";
import { Rigid } from "../src/physics/vendor/avbd3d/ref/body.js";
import { Solver } from "../src/physics/vendor/avbd3d/ref/solver.js";

function fixture() {
  vi.stubGlobal("GPUBufferUsage", {
    MAP_READ: 1,
    COPY_SRC: 4,
    COPY_DST: 8,
    INDEX: 16,
    VERTEX: 32,
    UNIFORM: 64,
    STORAGE: 128,
    INDIRECT: 256,
    QUERY_RESOLVE: 512,
  });
  vi.stubGlobal("GPUShaderStage", { COMPUTE: 4 });
  const events: string[] = [];
  const raw = {
    features: new Set(["timestamp-query"]),
    limits: { maxStorageBuffersPerShaderStage: 8 },
    createBuffer: (d: { size: number }) => {
      const data = new ArrayBuffer(d.size);
      return { size: d.size, destroy: vi.fn(), getMappedRange: () => data, unmap: vi.fn() };
    },
    createQuerySet: vi.fn(() => ({ destroy: vi.fn() })),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createShaderModule: () => ({}),
    createComputePipeline: () => ({}),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      clearBuffer: () => events.push("clear"),
      beginComputePass: (descriptor: GPUComputePassDescriptor) => {
        events.push(`phase:${descriptor.label}`);
        return {
          setPipeline: () => undefined,
          setBindGroup: () => undefined,
          dispatchWorkgroups: () => undefined,
          dispatchWorkgroupsIndirect: () => undefined,
          end: () => events.push("phase-end"),
        };
      },
      finish: () => ({}),
    }),
    queue: { writeBuffer: () => events.push("upload"), submit: () => events.push("submit") },
  };
  const ref = new Solver();
  new Rigid(ref, [0.1, 0.1, 0.1], 1, 0.3, [0, 0, 1]);
  const solver = new GpuSolver3D(raw as unknown as GPUDevice, ref, {
    profileTimings: false,
    spatialSort: false,
  });
  events.length = 0;
  return { solver, raw, events };
}
afterEach(() => vi.unstubAllGlobals());

describe("pinned donor qualification timestamp hooks", () => {
  it("disables the unused single-map profiler and freezes fourpasses with a stamp before allthreeclears", () => {
    const f = fixture();
    expect(f.raw.createQuerySet).not.toHaveBeenCalled();
    f.solver.splitPasses = true;
    f.solver.stepTiming = {
      beforeClears: () => f.events.push("preclear-stamp"),
      phase: (index) => {
        f.events.push(`timestamp:${index}`);
        return {} as GPUComputePassTimestampWrites;
      },
    };
    f.solver.step();
    const start = f.events.indexOf("preclear-stamp");
    expect(f.events.slice(start, start + 4)).toEqual(["preclear-stamp", "clear", "clear", "clear"]);
    expect(f.events.filter((e) => e.startsWith("timestamp:"))).toEqual([
      "timestamp:0",
      "timestamp:1",
      "timestamp:2",
      "timestamp:3",
    ]);
    expect(f.events.filter((e) => e === "phase-end")).toHaveLength(4);
    expect(f.events.at(-1)).toBe("submit");
  });
  it("rejects a changed pass partition before anyupload or dispatch", () => {
    const f = fixture();
    f.solver.stepTiming = { beforeClears: vi.fn(), phase: vi.fn() };
    expect(() => f.solver.step()).toThrow(/TN_AVBD_TIMING_PARTITION/);
    expect(f.events).toEqual([]);
  });
  it("retains the same fourpasses when hooks areoff", () => {
    const f = fixture();
    f.solver.splitPasses = true;
    f.solver.step();
    expect(f.events.filter((e) => e.startsWith("phase:")).length).toBe(4);
    expect(f.events).not.toContain("preclear-stamp");
    expect(f.raw.createQuerySet).not.toHaveBeenCalled();
  });
});
