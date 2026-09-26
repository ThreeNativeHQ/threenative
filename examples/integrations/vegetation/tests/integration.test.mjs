import assert from "node:assert/strict";
import { test } from "node:test";
import { NodeIO } from "@gltf-transform/core";
import { BoxGeometry, Mesh, MeshStandardMaterial } from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { treeToGlb } from "../dist/export.js";
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
  // The donor's own materials are unreachable from outside generateTree, so observe their
  // disposal the only honest way: the spy records the instance every dispose() call receives.
  const donor = [];
  const release = MeshStandardMaterial.prototype.dispose;
  MeshStandardMaterial.prototype.dispose = function (...args) {
    donor.push(this);
    return release.apply(this, args);
  };
  const a = tree(42, trunk, leaf);
  const b = tree(42, trunk, leaf);
  const c = tree(43, trunk, leaf);
  try {
    assert.deepEqual(positions(a.root), positions(b.root));
    assert.notDeepEqual(positions(a.root), positions(c.root));
    assert.ok(a.vertices > 0);
    // One donor material per donor mesh, and none of them the caller's.
    assert.equal(donor.length, 6);
    assert.ok(donor.every((m) => m !== trunk && m !== leaf));
    // Forests place variants by clone(); a clone must hold exactly the two game-material meshes.
    const meshes = [];
    a.root.clone().traverse((o) => o instanceof Mesh && meshes.push(o));
    assert.deepEqual(
      meshes.map((m) => m.material),
      [trunk, leaf],
    );
  } finally {
    MeshStandardMaterial.prototype.dispose = release;
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
    // Direction is world space, so a yawed clone sways along any local horizontal axis.
    for (const axis of ["x", "z"]) {
      assert.equal(geometry.boundingBox.max[axis], 0.5 + 2);
      assert.equal(geometry.boundingBox.min[axis], -0.5 - 2);
    }
    assert.throws(() => wind.updateTime(Number.NaN));
    wind.updateTime(1);
  } finally {
    wind.dispose();
    base.dispose();
    geometry.dispose();
  }
});
const ROLES = ["branches", "leaves"];
const SEMANTICS = [
  ["POSITION", "position"],
  ["NORMAL", "normal"],
  ["TEXCOORD_0", "uv"],
];
function assertRoundTrips(variant, read, expectUint32) {
  const root = read.getRoot().getDefaultScene().listChildren()[0];
  assert.equal(root.getName(), "Tree");
  const nodes = root.listChildren();
  assert.deepEqual(
    nodes.map((n) => n.getName()),
    ROLES,
  );
  assert.deepEqual(
    nodes.map((n) => n.getMesh().getName()),
    ROLES,
  );
  for (const [i, role] of ROLES.entries()) {
    const primitive = nodes[i].getMesh().listPrimitives()[0];
    const material = primitive.getMaterial();
    assert.equal(material.getName(), role === "branches" ? "bark" : "leaf");
    assert.equal(material.getAlphaMode(), role === "branches" ? "OPAQUE" : "MASK");
    assert.equal(material.getDoubleSided(), role === "leaves");
    if (role === "leaves") assert.equal(material.getAlphaCutoff(), 0.5);
    const geometry = variant.root.children[i].geometry;
    for (const [semantic, name] of SEMANTICS) {
      const exported = primitive.getAttribute(semantic).getArray();
      const source = geometry.getAttribute(name).array;
      assert.equal(exported.constructor, source.constructor, `${role}/${semantic} component type`);
      assert.deepEqual(exported, source, `${role}/${semantic} values`);
    }
    const indices = primitive.getIndices().getArray();
    assert.equal(indices.constructor, expectUint32 ? Uint32Array : Uint16Array);
    assert.deepEqual(indices, geometry.index.array, `${role} indices`);
  }
}
test("a variant exports one binary glTF that reads back element-for-element", async () => {
  const trunk = new MeshStandardMaterial();
  const leaf = new MeshStandardMaterial();
  const variant = tree(42, trunk, leaf);
  try {
    const glb = await treeToGlb(variant);
    // The same seed must author the same bytes, or the export is not reproducible.
    assert.deepEqual(Buffer.from(glb), Buffer.from(await treeToGlb(variant)));
    const read = await new NodeIO().readBinary(glb);
    assert.equal(read.getRoot().listScenes().length, 1);
    assertRoundTrips(variant, read, false);
  } finally {
    variant.dispose();
    trunk.dispose();
    leaf.dispose();
  }
});
test("over 65535 vertices the export promotes indices to uint32 and round-trips exactly", async () => {
  const trunk = new MeshStandardMaterial();
  const leaf = new MeshStandardMaterial();
  const variant = generateTree({
    seed: 7,
    configure: (o) => {
      o.branch.levels = 2;
      o.branch.children[0] = 7;
      o.branch.children[1] = 3;
      for (let level = 0; level <= 2; level++) {
        o.branch.sections[level] = 64;
        o.branch.segments[level] = 64;
      }
      o.leaves.count = 300;
    },
    trunkMaterial: trunk,
    leafMaterial: leaf,
    maxVertices: 1_000_000,
  });
  try {
    for (let i = 0; i < ROLES.length; i++)
      assert.ok(
        variant.root.children[i].geometry.getIndex().array instanceof Uint32Array,
        `${ROLES[i]} indices must be uint32`,
      );
    const glb = await treeToGlb(variant);
    assertRoundTrips(variant, await new NodeIO().readBinary(glb), true);
  } finally {
    variant.dispose();
    trunk.dispose();
    leaf.dispose();
  }
});
