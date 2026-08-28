import { describe, expect, it } from "vitest";
import { resolveRendererResolutionScale } from "../src/renderer-config.js";

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
