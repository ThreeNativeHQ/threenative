#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = resolve(
  runtimeRoot,
  "android/app/build/generated/threenative/assets/scripts/main.js",
);

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseConformanceBundleArgs(argv) {
  const bundleArg = valueAfter(argv, "--bundle");
  const expectedSha256 = valueAfter(argv, "--sha256");
  const outputArg = valueAfter(argv, "--out");
  if (!bundleArg || !expectedSha256) {
    throw new Error("Android conformance asset requires both --bundle PATH and --sha256 HEX.");
  }
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    throw new Error("--sha256 must be a lowercase 64-character SHA-256 digest.");
  }
  const absolute = (path) => (isAbsolute(path) ? path : resolve(process.cwd(), path));
  return {
    bundle: absolute(bundleArg),
    expectedSha256,
    output: outputArg ? absolute(outputArg) : defaultOutput,
  };
}

export function buildAndroidConformanceAsset(options) {
  if (!existsSync(options.bundle)) {
    throw new Error(`Android conformance bundle does not exist: ${options.bundle}`);
  }
  const contents = readFileSync(options.bundle);
  const actualSha256 = sha256(contents);
  if (actualSha256 !== options.expectedSha256) {
    throw new Error(
      `Android conformance bundle hash mismatch: expected=${options.expectedSha256} actual=${actualSha256}`,
    );
  }
  if (
    /^\s*import\s+/mu.test(contents.toString("utf8")) ||
    /\bimport\s*\(/u.test(contents.toString("utf8"))
  ) {
    throw new Error("Android conformance bundle must be one import-free JavaScript file.");
  }
  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, contents);
  const metadata = {
    schemaVersion: 1,
    kind: "threenative-android-conformance",
    source: options.bundle,
    sourceSha256: actualSha256,
    outputSha256: sha256(readFileSync(options.output)),
    outputBytes: contents.length,
  };
  writeFileSync(`${options.output}.meta.json`, `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

async function main() {
  const options = parseConformanceBundleArgs(process.argv.slice(2));
  const metadata = buildAndroidConformanceAsset(options);
  process.stdout.write(`${JSON.stringify({ output: options.output, metadata }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
