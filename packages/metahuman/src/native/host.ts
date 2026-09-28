/**
 * The native MetaHuman resident, and the one fail-closed door into it.
 *
 * Shape of the object the C++ host installs on `globalThis.__THREENATIVE_NATIVE__.metahuman`
 * (`packages/runtime-native/src/metahuman/native_bindings.cpp`). It mirrors
 * `packages/physics/src/native/host.ts` exactly: a raw host object typed here, validated here,
 * and a single accessor that throws a named code when the runtime did not install it.
 */
export interface INativeMetaHumanHost {
  /** `tn_metahuman/1 OpenRigLogic <40-hex revision>` — the backend and the pin it was built from. */
  readonly version: string;
  create(dna: ArrayBuffer | Uint8Array): number;
  count(id: number, kind: number): number;
  name(id: number, kind: number, index: number): string;
  setLod(id: number, lod: number): void;
  setGui(id: number, values: Float32Array): void;
  setRaw(id: number, values: Float32Array): void;
  evaluate(id: number, useGui: boolean): void;
  jointOutputs(id: number): Float32Array;
  blendShapeOutputs(id: number): Float32Array;
  animatedMapOutputs(id: number): Float32Array;
  neutralJoints(id: number): Float32Array;
  destroy(id: number): void;
  lastError(): string;
}

/**
 * The one `__THREENATIVE_NATIVE__` global declaration belongs to `@threenative/physics`
 * (`src/native/host.ts`), which owns the global; `metahuman` is declared there beside
 * `physics`. This package must not declare the global a second time, so the optional resident
 * is read through a narrow structural view of the same shape.
 */
function nativeGlobal(): { readonly metahuman?: INativeMetaHumanHost } | undefined {
  return (
    globalThis as typeof globalThis & {
      readonly __THREENATIVE_NATIVE__?: { readonly metahuman?: INativeMetaHumanHost };
    }
  ).__THREENATIVE_NATIVE__;
}

/**
 * The installed host, or a rejection naming the missing capability.
 *
 * A native build without `TN_ENABLE_METAHUMAN` has no metahuman resident. That is a build the
 * game cannot run on, so it says so; it never falls back to the WASM module, which is not in
 * the native bundle at all.
 */
export function nativeMetaHumanHost(): INativeMetaHumanHost {
  const host = nativeGlobal()?.metahuman;
  if (host === undefined || typeof host.version !== "string" || typeof host.create !== "function")
    throw new Error("TN_NATIVE_METAHUMAN_MISSING: runtime did not install the metahuman ABI");
  return host;
}
