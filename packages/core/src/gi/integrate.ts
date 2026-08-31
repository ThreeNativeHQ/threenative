import { Fn, If, instanceIndex, select, uint, vec3, vec4, wgslFn } from "three/tsl";
import { type ComputeNode, type Node, StructNode } from "three/webgpu";
import { type GPUSceneBVH, bvhIntersectFirstHit, rayStruct } from "../gpu-scene-bvh.js";
import type { IRendererLike } from "../renderer.js";
import type { SurfelHashGrid } from "./hash-grid.js";
import type { SurfelPool } from "./surfel-pool.js";

export interface ISurfelIntegrationOptions {
  readonly bvh?: GPUSceneBVH;
  readonly rayBudget: number;
}

const traceRadiance = wgslFn(
  `
    fn surfelSceneRadiance(
      bvh_index: ptr<storage, array<vec3u>, read>,
      bvh_position: ptr<storage, array<vec3f>, read>,
      bvh: ptr<storage, array<BVHNode>, read>,
      ray: Ray,
    ) -> vec4f {
      let result = bvhIntersectFirstHit(bvh_index, bvh_position, bvh, ray);
      if (!result.didHit) {
        return vec4f(0.0);
      }
      let distance = max(result.dist, 0.0);
      let attenuation = 1.0 / (1.0 + distance);
      let normalEnergy = max(abs(result.normal.x), max(abs(result.normal.y), abs(result.normal.z)));
      return vec4f(vec3f(normalEnergy * attenuation), 1.0);
    }
  `,
  // quality-allow: Unavoidable Three.js TSL boundary: upstream BVH callable is a runtime node, not a typed Node.
  [bvhIntersectFirstHit as unknown as Node],
  // quality-allow: Unavoidable Three.js TSL boundary: custom WGSL callable lacks a typed signature; vec4 is explicit.
) as unknown as (index: Node, position: Node, nodes: Node, ray: Node) => Node<"vec4">;

function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`SurfelIntegrator.${name} must be positive.`);
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
    this.dispatchCount = Math.min(
      this.rayBudget,
      pool.capacity,
      grid.cellCount * grid.maxEntriesPerCell,
    );
    this.tracesScene = options.bvh !== undefined;
    const bvh = options.bvh;
    this.computeNode = Fn(() => {
      const index = instanceIndex;
      const position = pool.positions.element(index);
      const normal = pool.normals.element(index);
      If(pool.active.element(index).greaterThan(uint(0)), () => {
        if (bvh === undefined) {
          pool.flags.element(index).assign(uint(0));
          pool.radiance.element(index).assign(vec4(0));
          return;
        }
        const ray = new StructNode(rayStruct, {
          // A fixed diagonal offset keeps this one-ray-per-lane solve in the outward hemisphere
          // while letting vertex-seeded surfels see neighbouring geometry in a compact scene.
          direction: normal.xyz.add(vec3(0, -1, -1)).normalize(),
          origin: position.xyz.add(normal.xyz.mul(0.001)),
        } as never);
        const radiance = traceRadiance(bvh.indices, bvh.positions, bvh.nodes, ray);
        pool.radiance.element(index).assign(radiance);
        pool.flags.element(index).assign(select(radiance.w.greaterThan(0), uint(1), uint(0)));
      });
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
