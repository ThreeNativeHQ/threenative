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
    const packageTest = source.lastIndexOf("run_phase package-test pnpm -r");
    const unit = source.lastIndexOf("run_phase unit vitest run");
    expect(register).toBeGreaterThanOrEqual(0);
    expect(register).toBeLessThan(baseline);
    expect([docs, build, packageTest, unit]).toEqual(
      [...[docs, build, packageTest, unit]].sort((left, right) => left - right),
    );
    expect(source).toContain("worktree-lifecycle.ts verify --phase");
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
