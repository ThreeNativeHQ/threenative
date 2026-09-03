import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve("scripts/run-test-suite.sh");

describe("run-test-suite phase contract", () => {
  it("registers the lease before the orphan baseline and runs phases in order", async () => {
    const source = await readFile(scriptPath, "utf8");
    const register = source.indexOf("worktree-lifecycle.ts register");
    const baseline = source.indexOf("orphan-cleanup.sh --suite-start");
    const docs = source.lastIndexOf("run_phase docs pnpm run check:docs");
    const build = source.lastIndexOf("run_phase build pnpm run build");
    // The phase runs a composed array now, because CI splits the walk in two and the native half
    // needs a `--filter` this file must not hard-code. Anchor on the call, and prove the shape of
    // what it calls separately below — searching for the old inline `pnpm -r` returned -1 here and
    // reported it as a phase-ordering failure.
    const packageTest = source.lastIndexOf('run_phase package-test "${package_test_command[@]}"');
    const unit = source.lastIndexOf("run_phase unit vitest run");
    expect(register).toBeGreaterThanOrEqual(0);
    expect(register).toBeLessThan(baseline);
    expect([docs, build, packageTest, unit]).toEqual(
      [...[docs, build, packageTest, unit]].sort((left, right) => left - right),
    );
    expect(source).toContain("worktree-lifecycle.ts verify --phase");
  });

  // The composed command is what the phase actually runs, so the contract lives on its shape: a
  // recursive walk, one workspace at a time, skipping packages that declare no `test`. Anything
  // the exclusion knob adds goes between those two ends and can only ever remove packages.
  it("walks every workspace serially unless it is told to exclude one", async () => {
    const source = await readFile(scriptPath, "utf8");
    expect(source).toContain("package_test_command=(pnpm -r --workspace-concurrency=1)");
    expect(source).toContain("package_test_command+=(--if-present run test)");
    expect(source).toContain('package_test_command+=(--filter "!$tn_excluded_package")');
    // Unset means unfiltered: a developer running `pnpm test` still runs the whole gate.
    expect(source).toContain('if [[ -n "${TN_SUITE_EXCLUDE_PACKAGES:-}" ]]; then');
  });

  it("keeps resume restricted to a named known phase", async () => {
    const source = await readFile(scriptPath, "utf8");
    for (const phase of ["docs", "build", "package-test", "unit"]) {
      expect(source).toContain(`${phase})`);
    }
    expect(source).toContain("cannot resume unknown phase");
    expect(source).toContain("resume requires --phase");
  });
});
