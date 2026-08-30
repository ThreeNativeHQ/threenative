import type { IFrameBudgetWindow } from "../frame-budget.js";
import type { RendererKind } from "../renderer.js";

/** The marker shared by render-chain logs, playtests, and native diagnostics. */
export const RENDER_CHAIN_MARKER = "TN_RENDER_CHAIN";

/** Canonical order for the stages a game may request. */
export const RENDER_CHAIN_STAGE_ORDER = [
  "ambientOcclusion",
  "ssgi",
  "ssr",
  "denoise",
  "temporalReproject",
  "taa",
  "traa",
  "motionBlur",
  "sharpen",
  "bloom",
  "lensDistortion",
  "sparkle",
  "gradualBackground",
] as const;

export type RenderChainStageName = (typeof RENDER_CHAIN_STAGE_ORDER)[number];
export type RenderChainTier = "high" | "medium" | "low" | "off";
export type RenderChainTierRequest = RenderChainTier | "auto";
export type RenderChainSource = "pinned" | "auto";
export type RenderChainVelocitySource = "mrt" | "per-object" | null;

export interface IRenderChainVelocityMeasurement {
  /** Monotonic frame number from the stage's measurement source. */
  readonly frame: number;
  /** Share of pixels whose temporal history was rejected in that frame. */
  readonly rejectionFraction: number;
}

export interface IRenderChainRenderer {
  readonly kind: RendererKind;
  readonly raw: unknown;
  clearOutputNode?(): void;
  /** Internal renderer seam used to turn on core-owned per-object history only for active temporal stages. */
  setRenderChainVelocityEnabled?(enabled: boolean): void;
  setOutputNode(node: unknown): void;
}

const TIER_LEVEL: Record<RenderChainTier, number> = {
  high: 3,
  low: 1,
  medium: 2,
  off: 0,
};

/** Quality values are algorithm parameters, not appearance values. Templates own the latter. */
export const RENDER_CHAIN_TIERS = {
  high: { denoiseIterations: 3, sliceCount: 3, stepCount: 16 },
  low: { denoiseIterations: 1, sliceCount: 1, stepCount: 12 },
  medium: { denoiseIterations: 2, sliceCount: 2, stepCount: 8 },
  off: { denoiseIterations: 0, sliceCount: 0, stepCount: 0 },
} as const satisfies Record<
  RenderChainTier,
  {
    denoiseIterations: number;
    sliceCount: number;
    stepCount: number;
  }
>;

const VELOCITY_STAGES = new Set<RenderChainStageName>([
  "motionBlur",
  "taa",
  "temporalReproject",
  "traa",
]);

export interface IRenderChainVelocityRequest {
  /** Treat the renderer's MRT velocity output as provisioned. */
  mrt?: boolean;
  /** Treat objects carrying `userData.useVelocity === true` as provisioned. */
  objectFlags?: boolean;
  /** Alias accepted by integrations that call this route per-object velocity. */
  perObject?: boolean;
  /** Read the stage's completed-frame measurement; a repeated frame is rejected as stale. */
  rejectionMeasurement?: () => IRenderChainVelocityMeasurement | undefined;
  /** Explicit route, useful for a native host whose MRT is not introspectable from JavaScript. */
  source?: Exclude<RenderChainVelocitySource, null>;
}

export interface IRenderChainRequest {
  /** Stages are sorted into {@link RENDER_CHAIN_STAGE_ORDER}; an empty list is a no-op. */
  stages?: readonly string[];
  /** A fixed tier pins quality; `auto` enables the measured frame-budget ladder. */
  tier?: RenderChainTierRequest;
  velocity?: IRenderChainVelocityRequest;
}

export interface IRenderChainStageContext {
  readonly tier: RenderChainTier;
  readonly velocity: IRenderChainVelocityReport;
  readonly quality: (typeof RENDER_CHAIN_TIERS)[RenderChainTier];
}

export interface IRenderChainStage {
  readonly name: RenderChainStageName;
  readonly build: (input: unknown, context: IRenderChainStageContext) => unknown;
  /** Stages below this tier are named as dropped instead of silently changing the graph. */
  readonly minimumTier?: RenderChainTier;
  /** Return a reason to drop the stage on this target, or true when it is available. */
  readonly available?: (context: IRenderChainStageContext) => boolean | string;
  /** Defaults from the canonical stage name for the temporal stages. */
  readonly requiresVelocity?: boolean;
}

export interface IRenderChainDroppedStage {
  readonly name: RenderChainStageName;
  readonly reason: string;
}

export interface IRenderChainVelocityReport {
  readonly provisioned: boolean;
  readonly required: boolean;
  readonly source: RenderChainVelocitySource;
  readonly rejectionFraction?: number;
  readonly measurementFrame?: number;
}

export interface IRenderChainApplied {
  readonly dropped: readonly IRenderChainDroppedStage[];
  readonly requested: readonly RenderChainStageName[];
  readonly source: RenderChainSource;
  readonly stages: readonly RenderChainStageName[];
  readonly tier: RenderChainTier;
  readonly velocity: IRenderChainVelocityReport;
}

export interface IRenderChainMarker {
  readonly applied: IRenderChainApplied;
  readonly marker: typeof RENDER_CHAIN_MARKER;
}

export interface IRenderChainBudgetWindow {
  readonly phases: {
    readonly render: Pick<IFrameBudgetWindow["phases"]["render"], "p95">;
  };
}

export interface IRenderChainOptions {
  readonly renderer: IRenderChainRenderer;
  readonly input?: unknown;
  readonly report?: (line: string) => void;
  readonly request?: IRenderChainRequest;
  readonly stages?: readonly IRenderChainStage[];
  readonly targetFps?: number;
  /** Number of consecutive over-budget windows before the automatic ladder steps down. */
  readonly dwellWindows?: number;
  /** Optional scene-like traversal for detecting `userData.useVelocity` flags. */
  readonly scene?: {
    traverse(callback: (object: { userData?: Record<string, unknown> }) => void): void;
  };
}

const chainReports = new WeakMap<object, IRenderChainMarker>();

/**
 * Read the last chain marker associated with a renderer or its raw renderer.
 * @situation expose the render tier and dropped-stage reasons to a playtest
 * @situation inspect whether a temporal pass received velocity
 * @constraint an absent value means no chain was installed and must fail a chain assertion
 * @example const chain = readRenderChainReport(ctx.renderer);
 */
export function readRenderChainReport(renderer: unknown): IRenderChainMarker | undefined {
  if (!isObject(renderer)) return undefined;
  const raw = readRawRenderer(renderer);
  return chainReports.get(renderer) ?? (isObject(raw) ? chainReports.get(raw) : undefined);
}

/** JSON-safe observation used by the browser and native playtest bridges. */
export function readRenderChainObservation(
  renderer: unknown,
): IRenderChainMarker["applied"] | undefined {
  return readRenderChainReport(renderer)?.applied;
}

/**
 * Compose game-provided nodes through one ordered, measured, honest render seam.
 *
 * The chain owns only stage ordering, availability, velocity provisioning and quality selection.
 * Every stage factory is supplied by the game/template, so this module never chooses a material,
 * colour, light, shader or post-processing look.
 */
export class RenderChain {
  readonly #renderer: IRenderChainRenderer;
  readonly #input: unknown;
  readonly #report: (line: string) => void;
  readonly #stageDefinitions: ReadonlyMap<RenderChainStageName, IRenderChainStage>;
  readonly #requested: readonly RenderChainStageName[];
  readonly #requestVelocity: IRenderChainVelocityRequest;
  readonly #automatic: boolean;
  readonly #targetFps: number;
  readonly #dwellWindows: number;
  readonly #scene: IRenderChainOptions["scene"];
  #tier: RenderChainTier;
  #source: RenderChainSource;
  #overBudgetWindows = 0;
  #lastMeasurementFrame: number | undefined;
  #reportedMeasurement = false;
  #disposed = false;
  #applied: IRenderChainApplied;

  constructor(renderer: IRenderChainRenderer, options?: Omit<IRenderChainOptions, "renderer">);
  constructor(options: IRenderChainOptions);
  constructor(
    rendererOrOptions: IRenderChainRenderer | IRenderChainOptions,
    suppliedOptions: Omit<IRenderChainOptions, "renderer"> = {},
  ) {
    const options = isRenderer(rendererOrOptions)
      ? { ...suppliedOptions, renderer: rendererOrOptions }
      : rendererOrOptions;
    this.#renderer = options.renderer;
    this.#input = options.input;
    this.#report = options.report ?? ((line) => console.log(line));
    this.#stageDefinitions = createStageDefinitions(options.stages ?? []);
    this.#requested = normalizeRequestedStages(options.request?.stages ?? []);
    this.#requestVelocity = options.request?.velocity ?? {};
    this.#automatic = (options.request?.tier ?? "high") === "auto";
    this.#tier = this.#automatic ? "high" : validateTier(options.request?.tier ?? "high");
    this.#source = this.#automatic ? "auto" : "pinned";
    this.#targetFps = requirePositiveNumber(options.targetFps ?? 60, "targetFps");
    this.#dwellWindows = requirePositiveInteger(options.dwellWindows ?? 2, "dwellWindows");
    this.#scene = options.scene;
    this.#applied = emptyApplied(this.#requested, this.#tier, this.#source, false);
    this.apply();
  }

  get applied(): IRenderChainApplied {
    return this.#applied;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** Rebuild and install the current tier. */
  apply(): IRenderChainApplied {
    if (this.#disposed) throw new Error("RenderChain.apply called after dispose().");
    if (this.#requested.length === 0) {
      this.#applied = emptyApplied([], this.#tier, this.#source, false);
      this.#lastMeasurementFrame = undefined;
      this.#reportedMeasurement = false;
      this.#renderer.setRenderChainVelocityEnabled?.(false);
      forgetReport(this.#renderer);
      return this.#applied;
    }

    const requiredVelocity = this.#requested.some(
      (name) => this.#stageDefinitions.get(name)?.requiresVelocity ?? VELOCITY_STAGES.has(name),
    );
    const velocity = resolveVelocity(
      this.#renderer,
      this.#requestVelocity,
      this.#scene,
      requiredVelocity,
    );
    this.#lastMeasurementFrame = undefined;
    this.#reportedMeasurement = false;
    const context: IRenderChainStageContext = {
      quality: RENDER_CHAIN_TIERS[this.#tier],
      tier: this.#tier,
      velocity,
    };
    const dropped: IRenderChainDroppedStage[] = [];
    const stages: RenderChainStageName[] = [];
    let node = this.#input;

    for (const name of this.#requested) {
      const definition = this.#stageDefinitions.get(name);
      if (definition === undefined) {
        dropped.push({ name, reason: "provider:missing" });
        continue;
      }
      if (this.#tier === "off") {
        dropped.push({ name, reason: "tier:off" });
        continue;
      }
      if (this.#renderer.kind !== "webgpu") {
        dropped.push({ name, reason: `renderer:${this.#renderer.kind}` });
        continue;
      }
      if (
        definition.minimumTier !== undefined &&
        TIER_LEVEL[this.#tier] < TIER_LEVEL[definition.minimumTier]
      ) {
        dropped.push({ name, reason: `tier:${this.#tier}` });
        continue;
      }
      const requiresVelocity = definition.requiresVelocity ?? VELOCITY_STAGES.has(name);
      if (requiresVelocity && !velocity.provisioned) {
        dropped.push({ name, reason: "velocity:missing" });
        continue;
      }
      const availability = definition.available?.(context);
      if (availability === false) {
        dropped.push({ name, reason: `unavailable:${this.#renderer.kind}` });
        continue;
      }
      if (typeof availability === "string") {
        dropped.push({ name, reason: availability });
        continue;
      }
      try {
        const next = definition.build(node, context);
        if (next === undefined || next === null) throw new Error("stage returned no node");
        node = next;
        stages.push(name);
      } catch (error) {
        dropped.push({ name, reason: `build:${errorMessage(error)}` });
      }
    }

    if (stages.length > 0) {
      try {
        this.#renderer.setOutputNode(node);
      } catch (error) {
        const reason = `install:${errorMessage(error)}`;
        dropped.push(...stages.map((name) => ({ name, reason })));
        stages.length = 0;
        this.#renderer.clearOutputNode?.();
      }
    } else {
      this.#renderer.clearOutputNode?.();
    }

    this.#applied = {
      dropped,
      requested: this.#requested,
      source: this.#source,
      stages,
      tier: this.#tier,
      velocity,
    };
    this.#renderer.setRenderChainVelocityEnabled?.(
      velocity.source === "per-object" &&
        stages.some(
          (name) => this.#stageDefinitions.get(name)?.requiresVelocity ?? VELOCITY_STAGES.has(name),
        ),
    );
    this.#publish(true);
    return this.#applied;
  }

  /**
   * Samples a completed temporal frame. The callback is deliberately queried after rendering,
   * not while applying the graph: a value copied during `apply()` can be a stale fixture or a
   * tuning constant and cannot prove what the stage rejected this frame.
   */
  observeFrame(): IRenderChainApplied {
    if (this.#disposed) throw new Error("RenderChain.observeFrame called after dispose().");
    const requiresMeasurement = this.#applied.stages.some(
      (name) => this.#stageDefinitions.get(name)?.requiresVelocity ?? VELOCITY_STAGES.has(name),
    );
    if (!requiresMeasurement) return this.#applied;

    const measurement = this.#requestVelocity.rejectionMeasurement?.();
    if (measurement === undefined) {
      this.#lastMeasurementFrame = undefined;
      this.#setMeasurement(undefined, false);
      return this.#applied;
    }
    validateVelocityMeasurement(measurement, this.#lastMeasurementFrame);
    this.#lastMeasurementFrame = measurement.frame;
    this.#setMeasurement(measurement, !this.#reportedMeasurement || measurement.frame % 60 === 0);
    return this.#applied;
  }

  /** Feed the chain the same render-window evidence used by the frame budget. */
  observeFrameBudget(window: IRenderChainBudgetWindow): RenderChainTier {
    if (this.#disposed) throw new Error("RenderChain.observeFrameBudget called after dispose().");
    if (!this.#automatic) return this.#tier;
    const renderP95 = window.phases.render?.p95;
    if (typeof renderP95 !== "number" || !Number.isFinite(renderP95) || renderP95 < 0) {
      throw new Error("RenderChain frame budget render.p95 must be a finite non-negative number.");
    }
    const budgetMs = 1_000 / this.#targetFps;
    if (renderP95 > budgetMs) this.#overBudgetWindows += 1;
    else this.#overBudgetWindows = 0;
    if (this.#overBudgetWindows >= this.#dwellWindows) {
      this.#overBudgetWindows = 0;
      const next = nextLowerTier(this.#tier);
      if (next !== this.#tier) {
        this.#tier = next;
        this.#source = "auto";
        this.apply();
      }
    }
    return this.#tier;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#renderer.setRenderChainVelocityEnabled?.(false);
    this.#renderer.clearOutputNode?.();
    forgetReport(this.#renderer);
  }

  #setMeasurement(measurement: IRenderChainVelocityMeasurement | undefined, emit: boolean): void {
    const { provisioned, required, source } = this.#applied.velocity;
    this.#applied = {
      ...this.#applied,
      velocity: {
        provisioned,
        required,
        source,
        ...(measurement === undefined
          ? {}
          : {
              measurementFrame: measurement.frame,
              rejectionFraction: measurement.rejectionFraction,
            }),
      },
    };
    if (measurement !== undefined) this.#reportedMeasurement = true;
    this.#publish(emit);
  }

  #publish(emit: boolean): void {
    const marker: IRenderChainMarker = { applied: this.#applied, marker: RENDER_CHAIN_MARKER };
    rememberReport(this.#renderer, marker);
    if (emit) this.#report(`${RENDER_CHAIN_MARKER}:${JSON.stringify(marker)}`);
  }
}

function createStageDefinitions(
  stages: readonly IRenderChainStage[],
): ReadonlyMap<RenderChainStageName, IRenderChainStage> {
  const definitions = new Map<RenderChainStageName, IRenderChainStage>();
  for (const stage of stages) {
    if (!(RENDER_CHAIN_STAGE_ORDER as readonly string[]).includes(stage.name)) {
      throw new Error(`unknown render-chain stage '${String(stage.name)}'`);
    }
    if (definitions.has(stage.name))
      throw new Error(`duplicate render-chain stage '${stage.name}'`);
    if (typeof stage.build !== "function")
      throw new Error(`render-chain stage '${stage.name}' needs a build function`);
    definitions.set(stage.name, stage);
  }
  return definitions;
}

function normalizeRequestedStages(stages: readonly string[]): readonly RenderChainStageName[] {
  const requested = new Set<RenderChainStageName>();
  for (const name of stages) {
    if (!(RENDER_CHAIN_STAGE_ORDER as readonly string[]).includes(name)) {
      throw new Error(`unknown render-chain stage '${String(name)}'`);
    }
    requested.add(name as RenderChainStageName);
  }
  return RENDER_CHAIN_STAGE_ORDER.filter((name) => requested.has(name));
}

function validateTier(value: unknown): RenderChainTier {
  if (value === "high" || value === "medium" || value === "low" || value === "off") return value;
  throw new Error(
    `RenderChain tier must be high, medium, low, off, or auto; received ${String(value)}.`,
  );
}

function resolveVelocity(
  renderer: IRenderChainRenderer,
  request: IRenderChainVelocityRequest,
  scene: IRenderChainOptions["scene"],
  required: boolean,
): IRenderChainVelocityReport {
  if (!required) return { provisioned: false, required: false, source: null };
  const source =
    request.source ??
    (request.mrt === true || hasMrtVelocity(renderer.raw) ? "mrt" : undefined) ??
    (request.objectFlags === true || request.perObject === true || hasObjectVelocityFlag(scene)
      ? "per-object"
      : null);
  return { provisioned: source !== null, required: true, source };
}

function hasMrtVelocity(raw: unknown): boolean {
  if (!isObject(raw)) return false;
  const getMrt = raw.getMRT;
  if (typeof getMrt === "function") {
    try {
      if (containsVelocity(getMrt.call(raw))) return true;
    } catch {
      return false;
    }
  }
  return containsVelocity(raw.mrt) || containsVelocity(raw.mrtOutputs);
}

function containsVelocity(value: unknown): boolean {
  if (value instanceof Set || value instanceof Map) return value.has("velocity");
  if (Array.isArray(value)) return value.includes("velocity");
  return isObject(value) && value.velocity === true;
}

function hasObjectVelocityFlag(scene: IRenderChainOptions["scene"]): boolean {
  if (scene === undefined) return false;
  let found = false;
  scene.traverse((object) => {
    if (object.userData?.useVelocity === true) found = true;
  });
  return found;
}

function validateVelocityMeasurement(
  measurement: IRenderChainVelocityMeasurement,
  previousFrame: number | undefined,
): void {
  if (!Number.isInteger(measurement.frame) || measurement.frame < 0) {
    throw new Error(
      `RenderChain velocity measurement frame must be a non-negative integer, received ${String(measurement.frame)}.`,
    );
  }
  if (previousFrame !== undefined && measurement.frame <= previousFrame) {
    throw new Error(
      `RenderChain velocity measurement frame must advance beyond ${String(previousFrame)}, received ${String(measurement.frame)}.`,
    );
  }
  const resolved = measurement.rejectionFraction;
  if (!Number.isFinite(resolved) || resolved < 0 || resolved > 1) {
    throw new Error(
      `RenderChain velocity rejectionFraction must be between 0 and 1, received ${String(resolved)}.`,
    );
  }
}

function emptyApplied(
  requested: readonly RenderChainStageName[],
  tier: RenderChainTier,
  source: RenderChainSource,
  required: boolean,
): IRenderChainApplied {
  return {
    dropped: [],
    requested,
    source,
    stages: [],
    tier,
    velocity: { provisioned: false, required, source: null },
  };
}

function nextLowerTier(tier: RenderChainTier): RenderChainTier {
  if (tier === "high") return "medium";
  if (tier === "medium") return "low";
  if (tier === "low") return "off";
  return "off";
}

function rememberReport(renderer: IRenderChainRenderer, marker: IRenderChainMarker): void {
  if (isObject(renderer)) chainReports.set(renderer, marker);
  if (isObject(renderer.raw)) chainReports.set(renderer.raw, marker);
}

function forgetReport(renderer: IRenderChainRenderer): void {
  if (isObject(renderer)) chainReports.delete(renderer);
  if (isObject(renderer.raw)) chainReports.delete(renderer.raw);
}

function readRawRenderer(renderer: object): unknown {
  return "raw" in renderer ? renderer.raw : renderer;
}

function isRenderer(
  value: IRenderChainRenderer | IRenderChainOptions,
): value is IRenderChainRenderer {
  return isObject(value) && "kind" in value && "setOutputNode" in value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`RenderChain ${name} must be a positive integer.`);
  return value;
}

function requirePositiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`RenderChain ${name} must be a finite positive number.`);
  return value;
}

export type { RendererKind };
