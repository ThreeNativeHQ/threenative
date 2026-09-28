import { makeTempDirSync, makeTempDirSyncAt } from '../../../test-support/temp-dir.js';
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import {
  REQUIRED_GATE_IDS,
  REQUIRED_PREREQUISITES,
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
  subjectIdentity,
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

const LIFECYCLE_PID = 7123;

/**
 * One device-observed lifecycle, exactly as the Android runner reports it: the phases were read off
 * the phone (`pidof`, `dumpsys window`, `dumpsys gfxinfo`) and the step counts come from the
 * runtime's own physics counter. A game-authored `GameState` cannot produce any of it, which is
 * what makes it worth certifying — the game restates the scenario, the device does not.
 */
function deviceLifecycleObservation({ pid = LIFECYCLE_PID, phases = null } = {}) {
  return {
    phases: phases ?? [
      { at: 940, focused: false, frames: 320, framesPaused: true, phase: "background", pid },
      { at: 2_410, focused: true, frames: 327, phase: "foreground", pid, windowRotation: 0 },
      { at: 3_120, focused: true, frames: 418, phase: "rotate", pid, requestedRotation: 1, windowRotation: 1 },
      { at: 4_260, focused: true, frames: 420, phase: "foreground", pid, windowRotation: 1 },
    ],
    physics: {
      available: true,
      steps: { afterAdvance: 1023, afterForeground: 1021, beforeBackground: 1021 },
      stepsAdvanced: true,
      stepsPaused: true,
    },
    render: { framesAdvanced: true, framesPaused: true },
    session: { pid },
  };
}

/** The same observation with one claim replaced, so a control changes exactly one thing. */
function withLifecycleClaim(claim, value) {
  const observation = deviceLifecycleObservation();
  return { ...observation, [claim]: value };
}

/** The same observation with one field of one phase replaced. */
function withLifecyclePhase(index, change) {
  const { phases } = deviceLifecycleObservation();
  const observation = deviceLifecycleObservation();
  return { ...observation, phases: phases.map((phase, position) => (position === index ? { ...phase, ...change } : phase)) };
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

const CONSUMER_APP_ID = "com.threenative.starternative";
const CONSUMER_SCENARIO_NAME = "consumer-lifecycle";

/**
 * A declared consumer subject: a project with its own `app.id`, its own scenario, and the signed
 * artifact a `pnpm build:android` would leave under `dist-native/`. The application id is the whole
 * point of declaring a project — a phone holds several ThreeNative installs, and running the wrong
 * package renders a plausible scene that answers a question nobody asked.
 */
function consumerSubject(root, { applicationId = CONSUMER_APP_ID, scenarioName = CONSUMER_SCENARIO_NAME } = {}) {
  const project = join(root, "game");
  mkdirSync(join(project, "playtests"), { recursive: true });
  mkdirSync(join(project, "dist-native"), { recursive: true });
  writeFileSync(join(project, "threenative.config.ts"), `export default { app: { id: '${applicationId}' } };\n`);
  const scenario = join(project, `playtests/${scenarioName}.playtest.json`);
  writeFileSync(scenario, `${JSON.stringify({ schemaVersion: 1, name: scenarioName, target: "android", subject: "starter", steps: [] }, null, 2)}\n`);
  const app = join(project, "dist-native/app-release.apk");
  writeFileSync(app, "signed consumer artifact bytes");
  const artifactSha256 = sha256File(app);
  writeFileSync(`${app}.provenance.json`, `${JSON.stringify({
    schemaVersion: 1,
    platform: "android",
    sourceSha: LANE_CANDIDATE_SHA,
    artifactSha256,
    packageVersion: "0.3.3",
    signing: { signerId: "CN=Observed signer", certificateFingerprint: "d".repeat(64), profileFingerprint: null, expiresAt: "2027-08-09T00:00:00.000Z", applicationId, debuggable: false },
  }, null, 2)}\n`);
  return { project, scenario, scenarioName, applicationId, app, artifactSha256 };
}

/** One physical Pixel 8 on adb: the properties, installs and telemetry a real run reads back. */
function adbReply(properties, { installedSha256, applicationId }, args) {
  const line = args.join(" ");
  if (args.includes("getprop")) return { status: 0, stdout: `${properties[args.at(-1)] ?? ""}\n`, stderr: "" };
  if (line.includes("SurfaceFlinger")) return { status: 0, stdout: "GLES: Adreno (TM) 740\n", stderr: "" };
  if (line.includes("wm ")) return { status: 0, stdout: "Physical size: 1080x2400\n", stderr: "" };
  if (line.includes("settings put")) return { status: 0, stdout: "", stderr: "" };
  if (line.includes("settings get")) return { status: 0, stdout: "0\n", stderr: "" };
  if (line.includes("install")) return { status: 0, stdout: "Success\n", stderr: "" };
  if (line.includes("pm path")) return { status: 0, stdout: `package:/data/app/${applicationId}/base.apk\n`, stderr: "" };
  if (line.includes("sha256sum")) return { status: 0, stdout: `${installedSha256}  ${args.at(-1)}\n`, stderr: "" };
  if (line.includes("am start")) return { status: 0, stdout: "Status: ok\n", stderr: "" };
  if (line.includes("pidof")) return { status: 0, stdout: "7123\n", stderr: "" };
  if (line.includes("gfxinfo")) return { status: 0, stdout: "Flags,IntendedVsync,FrameCompleted\n0,1000000000,1012500000\n", stderr: "" };
  if (line.includes("meminfo")) return { status: 0, stdout: "  TOTAL 2048\n", stderr: "" };
  if (line.includes("thermalservice")) return { status: 0, stdout: "Status: nominal\n", stderr: "" };
  if (line.includes("battery")) return { status: 0, stdout: "  level: 88\n", stderr: "" };
  return { status: 0, stdout: "", stderr: "" };
}

const PIXEL_8_PROPERTIES = {
  "ro.kernel.qemu": "0",
  "ro.hardware": "husky",
  "ro.product.cpu.abi": "arm64-v8a",
  "ro.product.name": "husky",
  "ro.product.manufacturer": "Google",
  "ro.product.model": "Pixel 8",
  "ro.build.version.release": "17",
  "ro.build.id": "AP4A.250000.000",
};

/** The signing tools, the physical phone and the playtest CLI it drives. Nothing here is a device. */
function physicalDeviceHost({ installedSha256, applicationId, out, report }) {
  const calls = [];
  let clock = Date.parse("2026-09-27T10:00:00.000Z");
  const device = { installedSha256, applicationId };
  const command = (executable, args) => {
    calls.push({ executable, args });
    if (executable === "apksigner") return { status: 0, stdout: `certificate SHA-256 digest: ${"d".repeat(64)}\n`, stderr: "" };
    if (executable === "unzip") return { status: 0, stdout: "lib/arm64-v8a/libmystral-runtime.so\n", stderr: "" };
    if (executable === "adb") return adbReply(PIXEL_8_PROPERTIES, device, args);
    mkdirSync(join(out, "playtest"), { recursive: true });
    writeFileSync(join(out, "playtest/after.png"), "captured consumer frame");
    return { status: 0, stdout: `${JSON.stringify(report, null, 2)}\n`, stderr: "" };
  };
  return { command, calls, findExecutable: (name) => name, now: () => clock, sleep: (duration) => { clock += duration; } };
}

/** Drives one declared consumer qualification end to end against the stubbed physical phone. */
function withConsumerRun(callback, {
  subject = {},
  provenanceApplicationId = null,
  device = DEVICE_IDENTIFIER,
  installedSha256 = null,
  reportOverrides = {},
  options = {},
} = {}) {
  const root = makeTempDirSync("prd366-consumer-");
  const out = join(workspaceRoot, ".runtime/prd056/consumer-run");
  try {
    const declared = consumerSubject(root, subject);
    const scenarioName = declared.scenarioName;
    if (provenanceApplicationId !== null) {
      const provenancePath = `${declared.app}.provenance.json`;
      writeFileSync(provenancePath, JSON.stringify({
        ...JSON.parse(readFileSync(provenancePath, "utf8")),
        signing: { ...JSON.parse(readFileSync(provenancePath, "utf8")).signing, applicationId: provenanceApplicationId },
      }));
    }
    const gateEvidence = join(root, "gate-evidence.json");
    writeFileSync(gateEvidence, JSON.stringify({ gates: productionGateEvidence() }));
    const report = {
      pass: true,
      scenario: scenarioName,
      assertionResults: [{ id: "visibility.player", pass: true }],
      diagnostics: [],
      observations: {
        deviceLifecycle: deviceLifecycleObservation(),
        runtimeDiagnostics: { recentRuntimeErrors: [] },
      },
      ...reportOverrides,
    };
    const host = physicalDeviceHost({ installedSha256: installedSha256 ?? declared.artifactSha256, applicationId: declared.applicationId, out, report });
    const artifactOverrides = Object.fromEntries(REQUIRED_PREREQUISITES.map((name) => [name, { artifactSha256: declared.artifactSha256 }]));
    withPrerequisiteReports((paths) => callback({
      declared,
      host,
      out,
      gateEvidence,
      result: qualifyPhysicalMobile({
        platform: "android",
        device,
        app: declared.app,
        candidateSha: LANE_CANDIDATE_SHA,
        out,
        project: declared.project,
        scenario: declared.scenario,
        gateEvidence,
        control: null,
        durationMs: 200,
        cadenceMs: 100,
        prerequisiteReports: paths,
        ...options,
      }, { ...host, source: sourceIdentity() }),
    }), artifactOverrides);
  } finally {
    rmSync(root, { force: true, recursive: true });
    rmSync(out, { force: true, recursive: true });
  }
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
  const final = {
    pass: true,
    assertionResults: [{ id: "lifecycle", pass: true }],
    observations: { deviceLifecycle: deviceLifecycleObservation() },
  };
  const stdout = [
    "native runner: preparing device",
    JSON.stringify({ pass: false, diagnostics: [{ message: "intermediate" }] }, null, 2),
    JSON.stringify(final, null, 2),
  ].join("\n");
  assert.deepEqual(parsePlaytestReport(stdout), final);
  assert.equal(parsePlaytestReport("diagnostic only\n"), null);
});

test("production evidence refuses to certify a lifecycle the v1 evidence schema cannot represent", () => {
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
    const request = {
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
            deviceLifecycle: deviceLifecycleObservation(),
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
    };
    // The device observation is accepted, and the run then stops on the one thing the v1 evidence
    // schema has no field for: four ordered rows carrying a wall-clock phase time and a per-phase
    // physics step count, against phase offsets from the run's own clock and three step reads. A
    // collector that filled those in would put numbers in the evidence no read produced, so it
    // refuses by name and writes no document.
    assert.throws(() => buildProductionEvidence(request), (error) => {
      assert.equal(error.code, "TN_QUALIFY_LIFECYCLE_EVIDENCE_UNREPRESENTABLE");
      assert.match(error.message, /observations\.deviceLifecycle/u);
      return true;
    });
    // A device claim that is false is refused first, by the guard that reads the phone.
    assert.throws(
      () => buildProductionEvidence({ ...request, playtestRun: { report: { ...request.playtestRun.report, observations: { ...request.playtestRun.report.observations, deviceLifecycle: withLifecycleClaim("render", { framesAdvanced: false, framesPaused: true }) } } } }),
      (error) => error.code === "TN_QUALIFY_LIFECYCLE_CONTINUITY",
    );
    // The shape a real consumer scenario drives — background, foreground, rotate — is a valid
    // lifecycle and is refused for the schema's four rows, not for the observation.
    assert.throws(
      () => buildProductionEvidence({ ...request, playtestRun: { report: { ...request.playtestRun.report, observations: { ...request.playtestRun.report.observations, deviceLifecycle: withLifecycleClaim("phases", deviceLifecycleObservation().phases.slice(0, 3)) } } } }),
      (error) => error.code === "TN_QUALIFY_LIFECYCLE_EVIDENCE_UNREPRESENTABLE" && error.message.includes("3 device-observed phases"),
    );
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
  const root = makeTempDirSync("prd366-preflight-");
  try {
    const declared = consumerSubject(root);
    const options = {
      platform: "android",
      device: DEVICE_IDENTIFIER,
      app: declared.app,
      candidateSha: LANE_CANDIDATE_SHA,
      out: join(workspaceRoot, ".runtime/prd056/preflight"),
      project: declared.project,
      scenario: declared.scenario,
    };
    const artifactOverrides = Object.fromEntries(REQUIRED_PREREQUISITES.map((name) => [name, { artifactSha256: declared.artifactSha256 }]));
    withPrerequisiteReports((paths) => {
      const valid = preflight({ ...options, prerequisiteReports: paths }, {
        source: sourceIdentity(),
        artifactSha256: declared.artifactSha256,
        artifactSourceSha: LANE_CANDIDATE_SHA,
        artifact: { applicationId: declared.applicationId },
      });
      assert.equal(valid.status, "pass", JSON.stringify(valid.blockers));
      assert.deepEqual(Object.keys(valid.prerequisites).sort(), ["prd046", "prd048", "prd053", "prd054"]);
      assert.equal(valid.subject.applicationId, declared.applicationId);
      assert.equal(valid.subject.scenarioName, declared.scenarioName);
    }, artifactOverrides);
    withPrerequisiteReports((paths) => {
      const result = preflight({ ...options, prerequisiteReports: paths }, { source: sourceIdentity(), artifactSha256: declared.artifactSha256, artifactSourceSha: LANE_CANDIDATE_SHA });
      assert.equal(result.status, "blocked");
      assert.ok(result.blockers.some((blocker) => blocker.includes("prd054.candidateSha")));
    }, { prd054: { candidateSha: "e38439c" } });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("an iOS preflight keeps project and scenario validation and never judges the Android package id", () => {
  const root = makeTempDirSync("prd366-ios-preflight-");
  try {
    const declared = consumerSubject(root);
    const options = {
      platform: "ios",
      device: DEVICE_IDENTIFIER,
      app: declared.app,
      candidateSha: LANE_CANDIDATE_SHA,
      out: join(workspaceRoot, ".runtime/prd056/ios-preflight"),
      project: declared.project,
      scenario: declared.scenario,
    };
    const artifactOverrides = Object.fromEntries(REQUIRED_PREREQUISITES.map((name) => [name, { artifactSha256: declared.artifactSha256, target: "ios" }]));
    // `verifyIosArtifact` reports a codesign bundle id, which `app.id` is not obliged to equal.
    withPrerequisiteReports((paths) => {
      const bundle = preflight({ ...options, prerequisiteReports: paths }, {
        source: sourceIdentity(),
        artifactSha256: declared.artifactSha256,
        artifactSourceSha: LANE_CANDIDATE_SHA,
        artifact: { applicationId: "dev.threenative.runtime" },
      });
      assert.equal(bundle.status, "pass", JSON.stringify(bundle.blockers));
      const bare = consumerSubject(root, { applicationId: "placeholder" });
      rmSync(join(bare.project, "threenative.config.ts"));
      const noAppId = preflight({ ...options, project: bare.project, scenario: bare.scenario, prerequisiteReports: paths }, {
        source: sourceIdentity(),
        artifactSha256: declared.artifactSha256,
        artifactSourceSha: LANE_CANDIDATE_SHA,
        artifact: { applicationId: "dev.threenative.runtime" },
      });
      assert.equal(noAppId.status, "pass", JSON.stringify(noAppId.blockers));
      const absent = preflight({ ...options, prerequisiteReports: paths, scenario: join(declared.project, "playtests/absent.playtest.json") }, { source: sourceIdentity() });
      assert.equal(absent.status, "blocked");
      assert.ok(absent.blockers.some((blocker) => blocker.includes("absent.playtest.json")));
      const outside = makeTempDirSync("prd366-ios-elsewhere-");
      try {
        writeFileSync(join(outside, "foreign.playtest.json"), JSON.stringify({ schemaVersion: 1, name: "foreign", steps: [] }));
        const escaped = preflight({ ...options, prerequisiteReports: paths, scenario: join(outside, "foreign.playtest.json") }, { source: sourceIdentity() });
        assert.equal(escaped.status, "blocked");
        assert.ok(escaped.blockers.some((blocker) => blocker.includes("outside the declared project")));
      } finally {
        rmSync(outside, { force: true, recursive: true });
      }
    }, artifactOverrides);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
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
  const valid = deviceLifecycleObservation();
  assert.equal(evaluateLifecycleObservation(valid).valid, true);
  assert.equal(evaluateLifecycleObservation(withLifecycleClaim("render", { framesAdvanced: false, framesPaused: true })).valid, false);
  const lifecycleGreen = qualifyPhysicalMobile({ platform: "android", device: DEVICE_IDENTIFIER, app: "/tmp/candidate.apk", candidateSha: LANE_CANDIDATE_SHA, out: ".runtime/prd056/control", durationMs: 100, cadenceMs: 50, prerequisiteReports: {}, control: "break-resume", controlObservation: valid });
  assert.equal(lifecycleGreen.status, "pass");
  const lifecycleRed = qualifyPhysicalMobile({ platform: "android", device: DEVICE_IDENTIFIER, app: "/tmp/candidate.apk", candidateSha: LANE_CANDIDATE_SHA, out: ".runtime/prd056/control", durationMs: 100, cadenceMs: 50, prerequisiteReports: {}, control: "break-resume", controlObservation: withLifecycleClaim("render", { framesAdvanced: false, framesPaused: true }) });
  assert.equal(lifecycleRed.status, "fail");
  assert.ok(lifecycleRed.errors.some((error) => error.includes("render.framesAdvanced")));
  const unsigned = qualifyPhysicalMobile({ platform: "android", device: DEVICE_IDENTIFIER, app: "/tmp/does-not-exist-prd056.apk", candidateSha: LANE_CANDIDATE_SHA, control: "reject-unsigned" });
  assert.equal(unsigned.status, "blocked");
  assert.equal(unsigned.code, "TN_QUALIFY_SIGNING_REQUIRED");
  const missing = qualifyPhysicalMobile({ platform: "android", device: DEVICE_IDENTIFIER, app: "/tmp/candidate.apk", candidateSha: LANE_CANDIDATE_SHA, control: "missing-prerequisite", prerequisiteReports: {} });
  assert.equal(missing.status, "blocked");
  assert.ok(missing.blockers.some((blocker) => blocker.includes("prd053")));
});

test("the lifecycle guard certifies the runner's device observation, never a game's own account", () => {
  const valid = deviceLifecycleObservation();
  // No observation at all is the shape every real report has today unless the scenario drove one: a
  // game-authored resource is the one thing that is never a substitute for it.
  const absent = evaluateLifecycleObservation(undefined);
  assert.equal(absent.valid, false);
  assert.match(absent.errors[0], /observations\.deviceLifecycle/u);
  const falseClaims = {
    "a process that changed mid-run": withLifecycleClaim("phases", valid.phases.map((phase, index) => (index === 3 ? { ...phase, pid: 9999 } : phase))),
    "a phase that never reached the foreground": withLifecycleClaim("phases", [valid.phases[0], { ...valid.phases[1], focused: false }]),
    "the phases in the wrong order": withLifecycleClaim("phases", [valid.phases[1], valid.phases[0], valid.phases[2], valid.phases[3]]),
    "a lifecycle that never turned": withLifecycleClaim("phases", valid.phases.slice(0, 2)),
    "a phase after the rotation that is not a resume": withLifecycleClaim("phases", [...valid.phases, { at: 5_000, focused: true, frames: 424, phase: "background", pid: LIFECYCLE_PID }]),
    "a frame counter that never stopped while backgrounded": withLifecycleClaim("render", { framesAdvanced: true, framesPaused: false }),
    "a backgrounded reading that never recorded the pause": withLifecyclePhase(0, { framesPaused: false }),
    "frames that did not resume": withLifecycleClaim("phases", valid.phases.map((phase, index) => (index === 3 ? { ...phase, frames: 320 } : phase))),
    "a frame count that ran backwards": withLifecyclePhase(2, { frames: 100 }),
    "phase times that did not advance": withLifecyclePhase(2, { at: 1_000 }),
    "a summary that denies frames the phases' counts show": withLifecycleClaim("render", { framesAdvanced: false, framesPaused: true }),
    "a physics summary that denies steps the counts show": withLifecycleClaim("physics", { ...valid.physics, stepsPaused: false }),
    "a rotation the device never actually turned to": withLifecycleClaim("phases", valid.phases.map((phase) => (phase.phase === "rotate" ? { ...phase, windowRotation: 0 } : phase))),
    "a rotation the app was already in": withLifecycleClaim("phases", valid.phases.map((phase) => (phase.windowRotation === undefined ? phase : { ...phase, windowRotation: 1 }))),
    "a build that installs no physics plugin": withLifecycleClaim("physics", { available: false, reason: "the bridge does not advertise runtime.physics" }),
    "a simulation that kept stepping while the app was away": withLifecycleClaim("physics", { ...valid.physics, steps: { ...valid.physics.steps, afterForeground: 1040 } }),
    "a simulation that never advanced after the resume": withLifecycleClaim("physics", { ...valid.physics, steps: { ...valid.physics.steps, afterAdvance: 1021 } }),
  };
  for (const [claim, observation] of Object.entries(falseClaims)) {
    const result = evaluateLifecycleObservation(observation);
    assert.equal(result.valid, false, claim);
    // Every diagnostic names the channel it read, so a red says which observation to go look at.
    assert.ok(result.errors.length > 0 && result.errors.every((error) => error.startsWith("observations.deviceLifecycle")), `${claim}: ${result.errors.join("; ")}`);
  }
  // The three operations the claim rests on are enough on their own; a run that also steps the app
  // back to the foreground afterwards reports the same continuity.
  assert.equal(evaluateLifecycleObservation(withLifecycleClaim("phases", valid.phases.slice(0, 3))).valid, true);
  assert.equal(evaluateLifecycleObservation(withLifecycleClaim("render", { framesAdvanced: true, framesPaused: true })).valid, true);
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

test("the native-smoke subject stays the default and its absent lifecycle scenario fails closed by name", () => {
  const parsed = parseArgs([]);
  assert.ok(parsed.project.endsWith("examples/native-smoke"));
  assert.ok(parsed.scenario.startsWith(parsed.project));
  assert.equal(parsed.applicationId, null);
  const result = preflight(parsed, { source: sourceIdentity() });
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.some((blocker) => blocker.includes("physical-mobile-lifecycle.playtest.json")));
});

test("the declared subject resolves one application id, project and scenario for both platforms", () => {
  const root = makeTempDirSync("prd366-subject-");
  try {
    const declared = consumerSubject(root);
    const identity = subjectIdentity({ project: declared.project, scenario: declared.scenario, applicationId: null, activity: null });
    assert.equal(identity.applicationId, CONSUMER_APP_ID);
    assert.equal(identity.scenarioName, CONSUMER_SCENARIO_NAME);
    assert.equal(identity.activity, "com.threenative.runtime.MystralActivity");
    assert.equal(subjectIdentity({ project: declared.project, scenario: declared.scenario, applicationId: "com.example.override", activity: null }).applicationId, "com.example.override");
    const noConfig = join(root, "no-config");
    mkdirSync(noConfig, { recursive: true });
    assert.equal(subjectIdentity({ project: noConfig, scenario: declared.scenario, applicationId: null, activity: null }).applicationId, "com.threenative.game");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("a declared consumer project installs and drives its own artifact on the phone it names", () => {
  withConsumerRun(({ declared, host, result }) => {
    // Every device guard ran — the declared package is what was installed, launched and driven —
    // and the run then stops at the lifecycle claim the v1 evidence schema cannot represent.
    assert.equal(result.status, "fail", JSON.stringify(result));
    assert.equal(result.code, "TN_QUALIFY_LIFECYCLE_EVIDENCE_UNREPRESENTABLE");
    const scenarioCall = host.calls.find((call) => call.executable === process.execPath);
    const args = scenarioCall.args;
    assert.equal(args[1], declared.scenario);
    assert.equal(args[args.indexOf("--project") + 1], declared.project);
    assert.equal(args[args.indexOf("--package") + 1], CONSUMER_APP_ID);
    assert.equal(args[args.indexOf("--activity") + 1], "com.threenative.runtime.MystralActivity");
    const launch = host.calls.find((call) => call.args.includes("am") && call.args.includes("start"));
    assert.ok(launch.args.at(-1).startsWith(`${CONSUMER_APP_ID}/`), launch.args.at(-1));
  });
});

test("should reject a consumer run whose device is an emulator, before anything is installed", () => {
  withConsumerRun(({ host, result }) => {
    assert.equal(result.status, "blocked");
    assert.equal(result.code, "TN_QUALIFY_PHYSICAL_DEVICE_REQUIRED");
    assert.ok(!host.calls.some((call) => call.args.includes("install")));
    assert.ok(!host.calls.some((call) => call.executable === process.execPath));
  }, { device: "emulator-5554" });
});

test("should reject a stale installed artifact instead of launching what the device already had", () => {
  withConsumerRun(({ host, result }) => {
    assert.equal(result.status, "blocked");
    assert.equal(result.code, "TN_QUALIFY_ARTIFACT_PROVENANCE_MISMATCH");
    assert.ok(!host.calls.some((call) => call.args.includes("am") && call.args.includes("start")));
  }, { installedSha256: "a".repeat(64) });
});

test("should reject a declared subject that does not match the installed artifact", () => {
  withConsumerRun(({ result }) => {
    assert.equal(result.status, "blocked");
    assert.equal(result.code, "TN_QUALIFY_PREFLIGHT_BLOCKED");
    assert.ok(result.blockers.some((blocker) => blocker.includes("com.threenative.starternative") && blocker.includes("com.example.other")));
  }, { provenanceApplicationId: "com.example.other" });
  withConsumerRun(({ result }) => {
    assert.equal(result.status, "blocked");
    assert.ok(result.blockers.some((blocker) => blocker.includes("app.id")));
  }, { options: { applicationId: "com.example.declared" } });
});

test("should reject a scenario that is absent, outside its project, or not the one that ran", () => {
  const root = makeTempDirSync("prd366-subject-");
  try {
    const declared = consumerSubject(root);
    const missing = preflight({ platform: "android", device: DEVICE_IDENTIFIER, app: declared.app, candidateSha: LANE_CANDIDATE_SHA, out: join(workspaceRoot, ".runtime/prd056/subject"), project: declared.project, scenario: join(declared.project, "playtests/absent.playtest.json") }, { source: sourceIdentity() });
    assert.equal(missing.status, "blocked");
    assert.ok(missing.blockers.some((blocker) => blocker.includes("absent.playtest.json")));

    const elsewhere = makeTempDirSync("prd366-elsewhere-");
    try {
      writeFileSync(join(elsewhere, "foreign.playtest.json"), JSON.stringify({ schemaVersion: 1, name: "foreign", steps: [] }));
      const outside = preflight({ platform: "android", device: DEVICE_IDENTIFIER, app: declared.app, candidateSha: LANE_CANDIDATE_SHA, out: join(workspaceRoot, ".runtime/prd056/subject"), project: declared.project, scenario: join(elsewhere, "foreign.playtest.json") }, { source: sourceIdentity() });
      assert.equal(outside.status, "blocked");
      assert.ok(outside.blockers.some((blocker) => blocker.includes("outside the declared project")));
    } finally {
      rmSync(elsewhere, { force: true, recursive: true });
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
  withConsumerRun(({ result }) => {
    assert.equal(result.status, "fail");
    assert.equal(result.code, "TN_QUALIFY_SCENARIO_MISMATCH");
  }, { reportOverrides: { scenario: "some-other-scenario" } });
});

test("should reject a consumer run without a device-observed lifecycle or any assertion", () => {
  withConsumerRun(({ result }) => {
    assert.equal(result.status, "fail");
    assert.equal(result.code, "TN_QUALIFY_LIFECYCLE_CONTINUITY");
  }, { reportOverrides: { observations: { runtimeDiagnostics: { recentRuntimeErrors: [] } } } });
  withConsumerRun(({ result }) => {
    assert.equal(result.status, "fail");
    assert.equal(result.code, "TN_QUALIFY_LIFECYCLE_CONTINUITY");
  }, {
    reportOverrides: {
      observations: {
        deviceLifecycle: withLifecycleClaim("render", { framesAdvanced: false, framesPaused: true }),
        runtimeDiagnostics: { recentRuntimeErrors: [] },
      },
    },
  });
  withConsumerRun(({ result }) => {
    assert.equal(result.status, "fail");
    assert.equal(result.code, "TN_QUALIFY_LIFECYCLE_CONTINUITY");
  }, { reportOverrides: { assertionResults: [] } });
  withConsumerRun(({ result }) => {
    assert.equal(result.status, "fail");
    assert.equal(result.code, "TN_QUALIFY_LIFECYCLE_CONTINUITY");
    assert.ok(result.errors.some((error) => error.includes("300 frames")));
  }, {
    reportOverrides: {
      observations: {
        // A lifecycle the device did observe, on a process that stopped drawing far short of 300
        // frames — the one claim the phase count alone has to carry.
        deviceLifecycle: deviceLifecycleObservation({ phases: [{ at: 940, focused: false, frames: 10, framesPaused: true, phase: "background", pid: LIFECYCLE_PID }, { at: 2_410, focused: true, frames: 10, phase: "foreground", pid: LIFECYCLE_PID, windowRotation: 0 }, { at: 3_120, focused: true, frames: 20, phase: "rotate", pid: LIFECYCLE_PID, requestedRotation: 1, windowRotation: 1 }, { at: 4_260, focused: true, frames: 40, phase: "foreground", pid: LIFECYCLE_PID, windowRotation: 1 }] }),
        runtimeDiagnostics: { recentRuntimeErrors: [] },
      },
    },
  });
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
