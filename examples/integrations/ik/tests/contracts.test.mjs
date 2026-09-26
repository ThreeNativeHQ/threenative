import assert from "node:assert/strict";
import { test } from "node:test";
import { angularError, contactError, uniformScaleOf, validateTargets } from "../src/pose.ts";
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
test("accepts rigid translation and rotation", () => {
  const m = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1];
  assert.equal(uniformScaleOf(m), 1);
});
test("accepts positive uniform scale", () => {
  const m = identity();
  m[0] = m[5] = m[10] = 3;
  assert.equal(uniformScaleOf(m), 3);
});
test("rejects nonuniform scale and shear", () => {
  const m = identity();
  m[0] = 2;
  assert.throws(() => uniformScaleOf(m), /uniform/);
  const s = identity();
  s[4] = 0.2;
  assert.throws(() => uniformScaleOf(s), /uniform|shear/);
});
test("rejects reflected, singular and nonfinite transforms", () => {
  for (const x of [-1, 0, Number.NaN]) {
    const m = identity();
    m[0] = x;
    assert.throws(() => uniformScaleOf(m));
  }
});
test("quaternion sign and uniform magnitude do not change angular error", () => {
  assert.equal(angularError([0, 0, 0, 1], [0, 0, 0, -2]), 0);
});
test("reports angular and positional residuals in radians and metres", () => {
  assert.ok(Math.abs(angularError([0, 0, 0, 1], [0, 0, 1, 0]) - Math.PI) < 1e-12);
  assert.equal(contactError([0, 0, 0], [3, 4, 0]), 5);
});
test("rejects invalid quaternion rather than reporting zero error", () => {
  assert.throws(() => angularError([0, 0, 0, 0], [0, 0, 0, 1]));
  assert.throws(() => angularError([Number.NaN, 0, 0, 1], [0, 0, 0, 1]));
});
test("target validation copies caller-owned arrays", () => {
  const target = { position: [1, 2, 3], quaternion: [0, 0, 0, 1] };
  const r = validateTargets([target], 1);
  target.position[0] = 99;
  assert.equal(r[0].position[0], 1);
});
test("empty, missing and malformed targets fail closed", () => {
  assert.throws(() => validateTargets([], 0));
  assert.throws(() => validateTargets([], 1));
  assert.throws(() => validateTargets([{ position: [Number.NaN, 0, 0] }], 1));
});
