import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  analyzeMeasurementLog,
  classifyDevice,
  inspectPackagedBundle,
  inspectPackagedNativeFootprint,
  inspectPackagedRuntime,
  parseArgs,
  parseJsonMarkers,
  parsePeakRssKb,
  percentile,
  requireMeasurementDevice,
  requireInstallForEvidence,
  validateCandidateComparison,
  validateNativeFootprint,
  validateOptimizationProvenance,
  validateReportApkEvidence,
} from "../scripts/measure-android-js-engine.mjs";

const subject = {
  extraDrawControl: false,
  frameWindow: 300,
  materials: "shared",
  meshes: 500,
  pureJsIterations: 20,
  pureJsObjects: 2358,
  visibility: 1,
  visibleMeshes: 500,
  warmupFrames: 60,
};

function nativeLibrary(apkEntry, abi, packagedSha256, sha256, sizes) {
  return {
    abi,
    apkEntry,
    packagedBytes: sizes.packaged,
    packagedSha256,
    sha256,
    strippedBytes: sizes.stripped,
    textBytes: sizes.text,
  };
}

function nativeFootprint(abi, libraries) {
  return {
    abi,
    libraries,
    packagedBytes: libraries.reduce((total, library) => total + library.packagedBytes, 0),
    strippedBytes: libraries.reduce((total, library) => total + library.strippedBytes, 0),
    textBytes: libraries.reduce((total, library) => total + library.textBytes, 0),
  };
}

function cleanLog(overrides = {}, submits = 300) {
  const native = {
    bindingNs: 200_000,
    calls: 441,
    commands: {
      draw: 1,
      drawIndexed: 1,
      setBindGroup: 1,
      setIndexBuffer: 436,
      setPipeline: 1,
      setVertexBuffer: 1,
    },
    engine: "QuickJS",
    presentNs: 50_000,
    submitPollNs: 100_000,
    ...overrides,
  };
  return [
    `I/TN TN_ANDROID_JS_SUBJECT:${JSON.stringify(subject)}`,
    `I/TN TN_ANDROID_JS_PURE:${JSON.stringify({ iterations: 20, medianUsPerObject: 2, objects: 2358, samplesMs: [1, 2, 3, 4, 5] })}`,
    `I/TN TN_ANDROID_JS_WINDOW_START:${JSON.stringify({ frameWindow: 300 })}`,
    ...Array.from(
      { length: submits },
      () => `I/TN TN_ANDROID_JS_NATIVE:${JSON.stringify(native)}`,
    ),
    `I/TN TN_ANDROID_JS_FRAME:${JSON.stringify({ elapsedMs: 6000, frames: 300, msPerFrame: 20 })}`,
  ].join("\n");
}

test("measurement parser splits a complete frame and records engine identity", () => {
  const result = analyzeMeasurementLog(cleanLog(), subject);
  assert.equal(result.native.engine, "QuickJS");
  assert.equal(result.native.callsPerSubmit, 441);
  assert.equal(result.native.callsPerFrame, 441);
  assert.equal(result.native.commandsPerFrame.drawIndexed, 1);
  assert.equal(result.split.boundaryMsPerFrame, 0.2);
  assert.equal(result.split.nativeSubmitPresentMsPerFrame, 0.15);
  assert.equal(result.split.javascriptAndUninstrumentedMsPerFrame, 19.65);
});

test("measurement markers fail closed when missing, duplicate, or malformed", () => {
  assert.throws(() => analyzeMeasurementLog("", subject), /TN_ANDROID_JS_MISSING_MARKER/u);
  assert.throws(
    () => analyzeMeasurementLog(`${cleanLog()}\nTN_ANDROID_JS_FRAME:{"frames":300}`, subject),
    /TN_ANDROID_JS_DUPLICATE_MARKER/u,
  );
  assert.throws(() => parseJsonMarkers("TN_ANDROID_JS_FRAME:{broken", "TN_ANDROID_JS_FRAME:"), /MALFORMED/u);
});

test("engine identity and subject configuration cannot silently drift", () => {
  assert.throws(() => analyzeMeasurementLog(cleanLog({ engine: "" }), subject), /ENGINE_IDENTITY_MISSING/u);
  assert.throws(
    () => analyzeMeasurementLog(cleanLog(), { ...subject, meshes: 600 }),
    /SUBJECT_MISMATCH:meshes/u,
  );
  assert.throws(
    () => analyzeMeasurementLog(cleanLog({ commands: { draw: 441 } }), subject),
    /COMMAND_SCHEMA_MISMATCH/u,
  );
  assert.throws(
    () =>
      analyzeMeasurementLog(
        cleanLog({
          commands: {
            draw: 1,
            drawIndexed: 1,
            setBindGroup: 1,
            setIndexBuffer: 435,
            setPipeline: 1,
            setVertexBuffer: 1,
          },
        }),
        subject,
      ),
    /COMMAND_TOTAL_MISMATCH/u,
  );
});

test("physical acceptance blocks emulators and the wrong phone", () => {
  assert.equal(classifyDevice({ hardware: "ranchu", qemu: "1" }), "emulator");
  assert.throws(
    () => requireMeasurementDevice({ hardware: "ranchu", qemu: "1" }, "emulator-5554"),
    /EMULATOR_BLOCKED/u,
  );
  assert.equal(
    requireMeasurementDevice({ hardware: "ranchu", qemu: "1" }, "emulator-5554", true)
      .acceptanceEligible,
    false,
  );
  assert.throws(
    () => requireMeasurementDevice({ hardware: "tensor", qemu: "0" }, "other-phone"),
    /WRONG_DEVICE/u,
  );
  assert.throws(
    () => requireInstallForEvidence(
      { acceptanceEligible: true },
      { controlReport: null, skipInstall: true },
    ),
    /SKIP_INSTALL_NOT_EVIDENCE_ELIGIBLE/u,
  );
  assert.throws(
    () => requireInstallForEvidence(
      { acceptanceEligible: false },
      { controlReport: "control.json", skipInstall: true },
    ),
    /SKIP_INSTALL_NOT_EVIDENCE_ELIGIBLE/u,
  );
  requireInstallForEvidence(
    { acceptanceEligible: false },
    { controlReport: null, skipInstall: true },
  );
});

test("cold-start p95 uses five first-frame samples and fails closed", () => {
  assert.equal(percentile([105, 101, 104, 102, 103], 0.95), 105);
  assert.throws(() => percentile([], 0.95), /PERCENTILE_EMPTY/u);
  assert.throws(() => percentile([1, Number.NaN], 0.95), /INVALID_NUMBER/u);
  assert.throws(() => percentile([1], 1.1), /PERCENTILE_INVALID/u);

  assert.equal(parseArgs(["--device", "37251FDJH0037Z"]).coldStartRuns, 5);
  assert.equal(
    parseArgs(["--device", "emulator-5554", "--cold-start-runs", "0"]).coldStartRuns,
    0,
  );
  assert.equal(
    parseArgs(["--device", "emulator-5554", "--skip-build", "--skip-install"]).skipInstall,
    true,
  );
  assert.equal(
    parseArgs(["--device", "37251FDJH0037Z", "--skip-build", "--fox-subject"]).foxSubject,
    true,
  );
  assert.throws(
    () => parseArgs(["--device", "37251FDJH0037Z", "--fox-subject"]),
    /fox-subject requires --skip-build/u,
  );
});

test("packaged runtime size is measured after llvm-strip", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "tn-js-engine-size-"));
  const commands = [];
  try {
    const result = inspectPackagedRuntime("fixture.apk", "arm64-v8a", workingDirectory, {
      run(command, args) {
        commands.push([command, ...args]);
        if (command === "llvm-strip") {
          writeFileSync(args[2], Buffer.from("stripped"));
          return "";
        }
        return ".text 3 0\n";
      },
      runBinary() {
        return Buffer.alloc(64, 7);
      },
    });
    assert.equal(result.packagedBytes, 64);
    assert.equal(result.strippedBytes, 8);
    assert.equal(result.textBytes, 3);
    assert.notEqual(result.packagedSha256, result.sha256);
    assert.equal(commands[0][0], "llvm-strip");
    assert.deepEqual(commands[0].slice(1, 4), ["--strip-all", "-o", commands[0][3]]);
    assert.equal(commands[1][0], "llvm-size");
  } finally {
    rmSync(workingDirectory, { force: true, recursive: true });
  }
});

test("packaged bundle hash is read from the archived APK", () => {
  const bundleBytes = Buffer.from("bundle");
  const bundleSha256 = "1e6ed65d77d6364eeaed5a745ba5c4985ae2b700dd85d7cf7f027bdf294a33fc";
  const result = inspectPackagedBundle("fixture.apk", {
    runBinary(_command, args) {
      return args[2].endsWith(".meta.json")
        ? Buffer.from(JSON.stringify({ outputSha256: bundleSha256 }))
        : bundleBytes;
    },
  });
  assert.equal(result.sha256, bundleSha256);
  assert.throws(
    () => inspectPackagedBundle("fixture.apk", {
      runBinary(_command, args) {
        return args[2].endsWith(".meta.json")
          ? Buffer.from(JSON.stringify({ outputSha256: "0".repeat(64) }))
          : bundleBytes;
      },
    }),
    /BUNDLE_METADATA_MISMATCH/u,
  );
});

test("native footprint includes every packaged shared library", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "tn-js-engine-footprint-"));
  try {
    const result = inspectPackagedNativeFootprint("fixture.apk", "arm64-v8a", workingDirectory, {
      run(command, args) {
        if (command === "unzip") {
          return [
            "lib/arm64-v8a/libmystral-runtime.so",
            "lib/arm64-v8a/libv8android.so",
            "lib/x86_64/libignored.so",
          ].join("\n");
        }
        if (command === "llvm-strip") {
          writeFileSync(args[2], Buffer.alloc(args[3].includes("libv8android") ? 7 : 5));
          return "";
        }
        return args[1].includes("libv8android") ? ".text 3 0\n" : ".text 2 0\n";
      },
      runBinary(_command, args) {
        return Buffer.alloc(args[2].includes("libv8android") ? 11 : 9);
      },
    });
    assert.equal(result.libraries.length, 2);
    assert.equal(result.packagedBytes, 20);
    assert.equal(result.strippedBytes, 12);
    assert.equal(result.textBytes, 5);
  } finally {
    rmSync(workingDirectory, { force: true, recursive: true });
  }
});

test("peak RSS comes from the kernel high-water mark, not dumpsys PSS", () => {
  assert.equal(parsePeakRssKb("VmRSS:\t100 kB\nVmHWM:\t269440 kB\n"), 269440);
  assert.throws(() => parsePeakRssKb("TOTAL 110780 0 0 0\n"), /PEAK_RSS_MISSING/u);
  assert.throws(() => parsePeakRssKb("VmHWM:\t0 kB\n"), /PEAK_RSS_INVALID/u);
});

test("candidate comparison fixes engine, bundle, runtime, device, and denominator", () => {
  const controlRuntime = nativeLibrary(
    "lib/arm64-v8a/libmystral-runtime.so",
    "arm64-v8a",
    "a".repeat(64),
    "b".repeat(64),
    { packaged: 30_000_000, stripped: 20_000_000, text: 12_000_000 },
  );
  const candidateRuntime = nativeLibrary(
    "lib/arm64-v8a/libmystral-runtime.so",
    "arm64-v8a",
    "c".repeat(64),
    "d".repeat(64),
    { packaged: 31_000_000, stripped: 21_000_000, text: 13_000_000 },
  );
  const v8Library = nativeLibrary(
    "lib/arm64-v8a/libv8android.so",
    "arm64-v8a",
    "e".repeat(64),
    "f".repeat(64),
    { packaged: 15_500_000, stripped: 15_000_000, text: 10_000_000 },
  );
  const control = {
    acceptanceEligible: true,
    analysis: { native: { engine: "QuickJS" } },
    bundleSha256: "bundle",
    device: { properties: { abi: "arm64-v8a" }, serial: "37251FDJH0037Z" },
    nativeFootprint: nativeFootprint("arm64-v8a", [controlRuntime]),
    cleanBuildWallClockMs: null,
    coldStart: { p95Ms: 105, runs: 5, samplesMs: [101, 102, 103, 104, 105] },
    nativeBuild: { artifactSha256: controlRuntime.packagedSha256, optimization: "-O2" },
    runtimeLibrary: controlRuntime,
  };
  const candidate = {
    ...control,
    analysis: { native: { engine: "V8" } },
    cleanBuildWallClockMs: 123_456,
    nativeBuild: { artifactSha256: candidateRuntime.packagedSha256, optimization: "-O2" },
    nativeFootprint: nativeFootprint("arm64-v8a", [candidateRuntime, v8Library]),
    runtimeLibrary: candidateRuntime,
  };
  assert.equal(validateCandidateComparison(control, candidate, "V8").candidateEngine, "V8");
  assert.throws(
    () => validateCandidateComparison({ ...control, provisional: ["battery"] }, candidate, "V8"),
    /PROVISIONAL_COMPARISON/u,
  );
  assert.throws(
    () => validateCandidateComparison(control, { ...candidate, bundleSha256: "changed" }, "V8"),
    /TWO_VARIABLES/u,
  );
  assert.throws(
    () => validateCandidateComparison(control, {
      ...candidate,
      runtimeLibrary: { ...candidateRuntime, sha256: controlRuntime.sha256 },
    }, "V8"),
    /RUNTIME_LIBRARY_UNCHANGED/u,
  );
  assert.throws(
    () => validateCandidateComparison(control, { ...candidate, analysis: { native: { engine: "QuickJS" } } }, "V8"),
    /ENGINE_IDENTITY_MISMATCH/u,
  );
  assert.throws(
    () => validateCandidateComparison({ ...control, nativeBuild: { optimization: "-O0" } }, candidate, "V8"),
    /WRONG_DENOMINATOR/u,
  );
  assert.throws(
    () => validateCandidateComparison(control, {
      ...candidate,
      nativeBuild: { artifactSha256: candidateRuntime.packagedSha256, optimization: "-O0" },
    }, "V8"),
    /CANDIDATE_NOT_O2/u,
  );
  assert.throws(
    () => validateCandidateComparison(control, { ...candidate, coldStart: null }, "V8"),
    /CANDIDATE_COLD_START/u,
  );
  assert.throws(
    () => validateCandidateComparison(control, { ...candidate, cleanBuildWallClockMs: null }, "V8"),
    /CANDIDATE_CLEAN_BUILD/u,
  );
  assert.throws(
    () => validateCandidateComparison(control, { ...candidate, nativeFootprint: null }, "V8"),
    /CANDIDATE_NATIVE_FOOTPRINT/u,
  );
  assert.throws(
    () => validateCandidateComparison(control, {
      ...candidate,
      nativeFootprint: { ...candidate.nativeFootprint, strippedBytes: 1 },
    }, "V8"),
    /NATIVE_FOOTPRINT_TOTAL/u,
  );
  assert.throws(
    () => validateNativeFootprint({
      ...candidate,
      nativeFootprint: nativeFootprint("arm64-v8a", [candidateRuntime]),
    }, "CANDIDATE", "V8"),
    /ENGINE_MISSING/u,
  );
  assert.throws(
    () => validateNativeFootprint({
      ...candidate,
      device: { ...candidate.device, properties: { abi: "x86_64" } },
    }, "CANDIDATE", "V8"),
    /CANDIDATE_NATIVE_FOOTPRINT/u,
  );
  const forgedRuntime = { ...controlRuntime, apkEntry: "lib/arm64-v8a/libSDL3.so" };
  assert.throws(
    () => validateNativeFootprint({
      ...control,
      nativeFootprint: nativeFootprint("arm64-v8a", [forgedRuntime]),
      runtimeLibrary: forgedRuntime,
    }, "CONTROL", "QuickJS"),
    /RUNTIME_MISMATCH/u,
  );
});

test("archived APK evidence is bound to its footprint", () => {
  const apkBytes = Buffer.from("apk");
  const footprint = { abi: "arm64-v8a", libraries: [], packagedBytes: 0, strippedBytes: 0, textBytes: 0 };
  const bundle = { apkEntry: "assets/scripts/main.js", bytes: 6, sha256: "1".repeat(64) };
  const report = {
    apkBytes: apkBytes.length,
    apkSha256: "dd37c2d7274f7ea982cb83390c36918fee9ce8889073c44b68cdc00bdb8c3e04",
    bundle,
    bundleSha256: bundle.sha256,
    nativeFootprint: footprint,
    runtimeLibrary: { apkEntry: "lib/arm64-v8a/libmystral-runtime.so" },
  };
  validateReportApkEvidence(report, apkBytes, footprint, report.runtimeLibrary, bundle);
  assert.throws(
    () => validateReportApkEvidence(
      { ...report, apkSha256: "0".repeat(64) },
      apkBytes,
      footprint,
      report.runtimeLibrary,
      bundle,
    ),
    /APK_HASH_MISMATCH/u,
  );
  assert.throws(
    () => validateReportApkEvidence(
      report,
      apkBytes,
      { ...footprint, packagedBytes: 1 },
      report.runtimeLibrary,
      bundle,
    ),
    /APK_FOOTPRINT_MISMATCH/u,
  );
  assert.throws(
    () => validateReportApkEvidence(
      report,
      apkBytes,
      footprint,
      { apkEntry: "lib/arm64-v8a/libSDL3.so" },
      bundle,
    ),
    /APK_RUNTIME_MISMATCH/u,
  );
  assert.throws(
    () => validateReportApkEvidence(
      { ...report, apkBytes: 1 },
      apkBytes,
      footprint,
      report.runtimeLibrary,
      bundle,
    ),
    /APK_HASH_MISMATCH/u,
  );
  assert.throws(
    () => validateReportApkEvidence(
      report,
      apkBytes,
      footprint,
      report.runtimeLibrary,
      { ...bundle, sha256: "2".repeat(64) },
    ),
    /APK_BUNDLE_MISMATCH/u,
  );
});

test("optimization provenance is tied to the exact packaged runtime", () => {
  const optimized = {
    buildNinja: "active/build.ninja",
    nativeLibrary: "active/libmystral-runtime.so",
    optimization: "-O2",
    sha256: "packaged",
  };
  assert.equal(
    validateOptimizationProvenance("packaged", [
      { ...optimized, optimization: "other", sha256: "stale-o0" },
      optimized,
    ]).artifactSha256,
    "packaged",
  );
  assert.throws(
    () => validateOptimizationProvenance("packaged", [{ ...optimized, sha256: "stale-o2" }]),
    /O2_PROVENANCE_MISSING/u,
  );
  assert.throws(
    () => validateOptimizationProvenance("packaged", [{ ...optimized, optimization: "other" }]),
    /O2_PROVENANCE_AMBIGUOUS/u,
  );
  assert.throws(
    () => validateOptimizationProvenance("packaged", [optimized, { ...optimized, optimization: "other" }]),
    /O2_PROVENANCE_AMBIGUOUS/u,
  );
});
