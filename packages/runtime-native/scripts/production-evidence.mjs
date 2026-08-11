#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

export const PRODUCTION_EVIDENCE_VERSION = 'productionEvidenceV1';
export const REQUIRED_LIFECYCLE_MARKERS = ['run-start', 'first-workload-frame', 'clean-end'];

export class ProductionEvidenceError extends Error {
  constructor(code, message, status = 'BLOCKED') {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function nearestRank(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)];
}

export function meanFps(frameIntervalsMs) {
  if (!Array.isArray(frameIntervalsMs) || frameIntervalsMs.length === 0) return undefined;
  if (frameIntervalsMs.some((value) => !Number.isFinite(value) || value <= 0)) return undefined;
  const mean = frameIntervalsMs.reduce((total, value) => total + value, 0) / frameIntervalsMs.length;
  return 1_000 / mean;
}

export function oneSecondFrameFloors(intervals) {
  if (!Array.isArray(intervals) || intervals.length === 0) return [];
  const first = intervals[0]?.timestampMs;
  const last = intervals.at(-1)?.timestampMs;
  if (!Number.isFinite(first) || !Number.isFinite(last) || last - first < 1_000) return [];
  const buckets = Math.floor((last - first) / 1_000);
  return Array.from({ length: buckets }, (_, bucket) => intervals.filter(({ timestampMs }) => {
    const offset = timestampMs - first;
    return offset >= bucket * 1_000 && offset < (bucket + 1) * 1_000;
  }).length);
}

export function evaluateFrameBudget(metrics, budget = {}) {
  const failures = [];
  const mean = finiteMetric(metrics.meanFps) ? metrics.meanFps : meanFps(metrics.frameIntervalsMs);
  const p95 = finiteMetric(metrics.p95FrameMs) ? metrics.p95FrameMs : nearestRank(metrics.frameIntervalsMs, 0.95);
  const p99 = finiteMetric(metrics.p99FrameMs) ? metrics.p99FrameMs : nearestRank(metrics.frameIntervalsMs, 0.99);
  const floors = metrics.oneSecondFps ?? oneSecondFrameFloors(metrics.intervals ?? []);
  const drawCalls = maximumMetric(metrics, 'drawCalls');
  const triangles = maximumMetric(metrics, 'triangles');
  if (budget.minMeanFps !== undefined && (mean === undefined || mean < budget.minMeanFps)) failures.push('TN_PROD_PERFORMANCE_BUDGET');
  if (budget.maxFrameMsP95 !== undefined && (p95 === undefined || p95 > budget.maxFrameMsP95)) failures.push('TN_PROD_PERFORMANCE_BUDGET');
  if (budget.maxP99FrameMs !== undefined && (p99 === undefined || p99 > budget.maxP99FrameMs)) failures.push('TN_PROD_PERFORMANCE_BUDGET');
  if (budget.minOneSecondFps !== undefined && (floors.length === 0 || floors.some((value) => value < budget.minOneSecondFps))) failures.push('TN_PROD_PERFORMANCE_BUDGET');
  if (budget.maxDrawCalls !== undefined && (drawCalls === undefined || drawCalls > budget.maxDrawCalls)) failures.push('TN_PROD_PERFORMANCE_BUDGET');
  if (budget.maxTriangles !== undefined && (triangles === undefined || triangles > budget.maxTriangles)) failures.push('TN_PROD_PERFORMANCE_BUDGET');
  if (budget.maxStartupMs !== undefined && (metrics.startupMs === undefined || metrics.startupMs > budget.maxStartupMs)) failures.push('TN_PROD_STARTUP_BUDGET');
  if (budget.maxMemoryGrowthBytes !== undefined && (metrics.memory?.growthBytes === undefined || metrics.memory.growthBytes > budget.maxMemoryGrowthBytes)) failures.push('TN_PROD_MEMORY_GROWTH');
  if (budget.maxMemorySlopeBytesPerMinute !== undefined && (metrics.memory?.slopeBytesPerMinute === undefined || metrics.memory.slopeBytesPerMinute > budget.maxMemorySlopeBytesPerMinute)) failures.push('TN_PROD_MEMORY_GROWTH');
  return { drawCalls, failures: [...new Set(failures)], floors, mean, p95, p99, triangles };
}

export function evaluateProductionEvidence(input, options = {}) {
  validateProductionEvidence(input);
  const codes = new Set(input.codes ?? []);
  const markers = new Set(markerNames(input.markers));
  const diagnosticCodes = new Set([
    'TN_PROD_ANDROID_ANR',
    'TN_PROD_JS_ERROR',
    'TN_PROD_NATIVE_ABORT',
    'TN_PROD_WEBGPU_VALIDATION',
  ]);
  const diagnosticRun = input.diagnosticControl === true && [...codes].some((code) => diagnosticCodes.has(code));
  const missingMarkers = REQUIRED_LIFECYCLE_MARKERS.filter((marker) => !markers.has(marker));
  const diagnosticMissingMarkers = diagnosticRun
    ? missingMarkers.filter((marker) => marker !== 'clean-end')
    : missingMarkers;
  if (diagnosticMissingMarkers.length > 0) codes.add('TN_PROD_MARKER_MISSING');
  if (diagnosticRun && (!Array.isArray(input.diagnosticArtifacts) || input.diagnosticArtifacts.length === 0)) {
    codes.add('TN_PROD_DIAGNOSTIC_ARTIFACT');
  }
  if (options.requiredSourceSha !== undefined && input.source.sha !== options.requiredSourceSha) {
    codes.add('TN_PROD_SOURCE_SHA_MISMATCH');
  }
  if (input.source.dirty === true && input.source.diffSha === undefined) codes.add('TN_PROD_SOURCE_DIFF_MISSING');
  const frameBudget = evaluateFrameBudget(input.metrics ?? {}, input.budget ?? {});
  frameBudget.failures.forEach((code) => codes.add(code));
  if (input.metrics?.thermal?.complete === false || input.metrics?.battery?.complete === false) codes.add('TN_PROD_RESOURCE_SAMPLES_INCOMPLETE');
  if (input.metrics?.thermal?.severeSeconds >= 60) codes.add('TN_PROD_THERMAL_BUDGET');
  if (input.metrics?.durationSeconds !== undefined && input.budget?.minDurationSeconds !== undefined && input.metrics.durationSeconds < input.budget.minDurationSeconds) codes.add('TN_PROD_MARKER_MISSING');
  const startupP95 = input.metrics?.startupP95Ms
    ?? nearestRank(input.metrics?.startupSamplesMs, 0.95)
    ?? input.metrics?.startupMs;
  if (input.budget?.maxStartupMs !== undefined && (startupP95 === undefined || startupP95 > input.budget.maxStartupMs)) codes.add('TN_PROD_STARTUP_BUDGET');
  const memory = input.metrics?.memory;
  if (memory !== undefined) {
    const firstMedian = memory.first15MedianBytes;
    const lastMedian = memory.last15MedianBytes;
    if (firstMedian !== undefined && lastMedian !== undefined) {
      const allowedGrowth = Math.max(64 * 1024 * 1024, firstMedian * 0.1);
      if (lastMedian - firstMedian > allowedGrowth) codes.add('TN_PROD_MEMORY_GROWTH');
    }
  }
  if (input.target === 'desktop-pair') {
    const web = input.metrics?.web;
    const native = input.metrics?.native;
    if (!hasCompleteDesktopPairMetrics(web) || !hasCompleteDesktopPairMetrics(native)) {
      codes.add('TN_PROD_COMPARISON_METRICS_INCOMPLETE');
    } else {
      if (native.meanFps < web.meanFps
        || native.p50FrameMs > web.p50FrameMs
        || native.p95FrameMs > web.p95FrameMs
        || native.p99FrameMs > web.p99FrameMs) codes.add('TN_PROD_PERFORMANCE_BUDGET');
      const webArtifact = input.identity?.webArtifactSha256;
      const nativeArtifact = input.identity?.nativeArtifactSha256;
      const webProcess = input.identity?.webProcess;
      const nativeProcess = input.identity?.nativeProcess;
      if (webArtifact === nativeArtifact || webProcess === nativeProcess) codes.add('TN_PROD_SELF_COMPARISON');
    }
  }
  if (input.target?.includes('physical') && input.physical?.provenance !== 'physical-hardware') codes.add('TN_PROD_PHYSICAL_PROVENANCE');
  if (input.audioClaim === 'claimed' && typeof input.audioEvidenceSha256 !== 'string') codes.add('TN_PROD_AUDIO_EVIDENCE');
  const blockedCodes = [...codes].filter((code) => [
    'TN_PROD_MARKER_MISSING',
    'TN_PROD_SOURCE_SHA_MISMATCH',
    'TN_PROD_SOURCE_DIFF_MISSING',
    'TN_PROD_RESOURCE_SAMPLES_INCOMPLETE',
    'TN_PROD_PHYSICAL_PROVENANCE',
    'TN_PROD_AUDIO_EVIDENCE',
    'TN_PROD_DIAGNOSTIC_ARTIFACT',
    'TN_PROD_REDACTION',
    'TN_PROD_SELF_COMPARISON',
    'TN_PROD_COMPARISON_METRICS_INCOMPLETE',
    'TN_PROD_PLAYTEST_FAILED',
    'TN_PROD_RENDER_SAMPLES_INCOMPLETE',
    'TN_PROD_STARTUP_SAMPLES_INCOMPLETE',
  ].includes(code));
  const failureCodes = [...codes].filter((code) => code.startsWith('TN_PROD_') && !blockedCodes.includes(code));
  const status = blockedCodes.length > 0 ? 'BLOCKED' : failureCodes.length > 0 ? 'FAIL' : 'PASS';
  return {
    ...input,
    codes: [...codes],
    metrics: {
      ...input.metrics,
      ...(frameBudget.mean === undefined ? {} : { meanFps: frameBudget.mean }),
      ...(frameBudget.p95 === undefined ? {} : { p95FrameMs: frameBudget.p95 }),
      ...(frameBudget.p99 === undefined ? {} : { p99FrameMs: frameBudget.p99 }),
      ...(frameBudget.drawCalls === undefined ? {} : { drawCalls: frameBudget.drawCalls }),
      ...(frameBudget.triangles === undefined ? {} : { triangles: frameBudget.triangles }),
      ...(startupP95 === undefined ? {} : { startupP95Ms: startupP95 }),
      oneSecondFps: frameBudget.floors,
    },
    status,
    exitCode: status === 'PASS' ? 0 : status === 'FAIL' ? 1 : 2,
  };
}

export async function writeProductionEvidence(input, outputDirectory, options = {}) {
  const evaluated = evaluateProductionEvidence(input, options);
  const output = resolve(outputDirectory);
  await mkdir(join(output, 'artifacts'), { recursive: true });
  const rawArtifacts = Array.isArray(input.rawArtifacts) ? input.rawArtifacts : [];
  const artifacts = [];
  for (const raw of rawArtifacts) {
    if (!raw || typeof raw.label !== 'string' || raw.content === undefined) {
      throw new ProductionEvidenceError('TN_PROD_EVIDENCE_INVALID', 'Raw production artifact must define a label and content.');
    }
    const content = Buffer.isBuffer(raw.content) ? raw.content : Buffer.from(String(raw.content));
    const hash = sha256(content);
    const artifactPath = join(output, 'artifacts', hash);
    await writeImmutable(artifactPath, content);
    artifacts.push({ hash, label: raw.label, path: relative(output, artifactPath).replaceAll('\\', '/') });
  }
  const manifest = sanitizeManifest({
    ...evaluated,
    artifacts: [...(input.artifacts ?? []), ...artifacts],
  });
  delete manifest.rawArtifacts;
  const manifestPath = join(output, 'production-evidence.json');
  await writeImmutable(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, manifestPath, outputDirectory: output };
}

export function validateProductionEvidence(value) {
  if (!isRecord(value)) throw new ProductionEvidenceError('TN_PROD_EVIDENCE_INVALID', 'productionEvidenceV1 must be a JSON object.');
  if (value.version !== PRODUCTION_EVIDENCE_VERSION) throw new ProductionEvidenceError('TN_PROD_EVIDENCE_INVALID', `Evidence version must be ${PRODUCTION_EVIDENCE_VERSION}.`);
  for (const key of ['target', 'source', 'artifact', 'identity', 'command', 'markers', 'metrics', 'budget']) {
    if (value[key] === undefined) throw new ProductionEvidenceError('TN_PROD_EVIDENCE_INVALID', `Evidence is missing required field '${key}'.`);
  }
  if (!isRecord(value.source) || !isSourceSha(value.source.sha) || typeof value.source.dirty !== 'boolean') {
    throw new ProductionEvidenceError('TN_PROD_EVIDENCE_INVALID', 'Evidence source must contain a source SHA and dirty boolean.');
  }
  if (value.source.dirty === true && value.source.diffSha !== undefined && !isSha(value.source.diffSha)) {
    throw new ProductionEvidenceError('TN_PROD_EVIDENCE_INVALID', 'Dirty evidence diffSha must be a SHA-256 hash.');
  }
  if (!isRecord(value.artifact) || !isSha(value.artifact.sha256)) throw new ProductionEvidenceError('TN_PROD_EVIDENCE_INVALID', 'Evidence artifact.sha256 must be a SHA-256 hash.');
  if (!isRecord(value.identity)) throw new ProductionEvidenceError('TN_PROD_EVIDENCE_INVALID', 'Evidence identity must be an object.');
  if (!Array.isArray(value.markers)) throw new ProductionEvidenceError('TN_PROD_EVIDENCE_INVALID', 'Evidence markers must be an array.');
  if (!isRecord(value.metrics) || !isRecord(value.budget)) throw new ProductionEvidenceError('TN_PROD_EVIDENCE_INVALID', 'Evidence metrics and budget must be objects.');
  if (value.diagnosticArtifacts !== undefined && !Array.isArray(value.diagnosticArtifacts)) {
    throw new ProductionEvidenceError('TN_PROD_EVIDENCE_INVALID', 'Evidence diagnosticArtifacts must be an array when present.');
  }
  assertPrivacySafe(value);
}

export function sanitizeManifest(value) {
  assertPrivacySafe(value);
  return JSON.parse(JSON.stringify(value, (_key, nested) => nested === undefined ? undefined : nested));
}

function markerNames(markers) {
  return markers.flatMap((marker) => typeof marker === 'string' ? [marker] : isRecord(marker) && typeof marker.name === 'string' ? [marker.name] : []);
}

function isSourceSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{7,64}$/u.test(value);
}

function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteMetric(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function maximumMetric(metrics, key) {
  if (Array.isArray(metrics.intervals) && metrics.intervals.length > 0) {
    const values = metrics.intervals.map((sample) => sample?.[key]);
    if (values.some((value) => !finiteMetric(value))) return undefined;
    return Math.max(...values);
  }
  return finiteMetric(metrics[key]) ? metrics[key] : undefined;
}

function hasCompleteDesktopPairMetrics(value) {
  return isRecord(value)
    && ['meanFps', 'p50FrameMs', 'p95FrameMs', 'p99FrameMs'].every((key) => finiteMetric(value[key]));
}

function assertPrivacySafe(value, keyPath = '$') {
  if (Array.isArray(value)) {
    value.forEach((nested, index) => assertPrivacySafe(nested, `${keyPath}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (/access.?token|authorization|cookie|password|secret|api.?key|email|ip.?address|mac.?address|device.?id|serial|udid|raw.?log|absolute.?path|home.?path/iu.test(key)) {
        throw new ProductionEvidenceError('TN_PROD_REDACTION', `Disallowed identity or secret field '${keyPath}.${key}' rejected before retention.`);
      }
      assertPrivacySafe(nested, `${keyPath}.${key}`);
    }
    return;
  }
  if (typeof value !== 'string') return;
  if (/\/home\/|\/Users\/|[A-Za-z]:\\|\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/u.test(value)) {
    throw new ProductionEvidenceError('TN_PROD_REDACTION', `Absolute workstation path or authorization material at ${keyPath} rejected before retention.`);
  }
}

async function writeImmutable(path, contents) {
  try {
    const handle = await open(path, 'wx');
    try {
      await handle.writeFile(contents);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readFile(path);
    const next = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    if (!existing.equals(next)) throw new ProductionEvidenceError('TN_PROD_EVIDENCE_IMMUTABLE', `Refusing to overwrite immutable evidence '${path}'.`);
  }
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  process.stdout.write(`${JSON.stringify({ version: PRODUCTION_EVIDENCE_VERSION, requiredMarkers: REQUIRED_LIFECYCLE_MARKERS }, null, 2)}\n`);
}
