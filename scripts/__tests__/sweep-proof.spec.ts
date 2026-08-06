import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sealedProofHash } from "../make-sandbox";
import {
  ensureArchiveIndex,
  proofArtifactDirectory,
  reportFromOutput,
  verifySealedProof,
} from "../sweep-proof";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function manifestRoot(
  proofHash = sealedProofHash(process.cwd(), "platformer"),
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "threenative-proof-manifest-"));
  temporaryRoots.push(root);
  await writeFile(
    path.join(root, "sweep.json"),
    `${JSON.stringify(
      {
        arm: "framework",
        genre: "platformer",
        briefHash: "a".repeat(64),
        proofHash,
        template: "platformer",
        date: "2099-01-01T00:00:00.000Z",
        frameworkVersion: "0.1.0",
        sourceLines: 0,
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

describe("sealed proof runner", () => {
  it("keeps proof artifacts under the source with one directory per scenario", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-proof-artifacts-"));
    temporaryRoots.push(root);
    expect(proofArtifactDirectory(root)).toBe(path.join(root, "proof-artifacts"));
    expect(proofArtifactDirectory(root, 2)).toBe(path.join(root, "proof-artifacts", "2"));
  });

  it("adds an index entry for archived main.tsx without changing an existing index", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-proof-entry-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.tsx"), "export {}\n");
    ensureArchiveIndex(root);
    await expect(readFile(path.join(root, "index.html"), "utf8")).resolves.toMatch(
      /<div id="root"><\/div><script type="module" src="\/src\/main\.tsx"><\/script>/,
    );
    await writeFile(path.join(root, "index.html"), "keep\n");
    ensureArchiveIndex(root);
    await expect(readFile(path.join(root, "index.html"), "utf8")).resolves.toBe("keep\n");
  });

  it("verifies the manifest hash before attempting to boot a server", async () => {
    const root = await manifestRoot();
    expect(verifySealedProof(path.join(root, "sweep.json"))).not.toHaveLength(0);
  });

  it("fails closed when a sandbox has a stale proof hash", async () => {
    const root = await manifestRoot("0".repeat(64));
    expect(() => verifySealedProof(path.join(root, "sweep.json"))).toThrow(/Proof hash mismatch/);
  });

  it.each([
    ["missing assertion results", { pass: true, diagnostics: [] }],
    ["empty assertion results", { pass: true, assertionResults: [], diagnostics: [] }],
    [
      "contradictory failed assertion",
      { pass: true, assertionResults: [{ id: "failed", pass: false }], diagnostics: [] },
    ],
    [
      "contradictory error diagnostic",
      {
        pass: true,
        assertionResults: [{ id: "ok", pass: true }],
        diagnostics: [{ code: "TN_FAILURE", message: "failed", severity: "error" }],
      },
    ],
    [
      "malformed pass",
      { pass: "true", assertionResults: [{ id: "ok", pass: true }], diagnostics: [] },
    ],
    [
      "malformed assertion verdict",
      { pass: true, assertionResults: [{ id: "ok", pass: "true" }], diagnostics: [] },
    ],
    [
      "malformed runner verdict",
      {
        pass: true,
        verdict: "fail",
        assertionResults: [{ id: "ok", pass: true }],
        diagnostics: [],
      },
    ],
    [
      "malformed diagnostics",
      { pass: true, assertionResults: [{ id: "ok", pass: true }], diagnostics: [{}] },
    ],
  ])("fails closed for %s", (_label, report) => {
    expect(reportFromOutput("fixture", JSON.stringify(report), "", true)).toMatchObject({
      assertions: [],
      name: "fixture",
      verdict: "fail",
    });
  });

  it("accepts only a structurally valid runner report", () => {
    expect(
      reportFromOutput(
        "fixture",
        JSON.stringify({
          pass: true,
          assertionResults: [{ id: "movement.player", pass: true }],
          diagnostics: [],
        }),
        "",
        true,
      ),
    ).toMatchObject({ assertions: [{ id: "movement.player", pass: true }], verdict: "pass" });
  });
});
