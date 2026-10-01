/**
 * Per-pass draw and triangle attribution, on by default, for every platform.
 *
 * The frame budget already owned the milliseconds; this owns the submissions. Three's
 * `renderer.info.reset()` runs once per frame before the world render, and a nested shadow or
 * reflection `renderer.render(...)` shares that same `info`, so `info.render` reports main plus
 * every nested pass combined. The aggregate cannot tell a 316-draw shadow lane from a 1,418-draw
 * colour pass, and every optimisation attempt had to hand-roll the split. This is the split: each
 * `render()` is one entry on a stack, and its own submissions are the counter delta across its
 * call minus the deltas of the nested calls it made, so the innermost active render call owns
 * exactly what it submitted.
 *
 * Three names its own shadow pass by temporarily renaming the scene to `Shadow Map [ ... ]`
 * (`renderShadow`), and a reflection pass names its scene with `Reflector` in it. Those are
 * borrowed, not invented: the classifier reads three's vocabulary and falls back to `nested`.
 *
 * Measurement, not policy: installing this alters no draw. `install` answers `undefined` on a
 * renderer whose `info.render` cannot be read, and a consumer must then report the pass split as
 * absent rather than zero.
 */

/** The named kinds of a render pass. Closed on purpose: a consumer bounds a known kind. */
export const FRAME_PASS_KINDS = ["main", "shadow", "reflection", "nested"] as const;

export type FramePassKind = (typeof FRAME_PASS_KINDS)[number];

/** One render call's own submissions, attributed to its innermost active render call. */
export interface IRenderPassSample {
  readonly draws: number;
  readonly kind: FramePassKind;
  readonly triangles: number;
}

interface IRenderCounters {
  readonly drawCalls?: number;
  readonly calls?: number;
  readonly triangles?: number;
}

/**
 * The slice of three's timestamp query pool this reads.
 *
 * Three keys one pool per query type (`render`, `compute`) at
 * `renderer.backend.timestampQueryPool`, and each pool exposes the two maps it fills in itself:
 * `queryOffsets` is the uid of every allocated pass (appended synchronously as the pass begins,
 * cleared when a resolve starts) and `timestamps` is every uid's resolved duration in
 * milliseconds, written when the asynchronous resolve lands. Both are three's own public fields,
 * not a borrowed internal, and reading them is what turns the one summed `info.render.timestamp`
 * into a per-pass number.
 */
export interface ITimestampQueryPool {
  readonly queryOffsets?: Map<string, number> | undefined;
  readonly timestamps?: Map<string, number> | undefined;
}

/**
 * The slice of a renderer this reads: the raw three renderer, not `IRendererLike`. It is
 * deliberately structural so the unit test can stand in a fake that nests exactly as three does.
 */
export interface IRenderPassTarget {
  readonly info?: { render?: IRenderCounters } | undefined;
  /**
   * Three's backend, for per-pass GPU time. Optional: a WebGL2 fallback and a test double may
   * carry no timestamp pool, and every GPU read is then absent rather than zero.
   */
  readonly backend?:
    | { readonly timestampQueryPool?: Record<string, ITimestampQueryPool | null> }
    | undefined;
  render(scene: unknown, camera: unknown): void;
}

/** One allocated timestamp query, before its duration resolves: the pass kind and three's uid. */
interface IGpuUidEntry {
  readonly kind: FramePassKind;
  readonly uid: string;
}

/** GPU milliseconds of a frame's main and shadow render passes, summed across each kind. */
export interface IGpuPassSplit {
  readonly main: number;
  readonly shadow: number;
}

interface IPassFrame {
  readonly entryDraws: number;
  readonly entryTriangles: number;
  readonly kind: FramePassKind;
  childDraws: number;
  childTriangles: number;
  /** Timestamp uids the nested calls this pass made allocated, in allocation order. */
  childUids?: string[];
}

function readCounters(target: IRenderPassTarget): { draws: number; triangles: number } | undefined {
  const render = target.info?.render;
  if (render === undefined) return undefined;
  const draws = render.drawCalls ?? render.calls;
  const triangles = render.triangles;
  if (typeof draws !== "number" || !Number.isFinite(draws) || draws < 0) return undefined;
  if (typeof triangles !== "number" || !Number.isFinite(triangles) || triangles < 0)
    return undefined;
  return { draws, triangles };
}

const installed = new WeakSet<object>();

/**
 * Resolved frames kept for GPU attribution. A resolve lags the frame it measures by a few frames,
 * so the uid list for a frame must outlive the frame that produced it; 64 frames is far more than
 * that lag and bounds the map on a game that never resolves.
 */
const GPU_UID_FRAME_LIMIT = 64;

/**
 * Names a render call by what three already calls it: the outermost call is the main camera, and a
 * nested call carries the scene name three or the reflector gave it.
 */
function passKind(scene: unknown, depth: number): FramePassKind {
  if (depth === 0) return "main";
  const name =
    typeof scene === "object" &&
    scene !== null &&
    typeof (scene as { name?: unknown }).name === "string"
      ? (scene as { name: string }).name
      : "";
  if (name.startsWith("Shadow Map")) return "shadow";
  if (/reflect/iu.test(name)) return "reflection";
  return "nested";
}

/**
 * Records one presented frame's passes. The owner calls `beginFrame` before the world render and
 * `passes()` after it; a nested render inside the world render is attributed without the owner
 * knowing it happened.
 */
export class RenderPassBudget {
  readonly #target: IRenderPassTarget;
  readonly #original: (scene: unknown, camera: unknown) => void;
  readonly #frame: IRenderPassSample[] = [];
  readonly #stack: IPassFrame[] = [];
  /** Timestamp uids each render call allocated, keyed by the Three.js frame they belong to. */
  readonly #gpuUids = new Map<number, IGpuUidEntry[]>();

  private constructor(target: IRenderPassTarget) {
    this.#target = target;
    this.#original = target.render;
    const instrumented = (scene: unknown, camera: unknown): void => {
      const counters = readCounters(target);
      if (counters === undefined) {
        this.#original.call(target, scene, camera);
        return;
      }
      const offsets = target.backend?.timestampQueryPool?.render?.queryOffsets;
      const allocatedBefore = offsets?.size ?? 0;
      const depth = this.#stack.length;
      const frame: IPassFrame = {
        childDraws: 0,
        childTriangles: 0,
        entryDraws: counters.draws,
        entryTriangles: counters.triangles,
        kind: passKind(scene, depth),
      };
      this.#stack.push(frame);
      try {
        this.#original.call(target, scene, camera);
      } finally {
        this.#stack.pop();
        const after = readCounters(target);
        if (after !== undefined) {
          const totalDraws = after.draws - frame.entryDraws;
          const totalTriangles = after.triangles - frame.entryTriangles;
          const parent = this.#stack[this.#stack.length - 1];
          if (parent !== undefined) {
            parent.childDraws += totalDraws;
            parent.childTriangles += totalTriangles;
          }
          this.#frame.push({
            draws: Math.max(0, totalDraws - frame.childDraws),
            kind: frame.kind,
            triangles: Math.max(0, totalTriangles - frame.childTriangles),
          });
        }
        this.#attributeGpu(frame, offsets, allocatedBefore);
      }
    };
    target.render = instrumented;
    installed.add(target);
  }

  /**
   * Instruments `target`'s `render` in place and answers the recorder, or `undefined` when the
   * renderer cannot report its own counters. Refuses a double install: one frame must not be
   * counted twice.
   */
  static install(target: IRenderPassTarget): RenderPassBudget | undefined {
    if (installed.has(target)) return undefined;
    if (readCounters(target) === undefined) return undefined;
    return new RenderPassBudget(target);
  }

  /**
   * The kind of the innermost render call currently running, or undefined outside one.
   *
   * A per-object diagnostic needs the same attribution this class already does: a mesh submitted
   * inside a shadow render is shadow work, and charging it to the main pass is how a shadow map
   * disappears from a cost report.
   */
  activeKind(): FramePassKind | undefined {
    return this.#stack[this.#stack.length - 1]?.kind;
  }

  /** Clears the previous frame's passes. Call before the frame's first world render. */
  beginFrame(): void {
    this.#frame.length = 0;
  }

  /**
   * The passes just recorded, children before the main call. The array is reused, so a consumer
   * reads it before the next `beginFrame`.
   */
  passes(): readonly IRenderPassSample[] {
    return this.#frame;
  }

  /**
   * GPU milliseconds of one resolved frame's own main and shadow passes, or `undefined` until the
   * frame's queries resolve and while no timestamp pool exists.
   *
   * A kind with no pass in the frame is zero, not absent: a frame that drew a main pass and no
   * shadow genuinely spent 0 ms on shadow, and the caller subtracts both from the frame's summed
   * `info.render.timestamp` to leave `other` (post chain, reflection, HUD). Entries are summed per
   * kind, so a shadow cascade's several passes are one number.
   */
  gpuPassMs(frame: number): IGpuPassSplit | undefined {
    const entries = this.#gpuUids.get(frame);
    const timestamps = this.#target.backend?.timestampQueryPool?.render?.timestamps;
    if (timestamps === undefined || entries === undefined) return undefined;
    let main = 0;
    let shadow = 0;
    let resolved = 0;
    for (const { kind, uid } of entries) {
      const ms = timestamps.get(uid);
      if (ms === undefined || !Number.isFinite(ms) || ms < 0) continue;
      resolved += 1;
      if (kind === "main") main += ms;
      else if (kind === "shadow") shadow += ms;
    }
    return resolved === 0 ? undefined : { main, shadow };
  }

  /**
   * Attributes the uids allocated during one render call to that call, not its parent, by the same
   * child-subtraction the draws get: a nested render's uids are claimed by the nested frame before
   * the parent computes its own, so `main` does not absorb a shadow's pass.
   */
  #attributeGpu(
    frame: IPassFrame,
    offsets: Map<string, number> | undefined,
    allocatedBefore: number,
  ): void {
    if (offsets === undefined || offsets.size <= allocatedBefore) return;
    const allocated: string[] = [];
    let index = 0;
    for (const uid of offsets.keys()) {
      index += 1;
      if (index > allocatedBefore) allocated.push(uid);
    }
    if (allocated.length === 0) return;
    const childUids = frame.childUids;
    const own =
      childUids === undefined ? allocated : allocated.filter((uid) => !childUids.includes(uid));
    const parent = this.#stack[this.#stack.length - 1];
    if (parent !== undefined) {
      parent.childUids ??= [];
      parent.childUids.push(...allocated);
    }
    for (const uid of own) this.#recordGpuUid(uid, frame.kind);
  }

  /** Files one allocated uid under the frame the uid names, dropping the oldest frames over time. */
  #recordGpuUid(uid: string, kind: FramePassKind): void {
    const match = /:f(\d+)$/u.exec(uid);
    if (match === null) return;
    const frame = Number(match[1]);
    const entries = this.#gpuUids.get(frame);
    if (entries === undefined) this.#gpuUids.set(frame, [{ kind, uid }]);
    else entries.push({ kind, uid });
    while (this.#gpuUids.size > GPU_UID_FRAME_LIMIT) {
      const oldest = this.#gpuUids.keys().next().value;
      if (oldest === undefined) break;
      this.#gpuUids.delete(oldest);
    }
  }
}
