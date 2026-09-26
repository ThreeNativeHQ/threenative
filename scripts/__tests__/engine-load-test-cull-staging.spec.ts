import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDirSyncAt } from "../../test-support/temp-dir.js";
import { stageGodotCullProject } from "../engine-load-test/cli.js";

// PRD-449: the culling arm's object set was measured twice — 2005 visible objects with upstream's
// `use_occlusion_culling=true` and 3549 with it off, from the same fixture SHA-256 — so the arm has
// to run against occlusion culling disabled. The pinned checkout stays byte-identical, and the
// staged copy is a separate tree whose project hash is what the arm verifies.
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const OCCLUSION_ON = "occlusion_culling/use_occlusion_culling=true\n";
const UPSTREAM_PROJECT = `; Engine configuration file.\n[rendering]\n${OCCLUSION_ON}\n[display]\n`;
const PATCHED_PROJECT = UPSTREAM_PROJECT.replace(
  "occlusion_culling/use_occlusion_culling=true",
  "occlusion_culling/use_occlusion_culling=false",
);

describe("stageGodotCullProject", () => {
  let root = "";
  let pinned = "";
  let staged = "";
  const expected = {
    upstreamSha256: sha256(UPSTREAM_PROJECT),
    patchedSha256: sha256(PATCHED_PROJECT),
  };

  beforeEach(() => {
    root = makeTempDirSyncAt(path.join(import.meta.dirname, "cull-staging-spec-"));
    pinned = path.join(root, "pinned");
    staged = path.join(root, "staged");
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  async function pinProject(text: string, extra = ""): Promise<void> {
    await mkdir(path.join(pinned, "benchmarks/rendering"), { recursive: true });
    await writeFile(path.join(pinned, "project.godot"), text);
    await writeFile(path.join(pinned, "benchmarks/rendering/culling.gd"), "// upstream\n");
    if (extra.length > 0) await writeFile(path.join(pinned, "extra.txt"), extra);
  }

  it("stages a verified copy with occlusion off, leaves the pinned checkout alone, and reuses it", async () => {
    await pinProject(UPSTREAM_PROJECT, "cached");
    const first = await stageGodotCullProject(pinned, staged, expected);

    expect(first.created).toBe(true);
    expect(first.project).toBe(staged);
    expect(first.projectSha256).toBe(expected.patchedSha256);
    expect(first.upstreamSha256).toBe(expected.upstreamSha256);
    expect(await readFile(path.join(staged, "project.godot"), "utf8")).toBe(PATCHED_PROJECT);
    expect(await readFile(path.join(staged, "extra.txt"), "utf8")).toBe("cached");
    // The upstream bytes are still upstream: a second arm must not inherit the first one's patch.
    expect(await readFile(path.join(pinned, "project.godot"), "utf8")).toBe(UPSTREAM_PROJECT);

    // A verified staged copy is reused rather than rebuilt.
    const second = await stageGodotCullProject(pinned, staged, expected);
    expect(second.created).toBe(false);
    expect(second.projectSha256).toBe(expected.patchedSha256);
  });

  it("rejects a tampered stage and leaves it byte-for-byte, cache and all", async () => {
    await pinProject(UPSTREAM_PROJECT);
    await stageGodotCullProject(pinned, staged, expected);
    // Godot's ignored import cache and a failed run's diagnostics live inside the stage; a hash
    // mismatch is not permission to delete them.
    const cache = path.join(staged, ".godot/imported/scene.scn");
    const log = path.join(staged, "arm.log");
    await mkdir(path.dirname(cache), { recursive: true });
    await writeFile(cache, "imported\n");
    await writeFile(log, "frame 12: timeout\n");
    const tampered = `${PATCHED_PROJECT}; edited\n`;
    await writeFile(path.join(staged, "project.godot"), tampered);

    await expect(stageGodotCullProject(pinned, staged, expected)).rejects.toThrow(
      /TN_BENCH_GODOT_STAGE_HASH_MISMATCH/,
    );

    expect(await readFile(path.join(staged, "project.godot"), "utf8")).toBe(tampered);
    expect(await readFile(cache, "utf8")).toBe("imported\n");
    expect(await readFile(log, "utf8")).toBe("frame 12: timeout\n");
  });

  it("rejects an existing stage that has no project.godot instead of writing over it", async () => {
    await pinProject(UPSTREAM_PROJECT);
    await mkdir(staged, { recursive: true });
    await writeFile(path.join(staged, "notes.txt"), "why is this here\n");

    await expect(stageGodotCullProject(pinned, staged, expected)).rejects.toThrow(
      /TN_BENCH_GODOT_STAGE_INCOMPLETE/,
    );

    expect(await readdir(staged)).toEqual(["notes.txt"]);
  });

  it("fails closed on a pinned checkout that is not the pinned bytes", async () => {
    await pinProject(`${UPSTREAM_PROJECT}; edited\n`);
    await expect(stageGodotCullProject(pinned, staged, expected)).rejects.toThrow(
      /TN_BENCH_GODOT_SOURCE_HASH_MISMATCH/,
    );
  });

  it("fails closed unless exactly one occlusion setting is there to turn off", async () => {
    for (const project of [
      UPSTREAM_PROJECT.replace(OCCLUSION_ON, ""),
      UPSTREAM_PROJECT.replace(OCCLUSION_ON, OCCLUSION_ON + OCCLUSION_ON),
      UPSTREAM_PROJECT.replace(OCCLUSION_ON, "occlusion_culling/use_occlusion_culling=false\n"),
    ]) {
      // Each case is its own pinned input: the source-hash guard answers first, so the setting guard
      // is only what answers when the bytes it was given are the ones it expected.
      await pinProject(project);
      await expect(
        stageGodotCullProject(pinned, staged, {
          patchedSha256: sha256(project),
          upstreamSha256: sha256(project),
        }),
      ).rejects.toThrow(/TN_BENCH_GODOT_OCCLUSION_SETTING_UNPATCHABLE/);
    }
  });
});
