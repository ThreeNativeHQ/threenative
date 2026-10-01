import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxGeometry, BufferGeometry, Mesh, MeshStandardMaterial } from "three";
import { Brush, Evaluator } from "three-bvh-csg";
import { evaluateSolid } from "../dist/csg.js";
import { writeSolidGlb } from "../dist/export-glb.js";

function operands(t) {
  const material = new MeshStandardMaterial();
  const left = new Mesh(new BoxGeometry(2, 2, 2), material);
  const right = new Mesh(new BoxGeometry(1, 3, 1), material);
  t.after(() => {
    left.geometry.dispose();
    right.geometry.dispose();
    material.dispose();
  });
  return { left, right, material };
}

for (const operation of ["toString", "constructor", "__proto__", "xor"]) {
  test(`rejects unsupported operation ${operation} before reaching the donor`, (t) => {
    const { left, right } = operands(t);
    t.mock.method(Evaluator.prototype, "evaluate", () => {
      throw new Error("unexpected donor call");
    });
    assert.throws(() => evaluateSolid(left, right, operation), /CSG unsupported operation/);
  });
}

test("releases all owned scratch resources when donor evaluation throws", (t) => {
  const { left, right } = operands(t);
  const disposed = new Set();
  const caches = new Set();
  const dispose = BufferGeometry.prototype.dispose;
  const disposeCache = Brush.prototype.disposeCacheData;
  t.mock.method(BufferGeometry.prototype, "dispose", function () {
    disposed.add(this);
    return dispose.call(this);
  });
  t.mock.method(Brush.prototype, "disposeCacheData", function () {
    caches.add(this);
    return disposeCache.call(this);
  });
  let scratch;
  t.mock.method(Evaluator.prototype, "evaluate", (a, b, _operation, target) => {
    scratch = [a, b, target];
    throw new Error("injected donor failure");
  });
  assert.throws(() => evaluateSolid(left, right, "subtract"), /injected donor failure/);
  assert.ok(scratch[2], "the caller must own the evaluation target before evaluation can throw");
  for (const brush of scratch) {
    assert.ok(disposed.has(brush.geometry));
    assert.ok(caches.has(brush));
  }
  assert.equal(disposed.has(left.geometry), false);
  assert.equal(disposed.has(right.geometry), false);
});

test("output disposal is idempotent and shared operands remain reusable", (t) => {
  const { left, right, material } = operands(t);
  const before = Array.from(left.geometry.getAttribute("position").array);
  let sourceDisposals = 0;
  for (const resource of [left.geometry, right.geometry, material])
    resource.addEventListener("dispose", () => sourceDisposals++);
  const first = evaluateSolid(left, right, "subtract");
  let resultDisposals = 0;
  first.mesh.geometry.addEventListener("dispose", () => resultDisposals++);
  first.dispose();
  first.dispose();
  assert.equal(resultDisposals, 1);
  const second = evaluateSolid(left, right, "subtract");
  try {
    assert.ok(second.mesh.geometry.index.count > 0);
    assert.deepEqual(Array.from(left.geometry.getAttribute("position").array), before);
    assert.equal(sourceDisposals, 0);
  } finally {
    second.dispose();
  }
});

test("an empty intersection cannot masquerade as an exported source mesh", async (t) => {
  const { left, right } = operands(t);
  right.position.x = 10;
  const result = evaluateSolid(left, right, "intersect");
  t.after(() => result.dispose());
  assert.equal(result.mesh.geometry.index.count, 0);
  await assert.rejects(writeSolidGlb(result.mesh), /CSG result is empty/);
});
