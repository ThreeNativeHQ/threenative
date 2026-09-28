import { afterEach, describe, expect, it, vi } from "vitest";
import { adapterTextureLimits } from "../src/renderer.js";

function withAdapter(limits: Record<string, number> | null): void {
  vi.stubGlobal("navigator", {
    gpu: { requestAdapter: async () => (limits === null ? null : { limits }) },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("adapterTextureLimits", () => {
  it("requests the adapter's texture limits when they exceed the portable 16", async () => {
    withAdapter({
      maxSampledTexturesPerShaderStage: 48,
      maxSamplersPerShaderStage: 16,
      maxBindGroups: 4,
    });
    expect(await adapterTextureLimits()).toEqual({
      requiredLimits: { maxSampledTexturesPerShaderStage: 48 },
    });
  });

  it("asks for nothing on a 16-limit adapter, with no adapter, or without WebGPU", async () => {
    withAdapter({ maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 16 });
    expect(await adapterTextureLimits()).toEqual({});
    withAdapter(null);
    expect(await adapterTextureLimits()).toEqual({});
    vi.stubGlobal("navigator", {});
    expect(await adapterTextureLimits()).toEqual({});
  });
});
