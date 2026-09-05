import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type IPerformanceLaneManifest,
  parsePerformanceLaneManifest,
} from "../engine-load-test/report.js";

export const PERFORMANCE_CI_SUMMARY_REVISION = "prd-358-v1";

export type CiEvidenceStatus = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED" | "UNVERIFIED";

export interface IPerformanceCiResult {
  readonly artifactHash?: string;
  readonly lane: string;
  readonly reason?: string;
  readonly required?: boolean;
  readonly sourceSha?: string;
  readonly status: CiEvidenceStatus;
}

export interface IPerformanceCiSummaryInput {
  readonly expectedSha: string;
  readonly requiredLanes?: readonly string[];
  readonly results: readonly IPerformanceCiResult[];
}

export interface IPerformanceCiSummary {
  readonly counts: Readonly<Record<CiEvidenceStatus, number>>;
  readonly expectedSha: string;
  readonly exitCode: 0 | 1 | 2;
  readonly reasons: readonly string[];
  readonly results: readonly IPerformanceCiResult[];
  readonly status: CiEvidenceStatus;
  readonly summaryRevision: string;
}

export class PerformanceCiSummaryError extends Error {
  readonly exitCode = 2;

  constructor(message: string) {
    super(message);
    this.name = "PerformanceCiSummaryError";
  }
}

const STATUSES: readonly CiEvidenceStatus[] = ["PASS", "FAIL", "BLOCKED", "SKIPPED", "UNVERIFIED"];

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PerformanceCiSummaryError(`${field} must be a non-empty string`);
  }
  return value;
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PerformanceCiSummaryError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseResult(value: unknown, index: number): IPerformanceCiResult {
  const source = objectValue(value, `results[${index}]`);
  const status = source.status;
  if (!STATUSES.includes(status as CiEvidenceStatus)) {
    throw new PerformanceCiSummaryError(
      `results[${index}].status is not a supported evidence status`,
    );
  }
  const required = source.required;
  if (required !== undefined && typeof required !== "boolean") {
    throw new PerformanceCiSummaryError(`results[${index}].required must be boolean`);
  }
  const sourceSha = source.sourceSha;
  const parsedSourceSha =
    sourceSha === undefined ? undefined : nonEmptyString(sourceSha, `results[${index}].sourceSha`);
  const artifactHash = source.artifactHash;
  const parsedArtifactHash =
    artifactHash === undefined
      ? undefined
      : nonEmptyString(artifactHash, `results[${index}].artifactHash`);
  const reason = source.reason;
  const parsedReason =
    reason === undefined ? undefined : nonEmptyString(reason, `results[${index}].reason`);
  return {
    ...(parsedArtifactHash === undefined ? {} : { artifactHash: parsedArtifactHash }),
    lane: nonEmptyString(source.lane, `results[${index}].lane`),
    ...(parsedReason === undefined ? {} : { reason: parsedReason }),
    ...(required === undefined ? {} : { required }),
    ...(parsedSourceSha === undefined ? {} : { sourceSha: parsedSourceSha }),
    status: status as CiEvidenceStatus,
  };
}

export function parsePerformanceCiSummaryInput(value: unknown): IPerformanceCiSummaryInput {
  const source = Array.isArray(value) ? { results: value } : objectValue(value, "summary input");
  const expectedSha = nonEmptyString(source.expectedSha, "expectedSha");
  if (!Array.isArray(source.results)) {
    throw new PerformanceCiSummaryError("results must be an array");
  }
  const requiredLanes = source.requiredLanes;
  if (
    requiredLanes !== undefined &&
    (!Array.isArray(requiredLanes) ||
      requiredLanes.length === 0 ||
      requiredLanes.some((lane) => typeof lane !== "string" || lane.length === 0))
  ) {
    throw new PerformanceCiSummaryError(
      "requiredLanes must be a non-empty string array when supplied",
    );
  }
  return {
    expectedSha,
    ...(requiredLanes === undefined ? {} : { requiredLanes: [...requiredLanes] as string[] }),
    results: source.results.map((result, index) => parseResult(result, index)),
  };
}

function emptyCounts(): Record<CiEvidenceStatus, number> {
  return Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<
    CiEvidenceStatus,
    number
  >;
}

/** Aggregate all platform rows without allowing absent, stale, or required advisory evidence to pass. */
export function summarizePerformanceCi(input: unknown): IPerformanceCiSummary {
  try {
    const parsed = parsePerformanceCiSummaryInput(input);
    const counts = emptyCounts();
    const reasons: string[] = [];
    const seen = new Set<string>();
    for (const result of parsed.results) {
      counts[result.status] += 1;
      if (seen.has(result.lane))
        reasons.push(`duplicate performance result for lane ${result.lane}`);
      seen.add(result.lane);
      if (result.status === "PASS" || result.status === "FAIL" || result.status === "BLOCKED") {
        if (result.sourceSha !== parsed.expectedSha) {
          reasons.push(
            `${result.lane} has stale or missing source SHA ${result.sourceSha ?? "<missing>"}; expected ${parsed.expectedSha}`,
          );
        }
        if (result.artifactHash === undefined) {
          reasons.push(`${result.lane} has no artifact identity`);
        }
      }
      if (
        (result.status === "SKIPPED" || result.status === "UNVERIFIED") &&
        result.required === true
      ) {
        reasons.push(`${result.lane} is required but ${result.status.toLowerCase()}`);
      }
    }
    if (parsed.results.length === 0) reasons.push("performance result set is empty");
    for (const lane of parsed.requiredLanes ?? []) {
      const result = parsed.results.find((candidate) => candidate.lane === lane);
      if (result === undefined) reasons.push(`required performance lane ${lane} has no result`);
    }
    const status: CiEvidenceStatus =
      reasons.length > 0 || counts.BLOCKED > 0
        ? "BLOCKED"
        : counts.FAIL > 0
          ? "FAIL"
          : counts.PASS > 0
            ? "PASS"
            : counts.UNVERIFIED > 0
              ? "UNVERIFIED"
              : "SKIPPED";
    return {
      counts,
      expectedSha: parsed.expectedSha,
      exitCode: status === "BLOCKED" ? 2 : status === "FAIL" ? 1 : 0,
      reasons,
      results: parsed.results,
      status,
      summaryRevision: PERFORMANCE_CI_SUMMARY_REVISION,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      counts: emptyCounts(),
      expectedSha:
        typeof input === "object" &&
        input !== null &&
        "expectedSha" in input &&
        typeof input.expectedSha === "string"
          ? input.expectedSha
          : "unknown",
      exitCode: 2,
      reasons: [message],
      results: [],
      status: "BLOCKED",
      summaryRevision: PERFORMANCE_CI_SUMMARY_REVISION,
    };
  }
}

export function coverageResultsFromManifest(
  manifest: IPerformanceLaneManifest,
): IPerformanceCiResult[] {
  return manifest.lanes.map((lane) => ({
    lane: lane.id,
    reason: lane.baseline.reason ?? "No observed accepted baseline for this lane",
    required: lane.required === true,
    status: "UNVERIFIED",
  }));
}

export function requiredLanesFromManifest(manifest: IPerformanceLaneManifest): string[] {
  return manifest.lanes.filter((lane) => lane.required === true).map((lane) => lane.id);
}

export function renderPerformanceCiSummary(summary: IPerformanceCiSummary): string {
  const lines = [
    `## Performance CI evidence ${summary.status}`,
    "",
    `- expected source SHA: ${summary.expectedSha}`,
    `- summary revision: ${summary.summaryRevision}`,
    `- rows: ${summary.results.length}`,
    `- counts: ${STATUSES.map((status) => `${status}=${summary.counts[status]}`).join(", ")}`,
    "",
    "| Lane | Status | Required | Source SHA | Artifact | Reason |",
    "| --- | --- | --- | --- | --- | --- |",
    ...summary.results.map(
      (result) =>
        `| ${result.lane} | ${result.status} | ${result.required === true ? "yes" : "no"} | ${result.sourceSha ?? "—"} | ${result.artifactHash ?? "—"} | ${result.reason ?? "—"} |`,
    ),
  ];
  if (summary.reasons.length > 0)
    lines.push("", "### Blocking reasons", "", ...summary.reasons.map((reason) => `- ${reason}`));
  return `${lines.join("\n")}\n`;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const inputPath = argument("input");
  const manifestPath = argument("manifest") ?? argument("lanes");
  const expectedSha = argument("expected-sha") ?? process.env.GITHUB_SHA;
  if (expectedSha === undefined)
    throw new PerformanceCiSummaryError("--expected-sha or GITHUB_SHA is required");
  let raw: unknown;
  if (inputPath !== undefined) {
    raw = JSON.parse(await readFile(inputPath, "utf8"));
  } else if (manifestPath !== undefined) {
    const manifest = parsePerformanceLaneManifest(JSON.parse(await readFile(manifestPath, "utf8")));
    raw = {
      expectedSha,
      requiredLanes: requiredLanesFromManifest(manifest),
      results: coverageResultsFromManifest(manifest),
    };
  } else {
    throw new PerformanceCiSummaryError("--input or --manifest is required");
  }
  const source = objectValue(raw, "summary input");
  const summary = summarizePerformanceCi({ ...source, expectedSha });
  const markdown = renderPerformanceCiSummary(summary);
  process.stdout.write(markdown);
  const output = argument("out");
  if (output !== undefined) {
    await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`);
  }
  if (summary.exitCode !== 0) process.exitCode = summary.exitCode;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof PerformanceCiSummaryError ? error.exitCode : 2;
  });
}
