import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { templatesShipping } from "../../../test-support/templates.js";
import { SHARED_RENDER_SOURCES, canonicalRenderSourcePath } from "../src/index.js";

/**
 * `src/render/` is generated user source, and most of it is a per-kit look that must be free to
 * differ. `worldEnvironment.ts` is the exception: 600 lines of render-chain plumbing that every
 * kit copies verbatim and no kit is expected to edit, kept in seven places by hand.
 *
 * It drifted. Six kits carried the revision that requests `normal`, `metalness` and `roughness`
 * lazily — the fix for a pass that carries a colour target no fragment shader writes, where WebGPU
 * refuses the pipeline, the frame comes out black, and the chain still reports every stage as
 * applied. `sailing` carried the revision before it. Nothing failed, because nothing compared them.
 *
 * The loading screen already had this problem and already has the answer: one canonical copy, and
 * a gate that fails when a kit's copy stops matching it.
 */
describe("shared render sources", () => {
  it.each(SHARED_RENDER_SOURCES)(
    "keeps every kit's %s identical to the canonical copy",
    async (relativePath) => {
      const canonical = await readFile(canonicalRenderSourcePath(relativePath), "utf8");
      const templates = templatesShipping(relativePath);

      for (const template of templates) {
        const copy = await readFile(
          path.resolve("packages/create-threenative/templates", template, relativePath),
          "utf8",
        );
        expect(copy, `${template}/${relativePath}`).toBe(canonical);
      }
    },
  );

  it.each(SHARED_RENDER_SOURCES)("keeps %s free of framework imports", async (relativePath) => {
    const canonical = await readFile(canonicalRenderSourcePath(relativePath), "utf8");

    expect(canonical).not.toMatch(/@threenative\//u);
  });
});
