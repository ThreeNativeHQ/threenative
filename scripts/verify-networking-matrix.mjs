#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HASH_REGEX = /^[0-9a-f]{64}$/u;

function invalid(message) {
  throw new Error(`TN_NETWORKING_MATRIX: ${message}`);
}

export function assertFiniteMetrics(metrics, path = "metrics") {
  if (metrics === null || typeof metrics !== "object") {
    invalid(`${path} must be an object`);
  }
  for (const [key, value] of Object.entries(metrics)) {
    const currentPath = `${path}.${key}`;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        invalid(`non-finite metric value at ${currentPath}: ${value}`);
      }
    } else if (value !== null && typeof value === "object") {
      assertFiniteMetrics(value, currentPath);
    }
  }
}

export function assertNonEmptyObservations(observations, laneId, profile) {
  const loc = `${laneId} (${profile})`;
  if (observations === null || observations === undefined) {
    invalid(`row ${loc} has empty observations`);
  }
  if (Array.isArray(observations)) {
    if (observations.length === 0) {
      invalid(`row ${loc} has empty observations`);
    }
    for (let index = 0; index < observations.length; index += 1) {
      const item = observations[index];
      if (item === null || typeof item !== "object" || Object.keys(item).length === 0) {
        invalid(`row ${loc} observation entry ${index} is empty or invalid`);
      }
    }
  } else if (typeof observations === "object") {
    if (Object.keys(observations).length === 0) {
      invalid(`row ${loc} has empty observations`);
    }
  } else {
    invalid(`row ${loc} has empty observations`);
  }
}

function validateRowIdentity(row, sourceFile) {
  if (row.prd !== 359) {
    invalid(`${sourceFile}: prd must be 359, got ${row.prd}`);
  }
  if (typeof row.laneId !== "string" || row.laneId.trim() === "") {
    invalid(`${sourceFile}: laneId must be a non-empty string`);
  }
  if (typeof row.profile !== "string" || row.profile.trim() === "") {
    invalid(`${sourceFile}: profile must be a non-empty string`);
  }
  if (typeof row.commit !== "string" || row.commit.trim() === "") {
    invalid(`${sourceFile}: commit must be a non-empty string`);
  }
}

function validateRowHashes(row, sourceFile) {
  if (typeof row.clientBundleHash !== "string" || !HASH_REGEX.test(row.clientBundleHash)) {
    invalid(`${sourceFile}: clientBundleHash must be a 64-character lowercase hex SHA-256 hash`);
  }
  if (typeof row.serverBinaryHash !== "string" || !HASH_REGEX.test(row.serverBinaryHash)) {
    invalid(`${sourceFile}: serverBinaryHash must be a 64-character lowercase hex SHA-256 hash`);
  }
  if (
    row.nativeBinaryHash !== null &&
    (typeof row.nativeBinaryHash !== "string" || !HASH_REGEX.test(row.nativeBinaryHash))
  ) {
    invalid(
      `${sourceFile}: nativeBinaryHash must be null or a 64-character lowercase hex SHA-256 hash`,
    );
  }
}

function validateRowExecution(row, sourceFile) {
  if (row.status !== "passed") {
    invalid(
      `${sourceFile}: lane ${row.laneId} (${row.profile}) status is '${row.status}', not 'passed'`,
    );
  }
  if (!Number.isSafeInteger(row.assertionCount) || row.assertionCount <= 0) {
    invalid(`${sourceFile}: assertionCount must be a positive integer, got ${row.assertionCount}`);
  }
  assertNonEmptyObservations(row.observations, row.laneId, row.profile);
  assertFiniteMetrics(row.metrics, `${sourceFile}.metrics`);
  if (!row.versions || typeof row.versions !== "object") {
    invalid(`${sourceFile}: missing or invalid versions object`);
  }
}

function validateRowMetadata(row, sourceFile) {
  if (typeof row.startedAt !== "string" || row.startedAt.trim() === "") {
    invalid(`${sourceFile}: startedAt must be a non-empty string`);
  }
  if (typeof row.finishedAt !== "string" || row.finishedAt.trim() === "") {
    invalid(`${sourceFile}: finishedAt must be a non-empty string`);
  }
  if (typeof row.subjectSessionId !== "string" || row.subjectSessionId.trim() === "") {
    invalid(`${sourceFile}: subjectSessionId must be a non-empty string`);
  }
  if (typeof row.partnerSessionId !== "string" || row.partnerSessionId.trim() === "") {
    invalid(`${sourceFile}: partnerSessionId must be a non-empty string`);
  }
  if (!Array.isArray(row.serverObservedPlayerIds) || row.serverObservedPlayerIds.length === 0) {
    invalid(`${sourceFile}: serverObservedPlayerIds must be a non-empty string array`);
  }
  if (!Array.isArray(row.artifacts)) {
    invalid(`${sourceFile}: artifacts must be an array`);
  }
}

export function validateResultRow(row, sourceFile = "result") {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    invalid(`${sourceFile}: row must be an object`);
  }
  validateRowIdentity(row, sourceFile);
  validateRowHashes(row, sourceFile);
  validateRowExecution(row, sourceFile);
  validateRowMetadata(row, sourceFile);
  return row;
}

function validateManifestLane(lane, seenLanes) {
  if (!lane || typeof lane !== "object") {
    invalid("manifest lane must be an object");
  }
  if (typeof lane.laneId !== "string" || lane.laneId.trim() === "") {
    invalid("manifest lane laneId must be a non-empty string");
  }
  if (seenLanes.has(lane.laneId)) {
    invalid(`duplicate laneId '${lane.laneId}' in manifest`);
  }
  seenLanes.add(lane.laneId);

  const status = lane.status;
  // Coverage reads requiredProfiles directly, so an absent or empty list would either throw
  // a raw TypeError or silently mean "no profiles required". Neither is a verdict.
  if (!Array.isArray(lane.requiredProfiles) || lane.requiredProfiles.length === 0) {
    invalid(`lane '${lane.laneId}' must list at least one required profile`);
  }
  for (const profile of lane.requiredProfiles) {
    if (typeof profile !== "string" || profile.trim() === "") {
      invalid(`lane '${lane.laneId}' has a non-string or empty required profile`);
    }
  }
  if (status !== "required" && status !== "owner-deferred") {
    invalid(`lane '${lane.laneId}' status must be 'required' or 'owner-deferred', got '${status}'`);
  }

  const isIos =
    lane.platform === "ios" ||
    (typeof lane.laneId === "string" && lane.laneId.toLowerCase().startsWith("ios")) ||
    (typeof lane.laneId === "string" && lane.laneId.toLowerCase().includes("-ios"));

  if (status === "owner-deferred" && !isIos) {
    invalid(
      `lane '${lane.laneId}' cannot be deferred: only iOS lanes may be owner-deferred, so this Android deferral is rejected`,
    );
  }
}

export function validateManifest(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    invalid("manifest must be an object");
  }
  if (manifest.schemaVersion !== 1) {
    invalid(`manifest schemaVersion must be 1, got ${manifest.schemaVersion}`);
  }
  if (manifest.prd !== 359) {
    invalid(`manifest prd must be 359, got ${manifest.prd}`);
  }
  if (!Array.isArray(manifest.lanes) || manifest.lanes.length === 0) {
    invalid("manifest lanes must be a non-empty array");
  }

  const seenLanes = new Set();
  for (const lane of manifest.lanes) {
    validateManifestLane(lane, seenLanes);
  }
  return manifest;
}

async function findJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findJsonFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function loadResults(resultsDir) {
  if (!existsSync(resultsDir)) {
    invalid(`results directory does not exist: ${resultsDir}`);
  }
  const dirStat = await stat(resultsDir);
  if (!dirStat.isDirectory()) {
    invalid(`results path is not a directory: ${resultsDir}`);
  }
  const jsonPaths = await findJsonFiles(resultsDir);
  const rows = [];
  for (const filePath of jsonPaths) {
    const content = await readFile(filePath, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      invalid(
        `malformed result JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const row = validateResultRow(parsed, filePath);
    rows.push(row);
  }
  return rows;
}

function extractProtocolVersion(row) {
  return (
    row.protocolVersion ?? row.versions?.protocolVersion ?? row.versions?.protocol ?? undefined
  );
}

function assertCommitConsistency(row, manifestCommit, state) {
  if (manifestCommit !== null && manifestCommit !== undefined) {
    if (row.commit !== manifestCommit) {
      invalid(
        `row ${row.laneId} (${row.profile}) commit '${row.commit}' does not match manifest commit '${manifestCommit}'`,
      );
    }
  }
  if (state.commonCommit === undefined) {
    state.commonCommit = row.commit;
  } else if (row.commit !== state.commonCommit) {
    invalid(
      `commit mismatch across results: row ${row.laneId} (${row.profile}) has '${row.commit}', expected common '${state.commonCommit}'`,
    );
  }
}

function assertBundleHashConsistency(row, manifestBundleHash, state) {
  if (manifestBundleHash !== null && manifestBundleHash !== undefined) {
    if (row.clientBundleHash !== manifestBundleHash) {
      invalid(
        `row ${row.laneId} (${row.profile}) clientBundleHash '${row.clientBundleHash}' does not match manifest clientBundleHash '${manifestBundleHash}'`,
      );
    }
  }
  if (state.commonClientBundleHash === undefined) {
    state.commonClientBundleHash = row.clientBundleHash;
  } else if (row.clientBundleHash !== state.commonClientBundleHash) {
    invalid(
      `clientBundleHash mismatch across results: row ${row.laneId} (${row.profile}) has '${row.clientBundleHash}', expected common '${state.commonClientBundleHash}'`,
    );
  }
}

function assertProtocolConsistency(row, manifestProtocolVersion, state) {
  const rowProtocol = extractProtocolVersion(row);
  // A row that names no protocol version used to skip both checks below, so omitting the
  // field was a way past the consistency requirement the row exists to enforce.
  if (rowProtocol === undefined) {
    invalid(
      `row ${row.laneId} (${row.profile}) names no protocol version; the common-revision check cannot be satisfied by omission`,
    );
  }
  if (manifestProtocolVersion !== null && manifestProtocolVersion !== undefined) {
    if (rowProtocol !== undefined && rowProtocol !== manifestProtocolVersion) {
      invalid(
        `row ${row.laneId} (${row.profile}) protocol version '${rowProtocol}' does not match manifest protocol version '${manifestProtocolVersion}'`,
      );
    }
  }
  if (rowProtocol !== undefined) {
    if (state.commonProtocolVersion === undefined) {
      state.commonProtocolVersion = rowProtocol;
    } else if (rowProtocol !== state.commonProtocolVersion) {
      invalid(
        `protocol version mismatch across results: row ${row.laneId} (${row.profile}) has '${rowProtocol}', expected common '${state.commonProtocolVersion}'`,
      );
    }
  }
}

function indexAndValidateResults(manifest, results) {
  const resultsMap = new Map();
  const consistencyState = {
    commonCommit: undefined,
    commonClientBundleHash: undefined,
    commonProtocolVersion: undefined,
  };

  for (const row of results) {
    validateResultRow(row, `row ${row.laneId}::${row.profile}`);
    const key = `${row.laneId}::${row.profile}`;
    if (resultsMap.has(key)) {
      invalid(`duplicate result for lane '${row.laneId}' and profile '${row.profile}'`);
    }
    resultsMap.set(key, row);

    assertCommitConsistency(row, manifest.commit, consistencyState);
    assertBundleHashConsistency(row, manifest.clientBundleHash, consistencyState);
    assertProtocolConsistency(row, manifest.protocolVersion, consistencyState);
  }
  return resultsMap;
}

function assertNativeBinaryHashMatch(row, manifestLane) {
  if (manifestLane.platform === "browser") {
    if (row.nativeBinaryHash !== null) {
      invalid(
        `browser lane '${row.laneId}' must have nativeBinaryHash null, got '${row.nativeBinaryHash}'`,
      );
    }
    return;
  }
  if (manifestLane.nativeBinaryHash === null) {
    invalid(`lane '${row.laneId}' nativeBinaryHash expected hash is not yet recorded in manifest`);
  }
  if (row.nativeBinaryHash !== manifestLane.nativeBinaryHash) {
    invalid(
      `lane '${row.laneId}' nativeBinaryHash mismatch: got '${row.nativeBinaryHash}', expected '${manifestLane.nativeBinaryHash}'`,
    );
  }
}

function assertRowMatchesLane(row, manifestLane) {
  if (manifestLane.serverBinaryHash === null) {
    invalid(`lane '${row.laneId}' serverBinaryHash expected hash is not yet recorded in manifest`);
  }
  if (row.serverBinaryHash !== manifestLane.serverBinaryHash) {
    invalid(
      `lane '${row.laneId}' serverBinaryHash mismatch: got '${row.serverBinaryHash}', expected '${manifestLane.serverBinaryHash}'`,
    );
  }
  assertNativeBinaryHashMatch(row, manifestLane);
}

function assertAllResultsMatchManifestLanes(resultsMap, manifest) {
  for (const row of resultsMap.values()) {
    const manifestLane = manifest.lanes.find((lane) => lane.laneId === row.laneId);
    if (!manifestLane) {
      invalid(`result contains unknown laneId '${row.laneId}' not present in manifest`);
    }
    assertRowMatchesLane(row, manifestLane);
  }
}

function evaluateLaneCoverage(manifest, resultsMap) {
  let totalRequired = 0;
  let passedRequired = 0;
  const deferred = [];
  const passedRows = [];

  for (const lane of manifest.lanes) {
    if (lane.status === "owner-deferred") {
      deferred.push({
        laneId: lane.laneId,
        platform: lane.platform,
        status: "owner-deferred",
        reason: "owner-deferred",
      });
      continue;
    }

    const profiles = lane.requiredProfiles;
    for (const profile of profiles) {
      totalRequired += 1;
      const key = `${lane.laneId}::${profile}`;
      const row = resultsMap.get(key);
      if (!row) {
        invalid(`missing required lane: '${lane.laneId}' profile '${profile}'`);
      }
      passedRequired += 1;
      passedRows.push(row);
    }
  }

  return { totalRequired, passedRequired, deferred, passedRows };
}

export function aggregateMatrix(manifest, results) {
  validateManifest(manifest);
  // An ordinary CI run cannot execute the qualification lanes, so an empty evidence set is
  // the normal case rather than a failure. It reports "unqualified" and claims nothing. The
  // moment a single lane reports, every required row is enforced below, so partial evidence
  // — the case that could actually mislead — still fails.
  if (results.length === 0) {
    const totalRequired = manifest.lanes.reduce(
      (count, lane) => count + (lane.status === "required" ? lane.requiredProfiles.length : 0),
      0,
    );
    return {
      verdict: "unqualified",
      totalRequired,
      passedRequired: 0,
      deferredCount: 0,
      deferred: [],
      passedRows: [],
    };
  }
  const resultsMap = indexAndValidateResults(manifest, results);
  assertAllResultsMatchManifestLanes(resultsMap, manifest);
  const { totalRequired, passedRequired, deferred, passedRows } = evaluateLaneCoverage(
    manifest,
    resultsMap,
  );

  return {
    verdict: passedRequired === totalRequired && totalRequired > 0 ? "passed" : "failed",
    totalRequired,
    passedRequired,
    deferredCount: deferred.length,
    deferred,
    passedRows,
  };
}

export function formatSummary(summary) {
  const lines = [
    "=== Networking Qualification Matrix Summary ===",
    `Verdict: ${summary.verdict.toUpperCase()}`,
    `Required lanes: ${summary.passedRequired} / ${summary.totalRequired} passed`,
    `Deferred lanes: ${summary.deferredCount}`,
  ];
  if (summary.verdict === "unqualified") {
    lines.push(
      "No lane evidence in this run: no platform is qualified and no verdict is claimed.",
      "The release verdict requires --require-evidence over real lane results.",
    );
  }
  if (summary.deferred.length > 0) {
    lines.push("Explicit deferred rows (owner-deferred, not passed):");
    for (const item of summary.deferred) {
      lines.push(`  - ${item.laneId} (${item.platform}) [${item.reason}]`);
    }
  }
  return lines.join("\n");
}

export async function verifyNetworkingMatrix(options) {
  let manifest;
  if (options.manifest) {
    manifest = options.manifest;
  } else if (options.manifestPath) {
    const manifestContent = await readFile(resolve(options.manifestPath), "utf8");
    try {
      manifest = JSON.parse(manifestContent);
    } catch (error) {
      invalid(
        `malformed manifest JSON at ${options.manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    invalid("either manifest or manifestPath must be provided");
  }

  let results;
  if (Array.isArray(options.results)) {
    results = options.results;
  } else if (options.resultsDir) {
    results = await loadResults(resolve(options.resultsDir));
  } else {
    invalid("either results or resultsDir must be provided");
  }

  const summary = aggregateMatrix(manifest, results);
  return summary;
}

export function parseCli(argv) {
  let manifestPath;
  let resultsDir;
  let requireEvidence = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--manifest" && i + 1 < argv.length) {
      i += 1;
      manifestPath = argv[i];
    } else if (argv[i] === "--results" && i + 1 < argv.length) {
      i += 1;
      resultsDir = argv[i];
    } else if (argv[i] === "--require-evidence") {
      requireEvidence = true;
    } else {
      invalid(`unknown or unexpected argument '${argv[i]}'`);
    }
  }
  if (!manifestPath || !resultsDir) {
    invalid(
      "usage: node scripts/verify-networking-matrix.mjs --manifest <path> --results <dir> [--require-evidence]",
    );
  }
  return { manifestPath, requireEvidence, resultsDir };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const { manifestPath, requireEvidence, resultsDir } = parseCli(argv);
    const summary = await verifyNetworkingMatrix({ manifestPath, resultsDir });
    process.stdout.write(`${formatSummary(summary)}\n`);
    if (summary.verdict === "passed") return 0;
    // Without evidence there is nothing to judge. The release path passes
    // --require-evidence, which turns that same state into a failure.
    if (summary.verdict === "unqualified") return requireEvidence ? 1 : 0;
    return 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`TN_NETWORKING_MATRIX_VERIFY_FAILED: ${message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await main();
  process.exit(exitCode);
}
