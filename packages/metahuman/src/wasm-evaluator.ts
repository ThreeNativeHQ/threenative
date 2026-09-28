import { MetaHumanAssetError, type MetaHumanErrorCode } from "./errors.js";

/** Selectors the ABI exposes. The values are the wire kinds in `cpp/tn_riglogic.h`. */
export type RigEvaluatorKind = "gui" | "raw" | "joint" | "blendShape" | "animatedMap" | "lod";

const KIND_SELECTORS: Readonly<Record<RigEvaluatorKind, number>> = {
  gui: 0,
  raw: 1,
  joint: 2,
  blendShape: 3,
  animatedMap: 4,
  lod: 5,
};

/** TN_RL_OK. Every other status is a rejection. */
const OK = 0;

/** Floats per joint, fixed by the ABI: translation, rotation quaternion, scale. */
export const JOINT_STRIDE = 10;

export interface IRigEvaluatorCounts {
  readonly gui: number;
  readonly raw: number;
  readonly joints: number;
  readonly blendShapes: number;
  readonly animatedMaps: number;
  readonly lodCount: number;
}

export interface IRigEvaluator {
  /** Item counts, or a rejection if this evaluator is disposed. */
  counts(): IRigEvaluatorCounts;
  names(kind: RigEvaluatorKind): readonly string[];
  setLod(lod: number): void;
  setGuiControls(values: Float32Array): void;
  setRawControls(values: Float32Array): void;
  /**
   * Calculate. With `useGui` the rig runs its own GUI-to-raw mapping first, so a caller
   * that set GUI controls does not re-derive Epic's mapping; without it the raw buffer is
   * used exactly as set.
   */
  evaluate(useGui: boolean): void;
  /** Joint deltas from neutral, `JOINT_STRIDE` floats per joint. A copy, never a view. */
  jointOutputs(): Float32Array;
  blendShapeOutputs(): Float32Array;
  animatedMapOutputs(): Float32Array;
  /** Neutral joint values in the same `JOINT_STRIDE` layout, for every LOD. */
  neutralJoints(): Float32Array;
  /** Idempotent. Every other call throws once this ran. */
  dispose(): void;
}

/** The slice of the Emscripten module this adapter uses. */
interface IRigLogicModule {
  HEAPF32: Float32Array;
  HEAPU8: Uint8Array;
  UTF8ToString(pointer: number): string;
  _free(pointer: number): void;
  _malloc(size: number): number;
  _tn_rl_animated_map_outputs(handle: number, countOut: number): number;
  _tn_rl_blendshape_outputs(handle: number, countOut: number): number;
  _tn_rl_count(handle: number, kind: number): number;
  _tn_rl_create(dna: number, length: number): number;
  _tn_rl_destroy(handle: number): void;
  _tn_rl_evaluate(handle: number, useGui: number): number;
  _tn_rl_joint_outputs(handle: number, countOut: number): number;
  _tn_rl_last_error(): number;
  _tn_rl_name(handle: number, kind: number, index: number): number;
  _tn_rl_neutral_joints(handle: number, countOut: number): number;
  _tn_rl_set_gui(handle: number, values: number, count: number): number;
  _tn_rl_set_lod(handle: number, lod: number): number;
  _tn_rl_set_raw(handle: number, values: number, count: number): number;
}

type RigLogicFactory = (options: {
  wasmBinary: Uint8Array;
}) => Promise<IRigLogicModule>;

// `dist/` and `src/` are both one level below the package root, so the same relative URLs
// resolve in the test run and in the published bundle. Nothing is fetched from a CDN.
const WASM_MODULE_URL = new URL("../wasm/riglogic.mjs", import.meta.url);
const WASM_BINARY_URL = new URL("../wasm/riglogic.wasm", import.meta.url);
const WASM_CHECKSUMS_URL = new URL("../wasm/checksums.json", import.meta.url);

const isNode = typeof process === "object" && process.versions?.node !== undefined;

async function readPackageBytes(url: URL): Promise<Uint8Array> {
  if (isNode) {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    return new Uint8Array(await readFile(fileURLToPath(url)));
  }
  const response = await fetch(url);
  if (!response.ok)
    throw new MetaHumanAssetError("TN_MH_WASM_LOAD", `${url.pathname} returned ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Load the module once per process, checksum verified.
 *
 * The binary is hashed and compared against the manifest that ships beside it before the
 * module is instantiated, so a substituted or half-written file fails instead of running.
 */
let modulePromise: Promise<IRigLogicModule> | undefined;

async function loadModule(): Promise<IRigLogicModule> {
  modulePromise ??= (async () => {
    const [binary, manifestBytes] = await Promise.all([
      readPackageBytes(WASM_BINARY_URL),
      readPackageBytes(WASM_CHECKSUMS_URL),
    ]);
    const expected = (
      JSON.parse(new TextDecoder().decode(manifestBytes)) as {
        files?: { "riglogic.wasm"?: unknown };
      }
    ).files?.["riglogic.wasm"];
    if (typeof expected !== "string")
      throw new MetaHumanAssetError(
        "TN_MH_WASM_CHECKSUM",
        "checksums.json has no riglogic.wasm hash",
      );
    const actual = await sha256Hex(binary);
    if (actual !== expected)
      throw new MetaHumanAssetError(
        "TN_MH_WASM_CHECKSUM",
        `riglogic.wasm sha256 ${actual} does not match the shipped ${expected}`,
      );
    const factory = (await import(WASM_MODULE_URL.href)) as { default: RigLogicFactory };
    return await factory.default({ wasmBinary: binary });
  })();
  return await modulePromise;
}

/**
 * One rig instance, over the checksum-verified browser WASM build of the shared ABI.
 *
 * Every crossing is checked in TypeScript first (length, finiteness) because the ABI only
 * discovers a bad buffer after it has already read it, and every returned array is a copy:
 * a `HEAPF32` view dies with the next memory growth.
 */
export class RigEvaluator implements IRigEvaluator {
  readonly #module: IRigLogicModule;
  readonly #handle: number;
  /** One reusable 4-byte count slot, so output reads allocate nothing per call. */
  readonly #countSlot: number;
  #disposed = false;

  private constructor(module: IRigLogicModule, dna: Uint8Array) {
    this.#module = module;
    const pointer = module._malloc(dna.length);
    if (pointer === 0)
      throw new MetaHumanAssetError("TN_MH_WASM_LOAD", "could not allocate a DNA buffer");
    let handle = 0;
    try {
      module.HEAPU8.set(dna, pointer);
      handle = module._tn_rl_create(pointer, dna.length);
      if (handle === 0)
        throw new MetaHumanAssetError(
          "TN_MH_ABI",
          module.UTF8ToString(module._tn_rl_last_error()) || "tn_rl_create failed",
        );
      this.#handle = handle;
    } finally {
      module._free(pointer);
    }
    this.#countSlot = module._malloc(4);
    if (this.#countSlot === 0) {
      module._tn_rl_destroy(handle);
      throw new MetaHumanAssetError("TN_MH_WASM_LOAD", "could not allocate a count slot");
    }
  }

  /** Parse a DNA blob. The bytes are copied by the ABI, so the caller keeps its buffer. */
  static async create(dnaBytes: Uint8Array): Promise<RigEvaluator> {
    if (!(dnaBytes instanceof Uint8Array) || dnaBytes.length === 0)
      throw new MetaHumanAssetError("TN_MH_LENGTH", "dna must be a non-empty Uint8Array");
    return new RigEvaluator(await loadModule(), dnaBytes);
  }

  /** The pinned OpenRigLogic commit the shipped binary was built from. */
  static async upstreamCommit(): Promise<string> {
    const manifest = JSON.parse(
      new TextDecoder().decode(await readPackageBytes(WASM_CHECKSUMS_URL)),
    ) as { openRigLogicCommit?: unknown };
    if (typeof manifest.openRigLogicCommit !== "string")
      throw new MetaHumanAssetError("TN_MH_WASM_LOAD", "checksums.json has no pinned commit");
    return manifest.openRigLogicCommit;
  }

  #live(): IRigLogicModule {
    if (this.#disposed)
      throw new MetaHumanAssetError("TN_MH_DISPOSED", "the evaluator is disposed");
    return this.#module;
  }

  #reject(status: number): void {
    if (status === OK) return;
    const message = this.#module.UTF8ToString(this.#module._tn_rl_last_error());
    throw new MetaHumanAssetError("TN_MH_ABI", message || `tn_rl status ${status}`);
  }

  #count(kind: RigEvaluatorKind): number {
    const count = this.#live()._tn_rl_count(this.#handle, KIND_SELECTORS[kind]);
    if (count < 0)
      throw new MetaHumanAssetError(
        "TN_MH_ABI",
        this.#module.UTF8ToString(this.#module._tn_rl_last_error()) ||
          `tn_rl_count(${kind}) failed`,
      );
    return count;
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
    const module = this.#live();
    const count = this.#count(kind);
    const names: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const pointer = module._tn_rl_name(this.#handle, KIND_SELECTORS[kind], index);
      if (pointer === 0)
        throw new MetaHumanAssetError("TN_MH_ABI", `tn_rl_name(${kind}, ${index}) failed`);
      names.push(module.UTF8ToString(pointer));
    }
    return Object.freeze(names);
  }

  setLod(lod: number): void {
    const module = this.#live();
    if (!Number.isInteger(lod) || lod < 0 || lod >= this.#count("lod"))
      throw new MetaHumanAssetError("TN_MH_INDEX_RANGE", `lod ${lod} is outside this rig`);
    this.#reject(module._tn_rl_set_lod(this.#handle, lod));
  }

  setGuiControls(values: Float32Array): void {
    this.#setControls("gui", values, (module, pointer) =>
      module._tn_rl_set_gui(this.#handle, pointer, values.length),
    );
  }

  setRawControls(values: Float32Array): void {
    this.#setControls("raw", values, (module, pointer) =>
      module._tn_rl_set_raw(this.#handle, pointer, values.length),
    );
  }

  #setControls(
    kind: "gui" | "raw",
    values: Float32Array,
    call: (module: IRigLogicModule, pointer: number) => number,
  ): void {
    const module = this.#live();
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
    const pointer = module._malloc(values.length * Float32Array.BYTES_PER_ELEMENT);
    if (pointer === 0)
      throw new MetaHumanAssetError("TN_MH_WASM_LOAD", "could not allocate a control buffer");
    try {
      module.HEAPF32.set(values, pointer >> 2);
      this.#reject(call(module, pointer));
    } finally {
      module._free(pointer);
    }
  }

  evaluate(useGui: boolean): void {
    this.#reject(this.#live()._tn_rl_evaluate(this.#handle, useGui ? 1 : 0));
  }

  #read(read: (module: IRigLogicModule) => number): Float32Array {
    const module = this.#live();
    // The getter writes the float count into our slot; every pointer is read from the
    // module object afterwards because a growth replaces the heap views.
    const pointer = read(module);
    if (pointer === 0)
      throw new MetaHumanAssetError("TN_MH_ABI", "the rig returned no output buffer");
    const count = new DataView(module.HEAPU8.buffer, this.#countSlot, 4).getUint32(0, true);
    return module.HEAPF32.slice(pointer >> 2, (pointer >> 2) + count);
  }

  jointOutputs(): Float32Array {
    return this.#read((module) => module._tn_rl_joint_outputs(this.#handle, this.#countSlot));
  }

  blendShapeOutputs(): Float32Array {
    return this.#read((module) => module._tn_rl_blendshape_outputs(this.#handle, this.#countSlot));
  }

  animatedMapOutputs(): Float32Array {
    return this.#read((module) =>
      module._tn_rl_animated_map_outputs(this.#handle, this.#countSlot),
    );
  }

  neutralJoints(): Float32Array {
    return this.#read((module) => module._tn_rl_neutral_joints(this.#handle, this.#countSlot));
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#module._tn_rl_destroy(this.#handle);
    this.#module._free(this.#countSlot);
  }
}

/** Every rejection the evaluator raises, for callers that narrow on `code`. */
export type RigEvaluatorErrorCode = Extract<
  MetaHumanErrorCode,
  `TN_MH_${"WASM_LOAD" | "WASM_CHECKSUM" | "ABI" | "LENGTH" | "NON_FINITE" | "INDEX_RANGE" | "DISPOSED"}`
>;
