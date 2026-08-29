import type { IComputeDriven } from "@threenative/core";
import { InstancedMesh, SphereGeometry } from "three";
import { Fn, float, instanceIndex, instancedArray, positionLocal, vec3 } from "three/tsl";
import { type ComputeNode, MeshBasicNodeMaterial, type StorageBufferNode } from "three/webgpu";

const FIELD_COUNT = 16;
type ComputeRenderer = Parameters<IComputeDriven["process"]>[0];

const initialPositions = new Float32Array(
  Array.from({ length: FIELD_COUNT }, (_unused, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    return [(column - 1.5) * 0.48, (row - 1.5) * 0.48, 0];
  }).flat(),
);

const colors = new Float32Array(
  Array.from({ length: FIELD_COUNT }, (_unused, index) => {
    const hue = index % 4;
    return [0.2 + hue * 0.18, 0.86 - hue * 0.08, 0.95 - hue * 0.12];
  }).flat(),
);

export interface IPingPongFieldOptions {
  readonly onRelease?: () => void;
}

/**
 * A game-owned two-pass GPU simulation used to prove the public compute-driven lifecycle.
 *
 * Pass one reads buffer A and writes buffer B. Pass two reads B and writes A, so every fixed step
 * exercises both the declared dispatch order and the storage lifetime that a fluid or cloth solver
 * needs. The framework knows none of these buffers or passes; it sees only IComputeDriven.
 */
export class PingPongField extends InstancedMesh implements IComputeDriven {
  readonly warmupNodes: readonly ComputeNode[];
  readonly fieldColors: StorageBufferNode<"vec3">;
  #positionsA: StorageBufferNode<"vec3">;
  #positionsB: StorageBufferNode<"vec3">;
  #passOne: ComputeNode;
  #passTwo: ComputeNode;
  #renderer: ComputeRenderer | undefined;
  #onRelease: (() => void) | undefined;
  #released = false;
  #steps = 0;
  #passOneDispatches = 0;
  #passTwoDispatches = 0;

  constructor(options: IPingPongFieldOptions = {}) {
    const positionsA = instancedArray(initialPositions, "vec3");
    const positionsB = instancedArray(new Float32Array(initialPositions), "vec3");
    const fieldColors = instancedArray(colors, "vec3");
    const material = new MeshBasicNodeMaterial({ toneMapped: false });
    material.positionNode = positionLocal.add(positionsA.element(instanceIndex));
    material.colorNode = fieldColors.element(instanceIndex);

    const passOne = Fn(() => {
      const index = float(instanceIndex);
      const current = positionsA.element(instanceIndex);
      positionsB
        .element(instanceIndex)
        .assign(vec3(current.x.add(0.004), current.y.add(index.sin().mul(0.003)), current.z));
    })().compute(FIELD_COUNT);
    const passTwo = Fn(() => {
      const index = float(instanceIndex);
      const current = positionsB.element(instanceIndex);
      positionsA
        .element(instanceIndex)
        .assign(vec3(current.x.sub(0.004), current.y.add(index.cos().mul(0.003)), current.z));
    })().compute(FIELD_COUNT);

    super(new SphereGeometry(0.16, 12, 8), material, FIELD_COUNT);
    this.#positionsA = positionsA;
    this.#positionsB = positionsB;
    this.fieldColors = fieldColors;
    this.#passOne = passOne;
    this.#passTwo = passTwo;
    this.warmupNodes = [passOne, passTwo];
    this.#onRelease = options.onRelease;
    this.frustumCulled = false;
    this.addEventListener("removed", this.#onRemoved);
  }

  get released(): boolean {
    return this.#released;
  }

  get steps(): number {
    return this.#steps;
  }

  get passOneDispatches(): number {
    return this.#passOneDispatches;
  }

  get passTwoDispatches(): number {
    return this.#passTwoDispatches;
  }

  debug(): Record<string, unknown> {
    return {
      gpuSteps: this.#steps,
      passOneDispatches: this.#passOneDispatches,
      passTwoDispatches: this.#passTwoDispatches,
      passOrder: this.#passOneDispatches === this.#passTwoDispatches && this.#steps > 0,
      released: this.#released,
    };
  }

  attachRenderer(renderer: ComputeRenderer): void {
    if (this.#released) throw new Error("PingPongField cannot be attached after release.");
    this.#renderer = renderer;
  }

  process(renderer = this.#renderer): void {
    if (this.#released) return;
    if (renderer === undefined) throw new Error("PingPongField is not attached to a renderer.");
    renderer.compute(this.#passOne);
    this.#passOneDispatches += 1;
    renderer.compute(this.#passTwo);
    this.#passTwoDispatches += 1;
    this.#steps += 1;
  }

  detach(): void {
    if (this.#released) return;
    this.removeEventListener("removed", this.#onRemoved);
    this.#renderer = undefined;
    this.#passOne.dispose();
    this.#passTwo.dispose();
    this.#positionsA.value.dispose();
    this.#positionsB.value.dispose();
    this.fieldColors.value.dispose();
    this.geometry.dispose();
    const material = this.material;
    if (Array.isArray(material)) {
      for (const entry of material) entry.dispose();
    } else {
      material.dispose();
    }
    this.#released = true;
    this.#onRelease?.();
    this.#onRelease = undefined;
  }

  #onRemoved = (): void => this.detach();
}
