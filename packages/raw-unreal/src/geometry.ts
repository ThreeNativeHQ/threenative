import { UAssetError } from "./errors.js";
import type { IUAssetBounds, IUAssetSection, IUAssetSourceStats } from "./types.js";

/** The plain arrays every source-model layout is reduced to before the result is assembled. */
export interface IGeometryBuild {
  positions: Float32Array;
  normals: Float32Array | undefined;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
  sections: IUAssetSection[];
  sourceStats: IUAssetSourceStats;
}

/** Unreal is Z-up left-handed; three.js is Y-up right-handed. */
export function convertVector(
  x: number,
  y: number,
  z: number,
  convertCoordinates: boolean,
): [number, number, number] {
  return convertCoordinates ? [x, z, -y] : [x, y, z];
}

export function computeBounds(positions: Float32Array): IUAssetBounds {
  const min: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (let index = 0; index + 2 < positions.length; index += 3) {
    for (let component = 0; component < 3; component += 1) {
      const value = positions[index + component];
      if (value === undefined) {
        throw new UAssetError(
          "INVALID_MESH_REFERENCE",
          "Position data ended before its declared count",
          { index },
        );
      }
      min[component] = Math.min(min[component] ?? value, value);
      max[component] = Math.max(max[component] ?? value, value);
    }
  }
  return { min, max };
}

/** Lays the grouped triangles out back to back, one draw section per group, in group order. */
export function assembleGeometry(
  positions: Float32Array,
  normals: Float32Array | undefined,
  uvs: Float32Array,
  trianglesByGroup: Map<number, number[]>,
  materialNameFor: (group: number) => string,
  sourceStats: IUAssetSourceStats,
): IGeometryBuild {
  const indexCount = [...trianglesByGroup.values()].reduce((sum, group) => sum + group.length, 0);
  const indices =
    positions.length / 3 > 65_535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

  const sections: IUAssetSection[] = [];
  let cursor = 0;
  for (const [group, groupIndices] of trianglesByGroup) {
    indices.set(groupIndices, cursor);
    sections.push({
      materialIndex: sections.length,
      sectionIndex: group,
      materialName: materialNameFor(group),
      start: cursor,
      count: groupIndices.length,
    });
    cursor += groupIndices.length;
  }

  return { positions, normals, uvs, indices, sections, sourceStats };
}
