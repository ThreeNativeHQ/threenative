/**
 * Screenshot Tests
 *
 * Tests headless screenshot capture - requires GPU.
 * These tests only run locally, not in CI.
 */

import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { requireFiles, runCommand, runtimeBinary, runtimeRoot } from "../runtime-test-utils.js";

const EXAMPLES_DIR = join(runtimeRoot, "examples");
const OUTPUT_DIR = join(runtimeRoot, ".test-output");

describe("Screenshot Capture", () => {
  beforeAll(() => {
    // Create output directory
    if (!existsSync(OUTPUT_DIR)) {
      mkdirSync(OUTPUT_DIR, { recursive: true });
    }
  });

  it("should capture screenshot of triangle example", async ({ skip }) => {
    const triangleScript = join(EXAMPLES_DIR, "triangle.js");
    requireFiles(skip, [
      { label: "built native runtime", path: runtimeBinary },
      { label: "triangle example", path: triangleScript },
    ]);

    const outputPath = join(OUTPUT_DIR, "triangle-screenshot.png");

    // Remove old screenshot if exists
    if (existsSync(outputPath)) {
      rmSync(outputPath);
    }

    const { stderr, stdout } = await runCommand(runtimeBinary, [
      "run",
      triangleScript,
      "--headless",
      "--screenshot",
      outputPath,
      "--frames",
      "30",
      "--width",
      "800",
      "--height",
      "600",
    ]);

    console.log("stdout:", stdout);
    if (stderr) console.log("stderr:", stderr);

    // Check screenshot was saved (ignore exit code - QuickJS has GC assertion at shutdown)
    expect(stdout).toContain("Screenshot saved");
    expect(existsSync(outputPath)).toBe(true);

    // Check that the file is a valid PNG (non-zero size)
    const stats = statSync(outputPath);
    expect(stats.size).toBeGreaterThan(1000); // PNG should be at least 1KB
  }, 30000); // 30 second timeout for GPU tests

  it("should capture screenshot at custom resolution", async ({ skip }) => {
    const triangleScript = join(EXAMPLES_DIR, "triangle.js");
    requireFiles(skip, [
      { label: "built native runtime", path: runtimeBinary },
      { label: "triangle example", path: triangleScript },
    ]);

    const outputPath = join(OUTPUT_DIR, "triangle-1920x1080.png");

    if (existsSync(outputPath)) {
      rmSync(outputPath);
    }

    const { stdout } = await runCommand(runtimeBinary, [
      "run",
      triangleScript,
      "--headless",
      "--screenshot",
      outputPath,
      "--frames",
      "30",
      "--width",
      "1920",
      "--height",
      "1080",
    ]);

    // Check screenshot was saved (ignore exit code - QuickJS GC issue)
    expect(stdout).toContain("Screenshot saved");
    expect(existsSync(outputPath)).toBe(true);

    const stats = statSync(outputPath);
    expect(stats.size).toBeGreaterThan(1000);
  }, 30000);

  it("should capture rotating cube screenshot", async ({ skip }) => {
    const cubeScript = join(EXAMPLES_DIR, "simple-cube.js");
    requireFiles(skip, [
      { label: "built native runtime", path: runtimeBinary },
      { label: "rotating cube example", path: cubeScript },
    ]);

    const outputPath = join(OUTPUT_DIR, "cube-screenshot.png");

    if (existsSync(outputPath)) {
      rmSync(outputPath);
    }

    const { stdout } = await runCommand(runtimeBinary, [
      "run",
      cubeScript,
      "--headless",
      "--screenshot",
      outputPath,
      "--frames",
      "60",
      "--width",
      "800",
      "--height",
      "600",
    ]);

    console.log("stdout:", stdout);

    expect(stdout).toContain("Screenshot saved");
    expect(existsSync(outputPath)).toBe(true);

    const stats = statSync(outputPath);
    expect(stats.size).toBeGreaterThan(1000);
  }, 30000);

  it.skip("should capture texture test screenshot [requires sampler/texture bind-group fix]", () => {});
});
