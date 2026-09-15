// PRD-377 §4.3 — error-driven, bounded discrete-LOD generation inside the existing asset cook.
//
// The simplifier is the one already integrated for virtual geometry (`meshoptimizer` via glTF
// Transform); this module adds no new dependency. Every level is derived from the same LOD0
// reference and stored as an index-only view over LOD0's vertices, so nothing moves, nothing is
// reconstructed, and the authored GLB is never overwritten.

import { createHash } from "node:crypto";
import type { Document, Node as GltfNode, Mesh, Primitive } from "@gltf-transform/core";
import { MeshoptSimplifier } from "meshoptimizer";
import { TN_VIRTUAL_GEOMETRY } from "../virtual/extension.js";
import {
  type DiscreteLodSkipReason,
  type LodMinTrianglesScope,
  authoredLodName,
  classifyPrimitive,
  primitiveTriangleCount,
} from "./eligibility.js";

export type { DiscreteLodSkipReason, LodMinTrianglesScope } from "./eligibility.js";
import {
  type DiscreteLod,
  type ILodArtifactMetadata,
  TNDiscreteLod,
  TN_DISCRETE_LOD,
  attachDiscreteLod,
  discreteLodBytes,
} from "./extension.js";

/** Generation knobs, shared by every preset (PRD-377 §3.2); both are ceilings, not promises. */
export interface IModelLodGenerationOptions {
  /**
   * Versioned increasing geometric-error targets, in normalized mesh-extent units. Each target is
   * simplified from LOD0 independently; a target that cannot reduce is dropped. Default
   * {@link LOD_ERROR_TARGETS}.
   */
  readonly errorTargets?: readonly number[];
  /** Levels in the chain including LOD0; integer 1–8. Default {@link DEFAULT_LOD_MAX_LEVELS}. */
  readonly maxLevels?: number;
  /**
   * Fraction of its predecessor's triangles a derived level must save to be kept. Default
   * {@link LOD_MIN_SAVING}. This is the benefit gate: an inability to reach it is a normal skip.
   */
  readonly minSaving?: number;
  /**
   * Cheap pre-filter floor in triangles. It is not the benefit gate — {@link minSaving} is — and
   * only skips work where the simplifier's fixed per-call cost would dominate. Default
   * {@link DEFAULT_LOD_MIN_TRIANGLES}.
   */
  readonly minTriangles?: number;
  /**
   * What {@link minTriangles} is measured against. Default
   * {@link DEFAULT_LOD_MIN_TRIANGLES_SCOPE}, which floors the whole asset rather than each
   * primitive, so a model split into many small primitives is still measured by its total.
   */
  readonly minTrianglesScope?: LodMinTrianglesScope;
}

/** Quality policy for automatic LOD; it selects the projected pixel-error budget (PRD-377 §3.2). */
export type LodPreset = "aggressive" | "balanced" | "quality";

/** Screen-space selection knobs; they change what the runtime picks, never what is baked. */
export interface IModelLodRuntimeOptions {
  /** Projected geometric-error budget in raster pixels; positive finite. */
  readonly maxPixelError?: number;
  /** Fraction in `[0, 0.5)`, default 0.15, that stabilizes coarsening at a boundary. */
  readonly hysteresis?: number;
}

/** A partial override for one asset; nested objects overlay, they never replace. */
export interface IModelLodOverride {
  readonly enabled?: boolean;
  readonly generation?: IModelLodGenerationOptions;
  readonly preset?: LodPreset;
  readonly runtime?: IModelLodRuntimeOptions;
}

/**
 * `assets.lod`, as the compile step reads it. Absent or `{}` resolves to enabled/balanced; `false`
 * and `{ enabled: false }` are equivalent absolute kill switches that no per-asset override can
 * re-enable. Resolution is per asset and happens where the asset is known (PRD-377 §3.2, §5).
 */
export interface IModelLodOptions {
  readonly enabled?: boolean;
  readonly generation?: IModelLodGenerationOptions;
  readonly overrides?: Readonly<Record<string, boolean | IModelLodOverride>>;
  readonly preset?: LodPreset;
  readonly runtime?: IModelLodRuntimeOptions;
}

export const LOD_GENERATOR = "threenative-discrete-lod";
export const LOD_GENERATOR_VERSION = 1;
/** Bumped with the output layout so a stale cache entry cannot hide a schema change. */
export const LOD_ARTIFACT_SCHEMA_VERSION = 1;
/** The pinned simplifier this artifact's error metric was produced with. */
export const LOD_TOOLCHAIN = "meshoptimizer@1.1.1";

/**
 * Versioned increasing geometric-error targets, normalized to the mesh extent. Error-driven rather
 * than a forced `100/50/20/5` ladder: the simplifier stops at the topology the error allows, and a
 * level that saves less than {@link LOD_MIN_SAVING} is dropped rather than shipped for its own sake.
 * Overridable through `assets.lod.generation.errorTargets`.
 */
export const LOD_ERROR_TARGETS: readonly number[] = [0.002, 0.006, 0.02, 0.06];

/**
 * A derived level must save at least this fraction of its predecessor's triangles (PRD-377 §4.3).
 * This is the benefit gate the pre-filter only approximates; overridable through
 * `assets.lod.generation.minSaving`.
 */
export const LOD_MIN_SAVING = 0.2;

export const DEFAULT_LOD_MAX_LEVELS = 4;
/**
 * Cheap pre-filter floor in triangles, not the benefit gate.
 *
 * It exists only to avoid the simplifier's fixed per-primitive cost — an attribute pack and one
 * `simplifyWithAttributes` call per target — on units too small for any reduction to be worth the
 * chain bookkeeping. At ~64 quads the whole primitive is smaller than the rounding it would pay for;
 * below that, even a halving of the count is a rounding error against a frame. This is deliberately
 * low because the measured saving rule, not this, decides what ships.
 */
export const DEFAULT_LOD_MIN_TRIANGLES = 128;
/**
 * Default floor scope: the whole asset.
 *
 * A shipped carrier is 347,497 triangles over ~300 primitives of ~1,200, and a 10-15k aircraft is
 * ~600 per primitive; an absolute per-primitive floor below 5,000 made the feature inert on exactly
 * the assets that needed it. Measuring the total is project-agnostic and lets the saving rule reject
 * the primitives where simplification does not pay.
 */
export const DEFAULT_LOD_MIN_TRIANGLES_SCOPE: LodMinTrianglesScope = "asset";
/** Default hysteresis: coarsen only when the cheaper level falls below `(1 - h) * budget`. */
export const DEFAULT_LOD_HYSTERESIS = 0.15;

const LOD_PRESETS: readonly LodPreset[] = ["aggressive", "balanced", "quality"];

/** The preset's policy starting point. These are budgets to be measured against, not guarantees. */
export function presetPixelError(preset: LodPreset): number {
  switch (preset) {
    case "aggressive":
      return 2;
    case "quality":
      return 0.5;
    case "balanced":
      return 1;
  }
}

export function isLodPreset(value: unknown): value is LodPreset {
  return typeof value === "string" && (LOD_PRESETS as readonly string[]).includes(value);
}

export interface IModelLodLevel {
  /** Normalized simplifier error, in mesh-extent units. */
  readonly error: number;
  /** `error * errorScale`, in local-space units. */
  readonly absoluteError: number;
  readonly triangles: number;
}

export interface IModelLodPrimitiveSummary {
  readonly levels: readonly IModelLodLevel[];
  readonly mesh: string;
  readonly primitive: number;
  readonly strategy: "discrete";
  readonly trianglesBefore: number;
}

export interface IModelLodSkipSummary {
  readonly mesh: string;
  readonly primitive: number;
  readonly reason: DiscreteLodSkipReason;
}

export interface IModelLodSummary {
  readonly byteOverhead: number;
  /** Migration/legacy notes the resolver raised; never a silent winner over an explicit setting. */
  readonly diagnostics: readonly ILodDiagnostic[];
  readonly enabled: boolean;
  readonly fingerprint: string;
  readonly generated: number;
  readonly maxLevels: number;
  readonly minTriangles: number;
  readonly minTrianglesScope: LodMinTrianglesScope;
  readonly minSaving: number;
  readonly errorTargets: readonly number[];
  /** Max derived levels on any one primitive. */
  readonly levels: number;
  /** The quality policy the resolver chose; the runtime budget follows from it. */
  readonly preset: LodPreset;
  readonly primitives: readonly IModelLodPrimitiveSummary[];
  readonly reasons: readonly DiscreteLodSkipReason[];
  /** The runtime selection budget this asset ships with, serialized into the manifest. */
  readonly runtime: { readonly hysteresis: number; readonly maxPixelError: number };
  readonly skipped: number;
  readonly trianglesAfter: number;
  readonly trianglesBefore: number;
  readonly generatedSeconds: number;
}

/** One migration note from resolving a new declaration against a legacy one (PRD-377 §3.3). */
export interface ILodDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export interface ILodLegacyFlags {
  /** `assets.models.simplify` is declared. */
  readonly simplify?: boolean;
  /** `assets.models.virtual` is `"none"`. */
  readonly virtualNone?: boolean;
}

export interface IResolvedLodPolicy {
  readonly diagnostics: readonly ILodDiagnostic[];
  readonly enabled: boolean;
  /** Generation and runtime are separate cache identities (PRD-377 §3.2, §5). */
  readonly fingerprint: { readonly generation: string; readonly runtime: string };
  readonly generation: {
    readonly errorTargets: readonly number[];
    readonly maxLevels: number;
    readonly minSaving: number;
    readonly minTriangles: number;
    readonly minTrianglesScope: LodMinTrianglesScope;
  };
  readonly preset: LodPreset;
  readonly reasons: readonly DiscreteLodSkipReason[];
  readonly runtime: { readonly hysteresis: number; readonly maxPixelError: number };
}

/**
 * Asset override, then project, then default — PRD-377 §3.2. The chosen preset's defaults expand
 * once, then explicit project fields overlay, then explicit asset fields; nested objects overlay
 * field by field. The global `false` / `{ enabled: false }` is absolute. Legacy declarations
 * translate here rather than running as a parallel path: `models.virtual: "none"` keeps the asset
 * off unless a new declaration explicitly enables it, and an explicit legacy `simplify` skips
 * generation with `explicit-legacy-simplify`. A new and a legacy declaration for the same asset
 * produce a migration diagnostic, never a silent winner.
 */
export function resolveLodPolicy(
  lod: boolean | IModelLodOptions | "none" | undefined,
  asset: string,
  legacy: ILodLegacyFlags = {},
): IResolvedLodPolicy {
  const project = typeof lod === "object" && lod !== null ? lod : undefined;
  const override = project?.overrides?.[asset];
  const assetBlock = typeof override === "object" && override !== null ? override : undefined;
  const globalOff = lod === false || lod === "none" || project?.enabled === false;

  const preset = assetBlock?.preset ?? project?.preset ?? "balanced";
  const generation: {
    errorTargets: readonly number[];
    maxLevels: number;
    minSaving: number;
    minTriangles: number;
    minTrianglesScope: LodMinTrianglesScope;
  } = {
    errorTargets: [...LOD_ERROR_TARGETS],
    maxLevels: DEFAULT_LOD_MAX_LEVELS,
    minSaving: LOD_MIN_SAVING,
    minTriangles: DEFAULT_LOD_MIN_TRIANGLES,
    minTrianglesScope: DEFAULT_LOD_MIN_TRIANGLES_SCOPE,
  };
  const runtime = {
    hysteresis: DEFAULT_LOD_HYSTERESIS,
    maxPixelError: presetPixelError(preset),
  };
  // Project first, then the asset override, so an asset moves only the fields it names and every
  // knob is reachable globally and per asset (PRD-377 §3.2).
  for (const block of [project?.generation, assetBlock?.generation]) {
    if (block?.errorTargets !== undefined) generation.errorTargets = [...block.errorTargets];
    if (block?.maxLevels !== undefined) generation.maxLevels = block.maxLevels;
    if (block?.minSaving !== undefined) generation.minSaving = block.minSaving;
    if (block?.minTriangles !== undefined) generation.minTriangles = block.minTriangles;
    if (block?.minTrianglesScope !== undefined)
      generation.minTrianglesScope = block.minTrianglesScope;
  }
  if (project?.runtime?.maxPixelError !== undefined)
    runtime.maxPixelError = project.runtime.maxPixelError;
  if (project?.runtime?.hysteresis !== undefined) runtime.hysteresis = project.runtime.hysteresis;
  if (assetBlock?.runtime?.maxPixelError !== undefined)
    runtime.maxPixelError = assetBlock.runtime.maxPixelError;
  if (assetBlock?.runtime?.hysteresis !== undefined)
    runtime.hysteresis = assetBlock.runtime.hysteresis;

  let enabled = project?.enabled ?? true;
  if (override === false) enabled = false;
  else if (override === true) enabled = true;
  else if (assetBlock?.enabled !== undefined) enabled = assetBlock.enabled;
  // The global kill switch is absolute: nothing above may outlive it.
  if (globalOff) enabled = false;

  const diagnostics: ILodDiagnostic[] = [];
  const reasons: DiscreteLodSkipReason[] = [];
  if (globalOff) {
    reasons.push("disabled");
  } else {
    // Any new declaration — even one that only names a generation knob — is a deliberate opt-in
    // when it conflicts with a legacy declaration (PRD-377 §3.3). An empty block or omission is
    // not a declaration, so the explicit legacy setting keeps its meaning.
    const explicitNewPolicy = lodHasExplicitPolicy(lod) || lodHasExplicitPolicy(override);
    if (legacy.virtualNone === true) {
      if (explicitNewPolicy) {
        diagnostics.push({
          code: "lod-legacy-virtual-none-conflict",
          message:
            'assets.models.virtual is "none" and assets.lod declares an automatic policy; the explicit declaration wins for this asset.',
          path: "assets.lod",
        });
      } else {
        enabled = false;
        reasons.push("virtual-none");
      }
    }
    if (legacy.simplify === true) {
      if (explicitNewPolicy) {
        diagnostics.push({
          code: "lod-legacy-simplify-conflict",
          message:
            "assets.models.simplify is declared and assets.lod declares an automatic policy; the explicit declaration wins for this asset.",
          path: "assets.lod",
        });
      } else {
        enabled = false;
        reasons.push("explicit-legacy-simplify");
      }
    }
  }
  if (!enabled && reasons.length === 0) reasons.push("disabled");

  const generationFingerprint = lodFingerprint({
    algorithm: `${LOD_GENERATOR}/${String(LOD_GENERATOR_VERSION)}`,
    enabled,
    errorTargets: generation.errorTargets,
    maxLevels: generation.maxLevels,
    minSaving: generation.minSaving,
    minTriangles: generation.minTriangles,
    minTrianglesScope: generation.minTrianglesScope,
    schema: LOD_ARTIFACT_SCHEMA_VERSION,
    toolchain: LOD_TOOLCHAIN,
  });
  return {
    diagnostics,
    enabled,
    fingerprint: {
      generation: generationFingerprint,
      runtime: lodFingerprint({
        enabled,
        generation: generationFingerprint,
        hysteresis: runtime.hysteresis,
        maxPixelError: runtime.maxPixelError,
        preset,
        schema: LOD_ARTIFACT_SCHEMA_VERSION,
      }),
    },
    generation,
    preset,
    reasons,
    runtime,
  };
}

/** True when a `lod` value declares at least one field; `{}` and omission are the same policy. */
function lodHasExplicitPolicy(
  value: boolean | IModelLodOptions | IModelLodOverride | "none" | undefined,
): boolean {
  if (value === true) return true;
  if (value === false || value === undefined || value === "none") return false;
  return (
    value.enabled !== undefined ||
    value.preset !== undefined ||
    (value.generation !== undefined && Object.keys(value.generation).length > 0) ||
    (value.runtime !== undefined && Object.keys(value.runtime).length > 0) ||
    ("overrides" in value && value.overrides !== undefined)
  );
}

/** A stable 16-hex-character identity over the policy inputs that produced an artifact. */
function lodFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

/** A candidate level before the 20%-saving and monotonicity rules are applied. */
export interface ILodLevelCandidate {
  readonly error: number;
  readonly triangles: number;
}

/**
 * Applies PRD-377 §4.3's rejection rules to candidates ordered by increasing error: a level must
 * reduce triangles, must save at least `minSaving` of its predecessor, and its error must be no
 * lower than the last kept level's. `minSaving` defaults to {@link LOD_MIN_SAVING} and is the real
 * benefit gate — an inability to reach it is a normal skip, not a failure. A candidate that does not
 * reduce is skipped rather than ending the ladder, because each candidate was derived from LOD0
 * independently. A zero-error level is kept explicitly when it still removes work under the metric.
 */
export function selectDiscreteLevels(
  candidates: readonly ILodLevelCandidate[],
  maxLevels: number,
  referenceTriangles: number,
  minSaving: number = LOD_MIN_SAVING,
): readonly ILodLevelCandidate[] {
  const kept: ILodLevelCandidate[] = [];
  let previousTriangles = referenceTriangles;
  let previousError = -1;
  for (const candidate of candidates) {
    if (kept.length >= Math.max(0, maxLevels - 1)) break;
    if (candidate.triangles <= 0 || candidate.triangles >= previousTriangles) continue;
    const saving = (previousTriangles - candidate.triangles) / previousTriangles;
    if (saving < minSaving) continue;
    if (candidate.error < previousError) continue;
    kept.push(candidate);
    previousTriangles = candidate.triangles;
    previousError = candidate.error;
  }
  return kept;
}

/** Tightly packed float positions, the form the simplifier expects. */
function positionsOf(primitive: Primitive): Float32Array | null {
  const position = primitive.getAttribute("POSITION");
  if (position === null || position.getType() !== "VEC3") return null;
  const array = position.getArray();
  if (array === null) return null;
  if (array instanceof Float32Array && !position.getNormalized()) return array;
  const floats = new Float32Array(position.getCount() * 3);
  const element: number[] = [0, 0, 0];
  for (let vertex = 0; vertex < position.getCount(); vertex += 1) {
    position.getElement(vertex, element);
    floats[vertex * 3] = element[0] as number;
    floats[vertex * 3 + 1] = element[1] as number;
    floats[vertex * 3 + 2] = element[2] as number;
  }
  return floats;
}

/** LOD0 indices, or a lossless sequential indexing of suitable non-indexed input (PRD-377 §4.1). */
function sourceIndices(primitive: Primitive, vertexCount: number): Uint32Array {
  const indices = primitive.getIndices();
  if (indices === null) {
    const sequential = new Uint32Array(vertexCount);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) sequential[vertex] = vertex;
    return sequential;
  }
  return Uint32Array.from(indices.getArray() as ArrayLike<number>);
}

interface IAttributePack {
  readonly data: Float32Array;
  readonly stride: number;
  readonly weights: number[];
}

/**
 * Packs the non-position attributes the simplifier may weight: normals, tangents, UV0/UV1 and
 * vertex colours. A normalized change of `1/weight` over distance `d` is about a change of `d` in
 * position, so normalized attributes get weight 1.
 */
function packAttributes(primitive: Primitive, vertexCount: number): IAttributePack {
  const semantics = primitive.listSemantics().filter((semantic) => semantic !== "POSITION");
  const accessors = semantics
    .map((semantic) => ({ accessor: primitive.getAttribute(semantic), semantic }))
    .filter(
      (
        entry,
      ): entry is {
        accessor: NonNullable<ReturnType<Primitive["getAttribute"]>>;
        semantic: string;
      } => entry.accessor !== null,
    );
  let stride = 0;
  for (const { accessor } of accessors) stride += accessor.getElementSize();
  if (stride === 0) return { data: new Float32Array(0), stride: 0, weights: [] };
  const data = new Float32Array(vertexCount * stride);
  const element: number[] = new Array<number>(stride).fill(0);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    let offset = 0;
    for (const { accessor } of accessors) {
      accessor.getElement(vertex, element);
      const size = accessor.getElementSize();
      for (let component = 0; component < size; component += 1)
        data[vertex * stride + offset + component] = element[component] as number;
      offset += size;
    }
  }
  return { data, stride, weights: new Array<number>(stride).fill(1) };
}

interface IGeneratedChain {
  readonly absoluteErrors: number[];
  readonly baselineTriangles: number;
  readonly counts: number[];
  readonly errorScale: number;
  readonly errors: number[];
  readonly indices: Uint32Array[];
  readonly lod0Triangles: number;
}

/**
 * Every level is derived from the same LOD0 reference — never from the previous level — so the
 * reported error is relative to the authored geometry and a change to one target cannot disturb
 * another level's error budget (PRD-377 §4.3). Targets and the saving rule come from the resolved
 * policy; neither is a module constant the game cannot move.
 */
async function generateChain(
  primitive: Primitive,
  maxLevels: number,
  errorTargets: readonly number[],
  minSaving: number,
): Promise<IGeneratedChain | null> {
  const position = primitive.getAttribute("POSITION");
  if (position === null) return null;
  const positions = positionsOf(primitive);
  if (positions === null) return null;
  const vertexCount = position.getCount();
  const indices = sourceIndices(primitive, vertexCount);
  const lod0Triangles = Math.floor(indices.length / 3);
  if (lod0Triangles <= 0) return null;
  const scale = MeshoptSimplifier.getScale(positions, 3);
  const attributes = packAttributes(primitive, vertexCount);

  const candidates: { error: number; indices: Uint32Array; triangles: number }[] = [];
  for (const targetError of errorTargets) {
    // target_index_count 3 is the smallest triangle list; the error target is the binding
    // constraint, which is what makes this an error-driven chain rather than a ratio ladder.
    const [simplified, error] = MeshoptSimplifier.simplifyWithAttributes(
      indices,
      positions,
      3,
      attributes.data,
      attributes.stride,
      attributes.weights,
      null,
      3,
      targetError,
      ["LockBorder"],
    );
    candidates.push({
      error,
      indices: Uint32Array.from(simplified),
      triangles: Math.floor(simplified.length / 3),
    });
  }
  const kept = selectDiscreteLevels(candidates, maxLevels, lod0Triangles, minSaving);
  if (kept.length === 0) return null;
  const keptSet = new Set(kept);
  const chain = candidates.filter((candidate) => keptSet.has(candidate));
  return {
    absoluteErrors: chain.map((level) => level.error * scale),
    baselineTriangles: lod0Triangles,
    counts: chain.map((level) => level.triangles),
    errorScale: scale,
    errors: chain.map((level) => level.error),
    indices: chain.map((level) => level.indices),
    lod0Triangles,
  };
}

function reachableNodes(document: Document): GltfNode[] {
  const visited = new Set<GltfNode>();
  const nodes: GltfNode[] = [];
  const walk = (node: GltfNode): void => {
    if (visited.has(node)) return;
    visited.add(node);
    nodes.push(node);
    node.listChildren().forEach(walk);
  };
  document
    .getRoot()
    .listScenes()
    .flatMap((scene) => scene.listChildren())
    .forEach(walk);
  return nodes;
}

interface IMeshFlags {
  authoredLod: boolean;
  skinned: boolean;
}

function meshFlags(document: Document): Map<Mesh, IMeshFlags> {
  const flags = new Map<Mesh, IMeshFlags>();
  for (const node of reachableNodes(document)) {
    const mesh = node.getMesh();
    if (mesh === null) continue;
    const current = flags.get(mesh) ?? { authoredLod: false, skinned: false };
    current.skinned ||= node.getSkin() !== null;
    current.authoredLod ||= authoredLodName(node.getName()) || authoredLodName(mesh.getName());
    flags.set(mesh, current);
  }
  return flags;
}

function emptySummary(policy: IResolvedLodPolicy, generatedSeconds: number): IModelLodSummary {
  return {
    byteOverhead: 0,
    diagnostics: [...policy.diagnostics],
    enabled: policy.enabled,
    errorTargets: [...policy.generation.errorTargets],
    fingerprint: policy.fingerprint.generation,
    generated: 0,
    levels: 0,
    maxLevels: policy.generation.maxLevels,
    minSaving: policy.generation.minSaving,
    minTriangles: policy.generation.minTriangles,
    minTrianglesScope: policy.generation.minTrianglesScope,
    preset: policy.preset,
    primitives: [],
    reasons: [...policy.reasons],
    runtime: { ...policy.runtime },
    skipped: 0,
    trianglesAfter: 0,
    trianglesBefore: 0,
    generatedSeconds,
  };
}

/**
 * Generates a discrete chain on every eligible primitive and attaches `TN_discrete_lod`.
 *
 * Runs after `reorder` (the last stage that moves a vertex) and before `quantize` (which changes
 * what a position *is*, never which vertex it is), and after the virtual bake so an already-owned
 * primitive is never also discretely generated (PRD-377 §4.2).
 */
export async function generateDiscreteLod(
  document: Document,
  lod: boolean | IModelLodOptions | "none" | undefined,
  logicalPath: string,
  sourceDigest: string,
  legacy: ILodLegacyFlags = {},
  now: () => number = () => Date.now(),
): Promise<IModelLodSummary> {
  const started = now();
  const policy = resolveLodPolicy(lod, logicalPath, legacy);
  const fingerprint = policy.fingerprint.generation;
  if (!policy.enabled) return emptySummary(policy, (now() - started) / 1000);
  if (policy.generation.maxLevels <= 1) return emptySummary(policy, (now() - started) / 1000);

  await MeshoptSimplifier.ready;

  const flags = meshFlags(document);
  // The whole-asset total, computed once: the default floor scope compares every primitive against
  // it so a model split into many small primitives is measured by the asset, not the split.
  const assetTriangles = document
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .reduce((total, primitive) => total + primitiveTriangleCount(primitive), 0);
  let extension: TNDiscreteLod | null = null;
  const primitives: IModelLodPrimitiveSummary[] = [];
  const skipped: IModelLodSkipSummary[] = [];
  const reasons = new Set<DiscreteLodSkipReason>(policy.reasons);
  let levels = 0;
  let byteOverhead = 0;
  let trianglesBefore = 0;
  let trianglesAfter = 0;

  for (const mesh of document.getRoot().listMeshes()) {
    const meshState = flags.get(mesh) ?? { authoredLod: false, skinned: false };
    for (const [primitiveIndex, primitive] of mesh.listPrimitives().entries()) {
      const eligibility = classifyPrimitive(primitive, {
        alreadyCooked: primitive.getExtension(TN_DISCRETE_LOD) !== null,
        assetTriangles,
        authoredLod: meshState.authoredLod,
        legacySimplify: legacy.simplify === true,
        legacyVirtualNone: false,
        minTriangles: policy.generation.minTriangles,
        minTrianglesScope: policy.generation.minTrianglesScope,
        skinned: meshState.skinned,
        virtualOwned: primitive.getExtension(TN_VIRTUAL_GEOMETRY) !== null,
      });
      if (!eligibility.eligible) {
        const reason = eligibility.reason ?? "disabled";
        reasons.add(reason);
        skipped.push({ mesh: mesh.getName(), primitive: primitiveIndex, reason });
        continue;
      }
      const before = primitiveTriangleCount(primitive);
      trianglesBefore += before;
      const chain = await generateChain(
        primitive,
        policy.generation.maxLevels,
        policy.generation.errorTargets,
        policy.generation.minSaving,
      );
      if (chain === null) {
        // The simplifier could not reach the configured saving at any target: a normal skip, not a
        // failure, and named distinctly from the cheap pre-filter's `too-small`.
        reasons.add("insufficient-reduction");
        skipped.push({
          mesh: mesh.getName(),
          primitive: primitiveIndex,
          reason: "insufficient-reduction",
        });
        trianglesAfter += before;
        continue;
      }
      extension ??= document.createExtension(TNDiscreteLod).setRequired(false);
      const property = attachDiscreteLod(document, extension, primitive, chain);
      byteOverhead += discreteLodBytes(property);
      levels = Math.max(levels, chain.counts.length);
      const finest = chain.counts[chain.counts.length - 1] ?? before;
      trianglesAfter += finest;
      primitives.push({
        levels: chain.counts.map((triangles, index) => ({
          absoluteError: chain.absoluteErrors[index] as number,
          error: chain.errors[index] as number,
          triangles,
        })),
        mesh: mesh.getName(),
        primitive: primitiveIndex,
        strategy: "discrete",
        trianglesBefore: before,
      });
    }
  }

  const metadata: ILodArtifactMetadata = {
    generator: `${LOD_GENERATOR}/${String(LOD_GENERATOR_VERSION)}`,
    generationFingerprint: fingerprint,
    schemaVersion: LOD_ARTIFACT_SCHEMA_VERSION,
    sourceDigest,
    sourcePath: logicalPath,
    toolchain: LOD_TOOLCHAIN,
  };
  extension?.setMetadata(metadata);

  return {
    byteOverhead,
    diagnostics: [...policy.diagnostics],
    enabled: true,
    errorTargets: [...policy.generation.errorTargets],
    fingerprint,
    generated: primitives.length,
    levels,
    maxLevels: policy.generation.maxLevels,
    minSaving: policy.generation.minSaving,
    minTriangles: policy.generation.minTriangles,
    minTrianglesScope: policy.generation.minTrianglesScope,
    preset: policy.preset,
    primitives,
    reasons: [...reasons],
    runtime: { ...policy.runtime },
    skipped: skipped.length,
    trianglesAfter,
    trianglesBefore,
    generatedSeconds: (now() - started) / 1000,
  };
}

/**
 * Validates a decoded artifact's `TN_discrete_lod` payload: version (in `read`), index ranges,
 * count/error monotonicity and the LOD0 triangle identity. Fails closed — a malformed chain must
 * stop the build here, not a game (PRD-377 §5, §7).
 */
export function validateDiscreteLod(root: ReturnType<Document["getRoot"]>): void {
  for (const mesh of root.listMeshes()) {
    for (const [primitiveIndex, primitive] of mesh.listPrimitives().entries()) {
      const property = primitive.getExtension<DiscreteLod>(TN_DISCRETE_LOD);
      if (property === null) continue;
      const position = primitive.getAttribute("POSITION");
      if (position === null)
        throw new Error(
          `TN_DISCRETE_LOD_INVALID: '${mesh.getName()}'#${String(primitiveIndex)} has a chain but no POSITION.`,
        );
      const vertices = position.getCount();
      const indices = property.getIndices();
      const counts = property.getCounts();
      const errors = property.getErrors();
      if (indices.length !== counts.length || counts.length !== errors.length)
        throw new Error(
          `TN_DISCRETE_LOD_INVALID: '${mesh.getName()}'#${String(primitiveIndex)} has mismatched level arrays.`,
        );
      let previousTriangles = property.getLod0Triangles();
      let previousError = -1;
      for (const [level, accessor] of indices.entries()) {
        const array = accessor.getArray();
        if (array === null)
          throw new Error(
            `TN_DISCRETE_LOD_INVALID: '${mesh.getName()}'#${String(primitiveIndex)} level ${String(level)} has no indices.`,
          );
        if (array.length % 3 !== 0)
          throw new Error(
            `TN_DISCRETE_LOD_INVALID: '${mesh.getName()}'#${String(primitiveIndex)} level ${String(level)} is not a triangle list.`,
          );
        for (let index = 0; index < array.length; index += 1) {
          const value = array[index] as number;
          if (value < 0 || value >= vertices)
            throw new Error(
              `TN_DISCRETE_LOD_INVALID: '${mesh.getName()}'#${String(primitiveIndex)} level ${String(level)} index ${String(value)} is out of range for ${String(vertices)} vertices.`,
            );
        }
        const triangles = Math.floor(array.length / 3);
        if (triangles <= 0 || triangles >= previousTriangles)
          throw new Error(
            `TN_DISCRETE_LOD_INVALID: '${mesh.getName()}'#${String(primitiveIndex)} level ${String(level)} is not a reduction (${String(previousTriangles)} -> ${String(triangles)}).`,
          );
        const error = errors[level] as number;
        if (!Number.isFinite(error) || error < previousError)
          throw new Error(
            `TN_DISCRETE_LOD_INVALID: '${mesh.getName()}'#${String(primitiveIndex)} level ${String(level)} has non-monotonic error.`,
          );
        previousTriangles = triangles;
        previousError = error;
      }
    }
  }
}
