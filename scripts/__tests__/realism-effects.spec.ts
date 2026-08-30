import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type IRealismEffectsCoverageRow,
  type IRealismEffectsPlatformResult,
  REALISM_EFFECTS_COVERAGE,
  REALISM_EFFECTS_EXPORTS,
  REALISM_EFFECTS_MANIFEST_ENTRIES,
  validateRealismEffectsCoverage,
  validateRealismEffectsPlatformMatrix,
} from "../realism-effects-coverage.js";
import { checkRealismEffectsPlatformMatrix } from "../realism-effects-matrix.js";

const EFFECT_ROOT = join(
  process.cwd(),
  "packages/create-threenative/templates/starter/src/render/effects",
);
const EFFECTS = [
  {
    constants: ["LENS_DISTORTION_K1", "LENS_DISTORTION_K2", "LENS_DISTORTION_CHROMATIC_ABERRATION"],
    file: "lensDistortion.ts",
    functionName: "lensDistortion",
  },
  {
    constants: ["SPARKLE_THRESHOLD", "SPARKLE_COUNT", "SPARKLE_LENGTH", "SPARKLE_COLOUR"],
    file: "sparkle.ts",
    functionName: "sparkle",
  },
  {
    constants: [
      "GRADUAL_BACKGROUND_START",
      "GRADUAL_BACKGROUND_END",
      "GRADUAL_BACKGROUND_STRENGTH",
      "GRADUAL_BACKGROUND_BOTTOM",
      "GRADUAL_BACKGROUND_TOP",
    ],
    file: "gradualBackground.ts",
    functionName: "gradualBackground",
  },
] as const;

describe("realism-effects coverage", () => {
  it("pins one checked row for every upstream export", () => {
    expect(REALISM_EFFECTS_EXPORTS).toHaveLength(14);
    expect(validateRealismEffectsCoverage({ coverage: REALISM_EFFECTS_COVERAGE })).toEqual([]);
  });

  it("fails closed when a covered equivalent disappears", () => {
    const rows: IRealismEffectsCoverageRow[] = REALISM_EFFECTS_COVERAGE.map((row) =>
      row.exportName === "SharpnessEffect" ? { ...row, equivalent: "missing" } : row,
    );
    expect(validateRealismEffectsCoverage({ coverage: rows })).toEqual([
      expect.stringContaining("SharpnessEffect"),
    ]);
  });

  it("rejects an empty not-covered reason", () => {
    const rows: IRealismEffectsCoverageRow[] = REALISM_EFFECTS_COVERAGE.map((row) =>
      row.exportName === "HBAOEffect" ? { ...row, kind: "not-covered", reason: "" } : row,
    );
    expect(validateRealismEffectsCoverage({ coverage: rows })).toEqual([
      expect.stringContaining("HBAOEffect"),
    ]);
  });

  it("rejects a platform matrix with a hole", () => {
    const matrix: IRealismEffectsPlatformResult[] = REALISM_EFFECTS_COVERAGE.filter(
      (row) => row.kind !== "not-covered",
    )
      .flatMap((row) =>
        ["desktop", "android", "ios"].map((platform) => ({
          exportName: row.exportName,
          platform,
          result: "pass" as const,
        })),
      )
      .slice(1);
    expect(validateRealismEffectsPlatformMatrix(matrix)).toEqual([
      expect.stringContaining("SSGIEffect"),
    ]);
  });

  it("rejects a checked-in platform result that still failed", () => {
    const matrix: IRealismEffectsPlatformResult[] = REALISM_EFFECTS_COVERAGE.filter(
      (row) => row.kind !== "not-covered",
    ).flatMap((row) =>
      ["desktop", "android", "ios"].map((platform) => ({
        exportName: row.exportName,
        platform,
        result: "pass" as const,
      })),
    );
    const first = matrix[0];
    if (first === undefined) throw new Error("the realism-effects matrix fixture is empty");
    matrix[0] = {
      ...first,
      reason: "the adapter could not render this target",
      result: "fail",
    };
    expect(validateRealismEffectsPlatformMatrix(matrix)).toEqual([
      expect.stringContaining("fail is not admissible"),
    ]);
  });

  it("uses explicit JavaScript extensions for addon manifest imports", () => {
    const addonImports = REALISM_EFFECTS_MANIFEST_ENTRIES.filter((entry) =>
      entry.importPath.startsWith("three/addons/"),
    );
    expect(addonImports.length).toBeGreaterThan(0);
    expect(addonImports.every((entry) => entry.importPath.endsWith(".js"))).toBe(true);
  });

  it("checks the checked-in platform evidence through its gate entry point", () => {
    expect(checkRealismEffectsPlatformMatrix(process.cwd())).toEqual([]);
  });

  it("keeps each pure-look effect editable and optional in game-owned source", () => {
    for (const effect of EFFECTS) {
      const source = readFileSync(join(EFFECT_ROOT, effect.file), "utf8");
      expect(source).toMatch(new RegExp(`export function ${effect.functionName}\\b`, "u"));
      expect(source).toMatch(/from "three(?:\/tsl|\/webgpu)?"/u);
      expect(source).not.toMatch(/(?:@threenative|packages\/)/u);
      for (const constant of effect.constants) {
        expect(source.match(new RegExp(`\\b${constant}\\b`, "gu"))?.length ?? 0).toBeGreaterThan(1);
      }
    }
    const gradualBackground = readFileSync(join(EFFECT_ROOT, "gradualBackground.ts"), "utf8");
    expect(gradualBackground).toMatch(/linearDepth/u);
    expect(gradualBackground).toMatch(/options\.depth/u);
    const postprocessing = readFileSync(
      join(
        process.cwd(),
        "packages/create-threenative/templates/starter/src/render/postprocessing.ts",
      ),
      "utf8",
    );
    expect(postprocessing).not.toMatch(/render\/effects\//u);
  });

  it("captures and validates temporal frames on native lanes", () => {
    const runner = readFileSync(
      join(process.cwd(), "packages/runtime-native/conformance/run-conformance.mjs"),
      "utf8",
    );
    const scene = readFileSync(
      join(
        process.cwd(),
        "packages/runtime-native/conformance/scenes/shared/realism-effects-scene.js",
      ),
      "utf8",
    );
    expect(runner).toMatch(/captureNativeTemporalFrames/u);
    expect(runner).toMatch(/result\.native[\s\S]*temporal:/u);
    expect(runner).toMatch(/TN_CONFORMANCE_FROZEN_TEMPORAL_HISTORY/u);
    expect(scene).toMatch(/TN_CONFORMANCE_TEMPORAL_FRAME/u);
  });
});
