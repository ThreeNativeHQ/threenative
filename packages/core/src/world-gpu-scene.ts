import { type BufferAttribute, type Camera, Frustum, Matrix4, Vector3, Vector4 } from "three";
import {
  Fn,
  If,
  Loop,
  Return,
  atomicAdd,
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

/** Words one placement record holds: `mat4` + `centre` (xyz, radius) + `info` (asset slot, …; not `meta`, a reserved WGSL keyword). */
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
 * One element of every WGSL type this module declares a storage buffer as, in array words.
 *
 * A storage binding's minimum size is one element of its declared type: a `mat4` buffer is 64 bytes
 * whether it holds one matrix or a thousand, and a bound buffer under that is not a wrong picture but
 * a refused pipeline — every dispatch on it is invalid, silently, and only the device complains. So
 * the element count and the element size are not two independent numbers here: they are written down
 * together, once, and every buffer is allocated from this table and nowhere else.
 */
const STORAGE_WORDS = {
  /** `mat4` + `centre` (vec4) + `info` (vec4), so one placement is 96 bytes and one stride. */
  // biome-ignore lint/style/useNamingConvention: the key is the WGSL type, spelled as the kernel declares it.
  GpuPlacement: PLACEMENT_WORDS,
  /** `mat4`, one per key: the part's own offset inside the model, the same one the CPU composes. */
  mat4: LOCAL_WORDS,
  /** `DrawIndexedIndirect`'s five words; `uint` is one word, so the element count is the word count. */
  uint: 1,
  /** One `vec4` per key, per asset slot and per level gate. */
  vec4: VEC4_WORDS,
} as const;

/** A WGSL type the cull kernel declares a storage buffer as, and {@link STORAGE_WORDS}'s key. */
export type StorageType = keyof typeof STORAGE_WORDS;

/** Bytes one element of `type` occupies, which is what a storage binding of it must be at least. */
export function storageElementBytes(type: StorageType): number {
  return STORAGE_WORDS[type] * 4;
}

/**
 * One storage attribute holding `count` elements — at least one, because a zero-element binding is
 * a zero-byte buffer and zero bytes is under every declared type — of the WGSL `type` the kernel
 * binds it as.
 *
 * The class and the array class are parameters because three's three storage attributes differ only
 * in what the renderer does with them, and this module needs all three: a plain one, the instanced
 * buffer a dressed batch's `instanceMatrix` is, and the indirect records `BufferGeometry.setIndirect`
 * reads. Handing the item size in by hand is how `drawn` was allocated four words wide and bound as
 * a `mat4`: a one-element, 16-byte buffer against a 64-byte requirement, so the cull kernel never
 * ran on a real GPU at all. The size is not a free choice here, so it is not written at a call site.
 */
function storageAttribute<A extends BufferAttribute>(
  ctor: new (count: Float32Array | Uint32Array, itemSize: number) => A,
  type: StorageType,
  count: number,
  array: Float32ArrayConstructor | Uint32ArrayConstructor = Float32Array,
): A {
  const words = STORAGE_WORDS[type];
  return new ctor(new array(Math.max(1, count) * words), words);
}
/** Dispatches between readbacks: a mapped buffer is a queue submission, so not every frame. */
const VALIDATE_EVERY = 30;
/** Keys a mismatch line names before the rest are counted and not printed. */
const VALIDATE_REPORTED_KEYS = 10;
/** Keys a matrix or indirect-record line names, which carry more numbers than a count line does. */
const MATRIX_REPORTED_KEYS = 5;
/** Meshes a `mesh=` line names, on the same budget as the record lines above. */
const MESH_REPORTED_MESHES = 5;
/** Two matrices within this of each other are the same one written through a `mat4` product. */
const MATRIX_TOLERANCE = 1e-3;
/** Characters of a cause a `cause=` line carries, so one message cannot own the report. */
const CAUSE_CHARS = 160;

/**
 * A `mat4` world matrix, the placement's bounding-sphere centre and radius, and the asset slot whose
 * gates pick its level. One stride, so the CPU's `Float32Array` is the GPU's storage buffer with no
 * repacking and no type punning: the radius and the slot are small and exactly representable.
 */
const PlacementStruct = struct({ matrix: "mat4", centre: "vec4", info: "vec4" }, "GpuPlacement");

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
  /** Where this key's survivors are written. Moves only in a re-layout, which rewrites every record. */
  start: number;
  /** Instances this region holds. Grows only in a re-layout, which resizes the whole level. */
  capacity: number;
  readonly argsIndex: number;
  /** The part's own offset inside the model; drawn as `placement * local`, as the CPU does. */
  readonly local: Float32Array;
  /** The main key this region is, which is what the validation marker names a mismatch by. */
  readonly name?: string;
  /**
   * The dressed geometry's own index count, which the record's `indexCount` has to say for the draw
   * to name a triangle at all. The owner records it when it dresses the mesh — the scene does not
   * know what shape a key draws — and the validation holds the record against it.
   */
  indexCount: number;
}

/** One level's parts and the single capacity all of them are sized from. */
interface ILevelGroup {
  capacity: number;
  /**
   * The key index the level's run starts at, claimed whole at its first key and never moved, so
   * `firstKey + part` names that part's own key however the parts were minted. The run is claimed
   * rather than appended to because keys are not minted in level order: a prewarm mints every level
   * and part of one asset before the next, a walk that arrives mid-prewarm mints whatever its cell
   * needs, and the keys minted in between are not this level's. A run built by appending is a run
   * with another asset's keys inside it, and a gate table that names it draws that asset's placements
   * through this level's parts and this level's placements through the other's — which is a forest
   * drawn with another tree's geometry, and a check that reproduces the same addressing reads it as
   * agreement.
   */
  firstKey: number;
  /** How many parts the level has, which is the width of the run the gate table names. */
  parts: number;
  /** Part index to the region that part draws into; laid out in this order. */
  readonly minted: Map<number, number>;
}

/**
 * Which of a level's parts a key is, so the parts of one level stay the contiguous run the kernel
 * and the gate table both address as `firstKey + part`. `undefined` mints a key of its own, which
 * is every key a caller that has no level to be a part of wants.
 */
export interface ILevelKey {
  /** The level this part belongs to — one group, however many parts it has. */
  readonly group: string;
  /** The part's own index in that level, which is the order the group is laid out in. */
  readonly part: number;
  /**
   * How many parts the level has altogether, so the run is claimed once and in full. The caller knows
   * it: the level is an array of parts, and every part of it will be asked for. A part outside the
   * run the level declared is refused rather than laid over another level's key.
   */
  readonly parts: number;
}

/** The offset a part that has not been minted yet draws with: none at all, and nowhere to draw. */
const NO_LOCAL = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

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
 * One dispatch's own copy of everything its kernel read, taken while that dispatch runs, plus the
 * attribute the readback has to name.
 *
 * A streamed world changes its placement set, its gate table and its region layout between one frame
 * and the next, so a reference computed when a readback lands describes the frames that followed the
 * dispatch that produced the bytes — which is how a check that compared nothing came to report
 * `compared=0` over 21,147 resident placements. Copied at dispatch time, the reference is a pure
 * function of the snapshot and nothing that happens afterwards can change it.
 */
interface IValidationSnapshot extends IKernelInput {
  /** The indirect records this dispatch wrote, which is what its readback must name. */
  readonly args: unknown;
  /** The shared matrix buffer this dispatch compacted into, which its other readback must name. */
  readonly drawn: unknown;
  /** Resident placements the scene held when this dispatch ran. */
  readonly placed: number;
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
 * One asset's gates as its owner holds them **right now**: the same numbers `asset.distances`,
 * `asset.levels` and `cullDistance(definition.maxDistance)` are, read at the moment the check runs.
 *
 * Deliberately not an {@link IAssetSlot}. A slot is what this class wrote into its own table, and a
 * table written before the owner's model widened its chain is the exact thing the check exists to
 * catch — feeding it back in as the reference is the check agreeing with itself.
 */
export interface ILiveAsset {
  /** The asset id a main key is named `asset:level:part` with, which is the owner's own convention. */
  readonly id: string;
  /** Level switch distances, ascending, `0` first — `asset.distances`, never a copy of the table. */
  readonly distances: readonly number[];
  /** `maxDistance` less its eighth, or `undefined`. */
  readonly cull: number | undefined;
  /** Index-aligned with `distances`; each level's parts, each part's own offset inside the model. */
  readonly locals: readonly (readonly Float32Array[])[];
}

/**
 * Every placement's own answer, from the owner's live gates, as the instances each main key must be
 * holding: the same six-plane sphere test, the same `cull`, the same ascending `distance > gate`
 * level test and the same `placement * part offset` composition {@link cullAndSelect} runs — over
 * gates this file did not write.
 *
 * This is the one reference in the module that is not a mirror of the kernel's inputs. `cullAndSelect`
 * reads the gate table out of the same class the kernel's buffer is written from, so a table holding
 * the wrong distances makes both agree; here the caller passes the owner's own `distances`, so a
 * table that was written before the chain widened, or before the last `maxDistance`, answers
 * differently from the picture the CPU path draws.
 */
export function liveKeyInstances(
  placements: readonly IGpuPlacement[],
  asset: (slot: number) => ILiveAsset | undefined,
  camera: {
    readonly planes: Float32Array;
    readonly x: number;
    readonly y: number;
    readonly z: number;
  },
): Map<string, Float32Array> {
  const words = new Map<string, number[]>();
  for (const placement of placements) {
    if (placement.slot < 0) continue;
    const held = asset(placement.slot);
    if (held === undefined) continue;
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
    if (held.cull !== undefined && distance > held.cull) continue;
    let level = 0;
    for (let index = 1; index < held.distances.length; index += 1)
      if (distance > (held.distances[index] as number)) level = index;
    const locals = held.locals[level];
    if (locals === undefined) continue;
    for (const [part, local] of locals.entries()) {
      const key = `${held.id}:${String(level)}:${String(part)}`;
      let run = words.get(key);
      if (run === undefined) {
        run = [];
        words.set(key, run);
      }
      compose(placement.matrix, local, LIVE_MATRIX, 0);
      for (const word of LIVE_MATRIX) run.push(word);
    }
  }
  return new Map([...words].map(([key, run]) => [key, Float32Array.from(run)]));
}

/** The one matrix `liveKeyInstances` composes into, reused per placement as the kernel's own is. */
const LIVE_MATRIX = new Float32Array(LOCAL_WORDS);

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

/** One word of an indirect readback, out of range being the zero a record that was never written holds. */
function word(readback: Uint32Array, at: number): number {
  return (readback[at] ?? 0) as number;
}

/** The translation of the `mat4` at slot `at`, which is what a draw places and a line can name. */
function xyz(matrices: Float32Array, at: number): string {
  const matrix = at * LOCAL_WORDS;
  if (matrix + LOCAL_WORDS > matrices.length) return "[]";
  return (
    `[${(matrices[matrix + 12] as number).toFixed(3)},` +
    `${(matrices[matrix + 13] as number).toFixed(3)},` +
    `${(matrices[matrix + 14] as number).toFixed(3)}]`
  );
}

/**
 * Whether two runs of `mat4` hold the same matrices, as a set and not as a sequence.
 *
 * The kernel appends through an atomic, so the order two dispatches fill a region's run in is the
 * order the device scheduled them in and is not the order the reference walked the placements. The
 * counts agree over a set that agrees; a set that does not is a run one slot out, a matrix that was
 * never written, or a `firstInstance` the draw reads from a different place — none of which a count
 * can see. Sorted by translation, because that is what orders a placement, and compared with a
 * tolerance, because a matrix written through a product of two floats is not bit-equal to either.
 */
function sameMatrices(
  gpu: Float32Array,
  gpuStart: number,
  gpuCount: number,
  cpu: Float32Array,
  cpuStart: number,
  cpuCount: number,
  tolerance: number,
): boolean {
  const one = sorted(gpu, gpuStart, gpuCount);
  const other = sorted(cpu, cpuStart, cpuCount);
  if (one.length !== other.length) return false;
  for (const [index, matrix] of one.entries()) {
    const against = other[index] as Float32Array;
    for (let word = 0; word < LOCAL_WORDS; word += 1)
      if (Math.abs((matrix[word] as number) - (against[word] as number)) > tolerance) return false;
  }
  return true;
}

/** One run of `mat4` as views, ordered by translation, and short reads truncated rather than read past. */
function sorted(matrices: Float32Array, start: number, count: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let taken = 0; taken < count; taken += 1) {
    const at = (start + taken) * LOCAL_WORDS;
    if (at < 0 || at + LOCAL_WORDS > matrices.length) break;
    out.push(matrices.subarray(at, at + LOCAL_WORDS));
  }
  out.sort(
    (one, other) =>
      (one[12] as number) - (other[12] as number) || (one[14] as number) - (other[14] as number),
  );
  return out;
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

/**
 * One dressed main mesh's draw, as the owner's own live state says it, and nothing from this file's
 * tables.
 *
 * This is the check that cannot be wrong in the same way the kernel is. {@link cullAndSelect}
 * addresses a level's parts as `levels[gate.x + level].y + part`, and the gate table holds the
 * `firstKey` the scene itself reported through `levelKeys`, so a key/record/mesh mapping that is
 * wrong is reproduced on both sides of the comparison and reads as agreement: a real WebGPU walk
 * printed `ok` over a forest it was drawing with another tree's geometry. The three numbers here
 * come from the other side of the seam — the mesh's own `geometry.indirect` record, the mesh's own
 * name, and the instances the owner's own gates and the camera's own planes select for that name —
 * so the one question they can answer is the one that matters: does the record this mesh draws from
 * hold exactly the instances that mesh's key is owed.
 */
export interface IMeshDraw {
  /** The dressed mesh's own name, which is the main key: `asset:level:part`. */
  readonly name: string;
  /** `geometry.indirectOffset / DRAW_ARGS_BYTES` — the record the draw reads, not one the tables name. */
  readonly record: number;
  /**
   * Every instance the owner's live gates and the camera's planes select for this key, `mat4` after
   * `mat4`: the whole answer, and never the per-cell records this path's own refilter left behind.
   */
  readonly instances: Float32Array;
}

/** What the independent per-mesh check found, in the shape the report folds in. */
export interface IMeshDrawComparison {
  /** Meshes whose own record was read back and held against the live-state instances. */
  readonly compared: number;
  readonly mismatched: number;
  readonly mismatches: readonly string[];
}

/**
 * Every dressed main mesh's own record, against the instances its own key is owed, as a set rather
 * than a sequence — the kernel appends through an atomic, so a device's order is not the CPU's.
 *
 * Equality, and not containment, because the reference is now the whole answer: the owner's gates
 * and the camera's planes over the scene's own placements, which is everything the dispatch reads.
 * Containment was the right relation when the other side was the CPU path's per-cell records, which
 * are the records a refilter left and go stale the moment the GPU scene bypasses it — a reference
 * that can be a superset cannot name a level selected at the wrong distance, and a far tree drawn
 * at its near level is what that looks like in the picture.
 */
export function compareMeshDraws(
  gpu: Uint32Array,
  drawn: Float32Array,
  draws: readonly IMeshDraw[],
  regions: readonly IRegion[],
): IMeshDrawComparison {
  const mismatches: string[] = [];
  let mismatched = 0;
  for (const draw of draws) {
    const record = draw.record * DRAW_ARGS_WORDS;
    const landed = word(gpu, record + 1);
    const first = word(gpu, record + 4);
    if (
      sameMatrices(
        drawn,
        first,
        landed,
        draw.instances,
        0,
        draw.instances.length / LOCAL_WORDS,
        MATRIX_TOLERANCE,
      )
    )
      continue;
    mismatched += 1;
    if (mismatches.length >= MESH_REPORTED_MESHES) continue;
    // The region that owns the record the mesh read, which is the name that says whether the mesh
    // and the scene ever agreed on which record this key is.
    const owner = regions.find((region) => region.argsIndex === draw.record);
    mismatches.push(
      `mesh=${draw.name} record=${String(draw.record)} ` +
        `region=${owner?.name ?? "none"} count gpu=${String(landed)} ` +
        `live=${String(draw.instances.length / LOCAL_WORDS)} ` +
        `firstMatrix gpu=${xyz(drawn, first)} live=${xyz(draw.instances, 0)}`,
    );
  }
  return { compared: draws.length, mismatched, mismatches };
}

/** What one landed readback concluded, in the three words a log line can carry. */
export type GpuSceneVerdict = "ok" | "mismatch" | "error";

/** One landed readback's verdict, its one line, and the detail lines under it. */
export interface IGpuSceneValidation {
  readonly verdict: GpuSceneVerdict;
  readonly line: string;
  readonly lines: readonly string[];
}

/** What a landed readback is judged on, gathered from the scene before it is formatted. */
export interface IGpuSceneComparison {
  /** Keys whose GPU instance count was read back and held against the reference. */
  readonly compared: number;
  readonly instancesGpu: number;
  readonly instancesCpu: number;
  /** Up to {@link VALIDATE_REPORTED_KEYS} `name gpu=… cpu=…` lines; the count is the whole total. */
  readonly mismatches: readonly string[];
  readonly mismatched: number;
  /**
   * Keys whose drawn matrices, `firstInstance` or `indexCount` disagreed, and up to
   * {@link MATRIX_REPORTED_KEYS} of them by name. The counts above are what the dispatch promised;
   * these are what the draw reads, which is a different question and the one the picture answers.
   */
  readonly matricesMismatched: number;
  readonly matrixMismatches: readonly string[];
  /**
   * Dressed main meshes whose own record was read back and held against the CPU path's own records
   * for that mesh's key, and up to {@link MESH_REPORTED_MESHES} of them by name. This is the check
   * the reference above cannot make: a key/record/mesh mapping that is wrong is one both sides
   * reproduce, and a mesh drawing another asset's placements out of its own record is the picture
   * that proves it.
   */
  readonly meshMismatched: number;
  readonly meshMismatches: readonly string[];
  /** Resident placements the scene held when the readback was issued. */
  readonly placed: number;
  /** The device's last uncaptured error, or `""` for none since the last check reported one. */
  readonly deviceError: string;
  /** What stopped the check — a rejected readback, say. Non-empty is an `error` on its own. */
  readonly cause?: string;
}

/**
 * The verdict and the lines one landed readback reports, as `TN_WORLD_GPU_SCENE_VALIDATE`.
 *
 * `ok` is a claim that the GPU drew what the reference draws, so it takes three things: every key's
 * count landing equal, every key's record and matrices landing where the reference put them, and
 * something to land. A dispatch the device refused leaves the args buffer holding what the clear
 * pass wrote, which compares equal to a scene with nothing in it — a real WebGPU run printed
 * `ok keys=0` 956 times while the cull pipeline was being refused for a binding 48 bytes short, which
 * is a check that reports success precisely when the kernel does nothing. So comparing nothing while
 * placements exist is an `error`, and a device that raised anything uncaptured is an `error`
 * whatever the counts say, because every count in a buffer the device has already invalidated is not
 * evidence of anything.
 *
 * The three mismatch families are counted apart and all are a `mismatch`: a key that drew the right
 * number of instances at the wrong place or through a record naming no triangle is the failure a
 * count cannot see, and a walk that printed `mismatched=0` over a forest it never drew is what that
 * reads like. The third is the one the two above cannot find at all: every key the reference names
 * and every record it reads is named by this same file, so a key/record/mesh mapping that is wrong is
 * one they both reproduce, and the dressed mesh's own record, against the CPU path's own records,
 * is the only pair of numbers here that were not written by the same hand.
 *
 * An `error` always names its cause on one `cause=` line: the checks that fail here fail silently
 * otherwise, and a line reading `error` with nothing after it is the report that hid a refused
 * pipeline in the first place.
 */
export function validationReport(input: IGpuSceneComparison): IGpuSceneValidation {
  const blind = input.compared === 0 && input.placed > 0;
  const cause =
    input.deviceError !== ""
      ? `device-error ${input.deviceError}`
      : (input.cause ?? (blind ? `compared-0-with-placed=${String(input.placed)}` : ""));
  const verdict: GpuSceneVerdict =
    cause !== ""
      ? "error"
      : input.mismatched > 0 || input.matricesMismatched > 0 || input.meshMismatched > 0
        ? "mismatch"
        : "ok";
  const line =
    `TN_WORLD_GPU_SCENE_VALIDATE ${verdict} compared=${String(input.compared)} ` +
    `instancesGpu=${String(input.instancesGpu)} instancesCpu=${String(input.instancesCpu)} ` +
    `mismatched=${String(input.mismatched)} matricesMismatched=${String(input.matricesMismatched)} ` +
    `meshMismatched=${String(input.meshMismatched)}`;
  const lines: string[] = [...input.mismatches, ...input.matrixMismatches, ...input.meshMismatches];
  if (cause !== "") lines.push(`cause=${cause.slice(0, CAUSE_CHARS)}`);
  return { verdict, line, lines };
}

/** The message an uncaptured WebGPU error event carries, flattened to one line. */
function uncapturedMessage(event: unknown): string {
  const error = (event as { error?: { message?: string; constructor?: { name?: string } } }).error;
  const kind = error?.constructor?.name ?? "GPUError";
  return `${kind}: ${(error?.message ?? "no message").replace(/\s+/gu, " ").trim()}`;
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

/** One of the scene's own storage buffers, by the name it is allocated and grown under. */
type BufferName = keyof IGpuSceneBuffers;

/**
 * The declared WGSL type of every buffer that is a plain `StorageBufferAttribute` in
 * {@link IGpuSceneBuffers}. `args` and `drawn` are absent because each needs a three class of its own,
 * so `#growOf` names those two literally; the other five share one.
 */
const STORAGE_PLAIN: Record<Exclude<BufferName, "args" | "drawn">, StorageType> = {
  gates: "vec4",
  keys: "vec4",
  levels: "vec4",
  locals: "mat4",
  source: "GpuPlacement",
};

/** Resident placements the source buffer is sized to hold before the first reallocation. */
const SOURCE_FLOOR = 16;

/** One storage buffer as the check reads it: the type the kernel declares and what was allocated. */
export interface IGpuSceneBufferFootprint {
  readonly type: StorageType;
  readonly count: number;
  /** `array.byteLength` — the size WebGPU compares against one element of `type`. */
  readonly bytes: number;
}

/** The slice of a `GPUDevice` the validation seam reads, so a test can stand in a fake. */
interface IDeviceLike {
  onuncapturederror?: ((event: unknown) => void) | null;
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
  const raw = renderer.raw as {
    backend?: { device?: IDeviceLike; hasFeature?: (name: string) => boolean };
  };
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

/** The validation flag. */
export const GPU_SCENE_VALIDATE_FLAG = "TN_GPU_SCENE_VALIDATE";

/**
 * Whether the GPU scene should hold every dispatch's indirect args against the CPU reference.
 *
 * @situation find the keys a real WebGPU dispatch draws fewer instances of than `cullAndSelect` does
 * @constraint off by default and never on a measured walk: a readback is a queue submission and a
 *   mapped buffer, so the mode exists to answer "which key" and not to be fast
 * @example WorldCells.load({ ...options, gpuScene: true, gpuSceneValidate: gpuSceneValidationRequested() });
 *
 * Read the way `gpuSceneRequested` reads its own: a native launch sets the environment variable, a
 * browser asks with `?tnGpuSceneValidate=1`, and a test sets the global.
 */
export function gpuSceneValidationRequested(): boolean {
  const host = globalThis as {
    process?: { env?: Record<string, unknown> };
    __tnGpuSceneValidate?: unknown;
  };
  const fromEnv = host.process?.env?.[GPU_SCENE_VALIDATE_FLAG];
  if (typeof fromEnv === "string" && fromEnv !== "" && fromEnv !== "0" && fromEnv !== "false")
    return true;
  const query = globalThis.location?.search;
  if (
    typeof query === "string" &&
    /[?&]tnGpuSceneValidate=(?!0(?:&|$))(?!false(?:&|$))[^&]/u.test(query)
  )
    return true;
  return host.__tnGpuSceneValidate === true || host.__tnGpuSceneValidate === "1";
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
  /** One level's parts per `asset:level`, which is what keeps them the run the kernel addresses. */
  readonly #groups = new Map<string, ILevelGroup>();
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
   * once, and never silent. `validate` holds every dispatch's args against the CPU reference; see
   * {@link gpuSceneValidationRequested}.
   */
  enable(renderer: IRendererLike | undefined, wanted: boolean, validate = false): boolean {
    this.#validate = validate;
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
    this.#watchDevice(renderer);
    // Not printed here: the owner's own line is the one that says how many of its meshes are
    // dressed, and that number is only known once it has dressed them — see {@link announce}.
    return true;
  }

  /**
   * The one line, printed once, with the owner's census of dressed main meshes.
   *
   * `enable` announces every answer but "on", because a scene that is off has nothing to count. This
   * is the answer that does: the owner dresses the keys a ring built before the scene came up is
   * already holding, and only then can `dressed=N/M` say whether the dispatch has anything to draw
   * into. A caller with no owner of its own announces without a census, which reads `0/0`.
   */
  announce(
    renderer: IRendererLike,
    census?: { readonly dressed: number; readonly meshes: number },
  ): void {
    if (census !== undefined) this.#census = { dressed: census.dressed, meshes: census.meshes };
    this.#report(renderer);
  }

  /**
   * Hold the device's uncaptured errors, so a check can read them instead of the console.
   *
   * Three already chains its own `onuncapturederror` onto the same device and prints the message,
   * which is the whole reason a refused pipeline reads as a healthy run: the evidence was on screen
   * as a console line nothing compared against the counts. This wraps that handler rather than
   * replacing it, so three's own reporting still fires, and the last message is folded into the next
   * `TN_WORLD_GPU_SCENE_VALIDATE` line. Nothing is cleared except by a check that has reported it,
   * so an error that arrives between two checks still lands on the one after.
   */
  #watchDevice(renderer: IRendererLike): void {
    const device = (renderer.raw as { backend?: { device?: IDeviceLike } })?.backend?.device;
    if (device === undefined || this.#watched) return;
    this.#watched = true;
    const previous = device.onuncapturederror;
    device.onuncapturederror = (event: unknown): void => {
      this.#deviceError = uncapturedMessage(event);
      if (typeof previous === "function") previous.call(device, event);
    };
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

  /**
   * Every storage buffer with the WGSL type the kernel binds it as, so the allocation can be held
   * against the declaration without reading a pipeline.
   *
   * WebGPU refuses a bind whose buffer is under one element of its declared type, and the refusal is
   * an uncaptured validation error: the dispatch is invalid, the counts stay whatever the clear pass
   * wrote, and nothing downstream of it is measurable. The check is here because a run proved the
   * other way that a validation line reading `ok` over a kernel that had never run is worth less than
   * no line at all.
   */
  footprint(): Record<string, IGpuSceneBufferFootprint> {
    const out: Record<string, IGpuSceneBufferFootprint> = {};
    if (this.#buffers === undefined) return out;
    for (const [name, type] of [
      ...Object.entries(STORAGE_PLAIN),
      ["args", "uint"],
      ["drawn", "mat4"],
    ] as [BufferName, StorageType][]) {
      const buffer = this.#buffers[name] as BufferAttribute;
      out[name] = { type, count: buffer.count, bytes: buffer.array.byteLength };
    }
    return out;
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
   * A region is assigned once and never moves its args record, because `firstInstance` is written
   * into that record on the CPU and read by the draw. A key that outgrew its region is regrown into
   * a larger one at the tail, which is the only structural change a walk makes — and a key that is
   * one of a level's parts is regrown with its siblings, because the kernel addresses a level's parts
   * as one contiguous run and a part that moved alone would break that run. See {@link levelKeys}.
   */
  key(name: string, local: Float32Array, capacity: number, level?: ILevelKey): number | undefined {
    if (level !== undefined) return this.#levelKey(name, local, capacity, level);
    const existing = this.#keysByName.get(name);
    if (existing !== undefined) {
      const region = this.#regions[existing] as IRegion;
      if (region.capacity >= capacity) return existing;
      // A regrow: the old region is abandoned, the new one is the tail, and the args record's
      // `firstInstance` moves with it. Structural, so a bundle version may be bumped for it.
      this.#keysByName.set(name, this.#regions.length);
      this.#regions.push({ ...region, name, start: this.#drawnCapacity, capacity });
      this.#drawnCapacity += capacity;
      const regrown = this.#regions.length - 1;
      this.#growOf("keys", regrown + 1);
      this.#growOf("locals", regrown + 1);
      this.#growOf("args", (regrown + 1) * DRAW_ARGS_WORDS);
      this.#growDrawn();
      this.#writeKey(this.#regions.length - 1);
      return this.#regions.length - 1;
    }
    this.#ensure();
    const index = this.#mintRegion(name, local, capacity);
    this.#keysByName.set(name, index);
    return index;
  }

  /**
   * One region at the tail of the key index space, with its own args record and its own drawn run,
   * and every buffer wide enough to name it.
   *
   * The key index, the args record and the drawn run all move together here. A part that takes a
   * claimed slot replaces the region already standing there rather than pushing a new one, so it
   * inherits the args record the slot was written against and no geometry's indirect offset moves.
   */
  #mintRegion(name: string, local: Float32Array, capacity: number): number {
    const index = this.#regions.length;
    this.#regions.push({
      argsIndex: index,
      capacity,
      indexCount: 0,
      local,
      name,
      start: this.#drawnCapacity,
    });
    this.#drawnCapacity += capacity;
    this.#growOf("keys", index + 1);
    this.#growOf("locals", index + 1);
    this.#growOf("args", (index + 1) * DRAW_ARGS_WORDS);
    this.#growDrawn();
    this.#writeKey(index);
    return index;
  }

  /**
   * One part of a level, in the level's own run: minted into the slot `firstKey + part` names, and
   * regrown with its siblings.
   *
   * The run is what makes `firstKey + part` mean the right key, so it is claimed whole at the level's
   * first key and read back through {@link levelKeys} rather than by the caller remembering which
   * index it saw first. A part of the level nothing has asked for yet holds its slot as a
   * capacity-zero region: the gate table names the whole run, the kernel reads a part's capacity
   * before it writes into it, and a part with no mesh draws nothing at its own index. Each part
   * keeps its own args record, so minting a later part re-lays no indirect offset and re-dresses no
   * mesh.
   */
  #levelKey(
    name: string,
    local: Float32Array,
    capacity: number,
    level: ILevelKey,
  ): number | undefined {
    if (this.#ensure() === undefined) return undefined;
    let held = this.#groups.get(level.group);
    if (held === undefined) {
      held = {
        capacity,
        firstKey: this.#regions.length,
        minted: new Map<number, number>(),
        parts: level.parts,
      };
      this.#groups.set(level.group, held);
      for (let part = 0; part < level.parts; part += 1)
        this.#mintRegion(`${level.group}:${String(part)}`, NO_LOCAL, 0);
    }
    // A part the level did not declare is refused rather than laid over the next level's key, which
    // is the one mistake this method exists to stop.
    if (level.part >= held.parts) return undefined;
    if (capacity > held.capacity) held.capacity = capacity;
    const index = held.firstKey + level.part;
    const slot = this.#regions[index] as IRegion;
    this.#keysByName.set(name, index);
    this.#regions[index] = {
      argsIndex: index,
      capacity: held.capacity,
      indexCount: slot.indexCount,
      local,
      name,
      start: slot.start,
    };
    held.minted.set(level.part, index);
    this.#drawnCapacity = this.#layoutGroup(held);
    this.#growDrawn();
    // The live buffers, not the ones this method read: a regrow above may have replaced them.
    for (const at of held.minted.values()) this.#writeKey(at);
    return index;
  }

  /**
   * The keys one level's parts draw into, which is what the gate table needs and the kernel assumes.
   *
   * The run the level claimed, read back rather than measured off the parts that happen to be
   * minted: measuring it is what let another level's keys inside a run whose parts were minted apart.
   */
  levelKeys(group: string): { readonly firstKey: number; readonly parts: number } | undefined {
    const held = this.#groups.get(group);
    if (held === undefined || held.minted.size === 0) return undefined;
    return { firstKey: held.firstKey, parts: held.parts };
  }

  /**
   * Lay one level's minted parts out contiguously at the tail, and answer where the buffer now ends.
   *
   * Every part moves together, so a level's drawn runs are one run however many parts it has and in
   * whatever order they were minted. A part already where the layout puts it is left alone, which is
   * every frame of a settled walk.
   */
  #layoutGroup(held: ILevelGroup): number {
    const ordered = [...held.minted.entries()].sort((one, other) => one[0] - other[0]);
    let start = this.#drawnCapacity;
    for (const [, index] of ordered) {
      const region = this.#regions[index] as IRegion;
      region.start = start;
      region.capacity = held.capacity;
      start += held.capacity;
    }
    return start;
  }

  /** The region one key draws from, for the counters and the tests. */
  regionOf(name: string): IRegion | undefined {
    const index = this.#keysByName.get(name);
    return index === undefined ? undefined : this.#regions[index];
  }

  /**
   * The index count the dressed geometry draws with, recorded against the key the owner dressed.
   *
   * A `DrawIndexedIndirect` record names no triangles at all when its `indexCount` is zero, and the
   * scene cannot know what shape a key draws: the owner holds the geometry. So the owner says, and
   * the validation holds the record against what it said — a draw that is submitted, counted, and
   * draws nothing is the one failure a count cannot see.
   */
  indexCount(name: string, count: number): void {
    const index = this.#keysByName.get(name);
    if (index === undefined) return;
    (this.#regions[index] as IRegion).indexCount = count;
    // The record is what the GPU draws from: a count kept only for validation left every indirect
    // draw at `indexCount` 0, submitted and counted, drawing nothing.
    this.#writeKey(index);
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

  /**
   * The asset id a slot index names, which is how the owner looks its own live gates up.
   *
   * The identity and nothing else: no distance, no cull, no level — the check that must not read
   * this class's tables gets its numbers from the owner and comes here only for the name of the
   * asset a placement belongs to, which the placement itself does not carry.
   */
  slotAsset(slot: number): string | undefined {
    return this.#order[slot];
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
    if (
      this.#validate === true &&
      this.#validating === false &&
      this.#dispatched % VALIDATE_EVERY === 0
    )
      this.#compare(renderer);
  }

  /**
   * What the last landed readback found, so a harness can read the answer without the log: the
   * verdict, how many keys it actually compared, how many disagreed on the count, how many on what
   * the draw reads, how many dressed meshes drew instances their own key never owned, and the lines.
   */
  get validation(): {
    readonly verdict: GpuSceneVerdict;
    readonly compared: number;
    readonly mismatched: number;
    readonly matricesMismatched: number;
    readonly meshMismatched: number;
    readonly lines: readonly string[];
  } {
    return {
      verdict: this.#verdict,
      compared: this.#compared,
      mismatched: this.#mismatches,
      matricesMismatched: this.#matrixMismatches,
      meshMismatched: this.#meshMismatches,
      lines: this.#lines,
    };
  }

  /**
   * Where the independent per-mesh check gets the CPU path's own records, registered once by the
   * owner and asked only on a check's frame.
   *
   * The scene cannot answer this for itself: the records are the owner's, and the meshes whose
   * indirect offsets are the question are the owner's too. It is asked inside {@link compare}, before
   * the readback is issued, so the instances it compares are the ones the dispatch just read rather
   * than whatever the cells hold when the bytes land — the same snapshot rule the rest of the check
   * is built on, and the reason a walk that streams while a readback is in flight cannot make the
   * check compare two different worlds.
   */
  drawsFrom(provider: () => readonly IMeshDraw[]): void {
    this.#draws = provider;
  }

  #draws: (() => readonly IMeshDraw[]) | undefined;
  #mismatches = 0;
  #matrixMismatches = 0;
  #meshMismatches = 0;
  #compared = 0;
  #verdict: GpuSceneVerdict = "ok";
  #lines: string[] = [];
  #validate = false;
  #validating = false;
  #watched = false;
  /**
   * The main meshes the owner has dressed against these buffers, and the main meshes it holds. It is
   * the owner's, not this class's: a scene that reports itself on over a ring it never dressed was
   * invisible from here, and `dressed=0/21094` is what a real run printed. See {@link announce}.
   */
  #census = { dressed: 0, meshes: 0 };
  /** The device's last uncaptured error, reported by the next check and then cleared. */
  #deviceError = "";

  /**
   * Read the indirect args and the compacted matrices back and hold both against the reference, over
   * the placements, camera and gate table the dispatch just read — copied at this moment, in this
   * turn, so a structural change landing while the bytes are in flight changes nothing about what
   * they are held against.
   *
   * The reference is {@link cullAndSelect} on the CPU, so this is the kernel measured against the
   * loop it mirrors — the only place the TSL itself is ever checked. It costs two queue submissions
   * and two mapped buffers every {@link VALIDATE_EVERY} dispatches, which is why it is a mode and
   * not a default: a game never pays for it and a walk is never measured with it on. One check is in
   * flight at a time, so every report answers a dispatch of its own.
   *
   * The counts alone are not the draw: a key can land every instance it owes into a record whose
   * `firstInstance` points at the wrong run, or whose `indexCount` names no triangle, or into a
   * region the mesh does not read — and a real WebGPU walk printed `ok` over 200 keys whose
   * `indexCount` was zero, with the forest it was supposed to draw missing from the picture and its
   * shadows still on the ground. So the matrices are read back too, and the same check that reads
   * them holds the record's two CPU-owned words against what the key's geometry and layout say.
   *
   * And the third check reads nothing this file wrote: the owner's own dressed meshes, each with the
   * indirect record its own geometry points at, against the instances the owner's own CPU path
   * composes for the key that mesh is named. Both families above can only confirm that the kernel
   * and the reference agree, which a wrong key-to-record mapping makes them agree on; only these two
   * were not written by the same hand. See {@link compareMeshDraws}.
   */
  #compare(renderer: IRendererLike): void {
    const snapshot = this.#snapshot();
    const reference = cullAndSelect(snapshot);
    // Taken now, with the snapshot, and not when the readback lands: see `drawsFrom`.
    const draws = this.#draws?.() ?? [];
    this.#validating = true;
    Promise.all([renderer.readback(snapshot.args), renderer.readback(snapshot.drawn)])
      .then(([argsBytes, drawnBytes]) => {
        this.#validating = false;
        this.#publish(
          renderer,
          this.#against(
            snapshot,
            reference,
            new Uint32Array(argsBytes),
            new Float32Array(drawnBytes),
            draws,
          ),
        );
      })
      .catch((reason: unknown) => {
        // A readback that never lands is a check that never ran, and saying so is the whole point:
        // this line used to end the chain and leave the last verdict standing as if it were fresh.
        this.#validating = false;
        this.#publish(renderer, {
          cause: `readback-failed: ${String(reason instanceof Error ? reason.message : reason)}`,
          compared: 0,
          deviceError: this.#deviceError,
          instancesCpu: 0,
          instancesGpu: 0,
          matricesMismatched: 0,
          meshMismatched: 0,
          meshMismatches: [],
          mismatched: 0,
          mismatches: [],
          matrixMismatches: [],
          placed: snapshot.placed,
        });
      });
  }

  /**
   * A copy of everything the dispatch that is running right now reads: the source records, the slot
   * and gate tables, the region and args layout, the frustum planes and the eye.
   *
   * One flat array holds the placement records and each copy is a view into it, so a twenty-thousand
   * placement walk costs one allocation rather than forty thousand. The gate and region tables are
   * copied shallowly, which is whole: an asset's gate definition is replaced rather than edited, and
   * a region is spread into a fresh object, so nothing reachable from a snapshot can move under it.
   */
  #snapshot(): IValidationSnapshot {
    const flat = new Float32Array(this.placements.length * PLACEMENT_WORDS);
    const placements = this.placements.map((placement, index) => {
      const at = index * PLACEMENT_WORDS;
      flat.set(placement.matrix, at);
      flat.set(placement.centre, at + LOCAL_WORDS);
      return {
        centre: flat.subarray(at + LOCAL_WORDS, at + LOCAL_WORDS + 4),
        matrix: flat.subarray(at, at + LOCAL_WORDS),
        slot: placement.slot,
      };
    });
    return {
      args: this.#buffers?.args,
      camera: {
        planes: this.#planes.slice(),
        x: this.#eye.value.x,
        y: this.#eye.value.y,
        z: this.#eye.value.z,
      },
      count: placements.length,
      drawn: this.#buffers?.drawn,
      placed: this.#live,
      placements,
      regionCount: this.#regions.length,
      regions: this.#regions.map((region) => ({ ...region, local: region.local.slice() })),
      slots: this.gates().map((slot) => ({ ...slot })),
    };
  }

  /** One readback's bytes against its own dispatch's reference: the counts, then the draw, then the meshes. */
  #against(
    snapshot: IValidationSnapshot,
    reference: IKernelResult,
    gpu: Uint32Array,
    drawn: Float32Array,
    draws: readonly IMeshDraw[],
  ): IGpuSceneComparison {
    const mismatches: string[] = [];
    const matrixMismatches: string[] = [];
    let mismatched = 0;
    let matricesMismatched = 0;
    let instancesGpu = 0;
    let instancesCpu = 0;
    for (const [index, region] of snapshot.regions.entries()) {
      const record = region.argsIndex * DRAW_ARGS_WORDS;
      // A readback that landed short is a mismatch, not a hole in the report: `word` reads out of
      // range as the zero a record that was never written holds.
      const landed = word(gpu, record + 1);
      const expected = reference.counts[index] as number;
      instancesGpu += landed;
      instancesCpu += expected;
      if (landed !== expected) {
        mismatched += 1;
        if (mismatches.length < VALIDATE_REPORTED_KEYS)
          mismatches.push(
            `${region.name ?? `#${String(index)}`} gpu=${String(landed)} cpu=${String(expected)}`,
          );
      }
      const firstInstance = word(gpu, record + 4);
      const indexCount = word(gpu, record);
      const agrees =
        firstInstance === region.start &&
        indexCount === region.indexCount &&
        sameMatrices(
          drawn,
          firstInstance,
          landed,
          reference.drawn,
          region.start,
          expected,
          MATRIX_TOLERANCE,
        );
      if (agrees) continue;
      matricesMismatched += 1;
      if (matrixMismatches.length < MATRIX_REPORTED_KEYS)
        matrixMismatches.push(
          `${region.name ?? `#${String(index)}`} ` +
            `first gpu=${xyz(drawn, firstInstance)} cpu=${xyz(reference.drawn, region.start)} ` +
            `firstInstance gpu=${String(firstInstance)} expected=${String(region.start)} ` +
            `indexCount gpu=${String(indexCount)} expected=${String(region.indexCount)}`,
        );
    }
    // Off the snapshot's own regions: which key each mesh is, which record it reads and what it
    // should be holding are the owner's numbers, and the whole point is that nothing in this file
    // chose them.
    const meshes = compareMeshDraws(gpu, drawn, draws, snapshot.regions);
    return {
      compared: snapshot.regions.length,
      deviceError: this.#deviceError,
      instancesCpu,
      instancesGpu,
      matricesMismatched,
      meshMismatched: meshes.mismatched,
      meshMismatches: meshes.mismatches,
      mismatched,
      mismatches,
      matrixMismatches,
      placed: snapshot.placed,
    };
  }

  /** One verdict, stored for a harness to read and printed once, with its cause if it failed. */
  #publish(renderer: IRendererLike, input: IGpuSceneComparison): void {
    const report = validationReport(input);
    this.#verdict = report.verdict;
    this.#compared = input.compared;
    this.#mismatches = input.mismatched;
    this.#matrixMismatches = input.matricesMismatched;
    this.#meshMismatches = input.meshMismatched;
    this.#lines = [...report.lines];
    // Reported, so cleared: an error is folded into exactly the check that saw it.
    this.#deviceError = "";
    const name =
      "log" in renderer ? (renderer.log as ((message: string) => void) | undefined) : undefined;
    const say = typeof name === "function" ? name : console.info.bind(console);
    say(report.line);
    for (const line of report.lines) say(`TN_WORLD_GPU_SCENE_VALIDATE ${line}`);
  }

  dispose(): void {
    this.#kernel = undefined;
    this.#buffers = undefined;
    this.placements.length = 0;
    this.#regions.length = 0;
    this.#keysByName.clear();
    this.#slotsByAsset.clear();
    this.#groups.clear();
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
      args: storageAttribute(IndirectStorageBufferAttribute, "uint", DRAW_ARGS_WORDS, Uint32Array),
      // One whole `mat4` per instance, which is also what a dressed batch's `instanceMatrix` has to
      // be: this attribute is four words per instance, the kernel bound it as a `mat4`, and a
      // one-instance buffer of it was 16 bytes against a 64-byte minimum, so the device refused
      // every dispatch and the kernel never ran. See `storageAttribute`.
      drawn: storageAttribute(StorageInstancedBufferAttribute, "mat4", 1),
      gates: storageAttribute(StorageBufferAttribute, "vec4", 1),
      keys: storageAttribute(StorageBufferAttribute, "vec4", 1),
      levels: storageAttribute(StorageBufferAttribute, "vec4", 1),
      locals: storageAttribute(StorageBufferAttribute, "mat4", 1),
      source: storageAttribute(StorageBufferAttribute, "GpuPlacement", SOURCE_FLOOR),
    };
    this.#version += 1;
    return this.#buffers;
  }

  /**
   * Grow one of the scene's own storage buffers by doubling, or leave it when it already has room.
   *
   * `needed` is a count of elements of the type the kernel declares that buffer as, never a word
   * count and never a stride: the element size comes from {@link storageAttribute} and the count is
   * the only thing a caller may choose. Each of these is read by a built kernel or named by a
   * geometry's `setIndirect`, so a swap is structural — the kernel is a new pipeline and the main
   * meshes are re-dressed against the new attribute. That is why the buffers start at one and
   * double: a key or a placement arriving is the event, and a frame never reallocates.
   */
  #growOf(name: BufferName, needed: number): boolean {
    const buffers = this.#buffers;
    if (buffers === undefined) return false;
    const current = buffers[name] as BufferAttribute;
    if (current.count >= needed) return true;
    let capacity = Math.max(1, current.count);
    while (capacity < needed) capacity *= 2;
    // The allocation `#ensure` made, at the new count, so a regrow cannot land a different class or
    // a different element size than the pipeline the kernel was built against.
    const grown =
      name === "args"
        ? storageAttribute(IndirectStorageBufferAttribute, "uint", capacity, Uint32Array)
        : name === "drawn"
          ? storageAttribute(StorageInstancedBufferAttribute, "mat4", capacity)
          : storageAttribute(StorageBufferAttribute, STORAGE_PLAIN[name], capacity);
    grown.array.set(current.array as Uint32Array);
    grown.addUpdateRange(0, current.array.length);
    this.#buffers = { ...buffers, [name]: grown };
    // The attributes the kernel is built from changed, so the kernel is a new pipeline: a structural
    // event, and the only one this class pays a compile for.
    this.#kernel = undefined;
    this.#version += 1;
    return true;
  }

  #growDrawn(): void {
    this.#growOf("drawn", this.#drawnCapacity);
  }

  #reserve(count: number): boolean {
    // A ring-sized floor, so the first few placements do not each pay a reallocation.
    return this.#growOf("source", Math.max(SOURCE_FLOOR, count));
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
    const record = region.argsIndex * DRAW_ARGS_WORDS;
    args[record] = region.indexCount;
    args[record + 1] = 0;
    args[record + 2] = 0;
    args[record + 3] = 0;
    args[record + 4] = region.start;
    buffers.args.needsUpdate = true;
  }

  /**
   * Write the whole gate table, which only changes when an asset's levels are adopted.
   *
   * Sized before it is written, not after: the table holds one `vec4` per asset and per level, and
   * a write past the end of a `Float32Array` is a silent no-op. Growing afterwards and copying the
   * short array over the long one kept the first element and dropped the rest, which is a gate table
   * that reads as every asset having no levels and no cull distance.
   */
  #writeSlots(): void {
    if (this.#buffers === undefined) return;
    let levels = 0;
    for (const asset of this.#order)
      levels += (this.#slotsByAsset.get(asset) as IAssetSlot).levels.length;
    this.#growOf("gates", Math.max(1, this.#order.length));
    this.#growOf("levels", Math.max(1, levels));
    const live = this.#buffers;
    if (live === undefined) return;
    const gates = live.gates.array as Float32Array;
    const levelTable = live.levels.array as Float32Array;
    let level = 0;
    for (const [slot, asset] of this.#order.entries()) {
      const definition = this.#slotsByAsset.get(asset) as IAssetSlot;
      const first = level;
      for (const [index, gate] of definition.levels.entries()) {
        const at = level * VEC4_WORDS;
        levelTable[at] = definition.distances[index] ?? 0;
        levelTable[at + 1] = gate.firstKey;
        levelTable[at + 2] = gate.parts;
        levelTable[at + 3] = 0;
        level += 1;
      }
      const at = slot * VEC4_WORDS;
      gates[at] = first;
      gates[at + 1] = definition.levels.length;
      gates[at + 2] = definition.cull ?? 0;
      gates[at + 3] = definition.cull === undefined ? 0 : 1;
    }
    live.gates.needsUpdate = true;
    live.levels.needsUpdate = true;
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
      const slot = placement.get("info").x;
      If(slot.lessThan(0.0), () => Return());
      If(slot.greaterThanEqual(counts.y), () => Return());
      const radius = centre.w;
      for (const plane of planes)
        If(plane.dot(centre.xyz).lessThan(radius.negate()), () => Return());
      const gate = gates.element(slot);
      const distance = length(vec3(centre.x.sub(eye.x), 0.0, centre.z.sub(eye.z)));
      If(gate.w.greaterThan(0.5).and(distance.greaterThan(gate.z)), () => Return());
      // The level, by the same ascending test the CPU runs: the last gate the placement is past.
      // The loop is bounded by `gate.y` rather than unrolled, because a baked chain can carry more
      // levels than any fixed count, and a level the loop stopped short of is a placement drawn at
      // the wrong shape by however many levels it missed.
      const level = int(0).toVar();
      Loop({ start: int(1), end: gate.y, type: "int", condition: "<" }, ({ i }: { i: unknown }) => {
        If(distance.greaterThan(levels.element(gate.x.add(i as never)).x), () => {
          level.assign(i as never);
        });
      });
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
      `instances=${String(report.instances)} keys=${String(report.keys)} ` +
      `dressed=${String(this.#census.dressed)}/${String(this.#census.meshes)}`;
    if (typeof name === "function") name(line);
    else console.info(line);
  }
}
