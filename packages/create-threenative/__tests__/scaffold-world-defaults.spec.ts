import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileAssets } from "@threenative/assets";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { loadConfig } from "../src/config.js";
import { createProject } from "../src/index.js";

// PRD-458 AC-6 — a freshly scaffolded game that streams a world gets foliage LOD, cutout conversion
// and a material merge with no `threenative.config.ts` at all.
//
// The claim is about the *resolved* config, so this proves the premise (the scaffold declares no
// assets policy) and then reads the *shipped bytes* the cook left in `public/` — the JSON chunk of
// the compiled `.glb` parsed directly, because a file that says `MASK` and carries a chain is a
// stronger statement than a report saying the pass intended to.

const CONIFER = path.resolve("packages/assets/__tests__/fixtures/foliage-conifer.glb");

interface ICookedJson {
  readonly materials: readonly {
    readonly alphaMode?: string;
    readonly name?: string;
    readonly pbrMetallicRoughness?: {
      readonly baseColorFactor?: readonly number[];
      readonly baseColorTexture?: { readonly index: number };
    };
  }[];
  readonly meshes: readonly {
    readonly primitives: readonly {
      readonly extensions?: Record<string, { readonly counts?: readonly number[] } | undefined>;
    }[];
  }[];
  readonly textures: readonly unknown[];
}

/** The glTF JSON chunk of a compiled `.glb`, straight out of the container. */
async function cookedJson(file: string): Promise<ICookedJson> {
  const glb = await readFile(file);
  const jsonLength = glb.readUInt32LE(12);
  return JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8")) as ICookedJson;
}

describe("a fresh scaffold's resolved asset config (PRD-458 AC-6)", () => {
  it("enables cutout, LOD and dedupe with no config", async () => {
    const root = await makeTempDir("threenative-scaffold-world-defaults-");
    try {
      const result = await createProject(
        { install: false, target: "game", template: "minimal" },
        root,
      );
      const project = result.target;

      // The premise: the scaffold declares no assets policy, so nothing but the defaults can be
      // responsible for what the cook does with what the game drops in.
      const config = await loadConfig(project);
      expect(config.assets?.lod).toBeUndefined();

      // What a streaming game would do: put a world model in the world folder. The conifer is the
      // engine's own procedural tree (`packages/assets/__tests__/fixtures/foliage-conifer.mjs`),
      // a `BLEND` needle material and an opaque bark.
      const world = path.join(project, "assets", "world", "trees");
      await mkdir(world, { recursive: true });
      await cp(CONIFER, path.join(world, "conifer.glb"));
      await compileAssets({ cwd: project, platform: "web" });

      const manifest = JSON.parse(
        await readFile(path.join(project, "public", "assets.manifest.json"), "utf8"),
      ) as { entries: Record<string, { output: string }> };
      const output = manifest.entries["world/trees/conifer.glb"]?.output;
      expect(output, "the world model was cooked").toBeDefined();
      const cooked = await cookedJson(path.join(project, "public", output as string));

      // Cutout: the needles that shipped as `BLEND` are alpha-tested in the shipped file.
      expect(cooked.materials.find((material) => material.name === "leaf")?.alphaMode).toBe("MASK");
      // LOD: the tree ships a chain of derived levels. The needle cards are the part a triangle
      // reducer alone cannot produce, so the chain existing at all is the default working.
      const chains = cooked.meshes.flatMap((mesh) =>
        mesh.primitives.map((primitive) => primitive.extensions?.TN_discrete_lod),
      );
      const levels = Math.max(0, ...chains.map((chain) => chain?.counts?.length ?? 0));
      expect(levels).toBeGreaterThanOrEqual(2);
      // Dedupe: the merge is unconditional, and its postcondition is a shipped file with no two
      // materials that agree on every field that can change a pixel. (The *count* it collapsed is
      // AC-5's number, measured on the reference world, not here.)
      const signatures = cooked.materials.map(
        (material) =>
          `${String(material.alphaMode ?? "OPAQUE")}|${JSON.stringify(material.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1])}|${String(material.pbrMetallicRoughness?.baseColorTexture?.index ?? -1)}`,
      );
      expect(new Set(signatures).size).toBe(signatures.length);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 600_000);
});
