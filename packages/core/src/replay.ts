import type { GamePluginHooks, GamePluginRuntime } from "./game.js";
const CORE_VERSION = "0.1.0";
const currentAgent = typeof navigator === "undefined" ? "node" : navigator.userAgent;
export interface Recording {
  readonly input: readonly {
    readonly keys: readonly string[];
    readonly pointer?: readonly [number, number, number];
    readonly tick: number;
  }[];
  readonly randomState: number;
  readonly runtime: {
    readonly agent: string;
    readonly core: string;
    readonly rapier: string | null;
    readonly step: number;
  };
  readonly seed: number;
  readonly ticks: number;
  readonly version: 1;
}
function fail(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}
function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail("TN_REPLAY_INVALID", `${name} must be an object`);
  return value as Record<string, unknown>;
}
function rejectKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) fail("TN_REPLAY_INVALID", `unknown key '${unknown}'`);
}
function validate(value: unknown): Recording {
  const root = object(value, "recording");
  rejectKeys(root, ["input", "randomState", "runtime", "seed", "ticks", "version"]);
  if (root.version !== 1) fail("TN_REPLAY_INVALID", "version must be 1");
  if (
    ![root.seed, root.randomState].every(
      (item) => typeof item === "number" && Number.isInteger(item),
    )
  )
    fail("TN_REPLAY_INVALID", "seed and randomState must be integers");
  const ticks = root.ticks as number;
  if (!Number.isInteger(ticks) || ticks < 1) fail("TN_REPLAY_INVALID", "ticks must be positive");
  if (!Array.isArray(root.input) || root.input.length === 0)
    fail("TN_REPLAY_EMPTY", "input is empty");
  const rawRuntime = object(root.runtime, "runtime");
  rejectKeys(rawRuntime, ["agent", "core", "rapier", "step"]);
  if (
    typeof rawRuntime.agent !== "string" ||
    rawRuntime.agent.length === 0 ||
    typeof rawRuntime.core !== "string" ||
    rawRuntime.core.length === 0 ||
    (rawRuntime.rapier !== null && typeof rawRuntime.rapier !== "string") ||
    typeof rawRuntime.step !== "number" ||
    !Number.isFinite(rawRuntime.step) ||
    rawRuntime.step <= 0
  )
    fail("TN_REPLAY_INVALID", "runtime fingerprint is invalid");
  let previousTick = -1;
  for (const rawSample of root.input) {
    const sample = object(rawSample, "input sample");
    rejectKeys(sample, ["keys", "pointer", "tick"]);
    if (
      typeof sample.tick !== "number" ||
      !Number.isInteger(sample.tick) ||
      sample.tick <= previousTick ||
      sample.tick >= ticks
    )
      fail("TN_REPLAY_INVALID", "input ticks are out of range");
    if (!Array.isArray(sample.keys) || sample.keys.some((key) => typeof key !== "string"))
      fail("TN_REPLAY_INVALID", "input.keys must contain strings");
    if (new Set(sample.keys).size !== sample.keys.length)
      fail("TN_REPLAY_INVALID", "input.keys must not repeat");
    previousTick = sample.tick;
  }
  return root as unknown as Recording;
}
function keyEvent(type: "keydown" | "keyup", code: string): Event {
  return Object.assign(new Event(type), { code });
}
function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup",
  [clientX, clientY, buttons]: readonly [number, number, number],
): Event {
  return Object.assign(new Event(type), {
    buttons,
    clientX,
    clientY,
    pointerId: 0,
  });
}
function dispatchKeys(target: EventTarget, current: Set<string>, keys: readonly string[]): void {
  for (const key of current) if (!keys.includes(key)) target.dispatchEvent(keyEvent("keyup", key));
  for (const key of keys) if (!current.has(key)) target.dispatchEvent(keyEvent("keydown", key));
  current.clear();
  for (const key of keys) current.add(key);
}
type ReplayPublic = { readonly recording: Recording | undefined; readonly runId: symbol };
type ReplayDriver = ((runtime: GamePluginRuntime) => number) & { readonly runId: symbol };
export function replay<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
>(): GamePluginHooks<TState, TPhysics> & ReplayPublic {
  const runId = Symbol("replay");
  const samples: Array<Recording["input"][number]> = [];
  let header: Omit<Recording, "input" | "ticks"> | undefined;
  let recordRuntime: GamePluginRuntime | undefined;
  let ticks = 0;
  let previousKeys: string[] = [];
  let previousPointer: [number, number, number] = [0, 0, 0];
  return {
    get recording() {
      if (header === undefined) return undefined;
      return {
        ...header,
        input: [...samples],
        runtime: {
          ...header.runtime,
          rapier: recordRuntime?.rapier ?? header.runtime.rapier,
        },
        ticks,
      };
    },
    runId,
    setup: (ctx, runtime) => {
      if (runtime?.seed === null || runtime?.seed === undefined)
        fail("TN_REPLAY_UNSEEDED", "replay requires a seed");
      recordRuntime = runtime;
      header = {
        randomState: ctx.random.state,
        runtime: {
          agent: currentAgent,
          core: CORE_VERSION,
          rapier: runtime.rapier ?? null,
          step: runtime.step,
        },
        seed: runtime.seed,
        version: 1,
      };
      samples.length = 0;
      ticks = 0;
      previousKeys = [];
      previousPointer = [0, 0, 0];
      return undefined;
    },
    update: (ctx) => {
      const keys = [...ctx.input.raw.keys].sort();
      const pointer: [number, number, number] = [
        ctx.input.raw.pointer.position.x,
        ctx.input.raw.pointer.position.y,
        ctx.input.raw.pointer.buttons,
      ];
      const pointerChanged = pointer.join() !== previousPointer.join();
      const changed =
        pointerChanged ||
        keys.length !== previousKeys.length ||
        keys.some((key, index) => key !== previousKeys[index]);
      if (changed) {
        samples.push({
          keys,
          ...(pointerChanged ? { pointer } : {}),
          tick: ticks,
        });
        previousKeys = keys;
        previousPointer = pointer;
      }
      ticks += 1;
    },
  };
}
export function createReplayDriver(recording: Recording, target: EventTarget): ReplayDriver {
  const value = validate(recording);
  const samples = new Map(value.input.map((sample) => [sample.tick, sample]));
  const driver = Object.assign(
    (runtime: GamePluginRuntime) => {
      if (runtime.seed !== value.seed || runtime.step !== value.runtime.step)
        fail("TN_REPLAY_RUNTIME_MISMATCH", "recording seed or fixed step does not match");
      if ((runtime.rapier ?? null) !== (value.runtime.rapier ?? null))
        fail("TN_REPLAY_RUNTIME_MISMATCH", "recording runtime does not match the current build");
      if (runtime.random === undefined)
        fail("TN_REPLAY_RUNTIME_MISMATCH", "runtime random state handle is unavailable");
      try {
        runtime.random.state = value.randomState;
      } catch {
        fail("TN_REPLAY_RUNTIME_MISMATCH", "runtime random state cannot be restored");
      }
      if (runtime.random.state !== value.randomState)
        fail("TN_REPLAY_RUNTIME_MISMATCH", "runtime random state cannot be restored");

      const keys = new Set<string>();
      let pointer: [number, number, number] = [0, 0, 0];
      for (let tick = 0; tick < value.ticks; tick += 1) {
        const sample = samples.get(tick);
        if (sample !== undefined) {
          dispatchKeys(target, keys, sample.keys);
          if (sample.pointer !== undefined && pointer.join() !== sample.pointer.join()) {
            const wasDown = pointer[2] !== 0;
            const nextDown = sample.pointer[2] !== 0;
            const type =
              wasDown && !nextDown
                ? "pointerup"
                : !wasDown && nextDown
                  ? "pointerdown"
                  : "pointermove";
            target.dispatchEvent(pointerEvent(type, sample.pointer));
            pointer = [...sample.pointer];
          }
        }
        runtime.fixedStep(1);
      }
      return value.ticks;
    },
    { runId: Symbol("replay-driver") },
  ) as ReplayDriver;
  if (value.runtime.core !== CORE_VERSION || value.runtime.agent !== currentAgent)
    fail("TN_REPLAY_RUNTIME_MISMATCH", "recording runtime does not match the current build");
  return driver;
}
