import { BufferAttribute, BufferGeometry, Vector3 } from "three";

export interface IHeightfieldOrigin {
  readonly x: number;
  readonly z: number;
}

export interface IHeightfieldOptions {
  readonly columns: number;
  readonly depth: number;
  readonly heights: Float32Array;
  readonly origin: IHeightfieldOrigin;
  readonly rows: number;
  readonly width: number;
}

export interface IHeightfieldSamplerOptions extends Omit<IHeightfieldOptions, "heights"> {
  /** Game-owned terrain function. It is evaluated once and never retained. */
  readonly sampleHeight: (x: number, z: number) => number;
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`Heightfield ${name} must be finite.`);
  return value;
}

function positive(value: number, name: string): number {
  finite(value, name);
  if (value <= 0) throw new Error(`Heightfield ${name} must be greater than zero.`);
  return value;
}

function count(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 2)
    throw new Error(`Heightfield ${name} must be an integer of at least 2.`);
  return value;
}

/**
 * One height buffer shared by world queries, rendered geometry, and a physics heightfield.
 *
 * The game supplies every value, so changing the terrain's shape never requires a package edit.
 * `fromSampler` evaluates that game function exactly once at each vertex and retains only the
 * resulting numbers. Queries interpolate those same numbers instead of evaluating the function
 * again.
 *
 * @situation build terrain geometry and collision from one game-authored height function
 * @situation query the same ground height or normal that a player sees and collides with
 * @situation build islands and coastlines from terrain
 * @constraint sampleHeight owns the terrain shape and stays in game source; the framework stores and interpolates its output
 * @constraint rows and columns are vertex counts; geometry is row-major z-then-x and collider export transposes once into Rapier's column-major matrix order
 * @override rows, columns, width, depth, origin, and sampleHeight are explicit on every field
 * @example const field = Heightfield.fromSampler({ rows: 65, columns: 65, width: 64, depth: 64, origin: { x: 0, z: 0 }, sampleHeight: terrainHeight });
 */
export class Heightfield {
  readonly columns: number;
  readonly depth: number;
  readonly origin: IHeightfieldOrigin;
  readonly rows: number;
  readonly width: number;
  readonly #cellDepth: number;
  readonly #cellWidth: number;
  readonly #colliderHeights: Float32Array;
  readonly #heights: Float32Array;
  readonly #minimumX: number;
  readonly #minimumZ: number;

  constructor(options: IHeightfieldOptions) {
    this.columns = count(options.columns, "columns");
    this.rows = count(options.rows, "rows");
    this.width = positive(options.width, "width");
    this.depth = positive(options.depth, "depth");
    this.origin = {
      x: finite(options.origin.x, "origin.x"),
      z: finite(options.origin.z, "origin.z"),
    };
    const expected = this.rows * this.columns;
    if (options.heights.length !== expected)
      throw new Error(
        `Heightfield expected ${expected} heights, received ${options.heights.length}.`,
      );
    for (const height of options.heights) finite(height, "height sample");
    this.#heights = options.heights.slice();
    this.#colliderHeights = new Float32Array(expected);
    for (let column = 0; column < this.columns; column += 1) {
      for (let row = 0; row < this.rows; row += 1) {
        this.#colliderHeights[column * this.rows + row] = this.#height(row * this.columns + column);
      }
    }
    this.#cellWidth = this.width / (this.columns - 1);
    this.#cellDepth = this.depth / (this.rows - 1);
    this.#minimumX = this.origin.x - this.width / 2;
    this.#minimumZ = this.origin.z - this.depth / 2;
  }

  static fromSampler(options: IHeightfieldSamplerOptions): Heightfield {
    const columns = count(options.columns, "columns");
    const rows = count(options.rows, "rows");
    const width = positive(options.width, "width");
    const depth = positive(options.depth, "depth");
    const originX = finite(options.origin.x, "origin.x");
    const originZ = finite(options.origin.z, "origin.z");
    const minimumX = originX - width / 2;
    const minimumZ = originZ - depth / 2;
    const cellWidth = width / (columns - 1);
    const cellDepth = depth / (rows - 1);
    const heights = new Float32Array(rows * columns);

    for (let row = 0; row < rows; row += 1) {
      const z = minimumZ + row * cellDepth;
      for (let column = 0; column < columns; column += 1) {
        const x = minimumX + column * cellWidth;
        heights[row * columns + column] = finite(options.sampleHeight(x, z), "sampleHeight result");
      }
    }

    return new Heightfield({ columns, depth, heights, origin: options.origin, rows, width });
  }

  sample(channel: string, x: number, z: number): number {
    if (channel !== "height") throw new Error(`Heightfield unknown channel '${channel}'.`);
    return this.heightAt(x, z);
  }

  /** A copy of the canonical row-major samples, safe for game-side analysis. */
  get heights(): Float32Array {
    return this.#heights.slice();
  }

  heightAt(x: number, z: number): number {
    finite(x, "query x");
    finite(z, "query z");
    const column = (x - this.#minimumX) / this.#cellWidth;
    const row = (z - this.#minimumZ) / this.#cellDepth;
    const epsilon = 1e-9;
    if (
      column < -epsilon ||
      row < -epsilon ||
      column > this.columns - 1 + epsilon ||
      row > this.rows - 1 + epsilon
    )
      throw new Error(`Heightfield query (${x}, ${z}) is outside its resident region.`);
    return this.#interpolate(
      Math.min(this.columns - 1, Math.max(0, column)),
      Math.min(this.rows - 1, Math.max(0, row)),
    );
  }

  normalAt(x: number, z: number, target = new Vector3()): Vector3 {
    this.heightAt(x, z);
    const leftX = Math.max(this.#minimumX, x - this.#cellWidth);
    const rightX = Math.min(this.#minimumX + this.width, x + this.#cellWidth);
    const nearZ = Math.max(this.#minimumZ, z - this.#cellDepth);
    const farZ = Math.min(this.#minimumZ + this.depth, z + this.#cellDepth);
    const slopeX = (this.heightAt(rightX, z) - this.heightAt(leftX, z)) / (rightX - leftX);
    const slopeZ = (this.heightAt(x, farZ) - this.heightAt(x, nearZ)) / (farZ - nearZ);
    return target.set(-slopeX, 1, -slopeZ).normalize();
  }

  /** The same values transposed once into Rapier's column-major height-matrix order. */
  toColliderHeights(): Float32Array {
    return this.#colliderHeights.slice();
  }

  /** Builds an ordinary Three.js geometry without choosing its surface. */
  toGeometry(): BufferGeometry {
    const count = this.rows * this.columns;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const normal = new Vector3();
    for (let row = 0; row < this.rows; row += 1) {
      const localZ = -this.depth / 2 + row * this.#cellDepth;
      const worldZ = this.origin.z + localZ;
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        const localX = -this.width / 2 + column * this.#cellWidth;
        const worldX = this.origin.x + localX;
        positions[index * 3] = localX;
        positions[index * 3 + 1] = this.#height(index);
        positions[index * 3 + 2] = localZ;
        this.normalAt(worldX, worldZ, normal);
        normals[index * 3] = normal.x;
        normals[index * 3 + 1] = normal.y;
        normals[index * 3 + 2] = normal.z;
      }
    }

    const indices = new Uint32Array((this.rows - 1) * (this.columns - 1) * 6);
    let offset = 0;
    for (let row = 0; row < this.rows - 1; row += 1) {
      for (let column = 0; column < this.columns - 1; column += 1) {
        const upperLeft = row * this.columns + column;
        const upperRight = upperLeft + 1;
        const lowerLeft = upperLeft + this.columns;
        const lowerRight = lowerLeft + 1;
        indices.set([upperLeft, lowerLeft, upperRight, upperRight, lowerLeft, lowerRight], offset);
        offset += 6;
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(normals, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));
    return geometry;
  }

  #interpolate(column: number, row: number): number {
    const column0 = Math.floor(column);
    const row0 = Math.floor(row);
    const column1 = Math.min(this.columns - 1, column0 + 1);
    const row1 = Math.min(this.rows - 1, row0 + 1);
    const columnMix = column - column0;
    const rowMix = row - row0;
    const upperLeft = this.#height(row0 * this.columns + column0);
    const upperRight = this.#height(row0 * this.columns + column1);
    const lowerLeft = this.#height(row1 * this.columns + column0);
    const lowerRight = this.#height(row1 * this.columns + column1);
    const upper = upperLeft + (upperRight - upperLeft) * columnMix;
    const lower = lowerLeft + (lowerRight - lowerLeft) * columnMix;
    return upper + (lower - upper) * rowMix;
  }

  #height(index: number): number {
    const height = this.#heights[index];
    if (height === undefined) throw new Error(`Heightfield internal sample ${index} is missing.`);
    return height;
  }
}
