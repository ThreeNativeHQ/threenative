import { type Camera, Vector3 } from "three";
import { instancedArray } from "three/tsl";
import type { StorageBufferNode } from "three/webgpu";

export interface ISurfelPoint {
  readonly normal?: Vector3 | readonly [number, number, number];
  readonly position: Vector3 | readonly [number, number, number];
}

export interface ISurfelPoolOptions {
  readonly capacity: number;
  readonly maxAge: number;
}

export interface ISurfelPoolBuffers {
  /** CPU-owned residency mask. Integration reads it but never writes it. */
  readonly active: StorageBufferNode<"uint">;
  readonly ages: StorageBufferNode<"float">;
  readonly flags: StorageBufferNode<"uint">;
  readonly normals: StorageBufferNode<"vec4">;
  readonly positions: StorageBufferNode<"vec4">;
  /** GPU-owned integrated radiance, written by the integration compute pass. */
  readonly radiance: StorageBufferNode<"vec4">;
}

export interface ISurfelPoolStats {
  readonly allocationCount: number;
  readonly evictionCount: number;
  readonly liveCount: number;
  readonly maxAge: number;
}

function checkedPositiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`SurfelPool.${name} must be positive.`);
  return value;
}

function checkedPositive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`SurfelPool.${name} must be positive.`);
  return value;
}

function vector(
  value: Vector3 | readonly [number, number, number] | undefined,
  fallback: Vector3,
): Vector3 {
  if (value === undefined) return fallback.clone();
  if (value instanceof Vector3) return value.clone();
  if (value.length !== 3 || !value.every((component) => Number.isFinite(component))) {
    throw new Error("SurfelPool points must contain three finite coordinates.");
  }
  return new Vector3(value[0], value[1], value[2]);
}

function markDirty(node: StorageBufferNode<"float" | "uint" | "vec4">): void {
  node.value.needsUpdate = true;
}

/**
 * Keep a fixed-size CPU/GPU surfel pool with explicit allocation, ageing, and eviction.
 *
 * The pool owns numeric storage only. It does not choose a material, a colour, or a composite;
 * those remain in the game's render source. Every allocation reuses one of the fixed slots, so a
 * camera sweep cannot grow GPU memory.
 * @situation maintain bounded surface samples for an indirect-light or irradiance solve
 * @constraint capacity and maxAge are performance controls and must be supplied by the game
 * @override capacity and maxAge trade memory, refresh rate, and stale-sample lifetime
 * @example const pool = new SurfelPool({ capacity: 4096, maxAge: 30 });
 */
export class SurfelPool {
  readonly capacity: number;
  readonly maxAge: number;
  readonly buffers: ISurfelPoolBuffers;
  #active: Uint32Array;
  #ages: Float32Array;
  #free: number[];
  #positions: Float32Array;
  #normals: Float32Array;
  #flags: Uint32Array;
  #radiance: Float32Array;
  #allocationCount = 0;
  #evictionCount = 0;
  #liveCount = 0;
  #released = false;

  constructor(options: ISurfelPoolOptions) {
    this.capacity = checkedPositiveInteger("capacity", options.capacity);
    this.maxAge = checkedPositive("maxAge", options.maxAge);
    this.#active = new Uint32Array(this.capacity);
    this.#ages = new Float32Array(this.capacity);
    this.#positions = new Float32Array(this.capacity * 4);
    this.#normals = new Float32Array(this.capacity * 4);
    this.#flags = new Uint32Array(this.capacity);
    this.#radiance = new Float32Array(this.capacity * 4);
    this.#free = Array.from({ length: this.capacity }, (_, index) => this.capacity - index - 1);
    this.buffers = {
      active: instancedArray(this.#active, "uint"),
      ages: instancedArray(this.#ages, "float"),
      flags: instancedArray(this.#flags, "uint"),
      normals: instancedArray(this.#normals, "vec4"),
      positions: instancedArray(this.#positions, "vec4"),
      radiance: instancedArray(this.#radiance, "vec4"),
    };
  }

  get active(): StorageBufferNode<"uint"> {
    return this.buffers.active;
  }

  get positions(): StorageBufferNode<"vec4"> {
    return this.buffers.positions;
  }

  get normals(): StorageBufferNode<"vec4"> {
    return this.buffers.normals;
  }

  get ages(): StorageBufferNode<"float"> {
    return this.buffers.ages;
  }

  get flags(): StorageBufferNode<"uint"> {
    return this.buffers.flags;
  }

  get radiance(): StorageBufferNode<"vec4"> {
    return this.buffers.radiance;
  }

  get liveCount(): number {
    return this.#liveCount;
  }

  get allocationCount(): number {
    return this.#allocationCount;
  }

  get evictionCount(): number {
    return this.#evictionCount;
  }

  get oldestAge(): number {
    let oldest = 0;
    for (let index = 0; index < this.capacity; index += 1) {
      if (this.#active[index] !== 0) oldest = Math.max(oldest, this.#ages[index] ?? 0);
    }
    return oldest;
  }

  get released(): boolean {
    return this.#released;
  }

  get stats(): ISurfelPoolStats {
    return {
      allocationCount: this.#allocationCount,
      evictionCount: this.#evictionCount,
      liveCount: this.#liveCount,
      maxAge: this.maxAge,
    };
  }

  allocate(point: ISurfelPoint): number {
    if (this.#released) throw new Error("SurfelPool cannot allocate after release.");
    const index = this.#free.pop() ?? this.#evictOldest();
    const position = vector(point.position, new Vector3());
    const normal = vector(point.normal, new Vector3(0, 1, 0)).normalize();
    const positionOffset = index * 4;
    this.#positions[positionOffset] = position.x;
    this.#positions[positionOffset + 1] = position.y;
    this.#positions[positionOffset + 2] = position.z;
    this.#positions[positionOffset + 3] = 1;
    this.#normals[positionOffset] = normal.x;
    this.#normals[positionOffset + 1] = normal.y;
    this.#normals[positionOffset + 2] = normal.z;
    this.#normals[positionOffset + 3] = 0;
    this.#ages[index] = 0;
    // `active` is the CPU-owned residency mask. Flags and radiance stay GPU-owned: allocation
    // must not upload a CPU zero over a result produced by the integration pass.
    this.#active[index] = 1;
    this.#liveCount += 1;
    this.#allocationCount += 1;
    markDirty(this.buffers.positions);
    markDirty(this.buffers.normals);
    markDirty(this.buffers.ages);
    markDirty(this.buffers.active);
    return index;
  }

  remove(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.capacity) {
      throw new Error("SurfelPool index is outside the fixed capacity.");
    }
    if (this.#released || this.#active[index] === 0) return;
    this.#active[index] = 0;
    this.#ages[index] = this.maxAge;
    this.#free.push(index);
    this.#liveCount -= 1;
    markDirty(this.buffers.ages);
    markDirty(this.buffers.active);
  }

  advanceAge(delta: number): void {
    if (this.#released) return;
    if (!Number.isFinite(delta) || delta < 0)
      throw new Error("SurfelPool age delta must be non-negative.");
    let agesDirty = false;
    let activeDirty = false;
    for (let index = 0; index < this.capacity; index += 1) {
      if (this.#active[index] === 0) continue;
      const age = (this.#ages[index] ?? 0) + delta;
      if (age >= this.maxAge) {
        this.#active[index] = 0;
        this.#free.push(index);
        this.#liveCount -= 1;
        activeDirty = true;
      } else {
        this.#ages[index] = age;
      }
      agesDirty = true;
    }
    if (agesDirty) markDirty(this.buffers.ages);
    if (activeDirty) markDirty(this.buffers.active);
  }

  forEachLive(
    callback: (index: number, position: Vector3, normal: Vector3, age: number) => void,
  ): void {
    if (this.#released) return;
    for (let index = 0; index < this.capacity; index += 1) {
      if (this.#active[index] === 0) continue;
      const offset = index * 4;
      callback(
        index,
        new Vector3(
          this.#positions[offset] ?? 0,
          this.#positions[offset + 1] ?? 0,
          this.#positions[offset + 2] ?? 0,
        ),
        new Vector3(
          this.#normals[offset] ?? 0,
          this.#normals[offset + 1] ?? 1,
          this.#normals[offset + 2] ?? 0,
        ),
        this.#ages[index] ?? 0,
      );
    }
  }

  /** Estimate visible-pixel coverage on a small fixed lattice without allocating per frame. */
  measureCoverage(camera: Camera, width = 32, height = 18): number {
    checkedPositiveInteger("coverage width", width);
    checkedPositiveInteger("coverage height", height);
    if (this.#released || this.#liveCount === 0) return 0;
    camera.updateMatrixWorld();
    const cells = new Set<number>();
    this.forEachLive((_index, position) => {
      const projected = position.project(camera);
      if (
        !Number.isFinite(projected.x) ||
        !Number.isFinite(projected.y) ||
        !Number.isFinite(projected.z) ||
        projected.z < -1 ||
        projected.z > 1 ||
        projected.x < -1 ||
        projected.x > 1 ||
        projected.y < -1 ||
        projected.y > 1
      )
        return;
      const x = Math.min(width - 1, Math.max(0, Math.floor((projected.x * 0.5 + 0.5) * width)));
      const y = Math.min(height - 1, Math.max(0, Math.floor((projected.y * 0.5 + 0.5) * height)));
      cells.add(y * width + x);
    });
    return cells.size / (width * height);
  }

  release(): void {
    if (this.#released) return;
    this.buffers.positions.value.dispose();
    this.buffers.normals.value.dispose();
    this.buffers.ages.value.dispose();
    this.buffers.flags.value.dispose();
    this.buffers.active.value.dispose();
    this.buffers.radiance.value.dispose();
    this.#released = true;
    this.#active.fill(0);
    this.#free = [];
    this.#liveCount = 0;
  }

  #evictOldest(): number {
    let oldest = -1;
    let oldestAge = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < this.capacity; index += 1) {
      if (this.#active[index] !== 0 && (this.#ages[index] ?? 0) > oldestAge) {
        oldest = index;
        oldestAge = this.#ages[index] ?? 0;
      }
    }
    if (oldest < 0) throw new Error("SurfelPool has no reusable slot.");
    this.#active[oldest] = 0;
    this.#liveCount -= 1;
    this.#evictionCount += 1;
    return oldest;
  }
}
