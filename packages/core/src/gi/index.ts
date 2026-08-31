import { type Camera, Group, type Scene } from "three";
import { distance, uint, vec3 } from "three/tsl";
import type { ComputeNode, Node } from "three/webgpu";
import type { IComputeDriven } from "../compute-driven.js";
import { GPUReadback, type IGPUReadbackSample } from "../gpu-readback.js";
import type { GPUSceneBVH } from "../gpu-scene-bvh.js";
import type { IRendererLike } from "../renderer.js";
import { type GBufferPass, type IGBuffer, type IGBufferDriven, attachGBuffer } from "./gbuffer.js";
import { type ISurfelHashGridOptions, SurfelHashGrid } from "./hash-grid.js";
import { type ISurfelLightingInput, SurfelIntegrator } from "./integrate.js";
import { type ISurfelPoint, type ISurfelPoolOptions, SurfelPool } from "./surfel-pool.js";

export interface ISurfelGIOptions {
  readonly camera?: Camera;
  readonly hashCellCount: number;
  readonly hashCellSize: number;
  readonly lighting?: ISurfelLightingInput;
  readonly maxAge: number;
  readonly originBias?: number;
  readonly rayBudget: number;
  readonly scene?: Scene;
  readonly sceneBvh?: GPUSceneBVH;
  readonly surfelBudget: number;
  readonly updateCadence: number;
  /** Optional asynchronous radiance copy for gameplay proof; zero disables CPU readback. */
  readonly readbackEveryFrames?: number;
}

export interface ISurfelGIStats {
  readonly coverage: number;
  readonly evictions: number;
  readonly liveSurfels: number;
  readonly overflow: number;
  readonly readbackPending?: boolean;
  readonly readbackStaleFrames?: number;
  readonly renderUpdates: number;
}

function positive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`SurfelGI.${name} must be positive.`);
  return value;
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`SurfelGI.${name} must be positive.`);
  return value;
}

function indirectFrom(
  gbuffer: IGBuffer,
  pool: SurfelPool,
  grid: SurfelHashGrid,
  integrator: SurfelIntegrator,
  lighting: ISurfelLightingInput | undefined,
): Node<"vec3"> {
  if (!integrator.tracesScene || lighting === undefined) return vec3(0) as Node<"vec3">;
  // Read the integrated GPU result from the cells belonging to this pixel's reconstructed world
  // position. The CPU active mask and GPU hit flags both participate, so an expired or untraced
  // lane cannot leak an old result into the composite.
  const cell = grid.cellIndex(gbuffer.worldPosition);
  const available = grid.cellCounts.element(cell);
  let integrated = vec3(0) as Node<"vec3">;
  for (let slot = 0; slot < grid.maxEntriesPerCell; slot += 1) {
    const entry = cell.mul(uint(grid.maxEntriesPerCell)).add(uint(slot));
    const present = available.greaterThan(uint(slot)).toFloat();
    const samplePosition = grid.positions.element(entry).xyz;
    const sampleDistance = distance(gbuffer.worldPosition, samplePosition);
    const surfelIndex = grid.entries.element(entry);
    const active = pool.active.element(surfelIndex).toFloat();
    const integratedFlag = pool.flags.element(surfelIndex).toFloat();
    const sample = pool.radiance.element(surfelIndex);
    const contribution = lighting.gather({
      available,
      sample: sample.xyz,
      sampleDistance,
    });
    const mask = present.mul(active).mul(integratedFlag);
    integrated = integrated.add(contribution.mul(mask)) as Node<"vec3">;
  }
  return integrated;
}

/**
 * Maintain bounded surfels and expose one game-composable indirect-light node.
 *
 * Construction is opt-in. The class creates no material, light, preset, or output assignment; a
 * game adds it through `ctx.add()` and decides whether `indirectLight` reaches the frame.
 */
export class SurfelGI extends Group implements IComputeDriven, IGBufferDriven {
  readonly pool: SurfelPool;
  readonly grid: SurfelHashGrid;
  readonly integrator: SurfelIntegrator;
  readonly processCadence = "fixed" as const;
  readonly warmupNodes: readonly ComputeNode[];
  readonly requiresGBuffer = true as const;
  readonly updateCadence: number;
  #camera: Camera | undefined;
  #gbuffer: IGBuffer | undefined;
  #lighting: ISurfelLightingInput | undefined;
  #readback: GPUReadback | undefined;
  #renderer: IRendererLike | undefined;
  #coverage = 0;
  #updates = 0;
  #sceneBvh: GPUSceneBVH | undefined;
  #released = false;
  #indirectLight: Node<"vec3"> = vec3(0) as Node<"vec3">;

  constructor(options: ISurfelGIOptions) {
    super();
    if (options.scene !== undefined && options.sceneBvh === undefined)
      throw new Error("SurfelGI.sceneBvh is required when scene is provided.");
    this.updateCadence = positiveInteger("updateCadence", options.updateCadence);
    const poolOptions: ISurfelPoolOptions = {
      capacity: positiveInteger("surfelBudget", options.surfelBudget),
      maxAge: positive("maxAge", options.maxAge),
    };
    const gridOptions: ISurfelHashGridOptions = {
      cellCount: positiveInteger("hashCellCount", options.hashCellCount),
      cellSize: positive("hashCellSize", options.hashCellSize),
      maxEntriesPerCell: positiveInteger(
        "maxEntriesPerCell",
        Math.max(1, Math.ceil(options.surfelBudget / options.hashCellCount)),
      ),
    };
    this.pool = new SurfelPool(poolOptions);
    this.#lighting = options.lighting;
    const readbackEveryFrames = options.readbackEveryFrames ?? 0;
    if (!Number.isInteger(readbackEveryFrames) || readbackEveryFrames < 0)
      throw new Error("SurfelGI.readbackEveryFrames must be a non-negative integer.");
    this.#readback =
      readbackEveryFrames > 0
        ? new GPUReadback({
            attribute: this.pool.radiance.value,
            everyFrames: readbackEveryFrames,
          })
        : undefined;
    this.grid = new SurfelHashGrid(gridOptions);
    this.#sceneBvh = options.sceneBvh;
    this.integrator = new SurfelIntegrator(this.pool, this.grid, {
      bvh: options.sceneBvh,
      lighting: options.lighting,
      originBias: options.originBias,
      rayBudget: options.rayBudget,
    });
    this.warmupNodes = [this.integrator.computeNode];
    this.#camera = options.camera;
    if (options.sceneBvh !== undefined) this.#seedFromBvh(options.sceneBvh);
    this.grid.rebuild(this.pool);
    if (options.scene !== undefined && options.camera !== undefined) {
      this.#coverage = this.pool.measureCoverage(options.camera);
    }
    this.addEventListener("removed", this.#onRemoved);
  }

  get indirectLight(): Node<"vec3"> {
    return this.#indirectLight;
  }

  get released(): boolean {
    return this.#released;
  }

  get coverage(): number {
    return this.#coverage;
  }

  get stats(): ISurfelGIStats {
    return {
      coverage: this.#coverage,
      evictions: this.pool.evictionCount,
      liveSurfels: this.pool.liveCount,
      overflow: this.grid.overflowCount,
      readbackPending: this.#readback?.pending,
      readbackStaleFrames: this.#readback?.staleFrames,
      renderUpdates: this.#updates,
    };
  }

  /** Latest asynchronous integrated radiance and its measured age, when readback is enabled. */
  get sample(): IGPUReadbackSample | undefined {
    return this.#readback?.sample;
  }

  /** Read the latest GPU-integrated red radiance for gameplay diagnostics. */
  sampleIndirectLight(): number | undefined {
    const sample = this.#readback?.sample;
    if (sample === undefined) return undefined;
    const laneCount = Math.max(1, this.pool.capacity);
    let integratedRed = 0;
    let activeLanes = 0;
    for (let index = 0; index < laneCount; index += 1) {
      if ((this.pool.active.value.array[index] as number | undefined) === 0) continue;
      activeLanes += 1;
      integratedRed += sample.data[index * 4] ?? 0;
    }
    return activeLanes === 0 ? 0 : integratedRed / activeLanes;
  }

  attachGBuffer(pass: GBufferPass): void {
    if (this.#released) throw new Error("SurfelGI cannot bind a GBuffer after release.");
    this.#gbuffer = attachGBuffer(pass);
    this.#indirectLight = indirectFrom(
      this.#gbuffer,
      this.pool,
      this.grid,
      this.integrator,
      this.#lighting,
    );
  }

  attachRenderer(renderer: IRendererLike): void {
    if (this.#released) throw new Error("SurfelGI cannot attach after release.");
    if (this.#renderer === renderer) return;
    this.#renderer = renderer;
    this.integrator.dispatch(renderer);
  }

  process(renderer = this.#renderer): void {
    if (this.#released) return;
    if (renderer === undefined) throw new Error("SurfelGI is not attached to a renderer.");
    this.#updates += 1;
    const allocationsBefore = this.pool.allocationCount;
    const liveBefore = this.pool.liveCount;
    this.#refreshBeforeExpiry();
    this.pool.advanceAge(1);
    const residencyChanged =
      allocationsBefore !== this.pool.allocationCount || liveBefore !== this.pool.liveCount;
    if (residencyChanged || this.#updates % this.updateCadence === 0) {
      this.#fillFromBvh();
      this.grid.rebuild(this.pool);
      this.integrator.dispatch(renderer);
    }
    this.#readback?.request(renderer);
    if (this.#camera !== undefined) this.#coverage = this.pool.measureCoverage(this.#camera);
  }

  detach(): void {
    if (this.#released) return;
    this.#renderer = undefined;
    this.integrator.release();
    this.grid.release();
    this.pool.release();
    this.#readback?.dispose();
    this.#readback = undefined;
    this.#gbuffer = undefined;
    this.#released = true;
  }

  #seedFromBvh(bvh: GPUSceneBVH): void {
    this.#fillFromBvh(bvh);
  }

  #fillFromBvh(bvh = this.#sceneBvh): void {
    if (bvh === undefined) return;
    const positions = bvh.positions.value.array as ArrayLike<number>;
    const normals = bvh.normals.value.array as ArrayLike<number>;
    const stride = bvh.positions.value.itemSize;
    const normalStride = bvh.normals.value.itemSize;
    const count = Math.min(this.pool.capacity, bvh.positions.value.count);
    for (let index = this.pool.liveCount; index < count; index += 1) {
      this.pool.allocate(this.#pointFromBvh(positions, normals, stride, normalStride, index));
    }
  }

  #refreshBeforeExpiry(): void {
    const bvh = this.#sceneBvh;
    if (bvh === undefined) return;
    const count = Math.min(this.pool.capacity, bvh.positions.value.count);
    if (this.pool.liveCount < count) {
      this.#fillFromBvh(bvh);
      return;
    }
    if (this.pool.oldestAge + 1 < this.pool.maxAge) return;
    const positions = bvh.positions.value.array as ArrayLike<number>;
    const normals = bvh.normals.value.array as ArrayLike<number>;
    const stride = bvh.positions.value.itemSize;
    const normalStride = bvh.normals.value.itemSize;
    for (let index = 0; index < count; index += 1) {
      this.pool.allocate(this.#pointFromBvh(positions, normals, stride, normalStride, index));
    }
  }

  #pointFromBvh(
    positions: ArrayLike<number>,
    normals: ArrayLike<number>,
    stride: number,
    normalStride: number,
    index: number,
  ): ISurfelPoint {
    const offset = index * stride;
    const normalOffset = index * normalStride;
    return {
      normal: [
        Number(normals[normalOffset] ?? 0),
        Number(normals[normalOffset + 1] ?? 1),
        Number(normals[normalOffset + 2] ?? 0),
      ],
      position: [
        Number(positions[offset] ?? 0),
        Number(positions[offset + 1] ?? 0),
        Number(positions[offset + 2] ?? 0),
      ],
    };
  }

  #onRemoved = (): void => this.detach();
}

export type {
  GBufferPass,
  IGBuffer,
  IGBufferDriven,
} from "./gbuffer.js";
export { attachGBuffer, createGBuffer } from "./gbuffer.js";
export type { ISurfelHashGridOptions } from "./hash-grid.js";
export { SurfelHashGrid } from "./hash-grid.js";
export type { ISurfelIntegrationOptions } from "./integrate.js";
export type { ISurfelGatherInput, ISurfelLightingInput } from "./integrate.js";
export { SurfelIntegrator } from "./integrate.js";
export type {
  ISurfelPoint,
  ISurfelPoolBuffers,
  ISurfelPoolOptions,
  ISurfelPoolStats,
} from "./surfel-pool.js";
export { SurfelPool } from "./surfel-pool.js";
