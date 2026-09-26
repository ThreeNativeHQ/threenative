import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { archiveBuild } from "../engine-load-test/cli.js";

// PRD-449: a City raw run's build lock names a mutable `dist/` or `target/` path, so the next arm
// overwrites the bytes the run measured. These cases pin the archive that keeps them checkable.
// The tree lives inside the repository because a recorded path is repo-relative, and resolving one
// is the contract every reader of the record relies on.
const repoRoot = path.resolve(import.meta.dirname, "../..");
const sha256 = (bytes: string): string => createHash("sha256").update(bytes).digest("hex");

describe("archiveBuild", () => {
  let root = "";
  let dist = "";
  let builds = "";

  beforeEach(async () => {
    await mkdir(path.join(repoRoot, "artifacts/engine-load-test"), { recursive: true });
    root = await mkdtemp(path.join(repoRoot, "artifacts/engine-load-test/archive-spec-"));
    dist = path.join(root, "dist");
    builds = path.join(root, "builds");
    await mkdir(dist, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("keeps the first run's bytes checkable after the measured path is rebuilt", async () => {
    const bundle = path.join(dist, "engine-load-test-city-desktop.js");
    await writeFile(bundle, "static run\n");
    const first = await archiveBuild(bundle, builds);
    await writeFile(bundle, "moving run\n");
    const second = await archiveBuild(bundle, builds);

    expect(first.sha256).not.toBe(second.sha256);
    expect(path.extname(first.archived)).toBe(".js");
    expect(first.bytes).toBe(Buffer.byteLength("static run\n"));
    // The recorded source path still resolves to the new bytes, which is exactly why the record
    // also names the address the measured bytes were copied to.
    expect(await readFile(path.join(repoRoot, first.path), "utf8")).toBe("moving run\n");
    expect(await readFile(path.join(repoRoot, first.archived), "utf8")).toBe("static run\n");
  });

  it("reuses a matching archive and refuses one that disagrees with its address", async () => {
    const host = path.join(root, "mystral");
    await writeFile(host, "native host\n");
    const first = await archiveBuild(host, builds);
    await writeFile(host, "native host\n");
    expect(await archiveBuild(host, builds)).toEqual(first);
    // An extensionless binary lands at a bare address, and the archive is written once.
    expect(path.extname(first.archived)).toBe("");
    expect(existsSync(first.archived)).toBe(true);
    await writeFile(path.join(builds, `${first.sha256}`), "not those bytes\n");
    await expect(archiveBuild(host, builds)).rejects.toThrow(/does not hash to its own address/);
  });
});
