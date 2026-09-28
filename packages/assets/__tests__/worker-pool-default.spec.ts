import { describe, expect, it } from "vitest";
import { defaultConcurrency } from "../src/worker-pool.js";

const GiB = 1024 ** 3;

describe("defaultConcurrency", () => {
  it("uses every core but one when memory affords it, capped at 12", () => {
    expect(defaultConcurrency(24, 62 * GiB)).toBe(12);
    expect(defaultConcurrency(8, 64 * GiB)).toBe(7);
  });

  it("lets memory bound the workers on a small machine", () => {
    expect(defaultConcurrency(16, 8 * GiB)).toBe(4);
    expect(defaultConcurrency(8, 16 * GiB)).toBe(7);
  });

  it("never drops below one worker", () => {
    expect(defaultConcurrency(1, 1 * GiB)).toBe(1);
  });
});
