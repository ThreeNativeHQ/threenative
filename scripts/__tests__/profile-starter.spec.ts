import { describe, expect, it } from "vitest";
import { applyVariant, summarizeFrames } from "../profile-starter.js";

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
    const source = [
      '    if (ctx.renderer.kind === "webgpu") ctx.add(createParticles());',
      "    ctx.add(sculptureMesh);",
    ].join("\n");

    expect(applyVariant(source, "no-particles")).not.toContain("ctx.add(createParticles())");
    expect(applyVariant(source, "no-sculpture")).not.toContain("ctx.add(sculptureMesh)");
    expect(() => applyVariant("", "no-sculpture")).toThrow(/marker is missing/);
  });
});
