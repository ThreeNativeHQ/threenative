import { type Camera, Frustum, Matrix4, Vector3, Vector4 } from "three";
import {
  Fn,
  If,
  Loop,
  Return,
  atomicAdd,
  float,
  instanceIndex,
  int,
  length,
  storage,
  struct,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import {
  IndirectStorageBufferAttribute,
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
} from "three/webgpu";
import type { IRendererLike } from "./renderer.js";

/**
 * The GPU-driven main pass of a streamed world: one compute dispatch culls and LOD-selects every
 * resident placement, appends the survivors into a shared compacted matrix buffer, and each main
 * batch draws its own region of that buffer with the instance count living in a GPU-side
 * `DrawIndexedIndirect` record. The CPU keeps only the coarse per-key visibility.
 *
 * Everything the kernel needs is GPU data. The CPU writes the placement buffer when residency
 * changes and the indirect records when a key is minted, retired or regrown — a structural event —
 * and nothing at all per instance per frame.
 *
 * The per-instance logic exists twice on purpose: {@link cullAndSelect} is the reference, in plain
 * TypeScript, and the TSL kernel below mirrors it line for line. The tests run in node with no GPU,
 * so the reference is what is proved against the CPU path; the kernel is compiled in the browser.
 */

/** Words one placement record holds: `mat4` + `centre` (xyz, radius) + `meta` (asset slot, …). */
const PLACEMENT_WORDS = 24;
/** `DrawIndexedIndirect`: indexCount, instanceCount, firstIndex, baseVertex, firstInstance. */
const DRAW_ARGS_WORDS = 5;
/** The same record in bytes, which is the unit `BufferGeometry.setIndirect` takes its offset in. */
export const DRAW_ARGS_BYTES = DRAW_ARGS_WORDS * 4;
/** One `vec4` per key, per asset slot and per level gate. */
const VEC4_WORDS = 4;
/** `mat4` per key: the part's own offset inside the model, the same matrix the CPU composes. */
const LOCAL_WORDS = 16;
/** Slots a placement may name before the kernel is refused rather than read out of bounds. */
const SLOT_NONE = -1;

/**
 * A `mat4` world matrix, the placement's bounding-sphere centre and radius, and the asset slot whose
 * gates pick its level. One stride, so the CPU's `Float32Array` is the GPU's storage buffer with no
 * repacking and no type punning: the radius and the slot are small and exactly representable.
 */
const PlacementStruct = struct({ matrix: "mat4", centre: "vec4", meta: "vec4" }, "GpuPlacement");

/** One resident placement as the source buffer holds it. */
export interface IGpuPlacement {
  readonly matrix: Float32Array;
  /** X, Y, Z and the bounding-sphere radius; the frustum test reads the first three. */
  readonly centre: Float32Array;
  /** The asset slot in `0`; `SLOT_NONE` for a record whose cell has left the ring. */
  slot: number;
}

/** One asset's slots: its level gates and the keys each level's parts draw into. */
export interface IAssetSlot {
  /** Level switch distances, ascending, `0` first; the same numbers the CPU path crosses at. */
  readonly distances: readonly number[];
  /** `maxDistance` less its eighth, or `undefined` for an asset with no cull distance. */
  readonly cull: number | undefined;
  /** Per level: the first key its parts draw into and how many parts it has. */
  readonly levels: readonly { readonly firstKey: number; readonly parts: number }[];
}

/** One key's region of the shared drawn buffer, and the args record that counts it. */
export interface IRegion {
  readonly start: number;
  readonly capacity: number;
  readonly argsIndex: number;
  /** The part's own offset inside the model; drawn as `placement * local`, as the CPU does. */
  readonly local: Float32Array;
}

/** What the kernel reads, and the whole of what a dispatch touches. */
export interface IKernelInput {
  readonly placements: readonly IGpuPlacement[];
  readonly count: number;
  readonly camera: {
    readonly planes: Float32Array;
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly slots: readonly IAssetSlot[];
  readonly regions: readonly IRegion[];
  readonly regionCount: number;
}

/** What one dispatch produced: the compacted survivors and the per-key instance counts. */
export interface IKernelResult {
  /** `DRAW_ARGS_WORDS` per region, `1` the instance count; everything else is the CPU's. */
  readonly args: Uint32Array;
  readonly drawn: Float32Array;
  /** Instances drawn per region, which is what the args record's count must say. */
  readonly counts: Uint32Array;
}

/**
 * The per-instance kernel, in plain TypeScript. The TSL kernel in {@link WorldGpuScene} is this
 * loop with the same branches, and the test proves this one against the CPU path.
 *
 * One placement, in the order the source buffer holds them: a released record and a record whose
 * asset is unknown are skipped, the bounding sphere is tested against the camera's six planes, the
 * XZ distance picks the level through the asset's own gates and culls a record beyond its cull
 * distance, and each part of that level takes the next free slot in its key's region and writes
 * `placement * part offset` there. A region that is full is a dropped instance, never a write past
 * the end of the buffer.
 */
export function cullAndSelect(input: IKernelInput): IKernelResult {
  const { placements, camera, regions, slots } = input;
  const counts = new Uint32Array(input.regionCount);
  const args = new Uint32Array(input.regionCount * DRAW_ARGS_WORDS);
  // The drawn buffer is the regions' own, so the reference allocates exactly what the GPU holds.
  const capacity = regions.reduce(
    (sum, region) => Math.max(sum, region.start + region.capacity),
    0,
  );
  const matrix = new Float32Array(capacity * LOCAL_WORDS);
  for (const [index, region] of regions.entries()) {
    args[region.argsIndex * DRAW_ARGS_WORDS + 4] = region.start;
  }
  for (let index = 0; index < input.count; index += 1) {
    const placement = placements[index];
    if (placement === undefined || placement.slot < 0) continue;
    const slot = slots[placement.slot];
    if (slot === undefined) continue;
    const at = placement.centre;
    const radius = at[3] as number;
    let visible = true;
    for (let plane = 0; plane < 6; plane += 1) {
      const offset = plane * 4;
      const signed =
        (camera.planes[offset] as number) * (at[0] as number) +
        (camera.planes[offset + 1] as number) * (at[1] as number) +
        (camera.planes[offset + 2] as number) * (at[2] as number) +
        (camera.planes[offset + 3] as number);
      if (signed < -radius) {
        visible = false;
        break;
      }
    }
    if (visible === false) continue;
    const distance = Math.hypot((at[0] as number) - camera.x, (at[2] as number) - camera.z);
    if (slot.cull !== undefined && distance > slot.cull) continue;
    let level = 0;
    for (let index2 = 1; index2 < slot.distances.length; index2 += 1)
      if (distance > (slot.distances[index2] as number)) level = index2;
    const gate = slot.levels[level];
    if (gate === undefined) continue;
    for (let part = 0; part < gate.parts; part += 1) {
      const region = regions[gate.firstKey + part];
      if (region === undefined) continue;
      const taken = counts[gate.firstKey + part] as number;
      if (taken >= region.capacity) continue;
      counts[gate.firstKey + part] = taken + 1;
      args[region.argsIndex * DRAW_ARGS_WORDS + 1] = taken + 1;
      compose(placement.matrix, region.local, matrix, (region.start + taken) * LOCAL_WORDS);
    }
  }
  return { args, counts, drawn: matrix };
}

/**
 * Whether two gate tables are the same one, so a level key minted after the table was written
 * rewrites it and a swap that arrives with nothing new does not. A level the world has not minted a
 * key for carries `parts: 0`, which is what the kernel's own loop then draws for it: nothing.
 */
function sameGates(one: IAssetSlot, other: IAssetSlot): boolean {
  if (one.cull !== other.cull) return false;
  if (one.distances.length !== other.distances.length) return false;
  for (const [index, distance] of one.distances.entries())
    if (distance !== other.distances[index]) return false;
  if (one.levels.length !== other.levels.length) return false;
  for (const [index, level] of one.levels.entries()) {
    const gate = other.levels[index];
    if (gate === undefined || gate.firstKey !== level.firstKey || gate.parts !== level.parts)
      return false;
  }
  return true;
}

/** `out * into` at `at`, column-major, which is the element order both matrices are written in. */ function compose(
  out: Float32Array,
  into: Float32Array,
  target: Float32Array,
  at: number,
): void {
  for (let column = 0; column < 4; column += 1)
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1)
        sum += (out[k * 4 + row] as number) * (into[column * 4 + k] as number);
      target[at + column * 4 + row] = sum;
    }
}

/** What `TN_WORLD_GPU_SCENE` reports, and what `stats().gpuScene` carries. */
export interface IWorldGpuSceneReport {
  readonly dispatches: number;
  readonly instances: number;
  readonly keys: number;
  readonly on: boolean;
  readonly reason: string;
}

interface IGpuSceneBuffers {
  readonly args: IndirectStorageBufferAttribute;
  readonly drawn: StorageInstancedBufferAttribute;
  readonly gates: StorageBufferAttribute;
  readonly keys: StorageBufferAttribute;
  readonly levels: StorageBufferAttribute;
  readonly locals: StorageBufferAttribute;
  readonly source: StorageBufferAttribute;
}

/**
 * Why the GPU scene is not on, when it is not.
 *
 * Three of the three: compute, storage buffers and indirect draws. WebGL has none of them, and a
 * native backend without them falls back to exactly the CPU path PRD-458 left behind — which is a
 * lost saving, never a wrong picture. `gpuScene: false` is the same answer for a game debugging it.
 */
export function gpuSceneUnsupported(renderer: IRendererLike): string {
  if (renderer.kind !== "webgpu") return `backend=${renderer.kind}`;
  const raw = renderer.raw as { backend?: { hasFeature?: (name: string) => boolean } };
  const backend = raw?.backend;
  if (backend === undefined || typeof backend.hasFeature !== "function")
    return "backend=webgpu-without-hasFeature";
  if (backend.hasFeature("core-features-and-limits") !== true) return "feature=core";
  if (backend.hasFeature("indirect-first-instance") !== true)
    return "feature=indirect-first-instance";
  return "";
}

/** The six planes of a camera's frustum, as the kernel reads them, into `out`. */
function cameraPlanes(camera: Camera, out: Float32Array): void {
  _cullFrustum.setFromProjectionMatrix(
    _proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  for (const [index, plane] of _cullFrustum.planes.entries()) {
    const at = index * 4;
    out[at] = plane.normal.x;
    out[at + 1] = plane.normal.y;
    out[at + 2] = plane.normal.z;
    out[at + 3] = plane.constant;
  }
}

const _proj = new Matrix4();
const _cullFrustum = new Frustum();
const _eye = new Vector3();

/**
 * A TSL node this module pokes at through the swizzles and the `.element()` chain.
 *
 * Three's node types are precise about which swizzle a `vec4` answers and deliberately vague about
 * what a struct member or an atomic result resolves to, and the kernel is the one place in core
 * that has to read a struct member and an atomic's return value. The cast is confined here so the
 * kernel reads as the plain shader it is.
 */
// biome-ignore lint/suspicious/noExplicitAny: three's TSL types refuse the swizzles this kernel reads.
type Kernel = Record<string, any>;

/** `storage(...)` results reach the kernel through this, once. */
function nodes(value: unknown): Kernel {
  return value as unknown as Kernel;
}

/** The launch flag. */
export const GPU_SCENE_FLAG = "TN_GPU_SCENE";

/**
 * Whether `TN_GPU_SCENE` asks for the GPU-driven main pass on this launch.
 *
 * @situation measure a walk with the main pass culling and LOD-selecting on the GPU
 * @constraint off by default: the flag flips once a browser capture proves the picture
 * @example WorldCells.load({ ...options, gpuScene: gpuSceneRequested() });
 *
 * Read the way `renderListValidationRequested` and `terrainValidationRequested` read their own: a
 * native launch sets the environment variable, a browser asks with the query string, and a test
 * sets the global. `0` and `false` are off, so a saved URL that used to enable a switch still
 * says "off".
 */
export function gpuSceneRequested(): boolean {
  const host = globalThis as {
    process?: { env?: Record<string, unknown> };
    __tnGpuScene?: unknown;
  };
  const fromEnv = host.process?.env?.[GPU_SCENE_FLAG];
  if (typeof fromEnv === "string" && fromEnv !== "" && fromEnv !== "0" && fromEnv !== "false")
    return true;
  const query = globalThis.location?.search;
  if (typeof query === "string" && /[?&]tnGpuScene=(?!0(?:&|$))(?!false(?:&|$))[^&]/u.test(query))
    return true;
  return host.__tnGpuScene === true || host.__tnGpuScene === "1";
}

/**
 * The GPU scene, owned by one `WorldCells`.
 *
 * The buffers exist once, and a capacity change replaces the attribute and the kernel with it — a
 * structural event, on the same cadence as a key being minted. Between two of them the per-frame
 * cost is one dispatch and six plane writes.
 */
export class WorldGpuScene {
  /** Resident placements, in the source buffer's own order; index 0 is the buffer's first record. */
  readonly placements: IGpuPlacement[] = [];
  readonly #regions: IRegion[] = [];
  readonly #keysByName = new Map<string, number>();
  readonly #slotsByAsset = new Map<string, IAssetSlot>();
  /** Slot order, so a slot index is a position the `gates` buffer and the reference agree on. */
  readonly #order: string[] = [];
  /** Source records whose cell has left the ring, handed back before the buffer grows. */
  readonly #free: number[] = [];
  #buffers: IGpuSceneBuffers | undefined;
  #dispatched = 0;
  #drawnCapacity = 0;
  #live = 0;
  #on = false;
  #reason = "not-attached";
  /** Set by the one report this class ever prints, so a frame cannot repeat the line. */
  #reported = false;
  /** Bumped by every buffer swap, so a mesh re-dressed once knows if it still points at live data. */
  #version = 0;
  /** The kernel, rebuilt whenever a capacity changed under it. */
  #kernel: { readonly cull: unknown; readonly clear: unknown } | undefined;
  #planes = new Float32Array(24);

  /**
   * Turn the GPU scene on if this backend can run it, and say why not when it cannot. One line,
   * once, and never silent.
   */
  enable(renderer: IRendererLike | undefined, wanted: boolean): boolean {
    if (this.#on) return true;
    if (this.#reported) return false;
    if (renderer === undefined) {
      this.#reason = "no-renderer";
      return false;
    }
    if (wanted === false) {
      this.#reason = "option-off";
      this.#report(renderer);
      return false;
    }
    const unsupported = gpuSceneUnsupported(renderer);
    if (unsupported !== "") {
      this.#reason = unsupported;
      this.#report(renderer);
      return false;
    }
    this.#on = true;
    this.#reason = "on";
    this.#report(renderer);
    return true;
  }

  get on(): boolean {
    return this.#on;
  }

  /**
   * Bumped by every structural change — a key minted, retired or regrown, any buffer grown — so the
   * main meshes know their `instanceMatrix` and `setIndirect` may be pointing at a buffer the scene
   * has since replaced. It only moves on a structural event, so a settled frame never re-dresses.
   */
  get version(): number {
    return this.#version;
  }

  /** The shared compacted matrix buffer every main batch's `instanceMatrix` is. */
  get drawn(): StorageInstancedBufferAttribute | undefined {
    return this.#buffers?.drawn;
  }

  /** The one indirect record buffer every main key's `setIndirect` points into. */
  get args(): IndirectStorageBufferAttribute | undefined {
    return this.#buffers?.args;
  }

  report(): IWorldGpuSceneReport {
    return {
      dispatches: this.#dispatched,
      instances: this.#live,
      keys: this.#regions.length,
      on: this.#on,
      reason: this.#reason,
    };
  }

  /**
   * The main pass's one key per `asset:level:part`: give it a region of the drawn buffer and an args
   * record, or hand back the ones it already has.
   *
   * A region is assigned once and never moves, because `firstInstance` is written into the args
   * record on the CPU and read by the draw. A key whose placements outgrew its region is regrown
   * into a larger one at the tail, which is the only structural change a walk makes.
   */
  key(name: string, local: Float32Array, capacity: number): number | undefined {
    const existing = this.#keysByName.get(name);
    if (existing !== undefined) {
      const region = this.#regions[existing] as IRegion;
      if (region.capacity >= capacity) return existing;
      // A regrow: the old region is abandoned, the new one is the tail, and the args record's
      // `firstInstance` moves with it. Structural, so a bundle version may be bumped for it.
      this.#keysByName.set(name, this.#regions.length);
      this.#regions.push({ ...region, start: this.#drawnCapacity, capacity });
      this.#drawnCapacity += capacity;
      const regrown = this.#regions.length - 1;
      this.#growOf("keys", regrown + 1, VEC4_WORDS);
      this.#growOf("locals", regrown + 1, LOCAL_WORDS);
      this.#growOf("args", (regrown + 1) * DRAW_ARGS_WORDS, 1);
      this.#growDrawn();
      this.#writeKey(this.#regions.length - 1);
      return this.#regions.length - 1;
    }
    this.#ensure();
    const index = this.#regions.length;
    this.#keysByName.set(name, index);
    this.#regions.push({ argsIndex: index, capacity, local, start: this.#drawnCapacity });
    this.#drawnCapacity += capacity;
    this.#growOf("keys", index + 1, VEC4_WORDS);
    this.#growOf("locals", index + 1, LOCAL_WORDS);
    this.#growOf("args", (index + 1) * DRAW_ARGS_WORDS, 1);
    this.#growDrawn();
    this.#writeKey(index);
    return index;
  }

  /** The region one key draws from, for the counters and the tests. */
  regionOf(name: string): IRegion | undefined {
    const index = this.#keysByName.get(name);
    return index === undefined ? undefined : this.#regions[index];
  }

  /**
   * The gates one asset's levels are crossed at, registered the first time any of its keys is
   * minted. Distances and cull distance are the CPU path's own numbers, so the same placement
   * reaches the same level wherever the level is decided.
   */
  slot(asset: string, definition: IAssetSlot): number {
    const at = this.#order.indexOf(asset);
    if (at >= 0 && sameGates(this.#slotsByAsset.get(asset) as IAssetSlot, definition)) return at;
    if (this.#ensure() === undefined) return SLOT_NONE;
    this.#slotsByAsset.set(asset, definition);
    if (at < 0) this.#order.push(asset);
    this.#writeSlots();
    return at < 0 ? this.#order.length - 1 : at;
  }

  /** The gates a slot index names, which is what the kernel and the reference both read. */
  gates(): readonly IAssetSlot[] {
    return this.#order.map((asset) => this.#slotsByAsset.get(asset) as IAssetSlot);
  }

  /** The regions the keys own, in key order, which is what the kernel's `keys` buffer holds. */
  get regions(): readonly IRegion[] {
    return this.#regions;
  }

  /**
   * Take a source record for one placement, or `undefined` when the buffer is full. A record is
   * 24 words: the world matrix, the sphere and the asset slot, which is everything the kernel reads.
   */
  place(asset: number, matrix: Matrix4, x: number, y: number, z: number, radius: number): number {
    const reused = this.#free.pop();
    const index = reused ?? this.placements.length;
    if (reused === undefined && this.#reserve(index + 1) === false) return -1;
    let placement = this.placements[index];
    if (placement === undefined) {
      placement = {
        centre: new Float32Array(4),
        matrix: new Float32Array(LOCAL_WORDS),
        slot: SLOT_NONE,
      };
      this.placements[index] = placement;
    }
    placement.matrix.set(matrix.elements);
    placement.centre[0] = x;
    placement.centre[1] = y;
    placement.centre[2] = z;
    placement.centre[3] = radius;
    placement.slot = asset;
    this.#live += 1;
    this.#writePlacement(index);
    return index;
  }

  /** Hand a source record back; the kernel skips a released one and the slot is reused. */
  release(index: number): void {
    const placement = this.placements[index];
    if (placement === undefined || placement.slot < 0) return;
    placement.slot = SLOT_NONE;
    this.#live -= 1;
    this.#free.push(index);
    this.#writePlacement(index);
  }

  /**
   * One frame of the main pass: zero every key's instance count, then cull and LOD-select every
   * resident placement into the shared drawn buffer. Nothing else is written.
   */
  dispatch(renderer: IRendererLike, camera: Camera): void {
    if (this.#on === false) return;
    if (this.#buffers === undefined) return;
    const kernel = this.#kernel ?? this.#buildKernel();
    if (kernel === undefined) return;
    cameraPlanes(camera, this.#planes);
    for (const [index, plane] of this.#planeVectors.entries()) {
      const at = index * 4;
      plane.set(
        this.#planes[at] as number,
        this.#planes[at + 1] as number,
        this.#planes[at + 2] as number,
        this.#planes[at + 3] as number,
      );
    }
    _eye.setFromMatrixPosition(camera.matrixWorld);
    this.#eye.value.copy(_eye);
    // `(placements, slots, keys, keys)`: the last two are the same count, and the clear dispatch is
    // one thread per key.
    const keys = this.#regions.length;
    this.#counts.value.set(this.placements.length, this.#order.length, keys, keys);
    renderer.compute(kernel.clear);
    renderer.compute(kernel.cull);
    this.#dispatched += 1;
  }

  dispose(): void {
    this.#kernel = undefined;
    this.#buffers = undefined;
    this.placements.length = 0;
    this.#regions.length = 0;
    this.#keysByName.clear();
    this.#slotsByAsset.clear();
    this.#order.length = 0;
    this.#free.length = 0;
    this.#live = 0;
    this.#on = false;
  }

  readonly #planeVectors = Array.from({ length: 6 }, () => new Vector4());
  #eye = uniform(new Vector3());
  #counts = uniform(new Vector4());
  #planeUniforms = this.#planeVectors.map((plane) => uniform(plane));

  #ensure(): IGpuSceneBuffers | undefined {
    if (this.#buffers !== undefined) return this.#buffers;
    this.#buffers = {
      args: new IndirectStorageBufferAttribute(new Uint32Array(DRAW_ARGS_WORDS), 1),
      drawn: new StorageInstancedBufferAttribute(1, 4),
      gates: new StorageBufferAttribute(1, VEC4_WORDS),
      keys: new StorageBufferAttribute(1, VEC4_WORDS),
      levels: new StorageBufferAttribute(1, VEC4_WORDS),
      locals: new StorageBufferAttribute(1, LOCAL_WORDS),
      source: new StorageBufferAttribute(16, PLACEMENT_WORDS),
    };
    this.#version += 1;
    return this.#buffers;
  }

  /**
   * Grow one per-key buffer by doubling, or leave it when it already has room.
   *
   * Each of these is read by a built kernel or named by a geometry's `setIndirect`, so a swap is
   * structural: the kernel is a new pipeline and the main meshes are re-dressed against the new
   * attribute. That is why the buffers start at one and double — a key arriving is the event, and a
   * frame never reallocates.
   */
  #growOf(
    name: "args" | "keys" | "locals" | "levels" | "gates",
    needed: number,
    stride: number,
  ): boolean {
    const buffers = this.#buffers;
    if (buffers === undefined) return false;
    const current = buffers[name] as StorageBufferAttribute;
    if (current.count >= needed) return true;
    let capacity = Math.max(1, current.count);
    while (capacity < needed) capacity *= 2;
    const grown =
      name === "args"
        ? new IndirectStorageBufferAttribute(new Uint32Array(capacity), 1)
        : new StorageBufferAttribute(capacity, stride);
    grown.array.set(current.array as Uint32Array);
    grown.addUpdateRange(0, current.array.length);
    this.#buffers = { ...buffers, [name]: grown };
    this.#kernel = undefined;
    this.#version += 1;
    return true;
  }

  #growDrawn(): void {
    const buffers = this.#buffers;
    if (buffers === undefined) return;
    const needed = Math.max(1, this.#drawnCapacity);
    if (buffers.drawn.count >= needed) return;
    let capacity = Math.max(1, buffers.drawn.count);
    while (capacity < needed) capacity *= 2;
    const grown = new StorageInstancedBufferAttribute(capacity, 4);
    grown.array.set(buffers.drawn.array as Uint32Array);
    this.#buffers = { ...buffers, drawn: grown };
    // The attributes the kernel is built from changed, so the kernel is a new pipeline: a structural
    // event, and the only one this class pays a compile for.
    this.#kernel = undefined;
    this.#version += 1;
  }

  #reserve(count: number): boolean {
    const buffers = this.#buffers;
    if (buffers === undefined) return false;
    if (count <= buffers.source.count) return true;
    let capacity = Math.max(16, buffers.source.count);
    while (capacity < count) capacity *= 2;
    const grown = new StorageBufferAttribute(capacity, PLACEMENT_WORDS);
    grown.array.set(buffers.source.array as Uint32Array);
    grown.addUpdateRange(0, buffers.source.array.length);
    this.#buffers = { ...buffers, source: grown };
    this.#kernel = undefined;
    this.#version += 1;
    return true;
  }

  #writePlacement(index: number): void {
    const buffers = this.#buffers;
    const placement = this.placements[index];
    if (buffers === undefined || placement === undefined) return;
    const at = index * PLACEMENT_WORDS;
    const array = buffers.source.array as Float32Array;
    array.set(placement.matrix, at);
    array[at + 16] = placement.centre[0] as number;
    array[at + 17] = placement.centre[1] as number;
    array[at + 18] = placement.centre[2] as number;
    array[at + 19] = placement.centre[3] as number;
    array[at + 20] = placement.slot;
    buffers.source.addUpdateRange(at, PLACEMENT_WORDS);
    buffers.source.needsUpdate = true;
  }

  #writeKey(index: number): void {
    // Read the live set, not the one the caller held: growing a buffer replaces the attribute, and
    // the record being written is the one the draw and the kernel will read.
    const buffers = this.#buffers;
    const region = this.#regions[index];
    if (buffers === undefined || region === undefined) return;
    const at = index * VEC4_WORDS;
    const keys = buffers.keys.array as Float32Array;
    keys[at] = region.start;
    keys[at + 1] = region.capacity;
    keys[at + 2] = region.argsIndex;
    buffers.keys.addUpdateRange(at, VEC4_WORDS);
    buffers.keys.needsUpdate = true;
    (buffers.locals.array as Float32Array).set(region.local, index * LOCAL_WORDS);
    buffers.locals.addUpdateRange(index * LOCAL_WORDS, LOCAL_WORDS);
    buffers.locals.needsUpdate = true;
    const args = buffers.args.array as Uint32Array;
    args[region.argsIndex * DRAW_ARGS_WORDS + 1] = 0;
    args[region.argsIndex * DRAW_ARGS_WORDS + 4] = region.start;
    buffers.args.needsUpdate = true;
  }

  /** Write the whole gate table, which only changes when an asset's levels are adopted. */
  #writeSlots(): void {
    const buffers = this.#buffers;
    if (buffers === undefined) return;
    const gates = buffers.gates.array as Float32Array;
    const levels = buffers.levels.array as Float32Array;
    let level = 0;
    for (const [slot, asset] of this.#order.entries()) {
      const definition = this.#slotsByAsset.get(asset) as IAssetSlot;
      const first = level;
      for (const [index, gate] of definition.levels.entries()) {
        const at = level * VEC4_WORDS;
        levels[at] = definition.distances[index] ?? 0;
        levels[at + 1] = gate.firstKey;
        levels[at + 2] = gate.parts;
        levels[at + 3] = 0;
        level += 1;
      }
      const at = slot * VEC4_WORDS;
      gates[at] = first;
      gates[at + 1] = definition.levels.length;
      gates[at + 2] = definition.cull ?? 0;
      gates[at + 3] = definition.cull === undefined ? 0 : 1;
    }
    this.#growOf("gates", Math.max(1, this.#order.length), VEC4_WORDS);
    this.#growOf("levels", Math.max(1, level), VEC4_WORDS);
    const live = this.#buffers;
    if (live === undefined) return;
    live.gates.needsUpdate = true;
    live.levels.needsUpdate = true;
    (live.gates.array as Float32Array).set(gates);
    (live.levels.array as Float32Array).set(
      levels.subarray(0, Math.min(levels.length, level * VEC4_WORDS)),
    );
  }

  /**
   * The two dispatches, mirroring {@link cullAndSelect} branch for branch: one thread per key
   * zeroes that key's instance count, one thread per resident placement appends its matrix to each
   * of its level's parts.
   */
  #buildKernel(): { readonly cull: unknown; readonly clear: unknown } | undefined {
    const buffers = this.#buffers;
    if (buffers === undefined) return undefined;
    const source = nodes(storage(buffers.source, PlacementStruct, buffers.source.count));
    const drawn = nodes(storage(buffers.drawn, "mat4", buffers.drawn.count));
    const argsPlain = nodes(storage(buffers.args, "uint", buffers.args.count));
    const argsAtomic = nodes(storage(buffers.args, "uint", buffers.args.count).toAtomic());
    const keys = nodes(storage(buffers.keys, "vec4", buffers.keys.count));
    const locals = nodes(storage(buffers.locals, "mat4", buffers.locals.count));
    const gates = nodes(storage(buffers.gates, "vec4", buffers.gates.count));
    const levels = nodes(storage(buffers.levels, "vec4", buffers.levels.count));
    const counts = nodes(this.#counts);
    const eye = nodes(this.#eye);
    const planes = this.#planeUniforms.map((plane) => nodes(plane));
    const clear = Fn(() => {
      If(instanceIndex.greaterThanEqual(counts.w), () => Return());
      const key = keys.element(instanceIndex);
      argsPlain.element(key.z.mul(DRAW_ARGS_WORDS).add(1)).assign(int(0));
    })().compute(Math.max(1, buffers.keys.count));
    const cull = Fn(() => {
      If(instanceIndex.greaterThanEqual(counts.x), () => Return());
      const placement = source.element(instanceIndex);
      const centre = placement.get("centre");
      const matrix = placement.get("matrix");
      const slot = placement.get("meta").x;
      If(slot.lessThan(0.0), () => Return());
      If(slot.greaterThanEqual(counts.y), () => Return());
      const radius = centre.w;
      for (const plane of planes)
        If(plane.dot(centre.xyz).lessThan(radius.negate()), () => Return());
      const gate = gates.element(slot);
      const distance = length(vec3(centre.x.sub(eye.x), 0.0, centre.z.sub(eye.z)));
      If(gate.w.greaterThan(0.5).and(distance.greaterThan(gate.z)), () => Return());
      // The level, by the same ascending test the CPU runs: the last gate the placement is past.
      // Eight is the deepest chain a baked level set reaches, and `gate.y` bounds the loop, so a
      // deeper one would read the level above its own.
      const level = int(0).toVar();
      for (let index = 1; index < 8; index += 1) {
        If(
          float(index)
            .lessThan(gate.y)
            .and(distance.greaterThan(levels.element(gate.x.add(index)).x)),
          () => {
            level.assign(int(index));
          },
        );
      }
      const at = levels.element(gate.x.add(level));
      Loop({ start: int(0), end: at.z, type: "int", condition: "<" }, ({ i }: { i: unknown }) => {
        const keyIndex = at.y.add(i as never);
        const key = keys.element(keyIndex);
        const taken = nodes(
          atomicAdd(argsAtomic.element(key.z.mul(DRAW_ARGS_WORDS).add(1)), int(1)),
        );
        If(taken.toFloat().lessThan(key.y), () => {
          drawn.element(key.x.add(taken)).assign(matrix.mul(locals.element(keyIndex)));
        });
      });
    })().compute(Math.max(1, buffers.source.count));
    clear.setName("worldGpuSceneClear");
    cull.setName("worldGpuSceneCull");
    this.#kernel = { clear, cull };
    return this.#kernel;
  }

  #report(renderer: IRendererLike): void {
    this.#reported = true;
    const report = this.report();
    const name =
      "log" in renderer ? (renderer.log as ((message: string) => void) | undefined) : undefined;
    const line =
      `TN_WORLD_GPU_SCENE ${report.on ? "on" : "off"} reason=${report.reason || "none"} ` +
      `instances=${String(report.instances)} keys=${String(report.keys)}`;
    if (typeof name === "function") name(line);
    else console.info(line);
  }
}
