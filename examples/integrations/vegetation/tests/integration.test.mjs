import assert from "node:assert/strict";
import { test } from "node:test";
import { NodeIO } from "@gltf-transform/core";
import { BoxGeometry, Matrix4, Mesh, MeshStandardMaterial, Object3D, Vector3 } from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { treeToGlb } from "../dist/export.js";
import { createTreeWind } from "../dist/render/wind.js";
import { generateTree } from "../dist/tree.js";
import { windSample } from "../src/geometry.ts";
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
/** Tree-space y range over every vertex of both meshes: the line the weight is measured on. */
function treeExtent(meshes) {
  const extent = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      if (y < extent[0]) extent[0] = y;
      if (y > extent[1]) extent[1] = y;
    }
  }
  return extent;
}
/** Assert one mesh's baked weight is that closed form everywhere, and report its own extremes. */
function scanBakedWeight(mesh, weightOf, role) {
  const position = mesh.geometry.getAttribute("position");
  const weight = mesh.geometry.getAttribute("_wind");
  assert.ok(weight, `${role} needs a _wind attribute`);
  assert.equal(weight.itemSize, 1);
  assert.equal(weight.count, position.count);
  const values = [...weight.array];
  // fround because the attribute is float32 and the expectation is float64.
  for (let i = 0; i < weight.count; i++)
    assert.equal(weight.getX(i), Math.fround(weightOf(position.getY(i))));
  console.log(
    `  ${role}: ${weight.count} vertices, weight ${Math.min(...values).toFixed(4)}..${Math.max(...values).toFixed(4)}`,
  );
  return values;
}
test("generated trees bake a tree-space wind weight that bark and leaves share", () => {
  const trunk = new MeshStandardMaterial();
  const leaf = new MeshStandardMaterial();
  const variant = tree(42, trunk, leaf);
  try {
    const [bark, leaves] = variant.root.children;
    const [minY, maxY] = treeExtent([bark, leaves]);
    assert.equal(variant.height, maxY - minY);
    // The two meshes share one tree-space line, so a bark vertex and a leaf vertex at the same
    // tree-space height carry the same weight. Scanning every vertex against that one closed form
    // is how that is checked: the meshes never place a vertex at one identical float height, so
    // the per-vertex identity is the decidable form of the claim.
    const weightOf = (y) => Math.min(1, Math.max(0, (y - minY) / (maxY - minY)));
    const all = [
      ...scanBakedWeight(bark, weightOf, "bark"),
      ...scanBakedWeight(leaves, weightOf, "leaves"),
    ];
    // The tree's own extremes are the ends of the range, and a root never moves.
    assert.equal(Math.min(...all), 0);
    assert.equal(Math.max(...all), 1);
    // A picked leaf vertex, computed the way the shader reads it.
    const leafY = leaves.geometry.getAttribute("position").getY(0);
    assert.equal(leaves.geometry.getAttribute("_wind").getX(0), Math.fround(weightOf(leafY)));
    console.log(
      `  leaf vertex 0 at tree-space y ${leafY.toFixed(3)} weighs ${weightOf(leafY).toFixed(6)}`,
    );
  } finally {
    variant.dispose();
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
  const settings = { amplitude: 2, frequency: 1, phase: 0, height: 4, direction: [1, 0] };
  const wind = createTreeWind(base, settings);
  try {
    assert.ok(wind.material.positionNode.isNode);
    // A shadow-only vertex path would win the shadow pass and leave shadows still in the wind.
    const shadowed = new MeshStandardNodeMaterial();
    shadowed.castShadowPositionNode = wind.material.positionNode;
    assert.throws(() => createTreeWind(shadowed, settings), /unmodified vertex path/);
    shadowed.dispose();
    assert.equal(base.positionNode, null);
    // No default scale: a cooked mesh carries its quantization scale on the node, so 1 is a guess.
    assert.throws(() => wind.expandBounds(geometry), /scale/);
    wind.expandBounds(geometry, 1);
    const box = geometry.boundingBox;
    const sphere = geometry.boundingSphere;
    wind.expandBounds(geometry, 1);
    assert.equal(geometry.boundingSphere.radius, sphere.radius);
    // Direction is world space, so a yawed clone sways along any local horizontal axis.
    for (const axis of ["x", "z"]) {
      assert.equal(geometry.boundingBox.max[axis], 0.5 + 2);
      assert.equal(geometry.boundingBox.min[axis], -0.5 - 2);
    }
    // Bounds are the LOD levels' own objects, so they are padded in place, not replaced.
    assert.equal(geometry.boundingBox, box);
    assert.equal(geometry.boundingSphere, sphere);
    // A node scaled up divides the world-metre amplitude down into local units.
    wind.expandBounds(geometry, 4);
    assert.equal(geometry.boundingBox.max.x, 0.5 + 0.5);
    wind.expandBounds(geometry, 0.5);
    assert.equal(geometry.boundingBox.max.x, 0.5 + 4);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      assert.throws(() => wind.expandBounds(geometry, bad), /scale/);
    assert.throws(() => wind.updateTime(Number.NaN));
    wind.updateTime(1);
  } finally {
    wind.dispose();
    base.dispose();
    geometry.dispose();
  }
});
/**
 * The culling proof: a swayed vertex is inside the bounds the game uploaded, whatever the cook
 * and the placement did to the node. Every vertex, on both meshes, at 200 simulation times, for
 * yaw, a uniform world scale and a cook-style extra node scale.
 */
/** One mesh, 200 simulation times, every vertex: swayed points stay inside the uploaded bounds. */
function sweepMesh(wind, mesh, options, label) {
  const { geometry, matrixWorld } = mesh;
  const minWorldScale = Math.min(...new Vector3().setFromMatrixScale(matrixWorld).toArray());
  wind.expandBounds(geometry, minWorldScale);
  const position = geometry.getAttribute("position");
  const weight = geometry.getAttribute("_wind");
  const inverse = new Matrix4().copy(matrixWorld).invert();
  const before = new Vector3();
  const after = new Vector3();
  const swing = new Vector3();
  for (let step = 0; step < 200; step++) {
    const time = (step / 199) * 10;
    for (let i = 0; i < position.count; i++) {
      const { offset } = windSample(weight.getX(i), time, options);
      swing.set(options.direction[0] * offset, 0, options.direction[1] * offset);
      before.fromBufferAttribute(position, i);
      after.copy(before).add(swing.applyMatrix4(inverse));
      assert.ok(
        geometry.boundingBox.containsPoint(after),
        `${label} vertex ${i} left the box (minWorldScale ${minWorldScale})`,
      );
      assert.ok(
        after.distanceTo(geometry.boundingSphere.center) <= geometry.boundingSphere.radius + 1e-6,
        `${label} vertex ${i} left the sphere`,
      );
      // And the sway itself is world metres, whatever the node scales are.
      assert.ok(after.sub(before).applyMatrix4(matrixWorld).length() <= options.amplitude + 1e-9);
    }
  }
  return 200 * position.count;
}
test("wind stays inside expandBounds under yaw, uniform scale and a cook-style node scale", () => {
  const trunk = new MeshStandardMaterial();
  const leaf = new MeshStandardMaterial();
  const variant = tree(42, trunk, leaf);
  const base = new MeshStandardNodeMaterial();
  const options = {
    amplitude: 0.35,
    frequency: 1.7,
    phase: 0.4,
    height: variant.height,
    direction: [0.8, 0.6],
  };
  const wind = createTreeWind(base, options);
  try {
    let checked = 0;
    for (const yaw of [0, 1.1, 2.7]) {
      for (const scale of [0.5, 1, 2.3]) {
        for (const nodeScale of [1, 7]) {
          const scene = new Object3D();
          const root = variant.root.clone();
          root.rotation.y = yaw;
          root.scale.setScalar(scale);
          // The cook's dequantization scale lands on a child node, not on the placement.
          root.children[1].scale.setScalar(nodeScale);
          scene.add(root);
          scene.updateMatrixWorld(true);
          for (const mesh of root.children)
            checked += sweepMesh(
              wind,
              mesh,
              options,
              `yaw ${yaw} scale ${scale} node ${nodeScale}`,
            );
        }
      }
    }
    assert.ok(checked > 100_000, `expected a real sweep, only checked ${checked}`);
    console.log(`  culling proof checked ${checked} swayed vertices`);
  } finally {
    wind.dispose();
    base.dispose();
    variant.dispose();
    trunk.dispose();
    leaf.dispose();
  }
});
const ROLES = ["branches", "leaves"];
const SEMANTICS = [
  ["POSITION", "position"],
  ["NORMAL", "normal"],
  ["TEXCOORD_0", "uv"],
  ["_WIND", "_wind"],
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
