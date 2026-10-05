// Native-only hooks for the qualification cases (PRD-506): what a host does between frames, and what
// a renderer does before a draw, for programs that link the engine without a renderer. Imported as
// "three-aot", never as "three", so the reference build never sees it.
import type { Object3D } from "three";

declare function tnx_safe_point(): void;
declare function tnx_collect(): void;
declare function tnx_live(): i32;
declare function tnx_fire_before_render(slot: i32): string;
declare function tnx_resident_kb(): i32;

/** The callback safe point: holds attached callback-bearing objects, lets detached ones go. */
export function safePoint(): void {
  tnx_safe_point();
}

/** A full collection, so unreachable wrappers are finalized and their engine objects released. */
export function collectGarbage(): void {
  tnx_collect();
}

/** Engine objects this program holds. */
export function liveEngineObjects(): number {
  return tnx_live();
}

/** Runs the object's onBeforeRender through the engine, as its renderer does before a draw. */
export function fireBeforeRender(object: Object3D): string {
  return tnx_fire_before_render(object.slot);
}

/** The process's resident set in KiB (Linux); -1 when unreadable. */
export function residentKilobytes(): number {
  return tnx_resident_kb();
}
