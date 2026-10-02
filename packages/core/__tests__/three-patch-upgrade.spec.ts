import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";

// @ts-expect-error -- the postinstall helper is plain ESM with no type declarations.
import { applyThreePatch } from "../scripts/apply-three-patch.mjs";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

async function tempRoot(): Promise<string> {
  const root = await makeTempDir("threenative-three-patch-");
  roots.push(root);
  return root;
}

const THREE_VERSION = "0.185.1";
const STOCK = [
  "const alpha = 1;",
  "const beta = 2;",
  "const gamma = 3;",
  "const delta = 4;",
  "const epsilon = 5;",
  "",
];

/** What the previous release's patch left behind: hunk one applied, hunk two not yet written. */
const PATCHED_BY_THE_PREVIOUS_RELEASE = [
  "const alpha = 1; // threenative: one",
  "const beta = 2;",
  "const gamma = 3;",
  "const delta = 4;",
  "const epsilon = 5;",
  "",
];

const FULLY_PATCHED = [
  "const alpha = 1; // threenative: one",
  "const beta = 2;",
  "const gamma = 3; // threenative: two",
  "const delta = 4;",
  "const epsilon = 5;",
  "",
];

/** The candidate release's patch: the previous hunk plus one this release adds. */
const CANDIDATE_PATCH = `diff --git a/src/thing.js b/src/thing.js
--- a/src/thing.js
+++ b/src/thing.js
@@ -1,1 +1,1 @@
-const alpha = 1;
+const alpha = 1; // threenative: one
@@ -3,1 +3,1 @@
-const gamma = 3;
+const gamma = 3; // threenative: two
`;

async function fixture(lines: readonly string[]): Promise<{
  packageRoot: string;
  threeRoot: string;
  target: string;
}> {
  const root = await tempRoot();
  const packageRoot = join(root, "core");
  const threeRoot = join(root, "node_modules", "three");
  await mkdir(join(packageRoot, "patches"), { recursive: true });
  await mkdir(join(threeRoot, "src"), { recursive: true });
  await writeFile(
    join(packageRoot, "patches", `three@${THREE_VERSION}.patch`),
    CANDIDATE_PATCH,
    "utf8",
  );
  await writeFile(
    join(threeRoot, "package.json"),
    `${JSON.stringify({ name: "three", version: THREE_VERSION })}\n`,
    "utf8",
  );
  const target = join(threeRoot, "src", "thing.js");
  await writeFile(target, lines.join("\n"), "utf8");
  return { packageRoot, target, threeRoot };
}

describe("the Three.js patch on a project that upgrades from the previous release", () => {
  // A generated project declares the patch in its own manifest, so the package manager applies it
  // at install time. A project scaffolded from the previous `latest` therefore carries the previous
  // patch's text, and this release's postinstall finds its own first hunk already applied. That is
  // the state the PRD-446 upgrade proof installs into, and it used to refuse as "partial".
  it("adds the hunks this release adds and keeps the ones already there", async () => {
    const { packageRoot, target, threeRoot } = await fixture(PATCHED_BY_THE_PREVIOUS_RELEASE);

    await expect(applyThreePatch({ packageRoot, threeRoot })).resolves.toBe("patched");
    await expect(readFile(target, "utf8")).resolves.toBe(FULLY_PATCHED.join("\n"));
  });

  it("is idempotent once the whole patch is on disk", async () => {
    const { packageRoot, target, threeRoot } = await fixture(FULLY_PATCHED);

    await expect(applyThreePatch({ packageRoot, threeRoot })).resolves.toBe("unchanged");
    await expect(readFile(target, "utf8")).resolves.toBe(FULLY_PATCHED.join("\n"));
  });

  it("still patches untouched stock three", async () => {
    const { packageRoot, target, threeRoot } = await fixture(STOCK);

    await expect(applyThreePatch({ packageRoot, threeRoot })).resolves.toBe("patched");
    await expect(readFile(target, "utf8")).resolves.toBe(FULLY_PATCHED.join("\n"));
  });

  it("refuses a hunk that is neither stock nor this patch's own text", async () => {
    const tampered = [...PATCHED_BY_THE_PREVIOUS_RELEASE];
    tampered[0] = "const alpha = 1; // edited by hand";
    const { packageRoot, target, threeRoot } = await fixture(tampered);

    await expect(applyThreePatch({ packageRoot, threeRoot })).rejects.toThrow(
      /TN_THREE_PATCH_PARTIAL/u,
    );
    // Refused means refused: the recognisable hunks are not written either.
    await expect(readFile(target, "utf8")).resolves.toBe(tampered.join("\n"));
  });
});

// These are the actual Git blobs after applying develop 416ffd7c's dcbc5131 patch to Three
// 0.185.1. The inverse migration materializes those exact bytes from the installed candidate.
const PRIOR_BLOBS = {
  "build/three.webgpu.js": "7aa62adb9e78ba8f0a67709d3141bf93c67419cc",
  "build/three.webgpu.nodes.js": "b8a7b2fd0a2e95911e7e12fd5674592107f012de",
  "src/nodes/accessors/Instance.js": "ed00e75ba4fd7b49343cfada26eacdef8940a4f4",
  "src/renderers/common/Renderer.js": "89b33efb80ca1dcb9db931071dfda62ffdba3526",
  "src/renderers/webgpu/utils/WebGPUAttributeUtils.js": "83bbe189915c8450c4e14108e6a3f4ed98c4b016",
};

// Exact blobs shipped by PR393 source 47e188e4 (patch 455ed1dd).
const PUBLISHED_BLOBS = {
  "build/three.webgpu.js": "bdffb9b4069f7beafa85913b155e92d3e83f12d0",
  "build/three.webgpu.nodes.js": "1245f0da9bb6a0f731b8c75a64490d7c91238700",
  "src/renderers/webgpu/utils/WebGPUAttributeUtils.js": "83bbe189915c8450c4e14108e6a3f4ed98c4b016",
};

// Exact source/bundle blobs shipped at PR393 source 085c977b (patch daef254c).
const RECOMPILE_BLOBS = {
  "src/nodes/accessors/Skinning.js": "aaeea633a8ece291be5faf868e312867ddad01b6",
  "build/three.webgpu.js": "148869ee7f18c62570ac1eafb7df5775e5a89581",
  "build/three.webgpu.nodes.js": "81c24b2e05e5047e1a02410a2056949d39b1a05c",
};

function blobHash(contents: string): string {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(contents)}\0`)
    .update(contents)
    .digest("hex");
}

async function previousInstalledPackage(priorBlobs: Record<string, string>, crlf = false) {
  const root = await tempRoot();
  const threeRoot = join(root, "three");
  const packageRoot = resolve("packages/core");
  await cp(join(packageRoot, "node_modules/three"), threeRoot, {
    dereference: true,
    recursive: true,
  });
  const migration = await readFile(
    join(packageRoot, "patches/three@0.185.1-prd269-upgrade.patch"),
    "utf8",
  );
  const selected = migration
    .split(/(?=^diff --git )/mu)
    .filter((block) => {
      const file = /^diff --git a\/(\S+) /mu.exec(block)?.[1];
      const hash = /^index ([a-f0-9]{40})\.\./mu.exec(block)?.[1];
      return file !== undefined && hash !== undefined && priorBlobs[file] === hash;
    })
    .join("");
  const inverse = join(root, "prior.patch");
  await writeFile(inverse, selected);
  await promisify(execFile)(
    "patch",
    ["--reverse", "--batch", "--fuzz=0", "--silent", "-p1", "-i", inverse],
    { cwd: threeRoot },
  );
  for (const [file, hash] of Object.entries(priorBlobs)) {
    const contents = await readFile(join(threeRoot, file), "utf8");
    expect(blobHash(contents)).toBe(hash);
    if (crlf) await writeFile(join(threeRoot, file), contents.replaceAll("\n", "\r\n"));
  }
  return { packageRoot, threeRoot };
}

describe.each([
  ["develop dcbc5131", PRIOR_BLOBS],
  ["published PR393 455ed1dd", PUBLISHED_BLOBS],
  ["published PR393 daef254c", RECOMPILE_BLOBS],
])("actual previously shipped Three files (%s)", (_name, priorBlobs) => {
  it.each([false, true])(
    "upgrades the exact prior patch and remains idempotent (CRLF=%s)",
    async (crlf) => {
      const { packageRoot, threeRoot } = await previousInstalledPackage(priorBlobs, crlf);
      await expect(applyThreePatch({ packageRoot, threeRoot })).resolves.toBe("patched");
      for (const file of Object.keys(priorBlobs)) {
        expect(await readFile(join(threeRoot, file), "utf8")).toBe(
          await readFile(join(packageRoot, "node_modules/three", file), "utf8"),
        );
      }
      await expect(applyThreePatch({ packageRoot, threeRoot })).resolves.toBe("unchanged");
    },
  );

  it("refuses a one-byte custom edit before writing any recognised file", async () => {
    const { packageRoot, threeRoot } = await previousInstalledPackage(priorBlobs);
    const changed = join(threeRoot, Object.keys(priorBlobs)[0] ?? "missing");
    await writeFile(changed, `${await readFile(changed, "utf8")} `);
    const before = await Promise.all(
      Object.keys(priorBlobs).map((file) => readFile(join(threeRoot, file), "utf8")),
    );
    await expect(applyThreePatch({ packageRoot, threeRoot })).rejects.toThrow(
      /TN_THREE_PATCH_PARTIAL/,
    );
    const after = await Promise.all(
      Object.keys(priorBlobs).map((file) => readFile(join(threeRoot, file), "utf8")),
    );
    expect(after).toEqual(before);
  });
});
