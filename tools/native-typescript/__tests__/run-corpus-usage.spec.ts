import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLI = path.join(import.meta.dirname, "..", "run-corpus.mjs");

/** The runner with these flags; usage errors are raised before the toolchain is provisioned. */
function run(...args: string[]) {
  return spawnSync("node", [CLI, ...args], { encoding: "utf8" });
}

const ANDROID = ["--native", "--target", "aarch64-linux-android"];

describe("run-corpus usage", () => {
  it("refuses a cross target that has nowhere to run", () => {
    const result = run(...ANDROID);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("TN_NATIVE_TS_USAGE: a cross target runs on a device");
  });

  it("refuses --adb without an Android target and --adb with --build-only", () => {
    expect(run("--native", "--adb", "S1").stderr).toContain("--adb needs --native --target");
    expect(run(...ANDROID, "--adb", "S1", "--build-only").stderr).toContain("drop --build-only");
  });

  it("refuses --packaged without a device and one case", () => {
    expect(run(...ANDROID, "--build-only", "--packaged").stderr).toContain(
      "--packaged runs one case",
    );
    expect(run(...ANDROID, "--adb", "S1", "--packaged").stderr).toContain(
      "--packaged runs one case",
    );
  });
});
