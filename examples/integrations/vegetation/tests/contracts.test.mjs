import assert from "node:assert/strict";
import { test } from "node:test";
import { safeIndices, validateWind, windSample } from "../src/geometry.ts";
const settings = {
  amplitude: 2,
  frequency: 1,
  phase: Math.PI / 2,
  height: 4,
  direction: [1, 0],
};
test("keeps index 65535 in uint16", () => {
  const a = safeIndices([0, 1, 65535], 65536);
  assert.ok(a instanceof Uint16Array);
  assert.equal(a[2], 65535);
});
test("promotes raw index 65536 before truncation", () => {
  const a = safeIndices([0, 1, 65536], 65537);
  assert.ok(a instanceof Uint32Array);
  assert.equal(a[2], 65536);
});
test("rejects fractional, negative, nonfinite and out-of-range indices", () => {
  for (const i of [0.1, -1, Number.NaN, Number.POSITIVE_INFINITY, 10])
    assert.throws(() => safeIndices([0, 1, i], 10));
});
test("rejects partial triangles", () => {
  assert.throws(() => safeIndices([0, 1], 3), /triangle/);
});
test("copies raw indices instead of aliasing", () => {
  const a = [0, 1, 2];
  const out = safeIndices(a, 3);
  a[0] = 2;
  assert.equal(out[0], 0);
});
test("roots do not move; tips stay within the authored amplitude", () => {
  assert.equal(windSample(0, 0, settings).offset, 0);
  assert.equal(windSample(0, 0, settings).slope, 0);
  assert.equal(windSample(1, 0, settings).offset, 2);
});
test("analytic slope is d(offset)/d(world height)", () => {
  const h = 1e-5;
  for (const weight of [0.1, 0.3, 0.5, 0.9]) {
    // The weight is a share of the tree, so world height is weight * height, in metres.
    const atHeight = (y) => windSample(y / settings.height, 0, settings).offset;
    const f = windSample(weight, 0, settings);
    const derivative =
      (atHeight(weight * settings.height + h) - atHeight(weight * settings.height - h)) / (2 * h);
    assert.ok(Math.abs(f.slope - derivative) < 1e-8);
  }
});
test("a taller tree bends less for the same weight", () => {
  const tall = windSample(0.5, 0, { ...settings, height: settings.height * 4 });
  assert.equal(tall.offset, windSample(0.5, 0, settings).offset);
  assert.equal(tall.slope, windSample(0.5, 0, settings).slope / 4);
});
test("wind is deterministic and bounded over a time series", () => {
  for (let i = 0; i < 500; i++) {
    const a = windSample(0.75, i / 60, settings);
    assert.deepEqual(a, windSample(0.75, i / 60, settings));
    assert.ok(Math.abs(a.offset) <= settings.amplitude);
  }
});
test("validates and normalizes a caller-owned direction", () => {
  const s = { ...settings, direction: [3, 4] };
  const result = validateWind(s);
  s.direction[0] = 99;
  assert.deepEqual(result.direction, [0.6, 0.8]);
});
test("rejects bad wind settings and nonfinite simulation time", () => {
  for (const change of [
    { height: 0 },
    { height: -1 },
    { height: Number.NaN },
    { amplitude: Number.NaN },
    { direction: [0, 0] },
    { frequency: -1 },
  ])
    assert.throws(() => validateWind({ ...settings, ...change }));
  assert.throws(() => windSample(1, Number.NaN, settings));
});
test("rejects a weight outside the baked [0, 1] range instead of clamping it", () => {
  for (const weight of [-0.001, 1.001, Number.NaN, Number.POSITIVE_INFINITY])
    assert.throws(() => windSample(weight, 0, settings), /_wind/);
});
