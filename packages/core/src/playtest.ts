import {
  type IPlaytestBridgeDescription,
  type IPlaytestBridgeV1,
  type IPlaytestContactObservation,
  type IPlaytestGameplayObservation,
  type IPlaytestObservationSnapshot,
  type IPlaytestSampleRequest,
  type IPlaytestStrideObservation,
  type IPlaytestWorldObservation,
  type JsonValue,
  PLAYTEST_PROTOCOL_LIMITS,
  assertJsonSafe,
} from "@threenative/playtest/protocol";
import { type IThreePlaytestEntity, installThreePlaytestBridge } from "@threenative/playtest/three";
import { Object3D, type Object3D as ThreeObject3D, type Vector2 } from "three";
import { audioRuntimeSnapshot } from "./audio.js";
import type { EntitySnapshot } from "./entities.js";
import type { IGameObservationContribution, IGamePluginHooks, IGamePluginRuntime } from "./game.js";
import { readRenderChainObservation } from "./render/chain.js";
import type { ICtx } from "./scene.js";
import { CORE_VERSION } from "./version.js";

const currentAgent = typeof navigator === "undefined" ? "node" : navigator.userAgent;

/**
 * Install the playtest bridge into a portable game.
 * @situation expose movement and world observations to a playtest
 * @situation connect a game to the ThreeNative scenario runner
 * @constraint install once in the game's plugin list
 * @example const game = defineGame({ plugins: [playtest()] });
 */
export function playtest<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
>(options: IPlaytestOptions = {}): IGamePluginHooks<TState, TPhysics> {
  let dispose: (() => void) | undefined;
  let attached: Promise<void> | undefined;
  let startSceneEntered: Promise<void> | undefined;
  let contactHistory: IPlaytestContactObservation[] = [];
  return {
    sceneExit: () => {
      contactHistory = [];
    },
    setup: async (ctx, runtime) => {
      const seed = runtime?.seed ?? null;
      const replayRuntime: IPlaytestWorldObservation["runtime"] =
        runtime?.seed === null || runtime?.seed === undefined
          ? undefined
          : {
              agent: currentAgent,
              core: CORE_VERSION,
              randomState: ctx.random.state,
              rapier: runtime.rapier ?? null,
              step: runtime.step,
            };
      const installation = installThreePlaytestBridge({
        camera: ctx.camera,
        entities: () => bridgeEntities(ctx),
        components: () => componentObservations(ctx.entities.snapshot()),
        ...(runtime === undefined ? {} : { fixedStep: runtime.fixedStep, tick: runtime.tick }),
        ...(runtime?.runtimeDiagnosticsSeries === undefined
          ? {}
          : { runtimeDiagnosticsSeries: runtime.runtimeDiagnosticsSeries }),
        ...(options.events === undefined ? {} : { events: options.events }),
        gameplay: () => gameplayObservations(ctx, contactHistory, seed, replayRuntime),
        gameplayChannels: () => gameplayChannels(ctx),
        renderer: ctx.renderer.raw as { getDrawingBufferSize(target: Vector2): Vector2 },
        renderChain: () => {
          const observation = readRenderChainObservation(ctx.renderer);
          return observation === undefined
            ? undefined
            : {
                ...observation,
                contributions: observation.contributions.map((contribution) => ({
                  ...contribution,
                })),
                dropped: observation.dropped.map((stage) => ({ ...stage })),
                requested: [...observation.requested],
                stages: [...observation.stages],
                velocity: { ...observation.velocity },
              };
        },
        resources: stateResources(ctx),
        scene: ctx.scene,
        // A runner advances ticks far faster than a launch completes, and compute dispatch and
        // the first world present are both held behind an opaque loading layer. Published so the
        // runner waits for the world rather than observing a frozen simulation behind a loader.
        startup: () => ({
          phase: ctx.startup.phase,
          progress: ctx.startup.progress,
          ...(runtime?.startupCompileSettled === undefined
            ? {}
            : { compileSettled: runtime.startupCompileSettled() }),
          // Wall-clock milestones, so a scenario asserts startup time as an observation instead
          // of reading it off a console marker after the fact.
          ...(runtime?.startupTimeline === undefined
            ? {}
            : { timeline: runtime.startupTimeline() }),
        }),
      });
      installRuntimeChannels(installation.bridge, runtime);
      // A runner announced itself before the page loaded: it is the one consumer of per-frame
      // render samples, so collection turns on exactly for playtest runs and stays off for
      // every plain `pnpm dev` frame.
      if ((globalThis as Record<string, unknown>)[PLAYTEST_RUNNER_EXPECTED_GLOBAL] === true)
        runtime?.enableRuntimeDiagnostics?.();
      dispose = installation.dispose;
      attached = holdUntilAttached(installation.bridge, options, () => startSceneEntered);
      const cleanup = () => {
        dispose?.();
        dispose = undefined;
        attached = undefined;
        startSceneEntered = undefined;
        contactHistory = [];
      };
      // Hand the hold to the game rather than blocking this plugin's setup. The game waits after
      // load() has registered setup placeholders but before enter() transfers them into live state.
      // describe() releases a no-setup run and waits for the returned scene-enter signal before it
      // reads entity-derived capabilities.
      if (attached !== undefined) {
        const gate = attached.catch((error: unknown) => {
          cleanup();
          throw error;
        });
        if (runtime?.holdStart === undefined) await gate;
        else {
          startSceneEntered = runtime.holdStart(gate);
          // describe() awaits the same promise when called. Attach a rejection handler now so a
          // setup failure cannot become an unhandled rejection when the runner stops at applySetup.
          void startSceneEntered.catch(() => undefined);
        }
      }
      return cleanup;
    },
  };
}

export const PLAYTEST_ATTACH_TIMEOUT_MS = 30_000;

/**
 * Resolves when a runner first calls `describe()`, the handshake every runner performs before
 * it observes anything.
 *
 * Without this, a scenario races the game: a proof that does finite work at startup can finish
 * before the runner takes its first observation, and the assertion then reports
 * TN_PLAYTEST_ASSERTION_TRIVIAL or a zero-delta failure depending only on how fast the device
 * booted. Opt-in, because a game that holds for a runner that never arrives is worse than the
 * race for every non-test caller.
 *
 * Fails closed: if no runner attaches within the timeout, setup throws rather than quietly
 * starting anyway and reproducing the race it was added to remove.
 */
/** The global a playtest runner sets before the page loads, so a game can tell one is coming. */
export const PLAYTEST_RUNNER_EXPECTED_GLOBAL = "__THREENATIVE_PLAYTEST_RUNNER_EXPECTED__";

/**
 * Hold when told to, and by default whenever a browser or native runner announced itself.
 *
 * Without it a scenario races the boot, and how much simulation elapses before the first
 * observation depends on how fast the machine renders — measured on action-rpg's combat
 * scenario, player health 90 on SwiftShader and 95 on a real GPU from the same build. Keyed off
 * the runner rather than off the plugin being installed, because every template installs
 * `playtest()` unconditionally and a game that holds for a runner who never arrives is broken
 * for whoever ran `pnpm dev`. Browser runners set the expected global before navigation; native
 * hosts expose `TN_PLAYTEST_ENDPOINT` when a device/desktop transport is attached.
 */
function shouldHoldUntilAttached(options: IPlaytestOptions): boolean {
  if (options.holdUntilAttached !== undefined) return options.holdUntilAttached;
  const host = globalThis as Record<string, unknown>;
  return host[PLAYTEST_RUNNER_EXPECTED_GLOBAL] === true || host.TN_PLAYTEST_ENDPOINT !== undefined;
}

function holdUntilAttached(
  bridge: IPlaytestBridgeV1,
  options: IPlaytestOptions,
  startSceneEntered: () => Promise<void> | undefined,
): Promise<void> | undefined {
  if (!shouldHoldUntilAttached(options)) return undefined;
  const timeoutMs = options.attachTimeoutMs ?? PLAYTEST_ATTACH_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`TN_PLAYTEST_ATTACH_TIMEOUT_INVALID: ${String(options.attachTimeoutMs)}`);
  }
  const describe = bridge.describe;
  const applySetup = bridge.applySetup;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(
        new Error(
          `TN_PLAYTEST_ATTACH_TIMEOUT: no playtest runner applied setup or called describe() within ${timeoutMs}ms.`,
        ),
      );
    }, timeoutMs);
    // Node keeps the process alive for a pending timer; a held game must not outlive its host.
    (timer as unknown as { unref?: () => void }).unref?.();
    const release = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    if (applySetup !== undefined) {
      bridge.applySetup = async (request) => {
        try {
          await applySetup(request);
          release();
        } catch (error) {
          fail(error);
          throw error;
        }
      };
    }
    bridge.describe = async () => {
      release();
      await startSceneEntered();
      return describe();
    };
  });
}

export interface IPlaytestOptions {
  readonly events?: () => JsonValue[];
  /**
   * Hold start-scene entry until a runner attaches. Defaults on for an announced runner.
   */
  readonly holdUntilAttached?: boolean;
  /** Milliseconds to wait when `holdUntilAttached` is set. Default {@link PLAYTEST_ATTACH_TIMEOUT_MS}. */
  readonly attachTimeoutMs?: number;
}

function installRuntimeChannels(
  bridge: IPlaytestBridgeV1,
  runtime: IGamePluginRuntime | undefined,
): void {
  const describe = bridge.describe;
  bridge.describe = () =>
    Promise.resolve(describe()).then((description) =>
      addRuntimeCapabilities(description, runtime?.observations.contributions() ?? []),
    );
  const sample = bridge.sample;
  bridge.sample = (request) =>
    Promise.resolve(sample(request)).then((snapshot) =>
      addRuntimeObservations(snapshot, request, runtime?.observations.contributions() ?? []),
    );
}
function addRuntimeCapabilities(
  description: IPlaytestBridgeDescription,
  contributions: readonly IGameObservationContribution[],
): IPlaytestBridgeDescription {
  const capabilities = [...description.capabilities];
  const contributed = contributions.flatMap(({ capabilities }) => capabilities);
  for (const capability of ["runtime.audio", "runtime.world", ...contributed]) {
    if (!capabilities.includes(capability)) capabilities.push(capability);
  }
  return { ...description, capabilities };
}
function addRuntimeObservations(
  snapshot: IPlaytestObservationSnapshot,
  request: IPlaytestSampleRequest,
  contributions: readonly IGameObservationContribution[],
): IPlaytestObservationSnapshot {
  const result: Record<string, unknown> = { ...snapshot };
  for (const contribution of contributions) {
    const slice = contribution.sample(request);
    if (typeof slice !== "object" || slice === null || Array.isArray(slice)) {
      throw new TypeError("A runtime observation contribution must return a top-level object.");
    }
    assertJsonSafe(slice, "$.runtimeContribution");
    for (const [key, value] of Object.entries(slice)) {
      if (Object.hasOwn(result, key)) {
        throw new Error(
          `TN_PLAYTEST_OBSERVATION_COLLISION: top-level key '${key}' already exists.`,
        );
      }
      result[key] = value;
    }
  }
  return result as unknown as IPlaytestObservationSnapshot;
}
function runtimeObservation(
  seed: number | null,
  replayRuntime: IPlaytestWorldObservation["runtime"],
): { audio: ReturnType<typeof audioRuntimeSnapshot>; world: IPlaytestWorldObservation } {
  return {
    audio: audioRuntimeSnapshot(),
    world: {
      seed,
      ...(replayRuntime === undefined ? {} : { runtime: replayRuntime }),
    },
  };
}
function bridgeEntities<TState extends Record<string, unknown>, TPhysics>(
  ctx: ICtx<TState, TPhysics>,
): IThreePlaytestEntity[] {
  return [
    { id: "camera.main", object: ctx.camera },
    ...Object.keys(ctx.entities.snapshot()).flatMap((id) => {
      const object = entityObject(ctx.entities.get(id));
      return object === undefined ? [] : [{ id, object }];
    }),
  ];
}
function entityObject(entity: object | undefined): ThreeObject3D | undefined {
  if (entity instanceof Object3D) return entity;
  const candidate =
    (entity as { mesh?: unknown; object?: unknown } | undefined)?.mesh ??
    (entity as { mesh?: unknown; object?: unknown } | undefined)?.object;
  return candidate instanceof Object3D ? candidate : undefined;
}
function gameplayObservations<TState extends Record<string, unknown>, TPhysics>(
  ctx: ICtx<TState, TPhysics>,
  contactHistory: IPlaytestContactObservation[],
  seed: number | null,
  replayRuntime: IPlaytestWorldObservation["runtime"],
): IPlaytestGameplayObservation {
  const animation: IPlaytestGameplayObservation["animation"] = {};
  const states: IPlaytestGameplayObservation["states"] = {};
  const snapshot = ctx.entities.snapshot();
  for (const id of Object.keys(snapshot)) {
    const entity = ctx.entities.get(id) as
      | {
          animation?: {
            advancedFrames?: unknown;
            current?: unknown;
            finished?: unknown;
            stride?: unknown;
          };
          state?: unknown;
        }
      | undefined;
    const finished =
      typeof entity?.animation?.finished === "boolean" ? entity.animation.finished : undefined;
    if (
      typeof entity?.animation?.current === "string" &&
      typeof entity.animation.advancedFrames === "number"
    ) {
      const stride = strideObservation(entity.animation.stride);
      animation[id] = {
        advancedFrames: entity.animation.advancedFrames,
        clip: entity.animation.current,
        ...(finished === undefined ? {} : { finished }),
        ...(stride === undefined ? {} : { stride }),
      };
    }
    if (typeof entity?.state === "string") states[id] = entity.state;
  }
  const channels = gameplayChannels(ctx);
  const contacts = channels.includes("runtime.contacts")
    ? drainContacts(ctx, contactHistory)
    : undefined;
  const tags = channels.includes("runtime.tags") ? tagCounts(snapshot) : undefined;
  return {
    animation,
    ...(contacts === undefined ? {} : { contacts }),
    states,
    ...(tags === undefined ? {} : { tags }),
    ...runtimeObservation(seed, replayRuntime),
  };
}
/**
 * Read an animation player's stride report, or report nothing.
 *
 * A partially shaped report is dropped whole rather than filled in: a stride number the producer
 * did not measure would be read downstream as a measurement, and the one thing this harness may
 * never do is hand back an unmeasured zero. `strideSync: false` still reports — that is the
 * override being honest about what it turned off.
 */
function strideObservation(value: unknown): IPlaytestStrideObservation | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const report = value as Record<string, unknown>;
  const numbers = ["clipGroundSpeed", "groundSpeed", "rate"] as const;
  const flags = ["overridden", "synced"] as const;
  if (!numbers.every((key) => typeof report[key] === "number" && Number.isFinite(report[key])))
    return undefined;
  if (!flags.every((key) => typeof report[key] === "boolean")) return undefined;
  return {
    clipGroundSpeed: report.clipGroundSpeed as number,
    groundSpeed: report.groundSpeed as number,
    overridden: report.overridden as boolean,
    rate: report.rate as number,
    synced: report.synced as boolean,
  };
}

type GameplayChannel = "runtime.contacts" | "runtime.tags";
interface IContactEvent {
  readonly body: object;
  readonly entity?: string;
  readonly started: boolean;
}
interface IContactSource {
  drainContacts(): readonly IContactEvent[];
}

function gameplayChannels<TState extends Record<string, unknown>, TPhysics>(
  _ctx: ICtx<TState, TPhysics>,
): GameplayChannel[] {
  return ["runtime.contacts", "runtime.tags"];
}
function drainContacts<TState extends Record<string, unknown>, TPhysics>(
  ctx: ICtx<TState, TPhysics>,
  history: IPlaytestContactObservation[],
): IPlaytestContactObservation[] {
  // One snapshot and one value→id index per drain: findEntityId rebuilt both per contact event,
  // O(n*c) field extractions on every runner sample. First id wins per value, matching the
  // insertion-order find it replaced.
  const snapshot = ctx.entities.snapshot();
  const idsByEntity = new Map<object, string>();
  for (const id of Object.keys(snapshot)) {
    const registered = ctx.entities.get(id) as Record<string, unknown> | undefined;
    if (registered === undefined) continue;
    for (const value of objectGraphValues(registered))
      if (!idsByEntity.has(value)) idsByEntity.set(value, id);
  }
  for (const id of Object.keys(snapshot)) {
    for (const source of entitySources(ctx.entities.get(id))) {
      for (const event of source.drainContacts()) {
        const entity = idsByEntity.get(event.body);
        if (entity === undefined || event.entity === undefined) continue;
        history.push({
          entity,
          kind: event.started ? "trigger" : "trigger.exit",
          with: event.entity,
        });
        if (history.length > PLAYTEST_PROTOCOL_LIMITS.maxEventsPerDrain) history.shift();
      }
    }
  }
  return [...history];
}
function entitySources(entity: object | undefined): IContactSource[] {
  return objectGraphValues(entity).filter(
    (value): value is IContactSource =>
      "drainContacts" in value &&
      typeof (value as { drainContacts?: unknown }).drainContacts === "function",
  );
}

/** Walk registered fields far enough to reach the physics adapter without traversing Three's graph. */
function objectGraphValues(root: object | undefined): object[] {
  if (root === undefined) return [];
  const values: object[] = [];
  const visited = new Set<object>();
  const visit = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    values.push(value);
    if (depth >= 4 || value instanceof Object3D) return;
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(root, 0);
  return values;
}

function tagCounts(snapshot: EntitySnapshot): Record<string, { count: number }> {
  const counts: Record<string, { count: number }> = {};
  for (const fields of Object.values(snapshot)) {
    for (const tag of fields.tags ?? []) counts[tag] = { count: (counts[tag]?.count ?? 0) + 1 };
  }
  return counts;
}

function componentObservations(
  snapshot: EntitySnapshot,
): Record<string, Record<string, JsonValue>> {
  const components: Record<string, Record<string, JsonValue>> = {};
  for (const [id, fields] of Object.entries(snapshot)) {
    if (Object.keys(fields).length === 0) continue;
    assertJsonSafe(fields, `$.components.${id}`);
    components[id] = fields as Record<string, JsonValue>;
  }
  return components;
}

function stateResources<TState extends Record<string, unknown>, TPhysics>(
  ctx: ICtx<TState, TPhysics>,
) {
  return {
    read: () => {
      ctx.state.flush();
      const state = ctx.state.getState();
      assertJsonSafe(state);
      // A bridge sample is an observation, not a live view. The store's current object is
      // mutated in place by later patches and scene resets; returning it directly makes an
      // earlier `before` sample change when a menu navigates to the next scene.
      const value = cloneJsonValue(state) as Record<string, JsonValue>;
      return Object.fromEntries([
        // `state` is canonical. Keep `GameState` as a compatibility alias until published
        // scenarios have migrated, then remove the alias in a future breaking release.
        ["state", value],
        ["GameState", value],
      ]);
    },
  };
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((item) => cloneJsonValue(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]),
    );
  }
  return value;
}
