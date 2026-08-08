import type { IPlaytestScenario, IPlaytestStep } from "../scenario.js";
import { invalidScenario, rejectUnknownKeys } from "../scenario.js";

interface RecordingSample {
  keys: string[];
  pointer?: [number, number, number];
  tick: number;
}

interface RecordingValue {
  input: RecordingSample[];
  randomState: number;
  runtime: { agent: string; core: string; rapier: string | null; step: number };
  seed: number;
  ticks: number;
  version: 1;
}

const SCENARIO_VIEWPORT = { height: 720, width: 1280 } as const;

function recordNumber(value: unknown, path: string, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isInteger(value)))
    throw invalidScenario(path, `${path} must be a finite${integer ? " integer" : " number"}.`);
  return value;
}

function recordString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw invalidScenario(path, `${path} must be a non-empty string.`);
  return value;
}

function recordObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw invalidScenario(path, `${path} must be an object.`);
  return value as Record<string, unknown>;
}

function validateRecording(value: unknown, scenarioPath: string): RecordingValue {
  const root = recordObject(value, scenarioPath);
  rejectUnknownKeys(root, ["input", "randomState", "runtime", "seed", "ticks", "version"], scenarioPath, "recording");
  if (root.version !== 1) throw invalidScenario(scenarioPath, "recording.version must be 1.");
  const seed = recordNumber(root.seed, "recording.seed", true);
  const randomState = recordNumber(root.randomState, "recording.randomState", true);
  const ticks = recordNumber(root.ticks, "recording.ticks", true);
  if (ticks < 1) throw invalidScenario(scenarioPath, "recording.ticks must be positive.");
  if (!Array.isArray(root.input) || root.input.length === 0)
    throw invalidScenario(scenarioPath, "recording.input must contain at least one sample.");
  const runtime = recordObject(root.runtime, "recording.runtime");
  rejectUnknownKeys(runtime, ["agent", "core", "rapier", "step"], scenarioPath, "recording.runtime");
  const agent = recordString(runtime.agent, "recording.runtime.agent");
  const core = recordString(runtime.core, "recording.runtime.core");
  if (runtime.rapier !== null && typeof runtime.rapier !== "string")
    throw invalidScenario(scenarioPath, "recording.runtime.rapier must be a string or null.");
  const step = recordNumber(runtime.step, "recording.runtime.step");
  if (step <= 0) throw invalidScenario(scenarioPath, "recording.runtime.step must be positive.");
  let previousTick = -1;
  const input = root.input.map((rawSample, index) => {
    const sample = recordObject(rawSample, `${scenarioPath}:input[${index}]`);
    rejectUnknownKeys(sample, ["keys", "pointer", "tick"], scenarioPath, `recording.input[${index}]`);
    const tick = recordNumber(sample.tick, "recording.input.tick", true);
    if (tick <= previousTick || tick >= ticks)
      throw invalidScenario(scenarioPath, "recording input ticks must be increasing and in range.");
    if (!Array.isArray(sample.keys) || !sample.keys.every((key) => typeof key === "string"))
      throw invalidScenario(scenarioPath, "recording input.keys must contain strings.");
    const keys = [...sample.keys];
    if (keys.length > 1) throw invalidScenario(scenarioPath, "recording input cannot emit simultaneous keys.");
    const pointer = sample.pointer;
    if (
      pointer !== undefined &&
      (!Array.isArray(pointer) ||
        pointer.length !== 3 ||
        !pointer.every((item) => typeof item === "number" && Number.isFinite(item)))
    )
      throw invalidScenario(scenarioPath, "recording input.pointer must be a finite three-number tuple.");
    if (pointer !== undefined && pointer[2] !== 0)
      throw invalidScenario(scenarioPath, "recording pointer buttons cannot be emitted as playtest steps.");
    previousTick = tick;
    return { keys, ...(pointer === undefined ? {} : { pointer: pointer as [number, number, number] }), tick };
  });
  return { input, randomState, runtime: { agent, core, rapier: runtime.rapier as string | null, step }, seed, ticks, version: 1 };
}

function sampleSteps(sample: RecordingSample, ticks: number, scenarioPath: string): IPlaytestStep {
  if (ticks < 1) throw invalidScenario(scenarioPath, "recording produced a non-positive step duration.");
  const key = sample.keys[0];
  const pointerPosition = sample.pointer === undefined
    ? undefined
    : {
        x: sample.pointer[0] / SCENARIO_VIEWPORT.width,
        y: sample.pointer[1] / SCENARIO_VIEWPORT.height,
      };
  if (pointerPosition !== undefined && (pointerPosition.x < 0 || pointerPosition.x > 1 || pointerPosition.y < 0 || pointerPosition.y > 1))
    throw invalidScenario(scenarioPath, "recording pointer position must fit the playtest viewport.");
  return key === undefined
    ? { ...(pointerPosition === undefined ? {} : { pointerPosition }), release: true, waitTicks: ticks }
    : { ...(pointerPosition === undefined ? {} : { pointerPosition }), holdTicks: ticks, press: key, release: true };
}

function emitSteps(recording: RecordingValue, scenarioPath: string): IPlaytestStep[] {
  const steps: IPlaytestStep[] = [];
  const first = recording.input[0];
  if (first === undefined) throw invalidScenario(scenarioPath, "recording input is empty.");
  if (first.tick > 0) steps.push({ release: true, waitTicks: first.tick });
  for (const [index, sample] of recording.input.entries()) {
    const nextTick = recording.input[index + 1]?.tick ?? recording.ticks;
    steps.push(sampleSteps(sample, nextTick - sample.tick, scenarioPath));
  }
  return steps;
}

export function requireAssertions(
  value: IPlaytestScenario["assert"],
  scenarioPath: string,
): NonNullable<IPlaytestScenario["assert"]> {
  if (value === undefined || Object.keys(value).length === 0)
    throw invalidScenario(scenarioPath, "recording produced a scenario with zero assertions.");
  return value;
}

export function recordToScenario(value: unknown, scenarioPath = "recording.json"): IPlaytestScenario {
  const recording = validateRecording(value, scenarioPath);
  const steps = emitSteps(recording, scenarioPath);
  const assert = requireAssertions({
    diagnostics: { noConsoleErrors: true, runtimeReady: true },
    world: { seed: recording.seed },
  }, scenarioPath);
  if (steps.length === 0) throw invalidScenario(scenarioPath, "recording produced no steps.");
  return {
    assert,
    name: "replay",
    schemaVersion: 1,
    steps,
    target: "web",
    viewport: SCENARIO_VIEWPORT,
    warmupFrames: 0,
  };
}
