import assert from "node:assert/strict";
import test from "node:test";
import { SearchController } from "../src/search.ts";
const make = () => new SearchController({ memorySeconds: 3, arrivalDistance: 0.5 });
const at = [0, 0, 0];
const seen = { id: "player", position: [4, 0, 0] };
test("starts patrolling and acquires only observed positions", () => {
  const brain = make();
  assert.equal(brain.step(0, at, null).state, "patrol");
  const result = brain.step(0.1, at, seen);
  assert.equal(result.state, "chase");
  assert.deepEqual(result.destination, [4, 0, 0]);
});
test("occluded search retains a copied last-seen position", () => {
  const brain = make();
  const observation = { id: "player", position: [4, 0, 0] };
  brain.step(0.1, at, observation);
  observation.position[0] = 99;
  const result = brain.step(1, at, null);
  assert.equal(result.state, "search");
  assert.deepEqual(result.destination, [4, 0, 0]);
});
test("expires memory at the exact simulation-time boundary", () => {
  const brain = make();
  brain.step(0, at, seen);
  assert.equal(brain.step(2.999, at, null).state, "search");
  const result = brain.step(0.001, at, null);
  assert.equal(result.state, "patrol");
  assert.equal(result.destination, null);
  assert.equal(result.targetId, null);
});
test("zero dt pauses memory age", () => {
  const brain = make();
  brain.step(0, at, seen);
  brain.step(2, at, null);
  for (let i = 0; i < 10; i++) assert.equal(brain.step(0, at, null).state, "search");
  assert.equal(brain.step(1, at, null).state, "patrol");
});
test("arrival clears the remembered destination without moving the body", () => {
  const brain = make();
  brain.step(0, at, seen);
  const position = [3.6, 0, 0];
  const result = brain.step(0.1, position, null);
  assert.equal(result.state, "patrol");
  assert.equal(result.destination, null);
  assert.deepEqual(position, [3.6, 0, 0]);
});
test("reacquisition refreshes memory and identifies target switches", () => {
  const brain = make();
  brain.step(0, at, seen);
  brain.step(2, at, null);
  const result = brain.step(0.1, at, { id: "second", position: [5, 0, 0] });
  assert.equal(result.targetId, "second");
  assert.equal(result.changed, true);
  assert.equal(brain.step(2, at, null).state, "search");
});
test("invalid input does not advance simulation time or alter memory", () => {
  const brain = make();
  brain.step(0, at, seen);
  assert.throws(() => brain.step(2.9, at, { id: "x", position: [Number.NaN, 0, 0] }));
  assert.throws(() => brain.step(-1, at, null));
  assert.throws(() => brain.step(Number.POSITIVE_INFINITY, at, null));
  assert.equal(brain.step(0.2, at, null).state, "search");
});
test("forget clears deleted targets and output cannot mutate internal memory", () => {
  const brain = make();
  const result = brain.step(0, at, seen);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.destination));
  brain.forget();
  assert.equal(brain.step(0, at, null).targetId, null);
});
test("fixed input produces identical decision traces", () => {
  const run = () => {
    const brain = make();
    return [brain.step(0.2, at, seen), brain.step(0.2, at, null), brain.step(3, at, null)];
  };
  assert.deepEqual(run(), run());
});
test("rejects invalid settings and updates after disposal", () => {
  for (const memorySeconds of [-1, 0, Number.NaN])
    assert.throws(() => new SearchController({ memorySeconds, arrivalDistance: 0.5 }));
  const brain = make();
  brain.dispose();
  brain.dispose();
  assert.throws(() => brain.step(0, at, null), /disposed/);
});

test("sparse observations are rejected before changing last-seen memory", () => {
  for (let axis = 0; axis < 3; axis++) {
    const brain = make();
    brain.step(0, at, seen);
    const position = [9, 9, 9];
    Reflect.deleteProperty(position, axis);
    assert.throws(() => brain.step(2.9, at, { id: "invalid", position }), /finite vec3/);
    const result = brain.step(0.2, at, null);
    assert.equal(result.state, "search");
    assert.equal(result.targetId, "player");
    assert.deepEqual(result.destination, seen.position);
  }
});
test("missing observer coordinates fail before advancing the memory clock", () => {
  const missing = Array(3);
  for (const position of [missing, null, undefined]) {
    const brain = make();
    brain.step(0, at, seen);
    assert.throws(() => brain.step(2.9, position, null), /finite vec3/);
    const result = brain.step(0.2, at, null);
    assert.equal(result.state, "search");
    assert.deepEqual(result.destination, seen.position);
  }
});
