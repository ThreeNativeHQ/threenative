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
    if (
      (name === "normal" && attribute.itemSize !== 3) ||
      (name === "uv" && attribute.itemSize !== 2) ||
      (name === "color" && attribute.itemSize !== 3 && attribute.itemSize !== 4)
    )
      throw new Error(`CSG ${name} attribute layout is not supported.`);
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
/** Baking a reflection removes the object transform, so winding must follow it. */
export function applySolidTransform(geometry: BufferGeometry, matrix: Matrix4): void {
  geometry.applyMatrix4(matrix);
  if (matrix.determinant() < 0 && geometry.index) {
    const indices = geometry.index.array;
    for (let i = 0; i < indices.length; i += 3) {
      const second = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = second;
    }
    geometry.index.needsUpdate = true;
  }
}
function brushFrom(mesh: Mesh): Brush {
  mesh.updateWorldMatrix(true, false);
  const matrix = mesh.matrixWorld;
  if (
    matrix.elements.some((value) => !Number.isFinite(value)) ||
    !Number.isFinite(matrix.determinant()) ||
    Math.abs(matrix.determinant()) < 1e-12
  )
    throw new Error(`CSG '${mesh.name || "input"}' has a singular or non-finite world transform.`);
  const geometry = exportGeometry(mesh.geometry);
  try {
    applySolidTransform(geometry, matrix);
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    const brush = new Brush(geometry, mesh.material);
    brush.updateMatrixWorld(true);
    return brush;
  } catch (error) {
    geometry.dispose();
    throw error;
  }
}
/** Offline only. Inputs and their shared materials remain owned by the caller. */
export function evaluateSolid(left: Mesh, right: Mesh, operation: SolidOperation): ISolidResult {
  const operationMap = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION };
  if (!Object.hasOwn(operationMap, operation))
    throw new Error(`CSG unsupported operation '${operation}'.`);
  const opcode = operationMap[operation];
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
    // Own the target before the donor can throw; finally must release it on failure too.
    result = new Brush(new BufferGeometry(), a.material);
    evaluator.evaluate(a, b, opcode, result);
    result.updateMatrixWorld(true);
    const geometry = exportGeometry(result.geometry);
    applySolidTransform(geometry, result.matrixWorld);
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
