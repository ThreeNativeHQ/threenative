import { type Camera, Group, type Scene } from "three";
import { screenUV, uint, vec2, vec3 } from "three/tsl";
import type { ComputeNode, Node } from "three/webgpu";
import type { IComputeDriven } from "../compute-driven.js";
import { GPUReadback, type IGPUReadbackSample } from "../gpu-readback.js";
import type { GPUSceneBVH } from "../gpu-scene-bvh.js";
import type { IRendererLike } from "../renderer.js";
import { type GBufferPass, type IGBuffer, type IGBufferDriven, attachGBuffer } from "./gbuffer.js";
import { type ISurfelHashGridOptions, SurfelHashGrid } from "./hash-grid.js";
import { SurfelIntegrator } from "./integrate.js";
import { type ISurfelPoint, type ISurfelPoolOptions, SurfelPool } from "./surfel-pool.js";

export interface ISurfelGIOptions {
  readonly camera?: Camera;
  readonly hashCellCount: number;
  readonly hashCellSize: number;
  readonly maxAge: number;
  readonly rayBudget: number;
  readonly sampleRadius: number;
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

function integratedSurfelRadiance(pool: SurfelPool, integrator: SurfelIntegrator): Node<"vec3"> {
  const laneCount = Math.max(1, Math.min(pool.capacity, integrator.dispatchCount));
  let integrated = vec3(0) as Node<"vec3">;
  for (let index = 0; index < laneCount; index += 1) {
    const active = pool.active.element(uint(index)).toFloat();
    integrated = integrated.add(pool.radiance.element(uint(index)).xyz.mul(active)) as Node<"vec3">;
  }
  return integrated.div(laneCount) as Node<"vec3">;
}

function indirectFrom(
  gbuffer: IGBuffer,
  pool: SurfelPool,
  integrator: SurfelIntegrator,
  radius: number,
): Node<"vec3"> {
  // The GBuffer remains the game's colour source. The radiance buffer is the BVH-backed
  // integration result; the CPU-owned active mask excludes expired lanes without touching the
  // GPU-owned integration state.
  const offsets = [vec2(radius, 0), vec2(-radius, 0), vec2(0, radius), vec2(0, -radius)];
  const samples = offsets.map((offset) => gbuffer.albedo.clone().sample(screenUV.add(offset)).rgb);
  const albedo = samples.reduce((sum, sample) => sum.add(sample)).div(samples.length);
  const integrated = integrator.tracesScene ? integratedSurfelRadiance(pool, integrator) : vec3(0);
  return albedo.mul(integrated) as Node<"vec3">;
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
  readonly sampleRadius: number;
  readonly updateCadence: number;
  #camera: Camera | undefined;
  #gbuffer: IGBuffer | undefined;
  #readback: GPUReadback | undefined;
  #renderer: IRendererLike | undefined;
  #coverage = 0;
  #updates = 0;
  #released = false;
  #indirectLight: Node<"vec3"> = vec3(0) as Node<"vec3">;

  constructor(options: ISurfelGIOptions) {
    super();
    this.sampleRadius = positive("sampleRadius", options.sampleRadius);
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
    this.integrator = new SurfelIntegrator(this.pool, this.grid, {
      bvh: options.sceneBvh,
      rayBudget: options.rayBudget,
    });
    this.warmupNodes = [this.integrator.computeNode];
    this.#camera = options.camera;
    if (options.sceneBvh !== undefined) this.#seedFromBvh(options.sceneBvh);
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

  /** Read the GPU-integrated red radiance through a game-owned colour channel. */
  sampleIndirectLight(albedoRed: number): number | undefined {
    if (!Number.isFinite(albedoRed) || albedoRed < 0)
      throw new Error("SurfelGI.albedoRed must be a finite non-negative number.");
    const sample = this.#readback?.sample;
    if (sample === undefined) return undefined;
    const laneCount = Math.max(1, Math.min(this.pool.capacity, this.integrator.dispatchCount));
    let integratedRed = 0;
    for (let index = 0; index < laneCount; index += 1) {
      if ((this.pool.active.value.array[index] as number | undefined) === 0) continue;
      integratedRed += sample.data[index * 4] ?? 0;
    }
    return (integratedRed / laneCount) * albedoRed;
  }

  attachGBuffer(pass: GBufferPass): void {
    if (this.#released) throw new Error("SurfelGI cannot bind a GBuffer after release.");
    this.#gbuffer = attachGBuffer(pass);
    this.#indirectLight = indirectFrom(
      this.#gbuffer,
      this.pool,
      this.integrator,
      this.sampleRadius,
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
    this.pool.advanceAge(1);
    if (this.#updates % this.updateCadence === 0) {
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
    const positions = bvh.positions.value.array as ArrayLike<number>;
    const normals = bvh.normals.value.array as ArrayLike<number>;
    const stride = bvh.positions.value.itemSize;
    const normalStride = bvh.normals.value.itemSize;
    const count = Math.min(this.pool.capacity, bvh.positions.value.count);
    for (let index = 0; index < count; index += 1) {
      const offset = index * stride;
      const normalOffset = index * normalStride;
      const point: ISurfelPoint = {
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
      this.pool.allocate(point);
    }
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
export { SurfelIntegrator } from "./integrate.js";
export type {
  ISurfelPoint,
  ISurfelPoolBuffers,
  ISurfelPoolOptions,
  ISurfelPoolStats,
} from "./surfel-pool.js";
export { SurfelPool } from "./surfel-pool.js";
