import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../test-support/temp-dir.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(REPO, "scripts", "xvfb.sh");

/**
 * A PATH containing only the utilities the script itself needs, so a test can decide whether
 * `Xvfb` exists on this machine and what `uname -s` reports. Nothing else leaks in.
 */
function sandbox(unameOutput: string): { bin: string; marker: string } {
  const root = makeTempDirSync("tn-xvfb-");
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  for (const tool of ["mktemp", "tr", "sleep", "rm", "cat", "sh"]) {
    const resolved = spawnSync("command", ["-v", tool], {
      shell: true,
      encoding: "utf8",
    }).stdout.trim();
    if (resolved.length > 0) fs.symlinkSync(resolved, path.join(bin, tool));
  }
  fs.writeFileSync(path.join(bin, "uname"), `#!/bin/sh\necho ${unameOutput}\n`, { mode: 0o755 });
  return { bin, marker: path.join(root, "ran") };
}

function run(bin: string, args: readonly string[]): { status: number; stderr: string } {
  const result = spawnSync("/bin/sh", [SCRIPT, ...args], {
    env: { PATH: bin, HOME: os.tmpdir() },
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: result.status ?? -1, stderr: result.stderr ?? "" };
}

describe("scripts/xvfb.sh", () => {
  it("exits with the wrapped command's own status, which is the whole point of not using xvfb-run", () => {
    const failed = spawnSync("/bin/sh", [SCRIPT, "/bin/sh", "-c", "exit 3"], { encoding: "utf8" });
    expect(failed.status).toBe(3);
    expect(execFileSync("/bin/sh", [SCRIPT, "/bin/true"], { encoding: "utf8" })).toBeDefined();
  });

  it("runs the command directly on a platform that has no Xvfb but has its own display", () => {
    const { bin, marker } = sandbox("Darwin");
    const result = run(bin, ["/bin/sh", "-c", `echo ran > ${marker}; exit 4`]);
    expect(result.stderr).not.toMatch(/not found/i);
    expect(fs.existsSync(marker)).toBe(true);
    expect(result.status).toBe(4);
  });

  it("fails closed on Linux when Xvfb is missing, rather than running the command blind", () => {
    const { bin, marker } = sandbox("Linux");
    const result = run(bin, ["/bin/sh", "-c", `echo ran > ${marker}; exit 0`]);
    expect(fs.existsSync(marker)).toBe(false);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Xvfb/);
  });
});
