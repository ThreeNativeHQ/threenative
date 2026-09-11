import { describe, expect, it } from "vitest";
import { formatPipelineCacheObservations, parsePipelineCacheObservations } from "../src/runner/pipeline-cache-observations.js";
import { assessPerfMarkers, formatPerfReport, parsePerformanceMarkers } from "../src/runner/perf.js";
const record = { version: 1, phase: "device", mode: "attached", load: "accepted", loadedBytes: 256, identity: "a".repeat(64), store: "not-attempted" };
const line = `TN_PIPELINE_CACHE:${JSON.stringify(record)}`;
describe("native pipeline persistence observations", () => {
  it("retains imported bytes without manufacturing hits or speedups", () => {
    const values = parsePipelineCacheObservations(line);
    expect(values).toEqual([record]);
    expect(formatPipelineCacheObservations(values)).toContain("observations are not hits");
    expect(formatPipelineCacheObservations([])).toContain("not reported");
  });
  it("carries cache outcomes into perf JSON and text even when frame bounds cannot pass", () => {
    const report = assessPerfMarkers(parsePerformanceMarkers(line), { requireWindows: 2 }, "fixture");
    expect(report.pipelineCaches).toEqual([record]);
    expect(report.pass).toBe(false);
    expect(formatPerfReport(report)).toContain("load accepted (256 bytes)");
  });
  it("deduplicates Android forwarding but preserves conflicting observations", () => {
    expect(parsePipelineCacheObservations(`${line}\n09-10 12:00 I MystralStdio: ${line}`)).toHaveLength(1);
    expect(parsePipelineCacheObservations(`${line}\n${line.replace('"loadedBytes":256', '"loadedBytes":512')}`)).toHaveLength(2);
  });
  it("reports old memory-only captures as unreported persistence, not cache misses", () => {
    const old = parsePipelineCacheObservations('TN_PIPELINE_CACHE:{"version":1,"phase":"device","mode":"attached","serializedBytes":32}');
    expect(old[0]?.load).toBeUndefined();
    expect(formatPipelineCacheObservations(old)).toContain("load unreported");
  });
  it.each(["{", "null", "[]", '{"version":9}', JSON.stringify({ ...record, load: "hit" }), JSON.stringify({ ...record, storedBytes: -1 }), JSON.stringify({ ...record, identity: "unknown" })])("refuses malformed data: %s", (json) => {
    expect(() => parsePipelineCacheObservations(`TN_PIPELINE_CACHE:${json}`)).toThrow("TN_PERF_PIPELINE_CACHE_MALFORMED");
  });
});
