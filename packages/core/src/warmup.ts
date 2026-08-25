import type { Camera, Object3D } from "three";

/**
 * Compiles a scene's pipelines before the first frame, in slices, yielding between them.
 *
 * On a phone every distinct pipeline is built the first time something using it is drawn. Nothing
 * spreads that cost: the first `render()` of a fully built scene compiles all of it, on the main
 * loop, inside one frame. Measured on a Pixel 8, `sandbox/fps-framework` spent **24.5 seconds
 * across 107 pipeline compiles** inside a single frame — 92 % of everything the launch-stall
 * budget could attribute (`TN_STALL_SEGMENTS`, PRD-218). For that whole span the loop presented
 * nothing, drained no UI messages and ran no callback, so the loading screen froze mid-animation
 * and the game read as hung. The player's report was "the loading screen takes thirty seconds".
 *
 * This does not make the compiling cheaper — the same pipelines are built either way, and a claim
 * otherwise would be a lie the next measurement catches. What it changes is **who waits and
 * whether anything moves**: the work is cut into slices with a frame between them, so the loop
 * presents, the loading screen animates, the UI bridge delivers, and progress is a number the game
 * can show instead of a static label. A cost that cannot be removed must at least be visible; that
 * is the whole of what this buys, and it is worth saying plainly.
 *
 * The slices are compiled through the renderer's own `compileAsync`, which is stock `three`.
 * Nothing here mutates the scene: no reparenting, no temporary groups, no visibility flipping. A
 * warm-up that edited the graph to compile it would be a correctness risk taken for a progress
 * bar, and the object it handed back would not be the one the game authored.
 */

/** One renderable's worth of progress, reported as the warm-up advances. */
export interface IWarmUpProgress {
  /** Distinct pipelines warmed so far. */
  readonly done: number;
  /** Distinct pipelines the warm-up will build in total. Known before the first slice. */
  readonly total: number;
}

export interface IWarmUpOptions {
  /**
   * Distinct pipelines compiled between yields. Default 24.
   *
   * The trade is presented frames against total warm-up time: every yield costs one frame's
   * present, and a slice of one would spend more time presenting than compiling. 24 puts a frame
   * on the screen roughly every 30 objects' worth of work while adding a handful of presents to
   * the launch.
   */
  readonly sliceSize?: number;
  /** Called after each slice. Never called with `done` greater than `total`. */
  readonly onProgress?: (progress: IWarmUpProgress) => void;
  /**
   * How the warm-up lets the host present between slices. Defaults to yielding one macrotask,
   * which is one native-runtime loop iteration and therefore one presented frame. A caller that
   * knows its host wants a different signal passes one; a test passes a resolved promise.
   */
  readonly yieldFrame?: () => Promise<void>;
  /**
   * How long one pipeline may take before the warm-up gives up on it. Default 2000 ms.
   *
   * A real compile on a Pixel 8 measured ~77 ms; two seconds is a compile that is not coming back.
   */
  readonly compileTimeoutMs?: number;
  /**
   * How long the whole warm-up may take before it stops and lets the game start. Default 15000 ms.
   *
   * The launch must never be *worse* for having tried to optimize it.
   */
  readonly budgetMs?: number;
}

/** What the warm-up did, so a caller can report it rather than assume it. */
export interface IWarmUpReport {
  /** Distinct pipelines warmed — one representative object each, not one per renderable. */
  readonly compiled: number;
  /** Slices the work was cut into, and therefore the frames the loop got to present. */
  readonly slices: number;
  /** Wall-clock milliseconds the warm-up took, compiling and yielding together. */
  readonly elapsedMs: number;
  /**
   * True when the renderer had no `compileAsync` to call — a WebGL renderer, or a stub.
   *
   * Reported rather than silently skipped: "the warm-up ran and found nothing to do" and "this
   * renderer cannot warm up" produce the same zero, and only one of them is a reason a launch
   * still stalls.
   */
  readonly unsupported: boolean;
  /**
   * Pipelines whose compile never came back inside `compileTimeoutMs`, and pipelines never
   * reached because the whole warm-up ran out of budget.
   *
   * Reported, never thrown. A warm-up is an optimization on the launch path: the one thing it must
   * never do is stop the game from starting, and the first version of this did exactly that — a
   * `compileAsync` that never resolved on the device left `#boot` awaiting forever, so the loop
   * stayed held, the simulation never advanced and the game sat on its loading screen. A launch
   * that is slower than it could be is a disappointment; a launch that never finishes is a bug.
   */
  readonly abandoned: number;
  /** True when the overall budget ran out before every pipeline was warmed. */
  readonly timedOut: boolean;
}

/** The narrow slice of the renderer this needs. Structural so a test needs no renderer. */
export interface IWarmUpRenderer {
  compileAsync?: (scene: Object3D, camera: Camera, targetScene?: Object3D) => Promise<void>;
}

const DEFAULT_SLICE_SIZE = 24;
const DEFAULT_COMPILE_TIMEOUT_MS = 2000;
const DEFAULT_BUDGET_MS = 15000;

/**
 * Resolves when `work` settles or when `limitMs` elapses, whichever comes first.
 *
 * Returns whether the work actually finished, because "compiled" and "gave up waiting" are
 * different facts and the report has to be able to tell them apart.
 */
async function within(work: Promise<unknown>, limitMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), limitMs);
  });
  try {
    // A rejected compile is a pipeline this warm-up could not build, not a reason to fail the
    // launch: the frame that needs it will try again and fail there, where the error belongs.
    return await Promise.race([
      work.then(
        () => true,
        () => false,
      ),
      expiry,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Hands the host one loop iteration, so it can present a frame, and never waits on anything.
 *
 * Two wrong versions came before this one, and both are worth keeping written down.
 *
 * Awaiting `requestAnimationFrame` **deadlocks**. Boot is what schedules frames, so on a host
 * where frames are pumped by the same code waiting for boot to finish, the warm-up waits for a
 * callback that cannot run until it stops waiting. The playtest harness is exactly that: its
 * `requestAnimationFrame` pushes the callback onto an array the test drains *after* `start()`
 * resolves. Two suite tests hung for their full timeout.
 *
 * Racing `requestAnimationFrame` against a timer fixes the hang but **registers a frame callback
 * that is not the loop's**, which reorders the frame sequence any harness driving rAF by hand
 * observes. It turned a 16 ms frame into a 32 ms one in the performance suite.
 *
 * So the warm-up asks for no frame at all: it yields the thread and lets the host's own loop do
 * what it was already going to do. On the native runtime — the platform where the 24.5 second
 * stall this exists for actually lives — one macrotask is exactly one loop iteration, which runs
 * the animation-frame callbacks and presents. Nothing is registered, nothing is waited on, and
 * the loop's frame sequence is the one the loop authored.
 */
const yieldToHost = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

interface IPipelineTraits {
  material?: unknown;
  isSkinnedMesh?: boolean;
  isInstancedMesh?: boolean;
  isBatchedMesh?: boolean;
  isPoints?: boolean;
  isLine?: boolean;
  isSprite?: boolean;
  morphTargetInfluences?: unknown;
  geometry?: { attributes?: Record<string, unknown> };
}

/**
 * A key for "these two objects compile to the same pipeline".
 *
 * The measurement that shaped this: the Pixel 8 scene had **835 renderables and 107 pipeline
 * compiles**. Compiling every object would make 835 calls to warm 107 pipelines — 728 of them
 * cache lookups whose only effect is to slow the warm-up down and add yields nobody sees. One
 * representative per distinct pipeline does the same work in an eighth of the calls.
 *
 * The traits are the ones `three`'s WebGPU backend actually branches a pipeline on: the material,
 * whether the object is skinned, instanced, batched or a non-mesh primitive, whether it morphs,
 * and which vertex attributes its geometry carries. Keying on the material alone would miss the
 * skinned variant of a shared material, which is a real pipeline and a real compile.
 */
function pipelineKey(object: Object3D, materialIndex: Map<unknown, number>): string {
  const traits = object as Object3D & IPipelineTraits;
  const material = traits.material;
  let id = materialIndex.get(material);
  if (id === undefined) {
    id = materialIndex.size;
    materialIndex.set(material, id);
  }
  const attributes = traits.geometry?.attributes;
  // Sorted: attribute insertion order is an authoring detail, not a pipeline difference.
  const layout = attributes === undefined ? "" : Object.keys(attributes).sort().join(",");
  const flags =
    `${traits.isSkinnedMesh === true ? "s" : ""}${traits.isInstancedMesh === true ? "i" : ""}` +
    `${traits.isBatchedMesh === true ? "b" : ""}${traits.isPoints === true ? "p" : ""}` +
    `${traits.isLine === true ? "l" : ""}${traits.isSprite === true ? "r" : ""}` +
    `${Array.isArray(traits.morphTargetInfluences) ? "m" : ""}`;
  return `${id}|${flags}|${layout}`;
}

/**
 * Collects one representative object per distinct pipeline, in traversal order.
 *
 * Only renderables: a `Group` or a `Bone` carries no material, and compiling it would walk its
 * whole subtree again, turning a linear pass into a quadratic one on a deep scene.
 */
function collectRenderables(root: Object3D): Object3D[] {
  const found: Object3D[] = [];
  const seen = new Set<string>();
  const materialIndex = new Map<unknown, number>();
  const stack: Object3D[] = [root];
  while (stack.length > 0) {
    const object = stack.pop() as Object3D;
    const candidate = object as Object3D & IPipelineTraits;
    if (candidate.material !== undefined) {
      const key = pipelineKey(object, materialIndex);
      if (!seen.has(key)) {
        seen.add(key);
        found.push(object);
      }
    }
    const children = object.children;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index] as Object3D);
    }
  }
  return found;
}

/**
 * Warms up `scene` for `camera`, in slices, presenting a frame between each.
 *
 * Fail closed on a nonsensical slice size rather than quietly choosing one: a zero or negative
 * slice would loop forever, and a caller that passed it has a bug worth seeing now.
 * @situation compile a scene's shaders during the loading screen instead of on the first frame
 * @situation stop a native launch freezing for seconds inside its first rendered frame
 * @example await warmUpScene(renderer, scene, camera, { onProgress: (p) => setLoading(p) });
 */
export async function warmUpScene(
  renderer: IWarmUpRenderer,
  scene: Object3D,
  camera: Camera,
  options: IWarmUpOptions = {},
): Promise<IWarmUpReport> {
  const sliceSize = options.sliceSize ?? DEFAULT_SLICE_SIZE;
  if (!Number.isInteger(sliceSize) || sliceSize < 1) {
    throw new Error(
      `TN_WARMUP_SLICE_INVALID: sliceSize must be a whole number of objects of at least one, received ${String(
        options.sliceSize,
      )}.`,
    );
  }
  const compileTimeoutMs = options.compileTimeoutMs ?? DEFAULT_COMPILE_TIMEOUT_MS;
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  for (const [name, value] of [
    ["compileTimeoutMs", compileTimeoutMs],
    ["budgetMs", budgetMs],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        `TN_WARMUP_TIMEOUT_INVALID: ${name} must be a positive number of milliseconds, received ${String(value)}.`,
      );
    }
  }
  const now = (): number => globalThis.performance?.now() ?? Date.now();
  const startedAt = now();

  if (typeof renderer.compileAsync !== "function") {
    return {
      compiled: 0,
      slices: 0,
      elapsedMs: now() - startedAt,
      unsupported: true,
      abandoned: 0,
      timedOut: false,
    };
  }
  const compileAsync = renderer.compileAsync.bind(renderer);
  const yieldFrame = options.yieldFrame ?? yieldToHost;

  const renderables = collectRenderables(scene);
  const total = renderables.length;
  // Nothing to warm up is a real answer, not a reason to skip the report.
  if (total === 0) {
    options.onProgress?.({ done: 0, total: 0 });
    return {
      compiled: 0,
      slices: 0,
      elapsedMs: now() - startedAt,
      unsupported: false,
      abandoned: 0,
      timedOut: false,
    };
  }

  let slices = 0;
  let compiled = 0;
  let abandoned = 0;
  let timedOut = false;
  const deadline = startedAt + budgetMs;

  for (let index = 0; index < total; index += 1) {
    if (now() >= deadline) {
      // Out of budget. Everything still unwarmed is abandoned, and says so.
      timedOut = true;
      abandoned += total - index;
      break;
    }
    // Compiled one at a time, against the real scene so lights, fog and environment resolve
    // exactly as they will when the frame draws. `three` caches by material, so only the first
    // object using a given pipeline pays; the rest are a map lookup. That is what makes
    // per-object granularity affordable and lets the slice boundary be about presenting, not
    // about batching the compile.
    //
    // Bounded, because an unbounded await here is what held a real launch open forever.
    const finished = await within(
      compileAsync(renderables[index] as Object3D, camera, scene),
      Math.min(compileTimeoutMs, Math.max(0, deadline - now())),
    );
    if (finished) compiled += 1;
    else abandoned += 1;

    const done = index + 1;
    if (done % sliceSize === 0 || done === total) {
      slices += 1;
      options.onProgress?.({ done, total });
      // The frame the player actually sees. Skipped after the final slice: the caller is about to
      // render anyway, and one more empty frame would only add to the launch.
      if (done !== total) await yieldFrame();
    }
  }

  return {
    compiled,
    slices,
    elapsedMs: now() - startedAt,
    unsupported: false,
    abandoned,
    timedOut,
  };
}
