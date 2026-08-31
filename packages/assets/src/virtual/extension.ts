// `TN_virtual_geometry` — the cluster DAG's payload, carried inside the `.glb` the pipeline already
// emits (PRD-281 §3).
//
// Not a new file type: a scene format is closed with evidence, and an asset only this framework can
// open is a file format by another name. The extension is optional, every accessor it adds is
// unreferenced by any primitive, and a stock `GLTFLoader` that has never heard of it loads the mesh
// and draws it exactly as authored.

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
  type WriterContext,
} from "@gltf-transform/core";
import type { IClusterDag } from "./dag.js";

export const TN_VIRTUAL_GEOMETRY = "TN_virtual_geometry";

/**
 * The parent error of a root cluster, written instead of `Infinity`.
 *
 * A root is drawn at every threshold at or above its own error, which `Infinity` says exactly and
 * `float32` cannot carry through an accessor's min/max without turning into `null` in the JSON
 * chunk. The largest finite `float32` says the same thing to every comparison a renderer will make.
 */
export const ROOT_PARENT_ERROR = 3.4028234663852886e38;

/** Written into `clusterGroups` where a cluster has no group on that side. */
export const NO_GROUP = 0xffffffff;

/**
 * The usage the writer files this extension's accessors under.
 *
 * Every ref carries it. Without a usage on the edge the graph cannot tell the writer what these
 * accessors are for, and it warns and lays them out as if they were nothing.
 */
const VIRTUAL_ACCESSOR = "TN_VIRTUAL_GEOMETRY";

interface IVirtualGeometryProperties extends IProperty {
  clusterBounds: Accessor;
  clusterCones: Accessor;
  clusterErrors: Accessor;
  clusterGroups: Accessor;
  clusterParentSpheres: Accessor;
  clusterRanges: Accessor;
  clusterSourceSpheres: Accessor;
  indices: Accessor;
  levelTriangles: number[];
  stopReason: string;
}

/**
 * One primitive's cluster DAG.
 *
 * Six accessors, all indexing the primitive's own `POSITION` buffer, plus the level trace and the
 * reason the bake stopped. There is no group table: selection needs a cluster's own error and its
 * parent group's error and nothing else, and both are per cluster here — which is the point of
 * recording error per group in the first place.
 */
export class VirtualGeometry extends ExtensionProperty<IVirtualGeometryProperties> {
  static override EXTENSION_NAME: typeof TN_VIRTUAL_GEOMETRY = TN_VIRTUAL_GEOMETRY;
  declare extensionName: typeof TN_VIRTUAL_GEOMETRY;
  declare parentTypes: [PropertyType.PRIMITIVE];
  declare propertyType: "VirtualGeometry";

  protected init(): void {
    this.extensionName = TN_VIRTUAL_GEOMETRY;
    this.propertyType = "VirtualGeometry";
    this.parentTypes = [PropertyType.PRIMITIVE];
  }

  protected override getDefaults(): Nullable<IVirtualGeometryProperties> {
    return Object.assign(super.getDefaults() as IProperty, {
      clusterBounds: null,
      clusterCones: null,
      clusterErrors: null,
      clusterGroups: null,
      clusterParentSpheres: null,
      clusterRanges: null,
      clusterSourceSpheres: null,
      indices: null,
      levelTriangles: [],
      stopReason: "root",
    });
  }

  /** Cluster-ordered triangles for every level. */
  getIndices(): Accessor | null {
    return this.getRef("indices");
  }

  setIndices(accessor: Accessor | null): this {
    return this.setRef("indices", accessor, { usage: VIRTUAL_ACCESSOR });
  }

  /** Per cluster: start and index count into `indices`. */
  getClusterRanges(): Accessor | null {
    return this.getRef("clusterRanges");
  }

  setClusterRanges(accessor: Accessor | null): this {
    return this.setRef("clusterRanges", accessor, { usage: VIRTUAL_ACCESSOR });
  }

  /** Per cluster: its own object-space error, and its parent group's. */
  getClusterErrors(): Accessor | null {
    return this.getRef("clusterErrors");
  }

  setClusterErrors(accessor: Accessor | null): this {
    return this.setRef("clusterErrors", accessor, { usage: VIRTUAL_ACCESSOR });
  }

  /** Per cluster: bounding sphere, centre and radius. */
  getClusterBounds(): Accessor | null {
    return this.getRef("clusterBounds");
  }

  setClusterBounds(accessor: Accessor | null): this {
    return this.setRef("clusterBounds", accessor, { usage: VIRTUAL_ACCESSOR });
  }

  /** Per cluster: normal cone axis and cutoff. */
  getClusterCones(): Accessor | null {
    return this.getRef("clusterCones");
  }

  setClusterCones(accessor: Accessor | null): this {
    return this.setRef("clusterCones", accessor, { usage: VIRTUAL_ACCESSOR });
  }

  /** Per cluster: the group it folds into, and the group that produced it. `NO_GROUP` for neither. */
  getClusterGroups(): Accessor | null {
    return this.getRef("clusterGroups");
  }

  setClusterGroups(accessor: Accessor | null): this {
    return this.setRef("clusterGroups", accessor, { usage: VIRTUAL_ACCESSOR });
  }

  /**
   * Per cluster: the sphere its own error is projected through at run time — the sphere of the
   * group that produced it.
   */
  getClusterSourceSpheres(): Accessor | null {
    return this.getRef("clusterSourceSpheres");
  }

  setClusterSourceSpheres(accessor: Accessor | null): this {
    return this.setRef("clusterSourceSpheres", accessor, { usage: VIRTUAL_ACCESSOR });
  }

  /**
   * Per cluster: the sphere its parent error is projected through — the sphere of the group it
   * folds into, shared with every sibling so they flip together.
   *
   * Two spheres rather than one because a screen-space cut cracks without them: a group's sphere
   * encloses every child's, so the parent's projected error can never fall below a child's however
   * the camera moves.
   */
  getClusterParentSpheres(): Accessor | null {
    return this.getRef("clusterParentSpheres");
  }

  setClusterParentSpheres(accessor: Accessor | null): this {
    return this.setRef("clusterParentSpheres", accessor, { usage: VIRTUAL_ACCESSOR });
  }

  getLevelTriangles(): number[] {
    return this.get("levelTriangles");
  }

  setLevelTriangles(levels: number[]): this {
    return this.set("levelTriangles", levels);
  }

  getStopReason(): string {
    return this.get("stopReason");
  }

  setStopReason(reason: string): this {
    return this.set("stopReason", reason);
  }
}

interface IVirtualGeometryDef {
  clusterBounds: number;
  clusterCones: number;
  clusterErrors: number;
  clusterGroups: number;
  clusterParentSpheres: number;
  clusterRanges: number;
  clusterSourceSpheres: number;
  indices: number;
  levelTriangles: number[];
  stopReason: string;
}

export class TNVirtualGeometry extends Extension {
  static override EXTENSION_NAME: typeof TN_VIRTUAL_GEOMETRY = TN_VIRTUAL_GEOMETRY;
  override readonly extensionName = TN_VIRTUAL_GEOMETRY;
  override readonly prewriteTypes = [PropertyType.ACCESSOR];

  createVirtualGeometry(): VirtualGeometry {
    return new VirtualGeometry(this.document.getGraph());
  }

  read(context: ReaderContext): this {
    const meshDefs = context.jsonDoc.json.meshes ?? [];
    meshDefs.forEach((meshDef, meshIndex) => {
      (meshDef.primitives ?? []).forEach((primitiveDef, primitiveIndex) => {
        const def = primitiveDef.extensions?.[TN_VIRTUAL_GEOMETRY] as
          | IVirtualGeometryDef
          | undefined;
        if (def === undefined) return;
        const virtual = this.createVirtualGeometry()
          .setIndices(context.accessors[def.indices] as Accessor)
          .setClusterRanges(context.accessors[def.clusterRanges] as Accessor)
          .setClusterErrors(context.accessors[def.clusterErrors] as Accessor)
          .setClusterBounds(context.accessors[def.clusterBounds] as Accessor)
          .setClusterCones(context.accessors[def.clusterCones] as Accessor)
          .setClusterGroups(context.accessors[def.clusterGroups] as Accessor)
          .setClusterSourceSpheres(context.accessors[def.clusterSourceSpheres] as Accessor)
          .setClusterParentSpheres(context.accessors[def.clusterParentSpheres] as Accessor)
          .setLevelTriangles([...def.levelTriangles])
          .setStopReason(def.stopReason);
        const mesh = context.meshes[meshIndex];
        const primitive = mesh?.listPrimitives()[primitiveIndex];
        primitive?.setExtension(TN_VIRTUAL_GEOMETRY, virtual);
      });
    });
    return this;
  }

  /**
   * These accessors belong to no primitive, so the writer would otherwise have no usage for them
   * and no reason to lay them out. Grouping them by parent keeps one primitive's DAG in one buffer
   * view, which is what PRD-285's streaming will want to fetch a range of.
   */
  override prewrite(context: WriterContext): this {
    context.accessorUsageGroupedByParent.add(VIRTUAL_ACCESSOR);
    for (const property of this.properties) {
      for (const accessor of accessorsOf(property as VirtualGeometry))
        context.addAccessorToUsageGroup(accessor, VIRTUAL_ACCESSOR);
    }
    return this;
  }

  write(context: WriterContext): this {
    for (const mesh of this.document.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        const virtual = primitive.getExtension<VirtualGeometry>(TN_VIRTUAL_GEOMETRY);
        if (virtual === null) continue;
        const meshIndex = context.meshIndexMap.get(mesh);
        if (meshIndex === undefined) continue;
        const primitiveIndex = mesh.listPrimitives().indexOf(primitive);
        const primitiveDef = context.jsonDoc.json.meshes?.[meshIndex]?.primitives?.[primitiveIndex];
        if (primitiveDef === undefined) continue;
        // Fails closed. An accessor the writer never laid out would otherwise be written as
        // `undefined`, vanish from the JSON, and produce a file whose extension is missing a field
        // — which reads back as a loader crash in a game rather than as a bad bake here.
        const index = (accessor: Accessor | null, field: string): number => {
          const slot = accessor === null ? undefined : context.accessorIndexMap.get(accessor);
          if (slot === undefined)
            throw new Error(
              `TN_VIRTUAL_GEOMETRY_ACCESSOR_MISSING: '${field}' on mesh '${mesh.getName()}' has no index in the written file.`,
            );
          return slot;
        };
        primitiveDef.extensions = primitiveDef.extensions ?? {};
        primitiveDef.extensions[TN_VIRTUAL_GEOMETRY] = {
          clusterBounds: index(virtual.getClusterBounds(), "clusterBounds"),
          clusterCones: index(virtual.getClusterCones(), "clusterCones"),
          clusterErrors: index(virtual.getClusterErrors(), "clusterErrors"),
          clusterGroups: index(virtual.getClusterGroups(), "clusterGroups"),
          clusterParentSpheres: index(virtual.getClusterParentSpheres(), "clusterParentSpheres"),
          clusterRanges: index(virtual.getClusterRanges(), "clusterRanges"),
          clusterSourceSpheres: index(virtual.getClusterSourceSpheres(), "clusterSourceSpheres"),
          indices: index(virtual.getIndices(), "indices"),
          levelTriangles: virtual.getLevelTriangles(),
          stopReason: virtual.getStopReason(),
        } satisfies IVirtualGeometryDef;
      }
    }
    return this;
  }
}

function accessorsOf(virtual: VirtualGeometry): Accessor[] {
  return [
    virtual.getIndices(),
    virtual.getClusterRanges(),
    virtual.getClusterErrors(),
    virtual.getClusterBounds(),
    virtual.getClusterCones(),
    virtual.getClusterGroups(),
    virtual.getClusterSourceSpheres(),
    virtual.getClusterParentSpheres(),
  ].filter((accessor): accessor is Accessor => accessor !== null);
}

/**
 * Attaches a baked DAG to a primitive, creating the six accessors it needs.
 *
 * The caller owns the extension instance so that one document's worth of primitives share it, which
 * is what puts a single `TN_virtual_geometry` in `extensionsUsed`.
 */
export function attachVirtualGeometry(
  document: Document,
  extension: TNVirtualGeometry,
  primitive: Primitive,
  dag: IClusterDag,
): VirtualGeometry {
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer();
  const count = dag.clusters.length;
  const ranges = new Uint32Array(count * 2);
  const errors = new Float32Array(count * 2);
  const bounds = new Float32Array(count * 4);
  const cones = new Float32Array(count * 4);
  const groups = new Uint32Array(count * 2);
  const sourceSpheres = new Float32Array(count * 4);
  const parentSpheres = new Float32Array(count * 4);
  const sourceGroups = new Uint32Array(count).fill(NO_GROUP);
  for (let group = 0; group < dag.groups.length; group += 1)
    for (const parent of (dag.groups[group] as (typeof dag.groups)[number]).parents)
      sourceGroups[parent] = group;

  for (let cluster = 0; cluster < count; cluster += 1) {
    const record = dag.clusters[cluster] as (typeof dag.clusters)[number];
    ranges[cluster * 2] = record.start;
    ranges[cluster * 2 + 1] = record.count;
    errors[cluster * 2] = record.error;
    errors[cluster * 2 + 1] = Number.isFinite(record.parentError)
      ? record.parentError
      : ROOT_PARENT_ERROR;
    bounds[cluster * 4] = record.bounds.centerX;
    bounds[cluster * 4 + 1] = record.bounds.centerY;
    bounds[cluster * 4 + 2] = record.bounds.centerZ;
    bounds[cluster * 4 + 3] = record.bounds.radius;
    cones[cluster * 4] = record.bounds.coneAxisX;
    cones[cluster * 4 + 1] = record.bounds.coneAxisY;
    cones[cluster * 4 + 2] = record.bounds.coneAxisZ;
    cones[cluster * 4 + 3] = record.bounds.coneCutoff;
    groups[cluster * 2] = record.group === -1 ? NO_GROUP : record.group;
    groups[cluster * 2 + 1] = sourceGroups[cluster] as number;
    sourceSpheres[cluster * 4] = record.sourceSphere.x;
    sourceSpheres[cluster * 4 + 1] = record.sourceSphere.y;
    sourceSpheres[cluster * 4 + 2] = record.sourceSphere.z;
    sourceSpheres[cluster * 4 + 3] = record.sourceSphere.radius;
    parentSpheres[cluster * 4] = record.parentSphere.x;
    parentSpheres[cluster * 4 + 1] = record.parentSphere.y;
    parentSpheres[cluster * 4 + 2] = record.parentSphere.z;
    parentSpheres[cluster * 4 + 3] = record.parentSphere.radius;
  }

  const accessor = (
    array: Float32Array | Uint32Array,
    type: "SCALAR" | "VEC2" | "VEC4",
  ): Accessor => document.createAccessor().setArray(array).setType(type).setBuffer(buffer);

  const virtual = extension
    .createVirtualGeometry()
    .setIndices(accessor(dag.indices.slice(), "SCALAR"))
    .setClusterRanges(accessor(ranges, "VEC2"))
    .setClusterErrors(accessor(errors, "VEC2"))
    .setClusterBounds(accessor(bounds, "VEC4"))
    .setClusterCones(accessor(cones, "VEC4"))
    .setClusterGroups(accessor(groups, "VEC2"))
    .setClusterSourceSpheres(accessor(sourceSpheres, "VEC4"))
    .setClusterParentSpheres(accessor(parentSpheres, "VEC4"))
    .setLevelTriangles(dag.levels.map((level) => level.triangleCount))
    .setStopReason(dag.stopReason);
  primitive.setExtension(TN_VIRTUAL_GEOMETRY, virtual);
  return virtual;
}

/** Bytes this payload adds to the file, before compression. */
export function virtualGeometryBytes(virtual: VirtualGeometry): number {
  let bytes = 0;
  for (const accessor of accessorsOf(virtual)) {
    const array = accessor.getArray();
    bytes += array === null ? 0 : array.byteLength;
  }
  return bytes;
}
