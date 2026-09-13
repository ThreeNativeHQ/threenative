import { describe, expect, it } from "vitest";

// PRD-373 phase 2 negative control: a deliberately failing selected job on a real develop PR, so
// `ci-required` is observed going red rather than only proven locally. This file is never merged;
// the canary PR is closed and the branch deleted after the run is recorded.
describe("PRD-373 red canary", () => {
  it("fails on purpose so the website job fails", () => {
    expect(1).toBe(2);
  });
});
