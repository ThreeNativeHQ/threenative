/// <reference path="./import-meta.d.ts" />

import { audioRuntimeSnapshot } from "./audio.js";
import type { Game } from "./game.js";
export interface HotDiagnostics {
  readonly reloads: number;
  readonly entities: number;
  readonly sceneObjects: number;
  readonly canvases: number;
  readonly audio: ReturnType<typeof audioRuntimeSnapshot>;
  readonly physics: number | null;
}
type HotData = { readonly state: Record<string, unknown>; readonly reloads: number };
const isDev = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;
export function assertPortableState(state: unknown): void {
  visitPortable(state, "state", new Set<object>());
}
export function acceptHotUpdate<TState extends Record<string, unknown>, TPhysics>(
  game: Game<TState, TPhysics>,
  hot: ImportMeta["hot"],
): void {
  if (hot === undefined) return;
  const carried = hot.data.threenative as HotData | undefined;
  const reloads = carried?.reloads ?? 0;
  if (carried !== undefined) restoreState(game, carried.state);
  if (isDev && typeof window !== "undefined") {
    const host = window as unknown as {
      __THREENATIVE__?: Record<string, unknown> & { hot?: () => HotDiagnostics };
    };
    host.__THREENATIVE__ = {
      ...host.__THREENATIVE__,
      hot: () => diagnostics(game, reloads),
      snapshot: host.__THREENATIVE__?.snapshot ?? (() => ({})),
    };
  }
  let disposed = false;
  hot.dispose((data) => {
    if (disposed) return;
    disposed = true;
    try {
      game.state.flush();
      const state = game.state.getState();
      assertPortableState(state);
      data.threenative = { reloads: reloads + 1, state };
    } catch (error) {
      data.threenative = undefined;
      hot.invalidate(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      game.stop();
    }
  });
}
function restoreState<TState extends Record<string, unknown>, TPhysics>(
  game: Game<TState, TPhysics>,
  carried: Record<string, unknown>,
): void {
  assertPortableState(carried);
  const defaults = game.state.getState();
  const state: Record<string, unknown> = { ...defaults };
  const dropped = Object.keys(carried).filter((key) => !(key in defaults));
  const added = Object.keys(defaults).filter((key) => !(key in carried));
  for (const key of Object.keys(defaults)) {
    if (key in carried) state[key] = carried[key];
  }
  game.state.setState(state as TState);
  if (dropped.length > 0 || added.length > 0)
    console.info(
      `ThreeNative hot reload state shape: dropped [${dropped.join(", ")}]; added [${added.join(", ")}]`,
    );
}
function diagnostics<TState extends Record<string, unknown>, TPhysics>(
  game: Game<TState, TPhysics>,
  reloads: number,
): HotDiagnostics {
  const ctx = game.ctx;
  let sceneObjects = 0;
  ctx?.scene.traverse(() => {
    sceneObjects += 1;
  });
  const physics = ctx?.physics as { numBodies?: unknown } | undefined;
  return {
    reloads,
    entities: ctx === undefined ? 0 : Object.keys(ctx.entities.snapshot()).length,
    sceneObjects,
    canvases: typeof document === "undefined" ? 0 : document.querySelectorAll("canvas").length,
    audio: audioRuntimeSnapshot(),
    physics: typeof physics?.numBodies === "function" ? physics.numBodies() : null,
  };
}
function visitPortable(value: unknown, path: string, ancestors: Set<object>): void {
  if (value === null) return;
  if (typeof value === "string" || typeof value === "boolean") return;
  if (typeof value !== "object") {
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value === "number")
      throw new Error(`Hot reload state ${path} must contain only finite numbers.`);
    throw new Error(`Hot reload state ${path} must contain only JSON-shaped values.`);
  }
  if (ancestors.has(value)) throw new Error(`Hot reload state ${path} contains a cycle.`);
  if (Array.isArray(value)) {
    ancestors.add(value);
    for (let index = 0; index < value.length; index += 1)
      visitPortable(value[index], `${path}[${index}]`, ancestors);
    ancestors.delete(value);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error(`Hot reload state ${path} must contain only plain objects.`);
  ancestors.add(value);
  for (const key of Object.keys(value))
    visitPortable((value as Record<string, unknown>)[key], `${path}.${key}`, ancestors);
  ancestors.delete(value);
}
