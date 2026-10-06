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
