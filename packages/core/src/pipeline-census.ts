/**
 * A bounded observation of the pipelines a Three.js renderer actually asked its backend to make.
 *
 * This module deliberately knows the shape of Three's private render object, but not its cache-key
 * algorithm. Three owns the identity; the collector only reads the object at the backend boundary
 * where a cache miss becomes a real device creation. That keeps a material label from becoming a
 * pipeline key and makes the same observation useful on browser WebGPU and the native binding.
 */

export const PIPELINE_CENSUS_VERSION = 1 as const;
export const PIPELINE_CENSUS_CAPABILITY = "runtime.pipelineCensus" as const;
export const DEFAULT_PIPELINE_CENSUS_LIMIT = 512;

export type PipelineCensusStatus = "created" | "failed" | "pending";
export type PipelineCensusMode = "sync" | "async";

export interface IPipelineShaderObservation {
  readonly bytes: number;
  readonly hash: string;
}

export interface IPipelineProvenance {
  readonly material?: {
    readonly id?: number;
    readonly name?: string;
    readonly type?: string;
  };
  readonly object?: {
    readonly id?: number;
    readonly name?: string;
    readonly uuid?: string;
  };
  /** True when no stable material/object label was available at the creation boundary. */
  readonly unknown: boolean;
}

export interface IPipelineCensusEvent {
  /** Monotonic sequence, useful for detecting a dropped event in a merged native log. */
  readonly sequence: number;
  /** Three's program identity: the generated vertex/fragment source pair. */
  readonly programIdentity: string;
  /** Backend identity, separate from the program identity and from the material label. */
  readonly pipelineIdentity: string;
  readonly kind: "compute" | "render";
  readonly pass: string;
  readonly mode: PipelineCensusMode;
  readonly status: PipelineCensusStatus;
  readonly vertex?: IPipelineShaderObservation;
  readonly fragment?: IPipelineShaderObservation;
  readonly compute?: IPipelineShaderObservation;
  readonly provenance: IPipelineProvenance;
  /** Structural inputs observed beside the generated shader, not a guessed reason. */
  readonly reasons: readonly string[];
  /** Host monotonic milliseconds relative to the capture origin. */
  readonly startedMs: number;
  readonly settledMs?: number;
  /** Synchronous device-call wall time; absent for an async promise. */
  readonly serviceMs?: number;
  /** Promise latency is retained as latency, never labelled native compiler time. */
  readonly promiseMs?: number;
  readonly error?: string;
  /** Whether this event settled before the first present boundary. */
  readonly beforeFirstPresent?: boolean;
}

export interface IPipelineCensusCounts {
  readonly lookups: number;
  readonly creations: number;
  readonly failures: number;
  readonly pending: number;
  readonly uniquePrograms: number;
  readonly uniquePipelines: number;
  readonly recordedEvents: number;
  readonly droppedEvents: number;
}

export interface IPipelineCensus {
  readonly version: typeof PIPELINE_CENSUS_VERSION;
  readonly complete: boolean;
  readonly overflowed: boolean;
  readonly unsupported: boolean;
  readonly limit: number;
  readonly clock: {
    readonly originMs: number;
    readonly source: "performance" | "date";
  };
  readonly backend: {
    readonly kind: "webgpu" | "webgl2";
    readonly identity: string;
  };
  readonly firstPresent?: {
    readonly boundaryMs: number;
    readonly eventsSettled: number;
  };
  readonly counts: IPipelineCensusCounts;
  readonly events: readonly IPipelineCensusEvent[];
  readonly incompleteReasons: readonly string[];
}

export interface IPipelineCensusOptions {
  readonly kind: "webgpu" | "webgl2";
  readonly limit?: number;
  readonly now?: () => number;
  readonly backendIdentity?: string;
}

interface IRenderObjectLike {
  readonly object?: unknown;
  readonly material?: unknown;
  readonly pipeline?: unknown;
  readonly context?: unknown;
  readonly scene?: unknown;
  readonly passId?: unknown;
  readonly getNodeBuilderState?: () => unknown;
}

interface IProgramLike {
  readonly code?: unknown;
  readonly id?: unknown;
  readonly stage?: unknown;
}

interface IPipelineLike {
  readonly cacheKey?: unknown;
  readonly vertexProgram?: IProgramLike;
  readonly fragmentProgram?: IProgramLike;
  readonly computeProgram?: IProgramLike;
  readonly isComputePipeline?: unknown;
}

interface IBackendLike {
  createRenderPipeline?: (...args: unknown[]) => unknown;
  createComputePipeline?: (...args: unknown[]) => unknown;
  get?: (value: unknown) => unknown;
}

interface IBackendDataLike {
  readonly pipeline?: unknown;
  readonly error?: unknown;
}

interface IRenderObjectContext {
  readonly pass?: unknown;
  readonly object?: unknown;
  readonly material?: unknown;
}

interface IActiveRenderObject {
  readonly clippingContext: unknown;
  readonly object: unknown;
  readonly material: unknown;
  readonly passId: unknown;
}

interface IMutableCensusEvent {
  sequence: number;
  programIdentity: string;
  pipelineIdentity: string;
  kind: "compute" | "render";
  pass: string;
  mode: PipelineCensusMode;
  status: PipelineCensusStatus;
  vertex?: IPipelineShaderObservation;
  fragment?: IPipelineShaderObservation;
  compute?: IPipelineShaderObservation;
  provenance: IPipelineProvenance;
  reasons: readonly string[];
  startedMs: number;
  settledMs?: number;
  serviceMs?: number;
  promiseMs?: number;
  error?: string;
  beforeFirstPresent?: boolean;
  /** Three's logical pipeline object, retained privately for backend data lookup. */
  backendPipeline?: unknown;
}

interface IInstalledBackend {
  readonly backend: IBackendLike;
  render?: (...args: unknown[]) => unknown;
  renderWrapper?: (...args: unknown[]) => unknown;
  compute?: (...args: unknown[]) => unknown;
  computeWrapper?: (...args: unknown[]) => unknown;
}

interface IRendererHookTarget {
  backend?: unknown;
  renderObject?: (...args: unknown[]) => unknown;
}

/**
 * Create and install a bounded census. The returned object is intentionally small: renderers own
 * lifecycle and callers only need `snapshot()`, `withRenderObject()`, and `firstPresent()`.
 */
export function createPipelineCensus(options: IPipelineCensusOptions): PipelineCensus {
  return new PipelineCensus(options);
}

export class PipelineCensus {
  readonly #kind: "webgpu" | "webgl2";
  readonly #limit: number;
  readonly #now: () => number;
  readonly #origin: number;
  readonly #clockSource: "performance" | "date";
  readonly #backendIdentity: string;
  readonly #events: IMutableCensusEvent[] = [];
  readonly #programs = new Set<string>();
  readonly #pipelines = new Set<string>();
  readonly #installed: IInstalledBackend[] = [];
  readonly #pipelineIds = new WeakMap<object, string>();
  readonly #backendPipelineIds = new WeakMap<object, string>();
  #activeRenderObject: IActiveRenderObject | undefined;
  #nextSequence = 1;
  #nextBackendPipelineIdentity = 1;
  #nextLogicalPipelineIdentity = 1;
  #lookups = 0;
  #creations = 0;
  #failures = 0;
  #pending = 0;
  #dropped = 0;
  #overflowed = false;
  #unsupported = false;
  #firstPresentMs: number | undefined;
  #eventsSettledAtFirstPresent = 0;
  #cleanup: (() => void) | undefined;

  constructor(options: IPipelineCensusOptions) {
    if (!Number.isInteger(options.limit) || (options.limit ?? DEFAULT_PIPELINE_CENSUS_LIMIT) <= 0) {
      if (options.limit !== undefined)
        throw new Error(`TN_PIPELINE_CENSUS_LIMIT_INVALID: ${String(options.limit)}`);
    }
    this.#kind = options.kind;
    this.#limit = options.limit ?? DEFAULT_PIPELINE_CENSUS_LIMIT;
    this.#now = options.now ?? defaultNow;
    this.#origin = this.#now();
    this.#clockSource = typeof globalThis.performance?.now === "function" ? "performance" : "date";
    this.#backendIdentity = options.backendIdentity ?? `${options.kind}:renderer`;
  }

  /** Install the backend creation hooks and the render-object context wrapper once. */
  install(backendValue: unknown): () => void {
    if (!isObject(backendValue)) {
      this.#unsupported = true;
      return () => undefined;
    }
    const backend = backendValue as IBackendLike;
    if (this.#installed.some((entry) => entry.backend === backend)) return () => undefined;
    const installed: IInstalledBackend = { backend };
    let changed = false;
    if (typeof backend.createRenderPipeline === "function") {
      const original = backend.createRenderPipeline;
      const wrapper = (...args: unknown[]): unknown =>
        this.#observeRenderCreation(backend, original, args);
      backend.createRenderPipeline = wrapper;
      installed.render = original;
      installed.renderWrapper = wrapper;
      changed = true;
    }
    if (typeof backend.createComputePipeline === "function") {
      const original = backend.createComputePipeline;
      const wrapper = (...args: unknown[]): unknown =>
        this.#observeComputeCreation(backend, original, args);
      backend.createComputePipeline = wrapper;
      installed.compute = original;
      installed.computeWrapper = wrapper;
      changed = true;
    }
    if (!changed) this.#unsupported = true;
    else this.#installed.push(installed);
    return () => {
      if (
        installed.render !== undefined &&
        backend.createRenderPipeline === installed.renderWrapper
      ) {
        backend.createRenderPipeline = installed.render;
      }
      if (
        installed.compute !== undefined &&
        backend.createComputePipeline === installed.computeWrapper
      ) {
        backend.createComputePipeline = installed.compute;
      }
      const index = this.#installed.indexOf(installed);
      if (index !== -1) this.#installed.splice(index, 1);
    };
  }

  /** Install every renderer-side hook owned by this capture. */
  installRenderer(renderer: IRendererHookTarget): void {
    if (this.#cleanup !== undefined) return;
    const restoreBackend = this.install(renderer.backend);
    const originalRenderObject = renderer.renderObject;
    let wrappedRenderObject: ((...args: unknown[]) => unknown) | undefined;
    if (originalRenderObject !== undefined) {
      const census = this;
      wrappedRenderObject = function (this: unknown, ...args: unknown[]): unknown {
        return census.withRenderObject(args, () => originalRenderObject.apply(this, args));
      };
      renderer.renderObject = wrappedRenderObject;
    }
    this.#cleanup = () => {
      if (wrappedRenderObject !== undefined && renderer.renderObject === wrappedRenderObject)
        renderer.renderObject = originalRenderObject;
      restoreBackend();
      this.#cleanup = undefined;
    };
  }

  /** Restore private hooks while retaining the immutable capture already recorded. */
  dispose(): void {
    this.#cleanup?.();
  }

  /** Wrap Three's public render-object method so compileAsync retains the authored pass id. */
  withRenderObject<T>(args: readonly unknown[], callback: () => T): T {
    const previous = this.#activeRenderObject;
    this.#activeRenderObject = {
      clippingContext: args[7],
      object: args[0],
      material: args[4],
      passId: args[8],
    };
    try {
      return callback();
    } finally {
      this.#activeRenderObject = previous;
    }
  }

  /** Mark the first renderer render call as the first-present boundary. */
  firstPresent(): void {
    if (this.#firstPresentMs !== undefined) return;
    const boundaryMs = this.#clock();
    this.#firstPresentMs = boundaryMs;
    this.#eventsSettledAtFirstPresent = this.#events.filter(
      (event) => event.settledMs !== undefined && event.settledMs <= boundaryMs,
    ).length;
  }

  snapshot(): IPipelineCensus {
    const incompleteReasons: string[] = [];
    if (this.#unsupported) incompleteReasons.push("backend creation observation unavailable");
    if (this.#overflowed) incompleteReasons.push("bounded event buffer overflowed");
    if (this.#pending > 0) incompleteReasons.push(`${this.#pending} pipeline event(s) are pending`);
    if (this.#failures > 0) incompleteReasons.push(`${this.#failures} pipeline creation(s) failed`);
    if (this.#creations === 0) incompleteReasons.push("no pipeline creations observed");
    for (const event of this.#events) {
      if (event.kind === "render" && event.vertex === undefined)
        incompleteReasons.push("a render pipeline is missing its vertex shader observation");
      if (event.kind === "compute" && event.compute === undefined)
        incompleteReasons.push("a compute pipeline is missing its shader observation");
    }
    if (this.#creations !== this.#events.length + this.#dropped)
      incompleteReasons.push("observed creation count does not reconcile with recorded events");
    const events = this.#events.map((event) => freezeEvent(event));
    return {
      version: PIPELINE_CENSUS_VERSION,
      complete: incompleteReasons.length === 0 && this.#creations > 0,
      overflowed: this.#overflowed,
      unsupported: this.#unsupported,
      limit: this.#limit,
      clock: { originMs: this.#origin, source: this.#clockSource },
      backend: { kind: this.#kind, identity: this.#backendIdentity },
      ...(this.#firstPresentMs === undefined
        ? {}
        : {
            firstPresent: {
              boundaryMs: this.#firstPresentMs,
              eventsSettled: this.#eventsSettledAtFirstPresent,
            },
          }),
      counts: {
        lookups: this.#lookups,
        creations: this.#creations,
        failures: this.#failures,
        pending: this.#pending,
        uniquePrograms: this.#programs.size,
        uniquePipelines: this.#pipelines.size,
        recordedEvents: this.#events.length,
        droppedEvents: this.#dropped,
      },
      events,
      incompleteReasons,
    };
  }

  #clock(): number {
    return Math.max(0, this.#now() - this.#origin);
  }

  #observeRenderCreation(
    backend: IBackendLike,
    original: (...args: unknown[]) => unknown,
    args: readonly unknown[],
  ): unknown {
    const renderObject = isObject(args[0]) ? (args[0] as IRenderObjectLike) : {};
    const pipeline = isObject(renderObject.pipeline)
      ? (renderObject.pipeline as IPipelineLike)
      : undefined;
    const vertex = shaderObservation(pipeline?.vertexProgram);
    const fragment = shaderObservation(pipeline?.fragmentProgram);
    const event = this.#beginEvent({
      backend,
      kind: "render",
      pipeline,
      vertex,
      fragment,
      renderObject,
      mode: args[1] === null ? "sync" : "async",
    });
    const started = this.#now();
    try {
      const result = original.apply(backend, [...args]);
      const promises = asyncPromises(args[1]);
      if (promises.length > 0) {
        event.mode = "async";
        event.status = "pending";
        this.#pending += 1;
        void Promise.all(promises).then(
          () => this.#settleEvent(backend, event, started, undefined),
          (error: unknown) => this.#settleEvent(backend, event, started, error),
        );
      } else {
        this.#settleEvent(backend, event, started, undefined);
      }
      return result;
    } catch (error) {
      this.#settleEvent(backend, event, started, error);
      throw error;
    }
  }

  #observeComputeCreation(
    backend: IBackendLike,
    original: (...args: unknown[]) => unknown,
    args: readonly unknown[],
  ): unknown {
    const pipeline = isObject(args[0]) ? (args[0] as IPipelineLike) : undefined;
    const compute = shaderObservation(pipeline?.computeProgram);
    const event = this.#beginEvent({
      backend,
      kind: "compute",
      pipeline,
      compute,
      renderObject: undefined,
      mode: "sync",
    });
    const started = this.#now();
    try {
      const result = original.apply(backend, [...args]);
      this.#settleEvent(backend, event, started, undefined);
      return result;
    } catch (error) {
      this.#settleEvent(backend, event, started, error);
      throw error;
    }
  }

  #beginEvent(input: {
    readonly backend: IBackendLike;
    readonly kind: "compute" | "render";
    readonly pipeline: IPipelineLike | undefined;
    readonly vertex?: IPipelineShaderObservation;
    readonly fragment?: IPipelineShaderObservation;
    readonly compute?: IPipelineShaderObservation;
    readonly renderObject: IRenderObjectLike | undefined;
    readonly mode: PipelineCensusMode;
  }): IMutableCensusEvent {
    this.#creations += 1;
    const pipelineIdentity = this.#logicalIdentity(input.pipeline);
    const programIdentity =
      input.kind === "compute"
        ? (input.compute?.hash ?? "unknown")
        : `${input.vertex?.hash ?? "unknown"}/${input.fragment?.hash ?? "unknown"}`;
    this.#programs.add(programIdentity);
    this.#pipelines.add(pipelineIdentity);
    const event: IMutableCensusEvent = {
      sequence: this.#nextSequence++,
      programIdentity,
      pipelineIdentity,
      kind: input.kind,
      pass:
        input.kind === "compute"
          ? "compute"
          : resolvePass(
              this.#activeRenderObject?.passId,
              this.#activeRenderObject?.material,
              this.#activeRenderObject?.clippingContext,
              input.renderObject?.material,
            ),
      mode: input.mode,
      status: input.mode === "async" ? "pending" : "created",
      ...(input.vertex === undefined ? {} : { vertex: input.vertex }),
      ...(input.fragment === undefined ? {} : { fragment: input.fragment }),
      ...(input.compute === undefined ? {} : { compute: input.compute }),
      provenance: provenance(input.renderObject, this.#activeRenderObject),
      reasons: structuralReasons(input.renderObject?.object, input.renderObject?.material),
      startedMs: this.#clock(),
      backendPipeline: input.pipeline,
    };
    if (this.#events.length < this.#limit) this.#events.push(event);
    else {
      this.#overflowed = true;
      this.#dropped += 1;
    }
    return event;
  }

  #settleEvent(
    backend: IBackendLike,
    event: IMutableCensusEvent,
    started: number,
    error: unknown,
  ): void {
    const settledAt = this.#clock();
    event.settledMs = settledAt;
    event.beforeFirstPresent =
      this.#firstPresentMs === undefined || settledAt <= this.#firstPresentMs;
    if (event.mode === "async") {
      event.promiseMs = Math.max(0, this.#now() - started);
      this.#pending = Math.max(0, this.#pending - 1);
    } else {
      event.serviceMs = Math.max(0, this.#now() - started);
    }
    if (error !== undefined) {
      event.status = "failed";
      event.error = error instanceof Error ? error.message : String(error);
      this.#failures += 1;
      return;
    }
    const pipeline = this.#backendPipeline(backend, event.backendPipeline);
    // Async Three data is installed before its promise resolves. A missing handle means the
    // promise settled but the backend did not create a usable pipeline; do not report green.
    if (pipeline === undefined && this.#kind === "webgpu") {
      event.status = "failed";
      event.error = `backend did not expose a created ${event.kind} pipeline`;
      this.#failures += 1;
      return;
    }
    if (pipeline !== undefined && this.#kind === "webgpu") {
      this.#replacePipelineIdentity(event, this.#backendPipelineIdentity(pipeline));
    }
    event.status = "created";
  }

  #backendPipeline(backend: IBackendLike, pipeline: unknown): unknown {
    // The event's identity is the logical Three pipeline, while WebGPU's DataMap carries the
    // opaque device handle. Read that data only after creation; a missing handle is a failed
    // creation, not a guessed success. WebGL's fallback has a different backend data shape and is
    // explicitly marked unsupported by the census, so it does not pretend to reconcile GPU keys.
    if (this.#kind !== "webgpu") return pipeline === undefined ? undefined : pipeline;
    if (typeof backend.get !== "function" || pipeline === undefined) return undefined;
    this.#lookups += 1;
    try {
      const data = backend.get(pipeline);
      return isObject(data) && data.pipeline !== undefined && data.pipeline !== null
        ? data.pipeline
        : undefined;
    } catch {
      return undefined;
    }
  }

  #logicalIdentity(pipeline: IPipelineLike | undefined): string {
    const candidate = pipeline as unknown;
    if (isObject(candidate)) {
      const existing = this.#pipelineIds.get(candidate);
      if (existing !== undefined) return existing;
      const identity = `logical-pipeline-${this.#nextLogicalPipelineIdentity++}`;
      this.#pipelineIds.set(candidate, identity);
      return identity;
    }
    const cacheKey = typeof pipeline?.cacheKey === "string" ? pipeline.cacheKey : undefined;
    if (cacheKey !== undefined) return `cache-${hashText(cacheKey)}`;
    return "logical-pipeline-unknown";
  }

  #backendPipelineIdentity(pipeline: unknown): string {
    if (!isObject(pipeline)) return "backend-pipeline-unknown";
    const existing = this.#backendPipelineIds.get(pipeline);
    if (existing !== undefined) return existing;
    const identity = `backend-pipeline-${this.#nextBackendPipelineIdentity++}`;
    this.#backendPipelineIds.set(pipeline, identity);
    return identity;
  }

  #replacePipelineIdentity(event: IMutableCensusEvent, identity: string): void {
    if (event.pipelineIdentity === identity) return;
    this.#pipelines.delete(event.pipelineIdentity);
    event.pipelineIdentity = identity;
    this.#pipelines.add(identity);
  }
}

function defaultNow(): number {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function shaderObservation(
  program: IProgramLike | undefined,
): IPipelineShaderObservation | undefined {
  if (typeof program?.code !== "string") return undefined;
  return { bytes: utf8Bytes(program.code), hash: hashText(program.code) };
}

function utf8Bytes(value: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).byteLength;
  return unescape(encodeURIComponent(value)).length;
}

/** Stable non-cryptographic identity; the full shader is intentionally never retained. */
function hashText(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const bytes =
    typeof TextEncoder !== "undefined"
      ? new TextEncoder().encode(value)
      : [...unescape(encodeURIComponent(value))].map((character) => character.charCodeAt(0));
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function asyncPromises(value: unknown): Promise<unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice()
    .filter(
      (candidate): candidate is Promise<unknown> =>
        isObject(candidate) && typeof (candidate as { then?: unknown }).then === "function",
    );
}

function resolvePass(
  passId: unknown,
  material: unknown,
  clippingContext?: unknown,
  secondaryMaterial?: unknown,
): string {
  if (typeof passId === "string" && passId.length > 0) return passId;
  const clippingRecord = isObject(clippingContext) ? clippingContext : undefined;
  if (clippingRecord?.shadowPass === true) return "shadow";
  for (const candidate of [secondaryMaterial, material]) {
    const materialRecord = isObject(candidate) ? candidate : undefined;
    if (
      materialRecord !== undefined &&
      (materialRecord.isShadowPassMaterial === true || isShadowMaterial(materialRecord))
    )
      return "shadow";
    const name = typeof materialRecord?.name === "string" ? materialRecord.name : "";
    if (/^PMREM_/u.test(name)) return "pmrem";
    if (name === "outputColorTransform" || name === "RenderPipeline") return "output";
  }
  if (clippingContext !== undefined && clippingContext !== null) return "main-clipped";
  return "main";
}

function isShadowMaterial(material: Record<string, unknown>): boolean {
  const type = typeof material.type === "string" ? material.type : "";
  const name = typeof material.name === "string" ? material.name : "";
  return /shadow|depth/u.test(`${type} ${name}`);
}

function provenance(
  renderObject: IRenderObjectLike | undefined,
  active: IActiveRenderObject | undefined,
): IPipelineProvenance {
  const material = active?.material ?? renderObject?.material;
  const object = active?.object ?? renderObject?.object;
  const materialRecord = isObject(material) ? material : undefined;
  const objectRecord = isObject(object) ? object : undefined;
  const materialValue =
    materialRecord === undefined
      ? undefined
      : {
          ...(finiteNumber(materialRecord.id) ? { id: materialRecord.id } : {}),
          ...(typeof materialRecord.name === "string" && materialRecord.name.length > 0
            ? { name: materialRecord.name }
            : {}),
          ...(typeof materialRecord.type === "string" ? { type: materialRecord.type } : {}),
        };
  const objectValue =
    objectRecord === undefined
      ? undefined
      : {
          ...(finiteNumber(objectRecord.id) ? { id: objectRecord.id } : {}),
          ...(typeof objectRecord.name === "string" && objectRecord.name.length > 0
            ? { name: objectRecord.name }
            : {}),
          ...(typeof objectRecord.uuid === "string" ? { uuid: objectRecord.uuid } : {}),
        };
  return {
    ...(materialValue === undefined ? {} : { material: materialValue }),
    ...(objectValue === undefined ? {} : { object: objectValue }),
    unknown: materialValue === undefined && objectValue === undefined,
  };
}

function structuralReasons(object: unknown, material: unknown): string[] {
  const reasons: string[] = [];
  const objectRecord = isObject(object) ? object : undefined;
  const materialRecord = isObject(material) ? material : undefined;
  if (objectRecord?.isSkinnedMesh === true || materialRecord?.skinning === true)
    reasons.push("skinning");
  if (objectRecord?.isInstancedMesh === true) reasons.push("instancing");
  if (materialRecord !== undefined) {
    for (const [key, label] of [
      ["map", "map"],
      ["normalMap", "normal-map"],
      ["roughnessMap", "roughness-map"],
      ["metalnessMap", "metalness-map"],
      ["alphaMap", "alpha-map"],
      ["envMap", "environment-map"],
      ["clipping", "clipping"],
    ] as const) {
      if (
        materialRecord[key] !== undefined &&
        materialRecord[key] !== null &&
        materialRecord[key] !== false
      )
        reasons.push(label);
    }
  }
  if (reasons.length === 0) reasons.push("unknown-structural-difference");
  return reasons;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function freezeEvent(event: IMutableCensusEvent): IPipelineCensusEvent {
  return {
    sequence: event.sequence,
    programIdentity: event.programIdentity,
    pipelineIdentity: event.pipelineIdentity,
    kind: event.kind,
    pass: event.pass,
    mode: event.mode,
    status: event.status,
    ...(event.vertex === undefined ? {} : { vertex: { ...event.vertex } }),
    ...(event.fragment === undefined ? {} : { fragment: { ...event.fragment } }),
    ...(event.compute === undefined ? {} : { compute: { ...event.compute } }),
    provenance: {
      ...(event.provenance.material === undefined
        ? {}
        : { material: { ...event.provenance.material } }),
      ...(event.provenance.object === undefined ? {} : { object: { ...event.provenance.object } }),
      unknown: event.provenance.unknown,
    },
    reasons: [...event.reasons],
    startedMs: event.startedMs,
    ...(event.settledMs === undefined ? {} : { settledMs: event.settledMs }),
    ...(event.serviceMs === undefined ? {} : { serviceMs: event.serviceMs }),
    ...(event.promiseMs === undefined ? {} : { promiseMs: event.promiseMs }),
    ...(event.error === undefined ? {} : { error: event.error }),
    ...(event.beforeFirstPresent === undefined
      ? {}
      : { beforeFirstPresent: event.beforeFirstPresent }),
  };
}
