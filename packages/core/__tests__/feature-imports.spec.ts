import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve("packages/core/src");

/** Every module and bare specifier the entry reaches through value imports and re-exports. */
function reach(entry: string): { files: Set<string>; bare: Set<string> } {
  const files = new Set<string>();
  const bare = new Set<string>();
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    const source = readFileSync(file, "utf8");
    for (const [, clause, specifier] of source.matchAll(
      /^\s*(?:import|export)\s+([^'";]*?)\s*from\s+["']([^"']+)["']/gmsu,
    )) {
      if (/^type\b/u.test(clause ?? "")) continue;
      if (specifier?.startsWith("."))
        visit(path.resolve(path.dirname(file), specifier.replace(/\.js$/u, ".ts")));
      else if (specifier !== undefined) bare.add(specifier);
    }
  };
  visit(path.join(SRC, entry));
  return { files, bare };
}

// Code that subclasses TSL nodes at import time (`three-mesh-bvh/webgpu`) cannot load on the
// native or Wasm engine, so a game that never builds a GPU scene BVH must not import it.
describe("feature-scoped core imports", () => {
  it("keeps GPUSceneBVH and three-mesh-bvh/webgpu out of the main entry", () => {
    const { files, bare } = reach("index.ts");
    expect(files.has(path.join(SRC, "gpu-scene-bvh.ts"))).toBe(false);
    expect([...bare].filter((specifier) => specifier.startsWith("three-mesh-bvh/"))).toEqual([]);
  });

  it("serves GPUSceneBVH from its own subpath", () => {
    expect(reach("gpu-scene-bvh.ts").bare.has("three-mesh-bvh/webgpu")).toBe(true);
  });
});
