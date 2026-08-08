import type { IPlaytestScenario, IPlaytestStep } from "../scenario.js";
import { invalidScenario, rejectUnknownKeys } from "../scenario.js";

interface RecordingSample {
  keys: string[];
  pointer?: [number, number, number, number, number];
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

interface RecordingOracle {
  movement: {
    entity: string;
    position: [number, number, number];
    tolerance: number;
  };
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

function recordTuple(value: unknown, path: string): [number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((item) => typeof item === "number" && Number.isFinite(item))
  )
    throw invalidScenario(path, `${path} must be a finite three-number tuple.`);
  return value as [number, number, number];
}

function recordPointer(value: unknown, path: string): [number, number, number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 5 ||
    !value.every((item) => typeof item === "number" && Number.isFinite(item))
  )
    throw invalidScenario(path, `${path} must be [x, y, buttons, viewport width, viewport height].`);
  const pointer = value as [number, number, number, number, number];
  if (!Number.isInteger(pointer[2]) || pointer[2] < 0)
    throw invalidScenario(path, `${path} buttons must be a non-negative integer.`);
  if (!Number.isInteger(pointer[3]) || pointer[3] < 1 || !Number.isInteger(pointer[4]) || pointer[4] < 1)
    throw invalidScenario(path, `${path} viewport dimensions must be positive integers.`);
  return pointer;
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
    if (new Set(keys).size !== keys.length)
      throw invalidScenario(scenarioPath, "recording input.keys must not repeat.");
    const pointer = sample.pointer === undefined
      ? undefined
      : recordPointer(sample.pointer, `recording.input[${index}].pointer`);
    previousTick = tick;
    return { keys, ...(pointer === undefined ? {} : { pointer }), tick };
  });
  return { input, randomState, runtime: { agent, core, rapier: runtime.rapier as string | null, step }, seed, ticks, version: 1 };
}

function validateRecordingOracle(value: unknown, scenarioPath: string): RecordingOracle {
  if (value === undefined) {
    throw invalidScenario(
      scenarioPath,
      "recording conversion requires a final-position oracle; pass --oracle oracle.json.",
    );
  }
  const root = recordObject(value, `${scenarioPath}:oracle`);
  rejectUnknownKeys(root, ["movement"], scenarioPath, "recording oracle");
  const movement = recordObject(root.movement, `${scenarioPath}:oracle.movement`);
  rejectUnknownKeys(
    movement,
    ["entity", "position", "tolerance"],
    scenarioPath,
    "recording oracle movement",
  );
  const entity = recordString(movement.entity, "recording oracle movement.entity");
  const position = recordTuple(movement.position, "recording oracle movement.position");
  const tolerance = recordNumber(movement.tolerance, "recording oracle movement.tolerance");
  if (tolerance < 0)
    throw invalidScenario(scenarioPath, "recording oracle movement.tolerance must be non-negative.");
  return { movement: { entity, position, tolerance } };
}

function sampleSteps(
  sample: RecordingSample,
  ticks: number,
  release: boolean,
  scenarioPath: string,
): IPlaytestStep {
  if (ticks < 1) throw invalidScenario(scenarioPath, "recording produced a non-positive step duration.");
  const pointerPosition = sample.pointer === undefined
    ? undefined
    : {
        buttons: sample.pointer[2],
        x: sample.pointer[0] / sample.pointer[3],
        y: sample.pointer[1] / sample.pointer[4],
      };
  if (pointerPosition !== undefined && (pointerPosition.x < 0 || pointerPosition.x > 1 || pointerPosition.y < 0 || pointerPosition.y > 1))
    throw invalidScenario(scenarioPath, "recording pointer position must fit the playtest viewport.");
  return {
    ...(pointerPosition === undefined ? {} : { pointerPosition }),
    holdTicks: ticks,
    press: sample.keys,
    release,
  };
}

function emitSteps(recording: RecordingValue, scenarioPath: string): IPlaytestStep[] {
  const steps: IPlaytestStep[] = [];
  const first = recording.input[0];
  if (first === undefined) throw invalidScenario(scenarioPath, "recording input is empty.");
  if (first.tick > 0) steps.push({ release: true, waitTicks: first.tick });
  for (const [index, sample] of recording.input.entries()) {
    const nextTick = recording.input[index + 1]?.tick ?? recording.ticks;
    steps.push(sampleSteps(sample, nextTick - sample.tick, index === recording.input.length - 1, scenarioPath));
  }
  return steps;
}

function behaviorAssertions(
  recording: RecordingValue,
  oracle: RecordingOracle,
  scenarioPath: string,
) {
  const activeTicks = recording.input.reduce((total, sample, index) => {
    const nextTick = recording.input[index + 1]?.tick ?? recording.ticks;
    return total + (sample.keys.length > 0 || sample.pointer !== undefined ? nextTick - sample.tick : 0);
  }, 0);
  if (activeTicks === 0) {
    throw invalidScenario(scenarioPath, "recording produced no meaningful behavior assertions.");
  }
  const minimumTraversal = activeTicks * recording.runtime.step;
  return {
    movement: {
      entity: oracle.movement.entity,
      minDistance: minimumTraversal,
      pathLength: minimumTraversal,
      reachesPositionWithin: {
        maxDistance: oracle.movement.tolerance,
        position: oracle.movement.position,
      },
    },
  };
}

export function requireAssertions(
  value: IPlaytestScenario["assert"],
  scenarioPath: string,
): NonNullable<IPlaytestScenario["assert"]> {
  if (value === undefined || Object.keys(value).length === 0)
    throw invalidScenario(scenarioPath, "recording produced a scenario with zero assertions.");
  return value;
}

export function recordToScenario(
  value: unknown,
  scenarioPath = "recording.json",
  oracleValue?: unknown,
): IPlaytestScenario {
  const recording = validateRecording(value, scenarioPath);
  const oracle = validateRecordingOracle(oracleValue, scenarioPath);
  const steps = emitSteps(recording, scenarioPath);
  const behavior = behaviorAssertions(recording, oracle, scenarioPath);
  const assert = requireAssertions({
    diagnostics: { noConsoleErrors: true, runtimeReady: true },
    ...behavior,
    world: {
      runtime: {
        agent: recording.runtime.agent,
        core: recording.runtime.core,
        randomState: recording.randomState,
        rapier: recording.runtime.rapier,
        step: recording.runtime.step,
      },
      seed: recording.seed,
    },
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
