/**
 * Fetch API Tests
 *
 * Tests fetch() with file:// and http:// - no GPU required (runs headless with early exit).
 * These tests run in CI.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  requireFiles,
  requireGpuTestOptIn,
  runCommand,
  runtimeBinary,
  runtimeRoot,
} from "../runtime-test-utils.js";

const TEST_DIR = join(runtimeRoot, ".test-tmp");
const binaryRequirement = [{ label: "built native runtime", path: runtimeBinary }];

describe("Fetch API", () => {
  beforeAll(() => {
    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }

    // Create test JSON file
    writeFileSync(
      join(TEST_DIR, "test.json"),
      JSON.stringify({ message: "Hello from test", value: 42 }),
    );

    // Create test text file
    writeFileSync(join(TEST_DIR, "test.txt"), "Hello, World!");
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("should fetch local JSON file", async ({ skip }) => {
    requireFiles(skip, binaryRequirement);
    requireGpuTestOptIn(skip);

    // Create a test script that fetches the JSON file
    const testScript = `
      async function main() {
        try {
          const response = await fetch('file://${join(TEST_DIR, "test.json")}');
          if (!response.ok) {
            console.log('FAIL: response not ok');
            return;
          }
          const data = await response.json();
          if (data.message === 'Hello from test' && data.value === 42) {
            console.log('PASS: JSON fetch works');
          } else {
            console.log('FAIL: unexpected data', JSON.stringify(data));
          }
        } catch (e) {
          console.log('FAIL: ' + e.message);
        }
      }
      main();
    `;

    writeFileSync(join(TEST_DIR, "fetch-test.js"), testScript);

    const screenshotPath = join(TEST_DIR, "fetch-test-screenshot.png");
    const { stdout } = await runCommand(runtimeBinary, [
      "run",
      join(TEST_DIR, "fetch-test.js"),
      "--headless",
      "--screenshot",
      screenshotPath,
      "--frames",
      "10",
    ]);

    expect(stdout).toContain("PASS: JSON fetch works");
  });

  it("should fetch local text file", async ({ skip }) => {
    requireFiles(skip, binaryRequirement);
    requireGpuTestOptIn(skip);

    const testScript = `
      async function main() {
        try {
          const response = await fetch('file://${join(TEST_DIR, "test.txt")}');
          if (!response.ok) {
            console.log('FAIL: response not ok');
            return;
          }
          const text = await response.text();
          if (text === 'Hello, World!') {
            console.log('PASS: text fetch works');
          } else {
            console.log('FAIL: unexpected text: ' + text);
          }
        } catch (e) {
          console.log('FAIL: ' + e.message);
        }
      }
      main();
    `;

    writeFileSync(join(TEST_DIR, "fetch-text-test.js"), testScript);

    const screenshotPath = join(TEST_DIR, "fetch-text-screenshot.png");
    const { stdout } = await runCommand(runtimeBinary, [
      "run",
      join(TEST_DIR, "fetch-text-test.js"),
      "--headless",
      "--screenshot",
      screenshotPath,
      "--frames",
      "10",
    ]);

    expect(stdout).toContain("PASS: text fetch works");
  });

  it("should return 404 for nonexistent file", async ({ skip }) => {
    requireFiles(skip, binaryRequirement);
    requireGpuTestOptIn(skip);

    const testScript = `
      async function main() {
        try {
          const response = await fetch('file://${join(TEST_DIR, "nonexistent.txt")}');
          if (response.status === 404 && !response.ok) {
            console.log('PASS: 404 for nonexistent file');
          } else {
            console.log('FAIL: expected 404, got ' + response.status);
          }
        } catch (e) {
          console.log('FAIL: ' + e.message);
        }
      }
      main();
    `;

    writeFileSync(join(TEST_DIR, "fetch-404-test.js"), testScript);

    const screenshotPath = join(TEST_DIR, "fetch-404-screenshot.png");
    const { stdout } = await runCommand(runtimeBinary, [
      "run",
      join(TEST_DIR, "fetch-404-test.js"),
      "--headless",
      "--screenshot",
      screenshotPath,
      "--frames",
      "10",
    ]);

    expect(stdout).toContain("PASS: 404 for nonexistent file");
  });

  it("should support arrayBuffer()", async ({ skip }) => {
    requireFiles(skip, binaryRequirement);
    requireGpuTestOptIn(skip);

    const testScript = `
      async function main() {
        try {
          const response = await fetch('file://${join(TEST_DIR, "test.txt")}');
          const buffer = await response.arrayBuffer();
          if (buffer instanceof ArrayBuffer && buffer.byteLength === 13) {
            console.log('PASS: arrayBuffer works');
          } else {
            console.log('FAIL: unexpected buffer size ' + buffer.byteLength);
          }
        } catch (e) {
          console.log('FAIL: ' + e.message);
        }
      }
      main();
    `;

    writeFileSync(join(TEST_DIR, "fetch-buffer-test.js"), testScript);

    const screenshotPath = join(TEST_DIR, "fetch-buffer-screenshot.png");
    const { stdout } = await runCommand(runtimeBinary, [
      "run",
      join(TEST_DIR, "fetch-buffer-test.js"),
      "--headless",
      "--screenshot",
      screenshotPath,
      "--frames",
      "10",
    ]);

    expect(stdout).toContain("PASS: arrayBuffer works");
  });
});
