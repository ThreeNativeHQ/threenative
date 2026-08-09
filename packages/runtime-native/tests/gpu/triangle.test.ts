/**
 * Triangle Rendering Tests
 *
 * Tests basic WebGPU rendering with the triangle example - requires GPU.
 * These tests only run locally, not in CI.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  requireFiles,
  runCommand,
  runtimeBinary,
  runtimeRoot,
} from "../runtime-test-utils.js";

const EXAMPLES_DIR = join(runtimeRoot, "examples");

describe("Triangle Rendering", () => {
  it("should render triangle example without errors", async ({ skip }) => {
    const triangleScript = join(EXAMPLES_DIR, "triangle.js");
    requireFiles(skip, [
      { label: "built native runtime", path: runtimeBinary },
      { label: "triangle example", path: triangleScript },
    ]);

    const outputPath = join(runtimeRoot, ".test-output/triangle-basic.png");

    // Use screenshot mode to ensure process exits
    const { stderr, stdout } = await runCommand(runtimeBinary, [
      "run",
      triangleScript,
      "--headless",
      "--screenshot",
      outputPath,
      "--frames",
      "10",
    ]);

    console.log("stdout:", stdout);
    if (stderr) console.log("stderr:", stderr);

    // Should initialize successfully
    expect(stdout).toContain("Device acquired");
    expect(stdout).toContain("Pipeline created");
    expect(stdout).toContain("Render loop started");

    // Should not have WebGPU errors (ignore QuickJS GC assertion)
    expect(stderr).not.toContain("WebGPU error");
  }, 30000);

  it("should execute requestAnimationFrame callbacks", async ({ skip }) => {
    const triangleScript = join(EXAMPLES_DIR, "triangle.js");
    requireFiles(skip, [
      { label: "built native runtime", path: runtimeBinary },
      { label: "triangle example", path: triangleScript },
    ]);

    const outputPath = join(runtimeRoot, ".test-output/raf-test.png");

    // Use screenshot mode to ensure process exits
    const { stdout } = await runCommand(runtimeBinary, [
      "run",
      triangleScript,
      "--headless",
      "--screenshot",
      outputPath,
      "--frames",
      "30",
    ]);

    // The triangle example uses requestAnimationFrame
    // If it completes 30 frames, RAF is working
    expect(stdout).toContain("Render loop started");
  }, 30000);

  it("should handle setTimeout and setInterval", async ({ skip }) => {
    const fetchScript = join(EXAMPLES_DIR, "test-fetch.js");
    requireFiles(skip, [
      { label: "built native runtime", path: runtimeBinary },
      { label: "timer example", path: fetchScript },
    ]);

    const outputPath = join(runtimeRoot, ".test-output/timer-test.png");

    // Use screenshot mode to ensure process exits
    const { stdout } = await runCommand(runtimeBinary, [
      "run",
      fetchScript,
      "--headless",
      "--screenshot",
      outputPath,
      "--frames",
      "120",
    ]);

    console.log("stdout:", stdout);

    // test-fetch.js tests setTimeout and setInterval
    expect(stdout).toContain("Timeout 1 fired!");
    expect(stdout).toContain("Interval tick: 1");
  }, 30000);
});
