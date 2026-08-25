/**
 * CLI Basic Tests
 *
 * Tests CLI argument parsing, help, version - no GPU required.
 * These tests run in CI.
 */

import { describe, expect, it } from "vitest";
import { requireFiles, runCommand, runtimeBinary } from "../runtime-test-utils.js";

const binaryRequirement = [{ label: "built native runtime", path: runtimeBinary }];

describe("CLI Basic", () => {
  it("should show help with --help", async ({ skip }) => {
    requireFiles(skip, binaryRequirement);
    const { exitCode, stdout } = await runCommand(runtimeBinary, ["--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Mystral CLI");
    expect(stdout).toContain("USAGE:");
    expect(stdout).toContain("mystral run");
  });

  it("should show version with --version", async ({ skip }) => {
    requireFiles(skip, binaryRequirement);
    const { exitCode, stdout } = await runCommand(runtimeBinary, ["--version"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Mystral Native Runtime");
  });

  it("should fail with missing script file", async ({ skip }) => {
    requireFiles(skip, binaryRequirement);
    const { exitCode, stderr } = await runCommand(runtimeBinary, ["run"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("No script file specified");
  });

  it("should fail with nonexistent script", async ({ skip }) => {
    requireFiles(skip, binaryRequirement);
    const { exitCode, stderr } = await runCommand(runtimeBinary, ["run", "nonexistent-file.js"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Cannot open file");
  });

  it("should accept valid CLI options", async ({ skip }) => {
    requireFiles(skip, binaryRequirement);
    const { stdout } = await runCommand(runtimeBinary, ["--help"]);

    expect(stdout).toContain("--width");
    expect(stdout).toContain("--height");
    expect(stdout).toContain("--title");
    expect(stdout).toContain("--headless");
    expect(stdout).toContain("--screenshot");
    expect(stdout).toContain("--frames");
    expect(stdout).toContain("--quiet");
  });
});
