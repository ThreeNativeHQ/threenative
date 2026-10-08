// Native-only hooks for the qualification cases (PRD-506, decision 11): what a host does between
// frames, and what a renderer does before a draw, for programs that link the engine without a
// renderer. Imported as "three-aot", never as "three", so the reference build never sees it.
import type { Object3D } from "three";
import { releaseUnreferenced } from "three";
import * as adapter from "tn-three-adapter";

/** The callback safe point: holds attached callback-bearing objects, lets detached ones go. */
export function safePoint(): void {
  adapter.safePoint();
}

/**
 * A host's between-frames point: releases the engine objects of wrappers the program no longer
 * holds, then collects. The wrapper table lives in the facade, so this is what brings the engine's
 * object count back to its baseline after a scene load/unload or a UI mount/dispose.
 */
export function collectGarbage(): void {
  releaseUnreferenced();
  adapter.collect();
}

/** Engine objects this program holds. */
export function liveEngineObjects(): number {
  return adapter.live();
}

/** Runs the object's onBeforeRender through the engine, as its renderer does before a draw. */
export function fireBeforeRender(object: Object3D): string {
  return adapter.runBeforeRender(object.slot);
}

/** The process's resident set in KiB (Linux); -1 when unreadable. */
export function residentKilobytes(): number {
  return adapter.residentKb();
}

/** The benchmark session of the native-AOT driver (PRD-533): the engine, a renderer and the meters. */
export function benchOpen(
  scene: { slot: number },
  camera: { slot: number },
  width: number,
  height: number,
): void {
  const error = adapter.bench("open", scene.slot, camera.slot, width, height);
  if (error !== "") throw error;
}

export function benchBegin(frame: number, warmup: number): void {
  const error = adapter.bench("begin", frame, warmup, 0, 0);
  if (error !== "") throw error;
}

export function benchRender(): void {
  const error = adapter.bench("render", 0, 0, 0, 0);
  if (error !== "") throw error;
}

/** Writes the report to the file named by TN_BENCH_REPORT. */
export function benchFinish(): void {
  const error = adapter.bench("finish", 0, 0, 0, 0);
  if (error !== "") throw error;
}

/** One setting from the environment: TN_BENCH_OBJECTS, _FRAMES, _WARMUP, _WIDTH or _HEIGHT. */
export function benchSetting(name: string): number {
  return adapter.benchConfig(name);
}
