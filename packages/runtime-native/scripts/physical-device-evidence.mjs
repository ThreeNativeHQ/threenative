#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const PHYSICAL_EVIDENCE_SCHEMA = "physicalDeviceEvidenceV1";
export const REQUIRED_PREREQUISITES = ["prd053", "prd054", "prd046", "prd048"];
export const REQUIRED_GATE_IDS = [
  "evidence-schema",
  "android-physical-identity",
  "ios-physical-identity",
  "provenance-consistency",
  "lifecycle-continuity",
  "android-signed-install",
  "ios-signed-install",
  "multitouch-consumption",
  "native-physics-consumption",
  "telemetry-completeness",
  "qualification-rollup",
  "repository-collection",
];

const ROOT_KEYS = new Set([
  "schemaVersion",
  "identity",
  "source",
  "device",
  "signing",
  "prerequisites",
  "execution",
  "lifecycle",
  "consumption",
  "telemetry",
  "artifacts",
  "gateEvidence",
]);

const COMMIT_SHA = /^[0-9a-f]{7,64}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export class EvidenceValidationError extends Error {
  constructor(errors) {
    super(`Physical evidence validation failed: ${errors.join("; ")}`);
    this.name = "EvidenceValidationError";
    this.errors = errors;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function add(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function objectAt(value, path, errors, allowed) {
  if (!isRecord(value)) {
    add(errors, path, "must be an object");
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) add(errors, `${path}.${key}`, "unknown field");
  }
  return true;
}

function required(value, path, errors) {
  if (value === undefined) add(errors, path, "is required");
  return value !== undefined;
}

function stringAt(value, path, errors, { nonEmpty = true } = {}) {
  if (typeof value !== "string" || (nonEmpty && value.length === 0)) {
    add(errors, path, nonEmpty ? "must be a non-empty string" : "must be a string");
    return false;
  }
  return true;
}

function booleanAt(value, path, errors) {
  if (typeof value !== "boolean") {
    add(errors, path, "must be a boolean");
    return false;
  }
  return true;
}

function finiteNumberAt(value, path, errors, { integer = false, minimum } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    add(errors, path, "must be a finite number");
    return false;
  }
  if (integer && !Number.isInteger(value)) add(errors, path, "must be an integer");
  if (minimum !== undefined && value < minimum) add(errors, path, `must be >= ${minimum}`);
  return true;
}

function hashAt(value, path, errors) {
  if (!stringAt(value, path, errors) || !SHA256.test(value)) {
    if (typeof value === "string" && !SHA256.test(value)) add(errors, path, "must be a lowercase SHA-256 hex digest");
    return false;
  }
  return true;
}

function commitAt(value, path, errors) {
  if (!stringAt(value, path, errors) || !COMMIT_SHA.test(value)) {
    if (typeof value === "string" && !COMMIT_SHA.test(value)) add(errors, path, "must be a git SHA");
    return false;
  }
  return true;
}

function timestampAt(value, path, errors) {
  if (!stringAt(value, path, errors) || !ISO_UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    if (typeof value === "string") add(errors, path, "must be an ISO-8601 UTC timestamp");
    return false;
  }
  return true;
}

function enumAt(value, path, errors, values) {
  if (!values.includes(value)) {
    add(errors, path, `must be one of ${values.join(", ")}`);
    return false;
  }
  return true;
}

function relativePathAt(value, path, errors) {
  if (!stringAt(value, path, errors)) return false;
  if (value.startsWith("/") || value.split("/").includes("..")) add(errors, path, "must be repository-relative");
  return true;
}

function validateIdentity(value, errors) {
  const path = "identity";
  if (!objectAt(value, path, errors, new Set(["schemaVersion", "runId", "startedAt", "endedAt", "verdict", "blockers", "evidenceClass"]))) return;
  if (value.schemaVersion !== 1) add(errors, `${path}.schemaVersion`, "must equal 1");
  stringAt(value.runId, `${path}.runId`, errors);
  timestampAt(value.startedAt, `${path}.startedAt`, errors);
  timestampAt(value.endedAt, `${path}.endedAt`, errors);
  enumAt(value.verdict, `${path}.verdict`, errors, ["pass", "fail", "blocked"]);
  if (!Array.isArray(value.blockers)) add(errors, `${path}.blockers`, "must be an array");
  else value.blockers.forEach((item, index) => stringAt(item, `${path}.blockers[${index}]`, errors));
  enumAt(value.evidenceClass, `${path}.evidenceClass`, errors, ["physical-device"]);
}

function validateSource(value, errors, options) {
  const path = "source";
  if (!objectAt(value, path, errors, new Set(["remote", "branch", "headSha", "worktree", "artifactSourceSha", "packageVersion", "artifactSha256", "releaseRun", "publishedPackage", "promotedConsumer"]))) return;
  stringAt(value.remote, `${path}.remote`, errors);
  stringAt(value.branch, `${path}.branch`, errors);
  commitAt(value.headSha, `${path}.headSha`, errors);
  enumAt(value.worktree, `${path}.worktree`, errors, ["clean", "dirty"]);
  commitAt(value.artifactSourceSha, `${path}.artifactSourceSha`, errors);
  stringAt(value.packageVersion, `${path}.packageVersion`, errors);
  hashAt(value.artifactSha256, `${path}.artifactSha256`, errors);
  for (const key of ["releaseRun", "publishedPackage", "promotedConsumer"]) {
    if (value[key] !== null) stringAt(value[key], `${path}.${key}`, errors);
  }
  if (value.artifactSourceSha !== value.headSha) add(errors, `${path}.artifactSourceSha`, "must equal source.headSha");
  if (options.candidateSha !== undefined && value.headSha !== options.candidateSha) add(errors, `${path}.headSha`, `must equal candidate SHA ${options.candidateSha}`);
  if (options.artifactSha256 !== undefined && value.artifactSha256 !== options.artifactSha256) add(errors, `${path}.artifactSha256`, `must equal supplied artifact SHA ${options.artifactSha256}`);
  if (value.worktree !== "clean") add(errors, `${path}.worktree`, "physical qualification requires a clean worktree");
}

function validateDevice(value, errors, options) {
  const path = "device";
  if (!objectAt(value, path, errors, new Set(["platform", "kind", "identifierHash", "name", "manufacturer", "model", "osVersion", "osBuild", "cpuAbi", "gpu", "driver", "screenModes"]))) return;
  enumAt(value.platform, `${path}.platform`, errors, ["android", "ios"]);
  enumAt(value.kind, `${path}.kind`, errors, ["physical"]);
  hashAt(value.identifierHash, `${path}.identifierHash`, errors);
  if (options.platform !== undefined && value.platform !== options.platform) add(errors, `${path}.platform`, `must equal target ${options.platform}`);
  if (options.identifierHash !== undefined && value.identifierHash !== options.identifierHash) add(errors, `${path}.identifierHash`, "does not match the supplied physical device");
  for (const key of ["name", "manufacturer", "model", "osVersion", "osBuild", "cpuAbi", "gpu", "driver"]) stringAt(value[key], `${path}.${key}`, errors);
  if (!Array.isArray(value.screenModes) || value.screenModes.length === 0) add(errors, `${path}.screenModes`, "must contain at least one mode");
  else {
    value.screenModes.forEach((mode, index) => {
      const modePath = `${path}.screenModes[${index}]`;
      if (!objectAt(mode, modePath, errors, new Set(["width", "height", "orientation"]))) return;
      finiteNumberAt(mode.width, `${modePath}.width`, errors, { integer: true, minimum: 1 });
      finiteNumberAt(mode.height, `${modePath}.height`, errors, { integer: true, minimum: 1 });
      enumAt(mode.orientation, `${modePath}.orientation`, errors, ["portrait", "landscape"]);
    });
  }
}

function validateSigning(value, errors) {
  const path = "signing";
  if (!objectAt(value, path, errors, new Set(["verificationCommand", "signerId", "certificateFingerprint", "profileFingerprint", "expiresAt", "applicationId", "debuggable", "installResult"]))) return;
  stringAt(value.verificationCommand, `${path}.verificationCommand`, errors);
  stringAt(value.signerId, `${path}.signerId`, errors);
  hashAt(value.certificateFingerprint, `${path}.certificateFingerprint`, errors);
  if (value.profileFingerprint !== null) hashAt(value.profileFingerprint, `${path}.profileFingerprint`, errors);
  timestampAt(value.expiresAt, `${path}.expiresAt`, errors);
  stringAt(value.applicationId, `${path}.applicationId`, errors);
  if (value.debuggable !== false) add(errors, `${path}.debuggable`, "must be false for a production artifact");
  enumAt(value.installResult, `${path}.installResult`, errors, ["installed"]);
}

function validatePrerequisite(value, path, errors, candidateSha) {
  if (!objectAt(value, path, errors, new Set(["status", "reportPath", "sha256", "candidateSha", "gateIds"]))) return;
  enumAt(value.status, `${path}.status`, errors, ["pass"]);
  relativePathAt(value.reportPath, `${path}.reportPath`, errors);
  hashAt(value.sha256, `${path}.sha256`, errors);
  commitAt(value.candidateSha, `${path}.candidateSha`, errors);
  if (candidateSha !== undefined && value.candidateSha !== candidateSha) add(errors, `${path}.candidateSha`, `prerequisite candidate SHA mismatch: expected ${candidateSha}, got ${value.candidateSha}`);
  if (!Array.isArray(value.gateIds) || value.gateIds.length === 0) add(errors, `${path}.gateIds`, "must contain at least one gate id");
  else value.gateIds.forEach((gate, index) => stringAt(gate, `${path}.gateIds[${index}]`, errors));
}

function validatePrerequisites(value, errors, options) {
  const path = "prerequisites";
  if (!objectAt(value, path, errors, new Set(REQUIRED_PREREQUISITES))) return;
  for (const key of REQUIRED_PREREQUISITES) {
    if (!required(value[key], `${path}.${key}`, errors)) continue;
    validatePrerequisite(value[key], `${path}.${key}`, errors, options.candidateSha);
  }
  const candidate = options.candidateSha ?? value.prd053?.candidateSha;
  for (const key of REQUIRED_PREREQUISITES) {
    if (value[key]?.candidateSha !== candidate) add(errors, `${path}.${key}.candidateSha`, `must match all prerequisite reports (${candidate ?? "candidate SHA"})`);
  }
}

function validateExecution(value, errors) {
  const path = "execution";
  if (!objectAt(value, path, errors, new Set(["installStartedAt", "launchStartedAt", "pid", "sessionNonce", "readyAt", "firstFrameAt", "frame300At", "frames", "nonBlankCaptureSha256", "gpuErrorCount", "arm64", "nativeGpu", "processLiveness", "assertionCount"]))) return;
  for (const key of ["installStartedAt", "launchStartedAt", "readyAt", "firstFrameAt", "frame300At"]) timestampAt(value[key], `${path}.${key}`, errors);
  finiteNumberAt(value.pid, `${path}.pid`, errors, { integer: true, minimum: 1 });
  stringAt(value.sessionNonce, `${path}.sessionNonce`, errors);
  finiteNumberAt(value.frames, `${path}.frames`, errors, { integer: true, minimum: 300 });
  hashAt(value.nonBlankCaptureSha256, `${path}.nonBlankCaptureSha256`, errors);
  finiteNumberAt(value.gpuErrorCount, `${path}.gpuErrorCount`, errors, { integer: true, minimum: 0 });
  if (value.gpuErrorCount !== 0) add(errors, `${path}.gpuErrorCount`, "must equal zero");
  if (value.arm64 !== true) add(errors, `${path}.arm64`, "must be true");
  if (value.nativeGpu !== true) add(errors, `${path}.nativeGpu`, "must be true; software GPU is not physical evidence");
  booleanAt(value.processLiveness, `${path}.processLiveness`, errors);
  finiteNumberAt(value.assertionCount, `${path}.assertionCount`, errors, { integer: true, minimum: 1 });
  if (value.processLiveness !== true) add(errors, `${path}.processLiveness`, "must be true for a passing physical report");
}

function validateLifecycle(value, errors, execution) {
  const path = "lifecycle";
  if (!objectAt(value, path, errors, new Set(["events", "sameSession", "framesPaused", "framesAdvanced", "maxFrameIntervalMs", "surfaceValidAfterResume", "stateContinuity", "physicsStepDelta", "backgroundGapIntegrated"]))) return;
  if (!Array.isArray(value.events)) add(errors, `${path}.events`, "must be an array");
  else {
    const expected = ["background", "foreground", "supported-rotation", "resume"];
    if (value.events.length !== expected.length) add(errors, `${path}.events`, `must contain ${expected.length} ordered lifecycle observations`);
    value.events.forEach((event, index) => {
      const eventPath = `${path}.events[${index}]`;
      if (!objectAt(event, eventPath, errors, new Set(["phase", "at", "sessionNonce", "pid", "frameCount", "viewport", "surfaceValid", "physicsStepCount"]))) return;
      enumAt(event.phase, `${eventPath}.phase`, errors, expected);
      timestampAt(event.at, `${eventPath}.at`, errors);
      stringAt(event.sessionNonce, `${eventPath}.sessionNonce`, errors);
      if (event.sessionNonce !== execution?.sessionNonce) add(errors, `${eventPath}.sessionNonce`, "must remain stable across lifecycle");
      finiteNumberAt(event.pid, `${eventPath}.pid`, errors, { integer: true, minimum: 1 });
      if (event.pid !== execution?.pid) add(errors, `${eventPath}.pid`, "must remain stable across lifecycle");
      finiteNumberAt(event.frameCount, `${eventPath}.frameCount`, errors, { integer: true, minimum: 0 });
      if (!isRecord(event.viewport)) add(errors, `${eventPath}.viewport`, "must be an object");
      else {
        finiteNumberAt(event.viewport.width, `${eventPath}.viewport.width`, errors, { integer: true, minimum: 1 });
        finiteNumberAt(event.viewport.height, `${eventPath}.viewport.height`, errors, { integer: true, minimum: 1 });
      }
      booleanAt(event.surfaceValid, `${eventPath}.surfaceValid`, errors);
      finiteNumberAt(event.physicsStepCount, `${eventPath}.physicsStepCount`, errors, { integer: true, minimum: 0 });
    });
    for (let index = 0; index < Math.min(value.events.length, 4); index += 1) {
      if (value.events[index]?.phase !== ["background", "foreground", "supported-rotation", "resume"][index]) add(errors, `${path}.events[${index}].phase`, "lifecycle order is invalid");
    }
  }
  booleanAt(value.sameSession, `${path}.sameSession`, errors);
  booleanAt(value.framesPaused, `${path}.framesPaused`, errors);
  booleanAt(value.framesAdvanced, `${path}.framesAdvanced`, errors);
  finiteNumberAt(value.maxFrameIntervalMs, `${path}.maxFrameIntervalMs`, errors, { minimum: 0 });
  booleanAt(value.surfaceValidAfterResume, `${path}.surfaceValidAfterResume`, errors);
  booleanAt(value.stateContinuity, `${path}.stateContinuity`, errors);
  finiteNumberAt(value.physicsStepDelta, `${path}.physicsStepDelta`, errors, { minimum: 0 });
  if (value.backgroundGapIntegrated !== false) add(errors, `${path}.backgroundGapIntegrated`, "must be false");
  if (value.sameSession !== true) add(errors, `${path}.sameSession`, "must be true for a physical resume report");
  if (value.framesPaused !== true) add(errors, `${path}.framesPaused`, "must be true for a physical resume report");
  if (value.framesAdvanced !== true) add(errors, `${path}.framesAdvanced`, "must be true for a physical resume report");
  if (value.surfaceValidAfterResume !== true) add(errors, `${path}.surfaceValidAfterResume`, "must be true for a physical resume report");
  if (value.stateContinuity !== true) add(errors, `${path}.stateContinuity`, "must be true for a physical resume report");
}

function validateMultitouch(value, errors, path) {
  if (!objectAt(value, path, errors, new Set(["status", "reportPath", "reportSha256", "candidateSha", "deviceClass", "maxPointers", "simultaneousMovementAndJump", "onePointerControl"]))) return;
  enumAt(value.status, `${path}.status`, errors, ["pass"]);
  relativePathAt(value.reportPath, `${path}.reportPath`, errors);
  hashAt(value.reportSha256, `${path}.reportSha256`, errors);
  commitAt(value.candidateSha, `${path}.candidateSha`, errors);
  enumAt(value.deviceClass, `${path}.deviceClass`, errors, ["physical"]);
  finiteNumberAt(value.maxPointers, `${path}.maxPointers`, errors, { integer: true, minimum: 2 });
  if (value.maxPointers < 2) add(errors, `${path}.maxPointers`, "physical multitouch requirement failed: maxPointers must be >= 2");
  if (value.simultaneousMovementAndJump !== true) add(errors, `${path}.simultaneousMovementAndJump`, "physical multitouch requirement failed");
  validateControl(value.onePointerControl, `${path}.onePointerControl`, errors, "one-pointer control");
}

function validatePhysics(value, errors, path) {
  if (!objectAt(value, path, errors, new Set(["status", "reportPath", "reportSha256", "candidateSha", "deviceClass", "normalPublicApi", "wrongGravityControl", "wrongHeightControl", "wrongMaskControl"]))) return;
  enumAt(value.status, `${path}.status`, errors, ["pass"]);
  relativePathAt(value.reportPath, `${path}.reportPath`, errors);
  hashAt(value.reportSha256, `${path}.reportSha256`, errors);
  commitAt(value.candidateSha, `${path}.candidateSha`, errors);
  enumAt(value.deviceClass, `${path}.deviceClass`, errors, ["physical"]);
  booleanAt(value.normalPublicApi, `${path}.normalPublicApi`, errors);
  if (value.normalPublicApi !== true) add(errors, `${path}.normalPublicApi`, "native physics scenario failed");
  for (const key of ["wrongGravityControl", "wrongHeightControl", "wrongMaskControl"]) validateControl(value[key], `${path}.${key}`, errors, `native physics ${key.replace(/Control$/u, "")} control`);
}

function validateControl(value, path, errors, label) {
  if (!objectAt(value, path, errors, new Set(["status", "exitCode", "observedRed", "reportSha256"]))) return;
  enumAt(value.status, `${path}.status`, errors, ["fail"]);
  finiteNumberAt(value.exitCode, `${path}.exitCode`, errors, { integer: true });
  if (value.exitCode === 0) add(errors, `${path}.exitCode`, `${label} must have a nonzero exit code`);
  stringAt(value.observedRed, `${path}.observedRed`, errors);
  hashAt(value.reportSha256, `${path}.reportSha256`, errors);
}

function validateCollector(value, path, errors, { numeric = true } = {}) {
  if (!objectAt(value, path, errors, new Set(["available", "source", "unit", "samples", "error"]))) return;
  booleanAt(value.available, `${path}.available`, errors);
  stringAt(value.source, `${path}.source`, errors);
  stringAt(value.unit, `${path}.unit`, errors);
  if (!Array.isArray(value.samples)) add(errors, `${path}.samples`, "must be an array");
  else value.samples.forEach((sample, index) => {
    const samplePath = `${path}.samples[${index}]`;
    if (!objectAt(sample, samplePath, errors, new Set(["at", "value"]))) return;
    timestampAt(sample.at, `${samplePath}.at`, errors);
    if (numeric) finiteNumberAt(sample.value, `${samplePath}.value`, errors);
    else stringAt(sample.value, `${samplePath}.value`, errors);
  });
  if (value.available === true) {
    if (value.samples?.length === 0) add(errors, `${path}.samples`, "available collector must contain samples");
    if (value.error !== null) add(errors, `${path}.error`, "must be null when available");
  } else {
    stringAt(value.error, `${path}.error`, errors);
    if (value.samples?.length > 0) add(errors, `${path}.samples`, "unavailable collector must not contain samples");
  }
}

function validateTelemetry(value, errors) {
  const path = "telemetry";
  if (!objectAt(value, path, errors, new Set(["durationMs", "cadenceMs", "frame", "memory", "thermal", "battery"]))) return;
  finiteNumberAt(value.durationMs, `${path}.durationMs`, errors, { minimum: 1 });
  finiteNumberAt(value.cadenceMs, `${path}.cadenceMs`, errors, { minimum: 1 });
  validateCollector(value.frame, `${path}.frame`, errors);
  validateCollector(value.memory, `${path}.memory`, errors);
  validateCollector(value.thermal, `${path}.thermal`, errors, { numeric: false });
  validateCollector(value.battery, `${path}.battery`, errors);
}

function validateArtifacts(value, errors) {
  const path = "artifacts";
  if (!Array.isArray(value) || value.length === 0) {
    add(errors, path, "must contain at least one artifact");
    return;
  }
  value.forEach((artifact, index) => {
    const artifactPath = `${path}[${index}]`;
    if (!objectAt(artifact, artifactPath, errors, new Set(["path", "sha256", "size", "producerCommand", "retention"]))) return;
    relativePathAt(artifact.path, `${artifactPath}.path`, errors);
    hashAt(artifact.sha256, `${artifactPath}.sha256`, errors);
    finiteNumberAt(artifact.size, `${artifactPath}.size`, errors, { integer: true, minimum: 1 });
    stringAt(artifact.producerCommand, `${artifactPath}.producerCommand`, errors);
    enumAt(artifact.retention, `${artifactPath}.retention`, errors, ["ignored-raw", "committed-summary"]);
  });
}

function validateGateEvidence(value, errors) {
  const path = "gateEvidence";
  if (!Array.isArray(value)) {
    add(errors, path, "must be an array");
    return;
  }
  const seen = new Set();
  value.forEach((gate, index) => {
    const gatePath = `${path}[${index}]`;
    if (!objectAt(gate, gatePath, errors, new Set(["gateId", "finalResult", "negativeControlCommand", "redObservation", "exitCode"]))) return;
    stringAt(gate.gateId, `${gatePath}.gateId`, errors);
    if (seen.has(gate.gateId)) add(errors, `${gatePath}.gateId`, "duplicate gate id");
    seen.add(gate.gateId);
    if (!REQUIRED_GATE_IDS.includes(gate.gateId)) add(errors, `${gatePath}.gateId`, "unknown gate id");
    enumAt(gate.finalResult, `${gatePath}.finalResult`, errors, ["pass"]);
    stringAt(gate.negativeControlCommand, `${gatePath}.negativeControlCommand`, errors);
    stringAt(gate.redObservation, `${gatePath}.redObservation`, errors);
    finiteNumberAt(gate.exitCode, `${gatePath}.exitCode`, errors, { integer: true });
    if (gate.exitCode === 0) add(errors, `${gatePath}.exitCode`, "negative control must have a nonzero exit code");
    if (typeof gate.redObservation === "string" && !/red|fail|reject/iu.test(gate.redObservation)) add(errors, `${gatePath}.redObservation`, "must describe the observed red/rejected control");
  });
  for (const gateId of REQUIRED_GATE_IDS) if (!seen.has(gateId)) add(errors, `${path}.${gateId}`, "required gate evidence is missing");
}

function validateConsumption(value, errors, candidateSha) {
  const path = "consumption";
  if (!objectAt(value, path, errors, new Set(["multitouch", "physics"]))) return;
  validateMultitouch(value.multitouch, errors, `${path}.multitouch`);
  validatePhysics(value.physics, errors, `${path}.physics`);
  for (const key of ["multitouch", "physics"]) if (value[key]?.candidateSha !== candidateSha) add(errors, `${path}.${key}.candidateSha`, `must match candidate SHA ${candidateSha ?? "from source"}`);
}

export function validatePhysicalDeviceEvidence(evidence, options = {}) {
  const errors = [];
  if (!objectAt(evidence, "evidence", errors, ROOT_KEYS)) return { valid: false, errors };
  if (evidence.schemaVersion !== 1) add(errors, "schemaVersion", "must equal 1");
  validateIdentity(evidence.identity, errors);
  validateSource(evidence.source, errors, options);
  validateDevice(evidence.device, errors, options);
  validateSigning(evidence.signing, errors);
  const candidateSha = options.candidateSha ?? evidence.source?.headSha;
  validatePrerequisites(evidence.prerequisites, errors, { candidateSha });
  validateExecution(evidence.execution, errors);
  validateLifecycle(evidence.lifecycle, errors, evidence.execution);
  validateConsumption(evidence.consumption, errors, candidateSha);
  validateTelemetry(evidence.telemetry, errors);
  validateArtifacts(evidence.artifacts, errors);
  validateGateEvidence(evidence.gateEvidence, errors);
  if (evidence.identity?.verdict === "pass" && evidence.identity?.blockers?.length > 0) add(errors, "identity.blockers", "a pass report cannot contain blockers");
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function assertValidPhysicalDeviceEvidence(evidence, options = {}) {
  const result = validatePhysicalDeviceEvidence(evidence, options);
  if (!result.valid) throw new EvidenceValidationError(result.errors);
  return evidence;
}

export function physicalDeviceEvidenceV1(evidence, options = {}) {
  return validatePhysicalDeviceEvidence(evidence, options);
}

physicalDeviceEvidenceV1.schema = PHYSICAL_EVIDENCE_SCHEMA;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256File(path) {
  return sha256(readFileSync(path));
}

export function hashIdentifier(identifier) {
  return sha256(identifier);
}

function deepMerge(base, overrides) {
  if (!isRecord(overrides)) return base;
  for (const [key, value] of Object.entries(overrides)) {
    if (isRecord(value) && isRecord(base[key])) deepMerge(base[key], value);
    else base[key] = value;
  }
  return base;
}

const sampleAt = "2026-08-09T00:00:00.000Z";
const sampleHash = "a".repeat(64);

export function createEvidenceFixture({ platform = "android", candidateSha = "8bcf0553f38655b8db425d64f37cd19ff4db7034", identifier = "physical-device-056", overrides = {} } = {}) {
  const isAndroid = platform === "android";
  const fixture = {
    schemaVersion: 1,
    identity: {
      schemaVersion: 1,
      runId: `prd056-${platform}-fixture`,
      startedAt: sampleAt,
      endedAt: "2026-08-09T00:00:30.000Z",
      verdict: "pass",
      blockers: [],
      evidenceClass: "physical-device",
    },
    source: {
      remote: "https://github.com/jonit-dev/threenative.git",
      branch: "main",
      headSha: candidateSha,
      worktree: "clean",
      artifactSourceSha: candidateSha,
      packageVersion: "0.1.13",
      artifactSha256: sampleHash,
      releaseRun: null,
      publishedPackage: null,
      promotedConsumer: null,
    },
    device: {
      platform,
      kind: "physical",
      identifierHash: hashIdentifier(identifier),
      name: isAndroid ? "Fixture Android" : "Fixture iPhone",
      manufacturer: isAndroid ? "Fixture OEM" : "Apple",
      model: isAndroid ? "Fixture Arm64" : "iPhone Fixture",
      osVersion: isAndroid ? "15" : "18.6",
      osBuild: isAndroid ? "AP4A.250000.000" : "22G000",
      cpuAbi: isAndroid ? "arm64-v8a" : "arm64",
      gpu: isAndroid ? "Adreno (TM) 740" : "Apple GPU",
      driver: isAndroid ? "Vulkan physical driver" : "Metal device driver",
      screenModes: [{ width: 1920, height: 1080, orientation: "landscape" }],
    },
    signing: {
      verificationCommand: isAndroid ? "apksigner verify --print-certs candidate.apk" : "codesign --verify --strict --deep candidate.app",
      signerId: isAndroid ? "android-signer-fixture" : "apple-team-fixture",
      certificateFingerprint: sampleHash,
      profileFingerprint: isAndroid ? null : sampleHash,
      expiresAt: "2027-08-09T00:00:00.000Z",
      applicationId: isAndroid ? "com.threenative.game" : "dev.threenative.runtime",
      debuggable: false,
      installResult: "installed",
    },
    prerequisites: Object.fromEntries(REQUIRED_PREREQUISITES.map((key) => [key, {
      status: "pass",
      reportPath: `.runtime/prd056/${platform}/${key}.json`,
      sha256: sampleHash,
      candidateSha,
      gateIds: [key],
    }])),
    execution: {
      installStartedAt: sampleAt,
      launchStartedAt: "2026-08-09T00:00:01.000Z",
      pid: 5600,
      sessionNonce: `fixture-session-${platform}`,
      readyAt: "2026-08-09T00:00:02.000Z",
      firstFrameAt: "2026-08-09T00:00:02.100Z",
      frame300At: "2026-08-09T00:00:07.100Z",
      frames: 300,
      nonBlankCaptureSha256: sampleHash,
      gpuErrorCount: 0,
      arm64: true,
      nativeGpu: true,
      processLiveness: true,
      assertionCount: 12,
    },
    lifecycle: {
      events: ["background", "foreground", "supported-rotation", "resume"].map((phase, index) => ({
        phase,
        at: `2026-08-09T00:00:${String(10 + index).padStart(2, "0")}.000Z`,
        sessionNonce: `fixture-session-${platform}`,
        pid: 5600,
        frameCount: 300 + index,
        viewport: { width: 1920, height: 1080 },
        surfaceValid: phase !== "background",
        physicsStepCount: 0,
      })),
      sameSession: true,
      framesPaused: true,
      framesAdvanced: true,
      maxFrameIntervalMs: 33,
      surfaceValidAfterResume: true,
      stateContinuity: true,
      physicsStepDelta: 0,
      backgroundGapIntegrated: false,
    },
    consumption: {
      multitouch: {
        status: "pass",
        reportPath: `.runtime/prd056/${platform}/prd053.json`,
        reportSha256: sampleHash,
        candidateSha,
        deviceClass: "physical",
        maxPointers: 2,
        simultaneousMovementAndJump: true,
        onePointerControl: { status: "fail", exitCode: 1, observedRed: "RED observed: one-pointer control assertion failed", reportSha256: sampleHash },
      },
      physics: {
        status: "pass",
        reportPath: `.runtime/prd056/${platform}/prd046.json`,
        reportSha256: sampleHash,
        candidateSha,
        deviceClass: "physical",
        normalPublicApi: true,
        wrongGravityControl: { status: "fail", exitCode: 1, observedRed: "RED observed: wrong gravity control failed", reportSha256: sampleHash },
        wrongHeightControl: { status: "fail", exitCode: 1, observedRed: "RED observed: wrong height control failed", reportSha256: sampleHash },
        wrongMaskControl: { status: "fail", exitCode: 1, observedRed: "RED observed: wrong mask control failed", reportSha256: sampleHash },
      },
    },
    telemetry: {
      durationMs: 30000,
      cadenceMs: 1000,
      frame: { available: true, source: "fixture frame collector", unit: "ms", samples: [{ at: sampleAt, value: 16.7 }], error: null },
      memory: { available: true, source: isAndroid ? "adb shell dumpsys meminfo" : "devicectl process memory", unit: "bytes", samples: [{ at: sampleAt, value: 1000000 }], error: null },
      thermal: { available: true, source: isAndroid ? "adb shell dumpsys thermalservice" : "ProcessInfo thermal state", unit: "state", samples: [{ at: sampleAt, value: "nominal" }], error: null },
      battery: { available: true, source: isAndroid ? "adb shell dumpsys battery" : "IOKit/ProcessInfo battery bridge", unit: "percent", samples: [{ at: sampleAt, value: 90 }], error: null },
    },
    artifacts: [{ path: `.runtime/prd056/${platform}/raw-report.json`, sha256: sampleHash, size: 1, producerCommand: "native:qualify:physical", retention: "ignored-raw" }],
    gateEvidence: REQUIRED_GATE_IDS.map((gateId) => ({
      gateId,
      finalResult: "pass",
      negativeControlCommand: `native:qualify:physical --control ${gateId}`,
      redObservation: `RED observed: ${gateId} control failed closed`,
      exitCode: 1,
    })),
  };
  return deepMerge(fixture, overrides);
}

function jsonFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...jsonFiles(path));
    else if (entry.endsWith(".json")) files.push(path);
  }
  return files;
}

export function rollupPhysicalDeviceEvidence(directory, candidateSha) {
  const files = jsonFiles(directory).filter((path) => !["summary.json", "rollup.json", "qualification-result.json"].includes(path.split(sep).pop()));
  if (files.length === 0) return { status: "blocked", code: "TN_QUALIFY_PREREQUISITE_REPORT_MISSING", blockers: ["android physical evidence report is absent", "ios physical evidence report is absent"], reports: [] };
  const reports = [];
  const errors = [];
  for (const path of files) {
    let evidence;
    try {
      evidence = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      errors.push(`${relative(directory, path).split(sep).join("/")}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const validation = validatePhysicalDeviceEvidence(evidence, { candidateSha });
    if (!validation.valid) errors.push(...validation.errors.map((error) => `${relative(directory, path).split(sep).join("/")}: ${error}`));
    reports.push({ path, evidence });
  }
  if (errors.length > 0) return { status: "fail", code: "TN_QUALIFY_EVIDENCE_INVALID", errors, reports };
  const byPlatform = new Map();
  for (const { path, evidence } of reports) {
    const platform = evidence.device.platform;
    if (byPlatform.has(platform)) {
      errors.push(`${relative(directory, path).split(sep).join("/")}: duplicate ${platform} physical evidence report`);
    } else {
      byPlatform.set(platform, evidence);
    }
  }
  if (errors.length > 0) return { status: "fail", code: "TN_QUALIFY_EVIDENCE_INVALID", errors, reports };
  const blockers = [];
  for (const platform of ["android", "ios"]) {
    const report = byPlatform.get(platform);
    if (!report) blockers.push(`${platform} physical evidence report is absent`);
    else if (report.identity.verdict !== "pass") blockers.push(`${platform} report verdict is ${report.identity.verdict}`);
  }
  if (blockers.length > 0) return { status: "blocked", code: "TN_QUALIFY_PREREQUISITE_REPORT_MISSING", blockers, reports };
  return { status: "pass", code: "TN_QUALIFY_ROLLUP_PASS", reports };
}
