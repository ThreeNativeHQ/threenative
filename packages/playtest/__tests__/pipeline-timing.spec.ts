import { describe, expect, it } from "vitest";

import {
  formatPipelineSummary,
  parsePipelineCapture,
  summarizePipelineCapture,
} from "../src/runner/pipeline-summary.js";

function marker(
  eventId: number,
  queueMs: number,
  serviceMs: number,
  wallMs: number,
  overrides: Record<string, unknown> = {},
): string {
  return `TN_PIPELINE_EVENT:${JSON.stringify({
    version: 1,
    eventId,
    pipelineIdentity: `backend-${eventId}`,
    programIdentity: `program-${eventId}`,
    kind: "render",
    pass: eventId === 1 ? "main" : "shadow",
    mode: "async",
    status: "created",
    startedMs: queueMs,
    settledMs: queueMs + serviceMs,
    queueMs,
    serviceMs,
    wallMs,
    provenance: { unknown: true },
    vertex: { hash: `vertex-${eventId}`, bytes: 100 + eventId },
    fragment: { hash: `fragment-${eventId}`, bytes: 200 + eventId },
    ...overrides,
  })}`;
}

function browserEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sequence: 1,
    programIdentity: "shader-pair",
    pipelineIdentity: "backend-pipeline-1",
    kind: "render",
    pass: "main",
    mode: "sync",
    status: "created",
    vertex: { hash: "v", bytes: 42 },
    fragment: { hash: "f", bytes: 21 },
    provenance: { material: { name: "brick" }, unknown: false },
    reasons: ["map"],
    startedMs: 0,
    settledMs: 3,
    serviceMs: 3,
    beforeFirstPresent: true,
    ...overrides,
  };
}

function browserCapture(
  events: readonly Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    complete: true,
    overflowed: false,
    backend: { kind: "webgpu", identity: "webgpu:test" },
    clock: { source: "performance", originMs: 10 },
    counts: {
      lookups: events.length,
      creations: events.length,
      failures: events.filter((event) => event.status === "failed").length,
      pending: events.filter((event) => event.status === "pending").length,
      uniquePrograms: new Set(events.map((event) => event.programIdentity)).size,
      uniquePipelines: new Set(events.map((event) => event.pipelineIdentity)).size,
      recordedEvents: events.length,
      droppedEvents: 0,
    },
    events,
    incompleteReasons: [],
    ...overrides,
  };
}

describe("pipeline timing capture", () => {
  it("separates queue delay from service time when asynchronous jobs overlap", () => {
    const capture = parsePipelineCapture([marker(1, 5, 10, 15), marker(2, 1, 10, 11)].join("\n"));
    const summary = summarizePipelineCapture(capture);

    expect(capture.complete).toBe(true);
    expect(capture.counts).toMatchObject({ creations: 2, recordedEvents: 2, droppedEvents: 0 });
    expect(summary.passTotals.map(({ pass }) => pass)).toEqual(["main", "shadow"]);
    expect(summary.sizeTime.samples).toBe(2);
    expect(summary.warmup.unreported).toBe(2);
    expect(formatPipelineSummary(summary)).toContain("service");
  });

  it("fails closed when one native event is missing from the sequence", () => {
    const capture = parsePipelineCapture([marker(1, 0, 4, 4), marker(3, 0, 6, 6)].join("\n"));

    expect(capture.complete).toBe(false);
    expect(capture.counts.droppedEvents).toBe(1);
    expect(capture.incompleteReasons.join(" ")).toMatch(/missing/u);
  });

  it("accepts a browser census and keeps material attribution separate from program identity", () => {
    const capture = parsePipelineCapture(browserCapture([browserEvent()], {
      firstPresent: { boundaryMs: 4, eventsSettled: 1 },
    }));
    const summary = summarizePipelineCapture(capture);

    expect(summary.complete).toBe(true);
    expect(summary.contributors[0]).toMatchObject({ label: "material:brick", creations: 1 });
    expect(summary.programReasons[0]).toMatchObject({ programIdentity: "shader-pair", reasons: ["map"] });
    expect(summary.warmup.beforeFirstPresent).toBe(1);
  });

  it("requires a version before treating an events object as a browser capture", () => {
    expect(() => parsePipelineCapture({ events: [browserEvent()] })).toThrow(/missing its version/u);
  });

  it("marks status/count disagreement incomplete instead of trusting declared counts", () => {
    const event = browserEvent({ error: "compile failed", status: "failed" });
    const input = browserCapture([event], {
      counts: {
        lookups: 1,
        creations: 1,
        failures: 0,
        pending: 0,
        uniquePrograms: 1,
        uniquePipelines: 1,
        recordedEvents: 1,
        droppedEvents: 0,
      },
    });
    const summary = summarizePipelineCapture(parsePipelineCapture(input));

    expect(summary.complete).toBe(false);
    expect(summary.incompleteReasons).toContain("failure count does not match event statuses");
  });

  it("rejects negative or out-of-order browser timing data", () => {
    expect(() => parsePipelineCapture(browserCapture([browserEvent({ startedMs: -1 })]))).toThrow(/non-negative/u);
    expect(() => parsePipelineCapture(browserCapture([browserEvent({ settledMs: 2, startedMs: 3 })]))).toThrow(/precedes/u);
    expect(() => parsePipelineCapture(browserCapture([
      browserEvent({ sequence: 2 }),
      browserEvent({ pipelineIdentity: "backend-pipeline-2" }),
    ]))).toThrow(/strictly increasing/u);
  });

  it("requires the native marker version and keeps service time unavailable distinct", () => {
    expect(() => parsePipelineCapture(marker(1, 0, 4, 4).replace('"version":1,', ""))).toThrow(/version/u);
    const event = browserEvent({ mode: "async", promiseMs: 8, serviceMs: undefined });
    const summary = summarizePipelineCapture(parsePipelineCapture(browserCapture([event])));

    expect(summary.passTotals[0]?.serviceMs).toBeUndefined();
    expect(formatPipelineSummary(summary)).toContain("unavailable service");
  });

  it("classifies native Three labels without treating them as stable provenance", () => {
    const capture = parsePipelineCapture(marker(1, 0, 4, 4, {
      pass: "unknown",
      label: "renderPipeline_PMREM_Background_12",
      provenance: { unknown: true },
    }));

    expect(capture.events[0]).toMatchObject({ pass: "pmrem", label: "renderPipeline_PMREM_Background_12" });
    expect(capture.events[0]?.provenance.unknown).toBe(true);
  });

  it("accepts the engine capture nested in a playtest observation report", () => {
    const capture = parsePipelineCapture({ observations: { pipelineCensus: browserCapture([browserEvent()]) } });

    expect(capture.source).toBe("browser");
    expect(capture.counts.creations).toBe(1);
  });
});
