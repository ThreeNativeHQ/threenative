import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDirSyncAt } from "../../test-support/temp-dir.js";
import {
  type IArchivedBuild,
  archiveBuild,
  godotCullIdentity,
  tnCullIdentity,
} from "../engine-load-test/cli.js";
type IBuildLock = Record<"tnBundle" | "nativeHost" | "godotBinary", IArchivedBuild>;

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
    root = makeTempDirSyncAt(path.join(repoRoot, "artifacts/engine-load-test/archive-spec-"));
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

describe("cull identity", () => {
  let root = "";
  let dist = "";
  let builds = "";

  beforeEach(async () => {
    await mkdir(path.join(repoRoot, "artifacts/engine-load-test"), { recursive: true });
    root = makeTempDirSyncAt(path.join(repoRoot, "artifacts/engine-load-test/archive-spec-"));
    dist = path.join(root, "dist");
    builds = path.join(root, "builds");
    await mkdir(dist, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("gives every cull arm a content-addressed build lock and names the adapter it ran", async () => {
    // The TN arm's measured bundle is a mutable `dist/` path that the next cull build overwrites, so
    // its measured bytes only stay checkable through an archive address the record names. The arms
    // take this lock before the launch; this case takes it the same way.
    const bundle = path.join(dist, "engine-load-test-cull-desktop.js");
    const host = path.join(root, "mystral");
    const godot = path.join(root, "godot");
    await writeFile(bundle, "basic_cull run\n");
    await writeFile(host, "native host\n");
    await writeFile(godot, "godot 4.4\n");
    const tn = await tnCullIdentity({
      adapter: { name: "NVIDIA GeForce RTX 2080" },
      authoring: "scene-node-independent",
      build: {
        nativeHost: await archiveBuild(host, builds),
        tnBundle: await archiveBuild(bundle, builds),
      },
      display: ":0",
      fixture: path.join(root, "cull-fixture-10k.json"),
      tn: { commit: "abc123", dirty: true },
    });

    const lock = tn.build as IBuildLock;
    expect(Object.keys(lock).sort()).toEqual(["nativeHost", "tnBundle"]);
    expect(lock.tnBundle.sha256).toBe(sha256("basic_cull run\n"));
    expect(lock.tnBundle.archived.endsWith(`${lock.tnBundle.sha256}.js`)).toBe(true);
    expect(lock.nativeHost.bytes).toBe(Buffer.byteLength("native host\n"));
    // No build type is claimed here: the raw payload the arm recorded states none.
    expect(JSON.stringify(lock)).not.toMatch(/release/);
    // A later build of the same variant overwrites the path the record also names, and the archived
    // bytes the run measured are still the ones at the address it locked.
    await writeFile(bundle, "dynamic_cull run\n");
    expect(await readFile(path.join(repoRoot, lock.tnBundle.archived), "utf8")).toBe(
      "basic_cull run\n",
    );

    const godotRun = await godotCullIdentity({
      adapter: { occlusionCulling: false },
      build: { godotBinary: await archiveBuild(godot, builds) },
      display: ":0",
      fixture: path.join(root, "cull-fixture-10k.json"),
      staged: {
        project: root,
        projectSha256: sha256("project.godot\n"),
        upstreamSha256: sha256("upstream.godot\n"),
      },
    });

    const godotLock = godotRun.build as IBuildLock;
    expect(Object.keys(godotLock)).toEqual(["godotBinary"]);
    expect(godotLock.godotBinary.sha256).toBe(sha256("godot 4.4\n"));
    const source = godotRun.source as { adapter: { path: string; sha256: string } };
    // The script that produced the numbers, byte-addressed, so a later source lock can name it.
    expect(source.adapter.path).toBe("benchmark/godot-prd449/culling_arm.gd");
    expect(source.adapter.sha256).toBe(
      sha256(await readFile(path.join(repoRoot, source.adapter.path), "utf8")),
    );
  });
});
