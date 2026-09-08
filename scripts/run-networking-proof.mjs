#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createNetworkingIssuer, networkingSessionFile } from "./networking-issuer.mjs";

const HASH = /^[0-9a-f]{64}$/u;
const PLAYER_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const DEFAULT_TIMEOUTS = { cleanupMs: 5_000, clientMs: 120_000, serverMs: 15_000 };
const CLIENT_KEYS = new Set(["args", "assetDir", "command", "cwd", "env", "origin", "playerId"]);
const SERVER_KEYS = new Set(["args", "command", "cwd", "env"]);
const CONFIG_KEYS = new Set([
  "buildHashes",
  "certificates",
  "endpoint",
  "issuer",
  "laneId",
  "negativeControl",
  "partner",
  "playtest",
  "profile",
  "room",
  "server",
  "subject",
  "timeouts",
]);

function invalid(message) {
  throw new Error(`TN_NETWORKING_PROOF_CONFIG: ${message}`);
}

function record(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid(`${name} must be an object`);
  return value;
}

function exactKeys(value, allowed, name) {
  for (const key of Object.keys(value))
    if (!allowed.has(key)) invalid(`${name} has unknown key '${key}'`);
}

function nonEmpty(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    invalid(`${name} must be a nonempty string`);
  return value;
}

function absolutePath(value, name) {
  const path = nonEmpty(value, name);
  if (!isAbsolute(path)) invalid(`${name} must be absolute`);
  return resolve(path);
}

function stringArray(value, name, allowEmpty = false) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    !value.every((item) => typeof item === "string")
  )
    invalid(`${name} must be a nonempty string array`);
  return [...value];
}

function environment(value, name) {
  if (value === undefined) return {};
  const env = record(value, name);
  for (const [key, item] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || typeof item !== "string")
      invalid(`${name} must contain string environment values`);
    if (key === "MYSTRAL_WEBTRANSPORT_INSECURE")
      invalid(`${name} cannot disable peer verification`);
  }
  return { ...env };
}

function httpsUrl(value, name) {
  const text = nonEmpty(value, name);
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    invalid(`${name} must be an HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash)
    invalid(`${name} must be an HTTPS URL without credentials or a fragment`);
  return parsed.toString();
}

function hash(value, name, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !HASH.test(value))
    invalid(`${name} must be a lowercase SHA-256 hash`);
  return value;
}

function timeout(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 10 * 60 * 1000)
    invalid(`${name} must be a positive bounded integer`);
  return value;
}

function validateBuildHashes(value) {
  const hashes = record(value, "buildHashes");
  exactKeys(
    hashes,
    new Set(["clientBundleHash", "nativeBinaryHash", "serverBinaryHash"]),
    "buildHashes",
  );
  return {
    clientBundleHash: hash(hashes.clientBundleHash, "buildHashes.clientBundleHash"),
    nativeBinaryHash: hash(hashes.nativeBinaryHash, "buildHashes.nativeBinaryHash", true),
    serverBinaryHash: hash(hashes.serverBinaryHash, "buildHashes.serverBinaryHash"),
  };
}

function validateClient(value, name) {
  const client = record(value, name);
  exactKeys(client, CLIENT_KEYS, name);
  const playerId = nonEmpty(client.playerId, `${name}.playerId`);
  if (!PLAYER_ID.test(playerId)) invalid(`${name}.playerId is invalid`);
  return {
    args: stringArray(client.args, `${name}.args`),
    assetDir: absolutePath(client.assetDir, `${name}.assetDir`),
    ...(client.command === undefined
      ? {}
      : { command: nonEmpty(client.command, `${name}.command`) }),
    ...(client.cwd === undefined ? {} : { cwd: absolutePath(client.cwd, `${name}.cwd`) }),
    env: environment(client.env, `${name}.env`),
    ...(client.origin === undefined ? {} : { origin: nonEmpty(client.origin, `${name}.origin`) }),
    playerId,
  };
}

function validateServer(value) {
  const server = record(value, "server");
  exactKeys(server, SERVER_KEYS, "server");
  return {
    args: stringArray(server.args, "server.args"),
    command: nonEmpty(server.command, "server.command"),
    ...(server.cwd === undefined ? {} : { cwd: absolutePath(server.cwd, "server.cwd") }),
    env: environment(server.env, "server.env"),
  };
}

function validateNegativeControl(value) {
  const control = record(value, "negativeControl");
  exactKeys(control, new Set(["killPartnerAfterMs"]), "negativeControl");
  return {
    killPartnerAfterMs: timeout(
      control.killPartnerAfterMs,
      2_000,
      "negativeControl.killPartnerAfterMs",
    ),
  };
}

export function validateNetworkingProofConfig(value, cwd = process.cwd()) {
  const input = record(value, "root");
  exactKeys(input, CONFIG_KEYS, "root");
  const subject = validateClient(input.subject, "subject");
  const partner = validateClient(input.partner, "partner");
  if (subject.playerId === partner.playerId)
    invalid("subject and partner must use distinct player identities");
  const certificates = record(input.certificates, "certificates");
  exactKeys(certificates, new Set(["certPath", "keyPath"]), "certificates");
  const issuer = input.issuer === undefined ? {} : record(input.issuer, "issuer");
  exactKeys(issuer, new Set(["allowedOrigins", "bind"]), "issuer");
  const allowedOrigins =
    issuer.allowedOrigins === undefined
      ? [subject.origin, partner.origin].filter((origin) => origin !== undefined)
      : stringArray(issuer.allowedOrigins, "issuer.allowedOrigins");
  if (allowedOrigins.length === 0)
    invalid("issuer.allowedOrigins must contain at least one origin");
  const timeouts = input.timeouts === undefined ? {} : record(input.timeouts, "timeouts");
  exactKeys(timeouts, new Set(["cleanupMs", "clientMs", "serverMs"]), "timeouts");
  const playtest = input.playtest === undefined ? {} : record(input.playtest, "playtest");
  exactKeys(playtest, new Set(["args", "command", "cwd"]), "playtest");
  return {
    buildHashes: validateBuildHashes(input.buildHashes),
    certificates: {
      certPath: absolutePath(certificates.certPath, "certificates.certPath"),
      keyPath: absolutePath(certificates.keyPath, "certificates.keyPath"),
    },
    endpoint: httpsUrl(input.endpoint, "endpoint"),
    issuer: {
      allowedOrigins,
      bind: issuer.bind === undefined ? "127.0.0.1:0" : nonEmpty(issuer.bind, "issuer.bind"),
    },
    laneId: nonEmpty(input.laneId, "laneId"),
    negativeControl:
      input.negativeControl === undefined
        ? undefined
        : validateNegativeControl(input.negativeControl),
    partner,
    playtest: {
      args:
        playtest.args === undefined
          ? [resolve(cwd, "packages/playtest/dist/runner/cli.js")]
          : stringArray(playtest.args, "playtest.args"),
      command:
        playtest.command === undefined
          ? process.execPath
          : nonEmpty(playtest.command, "playtest.command"),
      cwd: playtest.cwd === undefined ? resolve(cwd) : absolutePath(playtest.cwd, "playtest.cwd"),
    },
    profile: nonEmpty(input.profile, "profile"),
    room: input.room === undefined ? "networking-proof" : nonEmpty(input.room, "room"),
    server: validateServer(input.server),
    subject,
    timeouts: {
      cleanupMs: timeout(timeouts.cleanupMs, DEFAULT_TIMEOUTS.cleanupMs, "timeouts.cleanupMs"),
      clientMs: timeout(timeouts.clientMs, DEFAULT_TIMEOUTS.clientMs, "timeouts.clientMs"),
      serverMs: timeout(timeouts.serverMs, DEFAULT_TIMEOUTS.serverMs, "timeouts.serverMs"),
    },
  };
}

function replaceTokens(value, tokens) {
  return value.replace(/\{\{([A-Z_]+)\}\}/gu, (whole, name) => tokens[name] ?? whole);
}

function commandArgs(args, tokens) {
  return args.map((arg) => replaceTokens(arg, tokens));
}

function collectProcess(child) {
  const output = { child, error: undefined, stderr: "", stdout: "" };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.once("error", (error) => {
    output.error = error;
  });
  child.stdout?.on("data", (chunk) => {
    output.stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    output.stderr += String(chunk);
  });
  return output;
}

function spawnOwned(command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    detached: process.platform !== "win32",
    env: { ...process.env, ...options.env },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return collectProcess(child);
}

function waitForPattern(processState, pattern, timeoutMs, name) {
  const started = Date.now();
  return new Promise((resolveReady, rejectReady) => {
    const timer = setInterval(() => {
      const output = `${processState.stdout}\n${processState.stderr}`;
      if (pattern.test(output)) {
        clearInterval(timer);
        resolveReady(output);
      } else if (processState.child.exitCode !== null || processState.child.signalCode !== null) {
        clearInterval(timer);
        rejectReady(
          new Error(
            `${name} exited before readiness (code=${processState.child.exitCode ?? "signal"})`,
          ),
        );
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        rejectReady(new Error(`${name} readiness timed out after ${timeoutMs}ms`));
      }
    }, 25);
  });
}

function waitForExit(processState, timeoutMs) {
  if (processState.error !== undefined) return Promise.resolve(127);
  if (processState.child.exitCode !== null || processState.child.signalCode !== null)
    return Promise.resolve(processState.child.exitCode ?? 1);
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => resolveExit(null), timeoutMs);
    processState.child.once("close", (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });
}

async function stopOwned(processState, timeoutMs) {
  if (
    processState === undefined ||
    processState.child.exitCode !== null ||
    processState.child.signalCode !== null
  )
    return;
  const pid = processState.child.pid;
  if (pid === undefined) return;
  try {
    process.kill(process.platform === "win32" ? pid : -pid, "SIGTERM");
  } catch {
    processState.child.kill("SIGTERM");
  }
  if ((await waitForExit(processState, timeoutMs)) !== null) return;
  try {
    process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL");
  } catch {
    processState.child.kill("SIGKILL");
  }
  await waitForExit(processState, timeoutMs);
}

function serverAuthority(output) {
  const match = /LISTENING\s+udp=([^\s]+)\s+admin=([^\s]+)/u.exec(output);
  if (!match)
    throw new Error("server readiness did not report LISTENING udp and admin authorities");
  return { admin: match[2], udp: match[1] };
}

function issuerUrl(address, endpoint) {
  const target = new URL(endpoint);
  const parsed = new URL(address);
  parsed.hostname = target.hostname;
  parsed.pathname = "/token";
  return parsed.toString();
}

function redacted(value, secrets = []) {
  let text = String(value);
  for (const secret of secrets) if (secret) text = text.replaceAll(secret, "[REDACTED]");
  return text
    .replace(/(Authorization:\s*Bearer\s+)[A-Za-z0-9_-]+/giu, "$1[REDACTED]")
    .replace(/("(?:credential|issuerAuthorization)"\s*:\s*")[^"]+/giu, "$1[REDACTED]");
}

async function writeArtifact(root, name, content, secrets) {
  const path = join(root, name);
  await writeFile(path, redacted(content, secrets));
  return {
    kind: name,
    path,
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
  };
}

function jsonFromOutput(text, name) {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index]?.startsWith("{")) continue;
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Pretty-printed output is handled below.
    }
  }
  for (let start = text.lastIndexOf("{"); start >= 0; start = text.lastIndexOf("{", start - 1)) {
    try {
      return JSON.parse(text.slice(start));
    } catch {
      // Look for the next outer object.
    }
  }
  throw new Error(`${name} did not print a JSON playtest report`);
}

function reportResource(report, path) {
  const resources = report?.observations?.resources;
  const state = resources?.state ?? resources?.GameState;
  const after = state?.after;
  if (after === undefined)
    throw new Error(`playtest report did not observe state resource '${path}'`);
  return path.split(".").reduce((value, key) => value?.[key], after);
}

function finite(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${name} is not a finite number`);
  return value;
}

function appendNetworkingCpuReport(line, name, frames, samples) {
  const prefix = "TN_HOST_GAP:";
  const marker = line.indexOf(prefix);
  if (marker === -1) return;
  let report;
  try {
    report = JSON.parse(line.slice(marker + prefix.length));
  } catch (error) {
    throw new Error(
      `${name} emitted malformed TN_HOST_GAP JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Number.isSafeInteger(report?.frames) || report.frames <= 0)
    throw new Error(`${name} TN_HOST_GAP report has an invalid frame count`);
  if (!Array.isArray(report.samples) || report.samples.length !== report.frames)
    throw new Error(`${name} TN_HOST_GAP sample count does not match frames`);
  for (const sample of report.samples) appendNetworkingCpuSample(sample, name, frames, samples);
}

function appendNetworkingCpuSample(sample, name, frames, samples) {
  if (!Number.isSafeInteger(sample?.frame) || sample.frame <= 0)
    throw new Error(`${name} TN_HOST_GAP sample has an invalid frame identity`);
  if (frames.has(sample.frame))
    throw new Error(`${name} TN_HOST_GAP has a duplicate frame ${sample.frame}`);
  const webtransportMs = finite(sample.webtransportMs, `${name}.webtransportMs`);
  if (webtransportMs < 0) throw new Error(`${name}.webtransportMs cannot be negative`);
  frames.add(sample.frame);
  samples.push({ frame: sample.frame, webtransportMs });
}

export function parseNetworkingCpuSamples(log, name = "native") {
  const samples = [];
  const frames = new Set();
  for (const line of String(log).split(/\r?\n/u))
    appendNetworkingCpuReport(line, name, frames, samples);
  if (samples.length === 0) throw new Error(`${name} did not emit frame-keyed TN_HOST_GAP samples`);
  return samples;
}

function summarizeNetworkingCpu(samples) {
  const values = samples.map((sample) => sample.webtransportMs).sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(values.length * 0.95) - 1);
  return {
    maxMs: values[values.length - 1],
    p95Ms: values[p95Index],
    sampleCount: values.length,
  };
}

export function summarizeCombinedNetworkingCpu(jsSamples, nativeSamples, name = "client") {
  if (!Array.isArray(jsSamples) || jsSamples.length === 0)
    throw new Error(`${name} has no JS networking CPU samples`);
  if (!Array.isArray(nativeSamples) || nativeSamples.length === 0)
    throw new Error(`${name} has no native networking CPU samples`);
  const nativeMaximum = Math.max(...nativeSamples.map((sample) => sample.webtransportMs));
  const values =
    jsSamples.length === nativeSamples.length
      ? jsSamples.map((sample, index) => sample + nativeSamples[index].webtransportMs)
      : jsSamples.map((sample) => sample + nativeMaximum);
  return summarizeSamples(values, `${name} combined networking CPU`);
}

function nearestRank(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index];
}

function summarizeSamples(values, name) {
  if (values.length === 0) throw new Error(`${name} has no samples`);
  return {
    maxMs: Math.max(...values),
    p50Ms: nearestRank(values, 0.5),
    p95Ms: nearestRank(values, 0.95),
    p99Ms: nearestRank(values, 0.99),
    sampleCount: values.length,
  };
}

function metricNumberArray(value, name) {
  if (!Array.isArray(value) || !value.every((sample) => typeof sample === "number"))
    throw new Error(`${name} must be a number array`);
  const samples = value.map((sample) => finite(sample, `${name} sample`));
  if (samples.some((sample) => sample < 0)) throw new Error(`${name} cannot contain negatives`);
  return samples;
}

function metricNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative safe integer`);
  return value;
}

export function parseNetworkingMetrics(log, name = "client") {
  const prefix = "TN_NETWORK_METRICS:";
  const matches = String(log)
    .split(/\r?\n/u)
    .filter((line) => line.includes(prefix))
    .map((line) => line.slice(line.indexOf(prefix) + prefix.length).trim());
  if (matches.length === 0) throw new Error(`${name} did not emit TN_NETWORK_METRICS`);
  let value;
  try {
    value = JSON.parse(matches[matches.length - 1]);
  } catch (error) {
    throw new Error(
      `${name} emitted malformed TN_NETWORK_METRICS JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} metrics must be an object`);
  const keys = Object.keys(value).sort().join(",");
  if (
    keys !==
    "actionAckLatencyMs,appliedStateAgeMs,clockProbes,collectionDurationMs,jsNetworkingCpuMs,schemaVersion,unmatchedActionAckCount,warmupMs"
  )
    throw new Error(`${name} metrics have unexpected keys`);
  if (value.schemaVersion !== 2) throw new Error(`${name} metrics schema version is unsupported`);
  const warmupMs = finite(value.warmupMs, `${name}.warmupMs`);
  const collectionDurationMs = finite(value.collectionDurationMs, `${name}.collectionDurationMs`);
  if (warmupMs < 0 || collectionDurationMs < 0)
    throw new Error(`${name} measurement durations cannot be negative`);
  const unmatchedActionAckCount = metricNonNegativeInteger(
    value.unmatchedActionAckCount,
    `${name}.unmatchedActionAckCount`,
  );
  const clockProbes = value.clockProbes;
  if (!Array.isArray(clockProbes)) throw new Error(`${name}.clockProbes must be an array`);
  const parsedClockProbes = clockProbes.map((probe, index) => {
    if (probe === null || typeof probe !== "object" || Array.isArray(probe))
      throw new Error(`${name}.clockProbes[${index}] must be an object`);
    const probeKeys = Object.keys(probe).sort().join(",");
    if (probeKeys !== "offsetMs,rttMs,uncertaintyMs")
      throw new Error(`${name}.clockProbes[${index}] has unexpected keys`);
    const rttMs = finite(probe.rttMs, `${name}.clockProbes[${index}].rttMs`);
    const offsetMs = finite(probe.offsetMs, `${name}.clockProbes[${index}].offsetMs`);
    const uncertaintyMs = finite(
      probe.uncertaintyMs,
      `${name}.clockProbes[${index}].uncertaintyMs`,
    );
    if (rttMs < 0 || uncertaintyMs < 0)
      throw new Error(`${name}.clockProbes[${index}] contains a negative value`);
    return { rttMs, offsetMs, uncertaintyMs };
  });
  return {
    schemaVersion: 2,
    appliedStateAgeMs: metricNumberArray(value.appliedStateAgeMs, `${name}.appliedStateAgeMs`),
    actionAckLatencyMs: metricNumberArray(value.actionAckLatencyMs, `${name}.actionAckLatencyMs`),
    collectionDurationMs,
    jsNetworkingCpuMs: metricNumberArray(value.jsNetworkingCpuMs, `${name}.jsNetworkingCpuMs`),
    clockProbes: parsedClockProbes,
    unmatchedActionAckCount,
    warmupMs,
  };
}

export function summarizeNetworkingMetrics(metrics, profile) {
  if (metrics.appliedStateAgeMs.length === 0 || metrics.clockProbes.length === 0)
    throw new Error("missing applied-state or clock samples");
  const actionAckLatencyMs = summarizeSamples(metrics.actionAckLatencyMs, "action acknowledgement");
  const jsNetworkingCpuMs = summarizeSamples(metrics.jsNetworkingCpuMs, "JS networking CPU");
  const appliedStateAgeMs = summarizeSamples(metrics.appliedStateAgeMs, "applied-state age");
  if (metrics.actionAckLatencyMs.length < 100)
    throw new Error(
      `action acknowledgement has ${metrics.actionAckLatencyMs.length} samples; need at least 100 action samples`,
    );
  if (metrics.warmupMs < 10_000)
    throw new Error(`warmup lasted only ${metrics.warmupMs}ms; need 10000ms`);
  if (metrics.collectionDurationMs < 60_000)
    throw new Error(`collection lasted only ${metrics.collectionDurationMs}ms; need 60000ms`);
  if (metrics.unmatchedActionAckCount !== 0)
    throw new Error(`unmatched action acknowledgements: ${metrics.unmatchedActionAckCount}`);
  const minimumRttProbe = [...metrics.clockProbes].sort(
    (left, right) => left.rttMs - right.rttMs,
  )[0];
  const maxUncertaintyMs = Math.max(...metrics.clockProbes.map((probe) => probe.uncertaintyMs));
  if (minimumRttProbe.uncertaintyMs > 100)
    throw new Error(`clock uncertainty ${minimumRttProbe.uncertaintyMs}ms exceeds 100ms`);
  const ageLimitMs = /impaired/iu.test(profile) ? 350 : 150;
  if (appliedStateAgeMs.p95Ms > ageLimitMs)
    throw new Error(`applied-state age p95 ${appliedStateAgeMs.p95Ms}ms exceeds ${ageLimitMs}ms`);
  if (actionAckLatencyMs.p99Ms > 2_000)
    throw new Error(`action acknowledgement p99 ${actionAckLatencyMs.p99Ms}ms exceeds 2000ms`);
  if (jsNetworkingCpuMs.p95Ms > 1)
    throw new Error(`JS networking CPU p95 ${jsNetworkingCpuMs.p95Ms}ms exceeds 1ms`);
  return {
    actionAckLatencyMs,
    appliedStateAgeMs,
    clock: {
      maxUncertaintyMs,
      minimumRttMs: minimumRttProbe.rttMs,
      offsetMs: minimumRttProbe.offsetMs,
      sampleCount: metrics.clockProbes.length,
      selectedUncertaintyMs: minimumRttProbe.uncertaintyMs,
    },
    jsNetworkingCpuMs,
  };
}

function clientObservation(report, client) {
  const sessionId = reportResource(report, "networkSessionId");
  const peerId = reportResource(report, "networkPeerId");
  if (typeof sessionId !== "string" || sessionId.length === 0)
    throw new Error(`${client} did not report a session identity`);
  if (typeof peerId !== "string" || peerId !== client.peerId)
    throw new Error(`${client} reported peer '${String(peerId)}', expected '${client.peerId}'`);
  return {
    actionAcks: finite(reportResource(report, "networkActionAcks"), `${client}.networkActionAcks`),
    connected: reportResource(report, "networkConnected"),
    peerId,
    peerObserved: reportResource(report, "networkPeerObserved"),
    protocolErrors: finite(
      reportResource(report, "networkProtocolErrors"),
      `${client}.networkProtocolErrors`,
    ),
    unmatchedActionAcks: finite(
      reportResource(report, "networkUnmatchedActionAcks"),
      `${client}.networkUnmatchedActionAcks`,
    ),
    remoteDistance: finite(
      reportResource(report, "networkRemoteDistance"),
      `${client}.networkRemoteDistance`,
    ),
    sessionId,
  };
}

function requireWholeFrameBudget(report, name) {
  const results = Array.isArray(report?.assertionResults) ? report.assertionResults : [];
  const hasPassing = (id) => results.some((result) => result?.id === id && result.pass === true);
  if (!hasPassing("performance.samples"))
    throw new Error(`${name} did not provide passing whole-frame performance samples`);
  if (!hasPassing("performance.maxFrameMsP95"))
    throw new Error(`${name} did not enforce a whole-frame p95 budget`);
}

export function countEvaluatedAssertions(reports) {
  const count = reports.reduce(
    (total, report) =>
      total + (Array.isArray(report?.assertionResults) ? report.assertionResults.length : 0),
    0,
  );
  if (count === 0) throw new Error("networking proof evaluated zero assertions");
  return count;
}

function serverPlayers(log) {
  const players = new Set();
  for (const match of log.matchAll(/(?:player(?:Id)?|player)=([A-Za-z0-9_-]{1,64})/gu))
    players.add(match[1]);
  return [...players].sort();
}

async function waitForServerPlayers(server, offset, playerIds, timeoutMs) {
  const started = Date.now();
  return new Promise((resolveReady, rejectReady) => {
    const timer = setInterval(() => {
      const output = `${server.stdout}\n${server.stderr}`.slice(offset);
      if (playerIds.every((playerId) => output.includes(`player connected player=${playerId} `))) {
        clearInterval(timer);
        resolveReady(output);
      } else if (server.child.exitCode !== null || server.child.signalCode !== null) {
        clearInterval(timer);
        rejectReady(new Error("server exited before the negative-control clients joined"));
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        rejectReady(new Error(`negative-control client readiness timed out after ${timeoutMs}ms`));
      }
    }, 25);
  });
}

async function waitForServerSessionEnd(server, offset, playerId, sessionId, timeoutMs) {
  const started = Date.now();
  return new Promise((resolveEnded, rejectEnded) => {
    const timer = setInterval(() => {
      const output = `${server.stdout}\n${server.stderr}`.slice(offset);
      if (output.includes(`player session ended player=${playerId} session=${sessionId}`)) {
        clearInterval(timer);
        resolveEnded();
      } else if (server.child.exitCode !== null || server.child.signalCode !== null) {
        clearInterval(timer);
        rejectEnded(new Error("server exited before the killed partner session ended"));
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        rejectEnded(new Error(`killed partner session did not end within ${timeoutMs}ms`));
      }
    }, 25);
  });
}

function connectedSessionId(log, playerId) {
  const escaped = playerId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`player connected player=${escaped} session=([0-9a-f]+)`, "u").exec(log);
  if (match?.[1] === undefined)
    throw new Error(`server readiness did not report a session for player '${playerId}'`);
  return match[1];
}

async function ownedDescendants(pid, seen = new Set()) {
  if (seen.has(pid) || process.platform === "win32") return seen;
  seen.add(pid);
  try {
    const children = (await readFile(`/proc/${pid}/task/${pid}/children`, "utf8"))
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .map(Number);
    for (const child of children) await ownedDescendants(child, seen);
  } catch {
    // The owner may have exited between the process-tree reads; its group is still killed below.
  }
  return seen;
}

async function procCommands() {
  let entries;
  try {
    entries = await readdir("/proc");
  } catch {
    return [];
  }
  const commands = [];
  for (const entry of entries) {
    if (!/^\d+$/u.test(entry)) continue;
    try {
      commands.push({
        commandLine: (await readFile(`/proc/${entry}/cmdline`)).toString("utf8"),
        pid: Number(entry),
      });
    } catch {
      // The process may exit between the directory scan and the command-line read.
    }
  }
  return commands;
}

function processUsesProfile(commandLine, profiles) {
  for (const profile of profiles)
    if (commandLine.includes(`--user-data-dir=${profile}`)) return true;
  return false;
}

async function markedProcesses(marker, profiles = new Set()) {
  if (process.platform === "win32" || marker === undefined) return [];
  const commands = await procCommands();
  for (const { commandLine } of commands) {
    if (!commandLine.includes(marker)) continue;
    const profile = /--user-data-dir=([^\0\s]+)/u.exec(commandLine)?.[1];
    if (profile !== undefined) profiles.add(profile);
  }
  return commands
    .filter(
      ({ commandLine }) =>
        commandLine.includes(marker) || processUsesProfile(commandLine, profiles),
    )
    .map(({ pid }) => pid);
}

function signalProcesses(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // A process may exit between the snapshot and the signal.
    }
  }
}

async function collectOwnedTrees(pids, initial = new Set()) {
  const descendants = new Set(initial);
  for (const pid of pids) await ownedDescendants(pid, descendants);
  return descendants;
}

function signalProcessGroups(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(-pid, signal);
    } catch {
      // A process group may already have exited or may not be a group leader.
    }
  }
}

async function killMarkedProcessesUntilGone(marker, profiles = new Set(), alreadySeen = false) {
  if (process.platform === "win32" || marker === undefined) return 0;
  let killed = 0;
  let seen = alreadySeen;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const matches = await markedProcesses(marker, profiles);
    if (matches.length === 0) {
      if (seen) return killed;
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      continue;
    }
    seen = true;
    killed += matches.length;
    const trees = await collectOwnedTrees(matches, new Set(matches));
    signalProcesses([...trees].reverse(), "SIGKILL");
    signalProcessGroups(matches, "SIGKILL");
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  return killed;
}

async function forceUnixOwnedTree(processState, processMarker, knownDescendants) {
  const pid = processState?.child?.pid;
  const descendants = await collectOwnedTrees(
    pid === undefined ? [] : [pid],
    new Set(knownDescendants),
  );
  const profiles = new Set();
  const marked = await markedProcesses(processMarker, profiles);
  const termTargets = await collectOwnedTrees(marked, descendants);
  signalProcesses([...termTargets].reverse(), "SIGTERM");
  signalProcessGroups(
    [pid, ...marked].filter((candidate) => candidate !== undefined),
    "SIGTERM",
  );
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  const lateMarked = await markedProcesses(processMarker, profiles);
  const killTargets = await collectOwnedTrees(lateMarked, termTargets);
  signalProcesses([...killTargets].reverse(), "SIGKILL");
  signalProcessGroups(
    [pid, ...marked, ...lateMarked].filter((candidate) => candidate !== undefined),
    "SIGKILL",
  );
  return (
    marked.length +
    lateMarked.length +
    (await killMarkedProcessesUntilGone(
      processMarker,
      profiles,
      marked.length + lateMarked.length > 0,
    ))
  );
}

async function forceOwnedTree(processState, processMarker, knownDescendants = new Set()) {
  if (process.platform !== "win32")
    return forceUnixOwnedTree(processState, processMarker, knownDescendants);
  if (processState?.child?.pid !== undefined) processState.child.kill("SIGKILL");
  return knownDescendants.size;
}

function assertPass(report, name) {
  if (report?.pass !== true)
    throw new Error(`${name} playtest did not pass its authored assertions`);
}

function outputBase(config, startedAt) {
  return {
    artifacts: [],
    assertionCount: 0,
    clientBundleHash: config.buildHashes.clientBundleHash,
    commandExitCodes: {},
    commit: process.env.GIT_COMMIT ?? "unknown",
    finishedAt: startedAt,
    laneId: config.laneId,
    metrics: {},
    negativeControls: {},
    nativeBinaryHash: config.buildHashes.nativeBinaryHash,
    observations: {},
    partnerSessionId: "",
    prd: 359,
    profile: config.profile,
    serverBinaryHash: config.buildHashes.serverBinaryHash,
    serverObservedPlayerIds: [],
    startedAt,
    status: "unavailable",
    subjectSessionId: "",
    versions: { node: process.version, platform: process.platform },
  };
}

async function ensurePrerequisites(config) {
  for (const path of [config.certificates.certPath, config.certificates.keyPath]) {
    if (!existsSync(path)) throw new Error(`required certificate path is missing: ${path}`);
  }
  for (const client of [config.subject, config.partner]) {
    if (!existsSync(client.assetDir))
      throw new Error(`client asset directory is missing: ${client.assetDir}`);
  }
  if (config.buildHashes.nativeBinaryHash !== null && config.profile === "browser")
    throw new Error("browser profile must set nativeBinaryHash to null");
}

async function startProofServer(config) {
  const serverTokens = Object.fromEntries([["SERVER_ENDPOINT", config.endpoint]]);
  const processState = spawnOwned(
    config.server.command,
    commandArgs(config.server.args, serverTokens),
    {
      cwd: config.server.cwd ?? config.playtest.cwd,
      env: config.server.env,
    },
  );
  const readyOutput = await waitForPattern(
    processState,
    /LISTENING\s+udp=/u,
    config.timeouts.serverMs,
    "server",
  );
  return { authorities: serverAuthority(readyOutput), processState };
}

async function startProofIssuer(config, authorities) {
  const issuer = createNetworkingIssuer(
    {
      adminUrl: `http://${authorities.admin}`,
      allowedOrigins: config.issuer.allowedOrigins,
      bind: config.issuer.bind,
      certPath: config.certificates.certPath,
      clients: [
        { assetDir: config.subject.assetDir, playerId: config.subject.playerId },
        { assetDir: config.partner.assetDir, playerId: config.partner.playerId },
      ],
      keyPath: config.certificates.keyPath,
      room: config.room,
    },
    { logger: () => {} },
  );
  const started = await issuer.start();
  return {
    issuer,
    tokenUrl: issuerUrl(started.address, config.endpoint),
  };
}

function replaceScenarioArgument(args, scenarioPath) {
  const scenarioIndex = args.indexOf("--scenario");
  if (scenarioIndex === -1 || args[scenarioIndex + 1] === undefined)
    throw new Error("negative control client args must name a scenario with --scenario");
  const replaced = [...args];
  replaced[scenarioIndex + 1] = scenarioPath;
  return replaced;
}

function browserTarget(client) {
  const targetIndex = client.args.indexOf("--target");
  return targetIndex === -1 || client.args[targetIndex + 1] === "browser";
}

export function addBrowserProcessMarker(args, marker) {
  if (marker === undefined || args.includes("--browser-recipe")) return [...args];
  return [...args, "--browser-arg", `--user-agent=${marker}`];
}

async function startClient(
  config,
  client,
  label,
  tokens,
  root,
  secrets,
  scenarioPath,
  browserProcessMarker,
) {
  const configPath = join(client.assetDir, `networking-${label}.config.json`);
  if (existsSync(configPath))
    throw new Error(`refusing to overwrite existing client config: ${configPath}`);
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        enabled: true,
        endpoint: tokens.SERVER_ENDPOINT,
        issuerUrl: tokens.ISSUER_URL,
        playerId: client.playerId,
        room: config.room,
      },
      null,
      2,
    )}\n`,
  );
  const artifactDir = join(root, label);
  await mkdir(artifactDir, { recursive: true });
  const clientArgs =
    scenarioPath === undefined ? client.args : replaceScenarioArgument(client.args, scenarioPath);
  const args = commandArgs(config.playtest.args, tokens).concat(commandArgs(clientArgs, tokens));
  const clientPlaytestArgs = addBrowserProcessMarker(args, browserProcessMarker);
  if (!clientPlaytestArgs.includes("--artifacts"))
    clientPlaytestArgs.push("--artifacts", artifactDir);
  const env = Object.fromEntries([
    ...Object.entries(config.server.env),
    ...Object.entries(client.env),
    ["SSL_CERT_FILE", config.certificates.certPath],
    ["THREENATIVE_NETWORKING_CONFIG", configPath],
  ]);
  const processState = spawnOwned(client.command ?? config.playtest.command, clientPlaytestArgs, {
    cwd: client.cwd ?? config.playtest.cwd,
    env,
  });
  return { browserProcessMarker, configPath, processState };
}

async function collectClientConsole(root, label, secrets) {
  const consolePath = join(root, label, "console.json");
  if (!existsSync(consolePath)) return { consoleOutput: "", consoleArtifact: undefined };
  const consoleText = await readFile(consolePath, "utf8");
  let consoleOutput = consoleText;
  try {
    const entries = JSON.parse(consoleText);
    if (Array.isArray(entries))
      consoleOutput = entries.map((entry) => String(entry?.text ?? "")).join("\n");
  } catch {
    // Keep the raw console output when the browser stopped while writing the file.
  }
  return {
    consoleArtifact: await writeArtifact(root, `${label}.console.json`, consoleText, secrets),
    consoleOutput,
  };
}

async function collectClient(config, client, label, root, secrets, started) {
  const { configPath, processState } = started;
  try {
    const exitCode = await waitForExit(processState, config.timeouts.clientMs);
    let report;
    let reportError;
    if (exitCode !== null) {
      try {
        report = jsonFromOutput(processState.stdout, label);
      } catch (error) {
        reportError = error instanceof Error ? error.message : String(error);
      }
    }
    const stdoutArtifact = await writeArtifact(
      root,
      `${label}.stdout.log`,
      processState.stdout,
      secrets,
    );
    const stderrArtifact = await writeArtifact(
      root,
      `${label}.stderr.log`,
      processState.stderr,
      secrets,
    );
    const { consoleArtifact, consoleOutput } = await collectClientConsole(root, label, secrets);
    return {
      artifacts: [
        stdoutArtifact,
        stderrArtifact,
        ...(consoleArtifact === undefined ? [] : [consoleArtifact]),
      ],
      browserProcessMarker: started.browserProcessMarker,
      metricArtifactSha256: consoleArtifact?.sha256 ?? stdoutArtifact.sha256,
      metricOutput: `${processState.stdout}\n${processState.stderr}\n${consoleOutput}`,
      exitCode,
      processState,
      ...(report === undefined ? {} : { report }),
      ...(reportError === undefined ? {} : { reportError }),
    };
  } finally {
    await rm(configPath, { force: true });
  }
}

async function runClient(
  config,
  client,
  label,
  tokens,
  root,
  secrets,
  scenarioPath,
  browserProcessMarker,
) {
  const started = await startClient(
    config,
    client,
    label,
    tokens,
    root,
    secrets,
    scenarioPath,
    browserProcessMarker,
  );
  return collectClient(config, client, label, root, secrets, started);
}

async function runProofClients(config, artifactRoot, secrets, tokens) {
  const markerPrefix = `ThreeNativeNetworkingProof/${process.pid}-${Date.now()}`;
  const subjectTokens = Object.fromEntries([
    ...Object.entries(tokens),
    ["PLAYER_ID", config.subject.playerId],
  ]);
  const partnerTokens = Object.fromEntries([
    ...Object.entries(tokens),
    ["PLAYER_ID", config.partner.playerId],
  ]);
  return Promise.all([
    runClient(
      config,
      config.subject,
      "subject",
      subjectTokens,
      artifactRoot,
      secrets,
      undefined,
      browserTarget(config.subject) ? `${markerPrefix}-subject` : undefined,
    ),
    runClient(
      config,
      config.partner,
      "partner",
      partnerTokens,
      artifactRoot,
      secrets,
      undefined,
      browserTarget(config.partner) ? `${markerPrefix}-partner` : undefined,
    ),
  ]);
}

function configuredScenarioPath(config, client) {
  const scenarioIndex = client.args.indexOf("--scenario");
  const declared = client.args[scenarioIndex + 1];
  if (scenarioIndex === -1 || declared === undefined)
    throw new Error("negative control client args must name a scenario with --scenario");
  return resolve(client.cwd ?? config.playtest.cwd, declared);
}

async function createPartnerLossScenario(config, artifactRoot) {
  const subjectScenarioPath = configuredScenarioPath(config, config.subject);
  const partnerScenarioPath = configuredScenarioPath(config, config.partner);
  if (subjectScenarioPath !== partnerScenarioPath)
    throw new Error("negative control requires subject and partner to use the same scenario");
  let source;
  try {
    source = JSON.parse(await readFile(subjectScenarioPath, "utf8"));
  } catch (error) {
    throw new Error(
      `negative control scenario could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const scenario = record(source, "negative control scenario");
  const assertions = record(scenario.assert, "negative control scenario.assert");
  const lossScenario = {
    ...scenario,
    assert: {
      ...assertions,
      resources: [
        {
          allowTrivial:
            "The subject must observe its authenticated peer before the controlled partner loss.",
          atSteps: [{ equals: true, label: "peer-established" }],
          id: "state",
          path: "networkPeerObserved",
        },
        {
          allowTrivial:
            "The local transport remains connected while the subject observes the partner disappear.",
          atSteps: [
            { equals: true, label: "peer-established" },
            { equals: true, label: "partner-loss" },
          ],
          id: "state",
          path: "networkConnected",
        },
        {
          allowTrivial:
            "The peer observation must clear after the killed partner stops producing snapshots.",
          atSteps: [
            { equals: true, label: "peer-established" },
            { equals: false, label: "partner-loss" },
          ],
          id: "state",
          path: "networkPeerObserved",
        },
        {
          allowTrivial:
            "The loss path must not introduce a protocol parse failure while closing the peer.",
          equals: 0,
          id: "state",
          path: "networkProtocolErrors",
        },
      ],
    },
    name: `${String(scenario.name ?? "networking")}-partner-loss`,
    steps: [
      {
        label: "peer-established",
        timeoutMs: 15_000,
        waitForResource: { equals: true, id: "state", path: "networkPeerObserved" },
      },
      { label: "partner-loss", waitFrames: 60_000 },
    ],
  };
  const path = join(artifactRoot, "negative-control.playtest.json");
  await writeFile(path, `${JSON.stringify(lossScenario, null, 2)}\n`);
  return path;
}

async function runPartnerLossControl(config, artifactRoot, secrets, tokens, server) {
  const lossScenarioPath = await createPartnerLossScenario(config, artifactRoot);
  const lossRoot = join(artifactRoot, "negative-control");
  await mkdir(lossRoot, { recursive: true });
  const subjectTokens = Object.fromEntries([
    ...Object.entries(tokens),
    ["PLAYER_ID", config.subject.playerId],
  ]);
  const partnerTokens = Object.fromEntries([
    ...Object.entries(tokens),
    ["PLAYER_ID", config.partner.playerId],
  ]);
  const markerPrefix = `ThreeNativeNetworkingProof/${process.pid}-${Date.now()}`;
  const subjectProcessMarker = browserTarget(config.subject)
    ? `${markerPrefix}-subject`
    : undefined;
  const partnerProcessMarker = browserTarget(config.partner)
    ? `${markerPrefix}-partner`
    : undefined;
  const serverLogOffset = `${server.stdout}\n${server.stderr}`.length;
  const subjectStarted = await startClient(
    config,
    config.subject,
    "subject",
    subjectTokens,
    lossRoot,
    secrets,
    lossScenarioPath,
    subjectProcessMarker,
  );
  let partnerStarted;
  try {
    partnerStarted = await startClient(
      config,
      config.partner,
      "partner",
      partnerTokens,
      lossRoot,
      secrets,
      lossScenarioPath,
      partnerProcessMarker,
    );
  } catch (error) {
    await stopOwned(subjectStarted.processState, config.timeouts.cleanupMs);
    await rm(subjectStarted.configPath, { force: true });
    throw error;
  }
  let readinessOutput;
  try {
    readinessOutput = await waitForServerPlayers(
      server,
      serverLogOffset,
      [config.subject.playerId, config.partner.playerId],
      config.timeouts.clientMs,
    );
  } catch (error) {
    await Promise.all([
      stopOwned(subjectStarted.processState, config.timeouts.cleanupMs),
      stopOwned(partnerStarted.processState, config.timeouts.cleanupMs),
    ]);
    await Promise.all([
      rm(subjectStarted.configPath, { force: true }),
      rm(partnerStarted.configPath, { force: true }),
    ]);
    throw error;
  }
  const killedPartnerSessionId = connectedSessionId(readinessOutput, config.partner.playerId);
  const partnerDescendants =
    partnerStarted.processState.child.pid === undefined
      ? new Set()
      : await ownedDescendants(partnerStarted.processState.child.pid);
  let killRequestedAt;
  let killFinishedAt;
  let killMatchedCount = 0;
  let killPromise = Promise.resolve();
  const killTimer = setTimeout(() => {
    killRequestedAt = new Date().toISOString();
    killPromise = forceOwnedTree(
      partnerStarted.processState,
      partnerProcessMarker,
      partnerDescendants,
    )
      .then((matchedCount) => {
        killMatchedCount = matchedCount;
      })
      .then(() => waitForExit(partnerStarted.processState, config.timeouts.cleanupMs))
      .then(() => {
        killFinishedAt = new Date().toISOString();
      });
  }, config.negativeControl.killPartnerAfterMs);
  const [subject, partner] = await Promise.all([
    collectClient(config, config.subject, "subject", lossRoot, secrets, subjectStarted),
    collectClient(config, config.partner, "partner", lossRoot, secrets, partnerStarted),
  ]);
  clearTimeout(killTimer);
  await killPromise;
  try {
    await waitForServerSessionEnd(
      server,
      serverLogOffset,
      config.partner.playerId,
      killedPartnerSessionId,
      Math.min(config.timeouts.clientMs, 30_000),
    );
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} (controlledKillMatched=${killMatchedCount})`,
    );
  }
  if (killRequestedAt === undefined || killFinishedAt === undefined)
    throw new Error("negative control partner did not remain alive until the controlled kill");
  if (subject.report === undefined)
    throw new Error(subject.reportError ?? "negative control subject did not produce a report");
  const assertionCount = countEvaluatedAssertions([subject.report]);
  assertPass(subject.report, "negative control subject");
  if (reportResource(subject.report, "networkConnected") !== true)
    throw new Error("negative control subject lost its own transport with the partner");
  if (reportResource(subject.report, "networkPeerObserved") !== false)
    throw new Error("negative control subject did not observe peer loss");
  return {
    artifacts: [...subject.artifacts, ...partner.artifacts],
    assertionCount,
    observation: {
      partnerExitCode: partner.exitCode,
      subjectExitCode: subject.exitCode,
      subjectPeerLost: true,
      transportStillConnected: true,
      killRequestedAt,
      killFinishedAt,
      killMatchedCount,
    },
  };
}

function clientMetricArtifact(client, name) {
  return client.artifacts.find((artifact) => artifact.kind === `${name}.stdout.log`)?.sha256;
}

function collectClientMetricSummaries(config, subject, partner) {
  const subjectSamples = parseNetworkingMetrics(subject.metricOutput, "subject");
  const partnerSamples = parseNetworkingMetrics(partner.metricOutput, "partner");
  const summaries = {
    subject: summarizeNetworkingMetrics(subjectSamples, config.profile),
    partner: summarizeNetworkingMetrics(partnerSamples, config.profile),
  };
  if (config.profile !== "local") {
    for (const [label, samples] of [
      ["subject", subjectSamples],
      ["partner", partnerSamples],
    ]) {
      if (samples.actionAckLatencyMs.length < 100)
        throw new Error(
          `${label} emitted ${samples.actionAckLatencyMs.length} action samples; need at least 100`,
        );
    }
  }
  const rawSampleArtifacts = {
    partner: partner.metricArtifactSha256 ?? clientMetricArtifact(partner, "partner"),
    subject: subject.metricArtifactSha256 ?? clientMetricArtifact(subject, "subject"),
  };
  if (rawSampleArtifacts.subject === undefined || rawSampleArtifacts.partner === undefined)
    throw new Error("networking metric artifacts are missing stdout hashes");
  return {
    rawSampleArtifacts,
    samples: { partner: partnerSamples, subject: subjectSamples },
    summaries,
  };
}

function attachNetworkingCpuMetrics(config, metrics, subject, partner, clientMetrics) {
  if (config.buildHashes.nativeBinaryHash !== null) {
    const subjectSamples = parseNetworkingCpuSamples(
      `${subject.processState.stdout}\n${subject.processState.stderr}`,
      "subject",
    );
    const partnerSamples = parseNetworkingCpuSamples(
      `${partner.processState.stdout}\n${partner.processState.stderr}`,
      "partner",
    );
    metrics.nativeNetworkingCpu = {
      partner: summarizeNetworkingCpu(partnerSamples),
      subject: summarizeNetworkingCpu(subjectSamples),
    };
    for (const [label, jsSummary, nativeSummary, jsSamples, nativeSamples] of [
      [
        "subject",
        clientMetrics.summaries.subject.jsNetworkingCpuMs,
        metrics.nativeNetworkingCpu.subject,
        clientMetrics.samples.subject.jsNetworkingCpuMs,
        subjectSamples,
      ],
      [
        "partner",
        clientMetrics.summaries.partner.jsNetworkingCpuMs,
        metrics.nativeNetworkingCpu.partner,
        clientMetrics.samples.partner.jsNetworkingCpuMs,
        partnerSamples,
      ],
    ]) {
      const combined = summarizeCombinedNetworkingCpu(jsSamples, nativeSamples, label);
      const totalP95Ms = combined.p95Ms;
      if (totalP95Ms > 1)
        throw new Error(`${label} networking CPU p95 ${totalP95Ms}ms exceeds 1ms`);
      metrics.networking[label].nativeNetworkingCpuP95Ms = nativeSummary.p95Ms;
      metrics.networking[label].totalNetworkingCpuP95Ms = totalP95Ms;
    }
    return;
  }
  for (const [label, summary] of [
    ["subject", clientMetrics.summaries.subject],
    ["partner", clientMetrics.summaries.partner],
  ]) {
    if (summary.jsNetworkingCpuMs.p95Ms > 1)
      throw new Error(
        `${label} JS networking CPU p95 ${summary.jsNetworkingCpuMs.p95Ms}ms exceeds 1ms`,
      );
    metrics.networking[label].totalNetworkingCpuP95Ms = summary.jsNetworkingCpuMs.p95Ms;
  }
}

function validateProofReports(config, subject, partner, server) {
  if (subject.report === undefined || partner.report === undefined) {
    throw new Error(
      subject.reportError ??
        partner.reportError ??
        "one or both playtest clients timed out or did not produce a report",
    );
  }
  const assertionCount = countEvaluatedAssertions([subject.report, partner.report]);
  assertPass(subject.report, "subject");
  assertPass(partner.report, "partner");
  requireWholeFrameBudget(subject.report, "subject");
  requireWholeFrameBudget(partner.report, "partner");
  const subjectObservation = clientObservation(subject.report, {
    peerId: config.partner.playerId,
  });
  const partnerObservation = clientObservation(partner.report, {
    peerId: config.subject.playerId,
  });
  if (subjectObservation.sessionId === partnerObservation.sessionId)
    throw new Error("subject and partner reused one session identity");
  for (const [label, observation] of [
    ["subject", subjectObservation],
    ["partner", partnerObservation],
  ]) {
    if (observation.unmatchedActionAcks !== 0)
      throw new Error(
        `${label} reported ${observation.unmatchedActionAcks} unmatched action acknowledgements`,
      );
  }
  const players = serverPlayers(`${server.stdout}\n${server.stderr}`);
  if (players.length === 0)
    throw new Error("server log contains no authenticated player identities");
  const expectedPlayers = [config.subject.playerId, config.partner.playerId].sort().join(",");
  if (players.join(",") !== expectedPlayers)
    throw new Error(`server log identities ${players.join(",")} do not match both clients`);
  const metrics = {
    maxObservedRemoteDistance: Math.max(
      subjectObservation.remoteDistance,
      partnerObservation.remoteDistance,
    ),
  };
  const clientMetrics = collectClientMetricSummaries(config, subject, partner);
  metrics.networking = {
    partner: clientMetrics.summaries.partner,
    rawSampleArtifacts: clientMetrics.rawSampleArtifacts,
    subject: clientMetrics.summaries.subject,
  };
  attachNetworkingCpuMetrics(config, metrics, subject, partner, clientMetrics);
  return {
    assertionCount,
    observations: { partner: partnerObservation, subject: subjectObservation },
    partnerSessionId: partnerObservation.sessionId,
    serverObservedPlayerIds: players,
    subjectSessionId: subjectObservation.sessionId,
    metrics,
  };
}

async function writeServerArtifacts(result, artifactRoot, servers, secrets) {
  if (servers.length === 0) return;
  try {
    const stdout = servers.map((server) => server.stdout).join("\n");
    const stderr = servers.map((server) => server.stderr).join("\n");
    result.artifacts.push(
      await writeArtifact(artifactRoot, "server.stdout.log", stdout, secrets),
      await writeArtifact(artifactRoot, "server.stderr.log", stderr, secrets),
    );
  } catch (error) {
    result.error ??= redacted(
      `unable to write server artifacts: ${error instanceof Error ? error.message : String(error)}`,
      secrets,
    );
    result.status = "unavailable";
  }
}

export async function runNetworkingProof(rawConfig, outputPath) {
  const config = validateNetworkingProofConfig(rawConfig, process.cwd());
  const startedAt = new Date().toISOString();
  const result = outputBase(config, startedAt);
  const artifactRoot = join(dirname(outputPath), "networking-proof");
  const secrets = [];
  let server;
  const serverRuns = [];
  let issuer;
  let subject;
  let partner;
  try {
    await ensurePrerequisites(config);
    await mkdir(artifactRoot, { recursive: true });
    const initialServer = await startProofServer(config);
    server = initialServer.processState;
    serverRuns.push(server);
    const initialIssuer = await startProofIssuer(config, initialServer.authorities);
    issuer = initialIssuer.issuer;
    const subjectGrant = JSON.parse(
      await readFile(join(config.subject.assetDir, networkingSessionFile), "utf8"),
    );
    const partnerGrant = JSON.parse(
      await readFile(join(config.partner.assetDir, networkingSessionFile), "utf8"),
    );
    secrets.push(subjectGrant.issuerAuthorization, partnerGrant.issuerAuthorization);
    let tokens = Object.fromEntries([
      ["ISSUER_URL", initialIssuer.tokenUrl],
      ["SERVER_ENDPOINT", config.endpoint],
    ]);
    [subject, partner] = await runProofClients(config, artifactRoot, secrets, tokens);
    result.commandExitCodes = {
      partner: partner.exitCode,
      server: server.child.exitCode ?? 0,
      subject: subject.exitCode,
    };
    result.artifacts.push(...subject.artifacts, ...partner.artifacts);
    const proof = validateProofReports(config, subject, partner, server);
    Object.assign(result, proof);
    await Promise.all([
      forceOwnedTree(subject.processState, subject.browserProcessMarker),
      forceOwnedTree(partner.processState, partner.browserProcessMarker),
    ]);
    if (config.negativeControl !== undefined) {
      await issuer.cleanup();
      issuer = undefined;
      await stopOwned(server, config.timeouts.cleanupMs);
      server = undefined;
      const negativeServer = await startProofServer(config);
      server = negativeServer.processState;
      serverRuns.push(server);
      const negativeIssuer = await startProofIssuer(config, negativeServer.authorities);
      issuer = negativeIssuer.issuer;
      tokens = Object.fromEntries([
        ["ISSUER_URL", negativeIssuer.tokenUrl],
        ["SERVER_ENDPOINT", config.endpoint],
      ]);
      const negativeControl = await runPartnerLossControl(
        config,
        artifactRoot,
        secrets,
        tokens,
        server,
      );
      result.artifacts.push(...negativeControl.artifacts);
      result.assertionCount += negativeControl.assertionCount;
      result.negativeControls.partnerLoss = negativeControl.observation;
    }
    result.status = "passed";
  } catch (error) {
    result.error = redacted(error instanceof Error ? error.message : String(error), secrets);
    result.status =
      subject?.report !== undefined || partner?.report !== undefined ? "failed" : "unavailable";
  } finally {
    await Promise.allSettled([
      stopOwned(subject?.processState, config.timeouts.cleanupMs),
      stopOwned(partner?.processState, config.timeouts.cleanupMs),
      ...serverRuns.map((serverRun) => stopOwned(serverRun, config.timeouts.cleanupMs)),
      issuer?.cleanup(),
    ]);
    await writeServerArtifacts(result, artifactRoot, serverRuns, secrets);
    result.finishedAt = new Date().toISOString();
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}

function parseCli(argv) {
  if (argv.length !== 4 || argv[0] !== "--config" || argv[2] !== "--output")
    throw new Error(
      "usage: node scripts/run-networking-proof.mjs --config <absolute-json> --output <absolute-json>",
    );
  if (!isAbsolute(argv[1]) || !isAbsolute(argv[3]))
    throw new Error("--config and --output must be absolute JSON paths");
  return { configPath: argv[1], outputPath: argv[3] };
}

export async function main(argv = process.argv.slice(2)) {
  let outputPath;
  try {
    const args = parseCli(argv);
    outputPath = args.outputPath;
    const config = JSON.parse(await readFile(args.configPath, "utf8"));
    const result = await runNetworkingProof(config, args.outputPath);
    if (result.status === "passed") return 0;
    return result.status === "failed" ? 1 : 2;
  } catch (error) {
    if (outputPath !== undefined) {
      const fallback = {
        ...outputBase(
          {
            buildHashes: {
              clientBundleHash: "0".repeat(64),
              nativeBinaryHash: null,
              serverBinaryHash: "0".repeat(64),
            },
            laneId: "unknown",
            profile: "unknown",
          },
          new Date().toISOString(),
        ),
        error: redacted(error instanceof Error ? error.message : String(error)),
        finishedAt: new Date().toISOString(),
      };
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(fallback, null, 2)}\n`);
    }
    process.stderr.write(`${redacted(error instanceof Error ? error.message : String(error))}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
