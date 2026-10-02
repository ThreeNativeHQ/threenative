import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertExposureProof, exposureCutTiming } from "./fixtures/auto-exposure/proof.js";

function report() {
  return {
    pass: true,
    capture: { rendererKind: "webgpu", adapter: { architecture: "swiftshader" } },
    diagnostics: [] as { code: string }[],
    observations: {
      console: [
        {
          text: `TN_AUTO_EXPOSURE:${JSON.stringify({ measured: true, applied: true, luminance: 0.002, exposureStops: 6.5, targetStops: 6.6, settled: true })}`,
        },
      ],
    },
  };
}

describe("runtime exposure proof", () => {
  it("counts actual GPU updates to the first settled new target and reports consumed time", () => {
    const value = report();
    value.observations.console = [
      {
        text: 'TN_EXPOSURE_CUT:{"updates":30,"consumedSeconds":2,"targetStops":6.5,"settled":true}',
      },
      { text: 'TN_AUTO_EXPOSURE:{"targetStops":6.5,"settled":true}' },
      { text: 'TN_EXPOSURE_TIMING:{"updates":47,"consumedSeconds":3.1}' },
      { text: 'TN_AUTO_EXPOSURE:{"targetStops":-4.5,"settled":true}' },
    ];
    expect(exposureCutTiming(value, 11, 180)).toEqual({
      renderedUpdates: 17,
      consumedSeconds: 1.1,
    });
  });
  it("rejects a stale settled readback from before the cut", () => {
    const value = report();
    value.observations.console = [
      {
        text: 'TN_EXPOSURE_CUT:{"updates":30,"consumedSeconds":2,"targetStops":6.5,"settled":true}',
      },
      { text: 'TN_EXPOSURE_TIMING:{"updates":47,"consumedSeconds":3.1}' },
      { text: 'TN_AUTO_EXPOSURE:{"targetStops":6.5,"settled":true}' },
    ];
    expect(() => exposureCutTiming(value, 11, 180)).toThrow(/did not settle.*17.*1.1/);
  });
  it("rejects settling after the authored rendered-frame budget", () => {
    const value = report();
    value.observations.console = [
      {
        text: 'TN_EXPOSURE_CUT:{"updates":30,"consumedSeconds":2,"targetStops":6.5,"settled":true}',
      },
      { text: 'TN_EXPOSURE_TIMING:{"updates":211,"consumedSeconds":5}' },
      { text: 'TN_AUTO_EXPOSURE:{"targetStops":-4.5,"settled":true}' },
    ];
    expect(() => exposureCutTiming(value, 11, 180)).toThrow(/181.*180/);
  });
  it("owns its favicon without an unrequested missing /favicon.ico request", () => {
    const html = readFileSync(
      new URL("./fixtures/auto-exposure/index.html", import.meta.url),
      "utf8",
    );
    expect(html).toContain('<link rel="icon" href="data:,">');
  });
  it("accepts a settled, observed GPU measurement with declared software provenance", () => {
    expect(assertExposureProof(report(), true).exposureStops).toBe(6.5);
  });
  it("rejects software device loss even when the runner passes its downgraded warning", () => {
    const value = report();
    value.diagnostics.push({ code: "TN_PLAYTEST_SOFTWARE_DEVICE_LOST" });
    expect(() => assertExposureProof(value, true)).toThrow(/device loss/i);
  });
  it("rejects failed unrelated diagnostics instead of accepting the visible frame", () => {
    const value = report();
    value.pass = false;
    value.diagnostics.push({ code: "TN_BROWSER_CONSOLE_ERROR" });
    expect(() => assertExposureProof(value, true)).toThrow(/failed/i);
  });
  it("rejects missing adapter provenance", () => {
    const value = report();
    value.capture.adapter.architecture = "";
    expect(() => assertExposureProof(value, true)).toThrow(/provenance/i);
  });
  it("rejects missing exposure measurement", () => {
    const value = report();
    value.observations.console = [];
    expect(() => assertExposureProof(value, true)).toThrow(/missing/i);
  });
  it("rejects a disabled graph that claims adaptation was applied", () => {
    expect(() => assertExposureProof(report(), false)).toThrow(/measurement/i);
  });
});
