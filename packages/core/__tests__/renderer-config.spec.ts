import { describe, expect, it } from "vitest";
import {
  resolveRendererAntialias,
  resolveRendererResolutionScale,
} from "../src/renderer-config.js";

describe("resolveRendererResolutionScale", () => {
  it("selects the Android config override inside the engine", () => {
    expect(
      resolveRendererResolutionScale(
        { resolutionScale: 0.75, android: { resolutionScale: 0.32 } },
        0.5,
        "android",
      ),
    ).toBe(0.32);
  });

  it("uses the portable config value off Android, then the direct renderer fallback", () => {
    expect(
      resolveRendererResolutionScale(
        { resolutionScale: 0.75, android: { resolutionScale: 0.32 } },
        0.5,
        "ios",
      ),
    ).toBe(0.75);
    expect(resolveRendererResolutionScale(undefined, 0.5, "android")).toBe(0.5);
    expect(resolveRendererResolutionScale(undefined, undefined, "android")).toBeUndefined();
  });
});

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
    expect(resolveRendererResolutionScale(config, undefined, "android")).toBe(0.44);
    expect(resolveRendererAntialias(config, undefined, "android")).toBe(true);
  });
});
