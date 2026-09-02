import { describe, expect, it } from "vitest";
import { formatCoverageSummary, readCoverage, validateCoverage } from "../vfx-niagara-coverage.js";

type MutableCoverage = {
  effects: Array<Record<string, unknown>>;
  requiredGroups?: Record<string, number>;
};

function mutableCoverage(): MutableCoverage {
  return JSON.parse(JSON.stringify(readCoverage())) as MutableCoverage;
}

describe("VFX Niagara coverage gate", () => {
  it("accepts the exact 46-row census and its 21/15/10 group split", () => {
    const coverage = mutableCoverage();
    expect(validateCoverage(coverage, { checkTargets: false })).toEqual([]);
    expect(formatCoverageSummary(coverage)).toContain(
      "46 accounted (21 webgpu-vfx, 15 Effekseer, 10 extras)",
    );
  });

  it("names a missing extra donor row instead of accepting the stale 36 count", () => {
    const coverage = mutableCoverage();
    coverage.effects = coverage.effects.filter((row) => row.id !== "godot-waterfall-mist");
    const errors = validateCoverage(coverage, { checkTargets: false });
    expect(errors.join("\n")).toContain("expected exactly 46 effects; received 45");
    expect(errors.join("\n")).toContain("missing effect id(s): godot-waterfall-mist");
    expect(coverage.effects.some((row) => row.id === "godot-waterfall-mist")).toBe(false);
  });

  it("rejects the archived 36-row report explicitly", () => {
    const coverage = mutableCoverage();
    coverage.effects = coverage.effects.slice(0, 36);
    expect(validateCoverage(coverage, { checkTargets: false })).toContain(
      "stale archive report total 36 is rejected",
    );
  });

  it("requires a pinned donor commit and forbids copied runtime or binary assets", () => {
    const coverage = mutableCoverage();
    const first = coverage.effects[0];
    if (first === undefined) throw new Error("fixture unexpectedly has no effects");
    (first as { donorCommit: string }).donorCommit = "latest";
    (first as { runtimeCodeCopied: boolean }).runtimeCodeCopied = true;
    const errors = validateCoverage(coverage, { checkTargets: false }).join("\n");
    expect(errors).toContain("fire: donorCommit must be a 40-character pinned commit");
    expect(errors).toContain("fire: runtimeCodeCopied must be false");
  });
});
