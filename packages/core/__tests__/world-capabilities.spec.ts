import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getWorldCapabilities } from "../src/world-capabilities.js";

const gpuLimits = {
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupsPerDimension: 65_535,
  maxStorageBufferBindingSize: 134_217_728,
} as const;

describe("world capabilities", () => {
  it("keeps CPU generation when GPU readback cannot own the canonical field", () => {
    expect(
      getWorldCapabilities({ gpuAvailable: true, cpuFallbackIterations: 4, limits: gpuLimits }),
    ).toMatchObject({
      compute: false,
      cpuFallbackIterations: 4,
      generation: "cpu-fallback",
      gpu: true,
      limits: gpuLimits,
    });
    expect(
      getWorldCapabilities({ gpuAvailable: true, cpuFallbackIterations: 4, limits: gpuLimits })
        .reason,
    ).toMatch(/canonical GPU world-field readback is unsupported/u);
  });

  it("does not infer an active GPU path from limits without adapter availability", () => {
    expect(
      getWorldCapabilities({ cpuFallbackIterations: 4, gpuAvailable: false, limits: gpuLimits }),
    ).toMatchObject({
      generation: "cpu-fallback",
      gpu: false,
    });
  });

  it("passes the actual WebGPU adapter observation from the terrain consumer", () => {
    const source = readFileSync(
      path.resolve("examples/abyss-framework/src/scenes/TerrainProbe.ts"),
      "utf8",
    );
    expect(source).toContain('gpuAvailable: ctx.renderer.kind === "webgpu"');
  });

  it("reports reduced CPU fallback for limits below the GPU requirement", () => {
    const capabilities = getWorldCapabilities({
      cpuFallbackIterations: 6,
      gpuAvailable: true,
      limits: {
        ...gpuLimits,
        maxComputeWorkgroupsPerDimension: 2,
      },
      minimumWorkgroupsPerDimension: 8,
    });
    expect(capabilities.generation).toBe("cpu-fallback");
    expect(capabilities.cpuFallbackIterations).toBe(6);
    expect(capabilities.reason).toMatch(/reduced CPU erosion iterations/u);
  });

  it("reports unsupported when neither compute nor an explicit fallback is viable", () => {
    const capabilities = getWorldCapabilities({ gpuAvailable: false });
    expect(capabilities).toMatchObject({ compute: false, generation: "unsupported" });
    expect(capabilities.reason).toMatch(/unavailable/u);
  });
});
