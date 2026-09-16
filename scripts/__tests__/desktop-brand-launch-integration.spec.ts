import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";

it("preserves both branding inspection and Windows release launch when branches reconcile", async () => {
  const workflow = await readFile(path.resolve(".github/workflows/native-platforms.yml"), "utf8");
  const step = (name: string) => {
    const marker = `      - name: ${name}\n`;
    const start = workflow.indexOf(marker);
    expect(start, name).toBeGreaterThanOrEqual(0);
    const next = workflow.indexOf("\n      - ", start + marker.length);
    return workflow.slice(start, next < 0 ? undefined : next);
  };
  expect(step("Inspect the release container's game brand")).toContain("--brand-only");
  for (const name of [
    "Verify the relocated release container with the installed verifier",
    "Launch the relocated container with no developer toolchain",
  ]) {
    expect(step(name), name).not.toContain("matrix.platform != 'Windows'");
  }
  const capture = step("Collect the release container's capture and report");
  expect(capture).toContain("if: always()");
  expect(capture).not.toContain("matrix.platform != 'Windows'");
  expect(capture).toContain('cygpath -u "$RUNNER_TEMP"');
  expect(capture).toContain("starter-container-report.json");
});
