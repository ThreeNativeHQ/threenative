import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The export map is a contract with consumers outside this workspace, and inside it nothing tests
 * that contract.
 *
 * Every module here is reachable from a sibling package by a relative path into `src/`, so a symbol
 * can be perfectly usable across the whole monorepo and completely unreachable from a published
 * install. That is not hypothetical: on 2026-08-16 the Studio split found that `WEBGPU_BROWSER_ARGS`
 * and the whole capture module were absent from the map, having only ever been reached by
 * workspace-relative deep import — so the Studio judging harness could not be built outside this
 * repository at all.
 *
 * These assertions are about the map, not about behaviour. `capture.spec.ts` tests what the capture
 * guard does; this tests that a stranger can get at it.
 */

const packageJson = new URL("../package.json", import.meta.url);

interface IExportMap {
  readonly exports: Record<string, { import?: string; types?: string } | string>;
}

async function exportMap(): Promise<IExportMap["exports"]> {
  const manifest = JSON.parse(await readFile(fileURLToPath(packageJson), "utf8")) as IExportMap;
  return manifest.exports;
}

describe("the published export map", () => {
  it("offers one subpath per dependency tier", async () => {
    // Adding a subpath is a public API decision; a new one showing up here without a deliberate
    // change to this list means the tiers documented in tsup.config.ts have drifted.
    expect(Object.keys(await exportMap()).sort()).toEqual([
      ".",
      "./capture",
      "./package.json",
      "./runner",
      "./three",
    ]);
  });

  it("exposes the capture guard without requiring playwright", async () => {
    // `./capture` is its own tier because it costs one PNG decoder. A caller asking whether a
    // screenshot is blank should not have to pull a browser driver to find out — and before this
    // subpath existed, the only way to ask was a deep import into `src/`.
    const capture = await import("../src/capture.js");
    for (const name of [
      "CAPTURE_GUARD_LIMITS",
      "CaptureGuardError",
      "assertCaptureNotBlank",
      "assertFrameShowsSomething",
      "inspectFrame",
    ])
      expect(capture, `${name} is missing from ./capture`).toHaveProperty(name);

    expect((await exportMap())["./capture"]).toEqual({
      import: "./dist/capture.js",
      types: "./dist/capture.d.ts",
    });
  });

  it("exposes the WebGPU browser arguments through ./runner", async () => {
    // Without these a consumer cannot reproduce the browser this repository's own gates run in, and
    // Chromium quietly serves WebGPU from SwiftShader — a CPU rasteriser reporting healthy-looking
    // limits. An unreachable constant is how that mistake gets made by someone doing their best.
    const runner = await import("../src/runner/index.js");
    expect(runner).toHaveProperty("WEBGPU_BROWSER_ARGS");
    expect(runner.WEBGPU_BROWSER_ARGS).toContain("--enable-features=Vulkan");
    expect(runner).toHaveProperty("softwareAdapterName");
  });
});
