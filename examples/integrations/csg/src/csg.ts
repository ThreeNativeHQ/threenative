import { BufferAttribute, BufferGeometry, type Material, Matrix4, Mesh } from "three";
import { ADDITION, Brush, Evaluator, INTERSECTION, SUBTRACTION } from "three-bvh-csg";
import { type IAttribute, type NumericArray, compactTriangles } from "./active-geometry.js";

export type SolidOperation = "union" | "subtract" | "intersect";
export interface ISolidResult {
  readonly mesh: Mesh;
  dispose(): void;
}

/** Real exportable geometry, not the donor's overallocated scratch buffers. */
export function exportGeometry(source: BufferGeometry): BufferGeometry {
  if (Object.keys(source.morphAttributes).length)
    throw new Error("CSG export does not support morph attributes.");
  const attributes: Record<string, IAttribute> = Object.create(null);
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if ("isInterleavedBufferAttribute" in attribute)
      throw new Error(
        `CSG interleaved attribute '${name}' is not supported; deinterleave it before authoring.`,
      );
    attributes[name] = {
      array: attribute.array as NumericArray,
      itemSize: attribute.itemSize,
      normalized: attribute.normalized,
    };
  }
  const compact = compactTriangles({
    attributes,
    indices: (source.index?.array as Uint16Array | Uint32Array | null) ?? null,
    range: source.drawRange,
    groups: source.groups.map((group) => ({ ...group, materialIndex: group.materialIndex ?? 0 })),
  });
  const geometry = new BufferGeometry();
  for (const [name, attribute] of Object.entries(compact.attributes))
    geometry.setAttribute(
      name,
      new BufferAttribute(attribute.array, attribute.itemSize, attribute.normalized),
    );
  geometry.setIndex(new BufferAttribute(compact.indices, 1));
  for (const group of compact.groups)
    geometry.addGroup(group.start, group.count, group.materialIndex);
  if (compact.indices.length) {
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return geometry;
}
function brushFrom(mesh: Mesh): Brush {
  mesh.updateWorldMatrix(true, false);
  const matrix = mesh.matrixWorld;
  if (
    matrix.elements.some((value) => !Number.isFinite(value)) ||
    Math.abs(matrix.determinant()) < 1e-12
  )
    throw new Error(`CSG '${mesh.name || "input"}' has a singular or non-finite world transform.`);
  const geometry = exportGeometry(mesh.geometry);
  geometry.applyMatrix4(matrix);
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const brush = new Brush(geometry, mesh.material);
  brush.updateMatrixWorld(true);
  return brush;
}
/** Offline only. Inputs and their shared materials remain owned by the caller. */
export function evaluateSolid(left: Mesh, right: Mesh, operation: SolidOperation): ISolidResult {
  const operationMap = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION };
  const opcode = operationMap[operation];
  if (opcode === undefined) throw new Error(`CSG unsupported operation '${operation}'.`);
  let a: Brush | undefined;
  let b: Brush | undefined;
  let result: Brush | undefined;
  try {
    a = brushFrom(left);
    b = brushFrom(right);
    const names = Object.keys(a.geometry.attributes).sort();
    if (JSON.stringify(names) !== JSON.stringify(Object.keys(b.geometry.attributes).sort()))
      throw new Error(
        "CSG operands must expose the same attributes; no attribute is silently dropped.",
      );
    for (const name of names) {
      const aa = a.geometry.getAttribute(name);
      const bb = b.geometry.getAttribute(name);
      if (aa.itemSize !== bb.itemSize || aa.normalized !== bb.normalized)
        throw new Error(`CSG attribute '${name}' layouts differ.`);
    }
    const evaluator = new Evaluator();
    evaluator.attributes = names;
    evaluator.useGroups = true;
    result = evaluator.evaluate(a, b, opcode);
    result.updateMatrixWorld(true);
    const geometry = exportGeometry(result.geometry);
    geometry.applyMatrix4(result.matrixWorld);
    const mesh = new Mesh(geometry, result.material as Material | Material[]);
    mesh.name = `csg-${operation}`;
    mesh.matrix.copy(new Matrix4());
    let disposed = false;
    return {
      mesh,
      dispose() {
        if (!disposed) {
          disposed = true;
          geometry.dispose();
        }
      },
    };
  } finally {
    for (const brush of [result, b, a])
      if (brush) {
        brush.disposeCacheData();
        brush.geometry.dispose();
      }
  }
}
