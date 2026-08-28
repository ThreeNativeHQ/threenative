import { describe, expect, it } from "vitest";
import { resolveRendererAntialias, resolveRendererScaleSetting } from "../src/renderer-config.js";

describe("resolveRendererAntialias", () => {
  it("selects the Android sampling override inside the engine", () => {
    expect(
      resolveRendererAntialias({ antialias: true, android: { antialias: false } }, true, "android"),
    ).toBe(false);
  });

  it("uses the portable config value off Android, then the direct renderer fallback", () => {
    expect(
      resolveRendererAntialias({ antialias: true, android: { antialias: false } }, false, "ios"),
    ).toBe(true);
    expect(resolveRendererAntialias(undefined, false, "android")).toBe(false);
    expect(resolveRendererAntialias(undefined, undefined, "android")).toBeUndefined();
  });

  it("lets a platform that scales resolution down buy sampling back on that platform", () => {
    // The defect this closes: the Android override block carried `resolutionScale` alone, so a
    // game trading resolution for frame budget could not portably restore quality on the same
    // platform. Both keys resolve on one seam or neither is usable.
    const config = { android: { antialias: true, resolutionScale: 0.44 } };
    expect(resolveRendererScaleSetting(config, undefined, "android").resolutionScale).toBe(0.44);
    expect(resolveRendererAntialias(config, undefined, "android")).toBe(true);
  });
});

describe("resolveRendererScaleSetting", () => {
  it("resolves a pinned number and names it pinned", () => {
    expect(
      resolveRendererScaleSetting({ android: { resolutionScale: 0.32 } }, undefined, "android"),
    ).toEqual({
      resolutionScale: 0.32,
      scaleSource: "pinned",
    });
  });

  it('resolves "auto" to a full-resolution start the scaler walks down from', () => {
    // Phase 1 ships the contract without the loop: "auto" is accepted, reported as auto, and
    // begins where a game with no scale begins today. Nothing moves it yet.
    expect(resolveRendererScaleSetting({ resolutionScale: "auto" }, undefined, "ios")).toEqual({
      resolutionScale: 1,
      scaleSource: "auto",
    });
    expect(
      resolveRendererScaleSetting(
        { resolutionScale: 0.5, android: { resolutionScale: "auto" } },
        undefined,
        "android",
      ),
    ).toEqual({ resolutionScale: 1, scaleSource: "auto" });
  });

  it("defaults to a pinned full-resolution surface when nothing asked for one", () => {
    expect(resolveRendererScaleSetting(undefined, undefined, "linux")).toEqual({
      resolutionScale: 1,
      scaleSource: "pinned",
    });
  });

  it("refuses a scale that cannot describe a drawing buffer", () => {
    for (const bad of [0, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => resolveRendererScaleSetting({ resolutionScale: bad }, undefined, "linux"),
        `scale ${String(bad)}`,
      ).toThrow(/resolutionScale/u);
    }
    expect(() =>
      resolveRendererScaleSetting(
        { resolutionScale: "adaptive" as unknown as number },
        undefined,
        "linux",
      ),
    ).toThrow(/resolutionScale/u);
  });

  it("names the Android override in its error, so the caller knows which key to fix", () => {
    expect(() =>
      resolveRendererScaleSetting({ android: { resolutionScale: 2 } }, undefined, "android"),
    ).toThrow(/renderer\.android\.resolutionScale/u);
  });
});
