import {
  type IPlaytestBridgeDescription,
  type IPlaytestBridgeV1,
  type IPlaytestContactObservation,
  type IPlaytestGameplayObservation,
  type IPlaytestWorldObservation,
  type JsonValue,
  PLAYTEST_PROTOCOL_LIMITS,
  assertJsonSafe,
} from "@threenative/playtest";
import { type IThreePlaytestEntity, installThreePlaytestBridge } from "@threenative/playtest/three";
import { Object3D, type Object3D as ThreeObject3D, type Vector2 } from "three";
import { audioRuntimeSnapshot } from "./audio.js";
import type { EntitySnapshot } from "./entities.js";
import type { GamePluginHooks, GamePluginRuntime } from "./game.js";
import type { Ctx } from "./scene.js";

const CORE_VERSION = "0.1.0";
const currentAgent = typeof navigator === "undefined" ? "node" : navigator.userAgent;

export function playtest<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
>(options: PlaytestOptions = {}): GamePluginHooks<TState, TPhysics> {
  let dispose: (() => void) | undefined;
  let contactHistory: IPlaytestContactObservation[] = [];
  return {
    setup: (ctx, runtime) => {
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
        ...(options.events === undefined ? {} : { events: options.events }),
        gameplay: () => gameplayObservations(ctx, contactHistory, seed, replayRuntime),
        gameplayChannels: () => gameplayChannels(ctx),
        renderer: ctx.renderer.raw as { getDrawingBufferSize(target: Vector2): Vector2 },
        resources: stateResources(ctx),
        scene: ctx.scene,
      });
      installRuntimeChannels(installation.bridge);
      dispose = installation.dispose;
      return () => {
        dispose?.();
        dispose = undefined;
        contactHistory = [];
      };
    },
  };
}
export interface PlaytestOptions {
  readonly events?: () => JsonValue[];
}

function installRuntimeChannels(bridge: IPlaytestBridgeV1): void {
  const describe = bridge.describe;
  bridge.describe = () =>
    Promise.resolve(describe()).then((description) => addRuntimeCapabilities(description));
}
function addRuntimeCapabilities(
  description: IPlaytestBridgeDescription,
): IPlaytestBridgeDescription {
  const capabilities = [...description.capabilities];
  for (const capability of ["runtime.audio", "runtime.world"] as const) {
    if (!capabilities.includes(capability)) capabilities.push(capability);
  }
  return { ...description, capabilities };
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
  ctx: Ctx<TState, TPhysics>,
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
  ctx: Ctx<TState, TPhysics>,
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
interface ContactEvent {
  readonly body: object;
  readonly entity?: string;
  readonly started: boolean;
}
interface ContactSource {
  drainContacts(): readonly ContactEvent[];
}

function gameplayChannels<TState extends Record<string, unknown>, TPhysics>(
  _ctx: Ctx<TState, TPhysics>,
): GameplayChannel[] {
  return ["runtime.contacts", "runtime.tags"];
}
function drainContacts<TState extends Record<string, unknown>, TPhysics>(
  ctx: Ctx<TState, TPhysics>,
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
function entitySources(entity: object | undefined): ContactSource[] {
  if (entity === undefined) return [];
  return Object.values(entity).filter(
    (value): value is ContactSource =>
      typeof value === "object" &&
      value !== null &&
      "drainContacts" in value &&
      typeof (value as { drainContacts?: unknown }).drainContacts === "function",
  );
}
function findEntityId<TState extends Record<string, unknown>, TPhysics>(
  ctx: Ctx<TState, TPhysics>,
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
  ctx: Ctx<TState, TPhysics>,
) {
  return {
    read: () => {
      ctx.state.flush();
      const state = ctx.state.getState();
      assertJsonSafe(state);
      const value = state as Record<string, JsonValue>;
      return { GameState: value, state: value };
    },
  };
}
