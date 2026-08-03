import {
  type IPlaytestContactObservation,
  type IPlaytestGameplayObservation,
  type JsonValue,
  PLAYTEST_PROTOCOL_LIMITS,
  assertJsonSafe,
} from "@threenative/playtest";
import { type IThreePlaytestEntity, installThreePlaytestBridge } from "@threenative/playtest/three";
import { Object3D, type Object3D as ThreeObject3D, type Vector2 } from "three";
import type { EntitySnapshot } from "./entities.js";
import type { GamePluginHooks, GamePluginRuntime } from "./game.js";
import type { Ctx } from "./scene.js";

export function playtest<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
>(): GamePluginHooks<TState, TPhysics> {
  let dispose: (() => void) | undefined;
  let contactHistory: IPlaytestContactObservation[] = [];

  return {
    setup: (ctx, runtime) => {
      const diagnostics: JsonValue[] = [];
      const installation = installThreePlaytestBridge({
        camera: ctx.camera,
        diagnostics: () => [...diagnostics],
        entities: () => bridgeEntities(ctx),
        ...(runtime === undefined ? {} : { fixedStep: (ticks: number) => advance(runtime, ticks) }),
        gameplay: () => gameplayObservations(ctx, contactHistory),
        gameplayChannels: () => gameplayChannels(ctx),
        renderer: ctx.renderer.raw as { getDrawingBufferSize(target: Vector2): Vector2 },
        resources: stateResources(ctx),
        scene: ctx.scene,
      });
      dispose = installation.dispose;
      return () => {
        dispose?.();
        dispose = undefined;
        contactHistory = [];
      };
    },
  };
}

function advance(runtime: GamePluginRuntime, ticks: number): void {
  runtime.fixedStep(ticks);
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

function stateResources<TState extends Record<string, unknown>, TPhysics>(
  ctx: Ctx<TState, TPhysics>,
) {
  return {
    read: () => {
      ctx.state.flush();
      const state = ctx.state.getState();
      assertJsonSafe(state);
      return { GameState: state as Record<string, JsonValue> };
    },
  };
}
