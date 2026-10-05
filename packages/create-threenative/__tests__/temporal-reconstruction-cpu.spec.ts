import { describe, expect, it, vi } from "vitest";
import { GridTexture, Value, cpuTSL } from "./temporal-resolve-cpu-grid.js";
vi.mock("three/tsl", async () => cpuTSL);
import { createExperimentalTemporalResolve } from "../templates/starter/src/render/temporalResolve.js";

import { reconstructNeighbourhood } from "../templates/starter/src/render/temporalResolveMath.js";

describe("actual authored resolve over synthetic texture inputs", () => {
  for (const blend of ["ordinary", "luminance"] as const) {
    it(`clips removed bright centre history on a black neighborhood (${blend})`, () => {
      // Current centre is revealed background .9; its surviving black neighbour and prior bright
      // centre both have depth .2. The inherited donor predicate and canLock therefore accept.
      // This case isolates what the authored colour graph does after that accepted decision.
      const current = new GridTexture(4, 4, () => [0, 0, 0, 1]);
      const previous = new GridTexture(8, 8, () => [1, 1, 1, 1]);
      const source = {
        beautyNode: current,
        _historyRenderTarget: { texture: previous },
        maxVelocityLength: 128,
        useSubpixelCorrection: true,
      };
      const rejection = {
        historyValidity: () => ({
          get: (key: string) =>
            ({
              hasValidHistory: new Value([1]),
              canLock: new Value([1]),
              historyUV: new Value([0.5, 0.5]),
              offsetUV: new Value([0, 0]),
            })[key],
        }),
      };
      const output = createExperimentalTemporalResolve(
        source as never,
        {} as never,
        new Value([0, 0]) as never,
        "linear",
        blend,
        rejection as never,
      ) as unknown as Value;
      for (const channel of output.values.slice(0, 3)) expect(channel).toBeCloseTo(0, 6);
    });
  }
});

describe("raw reconstruction footprint", () => {
  it("preserves a constant at the input corner with clamp-to-edge colour support", () => {
    const source = new GridTexture(4, 4, () => [0.3, 0.3, 0.3, 1]);
    const sampled = reconstructNeighbourhood(
      source as never,
      new Value([0.0625, 0.0625]) as never,
      new Value([4, 4]) as never,
      new Value([0, 0]) as never,
    ) as unknown as { get(name: string): Value };
    for (const channel of sampled.get("color").values.slice(0, 3))
      expect(channel).toBeCloseTo(0.3, 12);
    for (const channel of sampled.get("mean").values.slice(0, 3))
      expect(channel).toBeCloseTo(0.3, 12);
    for (const channel of sampled.get("variance").values.slice(0, 3))
      expect(channel).toBeCloseTo(0, 8);
  });
  it("reconstructs the current colour when only the input height is reduced", () => {
    const current = new GridTexture(8, 4, (x, y) =>
      x === 4 && y === 2 ? [1, 1, 1, 1] : [0, 0, 0, 1],
    );
    const previous = new GridTexture(8, 8, () => [0, 0, 0, 1]);
    const source = {
      beautyNode: current,
      _historyRenderTarget: { texture: previous },
      maxVelocityLength: 128,
    };
    const rejection = {
      historyValidity: () => ({
        get: (key: string) =>
          ({
            hasValidHistory: new Value([0]),
            canLock: new Value([0]),
            historyUV: new Value([0.5, 0.5]),
            offsetUV: new Value([0, 0]),
          })[key],
      }),
    };
    const output = createExperimentalTemporalResolve(
      source as never,
      {} as never,
      new Value([0, 0.25]) as never,
      "linear",
      "ordinary",
      rejection as never,
    ) as unknown as Value;
    // Independently place the nine physical input samples about (4,2). The lit sample is (4,2)
    // at physical (4.5,2.75), while the closest gather centre is raw (4,1).
    let total = 0;
    for (let y = 0; y <= 2; y++)
      for (let x = 3; x <= 5; x++)
        total += Math.exp(-2.29 * ((4 - (x + 0.5)) ** 2 + (2 - (y + 0.75)) ** 2));
    const expected = Math.exp(-2.29 * (0.5 ** 2 + 0.75 ** 2)) / total;
    expect(current.sample(new Value([0.5, 0.5])).values[0]).toBe(0.25);
    expect(expected).toBeLessThan(0.2);
    for (const channel of output.values.slice(0, 3)) expect(channel).toBeCloseTo(expected, 12);
  });
  it("keeps stable constant coverage and ignores white history when history is invalid", () => {
    for (const valid of [0, 1]) {
      const current = new GridTexture(4, 4, () => [0.3, 0.3, 0.3, 1]);
      const previous = new GridTexture(8, 8, () => (valid ? [0.3, 0.3, 0.3, 1] : [1, 1, 1, 1]));
      const source = {
        beautyNode: current,
        _historyRenderTarget: { texture: previous },
        maxVelocityLength: 128,
      };
      const rejection = {
        historyValidity: () => ({
          get: (key: string) =>
            ({
              hasValidHistory: new Value([valid]),
              historyUV: new Value([0.5, 0.5]),
              offsetUV: new Value([0, 0]),
            })[key],
        }),
      };
      const result = createExperimentalTemporalResolve(
        source as never,
        {} as never,
        new Value([0, 0]) as never,
        "linear",
        "ordinary",
        rejection as never,
      ) as unknown as Value;
      for (const channel of result.values.slice(0, 3)) expect(channel).toBeCloseTo(0.3, 12);
    }
  });
});
