import { MetaHumanAssetError } from "../errors.js";
import type { IRigEvaluator, IRigEvaluatorCounts, RigEvaluatorKind } from "../wasm-evaluator.js";
import { type INativeMetaHumanHost, nativeMetaHumanHost } from "./host.js";

/**
 * The wire kinds in `cpp/tn_riglogic.h`, the same six values `KIND_SELECTORS` maps in
 * `src/wasm-evaluator.ts`. Duplicated rather than imported because that module resolves the
 * WASM URLs at module scope, and a value import from it would drag the browser binary into a
 * native bundle that must never carry it. The C++ contract test
 * (`threenative-metahuman-bindings-test`) is what proves the two stay the same selectors.
 */
const KIND_SELECTORS: Readonly<Record<RigEvaluatorKind, number>> = {
  gui: 0,
  raw: 1,
  joint: 2,
  blendShape: 3,
  animatedMap: 4,
  lod: 5,
};

/**
 * One rig instance over the C++ OpenRigLogic build the native host compiled.
 *
 * The same `packages/metahuman/cpp` ABI the browser WASM module exports, so this class and
 * `RigEvaluator` are interchangeable: the checks, the error codes and the copied outputs are
 * identical, and only the crossing differs.
 */
export class NativeRigEvaluator implements IRigEvaluator {
  readonly #host: INativeMetaHumanHost;
  readonly #handle: number;
  #disposed = false;

  private constructor(host: INativeMetaHumanHost, dna: ArrayBuffer | Uint8Array) {
    this.#host = host;
    this.#handle = host.create(dna);
  }

  /** Parse a DNA blob. The host copies the bytes, so the caller keeps its buffer. */
  static create(dna: ArrayBuffer | Uint8Array, host: INativeMetaHumanHost = nativeMetaHumanHost()) {
    if (dna instanceof Uint8Array ? dna.length === 0 : dna.byteLength === 0)
      throw new MetaHumanAssetError("TN_MH_LENGTH", "dna must be a non-empty buffer");
    return new NativeRigEvaluator(host, dna);
  }

  /** The backend and pinned OpenRigLogic revision the host was built from. */
  backend(): string {
    return this.#live().version;
  }

  /**
   * Live evaluator handles in the host process, across every instance of this class.
   *
   * The count a create/dispose cycle must return to, read from the ABI's own registry.
   */
  static liveHandleCount(host: INativeMetaHumanHost = nativeMetaHumanHost()): number {
    return host.liveCount();
  }

  #live(): INativeMetaHumanHost {
    if (this.#disposed)
      throw new MetaHumanAssetError("TN_MH_DISPOSED", "the evaluator is disposed");
    return this.#host;
  }

  #count(kind: RigEvaluatorKind): number {
    return this.#live().count(this.#handle, KIND_SELECTORS[kind]);
  }

  counts(): IRigEvaluatorCounts {
    return Object.freeze({
      gui: this.#count("gui"),
      raw: this.#count("raw"),
      joints: this.#count("joint"),
      blendShapes: this.#count("blendShape"),
      animatedMaps: this.#count("animatedMap"),
      lodCount: this.#count("lod"),
    });
  }

  names(kind: RigEvaluatorKind): readonly string[] {
    const host = this.#live();
    const count = this.#count(kind);
    const names: string[] = [];
    for (let index = 0; index < count; index += 1)
      names.push(host.name(this.#handle, KIND_SELECTORS[kind], index));
    return Object.freeze(names);
  }

  setLod(lod: number): void {
    if (!Number.isInteger(lod) || lod < 0 || lod >= this.#count("lod"))
      throw new MetaHumanAssetError("TN_MH_INDEX_RANGE", `lod ${lod} is outside this rig`);
    this.#live().setLod(this.#handle, lod);
  }

  setGuiControls(values: Float32Array): void {
    this.#setControls("gui", values);
  }

  setRawControls(values: Float32Array): void {
    this.#setControls("raw", values);
  }

  #setControls(kind: "gui" | "raw", values: Float32Array): void {
    const host = this.#live();
    const expected = this.#count(kind);
    if (values.length !== expected)
      throw new MetaHumanAssetError(
        "TN_MH_LENGTH",
        `${kind} controls need ${expected} values, got ${values.length}`,
      );
    for (let index = 0; index < values.length; index += 1) {
      if (!Number.isFinite(values[index] as number))
        throw new MetaHumanAssetError("TN_MH_NON_FINITE", `${kind} control ${index} is not finite`);
    }
    if (kind === "gui") host.setGui(this.#handle, values);
    else host.setRaw(this.#handle, values);
  }

  evaluate(useGui: boolean): void {
    this.#live().evaluate(this.#handle, useGui);
  }

  jointOutputs(): Float32Array {
    return this.#live().jointOutputs(this.#handle);
  }

  blendShapeOutputs(): Float32Array {
    return this.#live().blendShapeOutputs(this.#handle);
  }

  animatedMapOutputs(): Float32Array {
    return this.#live().animatedMapOutputs(this.#handle);
  }

  neutralJoints(): Float32Array {
    return this.#live().neutralJoints(this.#handle);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#host.destroy(this.#handle);
  }
}
