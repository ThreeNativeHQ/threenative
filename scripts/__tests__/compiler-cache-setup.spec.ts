import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/native-platforms.yml", import.meta.url),
  "utf8",
);
const bash = execFileSync("bash", ["-c", "command -v bash"], { encoding: "utf8" }).trim();

function stepScript(name: string): string {
  const step = workflow.split(`      - name: ${name}\n`)[1]?.split("\n      - ")[0];
  assert.ok(step, `Missing step: ${name}`);
  assert.match(step, /shell: bash/u);
  const run = step.split("        run: |\n")[1];
  assert.ok(run, `Missing script: ${name}`);
  return run.replace(/^ {10}/gmu, "");
}

// Execute the actual workflow script. Functions replace only the external tools; an empty
// PATH keeps a developer's installed ccache/Chocolatey/Homebrew out of the fixtures.
function runStep(script: string, tools: string) {
  const root = mkdtempSync(path.join(tmpdir(), "threenative-ccache-"));
  const envFile = path.join(root, "github-env");
  writeFileSync(envFile, "");
  try {
    const result = spawnSync(
      bash,
      [
        "--noprofile",
        "--norc",
        "-e",
        "-o",
        "pipefail",
        "-c",
        `sleep() { :; }\n${tools}\n${script}`,
      ],
      { encoding: "utf8", env: { ...process.env, GITHUB_ENV: envFile, PATH: "" }, timeout: 5_000 },
    );
    assert.ifError(result.error);
    return { ...result, githubEnv: readFileSync(envFile, "utf8") };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

for (const [platform, installer] of [["Windows", "choco"], ["macOS", "brew"]] as const) {
  describe(`${platform} compiler cache setup`, () => {
    const script = stepScript(`Install ccache on ${platform}`);

    it("reuses a working cache without contacting an unavailable package feed", () => {
      const result = runStep(script, `
        ccache() { echo "existing ccache $*"; }
        ${installer}() { echo "unexpected package feed access" >&2; return 97; }
      `);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /existing ccache --version/u);
      assert.equal(result.stderr, "");
      assert.equal(result.githubEnv, "");
    });

    it("installs a missing cache and verifies it before enabling the launcher", () => {
      const result = runStep(script, `
        ${installer}() {
          echo "install $*"
          ccache() { echo "installed ccache $*"; }
        }
      `);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /install install ccache/u);
      assert.match(result.stdout, /installed ccache --version/u);
      assert.equal(result.githubEnv, "");
    });

    it("retries a transient installation failure", () => {
      const result = runStep(script, `
        calls=0
        ${installer}() {
          calls=$((calls + 1))
          echo "install-attempt:$calls"
          [ "$calls" -gt 1 ] || return 42
          ccache() { echo "installed ccache $*"; }
        }
      `);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /install-attempt:1/u);
      assert.match(result.stdout, /install-attempt:2/u);
      assert.doesNotMatch(result.stdout, /install-attempt:3/u);
      assert.match(result.stdout, /installed ccache --version/u);
      assert.equal(result.githubEnv, "");
    });

    it("records an uncached build after all installation attempts fail", () => {
      const result = runStep(script, `${installer}() { echo "install-attempt"; return 42; }`);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.match(/install-attempt/gu)?.length, 3);
      assert.match(result.stdout, /::warning::ccache unavailable/u);
      assert.equal(result.githubEnv, "CCACHE_UNAVAILABLE=1\n");
    });

    it("does not trust installer success when no cache executable is available", () => {
      const result = runStep(script, `${installer}() { return 0; }`);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.githubEnv, "CCACHE_UNAVAILABLE=1\n");
    });

    it("disables an unusable cache when reinstalling cannot repair it", () => {
      const result = runStep(script, `
        ccache() { echo "broken ccache" >&2; return 5; }
        ${installer}() { return 0; }
      `);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.githubEnv, "CCACHE_UNAVAILABLE=1\n");
    });
  });
}

it("clears both compiler launchers for the uncached fallback", () => {
  const result = runStep(stepScript("Drop the compiler launcher when ccache is unavailable"), "");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.githubEnv, "CMAKE_C_COMPILER_LAUNCHER=\nCMAKE_CXX_COMPILER_LAUNCHER=\n");
});
