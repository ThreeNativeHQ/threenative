/**
 * Mystral Engine GPU Tests
 *
 * Tests the full Mystral engine examples with indirect draw enabled.
 * These tests verify that:
 * - Damaged Helmet (main.js) renders correctly
 * - Sponza scene loads and renders
 * - Forest2 procedural scene works
 * - UI components render properly
 * - React reconciler works with native runtime
 *
 * Screenshots are saved to /tmp/ for visual verification.
 */

import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requireFiles, runCommand, runtimeBinary, runtimeRoot } from "../runtime-test-utils.js";

const EXAMPLES_DIR = join(runtimeRoot, "examples");
const OUTPUT_DIR = "/tmp";

// Helper function to run an example and capture screenshot
async function runExample(
  scriptPath: string,
  outputName: string,
  frames = 120,
  timeout = 60000,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const outputPath = join(OUTPUT_DIR, outputName);

  // Remove old screenshot if exists
  if (existsSync(outputPath)) {
    rmSync(outputPath);
  }

  const { stderr, stdout } = await runCommand(
    runtimeBinary,
    [
      "run",
      scriptPath,
      "--headless",
      "--screenshot",
      outputPath,
      "--frames",
      String(frames),
      "--width",
      "1280",
      "--height",
      "720",
    ],
    { timeoutMs: timeout },
  );

  const screenshotSaved = stdout.includes("Screenshot saved") && existsSync(outputPath);

  if (screenshotSaved) {
    const stats = statSync(outputPath);
    console.log(`Screenshot saved: ${outputPath} (${(stats.size / 1024).toFixed(1)} KB)`);
  }

  return {
    success: screenshotSaved,
    stdout,
    stderr,
  };
}

describe("Mystral Engine Examples", () => {
  it("should render Damaged Helmet (main.js) with indirect draw", async ({ skip }) => {
    const scriptPath = join(EXAMPLES_DIR, "mystral-test/main.js");
    requireFiles(skip, [
      { label: "built native runtime", path: runtimeBinary },
      { label: "prebundled Damaged Helmet example", path: scriptPath },
    ]);

    const result = await runExample(scriptPath, "mystral-main.png", 120);

    // Verify indirect draw is enabled in output
    expect(result.stdout).toContain("indirect-first-instance feature enabled");
    expect(result.success).toBe(true);

    // Verify no fatal errors
    expect(result.stdout).not.toContain("Fatal:");
  }, 120000);

  it("should render Sponza scene with indirect draw", async ({ skip }) => {
    const scriptPath = join(EXAMPLES_DIR, "mystral-test/sponza.js");
    requireFiles(skip, [
      { label: "built native runtime", path: runtimeBinary },
      { label: "prebundled Sponza example", path: scriptPath },
    ]);

    const result = await runExample(scriptPath, "mystral-sponza.png", 120);

    expect(result.stdout).toContain("indirect-first-instance feature enabled");
    expect(result.success).toBe(true);
    expect(result.stdout).not.toContain("Fatal:");
  }, 180000); // Sponza takes longer to load

  it("should render Sponza Full scene with indirect draw", async ({ skip }) => {
    const scriptPath = join(EXAMPLES_DIR, "mystral-test/sponza-full.js");
    requireFiles(skip, [
      { label: "built native runtime", path: runtimeBinary },
      { label: "prebundled full Sponza example", path: scriptPath },
    ]);

    const result = await runExample(scriptPath, "mystral-sponza-full.png", 120);

    expect(result.stdout).toContain("indirect-first-instance feature enabled");
    expect(result.success).toBe(true);
    expect(result.stdout).not.toContain("Fatal:");
  }, 180000);

  it("should render Forest2 procedural scene with indirect draw", async ({ skip }) => {
    const scriptPath = join(EXAMPLES_DIR, "mystral-test/forest2.js");
    requireFiles(skip, [
      { label: "built native runtime", path: runtimeBinary },
      { label: "prebundled Forest2 example", path: scriptPath },
    ]);

    const result = await runExample(scriptPath, "mystral-forest2.png", 120);

    expect(result.stdout).toContain("indirect-first-instance feature enabled");
    expect(result.success).toBe(true);
    expect(result.stdout).not.toContain("Fatal:");
  }, 180000);

  it("should render UI Simple test with indirect draw", async ({ skip }) => {
    const scriptPath = join(EXAMPLES_DIR, "mystral-test/ui-simple.js");
    requireFiles(skip, [
      { label: "built native runtime", path: runtimeBinary },
      { label: "prebundled UI Simple example", path: scriptPath },
    ]);

    const result = await runExample(scriptPath, "mystral-ui-simple.png", 120);

    expect(result.stdout).toContain("indirect-first-instance feature enabled");
    expect(result.success).toBe(true);
    expect(result.stdout).not.toContain("Fatal:");
  }, 120000);

  it("should render UI Test with indirect draw", async ({ skip }) => {
    const scriptPath = join(EXAMPLES_DIR, "mystral-test/ui-test.js");
    requireFiles(skip, [
      { label: "built native runtime", path: runtimeBinary },
      { label: "prebundled UI example", path: scriptPath },
    ]);

    const result = await runExample(scriptPath, "mystral-ui-test.png", 120);

    expect(result.stdout).toContain("indirect-first-instance feature enabled");
    expect(result.success).toBe(true);
    expect(result.stdout).not.toContain("Fatal:");
  }, 120000);

  it("should render Basic Scene with indirect draw", async ({ skip }) => {
    const scriptPath = join(EXAMPLES_DIR, "mystral-test/basic-scene.js");
    requireFiles(skip, [
      { label: "built native runtime", path: runtimeBinary },
      { label: "prebundled basic scene example", path: scriptPath },
    ]);

    const result = await runExample(scriptPath, "mystral-basic-scene.png", 120);

    expect(result.stdout).toContain("indirect-first-instance feature enabled");
    expect(result.success).toBe(true);
    expect(result.stdout).not.toContain("Fatal:");
  }, 120000);

  it("should render React test with indirect draw", async ({ skip }) => {
    const scriptPath = join(EXAMPLES_DIR, "react-test/dist/bundle.js");
    requireFiles(skip, [
      { label: "built native runtime", path: runtimeBinary },
      { label: "prebundled React example", path: scriptPath },
    ]);

    const result = await runExample(scriptPath, "mystral-react-test.png", 120);

    // Verify indirect draw is enabled
    expect(result.stdout).toContain("indirect-first-instance feature enabled");
    expect(result.success).toBe(true);

    // Verify React components mounted
    expect(result.stdout).toContain("React tree mounted");

    // Verify all 3 meshes rendered (plane + 2 cubes)
    expect(result.stdout).toContain("Rendered 3 deferred meshes");

    expect(result.stdout).not.toContain("Fatal:");
  }, 120000);

  it("should render 3D UI test (Canvas 2D over WebGPU)", async ({ skip }) => {
    const scriptPath = join(EXAMPLES_DIR, "test-ui-3d.js");
    requireFiles(skip, [
      { label: "built native runtime", path: runtimeBinary },
      { label: "3D UI example", path: scriptPath },
    ]);

    const result = await runExample(scriptPath, "mystral-ui-3d.png", 120);

    expect(result.success).toBe(true);

    // Verify Canvas 2D context was created
    expect(result.stdout).toContain("Canvas 2D context created");

    // Verify UI pipeline was created
    expect(result.stdout).toContain("UI pipeline created");

    // Verify render loop started
    expect(result.stdout).toContain("Starting render loop - 3D cube with UI overlay!");

    expect(result.stdout).not.toContain("Fatal:");
  }, 120000);
});
