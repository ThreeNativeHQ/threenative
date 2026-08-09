import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { test } from "vitest";
import { absoluteErrorRatio } from "../conformance/metrics.mjs";
import { compareCaptures, inspectCapture } from "../conformance/metrics.mjs";
import {
  buildAndroidConformanceAsset,
  parseConformanceBundleArgs,
} from "../scripts/build-android-conformance.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const runner = join(root, "conformance/run-conformance.mjs");

function run(args, env = {}) {
  return spawnSync(process.execPath, [runner, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 120_000,
  });
}

test("the workspace test lane stays runtime-free and runs the native contract suite", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const testScript = manifest.scripts?.test ?? "";

  assert.match(testScript, /vitest/, "package test must run the imported contract suite");
  assert.doesNotMatch(
    testScript,
    /cmake|gradle|xcodebuild|native:build/,
    "default package tests must not require a native toolchain",
  );
});

test("dry run validates and bundles implemented rows without a browser or native runtime", () => {
  const dir = mkdtempSync(join(tmpdir(), "threenative-conformance-"));
  try {
    const out = join(dir, "dry-report.json");
    const proc = run(["--dry-run", "--out", out], {
      FIREFOX_BIN: join(dir, "missing-firefox"),
      TN_RUNTIME: join(dir, "missing-runtime"),
      MYSTRAL_BIN: "",
    });

    assert.equal(proc.status, 0, proc.stderr || proc.stdout);
    const report = JSON.parse(readFileSync(out, "utf8"));
    const implemented = JSON.parse(
      readFileSync(join(root, "conformance/registry.json"), "utf8"),
    ).tests.filter((entry) => entry.status === "implemented").length;
    assert.equal(report.mode, "dry-run");
    assert.equal(report.summary.validated, implemented);
    assert.equal(report.summary.pass, 0, "dry run must not claim runtime conformance passes");
    assert.equal(report.host.browser, null);
    assert.equal(report.host.runtime, null);
    assert.ok(
      report.results
        .filter((result) => result.status === "validated")
        .every((result) => result.browserBundle && result.nativeBundle),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("report validation rejects a pass with null metrics or incomplete browser execution", () => {
  const dir = mkdtempSync(join(tmpdir(), "threenative-conformance-"));
  try {
    const registry = JSON.parse(readFileSync(join(root, "conformance/registry.json"), "utf8"));
    const results = registry.tests.map((entry) => ({
      id: entry.id,
      status: entry.status === "implemented" ? "pass" : "planned",
      browser: entry.status === "implemented" ? { completed: false, screenshot: null } : null,
      native: entry.status === "implemented" ? { completed: true, screenshot: "native.png" } : null,
      metrics: { pixelMismatchRatio: null, perceptualDeltaE: null },
      gpuValidationErrors: [],
    }));
    const report = {
      schemaVersion: "0.2.0",
      registrySchemaVersion: registry.schemaVersion,
      threeVersion: registry.threeVersion,
      mode: "execution",
      summary: {
        pass: results.filter((entry) => entry.status === "pass").length,
        fail: 0,
        blocked: 0,
        planned: results.filter((entry) => entry.status === "planned").length,
        validated: 0,
      },
      results,
    };
    const reportPath = join(dir, "invalid-report.json");
    writeFileSync(reportPath, JSON.stringify(report));

    const proc = run(["--validate-report", reportPath]);
    assert.notEqual(proc.status, 0);
    assert.match(
      proc.stderr,
      /completed browser execution|finite pixelMismatchRatio|finite perceptualDeltaE/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ImageMagick Q16 HDRI absolute error is normalized to a pixel ratio", () => {
  assert.equal(absoluteErrorRatio("65535", 100, "ImageMagick 7.1.2-10 Q16-HDRI"), 0.01);
  assert.equal(absoluteErrorRatio("1", 100, "ImageMagick 7.1.2-10 Q16-HDRI"), 0.01);
  assert.ok(Number.isNaN(absoluteErrorRatio("65535", 100, "unknown quantum depth")));
});

test("bounded execution rejects unknown conformance ids before claiming a report", () => {
  const proc = run(["--dry-run", "--only-tests", "not-a-row"]);
  assert.notEqual(proc.status, 0);
  assert.match(proc.stderr, /Unknown --only-tests/u);
});

test("help exits without starting any parity lane", () => {
  const proc = run(["--help"]);
  assert.equal(proc.status, 0, proc.stderr || proc.stdout);
  assert.match(proc.stdout, /--target web\|desktop\|android\|all/u);
  assert.doesNotMatch(proc.stdout, /"wrote"/u);
});

test("execution reports use only pass, fail, or blocked and blocked exits 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "threenative-conformance-"));
  try {
    const out = join(dir, "desktop-report.json");
    const proc = run(
      [
        "--target",
        "desktop",
        "--only-tests",
        "15-mesh-toon-material-gradientmap",
        "--reference",
        join(dir, "missing-reference"),
        "--out",
        out,
      ],
      { THREENATIVE_RUNTIME_BINARY: join(dir, "missing-runtime") },
    );
    assert.equal(proc.status, 2, proc.stderr || proc.stdout);
    const report = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(report.mode, "execution");
    assert.ok(report.results.every(({ status }) => ["pass", "fail", "blocked"].includes(status)));
    assert.ok(report.summary.blocked > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("uniform captures fail closed even when reference and candidate bytes match", () => {
  const uniform = new PNG({ width: 2, height: 1 });
  uniform.data.set([12, 34, 56, 255, 12, 34, 56, 255]);
  const uniformPng = PNG.sync.write(uniform);
  assert.throws(() => inspectCapture(uniformPng), /uniform/u);
  assert.throws(() => compareCaptures(uniformPng, uniformPng), /uniform/u);

  uniform.data.set([12, 34, 56, 255, 13, 34, 56, 255]);
  const visiblePng = PNG.sync.write(uniform);
  assert.deepEqual(compareCaptures(visiblePng, visiblePng), {
    pixelMismatchRatio: 0,
    perceptualDeltaE: 0,
    width: 2,
    height: 1,
  });
});

test("Android conformance override requires an explicit matching bundle hash", () => {
  const dir = mkdtempSync(join(tmpdir(), "threenative-android-conformance-"));
  try {
    const bundle = join(dir, "row.js");
    const output = join(dir, "assets/scripts/main.js");
    writeFileSync(bundle, 'console.info("TN_CONFORMANCE_READY:test");\n');
    const hash = createHash("sha256").update(readFileSync(bundle)).digest("hex");
    assert.throws(() => parseConformanceBundleArgs(["--bundle", bundle]), /requires both/u);
    assert.throws(
      () => buildAndroidConformanceAsset({ bundle, expectedSha256: "0".repeat(64), output }),
      /hash mismatch/u,
    );
    const metadata = buildAndroidConformanceAsset({ bundle, expectedSha256: hash, output });
    assert.equal(metadata.outputSha256, hash);
    assert.deepEqual(readFileSync(output), readFileSync(bundle));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("root parity command and Gradle lane use an explicit checksum-locked override", () => {
  const rootManifest = JSON.parse(readFileSync(join(root, "../../package.json"), "utf8"));
  assert.match(rootManifest.scripts?.parity ?? "", /run-conformance\.mjs/u);
  const gradle = readFileSync(join(root, "android/app/build.gradle.kts"), "utf8");
  assert.match(gradle, /threenativeConformanceBundleSha256/u);
  assert.match(gradle, /buildAndroidConformanceBundle/u);
  assert.match(gradle, /else dependsOn\("buildAndroidFirstProofBundle"\)/u);
});

test("Android screenshot capture preserves PNG bytes", () => {
  const source = readFileSync(runner, "utf8");
  assert.match(
    source,
    /androidArgs\(serial, "exec-out", "screencap", "-p"\),[\s\S]*?binary: true/u,
    "adb screencap must not decode binary PNG output as UTF-8 text",
  );
});

test("Android capture uses reference dimensions and restores the prior display override", () => {
  const source = readFileSync(runner, "utf8");
  assert.match(source, /common\("shell", "wm", "size", "1280x720"\)/u);
  assert.match(source, /displayRestore = \/\^Override size:/u);
  assert.match(source, /finally \{[\s\S]*?displayRestore/u);
  assert.match(
    source,
    /androidArgs\(serial, "shell", "wm", "size", displayRestore\)[\s\S]*?allowFailure: true/u,
  );
});
