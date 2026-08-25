/**
 * Three.js GLTF + GLB Loading Test (GPU)
 *
 * Verifies that Three.js' own GLTFLoader can load BOTH a .glb (binary glTF)
 * and a .gltf (JSON glTF + .bin + JPG textures) on MystralNative, and render
 * them with the WebGPU renderer.
 *
 * Regression coverage for: "ReferenceError: AbortController is not defined".
 * Three.js' FileLoader (r168+) constructs an AbortController and wraps the URL
 * in a Request before calling fetch(); embedded/external textures are fetched
 * via blob: URLs. All three of those (AbortController, Request, blob: fetch)
 * are polyfilled in src/runtime.cpp.
 *
 * Requires a GPU - runs locally, not in CI.
 */

import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { requireFiles, runCommand, runtimeBinary, runtimeRoot } from "../runtime-test-utils.js";

const EXAMPLE = join(runtimeRoot, "examples/threejs-gltf.js");
const OUTPUT_DIR = join(runtimeRoot, ".test-output");

describe("Three.js GLTF/GLB loading", () => {
  beforeAll(() => {
    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  });

  it("loads a GLB and a GLTF via Three.js GLTFLoader and renders them", async ({ skip }) => {
    requireFiles(skip, [
      { label: "built native runtime", path: runtimeBinary },
      { label: "bundled Three.js GLTF example", path: EXAMPLE },
    ]);

    const outputPath = join(OUTPUT_DIR, "threejs-gltf.png");
    if (existsSync(outputPath)) rmSync(outputPath);

    const { stderr, stdout } = await runCommand(
      runtimeBinary,
      [
        "run",
        EXAMPLE,
        "--headless",
        "--screenshot",
        outputPath,
        "--frames",
        "120",
        "--width",
        "1280",
        "--height",
        "720",
      ],
      { cwd: runtimeRoot, timeoutMs: 60_000 },
    );

    const combined = stdout + stderr;
    if (combined) console.log(combined);

    // The original bug: GLTFLoader threw because AbortController was missing.
    expect(combined).not.toContain("AbortController is not defined");
    expect(combined).not.toContain("Request is not defined");
    expect(combined).not.toContain("Couldn't load texture");

    // Both formats must load through Three.js.
    expect(stdout).toContain("GLB loaded OK");
    expect(stdout).toContain("GLTF loaded OK");

    // And a frame must actually render.
    expect(combined).toContain("Screenshot saved");
    expect(existsSync(outputPath)).toBe(true);
    const stats = statSync(outputPath);
    expect(stats.size).toBeGreaterThan(1000);
  }, 60000);
});
