// Ported from three.js r185 (three@0.185.1). The MIT License, Copyright © 2010-2026 three.js authors.
/**
 * three's `BufferGeometryUtils.mergeGeometries` and `mergeAttributes` (three@0.185.1
 * examples/jsm/utils/BufferGeometryUtils.js) over an engine's own BufferGeometry and
 * BufferAttribute, for both back ends.
 *
 * One order differs from three's, never a result: three builds the merged BufferAttribute around an
 * empty typed array and fills the array afterwards, which works because three keeps the array it is
 * handed. An engine attribute copies its array when it is built, so the array is filled first.
 * Every refusal is three's: `console.error` with three's message, then `null`.
 */

type TypedArray =
  | Float32Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array;

interface IAttributeLike {
  readonly array: TypedArray;
  readonly itemSize: number;
  readonly normalized: boolean;
  readonly count: number;
  gpuType?: number;
  readonly isInterleavedBufferAttribute?: boolean;
  getComponent(index: number, component: number): number;
}

interface IGeometryLike {
  readonly index: (IAttributeLike & { getX(index: number): number }) | null;
  readonly attributes: Readonly<Record<string, IAttributeLike>>;
  readonly morphAttributes: Readonly<Record<string, readonly IAttributeLike[]>>;
  readonly morphTargetsRelative: boolean;
}

interface IMergedGeometry {
  addGroup(start: number, count: number, materialIndex: number): void;
  setIndex(index: number[]): void;
  setAttribute(name: string, attribute: IAttributeLike): void;
  morphAttributes: Record<string, IAttributeLike[]>;
}

/** What one engine supplies: the two classes a merge builds. */
export interface IGeometryUtilsEngine {
  // biome-ignore lint/style/useNamingConvention: three's class name, so a back end passes its class map.
  readonly BufferGeometry: new () => object;
  // biome-ignore lint/style/useNamingConvention: see BufferGeometry.
  readonly BufferAttribute: new (
    array: TypedArray,
    itemSize: number,
    normalized?: boolean,
  ) => object;
}

const PREFIX = "THREE.BufferGeometryUtils:";

export function defineBufferGeometryUtils(engine: IGeometryUtilsEngine) {
  function mergeAttributes(attributes: readonly IAttributeLike[]): IAttributeLike | null {
    let Typed: (new (length: number) => TypedArray) | undefined;
    let itemSize: number | undefined;
    let normalized: boolean | undefined;
    let gpuType: number | undefined = -1;
    let arrayLength = 0;
    for (const attribute of attributes) {
      const made = attribute.array.constructor as new (length: number) => TypedArray;
      Typed ??= made;
      if (Typed !== made) {
        console.error(
          `${PREFIX} .mergeAttributes() failed. BufferAttribute.array must be of consistent array types across matching attributes.`,
        );
        return null;
      }
      itemSize ??= attribute.itemSize;
      if (itemSize !== attribute.itemSize) {
        console.error(
          `${PREFIX} .mergeAttributes() failed. BufferAttribute.itemSize must be consistent across matching attributes.`,
        );
        return null;
      }
      normalized ??= attribute.normalized;
      if (normalized !== attribute.normalized) {
        console.error(
          `${PREFIX} .mergeAttributes() failed. BufferAttribute.normalized must be consistent across matching attributes.`,
        );
        return null;
      }
      if (gpuType === -1) gpuType = attribute.gpuType;
      if (gpuType !== attribute.gpuType) {
        console.error(
          `${PREFIX} .mergeAttributes() failed. BufferAttribute.gpuType must be consistent across matching attributes.`,
        );
        return null;
      }
      arrayLength += attribute.count * itemSize;
    }
    if (Typed === undefined || itemSize === undefined) return null;
    const array = new Typed(arrayLength);
    let offset = 0;
    for (const attribute of attributes) {
      if (attribute.isInterleavedBufferAttribute) {
        for (let j = 0; j < attribute.count; j++)
          for (let c = 0; c < itemSize; c++)
            array[offset + j * itemSize + c] = attribute.getComponent(j, c);
      } else array.set(attribute.array, offset);
      offset += attribute.count * itemSize;
    }
    const result = new engine.BufferAttribute(array, itemSize, normalized) as IAttributeLike;
    // The engine attribute already holds three's default; its gpuType is written only to change it.
    if (gpuType !== undefined && result.gpuType !== gpuType) result.gpuType = gpuType;
    return result;
  }

  // Each geometry's attributes and morph attributes, grouped by name; a string is three's refusal.
  function collect(
    geometries: readonly IGeometryLike[],
    merged: IMergedGeometry,
    useGroups: boolean,
  ) {
    const first = geometries[0] as IGeometryLike;
    const isIndexed = first.index !== null;
    const attributesUsed = new Set(Object.keys(first.attributes));
    const morphAttributesUsed = new Set(Object.keys(first.morphAttributes));
    const attributes: Record<string, IAttributeLike[]> = {};
    const morphAttributes: Record<string, (readonly IAttributeLike[])[]> = {};
    let offset = 0;
    for (const [i, geometry] of geometries.entries()) {
      const at = `${PREFIX} .mergeGeometries() failed with geometry at index ${i}.`;
      if (isIndexed !== (geometry.index !== null))
        return `${at} All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them.`;
      let attributesCount = 0;
      for (const name of Object.keys(geometry.attributes)) {
        if (!attributesUsed.has(name))
          return `${at} All geometries must have compatible attributes; make sure "${name}" attribute exists among all geometries, or in none of them.`;
        attributes[name] ??= [];
        attributes[name].push(geometry.attributes[name] as IAttributeLike);
        attributesCount++;
      }
      if (attributesCount !== attributesUsed.size)
        return `${at} Make sure all geometries have the same number of attributes.`;
      if (first.morphTargetsRelative !== geometry.morphTargetsRelative)
        return `${at} .morphTargetsRelative must be consistent throughout all geometries.`;
      for (const name of Object.keys(geometry.morphAttributes)) {
        if (!morphAttributesUsed.has(name))
          return `${at}  .morphAttributes must be consistent throughout all geometries.`;
        morphAttributes[name] ??= [];
        morphAttributes[name].push(geometry.morphAttributes[name] as readonly IAttributeLike[]);
      }
      if (useGroups) {
        const count = isIndexed ? geometry.index?.count : geometry.attributes.position?.count;
        if (count === undefined)
          return `${at} The geometry must have either an index or a position attribute`;
        merged.addGroup(offset, count, i);
        offset += count;
      }
    }
    return { attributes, morphAttributes, isIndexed };
  }

  function mergeGeometries(geometries: readonly IGeometryLike[], useGroups = false): object | null {
    const merged = new engine.BufferGeometry() as IMergedGeometry;
    const found = collect(geometries, merged, useGroups);
    if (typeof found === "string") {
      console.error(found);
      return null;
    }
    if (found.isIndexed) {
      let indexOffset = 0;
      const mergedIndex: number[] = [];
      for (const geometry of geometries) {
        const index = geometry.index as NonNullable<IGeometryLike["index"]>;
        for (let j = 0; j < index.count; ++j) mergedIndex.push(index.getX(j) + indexOffset);
        indexOffset += (geometry.attributes.position as IAttributeLike).count;
      }
      merged.setIndex(mergedIndex);
    }
    for (const [name, list] of Object.entries(found.attributes)) {
      const attribute = mergeAttributes(list);
      if (!attribute) {
        console.error(
          `${PREFIX} .mergeGeometries() failed while trying to merge the ${name} attribute.`,
        );
        return null;
      }
      merged.setAttribute(name, attribute);
    }
    for (const [name, perGeometry] of Object.entries(found.morphAttributes)) {
      const numMorphTargets = (perGeometry[0] as readonly IAttributeLike[]).length;
      if (numMorphTargets === 0) continue;
      const targets: IAttributeLike[] = [];
      for (let i = 0; i < numMorphTargets; ++i) {
        const attribute = mergeAttributes(perGeometry.map((list) => list[i] as IAttributeLike));
        if (!attribute) {
          console.error(
            `${PREFIX} .mergeGeometries() failed while trying to merge the ${name} morphAttribute.`,
          );
          return null;
        }
        targets.push(attribute);
      }
      merged.morphAttributes[name] = targets;
    }
    return merged;
  }

  return { mergeGeometries, mergeAttributes };
}
