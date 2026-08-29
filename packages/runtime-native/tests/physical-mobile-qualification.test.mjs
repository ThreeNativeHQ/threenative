import { makeTempDirSync, makeTempDirSyncAt } from '../../../test-support/temp-dir.js';
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import {
  REQUIRED_GATE_IDS,
  createEvidenceFixture,
  hashIdentifier,
  sha256File,
  validatePhysicalDeviceEvidence,
} from "../scripts/physical-device-evidence.mjs";
import {
  buildProductionEvidence,
  classifyPhysicalDevice,
  collectAndroidTelemetry,
  collectIosTelemetry,
  evaluateLifecycleObservation,
  findExecutable,
  parsePlaytestReport,
  parseArgs,
  preflight,
  qualifyPhysicalMobile,
  readArtifactProvenance,
  sampleOffsets,
  validatePrerequisiteReport,
  verifyAndroidArtifact,
} from "../scripts/qualify-physical-mobile.mjs";

const runtimeRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const LANE_CANDIDATE_SHA = "8bcf0553f38655b8db425d64f37cd19ff4db7034";
const ARTIFACT_SHA = "b".repeat(64);
const REPORT_SHA = "c".repeat(64);
const DEVICE_IDENTIFIER = "physical-056";
const DEVICE_IDENTIFIER_HASH = hashIdentifier(DEVICE_IDENTIFIER);

test("physical qualification uses the shared adb and device libraries", () => {
  const source = readFileSync(
    new URL("../scripts/qualify-physical-mobile.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /from "\.\/lib\/adb\.mjs"/u);
  assert.match(source, /from "\.\/lib\/device\.mjs"/u);
  assert.doesNotMatch(source, /\["-s", serial/u);
});

test("regular Android qualification runs shared device safeguards in order", () => {
  const directory = makeTempDirSync("tn-qualification-adopter-");
  try {
    const app = join(directory, "candidate.apk");
    const out = join(workspaceRoot, ".runtime/prd056/shared-device-adopter");
    writeFileSync(app, "signed candidate bytes");
    const artifactSha256 = sha256File(app);
    writeFileSync(
      `${app}.provenance.json`,
      JSON.stringify({
        schemaVersion: 1,
        platform: "android",
        sourceSha: LANE_CANDIDATE_SHA,
        artifactSha256,
        packageVersion: "0.1.13",
        signing: {
          applicationId: "com.threenative.game",
          certificateFingerprint: "d".repeat(64),
          debuggable: false,
          expiresAt: "2027-08-09T00:00:00.000Z",
          signerId: "CN=Observed signer",
        },
      }),
    );
    mkdirSync(out, { recursive: true });
    const gateEvidence = join(directory, "gates.json");
    writeFileSync(gateEvidence, JSON.stringify(productionGateEvidence()));
    const overrides = Object.fromEntries(
      ["prd053", "prd054", "prd046", "prd048"].map((name) => [name, { artifactSha256 }]),
    );
    withPrerequisiteReports((prerequisiteReports) => {
      const calls = [];
      let clock = Date.parse("2026-08-09T01:00:00.000Z");
      const deviceOutput = (args) => {
        const adbArgs = args.slice(2);
        const operation = adbArgs.join(" ");
        calls.push(operation);
        if (operation === "get-state") return "device\n";
        if (operation === "shell dumpsys battery") return "AC powered: false\nUSB powered: false\nWireless powered: false\nstatus: 3\nlevel: 88\n";
        if (operation === "shell dumpsys thermalservice") return "Thermal Status: 0\n";
        if (operation === "shell dumpsys power") return "mScreenOn=true\n";
        if (operation === "shell dumpsys display") return "mSupportedRefreshRates=[120.0, 60.0]\nmActiveSfDisplayMode=DisplayMode{id=0, peakRefreshRate=60.0}\n";
        if (operation.startsWith("shell settings get")) return "0\n";
        if (operation.startsWith("shell settings put")) return "";
        if (operation.endsWith("getprop ro.kernel.qemu")) return "0\n";
        if (operation.endsWith("getprop ro.hardware")) return "tensor\n";
        if (operation.endsWith("getprop ro.product.cpu.abi")) return "arm64-v8a\n";
        if (operation.endsWith("getprop ro.product.name")) return "husky\n";
        if (operation.endsWith("getprop ro.product.manufacturer")) return "Google\n";
        if (operation.endsWith("getprop ro.product.model")) return "Pixel 8 Pro\n";
        if (operation.endsWith("getprop ro.build.version.release")) return "15\n";
        if (operation.endsWith("getprop ro.build.id")) return "AP4A.250000.000\n";
        if (operation === "shell dumpsys SurfaceFlinger") return "GLES: Adreno physical Vulkan\n";
        if (operation === "shell wm size") return "Physical size: 2340x1080\n";
        if (operation.startsWith("install --no-streaming")) return "Success\n";
        if (operation === "shell pm path com.threenative.game") return "package:/data/app/com.threenative.game/base.apk\n";
        if (operation.startsWith("shell am start")) return "Status: ok\n";
        if (operation === "shell pidof com.threenative.game") return "7123\n";
        if (operation.includes("dumpsys gfxinfo")) return "Flags,IntendedVsync,FrameCompleted\n0,1000000000,1012500000\n";
        if (operation.includes("dumpsys meminfo")) return "TOTAL 2048\n";
        throw new Error(`unexpected adb operation: ${operation}`);
      };
      const command = (executable, args) => {
        if (executable === "apksigner") return { status: 0, stdout: `certificate SHA-256 digest: ${"d".repeat(64)}`, stderr: "" };
        if (executable === "unzip") return { status: 0, stdout: "lib/arm64-v8a/libnative.so", stderr: "" };
        if (executable === "adb") return { status: 0, stdout: deviceOutput(args), stderr: "" };
        mkdirSync(join(out, "playtest"), { recursive: true });
        writeFileSync(join(out, "playtest/after.png"), "non-blank capture");
        const state = productionLifecycleState();
        return {
          status: 0,
          stdout: JSON.stringify({
            pass: true,
            assertionResults: [{ id: "lifecycle", pass: true }],
            diagnostics: [],
            observations: {
              resources: { GameState: { before: { sessionNonce: state.sessionNonce }, after: state } },
              runtimeDiagnostics: { recentRuntimeErrors: [] },
            },
          }),
          stderr: "",
        };
      };
      const result = qualifyPhysicalMobile(
        {
          app,
          artifactProvenance: `${app}.provenance.json`,
          cadenceMs: 50,
          candidateSha: LANE_CANDIDATE_SHA,
          control: null,
          device: DEVICE_IDENTIFIER,
          durationMs: 100,
          gateEvidence,
          out,
          platform: "android",
          prerequisiteReports,
        },
        {
          command,
          findExecutable: (name) => name,
          now: () => clock,
          sleep: (duration) => {
            clock += duration;
          },
          source: sourceIdentity(),
        },
      );
      assert.deepEqual(result, {
        code: "TN_QUALIFY_PHYSICAL_PASS",
        report: join(out, "physical-device-evidence.json"),
        status: "pass",
      });
      const positions = [
        "get-state",
        "shell settings put global package_verifier_enable 0",
        `install --no-streaming ${app}`,
        "shell pm path com.threenative.game",
        "shell am start -W -n com.threenative.game/com.threenative.runtime.MystralActivity",
      ].map((operation) => calls.indexOf(operation));
      assert.ok(positions.every((position) => position >= 0));
      assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
    }, overrides);
  } finally {
    rmSync(directory, { force: true, recursive: true });
    rmSync(join(workspaceRoot, ".runtime/prd056/shared-device-adopter"), {
      force: true,
      recursive: true,
    });
  }
});

function controlEvidence(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `control-${index + 1}`,
    status: "fail",
    command: `control-${index + 1}`,
    observedRed: `RED observed: control-${index + 1} rejected`,
    exitCode: 1,
    reportSha256: REPORT_SHA,
  }));
}

function prerequisiteReport(name, {
  target = "android",
  candidateSha = LANE_CANDIDATE_SHA,
  artifactSha256 = ARTIFACT_SHA,
  deviceIdentifierHash = DEVICE_IDENTIFIER_HASH,
  controls = name === "prd046" ? 3 : 1,
  overrides = {},
} = {}) {
  const report = {
    schemaVersion: 1,
    reportType: name,
    status: "pass",
    candidateSha,
    target,
    device: { kind: "physical", platform: target, identifierHash: deviceIdentifierHash },
    artifactSha256,
    negativeControls: controlEvidence(controls),
    consumption: {},
  };
  if (name === "prd053") report.consumption.multitouch = {
    status: "pass",
    reportPath: `.runtime/prd056/${target}/prd053.json`,
    reportSha256: REPORT_SHA,
    candidateSha,
    deviceClass: "physical",
    maxPointers: 2,
    simultaneousMovementAndJump: true,
    onePointerControl: { status: "fail", exitCode: 1, observedRed: "RED observed: one-pointer control rejected", reportSha256: REPORT_SHA },
  };
  if (name === "prd046") report.consumption.physics = {
    status: "pass",
    reportPath: `.runtime/prd056/${target}/prd046.json`,
    reportSha256: REPORT_SHA,
    candidateSha,
    deviceClass: "physical",
    normalPublicApi: true,
    wrongGravityControl: { status: "fail", exitCode: 1, observedRed: "RED observed: wrong gravity rejected", reportSha256: REPORT_SHA },
    wrongHeightControl: { status: "fail", exitCode: 1, observedRed: "RED observed: wrong height rejected", reportSha256: REPORT_SHA },
    wrongMaskControl: { status: "fail", exitCode: 1, observedRed: "RED observed: wrong mask rejected", reportSha256: REPORT_SHA },
  };
  return { ...report, ...overrides };
}

function sourceIdentity() {
  return { remote: "origin", branch: "linchpin/prd-056-physical-mobile-qualification", headSha: LANE_CANDIDATE_SHA, worktree: "clean", packageVersion: "0.1.13" };
}

function withPrerequisiteReports(callback, overrides = {}) {
  // `.runtime/` is untracked by design, so a fresh checkout does not have it and `mkdtemp` fails
  // with ENOENT on the parent rather than on anything about this test.
  mkdirSync(join(workspaceRoot, ".runtime"), { recursive: true });
  const directory = makeTempDirSyncAt(join(workspaceRoot, ".runtime/prd056-prerequisites-"));
  const paths = {};
  try {
    for (const name of ["prd053", "prd054", "prd046", "prd048"]) {
      const report = prerequisiteReport(name, overrides[name]);
      const path = join(directory, `${name}.json`);
      writeFileSync(path, `${JSON.stringify(report)}\n`);
      paths[name] = path;
    }
    return callback(paths, directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function productionLifecycleState(sessionNonce = "native-smoke-real") {
  return {
    backgroundGapIntegrated: false,
    frames: 420,
    framesAdvanced: true,
    framesPaused: true,
    lifecycleEvents: ["background", "foreground", "supported-rotation", "resume"].map((phase, index) => ({
      at: `2026-08-09T01:00:${String(index + 1).padStart(2, "0")}.000Z`,
      frameCount: 320 + index,
      phase,
      physicsStepCount: 10,
      surfaceValid: phase !== "background",
      viewport: { width: 2340, height: 1080 },
    })),
    maxFrameIntervalMs: 31.25,
    physicsStepDelta: 0,
    sessionNonce,
    stateContinuity: true,
    surfaceValidAfterResume: true,
  };
}

function productionGateEvidence() {
  return REQUIRED_GATE_IDS.map((gateId) => ({
    gateId,
    finalResult: "pass",
    negativeControlCommand: `native:qualify:physical --control ${gateId}`,
    redObservation: `RED observed: ${gateId} rejected malformed input`,
    exitCode: 1,
  }));
}

test("a complete physicalDeviceEvidenceV1 fixture validates without coercing values", () => {
  const evidence = createEvidenceFixture();
  const result = validatePhysicalDeviceEvidence(evidence);
  assert.deepEqual(result, { valid: true, errors: [] });
  assert.equal(evidence.device.identifierHash, hashIdentifier("physical-device-056"));
  assert.equal(evidence.telemetry.memory.available, true);
  assert.equal(evidence.gateEvidence.length, REQUIRED_GATE_IDS.length);
});

test("should reject incomplete or unknown physical evidence fields", () => {
  const evidence = createEvidenceFixture();
  delete evidence.telemetry.memory;
  evidence.telemetry.unknownCollector = { available: true };
  const result = validatePhysicalDeviceEvidence(evidence);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("telemetry.memory")));
  assert.ok(result.errors.some((error) => error.includes("telemetry.unknownCollector")));
  assert.ok(!result.errors.some((error) => error.includes("coerc")));
});

test("should block Android emulator identity when hardware is required", () => {
  assert.deepEqual(classifyPhysicalDevice("android", "emulator-5554"), {
    kind: "emulator",
    code: "TN_QUALIFY_PHYSICAL_DEVICE_REQUIRED",
  });
  const result = qualifyPhysicalMobile({
    platform: "android",
    device: "emulator-5554",
    app: "/tmp/unsigned.apk",
    control: "reject-nonphysical",
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.code, "TN_QUALIFY_PHYSICAL_DEVICE_REQUIRED");
});

test("should block iOS simulator identity when hardware is required", () => {
  assert.deepEqual(classifyPhysicalDevice("ios", "booted"), {
    kind: "simulator",
    code: "TN_QUALIFY_PHYSICAL_DEVICE_REQUIRED",
  });
  const result = qualifyPhysicalMobile({
    platform: "ios",
    device: "booted",
    app: "/tmp/unsigned.app",
    control: "reject-nonphysical",
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.code, "TN_QUALIFY_PHYSICAL_DEVICE_REQUIRED");
});

test("should reject artifact and prerequisite reports from another SHA", () => {
  const evidence = createEvidenceFixture();
  evidence.prerequisites.prd054.candidateSha = "e38439c";
  const result = validatePhysicalDeviceEvidence(evidence);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("prerequisite candidate SHA mismatch")));
  assert.ok(result.errors.some((error) => error.includes("prerequisites.prd054.candidateSha")));
});

test("parses the final pretty multi-line playtest JSON report after diagnostics", () => {
  const stdout = [
    "native runner: preparing device",
    JSON.stringify({ pass: false, diagnostics: [{ message: "intermediate" }] }, null, 2),
    JSON.stringify({
      pass: true,
      assertionResults: [{ id: "lifecycle", pass: true }],
      observations: { resources: { GameState: { after: { frames: 420 } } } },
    }, null, 2),
  ].join("\n");
  assert.deepEqual(parsePlaytestReport(stdout), {
    pass: true,
    assertionResults: [{ id: "lifecycle", pass: true }],
    observations: { resources: { GameState: { after: { frames: 420 } } } },
  });
  assert.equal(parsePlaytestReport("diagnostic only\n"), null);
});

test("production evidence is built from supplied observations, never fixture lifecycle or telemetry", () => {
  withPrerequisiteReports((paths, directory) => {
    const reportRecords = Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, {
      path,
      report: JSON.parse(readFileSync(path, "utf8")),
      validation: validatePrerequisiteReport(name, JSON.parse(readFileSync(path, "utf8")), {
        candidateSha: LANE_CANDIDATE_SHA,
        platform: "android",
        deviceIdentifierHash: DEVICE_IDENTIFIER_HASH,
        artifactSha256: ARTIFACT_SHA,
      }),
      sha256: sha256File(path),
    }]));
    const capturePath = join(directory, "after.png");
    const playtestPath = join(directory, "playtest-report.json");
    writeFileSync(capturePath, "real capture bytes");
    writeFileSync(playtestPath, "real playtest observation");
    const state = productionLifecycleState();
    const evidence = buildProductionEvidence({
      platform: "android",
      source: sourceIdentity(),
      artifact: { sourceSha: LANE_CANDIDATE_SHA, artifactSha256: ARTIFACT_SHA, packageVersion: "0.1.13", releaseRun: null },
      device: {
        platform: "android",
        kind: "physical",
        identifierHash: DEVICE_IDENTIFIER_HASH,
        name: "Observed OEM phone",
        manufacturer: "Observed OEM",
        model: "Observed arm64",
        osVersion: "15",
        osBuild: "AP4A.250000.000",
        cpuAbi: "arm64-v8a",
        gpu: "Adreno physical Vulkan",
        driver: "Android Vulkan driver",
        screenModes: [{ width: 2340, height: 1080, orientation: "landscape" }],
        nativeGpu: true,
      },
      signing: {
        verificationCommand: "apksigner verify --print-certs supplied.apk",
        signerId: "CN=Observed signer",
        certificateFingerprint: "d".repeat(64),
        profileFingerprint: null,
        expiresAt: "2027-08-09T00:00:00.000Z",
        applicationId: "com.threenative.game",
        debuggable: false,
      },
      preflightResult: { source: sourceIdentity(), prerequisites: reportRecords },
      playtestRun: {
        report: {
          pass: true,
          assertionResults: [{ id: "lifecycle", pass: true }],
          diagnostics: [],
          observations: {
            resources: { GameState: { before: { sessionNonce: state.sessionNonce }, after: state } },
            runtimeDiagnostics: { recentRuntimeErrors: [] },
          },
        },
      },
      telemetry: {
        durationMs: 300,
        cadenceMs: 100,
        frame: { available: true, source: "observed frame collector", unit: "ms", samples: [{ at: "2026-08-09T01:00:00.000Z", value: 12.5 }, { at: "2026-08-09T01:00:00.100Z", value: 13.25 }], error: null },
        memory: { available: true, source: "observed memory collector", unit: "bytes", samples: [{ at: "2026-08-09T01:00:00.000Z", value: 2000000 }, { at: "2026-08-09T01:00:00.100Z", value: 2100000 }], error: null },
        thermal: { available: true, source: "observed thermal collector", unit: "state", samples: [{ at: "2026-08-09T01:00:00.000Z", value: "nominal" }, { at: "2026-08-09T01:00:00.100Z", value: "nominal" }], error: null },
        battery: { available: true, source: "observed battery collector", unit: "percent", samples: [{ at: "2026-08-09T01:00:00.000Z", value: 88 }, { at: "2026-08-09T01:00:00.100Z", value: 87 }], error: null },
      },
      pid: 7123,
      processLiveness: true,
      timestamps: {
        startedAt: "2026-08-09T01:00:00.000Z",
        endedAt: "2026-08-09T01:00:30.000Z",
        installStartedAt: "2026-08-09T01:00:00.000Z",
        launchStartedAt: "2026-08-09T01:00:01.000Z",
        readyAt: "2026-08-09T01:00:02.000Z",
        firstFrameAt: "2026-08-09T01:00:02.100Z",
        frame300At: "2026-08-09T01:00:07.000Z",
      },
      artifactPaths: [
        { path: ".runtime/prd056/test/playtest-report.json", sha256: sha256File(playtestPath), size: 24, producerCommand: "playtest", retention: "ignored-raw" },
        { path: ".runtime/prd056/test/after.png", sha256: sha256File(capturePath), size: 18, producerCommand: "playtest", retention: "ignored-raw", capture: true },
      ],
      gateEvidence: productionGateEvidence(),
    });
    assert.equal(evidence.execution.sessionNonce, "native-smoke-real");
    assert.equal(evidence.execution.frames, 420);
    assert.equal(evidence.telemetry.frame.samples[0].value, 12.5);
    assert.notEqual(evidence.execution.sessionNonce, "fixture-session-android");
    assert.notEqual(evidence.telemetry.memory.samples[0].value, 1000000);
    assert.equal(evidence.source.artifactSourceSha, LANE_CANDIDATE_SHA);
  });
});

test("prerequisite reports fail closed for stale SHA, wrong target/device, wrong artifact, and missing controls", () => {
  const base = prerequisiteReport("prd053");
  assert.equal(validatePrerequisiteReport("prd053", base, { candidateSha: LANE_CANDIDATE_SHA, platform: "android", deviceIdentifierHash: DEVICE_IDENTIFIER_HASH, artifactSha256: ARTIFACT_SHA }).valid, true);
  const stale = validatePrerequisiteReport("prd053", { ...base, candidateSha: "e38439c" }, { candidateSha: LANE_CANDIDATE_SHA, platform: "android", deviceIdentifierHash: DEVICE_IDENTIFIER_HASH, artifactSha256: ARTIFACT_SHA });
  assert.ok(stale.errors.some((error) => error.includes("candidateSha")));
  const wrongTarget = validatePrerequisiteReport("prd053", { ...base, target: "ios", device: { ...base.device, platform: "ios" } }, { candidateSha: LANE_CANDIDATE_SHA, platform: "android", deviceIdentifierHash: DEVICE_IDENTIFIER_HASH, artifactSha256: ARTIFACT_SHA });
  assert.ok(wrongTarget.errors.some((error) => error.includes("target")));
  const wrongDevice = validatePrerequisiteReport("prd053", { ...base, device: { ...base.device, identifierHash: hashIdentifier("another-device") } }, { candidateSha: LANE_CANDIDATE_SHA, platform: "android", deviceIdentifierHash: DEVICE_IDENTIFIER_HASH, artifactSha256: ARTIFACT_SHA });
  assert.ok(wrongDevice.errors.some((error) => error.includes("identifierHash")));
  const wrongArtifact = validatePrerequisiteReport("prd053", { ...base, artifactSha256: "e".repeat(64) }, { candidateSha: LANE_CANDIDATE_SHA, platform: "android", deviceIdentifierHash: DEVICE_IDENTIFIER_HASH, artifactSha256: ARTIFACT_SHA });
  assert.ok(wrongArtifact.errors.some((error) => error.includes("artifactSha256")));
  const missingControls = validatePrerequisiteReport("prd053", { ...base, negativeControls: [] }, { candidateSha: LANE_CANDIDATE_SHA, platform: "android", deviceIdentifierHash: DEVICE_IDENTIFIER_HASH, artifactSha256: ARTIFACT_SHA });
  assert.ok(missingControls.errors.some((error) => error.includes("negativeControls")));
});

test("preflight consumes the complete exact-candidate prerequisite set", () => {
  withPrerequisiteReports((paths, directory) => {
    const app = join(directory, "candidate.apk");
    writeFileSync(app, "candidate bytes");
    const options = {
      platform: "android",
      device: DEVICE_IDENTIFIER,
      app,
      candidateSha: LANE_CANDIDATE_SHA,
      out: join(workspaceRoot, ".runtime/prd056/preflight"),
      prerequisiteReports: paths,
    };
    const valid = preflight(options, { source: sourceIdentity(), artifactSha256: ARTIFACT_SHA, artifactSourceSha: LANE_CANDIDATE_SHA });
    assert.equal(valid.status, "pass");
    assert.deepEqual(Object.keys(valid.prerequisites).sort(), ["prd046", "prd048", "prd053", "prd054"]);
  });
  withPrerequisiteReports((paths, directory) => {
    const app = join(directory, "candidate.apk");
    writeFileSync(app, "candidate bytes");
    const result = preflight({
      platform: "android",
      device: DEVICE_IDENTIFIER,
      app,
      candidateSha: LANE_CANDIDATE_SHA,
      out: join(workspaceRoot, ".runtime/prd056/preflight"),
      prerequisiteReports: paths,
    }, { source: sourceIdentity(), artifactSha256: ARTIFACT_SHA, artifactSourceSha: LANE_CANDIDATE_SHA });
    assert.equal(result.status, "blocked");
    assert.ok(result.blockers.some((blocker) => blocker.includes("prd054.candidateSha")));
  }, { prd054: { candidateSha: "e38439c" } });
});

test("artifact provenance is derived from the supplied artifact bytes and rejects a wrong artifact", () => {
  const directory = makeTempDirSync("prd056-artifact-");
  try {
    const artifactPath = join(directory, "candidate.apk");
    writeFileSync(artifactPath, "signed artifact bytes");
    const artifactSha = sha256File(artifactPath);
    const provenancePath = `${artifactPath}.provenance.json`;
    writeFileSync(provenancePath, JSON.stringify({
      schemaVersion: 1,
      platform: "android",
      sourceSha: LANE_CANDIDATE_SHA,
      artifactSha256: artifactSha,
      packageVersion: "0.1.13",
      signing: { signerId: "Observed signer", certificateFingerprint: "d".repeat(64), profileFingerprint: null, expiresAt: "2027-08-09T00:00:00.000Z", applicationId: "com.threenative.game", debuggable: false },
    }));
    const verifiedArtifact = verifyAndroidArtifact(artifactPath, LANE_CANDIDATE_SHA, {
      artifactProvenance: provenancePath,
      findExecutable: (name) => name,
      command: (executable) => executable === "apksigner"
        ? { status: 0, stdout: `certificate SHA-256 digest: ${"d".repeat(64)}`, stderr: "" }
        : { status: 0, stdout: "lib/arm64-v8a/libnative.so", stderr: "" },
    });
    assert.equal(verifiedArtifact.sourceSha, LANE_CANDIDATE_SHA);
    assert.equal(verifiedArtifact.artifactSha256, artifactSha);
    const provenance = readArtifactProvenance(artifactPath, { platform: "android", candidateSha: LANE_CANDIDATE_SHA, artifactSha256: artifactSha });
    assert.equal(provenance.sourceSha, LANE_CANDIDATE_SHA);
    assert.equal(provenance.artifactSha256, artifactSha);
    assert.throws(() => readArtifactProvenance(artifactPath, { platform: "android", candidateSha: LANE_CANDIDATE_SHA, artifactSha256: "f".repeat(64) }), /Artifact SHA mismatch/iu);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Android telemetry sampling is bounded, uses observed frame intervals, and records battery start/end", () => {
  let now = Date.parse("2026-08-09T02:00:00.000Z");
  const calls = [];
  const command = (_executable, args) => {
    calls.push(args);
    if (args.includes("gfxinfo")) return { status: 0, stdout: "Flags,IntendedVsync,FrameCompleted\n0,1000000000,1012500000\n", stderr: "" };
    if (args.includes("meminfo")) return { status: 0, stdout: "TOTAL 2048\n", stderr: "" };
    if (args.includes("thermalservice")) return { status: 0, stdout: "Status: nominal\n", stderr: "" };
    return { status: 0, stdout: `level: ${90 - Math.floor((now - Date.parse("2026-08-09T02:00:00.000Z")) / 100)}\n`, stderr: "" };
  };
  const telemetry = collectAndroidTelemetry("adb", DEVICE_IDENTIFIER, 250, 100, {
    command,
    now: () => now,
    sleep: (duration) => { now += duration; },
  });
  assert.deepEqual(sampleOffsets(250, 100), [0, 100, 200, 250]);
  assert.equal(calls.length, 16);
  assert.equal(telemetry.frame.available, true);
  assert.equal(telemetry.frame.samples.length, 4);
  assert.equal(telemetry.frame.samples[0].value, 12.5);
  assert.notEqual(telemetry.frame.samples[0].value, 16.7);
  assert.equal(telemetry.memory.samples.length, 4);
  assert.equal(telemetry.battery.samples.length, 4);
  assert.equal(telemetry.battery.samples[0].at, "2026-08-09T02:00:00.000Z");
  assert.equal(telemetry.battery.samples.at(-1).at, "2026-08-09T02:00:00.250Z");
});

test("iOS signed-device telemetry has a guarded unavailable path and a valid bridge path", () => {
  const blocked = collectIosTelemetry({ durationMs: 200, cadenceMs: 100 });
  assert.equal(blocked.frame.available, false);
  assert.match(blocked.frame.error, /signed-device collector/iu);
  const directory = makeTempDirSync("prd056-ios-telemetry-");
  try {
    const path = join(directory, "telemetry.json");
    const telemetry = {
      durationMs: 200,
      cadenceMs: 100,
      processPid: 7124,
      frame: { available: true, source: "signed bridge frame", unit: "ms", samples: [{ at: "2026-08-09T02:00:00.000Z", value: 15 }, { at: "2026-08-09T02:00:00.100Z", value: 16 }], error: null },
      memory: { available: true, source: "signed bridge memory", unit: "bytes", samples: [{ at: "2026-08-09T02:00:00.000Z", value: 100 }, { at: "2026-08-09T02:00:00.100Z", value: 101 }], error: null },
      thermal: { available: true, source: "signed bridge thermal", unit: "state", samples: [{ at: "2026-08-09T02:00:00.000Z", value: "nominal" }, { at: "2026-08-09T02:00:00.100Z", value: "nominal" }], error: null },
      battery: { available: true, source: "signed bridge battery", unit: "percent", samples: [{ at: "2026-08-09T02:00:00.000Z", value: 90 }, { at: "2026-08-09T02:00:00.100Z", value: 89 }], error: null },
    };
    writeFileSync(path, JSON.stringify(telemetry));
    const collected = collectIosTelemetry({ path, durationMs: 200, cadenceMs: 100 });
    assert.equal(collected.frame.available, true);
    assert.equal(collected.processPid, 7124);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("lifecycle, unsigned-artifact, and missing-prerequisite controls execute their guards", () => {
  const valid = productionLifecycleState();
  assert.equal(evaluateLifecycleObservation(valid, { sessionNonce: valid.sessionNonce }).valid, true);
  assert.equal(evaluateLifecycleObservation({ ...valid, framesAdvanced: false }).valid, false);
  const lifecycleGreen = qualifyPhysicalMobile({ platform: "android", device: DEVICE_IDENTIFIER, app: "/tmp/candidate.apk", candidateSha: LANE_CANDIDATE_SHA, out: ".runtime/prd056/control", durationMs: 100, cadenceMs: 50, prerequisiteReports: {}, control: "break-resume", controlObservation: valid });
  assert.equal(lifecycleGreen.status, "pass");
  const lifecycleRed = qualifyPhysicalMobile({ platform: "android", device: DEVICE_IDENTIFIER, app: "/tmp/candidate.apk", candidateSha: LANE_CANDIDATE_SHA, out: ".runtime/prd056/control", durationMs: 100, cadenceMs: 50, prerequisiteReports: {}, control: "break-resume", controlObservation: { ...valid, framesAdvanced: false } });
  assert.equal(lifecycleRed.status, "fail");
  const unsigned = qualifyPhysicalMobile({ platform: "android", device: DEVICE_IDENTIFIER, app: "/tmp/does-not-exist-prd056.apk", candidateSha: LANE_CANDIDATE_SHA, control: "reject-unsigned" });
  assert.equal(unsigned.status, "blocked");
  assert.equal(unsigned.code, "TN_QUALIFY_SIGNING_REQUIRED");
  const missing = qualifyPhysicalMobile({ platform: "android", device: DEVICE_IDENTIFIER, app: "/tmp/candidate.apk", candidateSha: LANE_CANDIDATE_SHA, control: "missing-prerequisite", prerequisiteReports: {} });
  assert.equal(missing.status, "blocked");
  assert.ok(missing.blockers.some((blocker) => blocker.includes("prd053")));
});

test("unsigned and missing-prerequisite controls are not hardcoded outcomes", () => {
  const directory = makeTempDirSync("prd056-controls-");
  try {
    const artifactPath = join(directory, "candidate.apk");
    writeFileSync(artifactPath, "candidate bytes");
    const invalidSignature = qualifyPhysicalMobile({
      platform: "android",
      device: DEVICE_IDENTIFIER,
      app: artifactPath,
      candidateSha: LANE_CANDIDATE_SHA,
      control: "reject-unsigned",
    }, {
      findExecutable: (name) => name,
      command: () => ({ status: 1, stdout: "", stderr: "bad signature" }),
    });
    assert.equal(invalidSignature.status, "blocked");
    assert.equal(invalidSignature.code, "TN_QUALIFY_ANDROID_SIGNING_INVALID");

    withPrerequisiteReports((paths) => {
      const validPrerequisites = qualifyPhysicalMobile({
        platform: "android",
        device: DEVICE_IDENTIFIER,
        app: artifactPath,
        candidateSha: LANE_CANDIDATE_SHA,
        control: "missing-prerequisite",
        prerequisiteReports: paths,
      });
      assert.equal(validPrerequisites.status, "fail");
      assert.equal(validPrerequisites.code, "TN_QUALIFY_CONTROL_NOT_TRIGGERED");
      writeFileSync(paths.prd053, "not-json\n");
      const malformedPrerequisite = qualifyPhysicalMobile({
        platform: "android",
        device: DEVICE_IDENTIFIER,
        app: artifactPath,
        candidateSha: LANE_CANDIDATE_SHA,
        control: "missing-prerequisite",
        prerequisiteReports: paths,
      });
      assert.equal(malformedPrerequisite.status, "blocked");
      assert.equal(malformedPrerequisite.code, "TN_QUALIFY_PREREQUISITE_REPORT_MISSING");
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("telemetry collectors require explicit availability and complete provenance", () => {
  const evidence = createEvidenceFixture();
  evidence.telemetry.thermal = undefined;
  const missing = validatePhysicalDeviceEvidence(evidence);
  assert.ok(missing.errors.some((error) => error.includes("telemetry.thermal")));
  evidence.telemetry.thermal = { available: false, source: "thermal service", unit: "state", samples: [], error: "not exposed by host" };
  const unavailable = validatePhysicalDeviceEvidence(evidence);
  assert.equal(unavailable.valid, true);
});

test("declared behavioral controls retain exit taxonomy", () => {
  const resume = qualifyPhysicalMobile({
    platform: "android",
    device: "physical-056",
    app: "/tmp/candidate.apk",
    candidateSha: "8bcf0553f38655b8db425d64f37cd19ff4db7034",
    out: ".runtime/prd056/control",
    durationMs: 30_000,
    cadenceMs: 1_000,
    prerequisiteReports: {},
    validateFixture: null,
    rollup: null,
    control: "break-resume",
  });
  assert.equal(resume.status, "fail");
  assert.equal(resume.code, "TN_QUALIFY_LIFECYCLE_CONTINUITY");
  assert.equal(parseArgs(["--platform", "ios", "--device", "PHONE-056", "--ios-app", "candidate.app", "--candidate-sha", "8bcf0553f38655b8db425d64f37cd19ff4db7034"]).platform, "ios");
});

test("missing preflight inputs are blocked before source or device execution", () => {
  const options = parseArgs([]);
  const result = preflight(options, {
    source: {
      remote: "origin",
      branch: "main",
      headSha: "8bcf0553f38655b8db425d64f37cd19ff4db7034",
      worktree: "clean",
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.code, "TN_QUALIFY_INPUT_REQUIRED");
  assert.ok(result.blockers.some((blocker) => blocker.includes("device identifier")));
  assert.ok(result.blockers.some((blocker) => blocker.includes("signed artifact")));
  assert.ok(result.blockers.some((blocker) => blocker.includes("prd053")));
});

test("package and root commands expose one qualification entry point", () => {
  const root = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8"));
  const runtime = JSON.parse(readFileSync(join(runtimeRoot, "package.json"), "utf8"));
  assert.equal(root.scripts["native:qualify:physical"], "pnpm --filter @threenative/runtime-native native:qualify:physical");
  assert.equal(runtime.scripts["native:qualify:physical"], "node scripts/qualify-physical-mobile.mjs");
  assert.ok(runtime.files.includes("scripts/physical-device-evidence.mjs"));
  assert.ok(runtime.files.includes("scripts/qualify-physical-mobile.mjs"));
});

test("deliberate collection sentinel is visible to the package runner", () => {
  if (process.env.TN_PRD056_FORCE_SENTINEL_FAILURE !== "1") return;
  assert.fail("deliberate collection sentinel");
});

test("findExecutable falls back to the Android SDK when PATH has nothing", () => {
  // An SDK installed by Android Studio puts nothing on PATH. Before this fallback the
  // qualification refused with TN_QUALIFY_SIGNING_TOOL_REQUIRED -- a missing-capability error for a
  // tool that was installed -- and "blocked, tool unavailable" reads the same either way.
  const root = makeTempDirSync("tn-sdk-");
  try {
    mkdirSync(join(root, "build-tools", "9.0.0"), { recursive: true });
    mkdirSync(join(root, "build-tools", "36.0.0"), { recursive: true });
    mkdirSync(join(root, "platform-tools"), { recursive: true });
    writeFileSync(join(root, "build-tools", "9.0.0", "apksigner"), "#!/bin/sh\n");
    writeFileSync(join(root, "build-tools", "36.0.0", "apksigner"), "#!/bin/sh\n");
    writeFileSync(join(root, "platform-tools", "adb"), "#!/bin/sh\n");

    const env = { ANDROID_HOME: root, PATH: "" };
    // Newest build-tools wins: a plain string sort puts 9.0.0 above 36.0.0.
    assert.equal(findExecutable("apksigner", env), join(root, "build-tools", "36.0.0", "apksigner"));
    assert.equal(findExecutable("adb", env), join(root, "platform-tools", "adb"));
    assert.equal(findExecutable("definitely-not-installed", env), null);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("PATH still wins over the SDK, and an explicit override wins over both", () => {
  const root = makeTempDirSync("tn-sdk-");
  try {
    mkdirSync(join(root, "build-tools", "36.0.0"), { recursive: true });
    mkdirSync(join(root, "bin"), { recursive: true });
    writeFileSync(join(root, "build-tools", "36.0.0", "apksigner"), "#!/bin/sh\n");
    writeFileSync(join(root, "bin", "apksigner"), "#!/bin/sh\n");

    assert.equal(
      findExecutable("apksigner", { ANDROID_HOME: root, PATH: join(root, "bin") }),
      join(root, "bin", "apksigner"),
    );
    assert.equal(
      findExecutable("apksigner", {
        ANDROID_HOME: root,
        PATH: join(root, "bin"),
        THREENATIVE_APKSIGNER: join(root, "build-tools", "36.0.0", "apksigner"),
      }),
      join(root, "build-tools", "36.0.0", "apksigner"),
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
