import { Fn, If, instanceIndex, uint, vec4, wgslFn } from "three/tsl";
import { type ComputeNode, type Node, StructNode } from "three/webgpu";
import { type GPUSceneBVH, bvhIntersectFirstHit, rayStruct } from "../gpu-scene-bvh.js";
import type { IRendererLike } from "../renderer.js";
import type { SurfelHashGrid } from "./hash-grid.js";
import type { SurfelPool } from "./surfel-pool.js";

export interface ISurfelLightingInput {
  /** Game-owned ray direction used to gather scene radiance. */
  readonly direction: Node<"vec3">;
  /** Game-owned incoming light/material colour at the traced hit. */
  readonly radiance: Node<"vec3">;
  /** Game-owned distance response; the framework never selects an attenuation curve. */
  readonly attenuation: (distance: Node<"float">) => Node<"float">;
  /** Game-owned response to the traced surface and sampled surfel normals. */
  readonly normalResponse: (hitNormal: Node<"vec3">, surfelNormal: Node<"vec3">) => Node<"float">;
  /** Game-owned strength for the integrated contribution. */
  readonly strength: Node<"float">;
}

export interface ISurfelIntegrationOptions {
  readonly bvh?: GPUSceneBVH;
  /** Required with `bvh`; omitted only for a disabled/no-scene integration. */
  readonly lighting?: ISurfelLightingInput;
  /** Geometry epsilon supplied by the game; zero is the neutral default. */
  readonly originBias?: number;
  readonly rayBudget: number;
}

const traceHit = wgslFn(
  `
    fn surfelSceneHit(
      bvh_index: ptr<storage, array<vec3u>, read>,
      bvh_position: ptr<storage, array<vec3f>, read>,
      bvh: ptr<storage, array<BVHNode>, read>,
      ray: Ray,
    ) -> vec4f {
      let result = bvhIntersectFirstHit(bvh_index, bvh_position, bvh, ray);
      return vec4f(
        select(vec3f(0.0), result.normal, result.didHit),
        select(0.0, result.dist, result.didHit),
      );
    }
  `,
  // quality-allow: Unavoidable Three.js TSL boundary: upstream BVH callable is a runtime node, not a typed Node.
  [bvhIntersectFirstHit as unknown as Node],
  // quality-allow: TSL's WGSL callable has no typed signature; the explicit vec4 return is the public node type.
) as unknown as (index: Node, position: Node, nodes: Node, ray: Node) => Node<"vec4">;

function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`SurfelIntegrator.${name} must be positive.`);
  return value;
}

function originBias(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0)
    throw new Error("SurfelIntegrator.originBias must be finite and non-negative.");
  return value;
}

/** The fixed-size compute pass that performs one scene trace per budgeted surfel lane. */
export class SurfelIntegrator {
  readonly rayBudget: number;
  readonly dispatchCount: number;
  readonly computeNode: ComputeNode;
  readonly tracesScene: boolean;
  #released = false;

  constructor(pool: SurfelPool, grid: SurfelHashGrid, options: ISurfelIntegrationOptions) {
    this.rayBudget = positiveInteger("rayBudget", options.rayBudget);
    const bias = originBias(options.originBias);
    if (options.bvh !== undefined && options.lighting === undefined)
      throw new Error("SurfelIntegrator.lighting is required when bvh is provided.");
    this.dispatchCount = Math.min(
      this.rayBudget,
      pool.capacity,
      grid.cellCount * grid.maxEntriesPerCell,
    );
    this.tracesScene = options.bvh !== undefined;
    const bvh = options.bvh;
    this.computeNode = Fn(() => {
      const index = instanceIndex;
      if (bvh === undefined) {
        If(pool.active.element(index).greaterThan(uint(0)), () => {
          pool.flags.element(index).assign(uint(0));
          pool.radiance.element(index).assign(vec4(0));
        });
        return;
      }

      const lighting = options.lighting as ISurfelLightingInput;
      // One dispatch lane owns one fixed hash entry. This keeps the selected entry and the
      // radiance/flag destination aligned even when pool indices are not contiguous within a
      // bucket. `rayBudget` simply truncates this linear entry stream.
      const cell = index.div(uint(grid.maxEntriesPerCell));
      const slot = index.mod(uint(grid.maxEntriesPerCell));
      const cellCount = grid.cellCounts.element(cell);
      const sampleIndex = grid.entries.element(index);
      const clearLane = (): void => {
        pool.flags.element(sampleIndex).assign(uint(0));
        pool.radiance.element(sampleIndex).assign(vec4(0));
      };
      If(cellCount.greaterThan(slot), () => {
        If(pool.active.element(sampleIndex).greaterThan(uint(0)), () => {
          const samplePosition = pool.positions.element(sampleIndex);
          const sampleNormal = pool.normals.element(sampleIndex);
          const ray = new StructNode(rayStruct, {
            direction: lighting.direction,
            origin: samplePosition.xyz.add(sampleNormal.xyz.mul(bias)),
          } as never);
          const hit = traceHit(bvh.indices, bvh.positions, bvh.nodes, ray);
          const didHit = hit.w.greaterThan(0);
          const distance = hit.w as Node<"float">;
          const hitNormal = hit.xyz as Node<"vec3">;
          const integrated = lighting.radiance
            .mul(lighting.attenuation(distance))
            .mul(lighting.normalResponse(hitNormal, sampleNormal.xyz))
            .mul(lighting.strength);
          If(didHit, () => {
            pool.radiance.element(sampleIndex).assign(vec4(integrated, 1));
            pool.flags.element(sampleIndex).assign(uint(1));
          }).Else(clearLane);
        }).Else(clearLane);
      }).Else(clearLane);
    })().compute(this.dispatchCount);
    this.computeNode.setName("Surfel Integrate");
  }

  dispatch(renderer: IRendererLike): void {
    if (this.#released) return;
    renderer.compute(this.computeNode);
  }

  release(): void {
    if (this.#released) return;
    this.computeNode.dispose();
    this.#released = true;
  }
}
