import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import { makeTempDirSync } from "../../test-support/temp-dir.js";

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

// Which jobs of a workflow can publish the workspace key, and which only restore it. A `uses`
// block whose `save-bundles` is anything but the literal "false" counts as a saver, because that
// is the conservative reading of an event-name expression evaluated on a standalone dispatch.
function workspaceDistConsumers(workflow: string): {
  savers: string[];
  restoreOnly: [string, string[]][];
} {
  const savers: string[] = [];
  const restoreOnly: [string, string[]][] = [];
  for (const job of workflow.split(/(?=^ {2}[a-z0-9-]+:$)/mu).slice(1)) {
    const uses = job.match(
      /uses: \.\/\.github\/actions\/workspace-dist\b[^\n]*\n(?:[ \t]+[^\n]*\n)*/gu,
    );
    if (!uses) continue;
    const name = /^ {2}([a-z0-9-]+):$/mu.exec(job)?.[1] ?? "?";
    if (uses.some((use) => !/save-bundles: "false"/u.test(use))) {
      savers.push(name);
      continue;
    }
    restoreOnly.push([
      name,
      (/^ {4}needs: (.+)$/mu.exec(job)?.[1] ?? "")
        .replace(/[[\]]/gu, "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ]);
  }
  return { savers, restoreOnly };
}

describe("workspace bundle reuse without cached verdicts", () => {
  it("restores without a deferred post-job cache writer", () => {
    assert.match(step("Restore the compiled workspace"), /uses: actions\/cache\/restore@v4/u);
    assert.doesNotMatch(action, /uses: actions\/cache@/u);
  });

  it("abandons a stalled cache segment instead of spending ten minutes on an optimization", () => {
    assert.match(step("Restore the compiled workspace"), /SEGMENT_DOWNLOAD_TIMEOUT_MINS: "2"/u);
  });

  it("publishes only after both product validators, before returning to caller tests", () => {
    const save = step("Save validated workspace bundles");
    assert.match(save, /uses: actions\/cache\/save@v4/u);
    assert.match(
      save,
      /^ {6}if: success\(\) && steps\.dist\.outputs\.cache-hit != 'true' && inputs\.save-bundles == 'true'$/mu,
    );
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
    const root = makeTempDirSync("workspace-dist-cache-");
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
  });

  it("holds one reservation per run, from the job that produces the product", () => {
    // The Actions cache service grants one reservation per key. Every saver past the first is
    // refused with "another job may be creating this cache" — thirteen of those lines on a full run
    // say nothing about whether the winner published, and the equivalent-SHA rerun stayed cold.
    const workflow = readFileSync(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const savers = workspaceDistConsumers(workflow).savers;
    assert.deepEqual(savers, ["build-artifacts"], `contested savers: ${savers.join(", ")}`);
  });

  it("leaves a standalone native-platforms dispatch exactly one saver, and every consumer needs it", () => {
    // A dispatch is its own run and still has to publish; called from ci.yml it shares
    // build-artifacts' reservation. Three jobs restore the same key in one dispatch — web-reference,
    // android-emulator-parity and desktop-parity — and `github.event_name == 'workflow_dispatch'` is
    // true for all three, so an expression gate is not a reservation gate: only the literal "false"
    // keeps a job out of the race. The other dynamic caller, `pipeline-cache.yml`, is a separate
    // workflow and shares no reservation until something here calls it, which this audit of this
    // file cannot see — hence the last assertion.
    const native = readFileSync(path.join(repo, ".github/workflows/native-platforms.yml"), "utf8");
    const { savers, restoreOnly } = workspaceDistConsumers(native);
    assert.deepEqual(savers, ["web-reference"], `contested dispatch savers: ${savers.join(", ")}`);
    // web-reference is ungated on the pull requests that need it, but a skipped saver would leave
    // every restore-only consumer rebuilding a key nobody publishes, so each one has to need it.
    for (const [name, needs] of restoreOnly) {
      assert.ok(
        needs.includes("web-reference"),
        `${name} restores from a key its run may never save`,
      );
    }
    assert.doesNotMatch(native, /uses: \.\/\.github\/workflows\//u);
  });
});
