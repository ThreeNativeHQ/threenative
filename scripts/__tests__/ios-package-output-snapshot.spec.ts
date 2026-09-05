import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotIosPackageOutputs } from "../ios-package-output-snapshot.js";
import { makeTempDir } from "../../test-support/temp-dir.js";

async function fixture(): Promise<string> {
  const root = await makeTempDir("tn-ios-package-output-");
  await mkdir(path.join(root, "packages", "core", "dist"), { recursive: true });
  await mkdir(path.join(root, "packages", "core", "mcp"), { recursive: true });
  await mkdir(path.join(root, "packages", "runtime-native", "dist"), { recursive: true });
  await mkdir(path.join(root, "packages", "runtime-native", "third_party", "sdl", "dist"), {
    recursive: true,
  });
  await writeFile(path.join(root, "packages", "core", "dist", "index.js"), "core");
  await writeFile(path.join(root, "packages", "core", "mcp", "server.js"), "mcp");
  await writeFile(path.join(root, "packages", "runtime-native", "dist", "index.js"), "native");
  await writeFile(
    path.join(root, "packages", "runtime-native", "third_party", "sdl", "dist", "SDL.js"),
    "vendor",
  );
  return root;
}

describe("iOS package output snapshots", () => {
  it("ignore vendor dist trees while retaining package dist and core MCP files", async () => {
    const root = await fixture();
    const snapshot = snapshotIosPackageOutputs(root);

    expect(snapshot).toContain("packages/core/dist/index.js");
    expect(snapshot).toContain("packages/core/mcp/server.js");
    expect(snapshot).toContain("packages/runtime-native/dist/index.js");
    expect(snapshot).not.toContain("third_party/sdl/dist/SDL.js");
  });

  it("changes when a true package output changes", async () => {
    const root = await fixture();
    const before = snapshotIosPackageOutputs(root);
    await writeFile(path.join(root, "packages", "runtime-native", "dist", "index.js"), "changed");

    expect(snapshotIosPackageOutputs(root)).not.toBe(before);
  });
});
