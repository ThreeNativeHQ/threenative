import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hashProofFiles, resolveGenre, sealedProofFiles, sealedProofHash } from "../make-sandbox";

const GENRES = ["platformer", "topdown-action", "endless-runner", "exploration"] as const;
const FORBIDDEN = [
  "@threenative",
  "packages/",
  "CharacterBody3D",
  "RigidBody3D",
  "Area3D",
  "defineGame",
  "GameState",
];

describe("sealed genre proof set", () => {
  it("contains arm-neutral, asserted, screenshot-producing scenarios for every genre", async () => {
    for (const genre of GENRES) {
      const files = sealedProofFiles(process.cwd(), genre);
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const source = await readFile(file.absolutePath, "utf8");
        const scenario = JSON.parse(source) as {
          assert?: Record<string, unknown>;
          artifacts?: { screenshots?: unknown };
        };
        expect(Object.keys(scenario.assert ?? {}).length).toBeGreaterThan(0);
        expect(scenario.artifacts?.screenshots).toBe("before-after");
        for (const forbidden of FORBIDDEN) expect(source).not.toContain(forbidden);
      }
    }
  });

  it("hashes file names and contents deterministically", async () => {
    const first = sealedProofHash(process.cwd(), "platformer");
    expect(sealedProofHash(process.cwd(), "platformer")).toBe(first);
    const files = sealedProofFiles(process.cwd(), "platformer");
    const renamed = await mkdtemp(path.join(os.tmpdir(), "threenative-proof-hash-"));
    try {
      const source = files[0];
      if (source === undefined) throw new Error("The platformer proof set is empty.");
      const copied = path.join(renamed, "renamed.playtest.json");
      await copyFile(source.absolutePath, copied);
      expect(
        hashProofFiles([{ absolutePath: copied, relativePath: "renamed.playtest.json" }]),
      ).not.toBe(first);
    } finally {
      await rm(renamed, { recursive: true, force: true });
    }
  });

  it("rejects an empty proof set instead of producing a 0/0 hash", () => {
    expect(() => hashProofFiles([])).toThrow(/empty sealed proof set/);
  });

  it("stores the sealed hash in the genre input used by the scaffolder", () => {
    const input = resolveGenre(process.cwd(), "platformer");
    expect(input.proofHash).toBe(sealedProofHash(process.cwd(), "platformer"));
  });
});
