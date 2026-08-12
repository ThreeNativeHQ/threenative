import {
  type IPlaytestBridgeDescription,
  type IPlaytestBridgeV1,
  type IPlaytestContactObservation,
  type IPlaytestGameplayObservation,
  type IPlaytestObservationSnapshot,
  type IPlaytestSampleRequest,
  type IPlaytestWorldObservation,
  type JsonValue,
  PLAYTEST_PROTOCOL_LIMITS,
  assertJsonSafe,
} from "@threenative/playtest";
import { type IThreePlaytestEntity, installThreePlaytestBridge } from "@threenative/playtest/three";
import { Object3D, type Object3D as ThreeObject3D, type Vector2 } from "three";
import { audioRuntimeSnapshot } from "./audio.js";
import type { EntitySnapshot } from "./entities.js";
import type { IGameObservationContribution, IGamePluginHooks, IGamePluginRuntime } from "./game.js";
import type { ICtx } from "./scene.js";

const CORE_VERSION = "0.1.0";
const currentAgent = typeof navigator === "undefined" ? "node" : navigator.userAgent;

export function playtest<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
>(options: IPlaytestOptions = {}): IGamePluginHooks<TState, TPhysics> {
  let dispose: (() => void) | undefined;
  let attached: Promise<void> | undefined;
  let contactHistory: IPlaytestContactObservation[] = [];
  return {
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
        resources: stateResources(ctx),
        scene: ctx.scene,
      });
      installRuntimeChannels(installation.bridge, runtime);
      dispose = installation.dispose;
      attached = holdUntilAttached(installation.bridge, options);
      const cleanup = () => {
        dispose?.();
        dispose = undefined;
        attached = undefined;
        contactHistory = [];
      };
      // IGame.start() awaits plugin setup and only calls gameLoop.start() afterwards, so
      // awaiting here holds the entire loop -- including the physics plugin's first
      // simulation step -- until the runner is on the line.
      // A provider used with this option must be ordered before playtest(), because sequential
      // plugin setup deliberately stops here until the runner attaches.
      if (attached !== undefined) {
        try {
          await attached;
        } catch (error) {
          cleanup();
          throw error;
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
function holdUntilAttached(
  bridge: IPlaytestBridgeV1,
  options: IPlaytestOptions,
): Promise<void> | undefined {
  if (options.holdUntilAttached !== true) return undefined;
  const timeoutMs = options.attachTimeoutMs ?? PLAYTEST_ATTACH_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`TN_PLAYTEST_ATTACH_TIMEOUT_INVALID: ${String(options.attachTimeoutMs)}`);
  }
  const describe = bridge.describe;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `TN_PLAYTEST_ATTACH_TIMEOUT: no playtest runner called describe() within ${timeoutMs}ms.`,
        ),
      );
    }, timeoutMs);
    // Node keeps the process alive for a pending timer; a held game must not outlive its host.
    (timer as unknown as { unref?: () => void }).unref?.();
    bridge.describe = () => {
      clearTimeout(timer);
      resolve();
      return describe();
    };
  });
}

export interface IPlaytestOptions {
  readonly events?: () => JsonValue[];
  /**
   * Hold the frame loop until a runner attaches. Default false.
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
          animation?: { advancedFrames?: unknown; current?: unknown };
          state?: unknown;
        }
      | undefined;
    if (
      typeof entity?.animation?.current === "string" &&
      typeof entity.animation.advancedFrames === "number"
    ) {
      animation[id] = {
        advancedFrames: entity.animation.advancedFrames,
        clip: entity.animation.current,
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
  for (const id of Object.keys(ctx.entities.snapshot())) {
    for (const source of entitySources(ctx.entities.get(id))) {
      for (const event of source.drainContacts()) {
        const entity = findEntityId(ctx, event.body);
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
  if (entity === undefined) return [];
  return Object.values(entity).filter(
    (value): value is IContactSource =>
      typeof value === "object" &&
      value !== null &&
      "drainContacts" in value &&
      typeof (value as { drainContacts?: unknown }).drainContacts === "function",
  );
}
function findEntityId<TState extends Record<string, unknown>, TPhysics>(
  ctx: ICtx<TState, TPhysics>,
  target: object,
): string | undefined {
  return Object.keys(ctx.entities.snapshot()).find((id) => {
    const entity = ctx.entities.get(id) as Record<string, unknown> | undefined;
    return entity !== undefined && Object.values(entity).some((value) => value === target);
  });
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
      const value = state as Record<string, JsonValue>;
      return Object.fromEntries([
        ["GameState", value],
        ["state", value],
      ]);
    },
  };
}
