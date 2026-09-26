import type { IWorldExtent, IWorldTerrain } from "./world-package.js";

const HEIGHTMAP_MAX = 65_535;

function hostIsLittleEndian(): boolean {
  const view = new DataView(new ArrayBuffer(2));
  view.setUint16(0, 1, true);
  return view.getUint8(0) === 1;
}

/**
 * Build a game-usable `sampleHeight` from a raw v1 heightmap.
 *
 * The returned function interpolates bilinearly in world units and clamps to the map edges, so it
 * plugs straight into `Heightfield.fromSampler` and `TerrainTiles`. Height is
 * `heightMin + v / 65535 * (heightMax - heightMin)` at vertex `(column, row)`.
 *
 * @situation turn an exported raw heightmap into terrain collision and rendering
 * @situation query ground height from a Blender-authored world package
 * @constraint the sampler reads the game's data; the framework never selects a terrain shape
 * @example const sampleHeight = heightSamplerFromHeightmap(terrain, extent, await loadWorldHeightmap(url));
 */
export function heightSamplerFromHeightmap(
  terrain: IWorldTerrain,
  extent: IWorldExtent,
  data: Uint16Array,
): (x: number, z: number) => number {
  const expected = terrain.columns * terrain.rows;
  if (data.length !== expected)
    throw new Error(
      `World heightmap expected ${String(expected)} samples, received ${String(data.length)}.`,
    );
  const columns = terrain.columns;
  const rows = terrain.rows;
  const range = terrain.heightMax - terrain.heightMin;
  const heightAt = (index: number): number =>
    terrain.heightMin + ((data[index] as number) / HEIGHTMAP_MAX) * range;

  return (x: number, z: number): number => {
    const column = Math.min(columns - 1, Math.max(0, (x - extent.minX) / terrain.spacing));
    const row = Math.min(rows - 1, Math.max(0, (z - extent.minZ) / terrain.spacing));
    const column0 = Math.floor(column);
    const row0 = Math.floor(row);
    const column1 = Math.min(columns - 1, column0 + 1);
    const row1 = Math.min(rows - 1, row0 + 1);
    const mixX = column - column0;
    const mixZ = row - row0;
    const upperLeft = heightAt(row0 * columns + column0);
    const upperRight = heightAt(row0 * columns + column1);
    const lowerLeft = heightAt(row1 * columns + column0);
    const lowerRight = heightAt(row1 * columns + column1);
    const upper = upperLeft + (upperRight - upperLeft) * mixX;
    const lower = lowerLeft + (lowerRight - lowerLeft) * mixX;
    return upper + (lower - upper) * mixZ;
  };
}

/**
 * Fetch a raw little-endian uint16 heightmap and expose it as samples.
 *
 * @situation load a world package's heightmap once before building terrain
 * @constraint a non-OK response throws; bytes are byte-swapped only on a big-endian host
 * @example const data = await loadWorldHeightmap("/world/terrain/heightmap.u16");
 */
export async function loadWorldHeightmap(url: string): Promise<Uint16Array> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(
      `World heightmap request failed with status ${String(response.status)} for ${url}.`,
    );
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength % 2 !== 0)
    throw new Error(
      `World heightmap ${url} has an odd byte length of ${String(buffer.byteLength)}.`,
    );
  if (!hostIsLittleEndian()) {
    const view = new DataView(buffer);
    for (let offset = 0; offset < buffer.byteLength; offset += 2)
      view.setUint16(offset, view.getUint16(offset, true), false);
  }
  return new Uint16Array(buffer);
}
