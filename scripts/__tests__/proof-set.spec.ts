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

  it("keeps the brief-critical action assertions in the sealed proofs", async () => {
    expect(
      sealedProofFiles(process.cwd(), "topdown-action").map(({ relativePath }) => relativePath),
    ).toEqual(["topdown-action-pointer.playtest.json", "topdown-action.playtest.json"]);

    const endless = JSON.parse(
      await readFile(
        path.join(
          process.cwd(),
          "docs/benchmark/genres/endless-runner/proof/endless-runner.playtest.json",
        ),
        "utf8",
      ),
    ) as { assert?: { resources?: Array<{ anyOf?: Array<{ path?: string }> }> } };
    const movementAlternatives = endless.assert?.resources?.find(
      ({ anyOf }) => anyOf !== undefined,
    )?.anyOf;
    expect(movementAlternatives).toEqual([
      { path: "jumps", gte: 1, changed: true },
      { path: "peakRise", gte: 0.5, changed: true },
      { path: "slides", gte: 1, changed: true },
      { path: "peakSlide", gte: 0.5, changed: true },
    ]);

    const topdown = JSON.parse(
      await readFile(
        path.join(
          process.cwd(),
          "docs/benchmark/genres/topdown-action/proof/topdown-action.playtest.json",
        ),
        "utf8",
      ),
    ) as {
      assert?: {
        animation?: Array<{
          advancedFrames?: number;
          clip?: string;
          entity?: string;
          entered?: boolean;
        }>;
        movement?: { minDistance?: number; rotationChanged?: boolean };
        resources?: Array<{ path?: string }>;
      };
    };
    expect(topdown.assert?.movement?.minDistance).toBe(2);
    expect(topdown.assert?.movement?.rotationChanged).toBeUndefined();
    expect(topdown.assert?.animation).toBeUndefined();
    expect(topdown.assert?.resources?.map(({ path: resourcePath }) => resourcePath)).toEqual(
      expect.arrayContaining(["score", "enemiesRemaining", "objective"]),
    );

    const pointer = JSON.parse(
      await readFile(
        path.join(
          process.cwd(),
          "docs/benchmark/genres/topdown-action/proof/topdown-action-pointer.playtest.json",
        ),
        "utf8",
      ),
    ) as {
      assert?: {
        animation?: unknown;
        movement?: { rotationChanged?: boolean };
        resources?: Array<{ path?: string }>;
      };
      steps?: Array<Record<string, unknown>>;
    };
    expect(pointer.steps).toHaveLength(1);
    expect(pointer.steps?.[0]).toMatchObject({
      pointerPosition: { x: 0.7, y: 0.5 },
      press: "Space",
    });
    expect(pointer.assert?.movement?.rotationChanged).toBe(true);
    expect(pointer.assert?.animation).toEqual(
      expect.arrayContaining([
        { advancedFrames: 1, clip: "attack", entity: "player", entered: true },
      ]),
    );
    expect(pointer.assert?.resources?.map(({ path: resourcePath }) => resourcePath)).toEqual(
      expect.arrayContaining(["shots", "reload"]),
    );
  });
});
