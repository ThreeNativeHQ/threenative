import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { hostedRoute, publicSummary } from "../ci-blacksmith-routing.mjs";
import { declaredNeeds, jobSections } from "../ci-workflow.js";

const source = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const native = jobSections(source).find(([name]) => name === "test-native")?.[1] ?? "";
describe("Blacksmith bootstrap remains inert and required CI remains ordinary", () => {
  it("treats absent GitHub repository variables as off", () => {
    expect(hostedRoute({ mode: "", attempt: 1 }).reason).toBe("disabled");
  });
  it.each([
    undefined,
    "off",
    "shadow",
    "enforce",
    "malicious\nrunner=blacksmith-4vcpu-ubuntu-2404",
  ])("returns scalar hosted for %s", (mode) => {
    expect(hostedRoute({ mode, attempt: 1, selection: "full" }).runner).toBe("ubuntu-24.04");
  });
  it("ignores forged admissions, candidate strings and credentials", () => {
    expect(
      hostedRoute({
        mode: "enforce",
        attempt: 1,
        selection: "full",
        runner: "blacksmith-4vcpu-ubuntu-2404",
        admitted: true,
        token: "private",
      }).reason,
    ).toBe("activation-unverified");
    const output = spawnSync(process.execPath, ["scripts/ci-blacksmith-routing.mjs"], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      encoding: "utf8",
      env: { ...process.env, TN_BLACKSMITH_MODE: "enforce\nrunner=blacksmith" },
    });
    expect(output.error).toBeUndefined();
    expect(output.status).toBe(0);
    expect(output.stdout).toMatch(
      /^blacksmith_runner=ubuntu-24\.04\nblacksmith_reason=invalid-mode\n$/u,
    );
  });
  it("puts rerun fallback directly in runs-on, independent of old selector outputs", () => {
    expect(native.match(/^ {4}runs-on: (.+)$/mu)?.[1]).toContain("github.run_attempt > 1");
    expect(native.match(/^ {4}runs-on: (.+)$/mu)?.[1]).toContain("'ubuntu-24.04'");
    expect(native.match(/^ {4}runs-on: (.+)$/mu)?.[1]).not.toContain("blacksmith_runner");
    expect(native.match(/^ {4}runs-on: (.+)$/mu)?.[1]).toContain("selection != 'warm'");
  });
  it.each([
    ["full", 1, "", false, false, "tn-local"],
    ["full", 1, "off", false, false, "tn-local"],
    ["full", 1, "shadow", false, false, "ubuntu-24.04"],
    ["full", 1, "enforce", false, false, "ubuntu-24.04"],
    ["full", 1, "unknown", false, false, "ubuntu-24.04"],
    ["full", 2, "off", false, false, "ubuntu-24.04"],
    ["full", 2, "enforce", false, false, "ubuntu-24.04"],
    ["full", 1, "off", true, false, "ubuntu-24.04"],
    ["full", 1, "off", false, true, "ubuntu-24.04"],
    ["warm", 2, "enforce", true, false, "tn-local"],
    ["warm", 1, "off", false, true, "ubuntu-24.04"],
  ])(
    "evaluates actual scalar runs-on for %s attempt %s mode %s",
    (selection, attempt, mode, forceHosted, fork, expected) => {
      const expression = native.match(/^ {4}runs-on: \$\{\{ (.+) \}\}$/mu)?.[1];
      if (!expression) throw new Error("missing literal runner expression");
      // Tests only: evaluate the checked-in expression against bounded context fixtures.
      const actual = runInNewContext(
        expression,
        {
          needs: { scope: { outputs: { selection, blacksmith_runner: "forged-provider" } } },
          github: { run_attempt: attempt, event: { pull_request: { head: { repo: { fork } } } } },
          vars: {
            TN_RUNNER: "tn-local",
            TN_BLACKSMITH_MODE: mode,
            TN_BLACKSMITH_FORCE_HOSTED: forceHosted ? "true" : "",
          },
        },
        { timeout: 100 },
      );
      expect(actual).toBe(expected);
    },
  );
  it("retains names, selected work, dependencies, timeout, receipts and read-only secrets boundary", () => {
    expect(declaredNeeds(native)).toEqual(["scope", "build-artifacts"]);
    expect(native).toContain("timeout-minutes: 75");
    expect(native).toContain("fromJSON(needs.scope.outputs.plan).jobs['test-native'].required");
    expect(native).toContain("TN_CI_SHA: ${{ needs.scope.outputs.candidate_sha }}");
    expect(source).toMatch(/^permissions:\n {2}contents: read/mu);
    expect(native).not.toMatch(/contents: write|BLACKSMITH.*secrets|useblacksmith\/checkout/u);
    expect(source).not.toMatch(/^ {2}pull_request_target:/mu);
    expect(source).toContain("node scripts/ci-blacksmith-routing.mjs");
    expect(source).not.toContain("blacksmith-4vcpu-ubuntu-2404");
  });
  it("never publishes org billing, tokens or arbitrary candidate text", () => {
    const summary = publicSummary({
      runner: "ubuntu-24.04",
      reason: "activation-unverified",
      used: 2900,
      token: "private",
      period: "private-account",
    });
    expect(summary).toContain("activation-unverified");
    expect(summary).not.toMatch(/2900|private/u);
    expect(publicSummary({ runner: "bad\n", reason: "secret" })).not.toContain("secret");
  });
});
