import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The published `create-threenative@0.2.0` exited 0 having done nothing: no project, no error,
 * no output. Its entry guard compared `path.resolve(process.argv[1])` against
 * `import.meta.url`, and a package manager installs a `bin` as a symlink — so the CLI ran as
 * `node_modules/.bin/create-threenative` while the module knew itself as `dist/index.js`.
 * `path.resolve` normalises but does not follow symlinks, so the guard was never true.
 *
 * Every existing test invoked `dist/index.js` by its real path, which is the one arrangement
 * where the bug is invisible. This one runs it the way npm does.
 *
 * `packages/playtest/__tests__/cli-bin.spec.ts` is the same test for the same bug in that CLI.
 */
test.skipIf(process.platform === "win32")(
  "the installed CLI runs when its entry path traverses a package-manager symlink",
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "threenative-create-bin-"));
    const linkedPackage = path.join(directory, "create-threenative");
    try {
      await symlink(packageRoot, linkedPackage, "dir");

      const result = spawnSync(
        process.execPath,
        [path.join(linkedPackage, "dist/index.js"), "--help"],
        { encoding: "utf8" },
      );

      expect(result.status, result.stderr).toBe(0);
      // Any output at all is the assertion that matters: the bug produced a silent exit 0.
      expect(result.stdout.length, "the CLI produced no output through a symlink").toBeGreaterThan(
        0,
      );
      expect(result.stdout).toContain("--template");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);
