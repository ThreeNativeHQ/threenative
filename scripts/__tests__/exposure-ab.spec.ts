import { describe, expect, it } from "vitest";
import { classifyExposureAb, EXPOSURE_AB_THRESHOLDS } from "../exposure-ab.js";

// PRD-278 §5 / AC7. The mined WorldEnvironment claimed `toneMappingExposure` never reaches
// the frame once an output node is installed; the measured settlement
// (docs/verification/exposure-ab-2026-08-30) found the opposite — the scalar is live on
// three@0.185.1 and the comment was wrong. This classification is the guard both directions:
// if the template ever ships an exposure path that truly stops reaching the frame, a re-run
// of scripts/exposure-ab.ts classifies "unchanged" and the shipped claim must be revisited.

describe("classifyExposureAb", () => {
  it("calls the pair changed when every pixel differs and the control is clean", () => {
    // The measured settlement: 100% pixel mismatch, delta-E 5.81, control at exactly zero.
    expect(classifyExposureAb({ pixelMismatchRatio: 1, perceptualDeltaE: 5.81 }, { pixelMismatchRatio: 0, perceptualDeltaE: 0 })).toBe("changed");
  });

  it("refuses to judge when the same-exposure control pair differs", () => {
    expect(
      classifyExposureAb(
        { pixelMismatchRatio: 1, perceptualDeltaE: 5.81 },
        { pixelMismatchRatio: 0.01, perceptualDeltaE: 0.2 },
      ),
    ).toBe("inconclusive");
  });

  it("calls the pair unchanged when the frames match on a clean control", () => {
    expect(classifyExposureAb({ pixelMismatchRatio: 0, perceptualDeltaE: 0 }, { pixelMismatchRatio: 0, perceptualDeltaE: 0 })).toBe("unchanged");
  });

  it("treats sub-floor differences on either metric as no change", () => {
    expect(
      classifyExposureAb(
        {
          pixelMismatchRatio: EXPOSURE_AB_THRESHOLDS.changedPixelRatio,
          perceptualDeltaE: EXPOSURE_AB_THRESHOLDS.perceptualDeltaE,
        },
        { pixelMismatchRatio: 0, perceptualDeltaE: 0 },
      ),
    ).toBe("unchanged");
    expect(
      classifyExposureAb(
        {
          pixelMismatchRatio: EXPOSURE_AB_THRESHOLDS.changedPixelRatio + 1e-9,
          perceptualDeltaE: 0,
        },
        { pixelMismatchRatio: 0, perceptualDeltaE: 0 },
      ),
    ).toBe("changed");
  });

  it("fails closed when a metric is absent", () => {
    expect(classifyExposureAb({}, { pixelMismatchRatio: 0, perceptualDeltaE: 0 })).toBe("unchanged");
    expect(classifyExposureAb({ perceptualDeltaE: 9 }, {})).toBe("changed");
  });
});
