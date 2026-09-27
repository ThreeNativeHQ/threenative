import { expect, test } from "vitest";

import { assertCpuProfileTargetSupported } from "../src/runner/cpuProfile.js";
import { parseStandalonePlaytestArgs } from "../src/runner/config.js";

test("--cpu-prof resolves its output path against the project root", () => {
  const config = parseStandalonePlaytestArgs([
    "scenario.json",
    "--project",
    "/project",
    "--cpu-prof",
    "artifacts/out.cpuprofile",
  ]);

  expect(config.cpuProfilePath).toBe("/project/artifacts/out.cpuprofile");
});

test("--cpu-prof is offered on the browser and desktop targets only", () => {
  expect(() => assertCpuProfileTargetSupported("browser", "/tmp/out.cpuprofile")).not.toThrow();
  expect(() => assertCpuProfileTargetSupported("desktop", "/tmp/out.cpuprofile")).not.toThrow();
  // No flag, no constraint — every target still runs.
  expect(() => assertCpuProfileTargetSupported("android", undefined)).not.toThrow();
  for (const target of ["android", "ios"]) {
    expect(() => assertCpuProfileTargetSupported(target, "/tmp/out.cpuprofile"))
      .toThrow(/TN_PLAYTEST_CPU_PROFILE_UNSUPPORTED/);
  }
});
