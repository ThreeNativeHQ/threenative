import { describe, expect, it } from "vitest";
import {
  exposureReductionSizes,
  exposureSettings,
  validateExposureSettings,
} from "../template-assets/exposure.js";

describe("authored exposure controls", () => {
  it("is opt-in and supplies validated asymmetric game-authored rates", () => {
    expect(exposureSettings.enabled).toBe(false);
    expect(exposureSettings.rateDown).toBeGreaterThan(exposureSettings.rateUp);
    expect(() => validateExposureSettings(exposureSettings)).not.toThrow();
  });
  it.each([
    { key: 0 },
    { key: undefined },
    { rateUp: -1 },
    { rateDown: Number.NaN },
    { snapLo: -1 },
    { snapHi: 0 },
    { snapGain: 2 },
    { minStops: 20 },
    { maxStops: Number.POSITIVE_INFINITY },
    { maxStops: 130 },
    { settleStops: -1 },
    { reportInterval: 0 },
    { maxDelta: 0 },
    { initialExposure: 0 },
    { enabled: "yes" },
  ])("rejects malformed policy %j", (bad) => {
    expect(() => validateExposureSettings({ ...exposureSettings, ...bad } as never)).toThrow(
      /exposure/i,
    );
  });
});

describe("meter reduction topology", () => {
  it("reduces odd and skinny buffers without discarding partial edge blocks", () => {
    expect(exposureReductionSizes(17, 5)).toEqual([
      [5, 2],
      [2, 1],
      [1, 1],
    ]);
    expect(exposureReductionSizes(1, 1025)).toEqual([
      [1, 257],
      [1, 65],
      [1, 17],
      [1, 5],
      [1, 2],
      [1, 1],
    ]);
    expect(exposureReductionSizes(1, 1)).toEqual([[1, 1]]);
    expect(exposureReductionSizes(1920, 1080).at(-1)).toEqual([1, 1]);
  });
  it.each([
    [0, 1],
    [1, -1],
    [1.5, 2],
    [Number.NaN, 1],
    [1, Number.POSITIVE_INFINITY],
  ])("rejects an invalid buffer %s x %s", (width, height) => {
    expect(() => exposureReductionSizes(width, height)).toThrow(/drawing buffer/i);
  });
});
