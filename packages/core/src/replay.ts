import type { GamePluginHooks, GamePluginRuntime } from "./game.js";
const CORE_VERSION = "0.1.0";
const currentAgent = typeof navigator === "undefined" ? "node" : navigator.userAgent;
type Pointer = readonly [number, number, number, number, number];
type Point = readonly [number, number, number];
type ReplayContext = { renderer?: { domElement: HTMLCanvasElement } };
type RecordingSample = Readonly<{ keys: readonly string[]; pointer?: Pointer; tick: number }>;
type Random = NonNullable<GamePluginRuntime["random"]>;
export interface Recording {
  readonly input: readonly RecordingSample[];
  readonly randomState: number;
  readonly runtime: { agent: string; core: string; rapier: string | null; step: number };
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
function validatePointer(value: unknown, name: string): void {
  const pointer = Array.isArray(value) ? value : [];
  const valid =
    pointer.length === 5 &&
    pointer.every(Number.isFinite) &&
    Number.isInteger(pointer[2]) &&
    pointer[2] >= 0 &&
    Number.isInteger(pointer[3]) &&
    pointer[3] > 0 &&
    Number.isInteger(pointer[4]) &&
    pointer[4] > 0;
  if (!valid)
    fail("TN_REPLAY_INVALID", `${name} must contain x, y, buttons, viewport width, and height`);
}
function validate(value: unknown): Recording {
  const root = object(value, "recording");
  rejectKeys(root, ["input", "randomState", "runtime", "seed", "ticks", "version"]);
  if (root.version !== 1) fail("TN_REPLAY_INVALID", "version must be 1");
  if (!Number.isInteger(root.seed) || !Number.isInteger(root.randomState))
    fail("TN_REPLAY_INVALID", "seed and randomState must be integers");
  const ticks = root.ticks as number;
  if (!Number.isInteger(ticks) || ticks < 1) fail("TN_REPLAY_INVALID", "ticks must be positive");
  if (!Array.isArray(root.input) || root.input.length === 0)
    fail("TN_REPLAY_EMPTY", "input is empty");
  const rawRuntime = object(root.runtime, "runtime");
  rejectKeys(rawRuntime, ["agent", "core", "rapier", "step"]);
  const validRuntime =
    [rawRuntime.agent, rawRuntime.core].every(
      (item) => typeof item === "string" && item.length > 0,
    ) &&
    (rawRuntime.rapier === null || typeof rawRuntime.rapier === "string") &&
    typeof rawRuntime.step === "number" &&
    Number.isFinite(rawRuntime.step) &&
    rawRuntime.step > 0;
  if (!validRuntime) fail("TN_REPLAY_INVALID", "runtime fingerprint is invalid");
  let previousTick = -1;
  for (const rawSample of root.input) {
    const sample = object(rawSample, "input sample");
    rejectKeys(sample, ["keys", "pointer", "tick"]);
    const tick = sample.tick as number;
    if (!Number.isInteger(tick) || tick <= previousTick || tick >= ticks)
      fail("TN_REPLAY_INVALID", "input ticks are out of range");
    if (!Array.isArray(sample.keys) || sample.keys.some((key) => typeof key !== "string"))
      fail("TN_REPLAY_INVALID", "input.keys must contain strings");
    if (new Set(sample.keys).size !== sample.keys.length)
      fail("TN_REPLAY_INVALID", "input.keys must not repeat");
    if (sample.pointer !== undefined) validatePointer(sample.pointer, "input.pointer");
    previousTick = tick;
  }
  return root as unknown as Recording;
}
function keyEvent(type: "keydown" | "keyup", code: string): Event {
  return Object.assign(new Event(type), { code });
}
function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup",
  [clientX, clientY, buttons]: Point,
): Event {
  return Object.assign(new Event(type), { buttons, clientX, clientY, pointerId: 0 });
}
function pointerViewport(ctx: ReplayContext): [number, number] {
  const canvas = ctx.renderer?.domElement;
  const width = canvas?.clientWidth || globalThis.innerWidth || 1;
  const height = canvas?.clientHeight || globalThis.innerHeight || 1;
  return [width, height];
}
function pointerType(previous: number, next: number) {
  return previous && !next ? "pointerup" : !previous && next ? "pointerdown" : "pointermove";
}
function targetPointerPosition(pointer: Pointer, target: EventTarget): Point {
  const viewport = target as unknown as Partial<Record<string, number>>;
  const width = viewport.clientWidth || viewport.innerWidth || pointer[3];
  const height = viewport.clientHeight || viewport.innerHeight || pointer[4];
  return [(pointer[0] * width) / pointer[3], (pointer[1] * height) / pointer[4], pointer[2]];
}
function dispatchKeys(target: EventTarget, current: Set<string>, keys: readonly string[]): void {
  for (const key of current) if (!keys.includes(key)) target.dispatchEvent(keyEvent("keyup", key));
  for (const key of keys) if (!current.has(key)) target.dispatchEvent(keyEvent("keydown", key));
  current.clear();
  for (const key of keys) current.add(key);
}
function releasePointer(pointer: Pointer, target: EventTarget): void {
  if (pointer[2] === 0) return;
  const released = [pointer[0], pointer[1], 0, pointer[3], pointer[4]] as Pointer;
  target.dispatchEvent(pointerEvent("pointerup", targetPointerPosition(released, target)));
}
type ReplayPublic = { readonly recording: Recording | undefined; readonly runId: symbol };
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
  let previousPointer: Pointer = [0, 0, 0, 1, 1];
  return {
    get recording() {
      if (header === undefined) return undefined;
      return {
        ...header,
        input: [...samples],
        runtime: { ...header.runtime, rapier: recordRuntime?.rapier ?? header.runtime.rapier },
        ticks,
      };
    },
    runId,
    setup: (ctx, runtime) => {
      if (runtime?.seed === null || runtime?.seed === undefined)
        fail("TN_REPLAY_UNSEEDED", "replay requires a seed");
      const { rapier, seed, step } = runtime;
      recordRuntime = runtime;
      header = {
        randomState: ctx.random.state,
        runtime: { agent: currentAgent, core: CORE_VERSION, rapier: rapier ?? null, step },
        seed,
        version: 1,
      };
      samples.length = ticks = 0;
      [previousKeys, previousPointer] = [[], [0, 0, 0, ...pointerViewport(ctx)] as Pointer];
      return undefined;
    },
    beforeUpdate: (ctx) => {
      const keys = [...ctx.input.raw.keys].sort();
      const { position, buttons } = ctx.input.raw.pointer;
      const pointer = [...position.toArray(), buttons, ...pointerViewport(ctx)] as Pointer;
      const pointerChanged = pointer.join() !== previousPointer.join();
      if (pointerChanged || keys.join() !== previousKeys.join()) {
        samples.push({ keys, ...(pointerChanged ? { pointer } : {}), tick: ticks });
        [previousKeys, previousPointer] = [keys, pointer];
      }
      ticks += 1;
    },
  };
}
function validateRuntime(runtime: GamePluginRuntime, recording: Recording): Random {
  const random = runtime.random;
  if (
    runtime.seed !== recording.seed ||
    runtime.step !== recording.runtime.step ||
    (runtime.rapier ?? null) !== (recording.runtime.rapier ?? null) ||
    recording.runtime.core !== CORE_VERSION ||
    recording.runtime.agent !== currentAgent ||
    random === undefined
  )
    fail("TN_REPLAY_RUNTIME_MISMATCH", "recording runtime does not match the current build");
  return random;
}
function restoreRandomState(random: Random, state: number): Random {
  try {
    random.state = state;
  } catch {
    fail("TN_REPLAY_RUNTIME_MISMATCH", "runtime random state cannot be restored");
  }
  if (random.state !== state)
    fail("TN_REPLAY_RUNTIME_MISMATCH", "runtime random state cannot be restored");
  return random;
}
export function createReplayDriver(
  recording: Recording,
  target: EventTarget,
  pointerTarget = target,
) {
  const value = validate(recording);
  const samples = new Map(value.input.map((sample) => [sample.tick, sample]));
  let preparedRandom: Pick<Random, "state"> | undefined;
  const driver = Object.assign(
    (runtime: GamePluginRuntime) => {
      const random = validateRuntime(runtime, value);
      if (preparedRandom !== random) restoreRandomState(random, value.randomState);
      preparedRandom = undefined;
      target.dispatchEvent(new Event("blur"));
      const keys = new Set<string>();
      let pointer: Pointer = [0, 0, 0, 1, 1];
      for (let tick = 0; tick < value.ticks; tick += 1) {
        const sample = samples.get(tick);
        if (sample !== undefined) {
          dispatchKeys(target, keys, sample.keys);
          if (sample.pointer !== undefined && pointer.join() !== sample.pointer.join()) {
            const type = pointerType(pointer[2], sample.pointer[2]);
            pointerTarget.dispatchEvent(
              pointerEvent(type, targetPointerPosition(sample.pointer, pointerTarget)),
            );
            pointer = sample.pointer;
          }
        }
        runtime.fixedStep(1);
      }
      dispatchKeys(target, keys, []);
      releasePointer(pointer, pointerTarget);
      return value.ticks;
    },
    {
      prepare: (runtime: GamePluginRuntime) => {
        preparedRandom = restoreRandomState(validateRuntime(runtime, value), value.randomState);
      },
      runId: Symbol("replay-driver"),
    },
  );
  return driver;
}
