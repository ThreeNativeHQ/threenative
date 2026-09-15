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
  authoredLodName,
  classifyPrimitive,
  primitiveTriangleCount,
} from "./eligibility.js";
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
  /** Levels in the chain including LOD0; integer 1–8. */
  readonly maxLevels?: number;
  /** Per eligible primitive, not per GLB. */
  readonly minTriangles?: number;
}

export interface IModelLodOverride {
  readonly enabled?: boolean;
  readonly generation?: IModelLodGenerationOptions;
  /** Accepted for the seam; generation never reads it. */
  readonly preset?: string;
  readonly runtime?: {
    readonly hysteresis?: number;
    readonly maxPixelError?: number;
  };
}

/**
 * `assets.lod`, as the compile step reads it. `preset` and `runtime` travel here for the seam's
 * sake but generation never reads them: a pixel-budget edit must not change baked geometry
 * (PRD-377 §3.2, §5).
 */
export interface IModelLodOptions {
  readonly enabled?: boolean;
  readonly generation?: IModelLodGenerationOptions;
  readonly overrides?: Readonly<Record<string, boolean | IModelLodOverride>>;
  readonly preset?: string;
  readonly runtime?: {
    readonly hysteresis?: number;
    readonly maxPixelError?: number;
  };
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
 */
export const LOD_ERROR_TARGETS: readonly number[] = [0.002, 0.006, 0.02, 0.06];

/** A derived level must save at least this fraction of its predecessor's triangles (PRD-377 §4.3). */
export const LOD_MIN_SAVING = 0.2;

export const DEFAULT_LOD_MAX_LEVELS = 4;
export const DEFAULT_LOD_MIN_TRIANGLES = 5_000;

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
  readonly enabled: boolean;
  readonly fingerprint: string;
  readonly generated: number;
  readonly maxLevels: number;
  readonly minTriangles: number;
  /** Max derived levels on any one primitive. */
  readonly levels: number;
  readonly primitives: readonly IModelLodPrimitiveSummary[];
  readonly reasons: readonly DiscreteLodSkipReason[];
  readonly skipped: number;
  readonly trianglesAfter: number;
  readonly trianglesBefore: number;
  readonly generatedSeconds: number;
}

export interface ILodLegacyFlags {
  /** `assets.models.simplify` is declared. */
  readonly simplify?: boolean;
  /** `assets.models.virtual` is `"none"`. */
  readonly virtualNone?: boolean;
}

export interface IResolvedGenerationPolicy {
  readonly enabled: boolean;
  readonly maxLevels: number;
  readonly minTriangles: number;
  readonly reasons: readonly DiscreteLodSkipReason[];
}

/**
 * Asset override, then project, then default — the generation half of PRD-377 §3.2. The global
 * `false` / `{ enabled: false }` is absolute; legacy declarations translate here rather than
 * running a parallel path.
 */
export function resolveGenerationPolicy(
  lod: boolean | IModelLodOptions | "none" | undefined,
  asset: string,
  legacy: ILodLegacyFlags = {},
): IResolvedGenerationPolicy {
  const project = typeof lod === "object" && lod !== null ? lod : undefined;
  const override = project?.overrides?.[asset];
  const assetBlock = typeof override === "object" && override !== null ? override : undefined;
  const globalOff = lod === false || lod === "none" || project?.enabled === false;
  let enabled = project?.enabled ?? true;
  if (override === false) enabled = false;
  else if (override === true) enabled = true;
  else if (assetBlock?.enabled !== undefined) enabled = assetBlock.enabled;
  // Any explicit new declaration — even one that only names a generation knob — is a deliberate
  // opt-in when it conflicts with a legacy declaration (PRD-377 §3.3).
  const explicitlyEnabled = hasExplicitPolicy(lod) || hasExplicitPolicy(override);
  if (globalOff) enabled = false;

  const maxLevels =
    assetBlock?.generation?.maxLevels ?? project?.generation?.maxLevels ?? DEFAULT_LOD_MAX_LEVELS;
  const minTriangles =
    assetBlock?.generation?.minTriangles ??
    project?.generation?.minTriangles ??
    DEFAULT_LOD_MIN_TRIANGLES;

  const reasons: DiscreteLodSkipReason[] = [];
  if (!enabled) {
    reasons.push("disabled");
  } else if (legacy.virtualNone === true && !explicitlyEnabled) {
    enabled = false;
    reasons.push("virtual-none");
  } else if (legacy.simplify === true && !explicitlyEnabled) {
    enabled = false;
    reasons.push("explicit-legacy-simplify");
  }
  return { enabled, maxLevels, minTriangles, reasons };
}

/** True when a `lod` value declares at least one field; `{}` and omission are the same policy. */
function hasExplicitPolicy(
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

/** A candidate level before the 20%-saving and monotonicity rules are applied. */
export interface ILodLevelCandidate {
  readonly error: number;
  readonly triangles: number;
}

/**
 * Applies PRD-377 §4.3's rejection rules to candidates ordered by increasing error: a level must
 * reduce triangles, must save at least {@link LOD_MIN_SAVING} of its predecessor, and its error
 * must be no lower than the last kept level's. A candidate that does not reduce is skipped rather
 * than ending the ladder, because each candidate was derived from LOD0 independently. A zero-error
 * level is kept explicitly when it still removes work under the recorded metric.
 */
export function selectDiscreteLevels(
  candidates: readonly ILodLevelCandidate[],
  maxLevels: number,
  referenceTriangles: number,
): readonly ILodLevelCandidate[] {
  const kept: ILodLevelCandidate[] = [];
  let previousTriangles = referenceTriangles;
  let previousError = -1;
  for (const candidate of candidates) {
    if (kept.length >= Math.max(0, maxLevels - 1)) break;
    if (candidate.triangles <= 0 || candidate.triangles >= previousTriangles) continue;
    const saving = (previousTriangles - candidate.triangles) / previousTriangles;
    if (saving < LOD_MIN_SAVING) continue;
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
 * another level's error budget (PRD-377 §4.3).
 */
async function generateChain(
  primitive: Primitive,
  maxLevels: number,
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
  for (const targetError of LOD_ERROR_TARGETS) {
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
  const kept = selectDiscreteLevels(candidates, maxLevels, lod0Triangles);
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

/** The identity a stale artifact must fail to match: policy, generator, schema and toolchain. */
export function generationFingerprint(policy: IResolvedGenerationPolicy, asset: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        asset,
        enabled: policy.enabled,
        generator: `${LOD_GENERATOR}/${String(LOD_GENERATOR_VERSION)}`,
        maxLevels: policy.maxLevels,
        minTriangles: policy.minTriangles,
        schema: LOD_ARTIFACT_SCHEMA_VERSION,
        toolchain: LOD_TOOLCHAIN,
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

function emptySummary(
  policy: IResolvedGenerationPolicy,
  generatedSeconds: number,
  fingerprint: string,
): IModelLodSummary {
  return {
    byteOverhead: 0,
    enabled: policy.enabled,
    fingerprint,
    generated: 0,
    levels: 0,
    maxLevels: policy.maxLevels,
    minTriangles: policy.minTriangles,
    primitives: [],
    reasons: [...policy.reasons],
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
  const policy = resolveGenerationPolicy(lod, logicalPath, legacy);
  const fingerprint = generationFingerprint(policy, logicalPath);
  if (!policy.enabled) return emptySummary(policy, (now() - started) / 1000, fingerprint);
  if (policy.maxLevels <= 1) return emptySummary(policy, (now() - started) / 1000, fingerprint);

  await MeshoptSimplifier.ready;

  const flags = meshFlags(document);
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
        authoredLod: meshState.authoredLod,
        legacySimplify: legacy.simplify === true,
        legacyVirtualNone: false,
        minTriangles: policy.minTriangles,
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
      const chain = await generateChain(primitive, policy.maxLevels);
      if (chain === null) {
        reasons.add("too-small");
        skipped.push({ mesh: mesh.getName(), primitive: primitiveIndex, reason: "too-small" });
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
    enabled: true,
    fingerprint,
    generated: primitives.length,
    levels,
    maxLevels: policy.maxLevels,
    minTriangles: policy.minTriangles,
    primitives,
    reasons: [...reasons],
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
