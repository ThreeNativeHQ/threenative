import { describe, expect, it } from "vitest";
import {
  measureProxyPenetration,
  measureSailPositions,
  riggingPositions,
} from "../src/physics/measure.js";
import type { IRiggingModel } from "../src/physics/model.js";
import { buildRiggingTopology, referenceRigging } from "../src/physics/topology.js";

function fixture() {
  const a = {
    positionLin: new Float64Array(3),
    positionAng: new Float64Array([0, 0, 0, 1]),
    size: new Float64Array([1, 1, 1]),
  };
  const b = {
    positionLin: new Float64Array([0, 0, 0.75]),
    positionAng: new Float64Array([0, 0, 0, 1]),
    size: new Float64Array([1, 1, 1]),
  };
  const model = {
    solver: { bodies: [a, b] },
    bodyIndices: new Uint32Array([0]),
    localPositions: new Float32Array(3),
    secondaryCount: 1,
    proxies: [{ index: 1, body: b, name: "wall" }],
  } as unknown as IRiggingModel;
  const data = new Float32Array(80);
  data[7] = 1;
  data[42] = 0.75;
  data[47] = 1;
  return { model, data };
}

describe("actual box/box proxy observations", () => {
  it("measures contact separation on the simulated boxes", () => {
    const f = fixture();
    expect(measureProxyPenetration(f.model, f.data)).toBeCloseTo(0.25, 6);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a nonfinite proxy pose instead of reporting zero penetration (%s)",
    (value) => {
      const f = fixture();
      f.data[40] = value;
      f.data[41] = value;
      f.data[42] = value;
      expect(() => measureProxyPenetration(f.model, f.data)).toThrow(/TN_AVBD_MEASUREMENT/);
    },
  );
  it("rejects a malformed sampled body array by name", () => {
    const f = fixture();
    expect(() => riggingPositions(f.model, null as unknown as Float32Array)).toThrow(
      /TN_AVBD_MEASUREMENT/,
    );
  });
});

describe("common candidate/baseline sail observations", () => {
  it("uses the same authored edge error for a known ten percent elongation", () => {
    const topology = buildRiggingTopology(referenceRigging());
    const sail = topology.ranges.find((range) => range.name === "sail");
    if (sail === undefined) throw new Error("test sail missing");
    const positions = topology.positions.slice(sail.offset * 3, (sail.offset + sail.count) * 3);
    for (let vertex = 0; vertex < sail.count; vertex++) {
      const x = positions[vertex * 3];
      const y = positions[vertex * 3 + 1];
      if (x === undefined || y === undefined) throw new Error("test vertex missing");
      positions[vertex * 3] = x * 1.1;
      positions[vertex * 3 + 1] = y * 1.1;
    }
    const measured = measureSailPositions(topology, positions);
    expect(measured.sailStretchP95).toBeCloseTo(0.1, 5);
    expect(measured.sailEdgeErrorP95).toBeCloseTo(0.1, 5);
  });
  it("rejects missing/nonfinite sail samples instead of assigning rest rope positions", () => {
    const topology = buildRiggingTopology(referenceRigging());
    expect(() => measureSailPositions(topology, new Float32Array(3))).toThrow(
      /TN_RIGGING_MEASUREMENT/,
    );
    const data = new Float32Array(32 * 32 * 3);
    data[0] = Number.NaN;
    expect(() => measureSailPositions(topology, data)).toThrow(/TN_RIGGING_MEASUREMENT/);
  });
});
