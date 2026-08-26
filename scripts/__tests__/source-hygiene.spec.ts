import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * A NUL byte inside shipped source survives the bundler, and the native host reads scripts
 * through a C-string boundary — so a game bundle truncates at the byte and V8 reports an
 * unrelated "Unexpected end of input" (PRD-222 loop, 2026-08-25: `385fd50e` shipped one inside
 * `packages/core/src/projection-plan.ts`; desktop-native bundles failed to load while minified
 * Android bundles masked it by rewriting the literal). Web never notices, so this stays red on
 * native only unless something scans for it.
 *
 * The scan walks `git ls-files` rather than the working tree so generated and untracked trees
 * cannot flake it, and names every offending file, which is what a red needs.
 */
describe("shipped sources contain no NUL bytes", () => {
  test("every tracked text source under packages, examples and scripts is NUL-free", () => {
    const files = execFileSync(
      "git",
      ["-C", repoRoot, "ls-files", "packages/*/src/**", "examples/*/src/**", "scripts/**/*.ts"],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter((file) => file.length > 0);
    expect(files.length).toBeGreaterThan(100);

    // The working tree is what bundles build from, so that is what the scan reads — a fix
    // goes green as soon as the byte is gone, not only once it is committed.
    const bad = files.filter((file) =>
      readFileSync(path.join(repoRoot, file), "utf8").includes("\0"),
    );
    expect(bad).toEqual([]);
  });
});
