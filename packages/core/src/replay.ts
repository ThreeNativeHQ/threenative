import type { GamePluginHooks, GamePluginRuntime } from "./game.js";
const CORE_VERSION = "0.1.0";
const currentAgent = typeof navigator === "undefined" ? "node" : navigator.userAgent;
type Pointer = readonly [number, number, number, number, number];
type Point = readonly [number, number, number];
type ReplayContext = { renderer?: { domElement: HTMLCanvasElement } };
type RecordingSample = Readonly<{ keys: readonly string[]; pointer?: Pointer; tick: number }>;
type Random = NonNullable<GamePluginRuntime["random"]>;
let replayDepth = 0;
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
const invalid = (message: string): never => fail("TN_REPLAY_INVALID", message);
function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("bad object");
  return value as Record<string, unknown>;
}
function rejectKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) invalid(`unknown key '${unknown}'`);
}
function validatePointer(value: unknown, name: string): void {
  const pointer = Array.isArray(value) ? value : [];
  const valid =
    pointer.length === 5 &&
    pointer.every(Number.isFinite) &&
    (pointer[2] >= 0 ? Number.isInteger(pointer[2]) : false) &&
    Math.min(pointer[3], pointer[4]) > 0;
  if (!valid) invalid(`${name} pointer tuple is invalid`);
}
function validate(value: unknown): Recording {
  const root = object(value, "recording");
  rejectKeys(root, ["input", "randomState", "runtime", "seed", "ticks", "version"]);
  if (root.version !== 1) fail("TN_REPLAY_INVALID", "version must be 1");
  if (!Number.isFinite(root.seed) || !Number.isInteger(root.randomState)) invalid("bad seed");
  const ticks = root.ticks as number;
  if (!Number.isInteger(ticks) || ticks < 1) fail("TN_REPLAY_INVALID", "ticks must be positive");
  if (!Array.isArray(root.input) || root.input.length === 0) fail("TN_REPLAY_EMPTY", "empty input");
  const rawRuntime = object(root.runtime, "runtime");
  rejectKeys(rawRuntime, ["agent", "core", "rapier", "step"]);
  const nonEmptyString = (value: unknown) => typeof value === "string" && value.length > 0;
  const validRuntime =
    [rawRuntime.agent, rawRuntime.core].every(nonEmptyString) &&
    (rawRuntime.rapier === null || typeof rawRuntime.rapier === "string") &&
    (Number.isFinite(rawRuntime.step as number) ? (rawRuntime.step as number) > 0 : false);
  if (!validRuntime) fail("TN_REPLAY_INVALID", "runtime fingerprint is invalid");
  let previousTick = -1;
  for (const rawSample of root.input) {
    const sample = object(rawSample, "input sample");
    rejectKeys(sample, ["keys", "pointer", "tick"]);
    const tick = sample.tick as number;
    if (!Number.isInteger(tick) || tick <= previousTick || tick >= ticks) invalid("bad tick");
    if (!Array.isArray(sample.keys) || sample.keys.some((key) => typeof key !== "string"))
      fail("TN_REPLAY_INVALID", "bad keys");
    if (new Set(sample.keys).size !== sample.keys.length) invalid("duplicate keys");
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
function pointerViewport(ctx: ReplayContext, point: Point = [0, 0, 0]): Pointer {
  const canvas = ctx.renderer?.domElement;
  const rect = canvas?.getBoundingClientRect();
  const width = canvas?.clientWidth || globalThis.innerWidth || 1;
  const height = canvas?.clientHeight || globalThis.innerHeight || 1;
  return [point[0] - (rect?.left ?? 0), point[1] - (rect?.top ?? 0), point[2], width, height];
}
function pointerType(previous: number, next: number) {
  return previous && !next ? "pointerup" : !previous && next ? "pointerdown" : "pointermove";
}
function targetPointerPosition(pointer: Pointer, target: EventTarget): Point {
  const viewport = target as unknown as HTMLCanvasElement & Window;
  const rect = viewport.getBoundingClientRect?.();
  const width = viewport.clientWidth || viewport.innerWidth || rect?.width || pointer[3];
  const height = viewport.clientHeight || viewport.innerHeight || rect?.height || pointer[4];
  const x = (pointer[0] * width) / pointer[3] + (rect?.left ?? 0);
  const y = (pointer[1] * height) / pointer[4] + (rect?.top ?? 0);
  return [x, y, pointer[2]];
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
      [previousKeys, previousPointer] = [[], pointerViewport(ctx)];
      return undefined;
    },
    beforeUpdate: (ctx) => {
      if (replayDepth > 0) return;
      const keys = [...ctx.input.raw.keys].sort();
      const { position, buttons } = ctx.input.raw.pointer;
      const pointer = pointerViewport(ctx, [position.x, position.y, buttons]);
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
  if (random.state !== state) fail("TN_REPLAY_RUNTIME_MISMATCH", "random state mismatch");
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
      replayDepth += 1;
      try {
        for (let tick = 0; tick < value.ticks; tick += 1) {
          const sample = samples.get(tick);
          if (sample !== undefined) {
            dispatchKeys(target, keys, sample.keys);
            if (sample.pointer !== undefined && pointer.join() !== sample.pointer.join()) {
              pointerTarget.dispatchEvent(
                pointerEvent(
                  pointerType(pointer[2], sample.pointer[2]),
                  targetPointerPosition(sample.pointer, pointerTarget),
                ),
              );
              pointer = sample.pointer;
            }
          }
          runtime.fixedStep(1);
        }
        dispatchKeys(target, keys, []);
        releasePointer(pointer, pointerTarget);
        return value.ticks;
      } finally {
        replayDepth -= 1;
      }
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
