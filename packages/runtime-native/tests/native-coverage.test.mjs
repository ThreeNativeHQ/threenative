import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  coverageConfigurationBlocker,
  instrumentedFilesFromLcov,
  requireCoverageProfile,
  requireInvocationProfiles,
  summarizeNativeCoverage,
} from "../scripts/measure-native-coverage.mjs";

const cmake = readFileSync(join(import.meta.dirname, "..", "CMakeLists.txt"), "utf8");

describe("native coverage reporting", () => {
  it("reports zero-hit files instead of omitting them", () => {
    const report = summarizeNativeCoverage({
      blockedTargets: [],
      compiledSourceFiles: ["src/webgpu/bindings.cpp", "src/http/http_client.cpp"],
      configuration: "tn-linux",
      instrumentedFiles: [
        { covered: 4, lines: 8, path: "src/webgpu/bindings.cpp" },
        { covered: 0, lines: 6, path: "src/http/http_client.cpp" },
      ],
      sourceFiles: ["src/webgpu/bindings.cpp", "src/http/http_client.cpp"],
    });

    expect(report.compiled).toContainEqual({
      covered: 0,
      lines: 6,
      path: "src/http/http_client.cpp",
      percent: 0,
    });
    expect(report.subsystems).toContainEqual({
      covered: 0,
      lines: 6,
      name: "http",
      percent: 0,
    });
  });

  it("unions executable lines and hits across per-binary LCOV reports", () => {
    expect(
      instrumentedFilesFromLcov([
        "SF:/repo/src/runtime.cpp\nDA:10,1\nDA:11,0\nend_of_record\n",
        "SF:/repo/src/runtime.cpp\nDA:10,0\nDA:11,2\nend_of_record\n",
      ]),
    ).toEqual([]);

    const runtimePath = join(import.meta.dirname, "..", "src", "runtime.cpp");
    expect(
      instrumentedFilesFromLcov([
        `SF:${runtimePath}\nDA:10,1\nDA:11,0\nend_of_record\n`,
        `SF:${runtimePath}\nDA:10,0\nDA:11,2\nend_of_record\n`,
      ]),
    ).toEqual([{ covered: 2, lines: 2, path: "src/runtime.cpp" }]);
  });

  it("fails when profile data is missing", () => {
    expect(() => requireCoverageProfile("/missing/merged.profdata", () => false)).toThrow(
      /coverage profile data is missing.*merged\.profdata/u,
    );
  });

  it("names uncompiled files separately from zero-percent files", () => {
    const report = summarizeNativeCoverage({
      blockedTargets: [],
      compiledSourceFiles: ["src/http/http_client.cpp"],
      configuration: "tn-linux",
      instrumentedFiles: [{ covered: 0, lines: 6, path: "src/http/http_client.cpp" }],
      sourceFiles: ["src/http/http_client.cpp", "src/raytracing/bindings.cpp"],
    });

    expect(report.compiled.map(({ path }) => path)).toEqual(["src/http/http_client.cpp"]);
    expect(report.notCompiled).toEqual(["src/raytracing/bindings.cpp"]);
  });

  it("fails if llvm-cov omits a file proven compiled by compile_commands", () => {
    expect(() =>
      summarizeNativeCoverage({
        blockedTargets: [],
        compiledSourceFiles: ["src/http/http_client.cpp", "src/runtime.cpp"],
        configuration: "tn-linux",
        instrumentedFiles: [{ covered: 1, lines: 1, path: "src/runtime.cpp" }],
        sourceFiles: ["src/http/http_client.cpp", "src/runtime.cpp"],
      }),
    ).toThrow(/llvm-cov omitted compiled source files: src\/http\/http_client\.cpp/u);
  });

  it("preserves every target that failed to build", () => {
    const report = summarizeNativeCoverage({
      blockedTargets: [
        {
          reason: "native physics library is disabled",
          target: "threenative-physics-actuation-bindings-test",
        },
      ],
      configuration: "tn-linux",
      compiledSourceFiles: ["src/runtime.cpp"],
      instrumentedFiles: [{ covered: 1, lines: 1, path: "src/runtime.cpp" }],
      sourceFiles: ["src/runtime.cpp"],
    });

    expect(report.blockedTargets).toEqual([
      {
        reason: "native physics library is disabled",
        target: "threenative-physics-actuation-bindings-test",
      },
    ]);
  });

  it("allows only targets excluded by the accepted configuration to be blocked", () => {
    expect(coverageConfigurationBlocker("threenative-physics-actuation-bindings-test")).toMatch(
      /TN_ENABLE_NATIVE_PHYSICS=OFF/u,
    );
    expect(coverageConfigurationBlocker("threenative-video-recorder-state-test")).toMatch(
      /TN_ENABLE_VIDEO=OFF/u,
    );
    expect(
      coverageConfigurationBlocker("threenative-render-pass-class-table-test"),
    ).toBeUndefined();
  });

  it("fails when any native invocation profile is missing", () => {
    expect(() =>
      requireInvocationProfiles(["render-0-", "compute-0-"], ["render-0-123.profraw"]),
    ).toThrow(/invocation profiles are missing: compute-0-/u);
  });

  it("keeps instrumentation opt-in", () => {
    expect(cmake).toMatch(/option\(TN_ENABLE_COVERAGE[^\n]*OFF\)/u);
    expect(cmake).toMatch(/if\(TN_ENABLE_COVERAGE\)/u);
  });
});
