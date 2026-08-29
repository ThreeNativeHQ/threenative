import { Sprite } from "three";
import { instancedArray } from "three/tsl";
import type { ComputeNode, SpriteNodeMaterial, StorageBufferNode } from "three/webgpu";
import type { IComputeDriven } from "./compute-driven.js";
import type { IRendererLike } from "./renderer.js";

export interface IGPUParticles3DBuffers {
  readonly positions: StorageBufferNode<"vec3">;
  readonly velocities: StorageBufferNode<"vec3">;
}

export interface IGPUParticles3DOptions {
  readonly amount: number;
  readonly material: SpriteNodeMaterial;
  readonly start: (buffers: IGPUParticles3DBuffers) => ComputeNode;
  readonly process: (buffers: IGPUParticles3DBuffers) => ComputeNode;
}

function computeNode(name: string, value: unknown): ComputeNode {
  if (
    value === null ||
    typeof value !== "object" ||
    (value as { isComputeNode?: unknown }).isComputeNode !== true
  ) {
    throw new Error(`GPUParticles3D.${name} must return a TSL compute node.`);
  }
  return value as ComputeNode;
}

export class GPUParticles3D extends Sprite implements IComputeDriven {
  readonly amount: number;
  readonly buffers: IGPUParticles3DBuffers;
  readonly processCadence = "render" as const;
  readonly warmupNodes: readonly ComputeNode[];
  emitting = true;
  #start: ComputeNode;
  #process: ComputeNode;
  #renderer: IRendererLike | undefined;
  #released = false;

  constructor(options: IGPUParticles3DOptions) {
    if (!Number.isInteger(options.amount) || options.amount <= 0)
      throw new Error("GPUParticles3D.amount must be a positive integer.");
    if (options.material === undefined) throw new Error("GPUParticles3D.material is required.");
    if (typeof options.start !== "function")
      throw new Error("GPUParticles3D.start must be a function.");
    if (typeof options.process !== "function")
      throw new Error("GPUParticles3D.process must be a function.");
    super(options.material);
    this.amount = options.amount;
    this.buffers = {
      positions: instancedArray(options.amount, "vec3"),
      velocities: instancedArray(options.amount, "vec3"),
    };
    options.material.positionNode = this.buffers.positions.toAttribute();
    this.count = options.amount;
    this.frustumCulled = false;
    this.#start = computeNode("start", options.start(this.buffers));
    this.#process = computeNode("process", options.process(this.buffers));
    this.warmupNodes = [this.#start, this.#process];
    this.addEventListener("removed", this.#onRemoved);
  }

  get released(): boolean {
    return this.#released;
  }

  attachRenderer(renderer: IRendererLike): void {
    if (this.#released) throw new Error("GPUParticles3D cannot be attached after release.");
    if (this.#renderer === renderer) return;
    this.#renderer = renderer;
    renderer.compute(this.#start);
  }

  process(renderer = this.#renderer): void {
    if (this.#released || !this.emitting) return;
    if (renderer === undefined) throw new Error("GPUParticles3D is not attached to a renderer.");
    renderer.compute(this.#process);
  }

  restart(): void {
    if (this.#released) throw new Error("GPUParticles3D cannot restart after release.");
    if (this.#renderer === undefined)
      throw new Error("GPUParticles3D is not attached to a renderer.");
    this.#renderer.compute(this.#start);
  }

  detach(): void {
    if (this.#released) return;
    this.#renderer = undefined;
    this.#start.dispose();
    this.#process.dispose();
    this.buffers.positions.value.dispose();
    this.buffers.velocities.value.dispose();
    this.#released = true;
  }

  #onRemoved = (): void => this.detach();
}
