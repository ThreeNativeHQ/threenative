#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  REQUIRED_PREREQUISITES,
  assertValidPhysicalDeviceEvidence,
  hashIdentifier,
  rollupPhysicalDeviceEvidence,
  sha256File,
  validatePhysicalDeviceEvidence,
} from "./physical-device-evidence.mjs";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(runtimeRoot, "..", "..");
const defaultScenario = joinPath(workspaceRoot, "examples/native-smoke/playtests/physical-mobile-lifecycle.playtest.json");
const commitPattern = /^[0-9a-f]{7,64}$/iu;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const REQUIRED_PREREQUISITE_REPORT_CONTROLS = {
  prd053: 1,
  prd054: 1,
  prd046: 3,
  prd048: 1,
};
const PREREQUISITE_REPORT_KEYS = new Set([
  "schemaVersion",
  "reportType",
  "status",
  "verdict",
  "candidateSha",
  "sourceSha",
  "source",
  "target",
  "platform",
  "device",
  "artifactSha256",
  "artifact",
  "packageVersion",
  "negativeControls",
  "gateEvidence",
  "gateIds",
  "results",
  "observations",
  "consumption",
]);

export class QualificationError extends Error {
  constructor(message, { code = "TN_QUALIFY_BLOCKED", status = "blocked", details = [] } = {}) {
    super(message);
    this.name = "QualificationError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function joinPath(...parts) {
  return parts.join("/").replaceAll("//", "/");
}

function usage() {
  return `Usage: pnpm native:qualify:physical [options]

Qualifies one supplied production artifact on one named physical device.
The command never builds or signs an artifact. Raw output must stay under .runtime/prd056/.

Required execution options:
  --platform android|ios       physical target
  --device ID                  named physical device identifier
  --android-app PATH           production-signed APK (Android)
  --ios-app PATH               signed/provisioned .app (iOS)
  --candidate-sha SHA          exact source SHA for the candidate
  --out PATH                   ignored raw output directory

Prerequisite options:
  --prerequisite NAME=PATH     repeat for prd053, prd054, prd046, and prd048
  --prd053-report PATH         shorthand prerequisite report path
  --prd054-report PATH         shorthand prerequisite report path
  --prd046-report PATH         shorthand prerequisite report path
  --prd048-report PATH         shorthand prerequisite report path

Evidence and controls:
  --validate-fixture PATH      validate one physicalDeviceEvidenceV1 document
  --rollup PATH                require passing Android and iOS reports below PATH
  --artifact-provenance PATH   supplied artifact provenance sidecar
  --ios-telemetry PATH         signed iOS collector report from the app bridge (including processPid)
  --gate-evidence PATH         observed-red control evidence for this run
  --duration-ms N              declared telemetry duration (default: 30000)
  --cadence-ms N               declared telemetry cadence (default: 1000)
  --control NAME               run one declared negative control
  --help                       print this help

Exit codes:
  0  validated pass
  1  observed schema or behavioral failure
  2  blocked by missing/invalid external infrastructure or identity
`;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || (value.startsWith("--") && flag !== "--browser-arg")) {
    throw new QualificationError(`${flag} requires a value.`, { code: "TN_QUALIFY_ARGUMENT" });
  }
  return value;
}

function resolvePath(value, cwd) {
  const base = existsSync(joinPath(cwd, "pnpm-workspace.yaml")) ? cwd : workspaceRoot;
  return resolve(base, value);
}

function commitSha(value, flag) {
  if (!commitPattern.test(value)) throw new QualificationError(`${flag} must be a git SHA.`, { code: "TN_QUALIFY_ARGUMENT" });
  return value;
}

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new QualificationError(`${flag} must be a positive integer.`, { code: "TN_QUALIFY_ARGUMENT" });
  return parsed;
}

function prerequisiteName(value) {
  const normalized = value.toLowerCase().replaceAll("-", "");
  const found = REQUIRED_PREREQUISITES.find((name) => name.replace("prd", "prd") === normalized || name === normalized || `prd${name.slice(3)}` === normalized);
  if (found === undefined) throw new QualificationError(`Unknown prerequisite '${value}'. Expected prd053, prd054, prd046, or prd048.`, { code: "TN_QUALIFY_ARGUMENT" });
  return found;
}

export function parseArgs(argv, cwd = process.cwd()) {
  const options = {
    platform: null,
    device: null,
    app: null,
    candidateSha: null,
    out: resolvePath(".runtime/prd056/run", cwd),
    durationMs: 30_000,
    cadenceMs: 1_000,
    prerequisiteReports: {},
    validateFixture: null,
    rollup: null,
    artifactProvenance: null,
    iosTelemetry: null,
    gateEvidence: null,
    control: null,
    help: false,
  };
  const platformApps = new Map([
    ["--android-app", "android"],
    ["--ios-app", "ios"],
  ]);
  const prerequisiteFlags = new Map([
    ["--prd053-report", "prd053"],
    ["--prd054-report", "prd054"],
    ["--prd046-report", "prd046"],
    ["--prd048-report", "prd048"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--platform") {
      const value = requireValue(argv, index, arg);
      if (value !== "android" && value !== "ios") throw new QualificationError(`Unknown platform '${value}'.`, { code: "TN_QUALIFY_ARGUMENT" });
      options.platform = value;
      index += 1;
    } else if (arg === "--device") {
      options.device = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--app" || platformApps.has(arg)) {
      const value = resolvePath(requireValue(argv, index, arg), cwd);
      if (platformApps.has(arg) && options.platform !== null && options.platform !== platformApps.get(arg)) throw new QualificationError(`${arg} does not match --platform ${options.platform}.`, { code: "TN_QUALIFY_ARGUMENT" });
      options.app = value;
      index += 1;
    } else if (arg === "--candidate-sha") {
      options.candidateSha = commitSha(requireValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--out") {
      options.out = resolvePath(requireValue(argv, index, arg), cwd);
      index += 1;
    } else if (arg === "--duration-ms" || arg === "--duration") {
      options.durationMs = positiveInteger(requireValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--cadence-ms") {
      options.cadenceMs = positiveInteger(requireValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--prerequisite") {
      const value = requireValue(argv, index, arg);
      const separator = value.indexOf("=");
      if (separator <= 0 || separator === value.length - 1) throw new QualificationError("--prerequisite requires NAME=PATH.", { code: "TN_QUALIFY_ARGUMENT" });
      options.prerequisiteReports[prerequisiteName(value.slice(0, separator))] = resolvePath(value.slice(separator + 1), cwd);
      index += 1;
    } else if (prerequisiteFlags.has(arg)) {
      options.prerequisiteReports[prerequisiteFlags.get(arg)] = resolvePath(requireValue(argv, index, arg), cwd);
      index += 1;
    } else if (arg === "--validate-fixture") {
      options.validateFixture = resolvePath(requireValue(argv, index, arg), cwd);
      index += 1;
    } else if (arg === "--rollup") {
      options.rollup = resolvePath(requireValue(argv, index, arg), cwd);
      index += 1;
    } else if (arg === "--artifact-provenance") {
      options.artifactProvenance = resolvePath(requireValue(argv, index, arg), cwd);
      index += 1;
    } else if (arg === "--ios-telemetry") {
      options.iosTelemetry = resolvePath(requireValue(argv, index, arg), cwd);
      index += 1;
    } else if (arg === "--gate-evidence") {
      options.gateEvidence = resolvePath(requireValue(argv, index, arg), cwd);
      index += 1;
    } else if (arg === "--control") {
      options.control = requireValue(argv, index, arg);
      index += 1;
    } else {
      throw new QualificationError(`Unknown option ${arg}. Run with --help.`, { code: "TN_QUALIFY_ARGUMENT" });
    }
  }
  if (options.validateFixture !== null && options.rollup !== null) throw new QualificationError("--validate-fixture and --rollup are mutually exclusive.", { code: "TN_QUALIFY_ARGUMENT" });
  if (options.out.includes(".runtime/prd056/") === false && !options.out.endsWith(".runtime/prd056")) throw new QualificationError("--out must remain under ignored .runtime/prd056/.", { code: "TN_QUALIFY_ARGUMENT" });
  if (options.platform === null && options.app !== null && basename(options.app).endsWith(".apk")) options.platform = "android";
  if (options.platform === null && options.app !== null && basename(options.app).endsWith(".app")) options.platform = "ios";
  return options;
}

export function classifyPhysicalDevice(platform, device) {
  if (device === null || device === undefined || device.length === 0) return { kind: "missing", code: "TN_QUALIFY_PHYSICAL_DEVICE_REQUIRED" };
  if (platform === "android" && (/^emulator-/iu.test(device) || /(?:^|[-_])(?:sim|simulator)(?:$|[-_])/iu.test(device))) return { kind: "emulator", code: "TN_QUALIFY_PHYSICAL_DEVICE_REQUIRED" };
  if (platform === "ios" && /^(?:booted|simulator|simctl)|simulator/iu.test(device)) return { kind: "simulator", code: "TN_QUALIFY_PHYSICAL_DEVICE_REQUIRED" };
  return { kind: "physical-candidate", code: null };
}

function command(executable, args, { cwd = workspaceRoot, env = process.env, timeout = 30_000 } = {}) {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", env, timeout, maxBuffer: 16 * 1024 * 1024 });
  return {
    status: result.status === null ? 1 : result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

/**
 * The Android SDK's own layout, searched after `PATH` fails.
 *
 * An SDK installed by Android Studio puts nothing on `PATH`. Without this, `apksigner` reports as
 * unavailable while sitting in `build-tools/`, and the qualification refuses with
 * `TN_QUALIFY_SIGNING_TOOL_REQUIRED` — a missing-capability error for a tool that is installed.
 *
 * That distinction is the whole point of this file's exit codes: **"blocked, tool unavailable" reads
 * identically whether the tool is absent or merely unfound, and only one of those is a blocker.**
 * `scripts/engine-load-test/run-android.ts` already does this for `adb`, with the same reason.
 */
function androidSdkCandidates(name, env) {
  const roots = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, joinPath(env.HOME ?? "", "Android/Sdk")]
    .filter((root) => typeof root === "string" && root.length > 0 && existsSync(root));
  const candidates = [];
  for (const root of roots) {
    candidates.push(joinPath(root, "platform-tools", name));
    candidates.push(joinPath(root, "tools", "bin", name));
    const buildTools = joinPath(root, "build-tools");
    if (!existsSync(buildTools)) continue;
    // Newest build-tools first. `localeCompare` with `numeric` orders 36.0.0 above 9.0.0, which a
    // plain string sort does not.
    const versions = readdirSync(buildTools).sort((left, right) =>
      right.localeCompare(left, "en", { numeric: true }),
    );
    for (const version of versions) candidates.push(joinPath(buildTools, version, name));
  }
  return candidates;
}

export function findExecutable(name, env = process.env) {
  const override = env[`THREENATIVE_${name.toUpperCase()}`];
  if (override !== undefined && existsSync(override)) return override;
  const pathValue = env.PATH ?? "";
  for (const directory of pathValue.split(":")) {
    if (directory.length === 0) continue;
    const candidate = joinPath(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  for (const candidate of androidSdkCandidates(name, env))
    if (existsSync(candidate)) return candidate;
  return null;
}

function sourceIdentity(cwd = workspaceRoot) {
  const head = command("git", ["rev-parse", "--verify", "HEAD"], { cwd });
  if (head.status !== 0) throw new QualificationError(`Cannot read candidate HEAD: ${head.stderr || head.stdout || "git failed"}.`, { code: "TN_QUALIFY_SOURCE_BLOCKED" });
  const status = command("git", ["status", "--porcelain"], { cwd });
  const branch = command("git", ["branch", "--show-current"], { cwd });
  const remote = command("git", ["config", "--get", "remote.origin.url"], { cwd });
  const headSha = head.stdout.trim();
  let packageVersion = "unknown";
  try {
    packageVersion = JSON.parse(readFileSync(join(cwd, "packages/runtime-native/package.json"), "utf8")).version;
  } catch {
    // The source identity remains useful when package metadata is unavailable; the artifact
    // provenance check below still has to supply a real package version for a pass report.
  }
  return {
    remote: remote.stdout.trim() || "unknown",
    branch: branch.stdout.trim() || "detached",
    headSha,
    worktree: status.stdout.trim().length === 0 ? "clean" : "dirty",
    packageVersion: typeof packageVersion === "string" && packageVersion.length > 0 ? packageVersion : "unknown",
  };
}

function missingPrerequisiteBlockers(options) {
  return REQUIRED_PREREQUISITES.filter((name) => options.prerequisiteReports?.[name] === undefined).map((name) => `${name} prerequisite report is required`);
}

function appFlag(platform) {
  return platform === "android" ? "--android-app" : "--ios-app";
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function prerequisiteCandidateSha(report) {
  return report.candidateSha ?? report.sourceSha ?? report.source?.headSha;
}

function prerequisiteArtifactSha(report) {
  return report.artifactSha256 ?? report.artifact?.sha256;
}

function normalizePrerequisiteControls(name, value, errors) {
  const controls = value.negativeControls ?? value.gateEvidence;
  if (!Array.isArray(controls) || controls.length === 0) {
    errors.push(`${name}.negativeControls: required negative-control evidence is missing`);
    return [];
  }
  const normalized = [];
  controls.forEach((control, index) => {
    const path = `${name}.negativeControls[${index}]`;
    if (!isRecord(control)) {
      errors.push(`${path}: must be an object`);
      return;
    }
    const allowed = new Set(["id", "gateId", "status", "finalResult", "command", "negativeControlCommand", "observedRed", "redObservation", "exitCode", "reportSha256"]);
    for (const key of Object.keys(control)) if (!allowed.has(key)) errors.push(`${path}.${key}: unknown field`);
    const id = control.id ?? control.gateId;
    const status = control.status ?? control.finalResult;
    const commandText = control.command ?? control.negativeControlCommand;
    const observedRed = control.observedRed ?? control.redObservation;
    if (typeof id !== "string" || id.length === 0) errors.push(`${path}.id: must be a non-empty string`);
    if (status !== "fail" && !(control.finalResult === "pass" && control.exitCode !== 0)) errors.push(`${path}.status: negative control must be observed red`);
    if (typeof commandText !== "string" || commandText.length === 0) errors.push(`${path}.command: must be a non-empty string`);
    if (typeof observedRed !== "string" || observedRed.length === 0) errors.push(`${path}.observedRed: observed red result is required`);
    if (typeof observedRed === "string" && !/red|fail|reject|error/iu.test(observedRed)) errors.push(`${path}.observedRed: must describe the observed red/rejected control`);
    if (!Number.isInteger(control.exitCode) || control.exitCode === 0) errors.push(`${path}.exitCode: negative control must have a nonzero integer exit code`);
    if (control.reportSha256 !== undefined && (typeof control.reportSha256 !== "string" || !sha256Pattern.test(control.reportSha256))) errors.push(`${path}.reportSha256: must be a SHA-256 digest when supplied`);
    normalized.push({
      gateId: id,
      finalResult: "pass",
      negativeControlCommand: commandText,
      redObservation: observedRed,
      exitCode: control.exitCode,
      reportSha256: control.reportSha256,
    });
  });
  const minimum = REQUIRED_PREREQUISITE_REPORT_CONTROLS[name];
  if (normalized.length < minimum) errors.push(`${name}.negativeControls: requires at least ${minimum} observed-red controls`);
  return normalized;
}

export function validatePrerequisiteReport(name, report, {
  candidateSha,
  platform,
  deviceIdentifierHash,
  artifactSha256,
} = {}) {
  const errors = [];
  if (!REQUIRED_PREREQUISITES.includes(name)) errors.push(`${name}: unknown prerequisite`);
  if (!isRecord(report)) return { valid: false, errors: [`${name}: report must be an object`] };
  for (const key of Object.keys(report)) if (!PREREQUISITE_REPORT_KEYS.has(key)) errors.push(`${name}.${key}: unknown field`);
  if (report.schemaVersion !== 1) errors.push(`${name}.schemaVersion: must equal 1`);
  if (report.reportType !== name) errors.push(`${name}.reportType: must equal ${name}`);
  if (report.status !== "pass") errors.push(`${name}.status: report must be pass`);
  const candidateValues = [report.candidateSha, report.sourceSha, report.source?.headSha].filter((value) => value !== undefined);
  const reportCandidateSha = prerequisiteCandidateSha(report);
  if (new Set(candidateValues).size > 1) errors.push(`${name}.candidateSha: report contains inconsistent source SHA fields`);
  if (typeof reportCandidateSha !== "string" || !commitPattern.test(reportCandidateSha)) errors.push(`${name}.candidateSha: report must contain a git SHA`);
  else if (candidateSha !== undefined && reportCandidateSha !== candidateSha) errors.push(`${name}.candidateSha: expected ${candidateSha}, got ${reportCandidateSha}`);
  const targetValues = [report.target, report.platform].filter((value) => value !== undefined);
  const reportTarget = report.target ?? report.platform;
  if (targetValues.length === 0 || new Set(targetValues).size > 1 || reportTarget !== platform) errors.push(`${name}.target: expected ${platform}, got ${reportTarget ?? "missing"}`);
  if (!isRecord(report.device)) errors.push(`${name}.device: physical device identity is required`);
  else {
    const deviceKeys = new Set(["kind", "platform", "identifierHash", "idHash", "name", "manufacturer", "model", "osVersion", "osBuild", "cpuAbi", "gpu", "driver"]);
    for (const key of Object.keys(report.device)) if (!deviceKeys.has(key)) errors.push(`${name}.device.${key}: unknown field`);
    if (report.device.kind !== "physical") errors.push(`${name}.device.kind: must be physical`);
    if (report.device.platform !== platform) errors.push(`${name}.device.platform: expected ${platform}`);
    const reportIdentifierHash = report.device.identifierHash ?? report.device.idHash;
    if (typeof reportIdentifierHash !== "string" || !sha256Pattern.test(reportIdentifierHash)) errors.push(`${name}.device.identifierHash: physical device hash is required`);
    else if (deviceIdentifierHash !== undefined && reportIdentifierHash !== deviceIdentifierHash) errors.push(`${name}.device.identifierHash: does not match the supplied device`);
  }
  const artifactValues = [report.artifactSha256, report.artifact?.sha256].filter((value) => value !== undefined);
  const reportArtifactSha = prerequisiteArtifactSha(report);
  if (new Set(artifactValues).size > 1) errors.push(`${name}.artifactSha256: report contains inconsistent artifact SHA fields`);
  if (typeof reportArtifactSha !== "string" || !sha256Pattern.test(reportArtifactSha)) errors.push(`${name}.artifactSha256: artifact SHA-256 is required`);
  else if (artifactSha256 !== undefined && reportArtifactSha !== artifactSha256) errors.push(`${name}.artifactSha256: does not match the supplied artifact`);
  const controls = normalizePrerequisiteControls(name, report, errors);
  return {
    valid: errors.length === 0,
    errors,
    candidateSha: reportCandidateSha,
    artifactSha256: reportArtifactSha,
    controls,
  };
}

function readPrerequisiteReports(options, { candidateSha, platform, deviceIdentifierHash, artifactSha256 } = {}) {
  const records = {};
  const errors = [];
  for (const name of REQUIRED_PREREQUISITES) {
    const path = options.prerequisiteReports?.[name];
    if (path === undefined) {
      errors.push(`${name} prerequisite report is required`);
      continue;
    }
    if (!existsSync(path)) {
      errors.push(`${name} prerequisite report is missing at ${path}`);
      continue;
    }
    let report;
    try {
      report = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      errors.push(`${name} prerequisite report is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const validation = validatePrerequisiteReport(name, report, { candidateSha, platform, deviceIdentifierHash, artifactSha256 });
    if (!validation.valid) errors.push(...validation.errors);
    records[name] = { path, report, validation, sha256: sha256File(path) };
  }
  return { valid: errors.length === 0, errors, records };
}

export function preflight(options, {
  cwd = workspaceRoot,
  source = undefined,
  artifactSha256 = undefined,
  artifactSourceSha = undefined,
} = {}) {
  const blockers = [];
  const platform = options.platform;
  const identity = classifyPhysicalDevice(platform, options.device);
  if (platform === null) blockers.push("--platform android|ios is required");
  if (identity.kind === "missing") blockers.push(`${platform ?? "physical"} device identifier is required`);
  if (identity.kind === "emulator" || identity.kind === "simulator") blockers.push(`${identity.code}: ${options.device} is not a physical device`);
  if (options.app === null) blockers.push(`${appFlag(platform ?? "android")} signed artifact path is required`);
  if (options.candidateSha === null) blockers.push("--candidate-sha is required");
  blockers.push(...missingPrerequisiteBlockers(options));
  if (!options.out.includes(".runtime/prd056/") && !options.out.endsWith(".runtime/prd056")) blockers.push("raw output must be ignored under .runtime/prd056/");
  if (identity.kind === "emulator" || identity.kind === "simulator") return { status: "blocked", code: identity.code, blockers, source: null };
  if (blockers.length > 0 && options.candidateSha === null) return { status: "blocked", code: "TN_QUALIFY_INPUT_REQUIRED", blockers, source: null };
  const resolvedSource = source ?? sourceIdentity(cwd);
  if (resolvedSource.headSha !== options.candidateSha) blockers.push(`candidate SHA mismatch: requested ${options.candidateSha}, checkout HEAD ${resolvedSource.headSha}`);
  if (resolvedSource.worktree !== "clean") blockers.push("source worktree is dirty; physical evidence requires committed HEAD");
  if (options.app !== null && !existsSync(options.app)) blockers.push(`signed artifact is missing at ${options.app}`);
  if (typeof artifactSha256 !== "string" || !sha256Pattern.test(artifactSha256)) blockers.push("supplied artifact SHA-256 provenance is required");
  if (typeof artifactSourceSha !== "string" || !commitPattern.test(artifactSourceSha)) blockers.push("supplied artifact source SHA provenance is required");
  else if (artifactSourceSha !== options.candidateSha) blockers.push(`artifact source SHA mismatch: expected ${options.candidateSha}, got ${artifactSourceSha}`);
  const prerequisiteResult = readPrerequisiteReports(options, {
    candidateSha: options.candidateSha,
    platform,
    deviceIdentifierHash: options.device === null || options.device === undefined ? undefined : hashIdentifier(options.device),
    artifactSha256,
  });
  blockers.push(...prerequisiteResult.errors);
  return {
    status: blockers.length === 0 ? "pass" : "blocked",
    code: blockers.length === 0 ? "TN_QUALIFY_PREFLIGHT_PASS" : "TN_QUALIFY_PREFLIGHT_BLOCKED",
    blockers,
    source: resolvedSource,
    artifactSha256,
    prerequisites: prerequisiteResult.records,
  };
}

function resultFor(status, code, fields = {}) {
  return { status, code, ...fields };
}

function resultFromQualificationError(error) {
  return error instanceof QualificationError
    ? resultFor(error.status, error.code, { errors: [error.message, ...error.details] })
    : resultFor("fail", "TN_QUALIFY_UNEXPECTED", { errors: [error instanceof Error ? error.message : String(error)] });
}

function lifecycleControl(options) {
  const validation = evaluateLifecycleObservation(options.controlObservation);
  return validation.valid
    ? resultFor("pass", "TN_QUALIFY_CONTROL_GREEN", { observation: "lifecycle continuity guard accepted the supplied observation" })
    : resultFor("fail", "TN_QUALIFY_LIFECYCLE_CONTINUITY", { errors: validation.errors });
}

function unsignedArtifactControl(options, dependencies) {
  try {
    const artifact = options.platform === "android"
      ? verifyAndroidArtifact(options.app, options.candidateSha, { ...dependencies, artifactProvenance: options.artifactProvenance })
      : verifyIosArtifact(options.app, options.candidateSha, { ...dependencies, artifactProvenance: options.artifactProvenance });
    return resultFor("fail", "TN_QUALIFY_CONTROL_NOT_TRIGGERED", { errors: [`unsigned-artifact control accepted supplied artifact ${artifact.artifactSha256}`] });
  } catch (error) {
    return resultFromQualificationError(error);
  }
}

function missingPrerequisiteControl(options) {
  const result = readPrerequisiteReports(options, {
    candidateSha: options.candidateSha ?? undefined,
    platform: options.platform,
    deviceIdentifierHash: options.device === null || options.device === undefined ? undefined : hashIdentifier(options.device),
  });
  return result.valid
    ? resultFor("fail", "TN_QUALIFY_CONTROL_NOT_TRIGGERED", { errors: ["missing-prerequisite control had no missing or malformed prerequisite"] })
    : resultFor("blocked", "TN_QUALIFY_PREREQUISITE_REPORT_MISSING", { blockers: result.errors });
}

function writeResult(out, result) {
  mkdirSync(out, { recursive: true });
  writeFileSync(joinPath(out, "qualification-result.json"), `${JSON.stringify(result, null, 2)}\n`);
}

export function validateFixture(path) {
  if (!existsSync(path)) return resultFor("blocked", "TN_QUALIFY_FIXTURE_MISSING", { errors: [`fixture is missing: ${path}`] });
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return resultFor("fail", "TN_QUALIFY_EVIDENCE_INVALID", { errors: [error instanceof Error ? error.message : String(error)] });
  }
  const validation = validatePhysicalDeviceEvidence(evidence);
  return validation.valid
    ? resultFor("pass", "TN_QUALIFY_EVIDENCE_PASS", { report: path })
    : resultFor("fail", "TN_QUALIFY_EVIDENCE_INVALID", { errors: validation.errors, report: path });
}

function artifactSha(path) {
  try {
    if (statSync(path).isFile()) return sha256File(path);
    const hash = createHash("sha256");
    const visit = (directory, prefix = "") => {
      for (const entry of readdirSync(directory).sort()) {
        const child = join(directory, entry);
        const childRelative = prefix.length === 0 ? entry : `${prefix}/${entry}`;
        if (statSync(child).isDirectory()) visit(child, childRelative);
        else {
          hash.update(childRelative);
          hash.update("\0");
          hash.update(readFileSync(child));
        }
      }
    };
    visit(path);
    return hash.digest("hex");
  } catch (error) {
    throw new QualificationError(`Cannot hash supplied artifact: ${error instanceof Error ? error.message : String(error)}.`, { code: "TN_QUALIFY_ARTIFACT_BLOCKED" });
  }
}

function artifactProvenanceCandidates(path, explicitPath = null) {
  return [
    explicitPath,
    `${path}.provenance.json`,
    join(dirname(path), "artifact-provenance.json"),
    path.endsWith(".app") ? join(path, "Contents/Resources/threenative-artifact-provenance.json") : null,
  ].filter((candidate, index, values) => candidate !== null && values.indexOf(candidate) === index);
}

function readArtifactProvenanceDocument(path, explicitPath) {
  const provenancePath = artifactProvenanceCandidates(path, explicitPath).find((candidate) => existsSync(candidate));
  if (provenancePath === undefined) throw new QualificationError(`No artifact provenance was supplied for ${path}; provide ${path}.provenance.json or --artifact-provenance.`, { code: "TN_QUALIFY_ARTIFACT_PROVENANCE_REQUIRED" });
  let provenance;
  try {
    provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
  } catch (error) {
    throw new QualificationError(`Artifact provenance is invalid JSON at ${provenancePath}: ${error instanceof Error ? error.message : String(error)}`, { code: "TN_QUALIFY_ARTIFACT_PROVENANCE_INVALID" });
  }
  return { provenance, provenancePath };
}

export function readArtifactProvenance(path, {
  platform,
  candidateSha,
  artifactSha256,
  explicitPath = null,
} = {}) {
  const { provenance, provenancePath } = readArtifactProvenanceDocument(path, explicitPath);
  if (!isRecord(provenance)) throw new QualificationError(`Artifact provenance at ${provenancePath} must be an object.`, { code: "TN_QUALIFY_ARTIFACT_PROVENANCE_INVALID" });
  const allowed = new Set(["schemaVersion", "platform", "sourceSha", "candidateSha", "artifactSha256", "packageVersion", "releaseRun", "signing"]);
  for (const key of Object.keys(provenance)) if (!allowed.has(key)) throw new QualificationError(`Artifact provenance has unknown field ${key}.`, { code: "TN_QUALIFY_ARTIFACT_PROVENANCE_INVALID" });
  const sourceSha = provenance.sourceSha ?? provenance.candidateSha;
  if (provenance.schemaVersion !== 1 || typeof sourceSha !== "string" || !commitPattern.test(sourceSha)) throw new QualificationError(`Artifact provenance at ${provenancePath} lacks schemaVersion 1 and a source SHA.`, { code: "TN_QUALIFY_ARTIFACT_PROVENANCE_INVALID" });
  if (provenance.candidateSha !== undefined && provenance.candidateSha !== sourceSha) throw new QualificationError(`Artifact provenance source/candidate SHA mismatch at ${provenancePath}.`, { code: "TN_QUALIFY_ARTIFACT_PROVENANCE_MISMATCH" });
  if (provenance.platform !== platform) throw new QualificationError(`Artifact provenance target mismatch: expected ${platform}, got ${provenance.platform ?? "missing"}.`, { code: "TN_QUALIFY_ARTIFACT_PROVENANCE_INVALID" });
  if (candidateSha !== undefined && sourceSha !== candidateSha) throw new QualificationError(`Artifact source SHA mismatch: candidate ${candidateSha}, supplied artifact ${sourceSha}.`, { code: "TN_QUALIFY_ARTIFACT_PROVENANCE_MISMATCH" });
  if (provenance.artifactSha256 !== artifactSha256 || typeof artifactSha256 !== "string" || !sha256Pattern.test(provenance.artifactSha256)) throw new QualificationError(`Artifact SHA mismatch: supplied artifact is ${artifactSha256}, provenance records ${provenance.artifactSha256 ?? "missing"}.`, { code: "TN_QUALIFY_ARTIFACT_PROVENANCE_MISMATCH" });
  if (typeof provenance.packageVersion !== "string" || provenance.packageVersion.length === 0) throw new QualificationError("Artifact provenance must include packageVersion.", { code: "TN_QUALIFY_ARTIFACT_PROVENANCE_INVALID" });
  if (!isRecord(provenance.signing)) throw new QualificationError("Artifact provenance must include signing facts from the supplied artifact.", { code: "TN_QUALIFY_ARTIFACT_PROVENANCE_INVALID" });
  return { ...provenance, sourceSha, provenancePath };
}

export function verifyAndroidArtifact(path, candidateSha, options = {}) {
  if (!existsSync(path)) throw new QualificationError(`Android artifact is missing at ${path}.`, { code: "TN_QUALIFY_SIGNING_REQUIRED" });
  const run = options.command ?? command;
  const locate = options.findExecutable ?? findExecutable;
  const signer = locate("apksigner");
  if (signer === null) throw new QualificationError("apksigner is unavailable; production signature cannot be verified before adb install.", { code: "TN_QUALIFY_SIGNING_TOOL_REQUIRED" });
  const verification = run(signer, ["verify", "--print-certs", path]);
  if (verification.status !== 0) throw new QualificationError(`Android signature verification failed: ${verification.stderr || verification.stdout}`, { code: "TN_QUALIFY_ANDROID_SIGNING_INVALID" });
  const certificate = /certificate SHA-256 digest:\s*([0-9a-f:]+)/iu.exec(verification.stdout)?.[1]?.replaceAll(":", "").toLowerCase();
  if (certificate === undefined || certificate.length !== 64) throw new QualificationError("Android signer certificate digest was not reported by apksigner.", { code: "TN_QUALIFY_ANDROID_SIGNING_INVALID" });
  const unzip = locate("unzip");
  if (unzip === null) throw new QualificationError("unzip is unavailable; arm64 library presence cannot be verified.", { code: "TN_QUALIFY_TOOL_REQUIRED" });
  const listing = run(unzip, ["-l", path]);
  if (listing.status !== 0 || !/lib\/arm64-v8a\//u.test(listing.stdout)) throw new QualificationError("Android artifact has no arm64-v8a native library.", { code: "TN_QUALIFY_ANDROID_ARM64_REQUIRED" });
  if (/android:debuggable|debuggable=true/iu.test(verification.stdout)) throw new QualificationError("Android production artifact is debuggable.", { code: "TN_QUALIFY_ANDROID_SIGNING_INVALID" });
  const artifactSha256 = artifactSha(path);
  const provenance = readArtifactProvenance(path, { platform: "android", candidateSha, artifactSha256, explicitPath: options.artifactProvenance ?? null });
  const signing = provenance.signing;
  if (signing.certificateFingerprint !== certificate) throw new QualificationError("Android signer digest does not match the supplied artifact provenance.", { code: "TN_QUALIFY_ARTIFACT_PROVENANCE_MISMATCH" });
  if (signing.debuggable !== false) throw new QualificationError("Android artifact provenance marks the production artifact as debuggable.", { code: "TN_QUALIFY_ANDROID_SIGNING_INVALID" });
  return {
    artifactSha256,
    sourceSha: provenance.sourceSha,
    packageVersion: provenance.packageVersion,
    releaseRun: provenance.releaseRun ?? null,
    certificateFingerprint: certificate,
    signerId: signing.signerId,
    profileFingerprint: null,
    expiresAt: signing.expiresAt,
    applicationId: signing.applicationId,
    debuggable: false,
    provenancePath: provenance.provenancePath,
    verificationCommand: `apksigner verify --print-certs ${path}`,
  };
}

function inspectAndroidDevice(adb, serial, options = {}) {
  const run = options.command ?? command;
  const getprop = (name) => {
    const value = run(adb, ["-s", serial, "shell", "getprop", name]);
    if (value.status !== 0) throw new QualificationError(`adb could not read ${name}: ${value.stderr || value.stdout}`, { code: "TN_QUALIFY_ANDROID_DEVICE_BLOCKED" });
    return value.stdout.trim();
  };
  const qemu = getprop("ro.kernel.qemu");
  const hardware = getprop("ro.hardware");
  if (qemu === "1" || /^(goldfish|ranchu)$/iu.test(hardware)) throw new QualificationError(`TN_QUALIFY_PHYSICAL_DEVICE_REQUIRED: ${serial} identifies as an emulator.`, { code: "TN_QUALIFY_PHYSICAL_DEVICE_REQUIRED" });
  const abi = getprop("ro.product.cpu.abi");
  if (!/^(arm64-v8a|aarch64)$/iu.test(abi)) throw new QualificationError(`Android device ABI ${abi} is not arm64.`, { code: "TN_QUALIFY_ANDROID_ARM64_REQUIRED" });
  const gpuInfo = run(adb, ["-s", serial, "shell", "dumpsys", "SurfaceFlinger"]);
  const gpu = gpuInfo.stdout.match(/(?:GLES|Vulkan|GPU)[^\n]*/iu)?.[0]?.trim() ?? "unknown GPU";
  if (/swiftshader|software rasterizer|llvmpipe/iu.test(gpu)) throw new QualificationError(`Android device reports a software GPU: ${gpu}.`, { code: "TN_QUALIFY_NATIVE_GPU_REQUIRED" });
  const size = run(adb, ["-s", serial, "shell", "wm", "size"]);
  const dimensions = /(?:Physical size|Override size):\s*(\d+)x(\d+)/iu.exec(size.stdout);
  if (dimensions === null) throw new QualificationError("Android device did not report a usable physical screen size.", { code: "TN_QUALIFY_ANDROID_DEVICE_BLOCKED" });
  return {
    platform: "android",
    kind: "physical",
    identifierHash: hashIdentifier(serial),
    name: getprop("ro.product.name"),
    manufacturer: getprop("ro.product.manufacturer"),
    model: getprop("ro.product.model"),
    osVersion: getprop("ro.build.version.release"),
    osBuild: getprop("ro.build.id"),
    cpuAbi: abi,
    gpu,
    driver: "Android Vulkan device driver",
    screenModes: [{ width: Number(dimensions[1]), height: Number(dimensions[2]), orientation: Number(dimensions[1]) >= Number(dimensions[2]) ? "landscape" : "portrait" }],
    nativeGpu: true,
  };
}

function installAndroid(adb, serial, app, options = {}) {
  const run = options.command ?? command;
  const result = run(adb, ["-s", serial, "install", "--no-streaming", app], { timeout: 120_000 });
  if (result.status !== 0) throw new QualificationError(`adb install failed before lifecycle qualification: ${result.stderr || result.stdout}`, { code: "TN_QUALIFY_ANDROID_INSTALL_BLOCKED" });
}

/**
 * The application this qualification drives, and the activity it launches.
 *
 * Both carried the pre-rename Mystral identity when this orchestrator was written. The Android
 * identity was renamed while the orchestrator sat on an unlanded branch, so it would have launched a
 * package that no longer exists and then read `gfxinfo` and `meminfo` for it — collecting empty
 * telemetry from a process that never started. `android/app/build.gradle.kts` and
 * `AndroidManifest.xml` are the source of truth; keep this in step with them.
 */
const ANDROID_APPLICATION_ID = "com.threenative.game";
const ANDROID_LAUNCH_ACTIVITY = `${ANDROID_APPLICATION_ID}/com.threenative.runtime.MystralActivity`;

function launchAndroid(adb, serial, options = {}) {
  const run = options.command ?? command;
  const result = run(adb, ["-s", serial, "shell", "am", "start", "-W", "-n", ANDROID_LAUNCH_ACTIVITY], { timeout: 30_000 });
  if (result.status !== 0) throw new QualificationError(`Android launch failed: ${result.stderr || result.stdout}`, { code: "TN_QUALIFY_ANDROID_LAUNCH_FAILED", status: "fail" });
  const pid = run(adb, ["-s", serial, "shell", "pidof", ANDROID_APPLICATION_ID]);
  const value = Number(pid.stdout.trim().split(/\s+/u)[0]);
  if (!Number.isInteger(value) || value <= 0) throw new QualificationError("Android launch did not report a live process id.", { code: "TN_QUALIFY_ANDROID_LAUNCH_FAILED", status: "fail" });
  return value;
}

function jsonValuesFromOutput(stdout) {
  const values = [];
  for (let start = 0; start < stdout.length; start += 1) {
    if (stdout[start] !== "{" && stdout[start] !== "[") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < stdout.length; index += 1) {
      const character = stdout[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "{" || character === "[") depth += 1;
      else if (character === "}") depth -= 1;
      else if (character === "]") depth -= 1;
      if (depth === 0) {
        try {
          values.push(JSON.parse(stdout.slice(start, index + 1)));
        } catch {
          // A diagnostic may contain braces that are not a complete JSON value.
        }
        break;
      }
    }
  }
  return values;
}

export function parsePlaytestReport(stdout) {
  const reports = jsonValuesFromOutput(stdout).filter((value) => isRecord(value) && (value.observations !== undefined || value.assertionResults !== undefined || value.diagnostics !== undefined || (typeof value.pass === "boolean" && value.scenario !== undefined)));
  return reports.at(-1) ?? null;
}

function runLifecycleScenario(options, { target, device, adb, app }, dependencies = {}) {
  const cli = joinPath(workspaceRoot, "packages/playtest/dist/runner/cli.js");
  if (!existsSync(cli)) throw new QualificationError("Playtest CLI is missing; run pnpm --filter @threenative/playtest build.", { code: "TN_QUALIFY_TOOL_REQUIRED" });
  const args = [cli, defaultScenario, "--target", target, "--device", device, "--project", joinPath(workspaceRoot, "examples/native-smoke"), "--artifacts", joinPath(options.out, "playtest"), "--timeout", String(Math.max(options.durationMs, 60_000))];
  if (target === "android") args.push("--adb", adb);
  else args.push("--ios-transport", "device", "--app", app);
  const startedAt = new Date((dependencies.now ?? Date.now)()).toISOString();
  const result = (dependencies.command ?? command)(process.execPath, args, { cwd: workspaceRoot, timeout: Math.max(options.durationMs + 30_000, 90_000) });
  const report = parsePlaytestReport(result.stdout);
  if (result.status !== 0 || report?.pass !== true) throw new QualificationError(`Physical lifecycle scenario failed: ${report?.diagnostics?.map((item) => item.message).join("; ") || result.stderr || "assertion failure"}`, { code: "TN_QUALIFY_LIFECYCLE_CONTINUITY", status: "fail" });
  const reportPath = joinPath(options.out, "playtest/report.json");
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return {
    report,
    reportPath,
    startedAt,
    completedAt: new Date((dependencies.now ?? Date.now)()).toISOString(),
  };
}

function unavailableCollector(source, unit, error) {
  return { available: false, source, unit, samples: [], error };
}

function availableCollector(source, unit, samples) {
  return samples.length === 0
    ? unavailableCollector(source, unit, "collector returned no samples")
    : { available: true, source, unit, samples, error: null };
}

export function sampleOffsets(durationMs, cadenceMs) {
  if (!Number.isInteger(durationMs) || durationMs <= 0 || !Number.isInteger(cadenceMs) || cadenceMs <= 0) throw new QualificationError("Telemetry duration and cadence must be positive integers.", { code: "TN_QUALIFY_ARGUMENT" });
  const offsets = [];
  for (let offset = 0; offset < durationMs; offset += cadenceMs) offsets.push(offset);
  offsets.push(durationMs);
  return [...new Set(offsets)];
}

function sleepBlocking(durationMs) {
  if (durationMs <= 0) return;
  const atomics = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(atomics, 0, 0, durationMs);
}

function parseGfxinfoFrameIntervals(stdout) {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0);
  const headerIndex = lines.findIndex((line) => /(?:^|,)IntendedVsync(?:,|$)/u.test(line) && /(?:^|,)FrameCompleted(?:,|$)/u.test(line));
  if (headerIndex < 0) return [];
  const headers = lines[headerIndex].split(",");
  const intendedIndex = headers.indexOf("IntendedVsync");
  const completedIndex = headers.indexOf("FrameCompleted");
  if (intendedIndex < 0 || completedIndex < 0) return [];
  const intervals = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const fields = line.split(",");
    const intended = Number(fields[intendedIndex]);
    const completed = Number(fields[completedIndex]);
    if (Number.isFinite(intended) && Number.isFinite(completed) && completed >= intended) intervals.push((completed - intended) / 1_000_000);
  }
  return intervals.filter((value) => Number.isFinite(value) && value >= 0);
}

function collectSampledAndroidValue({
  adb,
  serial,
  durationMs,
  cadenceMs,
  commandRunner,
  now,
  sleep,
}) {
  const startedMs = now();
  const frameSamples = [];
  const memorySamples = [];
  const thermalSamples = [];
  const batterySamples = [];
  const errors = { frame: [], memory: [], thermal: [], battery: [] };
  for (const offset of sampleOffsets(durationMs, cadenceMs)) {
    const target = startedMs + offset;
    const delay = target - now();
    if (delay > 0) sleep(delay);
    const at = new Date(now()).toISOString();
    const frame = commandRunner(adb, ["-s", serial, "shell", "dumpsys", "gfxinfo", ANDROID_APPLICATION_ID, "framestats"]);
    const frameIntervals = frame.status === 0 ? parseGfxinfoFrameIntervals(frame.stdout) : [];
    if (frameIntervals.length === 0) errors.frame.push(frame.stderr || `no frame intervals at ${at}`);
    else for (const value of frameIntervals) frameSamples.push({ at, value });

    const memory = commandRunner(adb, ["-s", serial, "shell", "dumpsys", "meminfo", ANDROID_APPLICATION_ID]);
    const memoryKb = /TOTAL\s+(\d+)/iu.exec(memory.stdout)?.[1];
    if (memory.status !== 0 || memoryKb === undefined) errors.memory.push(memory.stderr || `TOTAL row unavailable at ${at}`);
    else memorySamples.push({ at, value: Number(memoryKb) * 1024 });

    const thermal = commandRunner(adb, ["-s", serial, "shell", "dumpsys", "thermalservice"]);
    const thermalState = /(?:Status|Current thermal status):\s*([^\n]+)/iu.exec(thermal.stdout)?.[1]?.trim();
    if (thermal.status !== 0 || thermalState === undefined) errors.thermal.push(thermal.stderr || `thermal state unavailable at ${at}`);
    else thermalSamples.push({ at, value: thermalState });

    const battery = commandRunner(adb, ["-s", serial, "shell", "dumpsys", "battery"]);
    const batteryPercent = /level:\s*(\d+)/iu.exec(battery.stdout)?.[1];
    if (battery.status !== 0 || batteryPercent === undefined) errors.battery.push(battery.stderr || `battery level unavailable at ${at}`);
    else batterySamples.push({ at, value: Number(batteryPercent) });
  }
  return {
    frame: errors.frame.length === 0 ? availableCollector(`adb shell dumpsys gfxinfo ${ANDROID_APPLICATION_ID} framestats`, "ms", frameSamples) : unavailableCollector(`adb shell dumpsys gfxinfo ${ANDROID_APPLICATION_ID} framestats`, "ms", errors.frame.join("; ")),
    memory: errors.memory.length === 0 ? availableCollector(`adb shell dumpsys meminfo ${ANDROID_APPLICATION_ID}`, "bytes", memorySamples) : unavailableCollector(`adb shell dumpsys meminfo ${ANDROID_APPLICATION_ID}`, "bytes", errors.memory.join("; ")),
    thermal: errors.thermal.length === 0 ? availableCollector("adb shell dumpsys thermalservice", "state", thermalSamples) : unavailableCollector("adb shell dumpsys thermalservice", "state", errors.thermal.join("; ")),
    battery: errors.battery.length === 0 ? availableCollector("adb shell dumpsys battery", "percent", batterySamples) : unavailableCollector("adb shell dumpsys battery", "percent", errors.battery.join("; ")),
  };
}

export function collectAndroidTelemetry(adb, serial, durationMs, cadenceMs, dependencies = {}) {
  const telemetry = collectSampledAndroidValue({
    adb,
    serial,
    durationMs,
    cadenceMs,
    commandRunner: dependencies.command ?? command,
    now: dependencies.now ?? Date.now,
    sleep: dependencies.sleep ?? sleepBlocking,
  });
  const batteryStart = telemetry.battery.samples.at(0);
  const batteryEnd = telemetry.battery.samples.at(-1);
  if (batteryStart === undefined || batteryEnd === undefined || batteryStart.at === batteryEnd.at) telemetry.battery = unavailableCollector(telemetry.battery.source, telemetry.battery.unit, "battery start/end samples are unavailable");
  return { durationMs, cadenceMs, ...telemetry };
}

export function collectIosTelemetry({ path = null, durationMs, cadenceMs, read = readFileSync } = {}) {
  const unavailable = (name, unit) => unavailableCollector(`signed iOS qualification bridge: ${name}`, unit, "signed-device collector did not provide a report");
  if (path === null || !existsSync(path)) return {
    durationMs,
    cadenceMs,
    frame: unavailable("frame", "ms"),
    memory: unavailable("memory", "bytes"),
    thermal: unavailable("thermal", "state"),
    battery: unavailable("battery", "percent"),
  };
  let value;
  try {
    value = JSON.parse(read(path, "utf8"));
  } catch (error) {
    const reason = `signed iOS collector report is invalid: ${error instanceof Error ? error.message : String(error)}`;
    return { durationMs, cadenceMs, frame: unavailableCollector("signed iOS qualification bridge: frame", "ms", reason), memory: unavailableCollector("signed iOS qualification bridge: memory", "bytes", reason), thermal: unavailableCollector("signed iOS qualification bridge: thermal", "state", reason), battery: unavailableCollector("signed iOS qualification bridge: battery", "percent", reason) };
  }
  const telemetry = value.telemetry ?? value;
  if (!isRecord(telemetry) || telemetry.durationMs !== durationMs || telemetry.cadenceMs !== cadenceMs) {
    const reason = "signed iOS collector duration/cadence does not match the requested sampling window";
    return { durationMs, cadenceMs, frame: unavailableCollector("signed iOS qualification bridge: frame", "ms", reason), memory: unavailableCollector("signed iOS qualification bridge: memory", "bytes", reason), thermal: unavailableCollector("signed iOS qualification bridge: thermal", "state", reason), battery: unavailableCollector("signed iOS qualification bridge: battery", "percent", reason) };
  }
  return telemetry;
}

function iosProcessPid(telemetry, playtestRun) {
  const observed = telemetry.processPid ?? telemetry.pid ?? playtestRun.report?.pid ?? playtestRun.report?.observations?.resources?.GameState?.after?.pid;
  const pid = Number(observed);
  if (!Number.isInteger(pid) || pid <= 0) throw new QualificationError("Signed iOS collector did not provide the live app process PID.", { code: "TN_QUALIFY_IOS_PROCESS_REQUIRED" });
  return pid;
}

function prerequisiteEvidence(preflightResult) {
  return Object.fromEntries(REQUIRED_PREREQUISITES.map((name) => {
    const record = preflightResult.prerequisites[name];
    return [name, {
      status: "pass",
      reportPath: relative(workspaceRoot, record.path).replaceAll("\\", "/"),
      sha256: record.sha256,
      candidateSha: record.validation.candidateSha,
      gateIds: Array.isArray(record.report.gateIds) ? record.report.gateIds : record.validation.controls.map(({ gateId }) => gateId),
    }];
  }));
}

function reportConsumption(preflightResult, name, key) {
  const report = preflightResult.prerequisites[name].report;
  const value = report.consumption?.[key] ?? report.results?.[key] ?? report.observations?.[key] ?? (key === "multitouch" && name === "prd053" ? report.results : key === "physics" && name === "prd046" ? report.results : undefined);
  if (!isRecord(value)) throw new QualificationError(`${name} prerequisite report does not contain observed ${key} results.`, { code: "TN_QUALIFY_PREREQUISITE_SCHEMA_INVALID" });
  return value;
}

function productionConsumption(preflightResult, candidateSha) {
  const multitouch = reportConsumption(preflightResult, "prd053", "multitouch");
  const physics = reportConsumption(preflightResult, "prd046", "physics");
  const result = { multitouch: { ...multitouch }, physics: { ...physics } };
  for (const [key, value] of Object.entries(result)) {
    if (value.candidateSha !== candidateSha) throw new QualificationError(`Consumed ${key} prerequisite candidate SHA does not match ${candidateSha}.`, { code: "TN_QUALIFY_PROVENANCE_MISMATCH" });
    if (value.deviceClass !== "physical") throw new QualificationError(`Consumed ${key} prerequisite is not physical-device evidence.`, { code: "TN_QUALIFY_PREREQUISITE_TARGET_INVALID" });
  }
  return result;
}

function countScenarioErrors(playtest) {
  const diagnostics = Array.isArray(playtest.diagnostics) ? playtest.diagnostics : [];
  const runtimeErrors = playtest.observations?.runtimeDiagnostics?.recentRuntimeErrors;
  const errors = [...diagnostics, ...(Array.isArray(runtimeErrors) ? runtimeErrors : [])];
  return errors.filter((item) => item?.severity === "error" || /GPU|WebGPU|validation/iu.test(JSON.stringify(item))).length;
}

export function evaluateLifecycleObservation(after, before = undefined) {
  const errors = [];
  if (!isRecord(after)) return { valid: false, errors: ["scenario after observation is missing"] };
  const phases = ["background", "foreground", "supported-rotation", "resume"];
  if (!Array.isArray(after.lifecycleEvents) || after.lifecycleEvents.length !== phases.length) errors.push("scenario lifecycleEvents must contain four observed events");
  else {
    after.lifecycleEvents.forEach((event, index) => {
      if (!isRecord(event) || event.phase !== phases[index]) errors.push(`scenario lifecycleEvents[${index}] is not the expected ${phases[index]} observation`);
    });
  }
  if (typeof after.sessionNonce !== "string" || after.sessionNonce.length === 0) errors.push("scenario sessionNonce is missing");
  if (before?.sessionNonce !== undefined && before.sessionNonce !== after.sessionNonce) errors.push("scenario sessionNonce changed across lifecycle");
  if (after.stateContinuity !== true) errors.push("scenario stateContinuity is not true");
  if (after.framesPaused !== true) errors.push("scenario did not observe paused frames");
  if (after.framesAdvanced !== true) errors.push("scenario did not observe advanced frames after resume");
  if (after.surfaceValidAfterResume !== true) errors.push("scenario did not observe a valid surface after resume");
  if (after.backgroundGapIntegrated !== false) errors.push("scenario integrated the background wall-clock gap");
  if (!Number.isFinite(after.maxFrameIntervalMs) || after.maxFrameIntervalMs < 0) errors.push("scenario maxFrameIntervalMs is missing or non-finite");
  if (!Number.isFinite(after.physicsStepDelta) || after.physicsStepDelta < 0) errors.push("scenario physicsStepDelta is missing or non-finite");
  return { valid: errors.length === 0, errors };
}

function actualArtifactRecord(path, producerCommand, retention = "ignored-raw") {
  if (!existsSync(path) || !statSync(path).isFile()) throw new QualificationError(`Qualification artifact is missing at ${path}.`, { code: "TN_QUALIFY_ARTIFACT_BLOCKED" });
  return {
    path: relative(workspaceRoot, path).replaceAll("\\", "/"),
    sha256: sha256File(path),
    size: statSync(path).size,
    producerCommand,
    retention,
  };
}

export function buildProductionEvidence({
  platform,
  source,
  artifact,
  device,
  signing,
  preflightResult,
  playtestRun,
  telemetry,
  pid,
  processLiveness,
  timestamps,
  artifactPaths,
  gateEvidence,
}) {
  const playtest = playtestRun?.report ?? playtestRun;
  const after = playtest?.observations?.resources?.GameState?.after;
  const before = playtest?.observations?.resources?.GameState?.before;
  const lifecycle = evaluateLifecycleObservation(after, before);
  if (!lifecycle.valid) throw new QualificationError(lifecycle.errors.join("; "), { code: "TN_QUALIFY_LIFECYCLE_CONTINUITY", status: "fail" });
  if (!Array.isArray(playtest.assertionResults) || playtest.assertionResults.length === 0) throw new QualificationError("Physical lifecycle scenario produced no assertions.", { code: "TN_QUALIFY_LIFECYCLE_CONTINUITY", status: "fail" });
  if (!Number.isInteger(after.frames) || after.frames < 300) throw new QualificationError("Physical lifecycle scenario did not observe 300 frames.", { code: "TN_QUALIFY_LIFECYCLE_CONTINUITY", status: "fail" });
  if (!Number.isInteger(pid) || pid <= 0) throw new QualificationError("Physical lifecycle scenario did not provide the app process id.", { code: "TN_QUALIFY_LIFECYCLE_CONTINUITY", status: "fail" });
  if (processLiveness !== true) throw new QualificationError("Physical lifecycle scenario did not observe a live app process.", { code: "TN_QUALIFY_LIFECYCLE_CONTINUITY", status: "fail" });
  if (!isRecord(artifact) || artifact.sourceSha !== source.headSha || artifact.artifactSha256 === undefined) throw new QualificationError("Supplied artifact provenance is absent or does not match source HEAD.", { code: "TN_QUALIFY_ARTIFACT_PROVENANCE_MISMATCH" });
  if (!isRecord(device) || device.nativeGpu !== true) throw new QualificationError("Physical device observation did not prove a native GPU.", { code: "TN_QUALIFY_NATIVE_GPU_REQUIRED" });
  if (!isRecord(signing)) throw new QualificationError("Supplied artifact signing observation is missing.", { code: "TN_QUALIFY_SIGNING_REQUIRED" });
  if (!Array.isArray(artifactPaths) || artifactPaths.length === 0) throw new QualificationError("Qualification artifact observations are missing.", { code: "TN_QUALIFY_ARTIFACT_BLOCKED" });
  if (!Array.isArray(gateEvidence)) throw new QualificationError("Observed-red gate evidence is missing.", { code: "TN_QUALIFY_GATE_EVIDENCE_REQUIRED" });
  const { nativeGpu, ...publicDevice } = device;
  const candidateSha = source.headSha;
  const evidence = {
    schemaVersion: 1,
    identity: {
      schemaVersion: 1,
      runId: `prd056-${platform}-${timestamps.startedAt}`,
      startedAt: timestamps.startedAt,
      endedAt: timestamps.endedAt,
      verdict: "pass",
      blockers: [],
      evidenceClass: "physical-device",
    },
    source: {
      remote: source.remote,
      branch: source.branch,
      headSha: source.headSha,
      worktree: source.worktree,
      artifactSourceSha: artifact.sourceSha,
      packageVersion: artifact.packageVersion,
      artifactSha256: artifact.artifactSha256,
      releaseRun: artifact.releaseRun ?? null,
      publishedPackage: null,
      promotedConsumer: null,
    },
    device: publicDevice,
    signing: {
      verificationCommand: signing.verificationCommand,
      signerId: signing.signerId,
      certificateFingerprint: signing.certificateFingerprint,
      profileFingerprint: signing.profileFingerprint ?? null,
      expiresAt: signing.expiresAt,
      applicationId: signing.applicationId,
      debuggable: signing.debuggable,
      installResult: "installed",
    },
    prerequisites: prerequisiteEvidence(preflightResult),
    execution: {
      installStartedAt: timestamps.installStartedAt,
      launchStartedAt: timestamps.launchStartedAt,
      pid,
      sessionNonce: after.sessionNonce,
      readyAt: timestamps.readyAt,
      firstFrameAt: timestamps.firstFrameAt,
      frame300At: timestamps.frame300At,
      frames: after.frames,
      nonBlankCaptureSha256: artifactPaths.find((item) => item.capture === true)?.sha256 ?? "",
      gpuErrorCount: countScenarioErrors(playtest),
      arm64: /^(?:arm64-v8a|arm64|aarch64)$/iu.test(publicDevice.cpuAbi),
      nativeGpu,
      processLiveness,
      assertionCount: playtest.assertionResults.length,
    },
    lifecycle: {
      events: after.lifecycleEvents.map((event) => ({ ...event, pid, sessionNonce: after.sessionNonce })),
      sameSession: before?.sessionNonce === after.sessionNonce,
      framesPaused: after.framesPaused,
      framesAdvanced: after.framesAdvanced,
      maxFrameIntervalMs: after.maxFrameIntervalMs,
      surfaceValidAfterResume: after.surfaceValidAfterResume,
      stateContinuity: after.stateContinuity,
      physicsStepDelta: after.physicsStepDelta,
      backgroundGapIntegrated: after.backgroundGapIntegrated,
    },
    consumption: productionConsumption(preflightResult, candidateSha),
    telemetry,
    artifacts: artifactPaths.map(({ capture: _capture, ...record }) => record),
    gateEvidence,
  };
  assertValidPhysicalDeviceEvidence(evidence, {
    candidateSha,
    artifactSha256: artifact.artifactSha256,
    platform,
    identifierHash: publicDevice.identifierHash,
  });
  return evidence;
}

function writeArtifactObservation(options, artifact) {
  const path = joinPath(options.out, "artifact-provenance.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, platform: options.platform, sourceSha: artifact.sourceSha, artifactSha256: artifact.artifactSha256, packageVersion: artifact.packageVersion }, null, 2)}\n`);
  return path;
}

function readGateEvidence(path) {
  if (path === null || !existsSync(path)) return [];
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new QualificationError(`Gate evidence is invalid JSON: ${error instanceof Error ? error.message : String(error)}`, { code: "TN_QUALIFY_GATE_EVIDENCE_INVALID" });
  }
  const gates = Array.isArray(value) ? value : value?.gates;
  if (!Array.isArray(gates)) throw new QualificationError("Gate evidence must be an array or an object with a gates array.", { code: "TN_QUALIFY_GATE_EVIDENCE_INVALID" });
  return gates;
}

function telemetryFailure(telemetry) {
  return ["frame", "memory", "thermal", "battery"]
    .filter((name) => telemetry[name]?.available !== true)
    .map((name) => `${name}: ${telemetry[name]?.error ?? "collector unavailable"}`);
}

function runAndroidQualification(options, preflightResult, artifact, dependencies = {}) {
  const locate = dependencies.findExecutable ?? findExecutable;
  const adb = dependencies.adb ?? locate("adb");
  if (adb === null) throw new QualificationError("adb is unavailable; physical Android qualification is blocked.", { code: "TN_QUALIFY_TOOL_REQUIRED" });
  const run = dependencies.command ?? command;
  const now = dependencies.now ?? Date.now;
  const device = inspectAndroidDevice(adb, options.device, { command: run });
  const installStartedAt = new Date(now()).toISOString();
  installAndroid(adb, options.device, options.app, { command: run });
  const launchStartedAt = new Date(now()).toISOString();
  const pid = launchAndroid(adb, options.device, { command: run });
  const lifecycleRun = runLifecycleScenario(options, { target: "android", device: options.device, adb, app: options.app }, { command: run, now });
  const telemetry = collectAndroidTelemetry(adb, options.device, options.durationMs, options.cadenceMs, { command: run, now, sleep: dependencies.sleep });
  const telemetryErrors = telemetryFailure(telemetry);
  if (telemetryErrors.length > 0) throw new QualificationError(`Android telemetry is incomplete: ${telemetryErrors.join("; ")}`, { code: "TN_QUALIFY_TELEMETRY_INCOMPLETE", details: telemetryErrors });
  const artifactObservationPath = writeArtifactObservation(options, artifact);
  const capturePath = joinPath(options.out, "playtest/after.png");
  const artifactPaths = [
    { ...actualArtifactRecord(lifecycleRun.reportPath, "native:qualify:physical playtest"), capture: false },
    { ...actualArtifactRecord(artifactObservationPath, "native:qualify:physical artifact provenance"), capture: false },
    { ...actualArtifactRecord(capturePath, "native:qualify:physical playtest screenshot"), capture: true },
  ];
  const endedAt = new Date(now()).toISOString();
  const evidence = buildProductionEvidence({
    platform: "android",
    source: preflightResult.source,
    artifact,
    device,
    signing: { ...artifact, profileFingerprint: null, debuggable: false },
    preflightResult,
    playtestRun: lifecycleRun,
    telemetry,
    pid,
    processLiveness: lifecycleRun.report.pass === true,
    timestamps: { startedAt: installStartedAt, endedAt, installStartedAt, launchStartedAt, readyAt: lifecycleRun.startedAt, firstFrameAt: lifecycleRun.startedAt, frame300At: lifecycleRun.completedAt },
    artifactPaths,
    gateEvidence: readGateEvidence(options.gateEvidence),
  });
  const reportPath = joinPath(options.out, "physical-device-evidence.json");
  writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`);
  return resultFor("pass", "TN_QUALIFY_PHYSICAL_PASS", { report: reportPath });
}

function verifyIosArtifact(path, candidateSha, options = {}) {
  if (!existsSync(path)) throw new QualificationError(`iOS artifact is missing at ${path}.`, { code: "TN_QUALIFY_SIGNING_REQUIRED" });
  const locate = options.findExecutable ?? findExecutable;
  const run = options.command ?? command;
  const codesign = locate("codesign");
  if (codesign === null) throw new QualificationError("codesign is unavailable; signed iOS qualification is blocked.", { code: "TN_QUALIFY_SIGNING_TOOL_REQUIRED" });
  const verification = run(codesign, ["--verify", "--strict", "--deep", path]);
  if (verification.status !== 0) throw new QualificationError(`iOS signing verification failed: ${verification.stderr || verification.stdout}`, { code: "TN_QUALIFY_IOS_SIGNING_INVALID" });
  const details = run(codesign, ["-dv", "--verbose=4", path]);
  const team = /TeamIdentifier=([^\n]+)/u.exec(details.stderr || details.stdout)?.[1]?.trim();
  const identifier = /Identifier=([^\n]+)/u.exec(details.stderr || details.stdout)?.[1]?.trim();
  if (team === undefined || identifier === undefined) throw new QualificationError("codesign did not report team and application identifiers.", { code: "TN_QUALIFY_IOS_SIGNING_INVALID" });
  if (/<key>get-task-allow<\/key>\s*<true\s*\/>/u.test(details.stdout || details.stderr)) throw new QualificationError("iOS artifact is development-debuggable (get-task-allow=true).", { code: "TN_QUALIFY_IOS_SIGNING_INVALID" });
  const artifactSha256 = artifactSha(path);
  const provenance = readArtifactProvenance(path, { platform: "ios", candidateSha, artifactSha256, explicitPath: options.artifactProvenance ?? null });
  const signing = provenance.signing;
  if (signing.signerId !== team || signing.applicationId !== identifier || signing.debuggable !== false) throw new QualificationError("iOS signing facts do not match the supplied artifact provenance.", { code: "TN_QUALIFY_ARTIFACT_PROVENANCE_MISMATCH" });
  if (signing.profileFingerprint === null || signing.profileFingerprint === undefined) throw new QualificationError("iOS artifact provenance lacks the embedded provisioning-profile fingerprint.", { code: "TN_QUALIFY_IOS_SIGNING_INVALID" });
  return { ...provenance, artifactSha256, signerId: team, applicationId: identifier, certificateFingerprint: signing.certificateFingerprint, profileFingerprint: signing.profileFingerprint, expiresAt: signing.expiresAt, debuggable: false, verificationCommand: `codesign --verify --strict --deep ${path}` };
}

function inspectIosDevice(device, options = {}) {
  const locate = options.findExecutable ?? findExecutable;
  const run = options.command ?? command;
  const devicectl = locate("devicectl");
  if (devicectl === null) throw new QualificationError("devicectl is unavailable; physical iOS qualification is blocked.", { code: "TN_QUALIFY_TOOL_REQUIRED" });
  const details = run(devicectl, ["device", "info", "details", "--device", device]);
  if (details.status !== 0) throw new QualificationError(`devicectl could not inspect ${device}: ${details.stderr || details.stdout}`, { code: "TN_QUALIFY_IOS_DEVICE_BLOCKED" });
  if (/simulator/iu.test(details.stdout)) throw new QualificationError(`TN_QUALIFY_PHYSICAL_DEVICE_REQUIRED: ${device} identifies as a simulator.`, { code: "TN_QUALIFY_PHYSICAL_DEVICE_REQUIRED" });
  if (!/arm64/iu.test(details.stdout)) throw new QualificationError("iOS device details did not prove arm64 execution.", { code: "TN_QUALIFY_IOS_ARM64_REQUIRED" });
  if (!/Metal/iu.test(details.stdout)) throw new QualificationError("iOS device details did not report a physical Metal adapter.", { code: "TN_QUALIFY_NATIVE_GPU_REQUIRED" });
  const dimensions = /(?:screen|display)[^\n]*(\d+)\s*[x×]\s*(\d+)/iu.exec(details.stdout);
  if (dimensions === null) throw new QualificationError("iOS device details did not report a usable screen mode.", { code: "TN_QUALIFY_IOS_DEVICE_BLOCKED" });
  return {
    platform: "ios",
    kind: "physical",
    identifierHash: hashIdentifier(device),
    name: /name\s*[:=]\s*([^\n]+)/iu.exec(details.stdout)?.[1]?.trim() ?? "",
    manufacturer: "Apple",
    model: /model\s*[:=]\s*([^\n]+)/iu.exec(details.stdout)?.[1]?.trim() ?? "",
    osVersion: /OS version\s*[:=]\s*([^\n]+)/iu.exec(details.stdout)?.[1]?.trim() ?? "",
    osBuild: /build version\s*[:=]\s*([^\n]+)/iu.exec(details.stdout)?.[1]?.trim() ?? "",
    cpuAbi: "arm64",
    gpu: /(?:Metal[^\n]*|GPU[^\n]*)/iu.exec(details.stdout)?.[0]?.trim() ?? "physical Metal device",
    driver: "Apple Metal device driver",
    screenModes: [{ width: Number(dimensions[1]), height: Number(dimensions[2]), orientation: Number(dimensions[1]) >= Number(dimensions[2]) ? "landscape" : "portrait" }],
    nativeGpu: true,
  };
}

function runIosQualification(options, preflightResult, artifact, dependencies = {}) {
  const locate = dependencies.findExecutable ?? findExecutable;
  const run = dependencies.command ?? command;
  const now = dependencies.now ?? Date.now;
  const device = inspectIosDevice(options.device, { command: run, findExecutable: locate });
  const installStartedAt = new Date(now()).toISOString();
  const lifecycleRun = runLifecycleScenario(options, { target: "ios", device: options.device, app: options.app }, { command: run, now });
  const collectedTelemetry = collectIosTelemetry({ path: options.iosTelemetry, durationMs: options.durationMs, cadenceMs: options.cadenceMs });
  const telemetryErrors = telemetryFailure(collectedTelemetry);
  if (telemetryErrors.length > 0) throw new QualificationError(`iOS signed-device telemetry is incomplete: ${telemetryErrors.join("; ")}`, { code: "TN_QUALIFY_TELEMETRY_INCOMPLETE", details: telemetryErrors });
  const pid = iosProcessPid(collectedTelemetry, lifecycleRun);
  const telemetry = { ...collectedTelemetry };
  delete telemetry.pid;
  delete telemetry.processPid;
  const artifactObservationPath = writeArtifactObservation(options, artifact);
  const capturePath = joinPath(options.out, "playtest/after.png");
  const artifactPaths = [
    { ...actualArtifactRecord(lifecycleRun.reportPath, "native:qualify:physical playtest"), capture: false },
    { ...actualArtifactRecord(artifactObservationPath, "native:qualify:physical artifact provenance"), capture: false },
    { ...actualArtifactRecord(capturePath, "native:qualify:physical playtest screenshot"), capture: true },
  ];
  const endedAt = new Date(now()).toISOString();
  const evidence = buildProductionEvidence({
    platform: "ios",
    source: preflightResult.source,
    artifact,
    device,
    signing: artifact,
    preflightResult,
    playtestRun: lifecycleRun,
    telemetry,
    pid,
    processLiveness: lifecycleRun.report.pass === true,
    timestamps: { startedAt: installStartedAt, endedAt, installStartedAt, launchStartedAt: lifecycleRun.startedAt, readyAt: lifecycleRun.startedAt, firstFrameAt: lifecycleRun.startedAt, frame300At: lifecycleRun.completedAt },
    artifactPaths,
    gateEvidence: readGateEvidence(options.gateEvidence),
  });
  const reportPath = joinPath(options.out, "physical-device-evidence.json");
  writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`);
  return resultFor("pass", "TN_QUALIFY_PHYSICAL_PASS", { report: reportPath });
}

export function qualifyPhysicalMobile(options, dependencies = {}) {
  const identity = classifyPhysicalDevice(options.platform, options.device);
  if (options.control === "reject-nonphysical") {
    return identity.kind === "physical-candidate"
      ? resultFor("fail", "TN_QUALIFY_CONTROL_NOT_TRIGGERED", { errors: ["reject-nonphysical control accepted a physical-candidate selector"] })
      : resultFor("blocked", identity.code, { blockers: [`${identity.code}: ${options.device ?? "missing device"}`] });
  }
  if (options.control === "break-resume") return lifecycleControl(options);
  if (options.control === "reject-unsigned") return unsignedArtifactControl(options, dependencies);
  if (options.control === "missing-prerequisite") return missingPrerequisiteControl(options);
  if (options.control !== null) return resultFor("fail", "TN_QUALIFY_ARGUMENT", { errors: [`Unknown control ${options.control}.`] });
  let artifact;
  try {
    artifact = options.platform === "android"
      ? verifyAndroidArtifact(options.app, options.candidateSha, { ...dependencies, artifactProvenance: options.artifactProvenance })
      : verifyIosArtifact(options.app, options.candidateSha, { ...dependencies, artifactProvenance: options.artifactProvenance });
  } catch (error) {
    return resultFromQualificationError(error);
  }
  const preflightResult = preflight(options, {
    source: dependencies.source,
    artifactSha256: artifact.artifactSha256,
    artifactSourceSha: artifact.sourceSha,
  });
  if (preflightResult.status !== "pass") return resultFor("blocked", preflightResult.code, { blockers: preflightResult.blockers, source: preflightResult.source });
  try {
    return options.platform === "android" ? runAndroidQualification(options, preflightResult, artifact, dependencies) : runIosQualification(options, preflightResult, artifact, dependencies);
  } catch (error) {
    return resultFromQualificationError(error);
  }
}

export function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(usage());
      return 0;
    }
    if (options.validateFixture !== null) {
      const result = validateFixture(options.validateFixture);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.status === "pass" ? 0 : result.status === "fail" ? 1 : 2;
    }
    if (options.rollup !== null) {
      if (options.control === "missing-prerequisite") {
        const result = missingPrerequisiteControl(options);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return result.status === "fail" ? 1 : 2;
      }
      if (options.candidateSha === null) {
        const result = resultFor("blocked", "TN_QUALIFY_INPUT_REQUIRED", { blockers: ["--candidate-sha is required for a physical evidence rollup"] });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return 2;
      }
      const result = rollupPhysicalDeviceEvidence(options.rollup, options.candidateSha);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.status === "pass" ? 0 : result.status === "fail" ? 1 : 2;
    }
    const result = qualifyPhysicalMobile(options);
    if (result.status === "blocked" || result.status === "fail") writeResult(options.out, result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === "pass" ? 0 : result.status === "fail" ? 1 : 2;
  } catch (error) {
    const result = error instanceof QualificationError
      ? resultFor(error.status, error.code, { errors: [error.message, ...error.details] })
      : resultFor("fail", "TN_QUALIFY_UNEXPECTED", { errors: [error instanceof Error ? error.message : String(error)] });
    process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === "fail" ? 1 : 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
