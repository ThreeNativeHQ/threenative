import type { Vector3 } from "three";
import { instancedArray, uint } from "three/tsl";
import type { Node, StorageBufferNode } from "three/webgpu";
import type { SurfelPool } from "./surfel-pool.js";

export interface ISurfelHashGridOptions {
  readonly cellCount: number;
  readonly cellSize: number;
  readonly maxEntriesPerCell: number;
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`SurfelHashGrid.${name} must be positive.`);
  return value;
}

function positive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`SurfelHashGrid.${name} must be positive.`);
  return value;
}

function hash(position: Vector3, cellSize: number, cellCount: number): number {
  const x = Math.floor(position.x / cellSize);
  const y = Math.floor(position.y / cellSize);
  const z = Math.floor(position.z / cellSize);
  const mixed = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  return (mixed >>> 0) % cellCount;
}

function markDirty(node: StorageBufferNode<"uint">): void {
  node.value.needsUpdate = true;
}

/**
 * Hash live surfels into fixed cell-count and entry buffers.
 *
 * Collisions and a full bucket are measured as overflow; neither case allocates a larger array.
 * @situation find nearby surfels for a bounded indirect-light gather
 * @constraint cellCount, cellSize, and maxEntriesPerCell are measured memory/work controls
 * @override maxEntriesPerCell trades lookup work for overflow without changing pool capacity
 * @example const grid = new SurfelHashGrid({ cellCount: 4096, cellSize: 0.5, maxEntriesPerCell: 16 });
 */
export class SurfelHashGrid {
  readonly cellCount: number;
  readonly cellSize: number;
  readonly maxEntriesPerCell: number;
  readonly cellCounts: StorageBufferNode<"uint">;
  readonly entries: StorageBufferNode<"uint">;
  #counts: Uint32Array;
  #entries: Uint32Array;
  #overflowCount = 0;
  #released = false;

  constructor(options: ISurfelHashGridOptions) {
    this.cellCount = positiveInteger("cellCount", options.cellCount);
    this.cellSize = positive("cellSize", options.cellSize);
    this.maxEntriesPerCell = positiveInteger("maxEntriesPerCell", options.maxEntriesPerCell);
    this.#counts = new Uint32Array(this.cellCount);
    this.#entries = new Uint32Array(this.cellCount * this.maxEntriesPerCell);
    this.cellCounts = instancedArray(this.#counts, "uint");
    this.entries = instancedArray(this.#entries, "uint");
  }

  get overflowCount(): number {
    return this.#overflowCount;
  }

  get released(): boolean {
    return this.#released;
  }

  /** Resolve the same spatial hash cell in the integration and render lookup paths. */
  cellIndex(position: Node<"vec3">): Node<"uint"> {
    if (this.#released) throw new Error("SurfelHashGrid cannot resolve a cell after release.");
    const x = position.x.div(this.cellSize).floor().toInt();
    const y = position.y.div(this.cellSize).floor().toInt();
    const z = position.z.div(this.cellSize).floor().toInt();
    const mixed = x.mul(73856093).bitXor(y.mul(19349663)).bitXor(z.mul(83492791));
    return mixed.toUint().mod(uint(this.cellCount)) as Node<"uint">;
  }

  rebuild(pool: SurfelPool): void {
    if (this.#released) throw new Error("SurfelHashGrid cannot rebuild after release.");
    this.#counts.fill(0);
    this.#entries.fill(0);
    this.#overflowCount = 0;
    pool.forEachLive((index, position) => {
      const cell = hash(position, this.cellSize, this.cellCount);
      const count = this.#counts[cell] ?? 0;
      if (count >= this.maxEntriesPerCell) {
        this.#overflowCount += 1;
        return;
      }
      this.#entries[cell * this.maxEntriesPerCell + count] = index;
      this.#counts[cell] = count + 1;
    });
    markDirty(this.cellCounts);
    markDirty(this.entries);
  }

  query(position: Vector3, limit = this.maxEntriesPerCell): readonly number[] {
    if (this.#released) return [];
    const count = Math.min(this.maxEntriesPerCell, positiveInteger("query limit", limit));
    const cell = hash(position, this.cellSize, this.cellCount);
    const available = Math.min(count, this.#counts[cell] ?? 0);
    const start = cell * this.maxEntriesPerCell;
    return Array.from({ length: available }, (_, index) => this.#entries[start + index] ?? 0);
  }

  release(): void {
    if (this.#released) return;
    this.cellCounts.value.dispose();
    this.entries.value.dispose();
    this.#released = true;
    this.#counts.fill(0);
    this.#entries.fill(0);
  }
}
