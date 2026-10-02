import { describe, expect, it } from "vitest";
import { CATMULL_ROM_BASIS } from "../templates/starter/src/render/temporalResolve.js";

// Evaluate the authored polynomial independently in the monomial basis. A smoothing B-spline
// would fail the endpoint/interpolation checks even though its weights also sum to one.
const weights = (phase: number) =>
  CATMULL_ROM_BASIS.map((row) =>
    row.reduce<number>((sum, value, power) => sum + value * phase ** power, 0),
  );

describe("authored temporal reconstruction kernel", () => {
  it("interpolates sample centres and preserves constants, ramps and quadratics", () => {
    expect(weights(0)).toEqual([0, 1, 0, 0]);
    expect(weights(1)).toEqual([0, 0, 1, 0]);
    for (const phase of [0.05, 0.2, 0.5, 0.75, 0.95]) {
      const w = weights(phase);
      expect(w.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
      expect(w.reduce((sum, value, i) => sum + value * (i - 1), 0)).toBeCloseTo(phase, 12);
      expect(w.reduce((sum, value, i) => sum + value * (i - 1) ** 2, 0)).toBeCloseTo(
        phase ** 2,
        12,
      );
    }
  });
  it("retains the known negative lobes that require downstream history clipping", () => {
    expect(weights(0.5)).toEqual([-1 / 16, 9 / 16, 9 / 16, -1 / 16]);
  });
});
