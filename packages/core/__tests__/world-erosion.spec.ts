import { describe, expect, it, vi } from "vitest";
import {
  BoundedWorldPassQueue,
  createWorldGpuPasses,
  simulateWorldPassesCpu,
} from "../src/world-passes.js";

const erosion = {
  depositionRate: 0.35,
  erosionRate: 0.22,
  evaporation: 0.04,
  iterations: 24,
  rainfall: 0.08,
  sedimentCapacity: 0.7,
  timeStep: 0.05,
} as const;

describe("BoundedWorldPassQueue", () => {
  it("dispatches synthesis, erosion, flow, and moisture in order without exceeding its budget", () => {
    const nodes = {
      erosionA: { name: "erosion-a" },
      erosionB: { name: "erosion-b" },
      flow: { name: "flow" },
      moisture: { name: "moisture" },
      synthesis: { name: "synthesis" },
    };
    const compute = vi.fn();
    const queue = new BoundedWorldPassQueue({
      dispatchBudget: 2,
      stages: [
        { name: "synthesis", nodes: [nodes.synthesis] },
        { name: "erosion", nodes: [nodes.erosionA, nodes.erosionB] },
        { name: "flow", nodes: [nodes.flow] },
        { name: "moisture", nodes: [nodes.moisture] },
      ],
    });

    expect(queue.process({ compute })).toBe(2);
    expect(queue.process({ compute })).toBe(2);
    expect(queue.process({ compute })).toBe(1);

    expect(compute.mock.calls.map(([node]) => node)).toEqual([
      nodes.synthesis,
      nodes.erosionA,
      nodes.erosionB,
      nodes.flow,
      nodes.moisture,
    ]);
    expect(queue.complete).toBe(true);
    expect(queue.dispatched).toBe(5);
    expect(queue.process({ compute })).toBe(0);
  });

  it("fails closed for an invalid budget or an empty stage", () => {
    expect(() => new BoundedWorldPassQueue({ dispatchBudget: 0, stages: [] })).toThrow(
      /dispatchBudget/u,
    );
    expect(
      () =>
        new BoundedWorldPassQueue({
          dispatchBudget: 1,
          stages: [
            { name: "synthesis", nodes: [{}] },
            { name: "erosion", nodes: [] },
            { name: "flow", nodes: [{}] },
            { name: "moisture", nodes: [{}] },
          ],
        }),
    ).toThrow(/erosion.*node/u);
  });

  it("fails closed for the wrong stage count or physical order", () => {
    expect(
      () =>
        new BoundedWorldPassQueue({
          dispatchBudget: 1,
          stages: [{ name: "synthesis", nodes: [{}] }],
        }),
    ).toThrow(/require synthesis, erosion, flow, and moisture stages/u);
    expect(
      () =>
        new BoundedWorldPassQueue({
          dispatchBudget: 1,
          stages: [
            { name: "synthesis", nodes: [{}] },
            { name: "flow", nodes: [{}] },
            { name: "erosion", nodes: [{}] },
            { name: "moisture", nodes: [{}] },
          ],
        }),
    ).toThrow(/expected 'erosion' at stage 1/u);
  });
});

describe("simulateWorldPassesCpu", () => {
  it("is deterministic and preserves finite height, flow, and moisture channels", () => {
    const heights = Float32Array.from({ length: 81 }, (_, index) => {
      const x = index % 9;
      const z = Math.floor(index / 9);
      return 8 - Math.hypot(x - 4, z - 4) + Math.sin(x * 1.7 + z) * 0.15;
    });

    const first = simulateWorldPassesCpu({
      cellDepth: 2,
      cellWidth: 2,
      columns: 9,
      erosion,
      heights,
      rows: 9,
    });
    const second = simulateWorldPassesCpu({
      cellDepth: 2,
      cellWidth: 2,
      columns: 9,
      erosion,
      heights,
      rows: 9,
    });

    expect(first.heights).toEqual(second.heights);
    expect(first.flow).toEqual(second.flow);
    expect(first.moisture).toEqual(second.moisture);
    expect([...first.heights, ...first.flow, ...first.moisture].every(Number.isFinite)).toBe(true);
    expect(Math.max(...first.flow)).toBeGreaterThan(0);
    expect(Math.max(...first.moisture)).toBeLessThanOrEqual(1);
    expect(first.heights).not.toEqual(heights);
  });

  it("keeps synthesis unchanged when erosion iterations are explicitly zero", () => {
    const heights = Float32Array.from([3, 2, 1, 2, 1, 0, 1, 0, -1]);
    const result = simulateWorldPassesCpu({
      cellDepth: 1,
      cellWidth: 1,
      columns: 3,
      erosion: { ...erosion, iterations: 0 },
      heights,
      rows: 3,
    });

    expect(result.heights).toEqual(heights);
  });

  it("fails closed when a physical tuning value is omitted or invalid", () => {
    expect(() =>
      simulateWorldPassesCpu({
        cellDepth: 1,
        cellWidth: 1,
        columns: 2,
        erosion: { ...erosion, rainfall: Number.NaN },
        heights: new Float32Array(4),
        rows: 2,
      }),
    ).toThrow(/rainfall/u);
  });

  it("routes every downhill source once and normalizes flow and moisture by hand", () => {
    const heights = Float32Array.from([3, 2, 1, 0]);
    const result = simulateWorldPassesCpu({
      cellDepth: 1,
      cellWidth: 1,
      columns: 2,
      erosion: { ...erosion, iterations: 0 },
      heights,
      rows: 2,
    });

    // 0 -> 2 -> 3 and 1 -> 3: accumulated drainage is [1, 1, 2, 4].
    const scale = Math.log1p(4);
    const expectedFlow = [1, 1, 2, 4].map((value) => Math.log1p(value) / scale);
    expect([...result.flow].map((value) => Number(value.toFixed(6)))).toEqual(
      expectedFlow.map((value) => Number(value.toFixed(6))),
    );
    expect([...result.moisture].map((value) => Number(value.toFixed(6)))).toEqual(
      expectedFlow.map((value) => Number((value * 0.7).toFixed(6))),
    );
    expect(result.heights).toEqual(heights);
  });

  it.each([
    ["rows", { rows: 2.5 }, /rows must be an integer of at least 2/u],
    ["rows below two", { rows: 1 }, /rows must be an integer of at least 2/u],
    ["columns", { columns: 0 }, /columns must be an integer of at least 2/u],
    ["heights length", { heights: new Float32Array(3) }, /expected 4 heights, received 3/u],
    ["cellWidth", { cellWidth: 0 }, /cellWidth must be finite and at least/u],
    ["cellWidth NaN", { cellWidth: Number.NaN }, /cellWidth/u],
    ["cellDepth", { cellDepth: -1 }, /cellDepth must be finite and at least/u],
    [
      "iterations",
      { erosion: { ...erosion, iterations: -1 } },
      /iterations must be a non-negative integer/u,
    ],
    [
      "fractional iterations",
      { erosion: { ...erosion, iterations: 1.5 } },
      /iterations must be a non-negative integer/u,
    ],
    [
      "rainfall",
      { erosion: { ...erosion, rainfall: -1 } },
      /rainfall must be finite and at least 0/u,
    ],
    ["evaporation NaN", { erosion: { ...erosion, evaporation: Number.NaN } }, /evaporation/u],
    [
      "evaporation above one",
      { erosion: { ...erosion, evaporation: 1.5 } },
      /evaporation must not exceed 1/u,
    ],
    ["timeStep", { erosion: { ...erosion, timeStep: 0 } }, /timeStep must be finite and at least/u],
    ["sedimentCapacity", { erosion: { ...erosion, sedimentCapacity: -1 } }, /sedimentCapacity/u],
    ["erosionRate", { erosion: { ...erosion, erosionRate: Number.NaN } }, /erosionRate/u],
    ["depositionRate", { erosion: { ...erosion, depositionRate: -1 } }, /depositionRate/u],
    [
      "non-finite height",
      { heights: Float32Array.from([3, 2, 1, Number.NaN]) },
      /height sample must be finite/u,
    ],
  ])("fails closed for an invalid %s", (_label, overrides, pattern) => {
    expect(() =>
      simulateWorldPassesCpu({
        cellDepth: 1,
        cellWidth: 1,
        columns: 2,
        erosion,
        heights: new Float32Array(4),
        rows: 2,
        ...overrides,
      }),
    ).toThrow(pattern);
  });
});

describe("createWorldGpuPasses", () => {
  it("builds TSL stages in physical order and exposes the bounded queue", () => {
    const passes = createWorldGpuPasses({
      cellDepth: 1,
      cellWidth: 1,
      columns: 3,
      dispatchBudget: 3,
      erosion: { ...erosion, iterations: 2 },
      heights: Float32Array.from([3, 2, 1, 2, 1, 0, 1, 0, -1]),
      rows: 3,
    });
    const compute = vi.fn();

    expect(passes.stages.map((stage) => stage.name)).toEqual([
      "synthesis",
      "erosion",
      "flow",
      "moisture",
    ]);
    expect(passes.stages.map((stage) => stage.nodes.length)).toEqual([1, 6, 13, 1]);
    expect(passes.queue.process({ compute })).toBe(3);
    expect(compute).toHaveBeenCalledTimes(3);
    expect(passes.queue.complete).toBe(false);

    passes.dispose();
  });

  it("fails closed before allocating when the height count does not match the grid", () => {
    expect(() =>
      createWorldGpuPasses({
        cellDepth: 1,
        cellWidth: 1,
        columns: 2,
        dispatchBudget: 1,
        erosion,
        heights: new Float32Array(3),
        rows: 2,
      }),
    ).toThrow(/expected 4 heights, received 3/u);
  });

  it("keeps a real erosion stage when iterations are zero", () => {
    const passes = createWorldGpuPasses({
      cellDepth: 1,
      cellWidth: 1,
      columns: 2,
      dispatchBudget: 1,
      erosion: { ...erosion, iterations: 0 },
      heights: new Float32Array(4),
      rows: 2,
    });

    expect(passes.stages[1]?.nodes).toHaveLength(1);
    passes.dispose();
  });
});
