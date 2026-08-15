// PRD-117 §5.1/§5.2: parse both arms' run reports fail-closed, refuse to compare two scenes that
// were not the same scene, and only then compute a knee. A missing field, a wrong type, or an
// empty sample array is an error here — never a default, never a skip.

export const KNEE_THRESHOLD_MS = 20;
export const ARMS = ["tn-web", "tn-android", "godot-web", "godot-android"] as const;

export type Arm = (typeof ARMS)[number];
export type RenderMode = "L1" | "L2";
export type BuildType = "release" | "debug";

export interface IRunReportRung {
  drawCalls: number;
  frameMs: number[];
  mode: RenderMode;
  objectCount: number;
  positionHash: string;
  repeat: number;
  triangles: number;
  visibleObjects: number;
}

export interface IRunReport {
  arm: Arm;
  build: { notes: string; type: BuildType };
  device: { battery: number | null; label: string };
  display: { height: number; refreshHz: number; vsync: boolean; width: number };
  driver: { adapter: string; renderer: string };
  engine: { name: "threenative" | "godot"; version: string };
  rungs: IRunReportRung[];
}

export interface IRungSummary {
  drawCalls: number;
  mode: RenderMode;
  objectCount: number;
  p50: number;
  p95: number;
  repeats: number;
  sampleCount: number;
  triangles: number;
  visibleObjects: number;
}

export interface IEquivalenceFailure {
  field: string;
  left: string;
  right: string;
  rung: string;
}

export interface IComparison {
  left: IRunReport;
  leftKnee: Record<RenderMode, number | null>;
  leftSummaries: IRungSummary[];
  right: IRunReport;
  rightKnee: Record<RenderMode, number | null>;
  rightSummaries: IRungSummary[];
}

class BenchError extends Error {
  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = code;
  }
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new BenchError("TN_BENCH_BAD_SHAPE", `${path} must be an object`);
  return value as Record<string, unknown>;
}

function requireString(source: Record<string, unknown>, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0)
    throw new BenchError("TN_BENCH_BAD_SHAPE", `${path}.${key} must be a non-empty string`);
  return value;
}

function requireNumber(source: Record<string, unknown>, key: string, path: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new BenchError("TN_BENCH_BAD_SHAPE", `${path}.${key} must be a finite number`);
  return value;
}

function requireBoolean(source: Record<string, unknown>, key: string, path: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean")
    throw new BenchError("TN_BENCH_BAD_SHAPE", `${path}.${key} must be a boolean`);
  return value;
}

export function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) throw new BenchError("TN_BENCH_EMPTY_SERIES", "no frame samples");
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[rank] as number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new BenchError("TN_BENCH_EMPTY_SERIES", "no values to median");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return (((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2) as number;
}

export function parseRunReport(value: unknown): IRunReport {
  const root = requireObject(value, "report");
  const arm = requireString(root, "arm", "report");
  if (!(ARMS as readonly string[]).includes(arm))
    throw new BenchError("TN_BENCH_BAD_ARM", `unknown arm ${arm}`);

  const engine = requireObject(root.engine, "report.engine");
  const engineName = requireString(engine, "name", "report.engine");
  if (engineName !== "threenative" && engineName !== "godot")
    throw new BenchError("TN_BENCH_BAD_SHAPE", `report.engine.name ${engineName} is not an engine`);

  const build = requireObject(root.build, "report.build");
  const buildType = requireString(build, "type", "report.build");
  if (buildType !== "release" && buildType !== "debug")
    throw new BenchError(
      "TN_BENCH_BAD_SHAPE",
      `report.build.type ${buildType} is not a build type`,
    );

  const display = requireObject(root.display, "report.display");
  // A report that cannot name the backend the engine actually chose is not comparable: a web
  // export that silently fell back would otherwise be published as that engine's result (§4.5).
  const driverSource = root.driver;
  if (typeof driverSource !== "object" || driverSource === null)
    throw new BenchError("TN_BENCH_MISSING_DRIVER", "report.driver is absent");
  const driver = requireObject(driverSource, "report.driver");
  let renderer: string;
  let adapter: string;
  try {
    renderer = requireString(driver, "renderer", "report.driver");
    adapter = requireString(driver, "adapter", "report.driver");
  } catch {
    throw new BenchError("TN_BENCH_MISSING_DRIVER", "report.driver is missing renderer or adapter");
  }

  const device = requireObject(root.device, "report.device");
  const battery = device.battery;
  if (battery !== null && (typeof battery !== "number" || !Number.isFinite(battery)))
    throw new BenchError("TN_BENCH_BAD_SHAPE", "report.device.battery must be a number or null");

  const rawRungs = root.rungs;
  if (!Array.isArray(rawRungs) || rawRungs.length === 0)
    throw new BenchError("TN_BENCH_NO_RUNGS", "report.rungs is empty");

  const rungs = rawRungs.map((rawRung, index) => {
    const path = `report.rungs[${index}]`;
    const rung = requireObject(rawRung, path);
    const mode = requireString(rung, "mode", path);
    if (mode !== "L1" && mode !== "L2")
      throw new BenchError("TN_BENCH_BAD_SHAPE", `${path}.mode ${mode} is not a render mode`);
    const frameMs = rung.frameMs;
    if (!Array.isArray(frameMs) || frameMs.length === 0)
      throw new BenchError("TN_BENCH_EMPTY_SERIES", `${path}.frameMs carries no samples`);
    for (const sample of frameMs) {
      if (typeof sample !== "number" || !Number.isFinite(sample) || sample < 0)
        throw new BenchError("TN_BENCH_BAD_SHAPE", `${path}.frameMs holds a non-finite sample`);
    }
    return {
      drawCalls: requireNumber(rung, "drawCalls", path),
      frameMs: frameMs as number[],
      mode: mode as RenderMode,
      objectCount: requireNumber(rung, "objectCount", path),
      positionHash: requireString(rung, "positionHash", path),
      repeat: requireNumber(rung, "repeat", path),
      triangles: requireNumber(rung, "triangles", path),
      visibleObjects: requireNumber(rung, "visibleObjects", path),
    };
  });

  return {
    arm: arm as Arm,
    build: { notes: typeof build.notes === "string" ? build.notes : "", type: buildType },
    device: {
      battery: (battery as number | null) ?? null,
      label: requireString(device, "label", "report.device"),
    },
    display: {
      height: requireNumber(display, "height", "report.display"),
      refreshHz: requireNumber(display, "refreshHz", "report.display"),
      vsync: requireBoolean(display, "vsync", "report.display"),
      width: requireNumber(display, "width", "report.display"),
    },
    driver: { adapter, renderer },
    engine: { name: engineName, version: requireString(engine, "version", "report.engine") },
    rungs,
  };
}

export function rungKey(mode: RenderMode, objectCount: number): string {
  return `${mode}@${objectCount}`;
}

export function summarize(report: IRunReport): IRungSummary[] {
  const groups = new Map<string, IRunReportRung[]>();
  for (const rung of report.rungs) {
    const key = rungKey(rung.mode, rung.objectCount);
    const bucket = groups.get(key) ?? [];
    bucket.push(rung);
    groups.set(key, bucket);
  }
  const summaries: IRungSummary[] = [];
  for (const bucket of groups.values()) {
    const first = bucket[0] as IRunReportRung;
    summaries.push({
      drawCalls: median(bucket.map((rung) => rung.drawCalls)),
      mode: first.mode,
      objectCount: first.objectCount,
      p50: median(bucket.map((rung) => percentile(rung.frameMs, 0.5))),
      p95: median(bucket.map((rung) => percentile(rung.frameMs, 0.95))),
      repeats: bucket.length,
      sampleCount: first.frameMs.length,
      triangles: median(bucket.map((rung) => rung.triangles)),
      visibleObjects: median(bucket.map((rung) => rung.visibleObjects)),
    });
  }
  return summaries.sort((left, right) =>
    left.mode === right.mode
      ? left.objectCount - right.objectCount
      : left.mode.localeCompare(right.mode),
  );
}

// The knee is the last ladder rung before the first crossing of the threshold — not the largest
// rung that happens to sit under it, which a noisy non-monotone curve would misreport.
export function knee(
  summaries: readonly IRungSummary[],
  mode: RenderMode,
  thresholdMs: number = KNEE_THRESHOLD_MS,
): number | null {
  const ladder = summaries
    .filter((summary) => summary.mode === mode)
    .sort((left, right) => left.objectCount - right.objectCount);
  let best: number | null = null;
  for (const summary of ladder) {
    if (summary.p95 > thresholdMs) return best;
    best = summary.objectCount;
  }
  return best;
}

function drawCallFailure(
  mode: RenderMode,
  objectCount: number,
  left: IRungSummary,
  right: IRungSummary,
): IEquivalenceFailure | undefined {
  if (mode === "L1") {
    // An arm reporting one draw where the other reports N has silently auto-batched and is not
    // running L1 at all — the single most likely way this comparison gets published wrong (§5.2).
    for (const [side, summary] of [
      ["left", left],
      ["right", right],
    ] as const) {
      const expected = Math.max(0, summary.visibleObjects);
      if (Math.abs(summary.drawCalls - expected) > 2 && summary.drawCalls < objectCount * 0.5) {
        return {
          field: `drawCalls (${side} arm auto-batched L1)`,
          left: String(left.drawCalls),
          right: String(right.drawCalls),
          rung: rungKey(mode, objectCount),
        };
      }
    }
    const ratio =
      Math.max(left.drawCalls, right.drawCalls) /
      Math.max(1, Math.min(left.drawCalls, right.drawCalls));
    if (ratio > 1.25) {
      return {
        field: "drawCalls",
        left: String(left.drawCalls),
        right: String(right.drawCalls),
        rung: rungKey(mode, objectCount),
      };
    }
    return undefined;
  }
  if (left.drawCalls > 8 || right.drawCalls > 8 || Math.abs(left.drawCalls - right.drawCalls) > 4) {
    return {
      field: "drawCalls (L2 must be a small, comparable batch)",
      left: String(left.drawCalls),
      right: String(right.drawCalls),
      rung: rungKey(mode, objectCount),
    };
  }
  return undefined;
}

function groupRungs(report: IRunReport): Map<string, IRunReportRung[]> {
  const groups = new Map<string, IRunReportRung[]>();
  for (const rung of report.rungs) {
    const key = rungKey(rung.mode, rung.objectCount);
    const bucket = groups.get(key) ?? [];
    bucket.push(rung);
    groups.set(key, bucket);
  }
  return groups;
}

export function isSoftwareRasteriser(adapter: string): boolean {
  return /swiftshader|llvmpipe|softwarerasterizer|software adapter/i.test(adapter);
}

export function checkEquivalence(left: IRunReport, right: IRunReport): IEquivalenceFailure[] {
  const failures: IEquivalenceFailure[] = [];
  const push = (field: string, a: unknown, b: unknown, rung = "-"): void => {
    failures.push({ field, left: String(a), right: String(b), rung });
  };

  if (left.build.type !== right.build.type) push("build.type", left.build.type, right.build.type);
  // A hardware arm against a software-rasterised one is the same class of mistake as release
  // against debug: both would publish a ratio that is about the fallback, not about the engine.
  if (isSoftwareRasteriser(left.driver.adapter) !== isSoftwareRasteriser(right.driver.adapter))
    push(
      "driver.adapter (software rasteriser on one arm only)",
      left.driver.adapter,
      right.driver.adapter,
    );
  if (left.display.refreshHz !== right.display.refreshHz)
    push("display.refreshHz", left.display.refreshHz, right.display.refreshHz);
  if (left.display.vsync !== right.display.vsync)
    push("display.vsync", left.display.vsync, right.display.vsync);
  if (left.display.width !== right.display.width || left.display.height !== right.display.height) {
    push(
      "display.viewport",
      `${left.display.width}x${left.display.height}`,
      `${right.display.width}x${right.display.height}`,
    );
  }

  // Grouped, never last-wins: a hash that diverges on a single repeat is exactly the failure this
  // gate exists to catch, and keying one rung per ladder step would hide every repeat but the last.
  const leftHashes = groupRungs(left);
  const rightHashes = groupRungs(right);
  for (const key of leftHashes.keys()) {
    if (!rightHashes.has(key)) push("rung present on one arm only", key, "absent", key);
  }
  for (const key of rightHashes.keys()) {
    if (!leftHashes.has(key)) push("rung present on one arm only", "absent", key, key);
  }

  const leftSummaries = summarize(left);
  const rightSummaries = summarize(right);
  for (const leftSummary of leftSummaries) {
    const key = rungKey(leftSummary.mode, leftSummary.objectCount);
    const rightSummary = rightSummaries.find(
      (summary) => rungKey(summary.mode, summary.objectCount) === key,
    );
    if (rightSummary === undefined) continue;

    const leftRungs = leftHashes.get(key) ?? [];
    const rightRungs = rightHashes.get(key) ?? [];
    const leftHashSet = new Set(leftRungs.map((entry) => entry.positionHash));
    const rightHashSet = new Set(rightRungs.map((entry) => entry.positionHash));
    // Every repeat of every rung must hash the same scene, within an arm and across the two.
    if (leftHashSet.size > 1 || rightHashSet.size > 1) {
      push(
        "positionHash (repeats disagree within an arm)",
        [...leftHashSet],
        [...rightHashSet],
        key,
      );
    } else if ([...leftHashSet][0] !== [...rightHashSet][0]) {
      push("positionHash", [...leftHashSet][0], [...rightHashSet][0], key);
    }
    if (leftSummary.sampleCount !== rightSummary.sampleCount)
      push("sampleCount", leftSummary.sampleCount, rightSummary.sampleCount, key);
    if (leftSummary.repeats !== rightSummary.repeats)
      push("repeats", leftSummary.repeats, rightSummary.repeats, key);

    const drawFailure = drawCallFailure(
      leftSummary.mode,
      leftSummary.objectCount,
      leftSummary,
      rightSummary,
    );
    if (drawFailure !== undefined) failures.push(drawFailure);

    const maxTriangles = Math.max(leftSummary.triangles, rightSummary.triangles);
    if (maxTriangles > 0) {
      const delta = Math.abs(leftSummary.triangles - rightSummary.triangles) / maxTriangles;
      if (delta > 0.05)
        push("triangles (>5% apart)", leftSummary.triangles, rightSummary.triangles, key);
    }
  }
  return failures;
}

export function compare(left: IRunReport, right: IRunReport): IComparison {
  const failures = checkEquivalence(left, right);
  if (failures.length > 0) {
    const detail = failures
      .map(
        (failure) =>
          `${failure.rung} ${failure.field}: ${left.arm}=${failure.left} ${right.arm}=${failure.right}`,
      )
      .join("; ");
    throw new BenchError("TN_BENCH_NOT_EQUIVALENT", detail);
  }
  const leftSummaries = summarize(left);
  const rightSummaries = summarize(right);
  return {
    left,
    leftKnee: { L1: knee(leftSummaries, "L1"), L2: knee(leftSummaries, "L2") },
    leftSummaries,
    right,
    rightKnee: { L1: knee(rightSummaries, "L1"), L2: knee(rightSummaries, "L2") },
    rightSummaries,
  };
}

export function renderArmMarkdown(report: IRunReport): string {
  const summaries = summarize(report);
  const lines = [
    `### Arm \`${report.arm}\``,
    "",
    `- engine: ${report.engine.name} ${report.engine.version}`,
    `- build: ${report.build.type}${report.build.notes.length > 0 ? ` — ${report.build.notes}` : ""}`,
    `- driver: ${report.driver.renderer}`,
    `- adapter: ${report.driver.adapter}`,
    `- device: ${report.device.label}, ${report.display.width}×${report.display.height} @ ${report.display.refreshHz} Hz, vsync ${report.display.vsync ? "on" : "off"}`,
    "",
    "| mode | N | p50 ms | p95 ms | draws | tris | visible | repeats × samples |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const summary of summaries) {
    lines.push(
      `| ${summary.mode} | ${summary.objectCount} | ${summary.p50.toFixed(2)} | ${summary.p95.toFixed(2)} | ${summary.drawCalls} | ${summary.triangles} | ${summary.visibleObjects} | ${summary.repeats} × ${summary.sampleCount} |`,
    );
  }
  lines.push(
    "",
    `**Knee at ≤ ${KNEE_THRESHOLD_MS} ms p95** — L1: ${formatKnee(knee(summaries, "L1"))}, L2: ${formatKnee(knee(summaries, "L2"))}`,
  );
  return lines.join("\n");
}

export function formatKnee(value: number | null): string {
  return value === null ? "below the first rung" : String(value);
}

export function renderComparisonMarkdown(comparison: IComparison): string {
  const lines = [
    `## ${comparison.left.arm} vs ${comparison.right.arm}`,
    "",
    "Product-to-product. Each arm is what that engine actually ships to this surface; the two run",
    "different rendering backends by construction and no line below is a graphics-API claim.",
    "",
    `| mode | knee — ${comparison.left.arm} | knee — ${comparison.right.arm} |`,
    "|---|---|---|",
  ];
  for (const mode of ["L1", "L2"] as const) {
    lines.push(
      `| ${mode} | ${formatKnee(comparison.leftKnee[mode])} | ${formatKnee(comparison.rightKnee[mode])} |`,
    );
  }
  lines.push(
    "",
    `| mode | N | ${comparison.left.arm} p95 ms | ${comparison.right.arm} p95 ms | ratio |`,
    "|---|---|---|---|---|",
  );
  for (const leftSummary of comparison.leftSummaries) {
    const rightSummary = comparison.rightSummaries.find(
      (summary) =>
        summary.mode === leftSummary.mode && summary.objectCount === leftSummary.objectCount,
    );
    if (rightSummary === undefined) continue;
    const ratio = leftSummary.p95 / rightSummary.p95;
    lines.push(
      `| ${leftSummary.mode} | ${leftSummary.objectCount} | ${leftSummary.p95.toFixed(2)} | ${rightSummary.p95.toFixed(2)} | ${ratio.toFixed(2)}× |`,
    );
  }
  lines.push("", renderArmMarkdown(comparison.left), "", renderArmMarkdown(comparison.right));
  return lines.join("\n");
}
