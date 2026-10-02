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
};

function blobHash(contents: string): string {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(contents)}\0`)
    .update(contents)
    .digest("hex");
}

async function previousInstalledPackage(crlf = false) {
  const root = await tempRoot();
  const threeRoot = join(root, "three");
  const packageRoot = resolve("packages/core");
  await cp(join(packageRoot, "node_modules/three"), threeRoot, {
    dereference: true,
    recursive: true,
  });
  await promisify(execFile)(
    "patch",
    [
      "--reverse",
      "--batch",
      "--fuzz=0",
      "--silent",
      "-p1",
      "-i",
      join(packageRoot, "patches/three@0.185.1-prd269-upgrade.patch"),
    ],
    { cwd: threeRoot },
  );
  for (const [file, hash] of Object.entries(PRIOR_BLOBS)) {
    const contents = await readFile(join(threeRoot, file), "utf8");
    expect(blobHash(contents)).toBe(hash);
    if (crlf) await writeFile(join(threeRoot, file), contents.replaceAll("\n", "\r\n"));
  }
  return { packageRoot, threeRoot };
}

describe("actual previously shipped Three files", () => {
  it.each([false, true])(
    "upgrades the exact prior patch and remains idempotent (CRLF=%s)",
    async (crlf) => {
      const { packageRoot, threeRoot } = await previousInstalledPackage(crlf);
      await expect(applyThreePatch({ packageRoot, threeRoot })).resolves.toBe("patched");
      for (const file of Object.keys(PRIOR_BLOBS)) {
        expect(await readFile(join(threeRoot, file), "utf8")).toBe(
          await readFile(join(packageRoot, "node_modules/three", file), "utf8"),
        );
      }
      await expect(applyThreePatch({ packageRoot, threeRoot })).resolves.toBe("unchanged");
    },
  );

  it("refuses a one-byte custom edit before writing any recognised file", async () => {
    const { packageRoot, threeRoot } = await previousInstalledPackage();
    const changed = join(threeRoot, "src/renderers/common/Renderer.js");
    await writeFile(changed, `${await readFile(changed, "utf8")} `);
    const before = await Promise.all(
      Object.keys(PRIOR_BLOBS).map((file) => readFile(join(threeRoot, file), "utf8")),
    );
    await expect(applyThreePatch({ packageRoot, threeRoot })).rejects.toThrow(
      /TN_THREE_PATCH_PARTIAL/,
    );
    const after = await Promise.all(
      Object.keys(PRIOR_BLOBS).map((file) => readFile(join(threeRoot, file), "utf8")),
    );
    expect(after).toEqual(before);
  });
});
