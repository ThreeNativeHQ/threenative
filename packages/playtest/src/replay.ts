export type ReplayPointer = readonly [number, number, number, number, number];

export interface IReplayRecordingSample {
  readonly keys: readonly string[];
  readonly pointer?: ReplayPointer;
  readonly tick: number;
}

export interface IReplayRecording {
  readonly input: readonly IReplayRecordingSample[];
  readonly randomState: number;
  readonly runtime: {
    agent: string;
    core: string;
    portable?: boolean;
    rapier: string | null;
    step: number;
  };
  readonly seed: number;
  readonly ticks: number;
  readonly version: 1;
}

function fail(message: string, code = "TN_REPLAY_INVALID"): never {
  throw new Error(`${code}: ${message}`);
}

function checked(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("bad object");
  const result = value as Record<string, unknown>;
  const unknown = Object.keys(result).find((key) => !allowed.includes(key));
  if (unknown !== undefined) fail(`unknown key '${unknown}'`);
  return result;
}

function validatePointer(value: unknown): void {
  const pointer = Array.isArray(value) ? value : [];
  if (
    pointer.length !== 5 ||
    !pointer.every(Number.isFinite) ||
    !Number.isInteger(pointer[2]) ||
    pointer[2] < 0 ||
    Math.min(pointer[3], pointer[4]) <= 0
  )
    fail("pointer tuple is invalid");
}

export function parseReplayRecording(value: unknown): IReplayRecording {
  const root = checked(value, ["input", "randomState", "runtime", "seed", "ticks", "version"]);
  if (root.version !== 1 || !Number.isFinite(root.seed) || !Number.isInteger(root.randomState))
    fail("bad header");
  const ticks = root.ticks as number;
  if (!Number.isInteger(ticks) || ticks < 1) fail("ticks must be positive");
  const input = root.input;
  if (!Array.isArray(input) || input.length === 0) fail("empty input", "TN_REPLAY_EMPTY");
  const runtime = checked(root.runtime, ["agent", "core", "portable", "rapier", "step"]);
  const step = runtime.step as number;
  if (
    typeof runtime.agent !== "string" ||
    !runtime.agent ||
    typeof runtime.core !== "string" ||
    !runtime.core ||
    (runtime.portable !== undefined && typeof runtime.portable !== "boolean") ||
    (runtime.rapier !== null && typeof runtime.rapier !== "string") ||
    !Number.isFinite(step) ||
    step <= 0
  )
    fail("runtime fingerprint is invalid");
  let previousTick = -1;
  for (const rawSample of input) {
    const sample = checked(rawSample, ["keys", "pointer", "tick"]);
    const tick = sample.tick as number;
    if (!Number.isInteger(tick) || tick <= previousTick || tick >= ticks) fail("bad tick");
    const keys = sample.keys;
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string")) fail("bad keys");
    if (new Set(keys).size !== keys.length) fail("duplicate keys");
    if (sample.pointer !== undefined) validatePointer(sample.pointer);
    previousTick = tick;
  }
  return root as unknown as IReplayRecording;
}
