#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(runtimeRoot, "../..");
const xvfbScript = join(workspaceRoot, "scripts", "xvfb.sh");
const MARKER = "TN_ANDROID_JS_NATIVE:";
const FIRST_ELIGIBLE_FRAME = 226;
const LAST_ELIGIBLE_FRAME = 899;
const MINIMUM_SUBMITS = 3;
const MINIMUM_INDEXED_DRAWS = 100;
const TOTAL_FRAMES = 900;

export class DesktopFramePairError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "DesktopFramePairError";
    this.code = code;
    this.details = details;
  }
}

function requiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new DesktopFramePairError(`TN_DESKTOP_PAIR_ARGUMENT_MISSING:${flag}`);
  }
  return value;
}

export function parseArgs(argv) {
  const options = {
    bundle: null,
    candidate: null,
    control: null,
    output: null,
    runs: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help") return { help: true };
    if (flag === "--control" || flag === "--candidate" || flag === "--bundle" || flag === "--output") {
      const value = requiredValue(argv, index, flag);
      options[flag.slice(2)] = value;
      index += 1;
      continue;
    }
    if (flag === "--runs") {
      options.runs = Number(requiredValue(argv, index, flag));
      index += 1;
      continue;
    }
    throw new DesktopFramePairError(`TN_DESKTOP_PAIR_ARGUMENT_UNKNOWN:${flag}`);
  }
  for (const field of ["control", "candidate", "bundle", "output"]) {
    if (!options[field]) throw new DesktopFramePairError(`TN_DESKTOP_PAIR_ARGUMENT_MISSING:--${field}`);
  }
  if (!Number.isInteger(options.runs) || options.runs < 2) {
    throw new DesktopFramePairError("TN_DESKTOP_PAIR_RUNS_INVALID:--runs must be an integer >= 2");
  }
  return options;
}

function requireRegularFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new DesktopFramePairError(`TN_DESKTOP_PAIR_FILE_MISSING:${label}:${path}`);
  }
}

export function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function finiteNonNegative(value, field) {
  if (!Number.isFinite(value) || value < 0) {
    throw new DesktopFramePairError(`TN_DESKTOP_PAIR_INVALID_NUMBER:${field}`);
  }
  return value;
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DesktopFramePairError(`TN_DESKTOP_PAIR_INVALID_OBJECT:${field}`);
  }
  return value;
}

export function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new DesktopFramePairError("TN_DESKTOP_PAIR_MEDIAN_EMPTY");
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new DesktopFramePairError("TN_DESKTOP_PAIR_MEDIAN_INVALID");
  }
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function summarizeMetrics(items) {
  const fields = ["workNs", "bridgeNs", "bridgeOverheadNs", "commandNs"];
  return Object.fromEntries(fields.map((field) => [field, median(items.map((item) => item[field]))]));
}

function parseMarkerJson(raw) {
  try {
    return requireObject(JSON.parse(raw), "marker");
  } catch (error) {
    if (error instanceof DesktopFramePairError) throw error;
    throw new DesktopFramePairError("TN_DESKTOP_PAIR_MALFORMED_JSON", { raw });
  }
}

function validateEligibleSample(sample) {
  if (!Number.isInteger(sample.frame) || sample.frame < 0) {
    throw new DesktopFramePairError("TN_DESKTOP_PAIR_INVALID_FRAME");
  }
  if (sample.frame < FIRST_ELIGIBLE_FRAME || sample.frame > LAST_ELIGIBLE_FRAME) return null;
  for (const field of [
    "bindingNs",
    "calls",
    "threadCpuNs",
    "presentNs",
    "bridgeNs",
    "bridgeOverheadNs",
  ]) {
    finiteNonNegative(sample[field], field);
  }
  // Legacy controls report present wall time only. Thread CPU already excludes time blocked in
  // present, so subtracting the wall clock mixes units and can manufacture negative work.
  const presentWorkNs = finiteNonNegative(sample.presentThreadCpuNs ?? 0, "presentThreadCpuNs");
  const commands = requireObject(sample.commands, "commands");
  const commandTimes = requireObject(sample.commandNs, "commandNs");
  const indexedDraws =
    finiteNonNegative(commands.drawIndexed, "commands.drawIndexed") +
    finiteNonNegative(commands.bundleDrawIndexed ?? 0, "commands.bundleDrawIndexed");
  const commandEntries = Object.entries(commandTimes);
  if (commandEntries.length === 0) {
    throw new DesktopFramePairError("TN_DESKTOP_PAIR_COMMAND_NS_EMPTY");
  }
  const commandNs = commandEntries.reduce(
    (total, [name, value]) => total + finiteNonNegative(value, `commandNs.${name}`),
    0,
  );
  const submits = sample.submits === undefined ? 1 : sample.submits;
  if (!Number.isInteger(submits) || submits <= 0) {
    throw new DesktopFramePairError("TN_DESKTOP_PAIR_INVALID_NUMBER:submits");
  }
  return { ...sample, commandNs, indexedDraws, presentWorkNs, submits };
}

function summarizeFrame(frame, samples) {
  const sum = (field) => samples.reduce((total, sample) => total + sample[field], 0);
  const submits = sum("submits");
  if (submits < MINIMUM_SUBMITS) {
    throw new DesktopFramePairError(`TN_DESKTOP_PAIR_SUBMITS_TOO_FEW:frame=${frame}`, {
      submits,
    });
  }
  const indexedDraws = sum("indexedDraws");
  if (indexedDraws <= MINIMUM_INDEXED_DRAWS) {
    throw new DesktopFramePairError(`TN_DESKTOP_PAIR_INDEXED_DRAWS_TOO_FEW:frame=${frame}`, {
      indexedDraws,
    });
  }
  return {
    bridgeNs: sum("bridgeNs"),
    bridgeOverheadNs: sum("bridgeOverheadNs"),
    commandNs: sum("commandNs"),
    frame,
    indexedDraws,
    submits,
    workNs: sum("threadCpuNs") - sum("presentWorkNs"),
  };
}

export function parseFrameMarkers(log) {
  const groups = new Map();
  const dedupe = new Set();
  let markerCount = 0;
  for (const line of String(log).split(/\r?\n/u)) {
    const markerAt = line.indexOf(MARKER);
    if (markerAt === -1) continue;
    markerCount += 1;
    const raw = line.slice(markerAt + MARKER.length).trim();
    const sample = validateEligibleSample(parseMarkerJson(raw));
    if (!sample) continue;
    const dedupeKey = JSON.stringify([
      sample.frame,
      sample.bindingNs,
      sample.calls,
      sample.threadCpuNs,
    ]);
    if (dedupe.has(dedupeKey)) continue;
    dedupe.add(dedupeKey);
    const group = groups.get(sample.frame) ?? [];
    group.push(sample);
    groups.set(sample.frame, group);
  }
  if (markerCount === 0) throw new DesktopFramePairError("TN_DESKTOP_PAIR_MARKER_MISSING");
  if (groups.size === 0) throw new DesktopFramePairError("TN_DESKTOP_PAIR_ELIGIBLE_FRAMES_EMPTY");

  const frames = [...groups]
    .sort(([left], [right]) => left - right)
    .map(([frame, samples]) => summarizeFrame(frame, samples));
  if (frames.some((frame) => frame.workNs < 0)) {
    throw new DesktopFramePairError("TN_DESKTOP_PAIR_WORK_NEGATIVE");
  }
  return { eligibleFrames: frames.length, frames, mediansNs: summarizeMetrics(frames) };
}

export function buildLaunchPlan(runsPerArm) {
  if (!Number.isInteger(runsPerArm) || runsPerArm < 2) {
    throw new DesktopFramePairError("TN_DESKTOP_PAIR_RUNS_INVALID");
  }
  return Array.from({ length: runsPerArm * 2 }, (_, index) => ({
    arm: index % 2 === 0 ? "control" : "candidate",
    discarded: index < 2,
    globalLaunch: index + 1,
    run: Math.floor(index / 2) + 1,
  }));
}

export function summarizeArms(runs) {
  const result = {};
  for (const arm of ["control", "candidate"]) {
    const eligible = runs.filter((run) => run.arm === arm && !run.discarded && run.mediansNs);
    if (eligible.length === 0) {
      throw new DesktopFramePairError(`TN_DESKTOP_PAIR_ARM_EMPTY:${arm}`);
    }
    result[arm] = {
      mediansNs: summarizeMetrics(eligible.map((run) => run.mediansNs)),
      runs: eligible.length,
    };
  }
  return result;
}

function displayPath(path) {
  const local = relative(workspaceRoot, path);
  return local.startsWith("..") ? path : local;
}

function shellCommand(parts) {
  return parts.map((part) => (/^[A-Za-z0-9_./:=+-]+$/u.test(part) ? part : JSON.stringify(part))).join(" ");
}

function writeReport(outputDirectory, report) {
  writeFileSync(join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

function resolveInputs(options) {
  const inputs = {
    bundle: resolve(options.bundle),
    candidate: resolve(options.candidate),
    control: resolve(options.control),
  };
  for (const [label, path] of [...Object.entries(inputs), ["root-xvfb", xvfbScript]]) {
    requireRegularFile(path, label);
  }
  if (inputs.control === inputs.candidate) {
    throw new DesktopFramePairError("TN_DESKTOP_PAIR_BINARIES_IDENTICAL_PATH");
  }
  return inputs;
}

function hashInputs(inputs, binary) {
  return {
    binary: hashFile(binary),
    bundle: hashFile(inputs.bundle),
    candidate: hashFile(inputs.candidate),
    control: hashFile(inputs.control),
  };
}

function assertImmutable(hashes, expectedHashes, globalLaunch) {
  if (
    hashes.bundle !== expectedHashes.bundle ||
    hashes.candidate !== expectedHashes.candidate ||
    hashes.control !== expectedHashes.control
  ) {
    throw new DesktopFramePairError(`TN_DESKTOP_PAIR_INPUT_MUTATED:launch=${globalLaunch}`, {
      expectedHashes,
      hashes,
    });
  }
}

function executeLaunch({ inputs, outputDirectory, planned, readLoad, spawn }) {
  const binary = inputs[planned.arm];
  const bundleDirectory = dirname(inputs.bundle);
  const prefix = `${String(planned.globalLaunch).padStart(2, "0")}-${planned.arm}-run-${planned.run}`;
  const logPath = join(outputDirectory, `${prefix}.log`);
  const screenshotPath = join(outputDirectory, `${prefix}.png`);
  const command = [
    "sh",
    xvfbScript,
    binary,
    "run",
    inputs.bundle,
    "--screenshot",
    screenshotPath,
    "--frames",
    String(TOTAL_FRAMES),
  ];
  const run = {
    ...planned,
    command,
    commandText: shellCommand(command),
    loadavg: readLoad(),
    log: displayPath(logPath),
    mediansNs: null,
    screenshot: displayPath(screenshotPath),
    startedAt: new Date().toISOString(),
  };
  const result = spawn(command[0], command.slice(1), {
    cwd: bundleDirectory,
    encoding: "utf8",
    env: { ...process.env, SDL_VIDEODRIVER: "x11" },
    maxBuffer: 128 * 1024 * 1024,
    timeout: 180_000,
  });
  const log = `${result.stdout ?? ""}${result.stderr ? `\n${result.stderr}` : ""}`;
  writeFileSync(logPath, log);
  run.completedAt = new Date().toISOString();
  run.exit = {
    error: result.error?.message ?? null,
    signal: result.signal ?? null,
    status: result.status,
  };
  run.screenshotSha256 = existsSync(screenshotPath) ? hashFile(screenshotPath) : null;
  if (!result.error && result.status === 0 && run.screenshotSha256) {
    const analysis = parseFrameMarkers(log);
    run.eligibleFrames = analysis.eligibleFrames;
    run.mediansNs = analysis.mediansNs;
  }
  return run;
}

export function runPair(options, dependencies = {}) {
  const spawn = dependencies.spawnSync ?? spawnSync;
  const readLoad = dependencies.readLoad ?? (() => readFileSync("/proc/loadavg", "utf8").trim());
  const inputs = resolveInputs(options);
  const outputDirectory = resolve(options.output);
  mkdirSync(outputDirectory, { recursive: true });
  const expectedHashes = {
    bundle: hashFile(inputs.bundle),
    candidate: hashFile(inputs.candidate),
    control: hashFile(inputs.control),
  };
  const report = {
    arms: null,
    completedAt: null,
    inputs: {
      bundle: { path: displayPath(inputs.bundle), sha256: expectedHashes.bundle },
      candidate: { path: displayPath(inputs.candidate), sha256: expectedHashes.candidate },
      control: { path: displayPath(inputs.control), sha256: expectedHashes.control },
      runsPerArm: options.runs,
    },
    protocol: {
      eligibleFrames: [FIRST_ELIGIBLE_FRAME, LAST_ELIGIBLE_FRAME],
      framesPerLaunch: TOTAL_FRAMES,
      minimumIndexedDrawsExclusive: MINIMUM_INDEXED_DRAWS,
      minimumSubmits: MINIMUM_SUBMITS,
      warmup: "discard global launches 1 and 2",
      work: "sum(threadCpuNs)-sum(presentThreadCpuNs ?? 0); legacy presentNs is wall time",
    },
    runs: [],
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
  };
  writeReport(outputDirectory, report);

  for (const planned of buildLaunchPlan(options.runs)) {
    const binary = inputs[planned.arm];
    const hashes = hashInputs(inputs, binary);
    assertImmutable(hashes, expectedHashes, planned.globalLaunch);
    const run = executeLaunch({ inputs, outputDirectory, planned, readLoad, spawn });
    run.hashes = hashes;
    report.runs.push(run);
    writeReport(outputDirectory, report);
    if (run.exit.error || run.exit.status !== 0) {
      throw new DesktopFramePairError(`TN_DESKTOP_PAIR_LAUNCH_FAILED:launch=${planned.globalLaunch}`);
    }
    if (!run.screenshotSha256) {
      throw new DesktopFramePairError(`TN_DESKTOP_PAIR_SCREENSHOT_MISSING:launch=${planned.globalLaunch}`);
    }
  }
  report.arms = summarizeArms(report.runs);
  report.completedAt = new Date().toISOString();
  writeReport(outputDirectory, report);
  return report;
}

function usage() {
  return [
    "Usage: node packages/runtime-native/scripts/measure-desktop-frame-pair.mjs \\",
    "  --control <immutable-binary> --candidate <immutable-binary> \\",
    "  --bundle <bayview-bundle> --output <directory> --runs <per-arm-count>",
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }
    const report = runPair(options);
    console.log(JSON.stringify({ arms: report.arms, report: join(resolve(options.output), "report.json") }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
