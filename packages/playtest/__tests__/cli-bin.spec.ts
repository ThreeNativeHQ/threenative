import { makeTempDir } from "../../../test-support/temp-dir.js";
import { rm, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test.skipIf(process.platform === "win32")(
  "the installed CLI runs when its entry path traverses a package-manager symlink",
  async () => {
    const directory = await makeTempDir("threenative-playtest-bin-");
    const linkedPackage = path.join(directory, "playtest");
    try {
      await symlink(packageRoot, linkedPackage, "dir");
      const result = spawnSync(
        process.execPath,
        [path.join(linkedPackage, "dist/runner/cli.js"), "--help"],
        { encoding: "utf8" },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("Usage: threenative-playtest");
      expect(result.stdout).toContain("Exit codes:");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);
