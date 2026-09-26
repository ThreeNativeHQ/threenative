import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "vitest";

const repo = path.resolve(import.meta.dirname, "../..");
const action = readFileSync(path.join(repo, ".github/actions/workspace-dist/action.yml"), "utf8");
const steps = action.split(/(?=^ {4}- name:)/mu).slice(1);

function step(name: string): string {
  const found = steps.find((entry) => entry.startsWith(`    - name: ${name}\n`));
  assert.ok(found, `Missing workspace-dist step: ${name}`);
  return found;
}

function shell(name: string): string {
  const match = /^ {6}run: \|\n((?:^ {8}.*\n|^\n)+)/mu.exec(step(name));
  assert.ok(match?.[1], `Missing executable shell: ${name}`);
  return match[1].replace(/^ {8}/gmu, "");
}

function cachedPaths(entry: string): string[] {
  const match = /^ {8}path: \|\n((?:^ {10}.*\n)+)/mu.exec(entry);
  assert.ok(match?.[1], "Cache must declare its product paths");
  return match[1]
    .trim()
    .split("\n")
    .map((line) => line.trim());
}

describe("workspace bundle reuse without cached verdicts", () => {
  it("restores without a deferred post-job cache writer", () => {
    assert.match(step("Restore the compiled workspace"), /uses: actions\/cache\/restore@v4/u);
    assert.doesNotMatch(action, /uses: actions\/cache@/u);
  });

  it("abandons a stalled cache segment instead of spending ten minutes on an optimization", () => {
    assert.match(
      step("Restore the compiled workspace"),
      /SEGMENT_DOWNLOAD_TIMEOUT_MINS: "2"/u,
    );
  });

  it("publishes only after both product validators, before returning to caller tests", () => {
    const save = step("Save validated workspace bundles");
    assert.match(save, /uses: actions\/cache\/save@v4/u);
    assert.match(save, /^ {6}if: success\(\) && steps\.dist\.outputs\.cache-hit != 'true'$/mu);
    assert.doesNotMatch(save, /always\(\)|continue-on-error/u);
    for (const prerequisite of [
      "Build missing workspace bundles",
      "Check every bundling package has its bundle",
      "Validate current archive payloads",
    ]) {
      assert.ok(action.indexOf(step(prerequisite)) < action.indexOf(save), prerequisite);
    }
    const report = step("Report workspace product reuse and elapsed time");
    assert.ok(action.indexOf(save) < action.indexOf(report));
  });

  it("saves the original restore key and only the same compiled products", () => {
    const restore = step("Restore the compiled workspace");
    const save = step("Save validated workspace bundles");
    assert.deepEqual(cachedPaths(restore), ["packages/*/dist"]);
    assert.deepEqual(cachedPaths(save), cachedPaths(restore));
    assert.match(save, /key: \$\{\{ steps\.dist\.outputs\.cache-primary-key \}\}/u);
    assert.doesNotMatch(save, /hashFiles\(/u);
    assert.doesNotMatch(restore, /restore-keys:/u);
  });

  it("retains conservative source, toolchain, dependency and generator invalidation", () => {
    const restore = step("Restore the compiled workspace");
    for (const input of [
      "runner.os",
      "runner.arch",
      "steps.toolchain.outputs.node",
      "inputs.key-suffix",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.json",
      "tsconfig.base.json",
      "patches/**",
      "packages/*/src/**",
      "packages/*/package.json",
      "packages/*/tsup.config.ts",
      "packages/*/*.json",
      "packages/*/*.ts",
      "packages/*/scripts/**",
      "packages/*/mcp/**",
      "scripts/workspace-packages.ts",
      "scripts/**",
      ".github/actions/workspace-dist/**",
    ]) {
      assert.ok(restore.includes(input), `Missing build input: ${input}`);
    }
  });

  it("rebuilds on every non-exact hit and restores the out-of-dist MCP server on hits", () => {
    assert.match(
      step("Build missing workspace bundles"),
      /if: steps\.dist\.outputs\.cache-hit != 'true'/u,
    );
    assert.match(
      shell("Build missing workspace bundles"),
      /pnpm tsx scripts\/workspace-packages\.ts build/u,
    );
    assert.match(
      step("Restore generated files outside dist"),
      /if: steps\.dist\.outputs\.cache-hit == 'true'/u,
    );
    assert.match(
      shell("Restore generated files outside dist"),
      /node packages\/core\/scripts\/bundle-engine-mcp\.mjs/u,
    );
  });

  it("repacks current files and validates archive contents even on hits", () => {
    for (const name of ["Pack current workspace files", "Validate current archive payloads"]) {
      const entry = step(name);
      assert.match(entry, /if: inputs\.pack-archives != 'false'/u);
      assert.doesNotMatch(entry, /^ {6}if:.*cache-hit/mu);
    }
    assert.match(shell("Pack current workspace files"), /rm -rf artifacts\/workspace-packages/u);
    assert.match(shell("Validate current archive payloads"), /TN_WORKSPACE_ARCHIVE_MISSING/u);
  });

  it("executes the real bundle validator against complete and incomplete products", () => {
    const root = mkdtempSync(path.join(tmpdir(), "workspace-dist-cache-"));
    try {
      for (const name of ["core", "assets"]) {
        mkdirSync(path.join(root, "packages", name), { recursive: true });
        writeFileSync(path.join(root, "packages", name, "tsup.config.ts"), "export default {};\n");
      }
      const validate = () =>
        spawnSync("bash", ["-c", shell("Check every bundling package has its bundle")], {
          cwd: root,
          encoding: "utf8",
          timeout: 5_000,
        });
      mkdirSync(path.join(root, "packages/core/dist"));
      const incomplete = validate();
      assert.ifError(incomplete.error);
      assert.equal(incomplete.status, 1);
      assert.match(incomplete.stderr, /TN_WORKSPACE_DIST_INCOMPLETE: packages\/assets\/dist/u);
      mkdirSync(path.join(root, "packages/assets/dist"));
      const complete = validate();
      assert.ifError(complete.error);
      assert.equal(complete.status, 0, complete.stderr);
      assert.match(complete.stdout, /workspace compiled bundles validated/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
