/** CPU export boundary. No renderer, donor, or browser dependency. */
export type NumericArray = Float32Array | Float64Array | Uint32Array | Uint16Array | Uint8Array | Int32Array | Int16Array | Int8Array | Uint8ClampedArray;
export interface IAttribute {
  readonly array: NumericArray;
  readonly itemSize: number;
  readonly normalized?: boolean;
}
export interface IGroup { readonly start: number; readonly count: number; readonly materialIndex: number; }
export interface IGeometryBuffers {
  readonly attributes: Readonly<Record<string, IAttribute>>;
  readonly indices: Uint16Array | Uint32Array | null;
  readonly range: { readonly start: number; readonly count: number };
  readonly groups: readonly IGroup[];
}
export interface ICompactedGeometry {
  readonly attributes: Readonly<Record<string, IAttribute>>;
  readonly indices: Uint16Array | Uint32Array;
  readonly groups: readonly IGroup[];
}
function integer(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`CSG ${label} must be a nonnegative safe integer.`);
}
/** Copy only drawn triangles; never mutate or dispose the donor's backing buffers. */
export function compactTriangles(input: IGeometryBuffers): ICompactedGeometry {
  const position = input.attributes.position;
  if (!position || position.itemSize !== 3) throw new Error('CSG position must be a vec3 attribute.');
  const vertices = position.array.length / 3;
  integer(vertices, 'vertex count');
  for (const [name, attribute] of Object.entries(input.attributes)) {
    integer(attribute.itemSize, `${name} itemSize`);
    if (attribute.itemSize === 0 || attribute.array.length / attribute.itemSize !== vertices)
      throw new Error(`CSG ${name} attribute count does not match position.`);
    for (const value of attribute.array)
      if (!Number.isFinite(value)) throw new Error(`CSG ${name} must contain finite values.`);
  }
  const total = input.indices?.length ?? vertices;
  const { start } = input.range;
  const count = input.range.count === Infinity ? total - start : input.range.count;
  integer(start, 'range start'); integer(count, 'range count');
  if (start % 3 !== 0 || count % 3 !== 0 || start + count > total)
    throw new Error('CSG active range must contain complete, in-bounds triangles.');
  const groups: IGroup[] = [];
  for (const group of input.groups) {
    integer(group.start, 'group start'); integer(group.count, 'group count'); integer(group.materialIndex, 'material index');
    if (group.start % 3 !== 0 || group.count % 3 !== 0 || group.start + group.count > total)
      throw new Error('CSG group must contain complete, in-bounds triangles.');
    const left = Math.max(start, group.start);
    const right = Math.min(start + count, group.start + group.count);
    if (right > left) groups.push({ start: left - start, count: right - left, materialIndex: group.materialIndex });
  }
  groups.sort((a, b) => a.start - b.start);
  if (input.groups.length > 0) {
    let covered = 0;
    for (const group of groups) {
      if (group.start < covered) throw new Error('CSG material groups overlap.');
      if (group.start !== covered) throw new Error('CSG material groups do not cover the active range.');
      covered += group.count;
    }
    if (covered !== count) throw new Error('CSG material groups do not cover the active range.');
  }
  const remap = new Map<number, number>();
  const sourceVertices: number[] = [];
  const indexValues = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const original = input.indices === null ? start + i : input.indices[start + i];
    if (original === undefined || !Number.isInteger(original) || original < 0 || original >= vertices)
      throw new Error(`CSG index at ${start + i} is outside the attribute arrays.`);
    let mapped = remap.get(original);
    if (mapped === undefined) {
      mapped = sourceVertices.length;
      remap.set(original, mapped); sourceVertices.push(original);
    }
    indexValues[i] = mapped;
  }
  const attributes: Record<string, IAttribute> = Object.create(null);
  for (const [name, source] of Object.entries(input.attributes)) {
    const ArrayType = source.array.constructor as new (length: number) => NumericArray;
    const array = new ArrayType(sourceVertices.length * source.itemSize);
    for (let i = 0; i < sourceVertices.length; i++) {
      const offset = sourceVertices[i] * source.itemSize;
      array.set(source.array.subarray(offset, offset + source.itemSize), i * source.itemSize);
    }
    attributes[name] = { array, itemSize: source.itemSize, normalized: source.normalized ?? false };
  }
  return { attributes, indices: sourceVertices.length <= 65536 ? new Uint16Array(indexValues) : indexValues, groups };
}
