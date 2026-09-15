// `TN_discrete_lod` — one primitive's error-driven discrete level chain, carried inside the `.glb`
// the pipeline already emits (PRD-377 §5).
//
// Not a new file type, and not a second scene: LOD0 stays the primitive's ordinary `indices` and
// attributes, so a stock `GLTFLoader` that has never heard of this extension loads the mesh and
// draws exactly the authored geometry. Every derived level is an *index-only* view over those same
// vertices — the simplifier removes triangles, it never moves a vertex — so POSITION, NORMAL,
// TANGENT, TEXCOORD_* and COLOR_0 accessors are shared, and only the index buffers are new bytes.

import {
  type Accessor,
  type Document,
  Extension,
  ExtensionProperty,
  type IProperty,
  type Nullable,
  type Primitive,
  PropertyType,
  type ReaderContext,
  RefList,
  type WriterContext,
} from "@gltf-transform/core";

export const TN_DISCRETE_LOD = "TN_discrete_lod";

/**
 * Bumped when the extension's written schema changes. Read back and validated before use, so a
 * loader from a different framework version refuses a layout it does not understand instead of
 * misreading vertex positions as level counts.
 */
export const LOD_SCHEMA_VERSION = 1;

/**
 * The usage the writer files this extension's index accessors under.
 *
 * Without a usage on the edge the graph cannot tell the writer what these accessors are for, and it
 * warns and lays them out as if they were nothing.
 */
const LOD_ACCESSOR = "TN_DISCRETE_LOD";

/**
 * Document-level identity for the generated payload.
 *
 * `sourceDigest` is the digest of the bytes this cook was handed, and `generationFingerprint` folds
 * the effective generation policy, the generator, the schema and the toolchain together — the same
 * inputs that decide whether geometry is rebaked (PRD-377 §5, §4.3). Runtime selection settings are
 * deliberately absent: a pixel-budget edit must not invalidate baked geometry.
 */
export interface ILodArtifactMetadata {
  readonly generator: string;
  readonly generationFingerprint: string;
  readonly schemaVersion: number;
  readonly sourceDigest: string;
  readonly sourcePath: string;
  readonly toolchain: string;
  /**
   * The opt-in joined far rungs this cook produced, and the authored primitives each one collapsed.
   * Absent unless `assets.lod.generation.join` was enabled; it names the detached far mesh, the
   * draws it produces and every `"mesh#primitive"` source that went into it.
   */
  readonly joined?: readonly IJoinedRungMetadata[];
}

/** One joined far rung as recorded in the artifact: what it collapsed and how many draws it makes. */
export interface IJoinedRungMetadata {
  readonly draws: number;
  /**
   * Absolute local-space geometric error of the joined, reduced far geometry. The runtime appends
   * this as the coarsest step after the discrete chain, so a joined rung is selected only when the
   * projected error fits the same pixel budget as every other level.
   */
  readonly error: number;
  readonly mesh: string;
  readonly primitives: number;
  readonly sources: readonly string[];
  readonly triangles: number;
}

interface IDiscreteLodProperties extends IProperty {
  absoluteErrors: number[];
  baselineTriangles: number;
  counts: number[];
  errorScale: number;
  errors: number[];
  indices: RefList<Accessor>;
  lod0Triangles: number;
  sharedVertexBuffers: boolean;
  strategy: string;
}

/**
 * One primitive's chain.
 *
 * `counts`, `errors` and `absoluteErrors` are parallel to `indices`, one entry per *derived* level;
 * LOD0 is implicit and is the primitive's own geometry. `errorScale` converts the normalized
 * simplifier error to local-space units: `absoluteError = error * errorScale` (PRD-377 §4.3, §5).
 */
export class DiscreteLod extends ExtensionProperty<IDiscreteLodProperties> {
  static override EXTENSION_NAME: typeof TN_DISCRETE_LOD = TN_DISCRETE_LOD;
  declare extensionName: typeof TN_DISCRETE_LOD;
  declare parentTypes: [PropertyType.PRIMITIVE];
  declare propertyType: "DiscreteLod";

  protected init(): void {
    this.extensionName = TN_DISCRETE_LOD;
    this.propertyType = "DiscreteLod";
    this.parentTypes = [PropertyType.PRIMITIVE];
  }

  protected override getDefaults(): Nullable<IDiscreteLodProperties> {
    return Object.assign(super.getDefaults() as IProperty, {
      absoluteErrors: [],
      baselineTriangles: 0,
      counts: [],
      errorScale: 1,
      errors: [],
      indices: new RefList<Accessor>(),
      lod0Triangles: 0,
      sharedVertexBuffers: true,
      strategy: "discrete",
    });
  }

  getIndices(): Accessor[] {
    return this.listRefs("indices") as Accessor[];
  }

  addIndices(accessor: Accessor): this {
    return this.addRef("indices", accessor, { usage: LOD_ACCESSOR });
  }

  getAbsoluteErrors(): number[] {
    return this.get("absoluteErrors");
  }

  getBaselineTriangles(): number {
    return this.get("baselineTriangles");
  }

  getCounts(): number[] {
    return this.get("counts");
  }

  getErrorScale(): number {
    return this.get("errorScale");
  }

  getErrors(): number[] {
    return this.get("errors");
  }

  getLod0Triangles(): number {
    return this.get("lod0Triangles");
  }

  getSharedVertexBuffers(): boolean {
    return this.get("sharedVertexBuffers");
  }

  getStrategy(): string {
    return this.get("strategy");
  }

  setAbsoluteErrors(values: number[]): this {
    return this.set("absoluteErrors", values);
  }

  setBaselineTriangles(count: number): this {
    return this.set("baselineTriangles", count);
  }

  setCounts(counts: number[]): this {
    return this.set("counts", counts);
  }

  setErrorScale(scale: number): this {
    return this.set("errorScale", scale);
  }

  setErrors(errors: number[]): this {
    return this.set("errors", errors);
  }

  setLod0Triangles(count: number): this {
    return this.set("lod0Triangles", count);
  }

  setSharedVertexBuffers(shared: boolean): this {
    return this.set("sharedVertexBuffers", shared);
  }

  setStrategy(strategy: string): this {
    return this.set("strategy", strategy);
  }
}

interface IDiscreteLodDef {
  absoluteErrors: number[];
  baselineTriangles: number;
  counts: number[];
  errorScale: number;
  errors: number[];
  indices: number[];
  lod0Triangles: number;
  schemaVersion: number;
  sharedVertexBuffers: boolean;
  strategy: string;
}

export class TNDiscreteLod extends Extension {
  static override EXTENSION_NAME: typeof TN_DISCRETE_LOD = TN_DISCRETE_LOD;
  override readonly extensionName = TN_DISCRETE_LOD;
  override readonly prewriteTypes = [PropertyType.ACCESSOR];

  private metadata: ILodArtifactMetadata | null = null;

  createDiscreteLod(): DiscreteLod {
    return new DiscreteLod(this.document.getGraph());
  }

  setMetadata(metadata: ILodArtifactMetadata): this {
    this.metadata = metadata;
    return this;
  }

  getMetadata(): ILodArtifactMetadata | null {
    return this.metadata;
  }

  read(context: ReaderContext): this {
    const rootDef = context.jsonDoc.json.extensions?.[TN_DISCRETE_LOD] as
      | ILodArtifactMetadata
      | undefined;
    if (rootDef !== undefined) this.metadata = { ...rootDef };
    const meshDefs = context.jsonDoc.json.meshes ?? [];
    meshDefs.forEach((meshDef, meshIndex) => {
      (meshDef.primitives ?? []).forEach((primitiveDef, primitiveIndex) => {
        const def = primitiveDef.extensions?.[TN_DISCRETE_LOD] as IDiscreteLodDef | undefined;
        if (def === undefined) return;
        if (def.schemaVersion !== LOD_SCHEMA_VERSION) {
          throw new Error(
            `TN_DISCRETE_LOD_SCHEMA: unsupported schema version ${String(def.schemaVersion)}; expected ${String(LOD_SCHEMA_VERSION)}.`,
          );
        }
        const discrete = this.createDiscreteLod()
          .setStrategy(def.strategy)
          .setBaselineTriangles(def.baselineTriangles)
          .setLod0Triangles(def.lod0Triangles)
          .setErrorScale(def.errorScale)
          .setCounts([...def.counts])
          .setErrors([...def.errors])
          .setAbsoluteErrors([...def.absoluteErrors])
          .setSharedVertexBuffers(def.sharedVertexBuffers);
        for (const index of def.indices) {
          const accessor = context.accessors[index];
          if (accessor !== undefined) discrete.addIndices(accessor);
        }
        const mesh = context.meshes[meshIndex];
        mesh?.listPrimitives()[primitiveIndex]?.setExtension(TN_DISCRETE_LOD, discrete);
      });
    });
    return this;
  }

  /**
   * These accessors belong to no primitive, so the writer would otherwise have no usage for them and
   * no reason to lay them out. Grouping them by parent keeps one primitive's levels in one buffer
   * view, which is what Phase 3's residency accounting will want to name.
   */
  override prewrite(context: WriterContext): this {
    context.accessorUsageGroupedByParent.add(LOD_ACCESSOR);
    for (const property of this.properties) {
      for (const accessor of (property as DiscreteLod).getIndices())
        context.addAccessorToUsageGroup(accessor, LOD_ACCESSOR);
    }
    return this;
  }

  write(context: WriterContext): this {
    // Document-level identity once, not once per primitive.
    if (this.metadata !== null) {
      context.jsonDoc.json.extensions = context.jsonDoc.json.extensions ?? {};
      context.jsonDoc.json.extensions[TN_DISCRETE_LOD] = {
        ...this.metadata,
        schemaVersion: LOD_SCHEMA_VERSION,
      };
    }
    for (const mesh of this.document.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        const discrete = primitive.getExtension<DiscreteLod>(TN_DISCRETE_LOD);
        if (discrete === null) continue;
        const meshIndex = context.meshIndexMap.get(mesh);
        if (meshIndex === undefined) continue;
        const primitiveIndex = mesh.listPrimitives().indexOf(primitive);
        const primitiveDef = context.jsonDoc.json.meshes?.[meshIndex]?.primitives?.[primitiveIndex];
        if (primitiveDef === undefined) continue;
        // Fails closed. An accessor the writer never laid out would otherwise be written as
        // `undefined`, vanish from the JSON, and produce a file whose extension is missing a field
        // — which reads back as a loader crash in a game rather than as a bad bake here.
        const indices = discrete.getIndices().map((accessor) => {
          const slot = context.accessorIndexMap.get(accessor);
          if (slot === undefined)
            throw new Error(
              `TN_DISCRETE_LOD_ACCESSOR_MISSING: a level accessor on mesh '${mesh.getName()}' has no index in the written file.`,
            );
          return slot;
        });
        primitiveDef.extensions = primitiveDef.extensions ?? {};
        primitiveDef.extensions[TN_DISCRETE_LOD] = {
          absoluteErrors: discrete.getAbsoluteErrors(),
          baselineTriangles: discrete.getBaselineTriangles(),
          counts: discrete.getCounts(),
          errorScale: discrete.getErrorScale(),
          errors: discrete.getErrors(),
          indices,
          lod0Triangles: discrete.getLod0Triangles(),
          schemaVersion: LOD_SCHEMA_VERSION,
          sharedVertexBuffers: discrete.getSharedVertexBuffers(),
          strategy: discrete.getStrategy(),
        } satisfies IDiscreteLodDef;
      }
    }
    return this;
  }
}

/**
 * Attaches a generated chain to a primitive, creating one accessor per derived level.
 *
 * The caller owns the extension instance so that one document's worth of primitives shares it, which
 * is what puts a single `TN_discrete_lod` in `extensionsUsed`.
 */
export function attachDiscreteLod(
  document: Document,
  extension: TNDiscreteLod,
  primitive: Primitive,
  chain: {
    readonly absoluteErrors: readonly number[];
    readonly baselineTriangles: number;
    readonly counts: readonly number[];
    readonly errorScale: number;
    readonly errors: readonly number[];
    readonly indices: readonly Uint32Array[];
    readonly lod0Triangles: number;
  },
): DiscreteLod {
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer();
  const property = extension
    .createDiscreteLod()
    .setStrategy("discrete")
    .setBaselineTriangles(chain.baselineTriangles)
    .setLod0Triangles(chain.lod0Triangles)
    .setErrorScale(chain.errorScale)
    .setCounts([...chain.counts])
    .setErrors([...chain.errors])
    .setAbsoluteErrors([...chain.absoluteErrors])
    // Index-only levels: the vertices, normals, UVs and colours are the authored ones.
    .setSharedVertexBuffers(true);
  for (const indices of chain.indices) {
    property.addIndices(
      document
        .createAccessor()
        .setArray(Uint32Array.from(indices))
        .setType("SCALAR")
        .setBuffer(buffer),
    );
  }
  primitive.setExtension(TN_DISCRETE_LOD, property);
  return property;
}

/** Bytes this payload adds to the file, before compression: the derived index buffers alone. */
export function discreteLodBytes(discrete: DiscreteLod): number {
  let bytes = 0;
  for (const accessor of discrete.getIndices()) {
    const array = accessor.getArray();
    bytes += array === null ? 0 : array.byteLength;
  }
  return bytes;
}
