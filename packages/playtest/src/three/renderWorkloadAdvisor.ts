import type { Camera, Object3D, Scene } from "three";

export type RenderAdvisorOwner = "framework" | "generated-src";
export type RenderAdvisorSeverity = "info" | "warning";
export type RenderAdvisorTransformSafety = "caller-declared-static" | "unknown";

export interface IRenderAdvisorExamplePaths {
  readonly gpuParticles: string;
  readonly hudInstancing: string;
  readonly materialSharing: string;
  readonly staticMerge: string;
}

export interface IRenderAdvisorObservedRendererCounters {
  readonly drawCalls?: number;
  readonly triangles?: number;
}

export interface IRenderAdvisorObservedPass {
  readonly cameraToken: string;
  readonly depthToken?: string;
  readonly equivalenceToken?: string;
  readonly purpose?: "color" | "depth-prepass" | "other" | "post" | "shadow";
  readonly renderCalls?: number;
  readonly sceneToken: string;
  readonly targetToken?: string;
}

export interface IRenderAdvisorObservedInput {
  readonly passes?: readonly IRenderAdvisorObservedPass[];
  readonly renderer?: IRenderAdvisorObservedRendererCounters;
}

export interface IRenderAdvisorInput {
  readonly camera?: Camera;
  readonly materialMutationSafety?: "caller-declared-stable" | "unknown";
  readonly observed?: IRenderAdvisorObservedInput;
  readonly particleWorkload?: "caller-declared-many-independent-objects" | "unknown";
  readonly scene: Scene;
  readonly spriteWorkload?: "caller-declared-camera-overlay" | "unknown";
  readonly topN?: number;
  readonly transformSafety?: RenderAdvisorTransformSafety;
  readonly verifiedExamplePaths: IRenderAdvisorExamplePaths;
}

export interface IRenderAdvisorGroup {
  readonly constraintReasonCounts: Record<string, number>;
  readonly eligibleDynamicCount: number;
  readonly eligibleStaticCount: number;
  readonly geometryIdentities: number;
  readonly materialIdentities: number;
  readonly memberCount: number;
}

export interface IRenderAdvisorRecommendation {
  readonly caveats: readonly string[];
  readonly code: string;
  readonly constraints: Record<string, number>;
  readonly evidence: {
    readonly metric: string;
    readonly path: string;
  };
  readonly examplePath: string;
  readonly expectedReducedCount?: number;
  readonly observedCount: number;
  readonly owner: RenderAdvisorOwner;
  readonly severity: RenderAdvisorSeverity;
}

export interface IRenderAdvisorReport {
  readonly schemaVersion: 1;
  readonly observed: {
    readonly passes: { readonly recorded: number; readonly truncated: number };
    readonly renderer: IRenderAdvisorObservedRendererCounters;
  };
  readonly passObservations: readonly {
    readonly count: number;
    readonly reasonCode: string;
  }[];
  readonly recommendations: readonly IRenderAdvisorRecommendation[];
  readonly snapshot: {
    readonly geometryIdentityCount: number;
    readonly instancedRenderableCount: number;
    readonly logicalObjectCount: number;
    readonly logicalObjectCountIncludesRootScene: true;
    readonly materialIdentityCount: number;
    readonly pointsCount: number;
    readonly renderableCount: number;
    readonly spriteCount: number;
    readonly visibleFlagRenderableCount: number;
  };
  readonly topGroups: readonly IRenderAdvisorGroup[];
}

type MeshLike = Object3D & {
  readonly geometry?: object;
  readonly isInstancedMesh?: boolean;
  readonly isMesh?: boolean;
  readonly isPoints?: boolean;
  readonly isSkinnedMesh?: boolean;
  readonly isSprite?: boolean;
  readonly material?: unknown;
  readonly morphTargetInfluences?: unknown;
  onBeforeRender: Object3D["onBeforeRender"];
  onAfterRender: Object3D["onAfterRender"];
};

interface IGroupBuild {
  readonly constraintReasonCounts: Map<string, number>;
  readonly geometries: Set<object>;
  readonly materials: Set<object>;
  eligibleDynamicCount: number;
  eligibleStaticCount: number;
  memberCount: number;
}

const DEFAULT_TOP_N = 10;
const MAX_TOP_N = 32;
const MAX_OBSERVED_PASSES = 64;
const GROUP_FLOOR = 16;
const SPRITE_FLOOR = 32;
const POINT_OBJECT_FLOOR = 16;
const VERIFIED_EXAMPLE_PATHS: IRenderAdvisorExamplePaths = {
  gpuParticles: "examples/abyss-framework/src/scenes/Abyss.ts",
  hudInstancing: "packages/create-threenative/templates/minimal/src/render/hud.ts",
  materialSharing: "packages/create-threenative/templates/starter/src/render/materials.ts",
  staticMerge: "examples/native-cpu-load-test/src/main.ts",
};

export function adviseThreeRenderWorkload(input: IRenderAdvisorInput): IRenderAdvisorReport {
  const examplePaths = validateVerifiedExamplePaths(input.verifiedExamplePaths);
  const topN = clampTopN(input.topN);
  const geometryIds = new WeakMap<object, number>();
  const materialIds = new WeakMap<object, number>();
  let nextGeometryId = 1;
  let nextMaterialId = 1;
  const geometries = new Set<object>();
  const materials = new Set<object>();
  const groups = new Map<string, IGroupBuild>();
  const materialComparableGroups = new Map<string, IGroupBuild>();
  let logicalObjectCount = 0;
  let renderableCount = 0;
  let instancedRenderableCount = 0;
  let spriteCount = 0;
  let pointsCount = 0;

  const geometryId = (value: object): number => idOf(geometryIds, value, () => nextGeometryId++);
  const materialId = (value: object): number => idOf(materialIds, value, () => nextMaterialId++);

  input.scene.traverse((object) => {
    logicalObjectCount += 1;
    const renderable = object as MeshLike;
    if (!isRenderable(renderable)) return;
    if (!object.visible) return;
    if (renderable.isInstancedMesh === true) instancedRenderableCount += instanceCount(renderable);
    if (renderable.isSprite === true) spriteCount += 1;
    if (renderable.isPoints === true) pointsCount += 1;
    renderableCount += 1;
    const geometry = renderable.geometry;
    const objectMaterials = materialList(renderable.material);
    if (geometry !== undefined) geometries.add(geometry);
    for (const material of objectMaterials) materials.add(material);
    const key = groupKey(renderable, geometry, objectMaterials, geometryId, materialId);
    const group = groups.get(key) ?? createGroup();
    groups.set(key, group);
    const count = renderable.isInstancedMesh === true ? instanceCount(renderable) : 1;
    group.memberCount += count;
    if (geometry !== undefined) group.geometries.add(geometry);
    for (const material of objectMaterials) group.materials.add(material);

    if (objectMaterials.length > 0 && renderable.isMesh === true && geometry !== undefined) {
      const comparableSignatures = objectMaterials.map(comparableMaterialSignature);
      if (comparableSignatures.every((signature) => signature !== undefined)) {
        const comparableKey = `${geometryId(geometry)}:${comparableSignatures.join("+")}`;
        const comparable = materialComparableGroups.get(comparableKey) ?? createGroup();
        materialComparableGroups.set(comparableKey, comparable);
        comparable.memberCount += count;
        comparable.geometries.add(geometry);
        for (const material of objectMaterials) comparable.materials.add(material);
      }
    }

    const reasons = constraintReasons(renderable, input.materialMutationSafety ?? "unknown");
    if (reasons.length === 0) {
      if ((input.transformSafety ?? "unknown") === "caller-declared-static") group.eligibleStaticCount += count;
      else group.eligibleDynamicCount += count;
    } else {
      for (const reason of reasons) increment(group.constraintReasonCounts, reason, count);
    }
  });

  if ((input.materialMutationSafety ?? "unknown") === "unknown") {
    for (const group of materialComparableGroups.values()) {
      if (group.materials.size > 1) increment(group.constraintReasonCounts, "materialMutationSafetyUnknown", group.memberCount);
    }
  }

  const allGroups = [...groups.values()].map(serializeGroup).sort((left, right) => right.memberCount - left.memberCount);
  const materialShareGroups = [...materialComparableGroups.values()]
    .map(serializeGroup)
    .sort((left, right) => right.memberCount - left.memberCount);
  const topGroups = allGroups.slice(0, topN);
  const observedPasses = validatedPasses(input.observed?.passes ?? []);
  const observed = {
    passes: {
      recorded: observedPasses.length,
      truncated: Math.max(0, (input.observed?.passes?.length ?? 0) - observedPasses.length),
    },
    renderer: sanitizeObservedRenderer(input.observed?.renderer),
  };
  const passObservations = observePasses(observedPasses);
  const recommendations: IRenderAdvisorRecommendation[] = [];
  const compatibleGroups = allGroupsWithMinimum(allGroups, GROUP_FLOOR);
  const compatibleCount = compatibleGroups.reduce((sum, group) => sum + group.memberCount, 0);
  const expectedGroups = compatibleGroups.length;
  const firstCompatible = compatibleGroups[0];
  if (firstCompatible !== undefined && instancedRenderableCount === 0) {
    recommendations.push({
      caveats: [
        "dynamic-transforms-use-instancing",
        "generated-source-remedy-only",
        "static-merge-requires-caller-declared-static-transforms",
      ],
      code: "TN_RENDER_ADVISE_INSTANCE_COMPATIBLE",
      constraints: firstCompatible.constraintReasonCounts,
      evidence: { metric: "snapshot.compatibleGroups.memberCount", path: "topGroups.memberCount" },
      examplePath: examplePaths.staticMerge,
      expectedReducedCount: expectedGroups,
      observedCount: compatibleCount,
      owner: "generated-src",
      severity: "warning",
    });
    if ((input.transformSafety ?? "unknown") === "caller-declared-static") {
      recommendations.push({
        caveats: ["caller-declared-static-transforms", "preserve-pickability-and-animation-semantics"],
        code: "TN_RENDER_ADVISE_STATIC_MERGE_COMPATIBLE",
        constraints: firstCompatible.constraintReasonCounts,
        evidence: { metric: "snapshot.compatibleGroups.eligibleStaticCount", path: "topGroups.eligibleStaticCount" },
        examplePath: examplePaths.staticMerge,
        expectedReducedCount: expectedGroups,
        observedCount: compatibleCount,
        owner: "generated-src",
        severity: "warning",
      });
    }
  }

  const materialShareGroup = materialShareGroups.find((group) => group.memberCount >= GROUP_FLOOR && group.materialIdentities > 1 && group.constraintReasonCounts.materialMutationSafetyUnknown === undefined);
  if (materialShareGroup !== undefined && input.materialMutationSafety === "caller-declared-stable") {
    recommendations.push({
      caveats: ["caller-declared-material-mutation-safe", "do-not-stringify-shaders-textures-userData"],
      code: "TN_RENDER_ADVISE_SHARE_MATERIALS",
      constraints: materialShareGroup.constraintReasonCounts,
      evidence: { metric: "snapshot.materialComparableGroup.materialIdentities", path: "topGroups.materialIdentities" },
      examplePath: examplePaths.materialSharing,
      expectedReducedCount: materialShareGroup.geometryIdentities,
      observedCount: materialShareGroup.materialIdentities,
      owner: "generated-src",
      severity: "info",
    });
  }

  if (spriteCount >= SPRITE_FLOOR && input.spriteWorkload === "caller-declared-camera-overlay") {
    recommendations.push({
      caveats: ["camera-parented-hud-only", "negative-controls-stay-ordinary-sprites"],
      code: "TN_RENDER_ADVISE_HUD_INSTANCING",
      constraints: {},
      evidence: { metric: "snapshot.spriteCount", path: "snapshot.spriteCount" },
      examplePath: examplePaths.hudInstancing,
      expectedReducedCount: 1,
      observedCount: spriteCount,
      owner: "generated-src",
      severity: "info",
    });
  }
  if (pointsCount >= POINT_OBJECT_FLOOR && input.particleWorkload === "caller-declared-many-independent-objects") {
    recommendations.push({
      caveats: ["many-independent-point-or-sprite-like-objects-only", "single-Points-is-already-batched"],
      code: "TN_RENDER_ADVISE_GPU_PARTICLES",
      constraints: {},
      evidence: { metric: "snapshot.pointsCount", path: "snapshot.pointsCount" },
      examplePath: examplePaths.gpuParticles,
      expectedReducedCount: 1,
      observedCount: pointsCount,
      owner: "generated-src",
      severity: "info",
    });
  }

  const redundantPass = passObservations.find((entry) => entry.reasonCode === "repeatedEquivalentPass");
  if (redundantPass !== undefined) {
    recommendations.push({
      caveats: ["caller-provided-pass-equivalence-required", "do-not-remove-depth-shadow-post-passes"],
      code: "TN_RENDER_ADVISE_REPEATED_PASS",
      constraints: {},
      evidence: { metric: "observed.passSemantics", path: "passObservations" },
      examplePath: examplePaths.staticMerge,
      expectedReducedCount: 1,
      observedCount: redundantPass.count,
      owner: "generated-src",
      severity: "warning",
    });
  }

  return {
    schemaVersion: 1,
    observed,
    passObservations,
    recommendations,
    snapshot: {
      geometryIdentityCount: geometries.size,
      instancedRenderableCount,
      logicalObjectCount,
      logicalObjectCountIncludesRootScene: true,
      materialIdentityCount: materials.size,
      pointsCount,
      renderableCount,
      spriteCount,
      visibleFlagRenderableCount: renderableCount,
    },
    topGroups,
  };
}

function clampTopN(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TOP_N;
  if (!Number.isFinite(value)) return DEFAULT_TOP_N;
  return Math.max(1, Math.min(MAX_TOP_N, Math.floor(value)));
}

function validateVerifiedExamplePaths(paths: IRenderAdvisorExamplePaths): IRenderAdvisorExamplePaths {
  for (const key of Object.keys(VERIFIED_EXAMPLE_PATHS) as Array<keyof IRenderAdvisorExamplePaths>) {
    if (paths[key] !== VERIFIED_EXAMPLE_PATHS[key]) {
      throw new Error(`verifiedExamplePaths.${key} must be the exact advisor allowlist path.`);
    }
  }
  return VERIFIED_EXAMPLE_PATHS;
}

function sanitizeObservedRenderer(
  counters: IRenderAdvisorObservedRendererCounters | undefined,
): IRenderAdvisorObservedRendererCounters {
  return {
    ...(safeObservedCounter(counters?.drawCalls) === undefined ? {} : { drawCalls: safeObservedCounter(counters?.drawCalls) }),
    ...(safeObservedCounter(counters?.triangles) === undefined ? {} : { triangles: safeObservedCounter(counters?.triangles) }),
  };
}

function safeObservedCounter(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function idOf(map: WeakMap<object, number>, value: object, next: () => number): number {
  const existing = map.get(value);
  if (existing !== undefined) return existing;
  const created = next();
  map.set(value, created);
  return created;
}

function createGroup(): IGroupBuild {
  return {
    constraintReasonCounts: new Map(),
    eligibleDynamicCount: 0,
    eligibleStaticCount: 0,
    geometries: new Set(),
    materials: new Set(),
    memberCount: 0,
  };
}

function serializeGroup(group: IGroupBuild): IRenderAdvisorGroup {
  return {
    constraintReasonCounts: Object.fromEntries([...group.constraintReasonCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    eligibleDynamicCount: group.eligibleDynamicCount,
    eligibleStaticCount: group.eligibleStaticCount,
    geometryIdentities: group.geometries.size,
    materialIdentities: group.materials.size,
    memberCount: group.memberCount,
  };
}

function isRenderable(object: MeshLike): boolean {
  return object.isMesh === true || object.isInstancedMesh === true || object.isSprite === true || object.isPoints === true;
}

function materialList(material: unknown): object[] {
  if (Array.isArray(material)) {
    const items: object[] = [];
    for (const item of material) {
      if (typeof item !== "object" || item === null) throw new Error("render advisor material array contains a non-object material.");
      items.push(item);
    }
    return items;
  }
  if (material === undefined || material === null) return [];
  if (typeof material !== "object") throw new Error("render advisor material must be an object.");
  return [material];
}

function groupKey(
  object: MeshLike,
  geometry: object | undefined,
  materials: readonly object[],
  geometryId: (value: object) => number,
  materialId: (value: object) => number,
): string {
  if (object.isSprite === true) return "sprite";
  if (object.isPoints === true) return `points:${geometry === undefined ? "none" : geometryId(geometry)}`;
  const material = materials.length === 0 ? "none" : materials.map((item) => materialSignature(item, materialId)).join("+");
  return `${geometry === undefined ? "none" : geometryId(geometry)}:${material}`;
}

function materialSignature(material: object, materialId: (value: object) => number): string {
  const record = material as Record<string, unknown>;
  const color = record.color as { getHexString?: () => string } | undefined;
  const type = String(record.type ?? "Material");
  if (isCustomShaderMaterial(record)) return `unsafe-custom-shader:${type}`;
  if (isNodeMaterial(record)) return `unsafe-node-material:${type}`;
  if (hasMappedTexture(record)) return `unsafe-mapped-texture:${type}`;
  return [
    `identity-${materialId(material)}`,
    type,
    color?.getHexString?.() ?? "no-color",
    String(record.transparent ?? false),
    String(record.blending ?? ""),
    String(record.depthWrite ?? ""),
    String(record.depthTest ?? ""),
    String(record.side ?? ""),
    String(record.roughness ?? ""),
    String(record.metalness ?? ""),
    String(record.flatShading ?? ""),
  ].join("|");
}

function comparableMaterialSignature(material: object): string | undefined {
  const record = material as Record<string, unknown>;
  if (isCustomShaderMaterial(record) || isNodeMaterial(record) || hasMappedTexture(record)) return undefined;
  const color = record.color as { getHexString?: () => string } | undefined;
  const type = String(record.type ?? "Material");
  return [
    type,
    color?.getHexString?.() ?? "no-color",
    String(record.transparent ?? false),
    String(record.blending ?? ""),
    String(record.depthWrite ?? ""),
    String(record.depthTest ?? ""),
    String(record.side ?? ""),
    String(record.roughness ?? ""),
    String(record.metalness ?? ""),
    String(record.flatShading ?? ""),
  ].join("|");
}

function constraintReasons(object: MeshLike, _materialMutationSafety: "caller-declared-stable" | "unknown"): string[] {
  const reasons: string[] = [];
  const materials = materialList(object.material) as Array<Record<string, unknown>>;
  if (object.isSkinnedMesh === true) reasons.push("skinnedMesh");
  if (Array.isArray(object.morphTargetInfluences) && object.morphTargetInfluences.length > 0) reasons.push("morphTargets");
  if (hasOwnFunction(object, "onBeforeRender")) reasons.push("renderHook");
  if (hasOwnFunction(object, "onAfterRender")) reasons.push("renderHook");
  if (object.layers.mask !== 1) reasons.push("customLayerMask");
  if (object.renderOrder !== 0) reasons.push("customRenderOrder");
  for (const material of materials) {
    if (material.transparent === true) reasons.push("transparentMaterial");
    if (isCustomShaderMaterial(material)) reasons.push("customShader", "materialCustomShader");
    if (isNodeMaterial(material)) reasons.push("customNode", "materialCustomNode");
    if (hasMappedTexture(material)) reasons.push("materialTextureMap");
  }
  return uniqueStrings(reasons);
}

function hasOwnFunction(object: object, key: string): boolean {
  return Object.hasOwn(object, key) && typeof (object as Record<string, unknown>)[key] === "function";
}

function isCustomShaderMaterial(material: Record<string, unknown>): boolean {
  const type = String(material.type ?? "");
  return type === "ShaderMaterial" || type === "RawShaderMaterial" || (Object.hasOwn(material, "onBeforeCompile") && typeof material.onBeforeCompile === "function");
}

function isNodeMaterial(material: Record<string, unknown>): boolean {
  return String(material.type ?? "").includes("Node");
}

function hasMappedTexture(material: Record<string, unknown>): boolean {
  const map = material.map;
  return typeof map === "object" && map !== null;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function instanceCount(object: MeshLike): number {
  const value = (object as unknown as { count?: unknown }).count;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function increment(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function incompatibleCount(group: IRenderAdvisorGroup): number {
  let sum = 0;
  for (const [reason, count] of Object.entries(group.constraintReasonCounts)) {
    if (reason !== "materialMutationSafetyUnknown") sum += count;
  }
  return sum;
}

function allGroupsWithMinimum(groups: readonly IRenderAdvisorGroup[], minimum: number): IRenderAdvisorGroup[] {
  const result: IRenderAdvisorGroup[] = [];
  for (const group of groups) {
    if (group.memberCount >= minimum && incompatibleCount(group) === 0) result.push(group);
  }
  return result;
}

function validatedPasses(passes: readonly IRenderAdvisorObservedPass[]): IRenderAdvisorObservedPass[] {
  const result: IRenderAdvisorObservedPass[] = [];
  const limit = Math.min(MAX_OBSERVED_PASSES, passes.length);
  for (let index = 0; index < limit; index += 1) {
    const pass = passes[index];
    if (pass === undefined) throw new Error("observed.passes contains an empty entry.");
    for (const key of ["sceneToken", "cameraToken"] as const) {
      if (typeof pass[key] !== "string" || pass[key].length === 0) throw new Error(`observed.passes.${key} must be a non-empty string.`);
    }
    for (const key of ["depthToken", "equivalenceToken", "targetToken"] as const) {
      const value = pass[key];
      if (value !== undefined && (typeof value !== "string" || value.length === 0)) throw new Error(`observed.passes.${key} must be a non-empty string when present.`);
    }
    if (pass.renderCalls !== undefined && (!Number.isSafeInteger(pass.renderCalls) || pass.renderCalls < 0)) throw new Error("observed.passes.renderCalls must be a non-negative integer.");
    result.push(pass);
  }
  return result;
}

function observePasses(passes: readonly IRenderAdvisorObservedPass[]): Array<{ count: number; reasonCode: string }> {
  if (passes.length <= 1) return passes.length === 0 ? [] : [{ count: passes.length, reasonCode: "singlePassObserved" }];
  const buckets = new Map<string, number>();
  let different = 0;
  for (const pass of passes) {
    const key = [pass.sceneToken, pass.cameraToken, pass.targetToken ?? "screen", pass.depthToken ?? "default", pass.purpose ?? "color", pass.equivalenceToken ?? "unknown"].join("|");
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const observations: Array<{ count: number; reasonCode: string }> = [];
  for (const count of buckets.values()) {
    if (count > 1) observations.push({ count, reasonCode: "repeatedEquivalentPass" });
    else different += 1;
  }
  if (different > 0) observations.push({ count: different, reasonCode: "differentPassSemantics" });
  return observations;
}

