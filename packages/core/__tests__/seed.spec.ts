import { describe, expect, it } from "vitest";
import { createRandom } from "../src/random.js";

function seededRangeDraws(seed: number): number[] {
  const random = createRandom(seed);
  return Array.from({ length: 8 }, () => random.range(-1, 1));
}

describe("seeded range draws", () => {
  it("reproduces the same sequence for one seed and diverges for another", () => {
    const first = seededRangeDraws(90210);
    const replay = seededRangeDraws(90210);
    const differentSeed = seededRangeDraws(90211);

    expect(replay).toEqual(first);
    expect(differentSeed).not.toEqual(first);
  });
});
