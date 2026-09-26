import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxGeometry, Mesh, MeshStandardMaterial } from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { createTreeWind } from "../dist/render/wind.js";
import { generateTree } from "../dist/tree.js";
const configure = (o) => {
  o.branch.levels = 1;
  o.branch.children[0] = 2;
  o.leaves.count = 2;
};
function tree(seed, trunk, leaf) {
  return generateTree({
    seed,
    configure,
    trunkMaterial: trunk,
    leafMaterial: leaf,
    maxVertices: 200000,
  });
}
function positions(root) {
  const values = [];
  root.traverse((o) => {
    if (o instanceof Mesh) values.push(...o.geometry.getAttribute("position").array);
  });
  return values;
}
test("actual EZ Tree produces reproducible geometry with game-owned materials", () => {
  const trunk = new MeshStandardMaterial();
  const leaf = new MeshStandardMaterial();
  let disposed = 0;
  trunk.addEventListener("dispose", () => disposed++);
  const a = tree(42, trunk, leaf);
  const b = tree(42, trunk, leaf);
  const c = tree(43, trunk, leaf);
  try {
    assert.deepEqual(positions(a.root), positions(b.root));
    assert.notDeepEqual(positions(a.root), positions(c.root));
    assert.ok(a.vertices > 0);
  } finally {
    a.dispose();
    a.dispose();
    b.dispose();
    c.dispose();
    assert.equal(disposed, 0);
    trunk.dispose();
    leaf.dispose();
  }
});
test("generation budget fails before enormous recursion", () => {
  const material = new MeshStandardMaterial();
  try {
    assert.throws(
      () =>
        generateTree({
          seed: 1,
          trunkMaterial: material,
          leafMaterial: material,
          maxVertices: 100,
          configure,
        }),
      /budget/,
    );
  } finally {
    material.dispose();
  }
});
test("wind material has a TSL graph and stable conservative bounds", () => {
  const base = new MeshStandardNodeMaterial();
  const geometry = new BoxGeometry(1, 4, 1);
  const wind = createTreeWind(base, {
    amplitude: 2,
    frequency: 1,
    phase: 0,
    base: 0,
    extent: 4,
    direction: [1, 0],
  });
  try {
    assert.ok(wind.material.positionNode.isNode);
    assert.equal(base.positionNode, null);
    wind.expandBounds(geometry);
    const radius = geometry.boundingSphere.radius;
    wind.expandBounds(geometry);
    assert.equal(geometry.boundingSphere.radius, radius);
    assert.throws(() => wind.updateTime(Number.NaN));
    wind.updateTime(1);
  } finally {
    wind.dispose();
    base.dispose();
    geometry.dispose();
  }
});
