import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  EVIDENCE_GENERATOR_VERSION,
  EVIDENCE_MANIFEST_FILE,
  EVIDENCE_MANIFEST_VERSION,
  type IEvidenceFileEntry,
  type IEvidenceManifest,
  type IStoreVerifyReport,
  readEvidenceManifest,
  renderEvidenceManifest,
  sweepIdentity,
  verifyEvidenceManifest,
  verifySweepStore,
  writeEvidenceManifest,
} from "../sweep-evidence";

const SWEEP = {
  arm: "framework",
  genre: "fixture",
  briefHash: "a".repeat(64),
  proofHash: "b".repeat(64),
  template: "none",
  date: "2099-01-02T00:00:00.000Z",
  frameworkVersion: "0.1.0",
  sourceLines: 0,
} as const;

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixtureRoot(prefix = "threenative-evidence-"): Promise<string> {
  const root = await makeTempDir(prefix);
  temporaryRoots.push(root);
  return root;
}

/** A small but complete archive: identity, proof result, source, playtest, bulk and media files. */
async function fixtureArchive(root: string, name = "archive"): Promise<string> {
  const archive = path.join(root, name);
  await mkdir(path.join(archive, "src"), { recursive: true });
  await mkdir(path.join(archive, "playtests"), { recursive: true });
  await mkdir(path.join(archive, "screenshots"), { recursive: true });
  await mkdir(path.join(archive, "proof-artifacts", "0"), { recursive: true });
  await writeFile(path.join(archive, "sweep.json"), `${JSON.stringify(SWEEP, null, 2)}\n`);
  await writeFile(path.join(archive, "proof.json"), '{"passed":1}\n');
  await writeFile(path.join(archive, "src", "main.ts"), "export const ready = true;\n");
  await writeFile(path.join(archive, "playtests", "smoke.json"), "{}\n");
  await writeFile(path.join(archive, "screenshots", "hero.png"), "not really a png\n");
  await writeFile(path.join(archive, "proof-artifacts", "0", "after.png"), "proof capture\n");
  await writeFile(path.join(archive, "index.html"), "<html></html>\n");
  return archive;
}

async function writeMutatedManifest(
  archive: string,
  mutate: (manifest: Record<string, unknown>) => void,
): Promise<void> {
  const file = path.join(archive, EVIDENCE_MANIFEST_FILE);
  const manifest = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  mutate(manifest);
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

function entryWithPath(manifest: IEvidenceManifest, entryPath: string): IEvidenceFileEntry {
  const entry = manifest.files.find((candidate) => candidate.path === entryPath);
  if (entry === undefined) throw new Error(`fixture has no entry '${entryPath}'`);
  return entry;
}

describe("evidence manifests", () => {
  it("hashes every retained file and records size, role and provenance", async () => {
    const root = await fixtureRoot();
    const archive = await fixtureArchive(root);
    const manifest = writeEvidenceManifest(archive, { repo: root });

    expect(manifest.files.map((entry) => entry.path)).toEqual([
      "index.html",
      "playtests/smoke.json",
      "proof-artifacts/0/after.png",
      "proof.json",
      "screenshots/hero.png",
      "src/main.ts",
      "sweep.json",
    ]);
    const source = entryWithPath(manifest, "src/main.ts");
    expect(source.sha256).toBe(
      createHash("sha256").update("export const ready = true;\n").digest("hex"),
    );
    expect(source.bytes).toBe(Buffer.byteLength("export const ready = true;\n"));
    expect(manifest.manifestVersion).toBe(EVIDENCE_MANIFEST_VERSION);
    expect(manifest.generator).toBe("sweep-evidence");
    expect(manifest.generatorVersion).toBe(EVIDENCE_GENERATOR_VERSION);
    expect(manifest.sweepIdentity).toBe(sweepIdentity(SWEEP));
    // The temp fixture is not a git checkout, so the absence of a commit is recorded honestly.
    expect(manifest.sourceCommit).toBeNull();
    // The written document round-trips through the strict reader.
    await expect(readFile(path.join(archive, EVIDENCE_MANIFEST_FILE), "utf8")).resolves.toContain(
      '"generatorVersion"',
    );
    expect(() => readEvidenceManifest(archive)).not.toThrow();
  });

  it("records the creation timestamp it is given", async () => {
    const root = await fixtureRoot();
    const archive = await fixtureArchive(root);
    const manifest = renderEvidenceManifest(archive, { now: () => new Date(0) });
    expect(manifest.createdAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("records the source commit when one is available and refuses a malformed override", async () => {
    const root = await fixtureRoot();
    const archive = await fixtureArchive(root);
    const commit = "b".repeat(40);
    expect(renderEvidenceManifest(archive, { sourceCommit: commit }).sourceCommit).toBe(commit);
    expect(() => renderEvidenceManifest(archive, { sourceCommit: "deadbeef" })).toThrow(
      /full git sha/u,
    );
    // A fixture beneath no repository of its own records absence instead of inheriting one.
    expect(renderEvidenceManifest(archive, { repo: root }).sourceCommit).toBeNull();
  });

  it("classifies sealed proof as git-retained and captures as bulk candidates without moving either", async () => {
    const root = await fixtureRoot();
    const archive = await fixtureArchive(root);
    const manifest = renderEvidenceManifest(archive);
    const byPath = new Map(manifest.files.map((entry) => [entry.path, entry]));
    expect(byPath.get("sweep.json")?.role).toBe("sweep-manifest");
    expect(byPath.get("proof.json")?.retention).toBe("git");
    // Proof outranks file extension: a PNG under proof-artifacts/ is proof, not bulk.
    expect(byPath.get("proof-artifacts/0/after.png")?.retention).toBe("git");
    expect(byPath.get("src/main.ts")?.retention).toBe("git");
    expect(byPath.get("playtests/smoke.json")?.retention).toBe("git");
    expect(byPath.get("index.html")?.retention).toBe("git");
    expect(byPath.get("screenshots/hero.png")?.role).toBe("capture");
    expect(byPath.get("screenshots/hero.png")?.retention).toBe("bulk-candidate");
    for (const entryPath of ["proof.json", "screenshots/hero.png"]) {
      const absolute = path.join(archive, ...entryPath.split("/"));
      await expect(readFile(absolute, "utf8")).resolves.toBeDefined();
    }
  });

  it("verifies an untouched archive and reports its inventory totals", async () => {
    const root = await fixtureRoot();
    const archive = await fixtureArchive(root);
    writeEvidenceManifest(archive);
    const result = verifyEvidenceManifest(archive);
    expect(result.status).toBe("verified");
    expect(result.sweepIdentity).toBe(sweepIdentity(SWEEP));
    expect(result.totals.files).toBe(7);
    expect(result.totals.gitFiles).toBe(6);
    expect(result.totals.bulkFiles).toBe(1);
    expect(result.totals.gitBytes).toBeGreaterThan(0);
    expect(result.totals.bulkBytes).toBeGreaterThan(0);
  });

  it("keeps the manifest out of its own inventory when re-rendered over an existing one", async () => {
    const root = await fixtureRoot();
    const archive = await fixtureArchive(root);
    writeEvidenceManifest(archive);
    const second = writeEvidenceManifest(archive);
    expect(second.files.some((entry) => entry.path === EVIDENCE_MANIFEST_FILE)).toBe(false);
    expect(verifyEvidenceManifest(archive).status).toBe("verified");
  });

  // Negative control for PRD P2-5 ledger row 1. The red observation mutates the verifier to skip
  // hash comparison; this test must then fail with "RED observed: evidence hash mismatch".
  it("should reject a changed archived file", async () => {
    const root = await fixtureRoot();
    const archive = await fixtureArchive(root);
    writeEvidenceManifest(archive);
    await writeFile(path.join(archive, "src", "main.ts"), "export const ready = false;\n");
    let rejection: unknown;
    try {
      verifyEvidenceManifest(archive);
    } catch (error) {
      rejection = error;
    }
    if (!(rejection instanceof Error) || !/evidence hash mismatch/u.test(rejection.message))
      throw new Error(
        `RED observed: evidence hash mismatch — the verifier did not reject the altered archive${
          rejection instanceof Error
            ? `; it rejected with: ${rejection.message}`
            : "; it accepted it silently"
        }`,
      );
  });

  it("should reject a deleted archived file", async () => {
    const root = await fixtureRoot();
    const archive = await fixtureArchive(root);
    writeEvidenceManifest(archive);
    await rm(path.join(archive, "playtests", "smoke.json"));
    expect(() => verifyEvidenceManifest(archive)).toThrow(
      /evidence file missing from archive: 'playtests\/smoke\.json'/u,
    );
  });

  it("should reject a file added after the manifest was created", async () => {
    const root = await fixtureRoot();
    const archive = await fixtureArchive(root);
    writeEvidenceManifest(archive);
    await writeFile(path.join(archive, "src", "extra.ts"), "export {};\n");
    expect(() => verifyEvidenceManifest(archive)).toThrow(
      /Unlisted evidence file in archive: 'src\/extra\.ts'/u,
    );
  });

  it("should reject an archive that carries no manifest at all", async () => {
    const root = await fixtureRoot();
    const archive = await fixtureArchive(root);
    expect(() => verifyEvidenceManifest(archive)).toThrow(/No evidence manifest in /u);
  });

  it("should reject a malformed evidence manifest that is not valid JSON", async () => {
    const root = await fixtureRoot();
    const archive = await fixtureArchive(root);
    writeEvidenceManifest(archive);
    await writeFile(
      path.join(archive, EVIDENCE_MANIFEST_FILE),
      '{"manifestVersion": 1, "files": [',
    );
    expect(() => readEvidenceManifest(archive)).toThrow(
      /Malformed evidence manifest.*not valid JSON/u,
    );
  });

  it("should reject an unsupported manifest version", async () => {
    const root = await fixtureRoot();
    const archive = await fixtureArchive(root);
    writeEvidenceManifest(archive);
    await writeMutatedManifest(archive, (manifest) => {
      manifest.manifestVersion = EVIDENCE_MANIFEST_VERSION + 1;
    });
    expect(() => readEvidenceManifest(archive)).toThrow(/unsupported manifestVersion 2/u);
  });

  it("should reject malformed provenance fields", async () => {
    const root = await fixtureRoot();
    const mutations: Array<[string, (manifest: Record<string, unknown>) => void, RegExp]> = [
      [
        "createdAt",
        (manifest) => {
          manifest.createdAt = "not-a-timestamp";
        },
        /createdAt must be an ISO timestamp/u,
      ],
      [
        "sourceCommit",
        (manifest) => {
          manifest.sourceCommit = "deadbeef";
        },
        /sourceCommit must be null or a full git sha/u,
      ],
      [
        "sweepIdentity",
        (manifest) => {
          manifest.sweepIdentity =
            "vanilla:somewhere:2020-01-01T00:00:00.000Z:000000000000:000000000000";
        },
        /sweepIdentity '.*' does not match the recorded sweep/u,
      ],
      [
        "sweep.genre",
        (manifest) => {
          const sweep = manifest.sweep as Record<string, unknown>;
          sweep.genre = "Fixture";
        },
        /sweep\.genre must be a lowercase slug/u,
      ],
      [
        "sweep.proofHash",
        (manifest) => {
          const sweep = manifest.sweep as Record<string, unknown>;
          sweep.proofHash = "short";
        },
        /sweep\.proofHash must be a 64-char lowercase sha256/u,
      ],
    ];
    for (const [name, mutate, pattern] of mutations) {
      const archive = await fixtureArchive(root, `malformed-${name}`);
      writeEvidenceManifest(archive);
      await writeMutatedManifest(archive, mutate);
      expect(() => readEvidenceManifest(archive), name).toThrow(pattern);
    }
  });

  it("should reject entries with unknown roles or retention that contradicts the role", async () => {
    const root = await fixtureRoot();
    const archive = await fixtureArchive(root, "bad-role");
    writeEvidenceManifest(archive);
    await writeMutatedManifest(archive, (manifest) => {
      const files = manifest.files as Array<Record<string, unknown>>;
      const first = files[0];
      if (first !== undefined) first.role = "junk";
    });
    expect(() => readEvidenceManifest(archive)).toThrow(/unknown role 'junk'/u);

    const inconsistent = await fixtureArchive(root, "bad-retention");
    writeEvidenceManifest(inconsistent);
    await writeMutatedManifest(inconsistent, (manifest) => {
      const files = manifest.files as Array<Record<string, unknown>>;
      const sweepEntry = files.find((entry) => entry.path === "sweep.json");
      if (sweepEntry !== undefined) sweepEntry.retention = "bulk-candidate";
    });
    expect(() => readEvidenceManifest(inconsistent)).toThrow(
      /retention 'bulk-candidate' contradicts role 'sweep-manifest'/u,
    );
  });

  it("should reject a manifest entry whose path escapes the archive root", async () => {
    const root = await fixtureRoot();
    for (const evil of ["../outside.txt", "/etc/passwd", "..\\..\\escape.txt"]) {
      const archive = await fixtureArchive(root, `traversal-${evil.replace(/\W+/gu, "-")}`);
      writeEvidenceManifest(archive);
      await writeMutatedManifest(archive, (manifest) => {
        (manifest.files as unknown[]).push({
          path: evil,
          sha256: "c".repeat(64),
          bytes: 1,
          role: "config",
          retention: "git",
        });
      });
      expect(() => readEvidenceManifest(archive), evil).toThrow(/traversal rejected/u);
    }
  });

  it("should reject duplicate file identities", async () => {
    const root = await fixtureRoot();
    const archive = await fixtureArchive(root);
    writeEvidenceManifest(archive);
    await writeMutatedManifest(archive, (manifest) => {
      const files = manifest.files as Array<Record<string, unknown>>;
      const first = files[0];
      if (first !== undefined) files.push({ ...first });
    });
    expect(() => readEvidenceManifest(archive)).toThrow(/duplicate file identity/u);
  });

  it("should reject a manifest whose inventory omits the required proof", async () => {
    const root = await fixtureRoot();
    const archive = await fixtureArchive(root);
    writeEvidenceManifest(archive);
    await writeMutatedManifest(archive, (manifest) => {
      manifest.files = (manifest.files as Array<Record<string, unknown>>).filter(
        (entry) => entry.path !== "proof.json",
      );
    });
    expect(() => readEvidenceManifest(archive)).toThrow(
      /missing its required proof: 'proof\.json' is not inventoried/u,
    );
  });

  it("should refuse to render a manifest for an archive without its proof result", async () => {
    const root = await fixtureRoot();
    const archive = await fixtureArchive(root);
    await rm(path.join(archive, "proof.json"));
    expect(() => renderEvidenceManifest(archive)).toThrow(
      /missing its required proof 'proof\.json'; refusing to certify/u,
    );
  });

  it("should reject totals that disagree with the inventoried files", async () => {
    const root = await fixtureRoot();
    const archive = await fixtureArchive(root);
    writeEvidenceManifest(archive);
    await writeMutatedManifest(archive, (manifest) => {
      manifest.totals = { ...(manifest.totals as Record<string, unknown>), files: 99 };
    });
    expect(() => readEvidenceManifest(archive)).toThrow(/totals\.files is 99/u);
  });

  it("reports manifest-less archives as legacy without rewriting them", async () => {
    const root = await fixtureRoot();
    const store = path.join(root, "sweeps");
    await mkdir(store, { recursive: true });
    const modern = await fixtureArchive(store, "modern");
    writeEvidenceManifest(modern);
    const legacy = path.join(store, "legacy");
    await mkdir(legacy, { recursive: true });
    await writeFile(path.join(legacy, "sweep.json"), `${JSON.stringify(SWEEP, null, 2)}\n`);
    await mkdir(path.join(store, "not-an-archive"), { recursive: true });

    const report: IStoreVerifyReport = verifySweepStore(store);
    expect(report.verified).toBe(1);
    expect(report.legacy).toBe(1);
    expect(report.failed).toBe(0);
    // The legacy archive was never rewritten with a generated manifest:
    await expect(access(path.join(legacy, EVIDENCE_MANIFEST_FILE))).rejects.toThrow();
    // ...and verifying it directly fails closed instead of pretending it verified.
    expect(() => verifyEvidenceManifest(legacy)).toThrow(/No evidence manifest in /u);
  });

  it("collects a failed archive in the store report instead of swallowing it", async () => {
    const root = await fixtureRoot();
    const store = path.join(root, "sweeps");
    await mkdir(store, { recursive: true });
    const tampered = await fixtureArchive(store, "tampered");
    writeEvidenceManifest(tampered);
    await writeFile(path.join(tampered, "src", "main.ts"), "tampered\n");

    const report = verifySweepStore(store);
    expect(report.failed).toBe(1);
    expect(report.entries[0]?.error).toMatch(/evidence hash mismatch/u);
  });
});
