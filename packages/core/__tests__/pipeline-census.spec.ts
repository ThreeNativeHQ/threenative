import { describe, expect, it } from "vitest";
import {
  type IPipelineCensus,
  PIPELINE_CENSUS_CAPABILITY,
  createPipelineCensus,
} from "../src/pipeline-census.js";

function renderObject(
  pipeline: Record<string, unknown>,
  object: Record<string, unknown>,
  material: Record<string, unknown>,
): Record<string, unknown> {
  return {
    object,
    material,
    pipeline,
  };
}

function source(seed: string): string {
  return `@vertex fn vs() -> ${seed}`;
}

describe("pipeline census", () => {
  it("reconciles unique programs and pipeline creations across passes", async () => {
    let now = 100;
    const pending: Array<() => void> = [];
    const backend = {
      createRenderPipeline: (
        pipelineObject: Record<string, unknown>,
        promises: Promise<void>[] | null,
      ) => {
        if (promises === null) return;
        let resolvePending: (() => void) | undefined;
        const settled = new Promise<void>((resolve) => {
          resolvePending = resolve;
        });
        if (resolvePending !== undefined) pending.push(resolvePending);
        promises.push(settled);
      },
      get: () => ({ pipeline: {} }),
    };
    const raw = {
      backend,
      renderObject: (...args: unknown[]) => {
        backend.createRenderPipeline?.(
          args[0] as Record<string, unknown>,
          args[1] as Promise<void>[] | null,
        );
      },
    };
    const census = createPipelineCensus({ kind: "webgpu", now: () => now });
    census.installRenderer(raw);

    const sharedProgram = source("vec4f");
    const firstPipeline = {
      cacheKey: "main-shared",
      vertexProgram: { code: sharedProgram },
      fragmentProgram: { code: source("vec4f") },
    };
    raw.renderObject(
      renderObject(firstPipeline, { id: 1, name: "town-house" }, { id: 2, name: "brick" }),
      null,
      null,
      null,
      { id: 2, name: "brick", type: "MeshStandardMaterial" },
      null,
      null,
      null,
      "main",
    );
    now += 4;
    const secondPipeline = {
      cacheKey: "shadow-variant",
      vertexProgram: { code: sharedProgram },
      fragmentProgram: { code: source("vec4f shadow") },
    };
    raw.renderObject(
      renderObject(secondPipeline, { id: 3, name: "town-house-shadow" }, { id: 4, type: "Shadow" }),
      [],
      null,
      null,
      { id: 4, type: "ShadowPassMaterial" },
      null,
      null,
      null,
      "shadow",
    );
    for (const resolve of pending.splice(0)) {
      now += 8;
      resolve();
    }
    await Promise.resolve();
    await Promise.resolve();

    census.firstPresent();
    const report = census.snapshot();
    expect(report.complete).toBe(true);
    expect(report.backend.kind).toBe("webgpu");
    expect(report.counts).toMatchObject({
      creations: 2,
      failures: 0,
      pending: 0,
      recordedEvents: 2,
      uniquePipelines: 2,
    });
    expect(report.counts.uniquePrograms).toBe(2);
    expect(report.events.map(({ pass }) => pass)).toEqual(["main", "shadow"]);
    expect(report.events[0]?.provenance.material?.name).toBe("brick");
    expect(report.events[0]?.vertex?.bytes).toBeGreaterThan(0);
    expect(report.events[0]?.vertex?.hash).not.toBe(sharedProgram);
    expect(report.firstPresent?.eventsSettled).toBe(2);
    expect(
      report.events.every(({ vertex, fragment }) => vertex !== undefined && fragment !== undefined),
    ).toBe(true);
  });

  it("rejects completeness when creation observation is missing or bounded out", () => {
    const census = createPipelineCensus({ kind: "webgpu", limit: 1 });
    const backend = {
      createRenderPipeline: (..._args: unknown[]) => undefined,
      get: () => ({ pipeline: {} }),
    };
    const raw = {
      backend,
      renderObject: (...args: unknown[]) => {
        backend.createRenderPipeline?.(...args);
      },
    };
    census.installRenderer(raw);
    const pipeline = {
      vertexProgram: { code: source("vec4f") },
      fragmentProgram: { code: source("vec4f") },
    };
    raw.renderObject(renderObject(pipeline, { id: 1 }, { id: 2 }), null);
    raw.renderObject(renderObject({ ...pipeline, cacheKey: "second" }, { id: 3 }, { id: 4 }), null);

    const report: IPipelineCensus = census.snapshot();
    expect(report.complete).toBe(false);
    expect(report.overflowed).toBe(true);
    expect(report.counts).toMatchObject({ creations: 2, droppedEvents: 1, recordedEvents: 1 });
    expect(report.incompleteReasons).toContain("bounded event buffer overflowed");
  });

  it("fails closed when a created pipeline has no shader observation", () => {
    const backend = {
      createRenderPipeline: (..._args: unknown[]) => undefined,
      createComputePipeline: (..._args: unknown[]) => undefined,
      get: () => ({ pipeline: {} }),
    };
    const raw = {
      backend,
      renderObject: (...args: unknown[]) => {
        backend.createRenderPipeline?.(...args);
      },
    };
    const census = createPipelineCensus({ kind: "webgpu" });
    census.installRenderer(raw);

    raw.renderObject(renderObject({ fragmentProgram: { code: source("vec4f") } }, {}, {}), null);
    backend.createComputePipeline?.({});

    const report = census.snapshot();
    expect(report.complete).toBe(false);
    expect(report.incompleteReasons).toContain(
      "a render pipeline is missing its vertex shader observation",
    );
    expect(report.incompleteReasons).toContain(
      "a compute pipeline is missing its shader observation",
    );
  });

  it("marks a bypassed collector as unsupported instead of returning an empty success", () => {
    const census = createPipelineCensus({ kind: "webgpu" });
    const report = census.snapshot();
    expect(PIPELINE_CENSUS_CAPABILITY).toBe("runtime.pipelineCensus");
    expect(report.complete).toBe(false);
    expect(report.unsupported).toBe(false);
    expect(report.incompleteReasons).toContain("no pipeline creations observed");
  });

  it("classifies main, shadow, PMREM, and output pipeline observations", () => {
    const backend = { createRenderPipeline: (..._args: unknown[]) => ({}) };
    const raw = {
      backend,
      renderObject: (...args: unknown[]) => {
        backend.createRenderPipeline?.(...args);
      },
    };
    const census = createPipelineCensus({ kind: "webgpu" });
    census.installRenderer(raw);
    const pipeline = (cacheKey: string) => ({
      cacheKey,
      vertexProgram: { code: source(cacheKey) },
      fragmentProgram: { code: source(`${cacheKey}-fragment`) },
    });

    raw.renderObject(renderObject(pipeline("main"), {}, { name: "Town" }), null);
    raw.renderObject(
      renderObject(pipeline("shadow"), {}, { name: "Town", isShadowPassMaterial: true }),
      null,
    );
    raw.renderObject(renderObject(pipeline("pmrem"), {}, { name: "PMREM_Background" }), null);
    raw.renderObject(renderObject(pipeline("output"), {}, { name: "outputColorTransform" }), null);

    expect(census.snapshot().events.map(({ pass }) => pass)).toEqual([
      "main",
      "shadow",
      "pmrem",
      "output",
    ]);
  });
});
