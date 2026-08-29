import {
  type IWorkloadConfig,
  type RenderMode,
  type RenderingMode,
  validateWorkloadConfig,
} from "../../../scripts/native-cpu-profile/workload.js";

export interface IBrowserScenario extends Omit<IWorkloadConfig, "passes" | "renderMode"> {
  readonly passes: 1 | 2;
  readonly renderMode: RenderMode;
  readonly rendering: RenderingMode;
  readonly rendererStages: boolean;
  readonly renderAdvisor: boolean;
  readonly samples: number;
  readonly warmupFrames: number;
}

const BROWSER_CONFIG_KEYS = new Set([
  "dirty",
  "hierarchy",
  "objects",
  "passes",
  "renderAdvisor",
  "renderMode",
  "rendererStages",
  "rendering",
  "samples",
  "scenario",
  "seed",
  "visibility",
  "warmup",
]);

function rejectUnknownQueryKeys(params: URLSearchParams): void {
  for (const key of params.keys()) {
    if (!BROWSER_CONFIG_KEYS.has(key)) throw new Error(`Unknown browser configuration key: ${key}`);
  }
}

function numericParameter(params: URLSearchParams, name: string, fallback: number): number {
  const value = params.get(name);
  if (value !== null && value.trim() === "") throw new Error(`${name} is invalid`);
  return Number(value ?? fallback);
}

function integerParameter(
  params: URLSearchParams,
  name: string,
  fallback: number,
  minimum = 0,
): number {
  const parsed = numericParameter(params, name, fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${name} is invalid`);
  return parsed;
}

function booleanParameter(params: URLSearchParams, name: string, fallback = false): boolean {
  const value = params.get(name);
  if (value === null) return fallback;
  if (value === "1") return true;
  if (value === "0") return false;
  throw new Error(`${name} is invalid`);
}

export function parseBrowserScenario(search: string): IBrowserScenario {
  const params = new URLSearchParams(search);
  rejectUnknownQueryKeys(params);
  const objectCount = integerParameter(params, "objects", 500, 1);
  const seed = integerParameter(params, "seed", 90210);
  const samples = integerParameter(params, "samples", 180, 1);
  const warmupFrames = integerParameter(params, "warmup", 120);
  const hierarchy = params.get("hierarchy") ?? "flat";
  const visibility = params.get("visibility") ?? "all-visible";
  const dirtyPercent = numericParameter(params, "dirty", 10);
  const renderMode = params.get("renderMode") ?? "independent";
  const rendering = params.get("rendering") ?? "complete";
  const rendererStages = booleanParameter(params, "rendererStages");
  const renderAdvisor = booleanParameter(params, "renderAdvisor");
  const preset = params.get("scenario");
  const passes = integerParameter(params, "passes", 1, 1);
  if (passes !== 1 && passes !== 2) throw new Error("passes is invalid");
  if (rendering !== "complete" && rendering !== "cpu-only") throw new Error("rendering is invalid");
  const workloadConfig = validateWorkloadConfig({
    dirtyRatio: dirtyPercent / 100,
    hierarchy,
    objectCount,
    passes,
    renderMode,
    ...(preset === null ? {} : { scenario: preset }),
    seed,
    visibility,
  });
  return {
    ...workloadConfig,
    passes: workloadConfig.passes as 1 | 2,
    renderMode: workloadConfig.renderMode as RenderMode,
    rendering: rendering as RenderingMode,
    rendererStages,
    renderAdvisor,
    samples,
    warmupFrames,
  };
}
