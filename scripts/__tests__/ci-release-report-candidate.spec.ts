import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { makeTempDirSync } from "../../test-support/temp-dir.js";
import { jobSections } from "../ci-workflow.js";

const repo = path.resolve(import.meta.dirname, "../..");
const workflow = readFileSync(path.join(repo, ".github/workflows/native-platforms.yml"), "utf8");
const reportJob = new Map(jobSections(workflow)).get("release-reports") ?? "";
const step =
  reportJob.split("      - name: Emit gate-schema parity and provenance evidence reports\n")[1] ??
  "";
const command =
  (step.split("        run: |\n")[1] ?? "")
    .split(/^ {6}\S/mu)[0]
    ?.split("\n")
    .map((line) => line.slice(10))
    .join("\n") ?? "";

function fixture() {
  const root = makeTempDirSync("ci-release-candidate-");
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.name", "CI fixture");
  git("config", "user.email", "ci@example.invalid");
  writeFileSync(path.join(root, "seed"), "seed");
  git("add", "seed");
  git("commit", "-qm", "candidate");
  const candidate = git("rev-parse", "HEAD");
  for (const relative of [
    "pnpm-lock.yaml",
    "packages/runtime-native/conformance/registry.json",
    "packages/runtime-native/native/physics/Cargo.lock",
  ]) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), "fixture");
  }
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  // Only the report generator boundary is stubbed: execute the real workflow shell, real Git
  // checkout identity and real sha256sum. Never compile native products to test argument wiring.
  writeFileSync(
    path.join(bin, "node"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$CAPTURE"
case "$1" in
  */generate-release-reports.mjs)
    mkdir -p reports
    printf '{}' > reports/parity.json
    printf '{}' > reports/provenance.json
    ;;
esac
`,
    { mode: 0o755 },
  );
  const capture = path.join(root, "arguments.txt");
  const run = (sha: string) =>
    spawnSync("bash", ["-c", command], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
        CAPTURE: capture,
        GITHUB_SHA: "e".repeat(40),
        RUNNER_TEMP: root,
        TN_CI_SHA: sha,
      },
    });
  return { candidate, capture, root, run };
}

describe("PRD-373 native evidence candidate provenance", () => {
  it("reports the captured checkout, not the scheduled workflow's event SHA", () => {
    expect(reportJob).toContain("TN_CI_SHA: ${{ needs.scope.outputs.candidate_sha }}");
    expect(reportJob).toContain("ref: ${{ needs.scope.outputs.candidate_sha }}");
    expect(command).toContain("generate-release-reports.mjs");
    const control = fixture();
    try {
      const result = control.run(control.candidate);
      expect(result.status, result.stderr).toBe(0);
      const args = readFileSync(control.capture, "utf8");
      expect(args).toContain(`--candidate ${control.candidate}`);
      expect(args).not.toContain(`--candidate ${"e".repeat(40)}`);
    } finally {
      rmSync(control.root, { recursive: true, force: true });
    }
  });

  it("refuses report generation when checkout and captured candidate disagree", () => {
    const control = fixture();
    try {
      const result = control.run("d".repeat(40));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("TN_RELEASE_REPORT_CANDIDATE_MISMATCH");
    } finally {
      rmSync(control.root, { recursive: true, force: true });
    }
  });
});
