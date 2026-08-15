import { describe, expect, it } from "vitest";
import { applyVariant, backendOf, parseArgs, summarizeFrames } from "../profile-starter.js";

describe("starter profiler", () => {
  it("summarizes frame percentiles and slow frames", () => {
    const summary = summarizeFrames([1, 2, 3, 4, 20]);

    expect(summary).toMatchObject({
      frames: 5,
      maxMs: 20,
      meanMs: 6,
      p50Ms: 3,
      p95Ms: 20,
      p99Ms: 20,
      slowFrames: 1,
    });
  });

  it("fails closed on malformed samples", () => {
    expect(() => summarizeFrames([])).toThrow(/positive finite/);
    expect(() => summarizeFrames([1, Number.NaN])).toThrow(/positive finite/);
  });

  it("applies only declared isolation variants", () => {
    const source = "    ctx.add(sculptureMesh);";

    expect(applyVariant(source, "no-sculpture")).not.toContain("ctx.add(sculptureMesh)");
    expect(() => applyVariant(source, "no-particles" as never)).toThrow(/Unsupported/);
    expect(() => applyVariant("", "no-sculpture")).toThrow(/marker is missing/);
  });

  it("rejects the removed particle profile variant", () => {
    expect(parseArgs(["--variant", "baseline"]).variant).toBe("baseline");
    expect(parseArgs(["--variant", "no-sculpture"]).variant).toBe("no-sculpture");
    expect(() => parseArgs(["--variant", "no-particles"])).toThrow(/baseline or no-sculpture/);
  });

  it("names a software rasteriser instead of reporting it as a GPU", () => {
    expect(backendOf({ architecture: "turing", vendor: "nvidia" })).toBe("hardware");
    expect(backendOf({ architecture: "SwiftShader", vendor: "google" })).toBe("software fallback");
    expect(backendOf({ architecture: "llvmpipe", vendor: "mesa" })).toBe("software fallback");
    expect(backendOf(null)).toBe("unknown");
  });
});
