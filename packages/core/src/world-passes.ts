import type { Node } from "three/src/nodes/Nodes.js";
import type StorageBufferNode from "three/src/nodes/accessors/StorageBufferNode.js";
import {
  Fn,
  If,
  Return,
  atomicAdd,
  atomicLoad,
  clamp,
  float,
  instanceIndex,
  instancedArray,
  log,
  max,
  min,
  uint,
  vec4,
} from "three/tsl";
import type { ComputeNode } from "three/webgpu";
import type { IRendererLike } from "./renderer.js";

export interface IWorldErosionOptions {
  readonly depositionRate: number;
  readonly erosionRate: number;
  readonly evaporation: number;
  readonly iterations: number;
  readonly rainfall: number;
  readonly sedimentCapacity: number;
  readonly timeStep: number;
}

export interface IWorldPassCpuOptions {
  readonly cellDepth: number;
  readonly cellWidth: number;
  readonly columns: number;
  readonly erosion: IWorldErosionOptions;
  readonly heights: Float32Array;
  readonly rows: number;
}

export interface IWorldPassCpuResult {
  readonly flow: Float32Array;
  readonly heights: Float32Array;
  readonly moisture: Float32Array;
}

export interface IWorldGpuPassOptions extends IWorldPassCpuOptions {
  readonly dispatchBudget: number;
}

export interface IWorldGpuPasses {
  readonly flow: StorageBufferNode<"float">;
  readonly height: StorageBufferNode<"float">;
  readonly moisture: StorageBufferNode<"float">;
  readonly queue: BoundedWorldPassQueue;
  readonly stages: readonly IWorldPassStage[];
  dispose(): void;
}

function finite(name: string, value: number, minimum = 0): number {
  if (!Number.isFinite(value) || value < minimum)
    throw new Error(`World passes ${name} must be finite and at least ${minimum}.`);
  return value;
}

function gridCount(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 2)
    throw new Error(`World passes ${name} must be an integer of at least 2.`);
  return value;
}

const CARDINAL = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

function neighbourIndex(
  index: number,
  direction: number,
  rows: number,
  columns: number,
): number | undefined {
  const pair = CARDINAL[direction];
  if (pair === undefined) return undefined;
  const column = (index % columns) + pair[0];
  const row = Math.floor(index / columns) + pair[1];
  if (column < 0 || column >= columns || row < 0 || row >= rows) return undefined;
  return row * columns + column;
}

/** Deterministic scalar reference for the TSL hydraulic and flow passes. */
export function simulateWorldPassesCpu(options: IWorldPassCpuOptions): IWorldPassCpuResult {
  const rows = gridCount("rows", options.rows);
  const columns = gridCount("columns", options.columns);
  const count = rows * columns;
  if (options.heights.length !== count)
    throw new Error(`World passes expected ${count} heights, received ${options.heights.length}.`);
  const cellWidth = finite("cellWidth", options.cellWidth, Number.EPSILON);
  const cellDepth = finite("cellDepth", options.cellDepth, Number.EPSILON);
  const tuning = options.erosion;
  if (!Number.isInteger(tuning.iterations) || tuning.iterations < 0)
    throw new Error("World passes iterations must be a non-negative integer.");
  const rainfall = finite("rainfall", tuning.rainfall);
  const evaporation = finite("evaporation", tuning.evaporation);
  if (evaporation > 1) throw new Error("World passes evaporation must not exceed 1.");
  const timeStep = finite("timeStep", tuning.timeStep, Number.EPSILON);
  const sedimentCapacity = finite("sedimentCapacity", tuning.sedimentCapacity);
  const erosionRate = finite("erosionRate", tuning.erosionRate);
  const depositionRate = finite("depositionRate", tuning.depositionRate);
  let heights = options.heights.slice();
  for (const height of heights) finite("height sample", height, Number.NEGATIVE_INFINITY);
  let water = new Float32Array(count);
  let sediment = new Float32Array(count);
  const outflow = new Float32Array(count * CARDINAL.length);

  for (let iteration = 0; iteration < tuning.iterations; iteration += 1) {
    outflow.fill(0);
    for (let index = 0; index < count; index += 1) {
      water[index] = (water[index] as number) + rainfall * timeStep;
      const head = (heights[index] as number) + (water[index] as number);
      let totalDrop = 0;
      const drops = [0, 0, 0, 0];
      for (let direction = 0; direction < CARDINAL.length; direction += 1) {
        const neighbour = neighbourIndex(index, direction, rows, columns);
        if (neighbour === undefined) continue;
        const drop = Math.max(
          0,
          head - ((heights[neighbour] as number) + (water[neighbour] as number)),
        );
        drops[direction] = drop;
        totalDrop += drop;
      }
      if (totalDrop === 0) continue;
      const available = Math.min(water[index] as number, totalDrop * timeStep);
      for (let direction = 0; direction < CARDINAL.length; direction += 1)
        outflow[index * CARDINAL.length + direction] =
          available * ((drops[direction] as number) / totalDrop);
    }

    const nextWater = new Float32Array(count);
    const nextSediment = new Float32Array(count);
    const nextHeights = heights.slice();
    for (let index = 0; index < count; index += 1) {
      let incomingWater = 0;
      let outgoingWater = 0;
      for (let direction = 0; direction < CARDINAL.length; direction += 1) {
        outgoingWater += outflow[index * CARDINAL.length + direction] as number;
        const neighbour = neighbourIndex(index, direction, rows, columns);
        if (neighbour === undefined) continue;
        incomingWater += outflow[neighbour * CARDINAL.length + (direction ^ 1)] as number;
      }
      const remainingWater = Math.max(
        0,
        ((water[index] as number) + incomingWater - outgoingWater) * (1 - evaporation * timeStep),
      );
      nextWater[index] = remainingWater;
      const speed = outgoingWater / (timeStep * Math.min(cellWidth, cellDepth));
      const capacity = sedimentCapacity * speed * outgoingWater;
      let localSediment = sediment[index] as number;
      if (localSediment < capacity) {
        const eroded = Math.min(
          capacity - localSediment,
          (capacity - localSediment) * erosionRate * timeStep,
        );
        nextHeights[index] = (nextHeights[index] as number) - eroded;
        localSediment += eroded;
      } else {
        const deposited = (localSediment - capacity) * depositionRate * timeStep;
        nextHeights[index] = (nextHeights[index] as number) + deposited;
        localSediment -= deposited;
      }
      const transported = Math.min(localSediment, localSediment * outgoingWater);
      nextSediment[index] = (nextSediment[index] as number) + localSediment - transported;
      if (outgoingWater === 0) continue;
      for (let direction = 0; direction < CARDINAL.length; direction += 1) {
        const neighbour = neighbourIndex(index, direction, rows, columns);
        const amount = outflow[index * CARDINAL.length + direction] as number;
        if (neighbour !== undefined)
          nextSediment[neighbour] =
            (nextSediment[neighbour] as number) + transported * (amount / outgoingWater);
      }
    }
    heights = nextHeights;
    water = nextWater;
    sediment = nextSediment;
  }

  const flow = accumulateFlow(heights, rows, columns);
  const moisture = new Float32Array(count);
  for (let index = 0; index < count; index += 1)
    moisture[index] = Math.min(
      1,
      (flow[index] as number) * 0.7 + Math.min(1, Math.max(0, water[index] as number)) * 0.3,
    );
  return { flow, heights, moisture };
}

function accumulateFlow(heights: Float32Array, rows: number, columns: number): Float32Array {
  const accumulated = new Uint32Array(heights.length);
  for (let source = 0; source < heights.length; source += 1) {
    let current = source;
    for (let step = 0; step < rows + columns; step += 1) {
      accumulated[current] = (accumulated[current] as number) + 1;
      let destination = current;
      let lowest = heights[current] as number;
      for (let direction = 0; direction < CARDINAL.length; direction += 1) {
        const neighbour = neighbourIndex(current, direction, rows, columns);
        if (neighbour === undefined) continue;
        const candidate = heights[neighbour] as number;
        if (candidate < lowest) {
          lowest = candidate;
          destination = neighbour;
        }
      }
      if (destination === current) break;
      current = destination;
    }
  }
  const scale = Math.log1p(heights.length);
  return Float32Array.from(accumulated, (value) => Math.log1p(value) / scale);
}

type FloatStorage = StorageBufferNode<"float">;

interface IErosionRoles {
  readonly heightSource: FloatStorage;
  readonly heightTarget: FloatStorage;
  readonly sedimentSource: FloatStorage;
  readonly sedimentTarget: FloatStorage;
  readonly waterSource: FloatStorage;
  readonly waterTarget: FloatStorage;
}

function computeNode(name: string, count: number, body: () => Node): ComputeNode {
  const node = Fn(body)().compute(count);
  node.setName(name);
  return node;
}

/** Build the TSL counterpart of the scalar reference without dispatching it. */
export function createWorldGpuPasses(options: IWorldGpuPassOptions): IWorldGpuPasses {
  const rows = gridCount("rows", options.rows);
  const columns = gridCount("columns", options.columns);
  const count = rows * columns;
  if (options.heights.length !== count)
    throw new Error(`World passes expected ${count} heights, received ${options.heights.length}.`);
  finite("cellWidth", options.cellWidth, Number.EPSILON);
  finite("cellDepth", options.cellDepth, Number.EPSILON);
  simulateWorldPassesCpu({ ...options, erosion: { ...options.erosion, iterations: 0 } });
  const initial = instancedArray(options.heights, "float").toReadOnly();
  const heightA = instancedArray(count, "float");
  const heightB = instancedArray(count, "float");
  const waterA = instancedArray(count, "float");
  const waterB = instancedArray(count, "float");
  const sedimentA = instancedArray(count, "float");
  const sedimentB = instancedArray(count, "float");
  const sedimentTemporary = instancedArray(count, "float");
  const outflow = instancedArray(count, "vec4");
  const flowAtomic = instancedArray(count, "uint");
  const flowFrontierA = instancedArray(count, "uint");
  const flowFrontierB = instancedArray(count, "uint");
  const flow = instancedArray(count, "float");
  const moisture = instancedArray(count, "float");
  const allStorage = [
    initial,
    heightA,
    heightB,
    waterA,
    waterB,
    sedimentA,
    sedimentB,
    sedimentTemporary,
    outflow,
    flowAtomic,
    flowFrontierA,
    flowFrontierB,
    flow,
    moisture,
  ];
  const guard = (body: () => void): Node =>
    Fn<void>(() => {
      If(instanceIndex.greaterThanEqual(count), () => Return());
      body();
    })();
  const at = (index: Node<"int">, x: number, z: number) => {
    const column = clamp(float(index.mod(columns)).add(x), 0, columns - 1).toInt();
    const row = clamp(float(index.div(columns)).add(z), 0, rows - 1).toInt();
    return row.mul(columns).add(column);
  };
  const synthesis = computeNode("world.synthesis", count, () =>
    guard(() => {
      const index = instanceIndex.toInt();
      heightA.element(index).assign(initial.element(index));
      waterA.element(index).assign(0);
      sedimentA.element(index).assign(0);
      flowAtomic.element(index).assign(uint(1));
      flowFrontierA.element(index).assign(uint(1));
      flowFrontierB.element(index).assign(uint(0));
    }),
  );
  const erosionNodes: ComputeNode[] = [];
  const tuning = options.erosion;
  const rain = tuning.rainfall * tuning.timeStep;
  const makeIteration = (roles: IErosionRoles, iteration: number): void => {
    const flux = computeNode(`world.erosion.${iteration}.flux`, count, () =>
      guard(() => {
        const index = instanceIndex.toInt();
        const water = roles.waterSource.element(index).add(rain);
        const head = roles.heightSource.element(index).add(water).toVar();
        const drop = (x: number, z: number) => {
          const neighbour = at(index, x, z);
          return max(
            0,
            head.sub(
              roles.heightSource
                .element(neighbour)
                .add(roles.waterSource.element(neighbour))
                .add(rain),
            ),
          );
        };
        const drops = vec4(drop(-1, 0), drop(1, 0), drop(0, -1), drop(0, 1)).toVar();
        const totalDrop = drops.x.add(drops.y).add(drops.z).add(drops.w);
        const available = min(water, totalDrop.mul(tuning.timeStep));
        const scale = available.div(max(totalDrop, 1e-6));
        outflow.element(index).assign(drops.mul(scale));
      }),
    );
    const erode = computeNode(`world.erosion.${iteration}.erode`, count, () =>
      guard(() => {
        const index = instanceIndex.toInt();
        const fluxValue = outflow.element(index).toVar();
        const outgoing = fluxValue.x.add(fluxValue.y).add(fluxValue.z).add(fluxValue.w).toVar();
        const incoming = outflow
          .element(at(index, -1, 0))
          .y.add(outflow.element(at(index, 1, 0)).x)
          .add(outflow.element(at(index, 0, -1)).w)
          .add(outflow.element(at(index, 0, 1)).z);
        const water = max(
          0,
          roles.waterSource
            .element(index)
            .add(rain)
            .add(incoming)
            .sub(outgoing)
            .mul(1 - tuning.evaporation * tuning.timeStep),
        );
        roles.waterTarget.element(index).assign(water);
        const speed = outgoing.div(
          tuning.timeStep * Math.min(options.cellWidth, options.cellDepth),
        );
        const capacity = float(tuning.sedimentCapacity).mul(speed).mul(outgoing);
        const sediment = roles.sedimentSource.element(index).toVar();
        const height = roles.heightSource.element(index).toVar();
        If(sediment.lessThan(capacity), () => {
          const amount = capacity
            .sub(sediment)
            .mul(tuning.erosionRate * tuning.timeStep)
            .min(capacity.sub(sediment));
          height.subAssign(amount);
          sediment.addAssign(amount);
        }).Else(() => {
          const amount = sediment.sub(capacity).mul(tuning.depositionRate * tuning.timeStep);
          height.addAssign(amount);
          sediment.subAssign(amount);
        });
        roles.heightTarget.element(index).assign(height);
        sedimentTemporary.element(index).assign(sediment);
      }),
    );
    const transport = computeNode(`world.erosion.${iteration}.transport`, count, () =>
      guard(() => {
        const index = instanceIndex.toInt();
        const ownFlux = outflow.element(index).toVar();
        const ownOut = ownFlux.x.add(ownFlux.y).add(ownFlux.z).add(ownFlux.w);
        const retained = sedimentTemporary.element(index).mul(min(1, ownOut).oneMinus()).toVar();
        const gather = (x: number, z: number, component: "x" | "y" | "z" | "w") => {
          const neighbour = at(index, x, z);
          const neighbourFlux = outflow.element(neighbour).toVar();
          const total = neighbourFlux.x
            .add(neighbourFlux.y)
            .add(neighbourFlux.z)
            .add(neighbourFlux.w);
          return sedimentTemporary
            .element(neighbour)
            .mul(min(1, total))
            .mul(neighbourFlux[component].div(max(total, 1e-6)));
        };
        retained.addAssign(gather(-1, 0, "y"));
        retained.addAssign(gather(1, 0, "x"));
        retained.addAssign(gather(0, -1, "w"));
        retained.addAssign(gather(0, 1, "z"));
        roles.sedimentTarget.element(index).assign(retained);
      }),
    );
    erosionNodes.push(flux, erode, transport);
  };
  for (let iteration = 0; iteration < tuning.iterations; iteration += 1)
    makeIteration(
      iteration % 2 === 0
        ? {
            heightSource: heightA,
            heightTarget: heightB,
            sedimentSource: sedimentA,
            sedimentTarget: sedimentB,
            waterSource: waterA,
            waterTarget: waterB,
          }
        : {
            heightSource: heightB,
            heightTarget: heightA,
            sedimentSource: sedimentB,
            sedimentTarget: sedimentA,
            waterSource: waterB,
            waterTarget: waterA,
          },
      iteration,
    );
  if (erosionNodes.length === 0)
    erosionNodes.push(
      computeNode("world.erosion.bypass", count, () =>
        guard(() =>
          heightA.element(instanceIndex.toInt()).assign(heightA.element(instanceIndex.toInt())),
        ),
      ),
    );
  const height = tuning.iterations % 2 === 0 ? heightA : heightB;
  const water = tuning.iterations % 2 === 0 ? waterA : waterB;
  const flowNodes: ComputeNode[] = [];
  const makeFlowStep = (
    source: StorageBufferNode<"uint">,
    target: StorageBufferNode<"uint">,
    step: number,
  ): void => {
    flowNodes.push(
      computeNode(`world.flow.${step}.clear`, count, () =>
        guard(() => target.element(instanceIndex.toInt()).assign(uint(0))),
      ),
      computeNode(`world.flow.${step}.route`, count, () =>
        guard(() => {
          const current = instanceIndex.toInt();
          const amount = atomicLoad(source.element(current));
          const best = height.element(current).toVar();
          const destination = current.toVar();
          const consider = (x: number, z: number): void => {
            const neighbour = at(current, x, z);
            const candidate = height.element(neighbour);
            If(candidate.lessThan(best), () => {
              best.assign(candidate);
              destination.assign(neighbour);
            });
          };
          consider(-1, 0);
          consider(1, 0);
          consider(0, -1);
          consider(0, 1);
          If(destination.notEqual(current).and(amount.greaterThan(0)), () => {
            atomicAdd(target.element(destination), amount);
            atomicAdd(flowAtomic.element(destination), amount);
          });
        }),
      ),
    );
  };
  for (let step = 0; step < rows + columns; step += 1)
    makeFlowStep(
      step % 2 === 0 ? flowFrontierA : flowFrontierB,
      step % 2 === 0 ? flowFrontierB : flowFrontierA,
      step,
    );
  const normalizeFlow = computeNode("world.flow.normalize", count, () =>
    guard(() => {
      const index = instanceIndex.toInt();
      flow
        .element(index)
        .assign(log(float(atomicLoad(flowAtomic.element(index))).add(1)).div(Math.log1p(count)));
    }),
  );
  const deriveMoisture = computeNode("world.moisture", count, () =>
    guard(() => {
      const index = instanceIndex.toInt();
      moisture.element(index).assign(
        clamp(
          flow
            .element(index)
            .mul(0.7)
            .add(clamp(water.element(index), 0, 1).mul(0.3)),
          0,
          1,
        ),
      );
    }),
  );
  const stages: readonly IWorldPassStage[] = [
    { name: "synthesis", nodes: [synthesis] },
    { name: "erosion", nodes: erosionNodes },
    { name: "flow", nodes: [...flowNodes, normalizeFlow] },
    { name: "moisture", nodes: [deriveMoisture] },
  ];
  return {
    flow,
    height,
    moisture,
    queue: new BoundedWorldPassQueue({ dispatchBudget: options.dispatchBudget, stages }),
    stages,
    dispose: () => {
      for (const node of stages.flatMap((stage) => stage.nodes))
        (node as { dispose?: () => void }).dispose?.();
      for (const buffer of allStorage) buffer.value.dispose();
    },
  };
}

export interface IWorldPassStage {
  /** Physical pass name, used in fail-closed diagnostics. */
  readonly name: "synthesis" | "erosion" | "flow" | "moisture";
  /** Dispatches within a stage remain in this order. */
  readonly nodes: readonly unknown[];
}

export interface IBoundedWorldPassQueueOptions {
  /** Maximum compute dispatches submitted by one fixed step. */
  readonly dispatchBudget: number;
  /** Physical order is synthesis → erosion → flow → moisture. */
  readonly stages: readonly IWorldPassStage[];
}

const STAGE_ORDER = ["synthesis", "erosion", "flow", "moisture"] as const;

/** @internal Fixed-order, bounded scheduling shared by the world field's GPU passes. */
export class BoundedWorldPassQueue {
  readonly dispatchBudget: number;
  readonly #nodes: readonly unknown[];
  #cursor = 0;

  constructor(options: IBoundedWorldPassQueueOptions) {
    if (!Number.isInteger(options.dispatchBudget) || options.dispatchBudget <= 0)
      throw new Error("World passes dispatchBudget must be a positive integer.");
    if (options.stages.length !== STAGE_ORDER.length)
      throw new Error("World passes require synthesis, erosion, flow, and moisture stages.");
    options.stages.forEach((stage, index) => {
      const expected = STAGE_ORDER[index];
      if (stage.name !== expected)
        throw new Error(`World passes expected '${expected}' at stage ${index}.`);
      if (stage.nodes.length === 0)
        throw new Error(`World passes ${stage.name} stage requires at least one node.`);
    });
    this.dispatchBudget = options.dispatchBudget;
    this.#nodes = options.stages.flatMap((stage) => stage.nodes);
  }

  get complete(): boolean {
    return this.#cursor === this.#nodes.length;
  }

  get dispatched(): number {
    return this.#cursor;
  }

  /** Submit at most one fixed step's budget, preserving the declared physical pass order. */
  process(renderer: Pick<IRendererLike, "compute">): number {
    const end = Math.min(this.#nodes.length, this.#cursor + this.dispatchBudget);
    const start = this.#cursor;
    while (this.#cursor < end) {
      renderer.compute(this.#nodes[this.#cursor]);
      this.#cursor += 1;
    }
    return this.#cursor - start;
  }
}
