import assert from "node:assert/strict";
import { test } from "node:test";
import { NodeIO } from "@gltf-transform/core";
import validator from "gltf-validator";
import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { evaluateSolid } from "../dist/csg.js";
import { writeSolidGlb } from "../dist/export-glb.js";

function box(t) {
  const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial());
  mesh.geometry.clearGroups();
  t.after(() => {
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      material.dispose();
  });
  return mesh;
}

async function validate(bytes) {
  const report = await validator.validateBytes(bytes, { uri: "csg.glb", maxIssues: 0 });
  assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages));
  assert.equal(report.issues.truncated, false);
  return new NodeIO().readBinary(bytes);
}

async function reload(t, bytes) {
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  gltf.scene.updateMatrixWorld(true);
  t.after(() => {
    gltf.scene.traverse((node) => {
      if (!node.isMesh) return;
      node.geometry.dispose();
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        material.dispose();
    });
  });
  return gltf.scene;
}

test("single-material meshes ignore geometry material indices, as Three.js does", async (t) => {
  const mesh = box(t);
  mesh.geometry.addGroup(0, 18, 0);
  mesh.geometry.addGroup(18, 18, 5);
  const document = await validate(await writeSolidGlb(mesh));
  const primitives = document.getRoot().listMeshes()[0].listPrimitives();
  assert.equal(
    primitives.reduce((sum, p) => sum + p.getIndices().getCount(), 0),
    36,
  );
  assert.ok(primitives.every((p) => p.getMaterial() === primitives[0].getMaterial()));
});

test("mirrored world transforms retain outward winding after GLB reload", async (t) => {
  const mesh = box(t);
  mesh.scale.x = -1;
  const bytes = await writeSolidGlb(mesh);
  await validate(bytes);
  const scene = await reload(t, bytes);
  const hits = new Raycaster(new Vector3(0, 0, 3), new Vector3(0, 0, -1)).intersectObject(
    scene,
    true,
  );
  assert.ok(hits.length > 0);
  assert.ok(Math.abs(hits[0].distance - 2) < 1e-6, "the front face must not be culled");
});

for (const [name, size] of [
  ["normal", 4],
  ["uv", 3],
  ["color", 2],
]) {
  test(`rejects invalid ${name} layout instead of writing invalid glTF`, async (t) => {
    const mesh = box(t);
    mesh.geometry.setAttribute(name, new BufferAttribute(new Float32Array(24 * size), size));
    await assert.rejects(writeSolidGlb(mesh), new RegExp(`${name}.*layout`));
  });
}

for (const name of ["tangent", "toString", "constructor"]) {
  test(`rejects unadmitted semantic ${name}`, async (t) => {
    const mesh = box(t);
    mesh.geometry.setAttribute(name, new BufferAttribute(new Float32Array(24 * 3), 3));
    await assert.rejects(writeSolidGlb(mesh), /no admitted glTF semantic/);
  });
}

for (const [name, value] of [
  ["metalness", -0.1],
  ["roughness", 1.1],
  ["opacity", 1.1],
  ["alphaTest", Number.NaN],
]) {
  test(`rejects invalid material factor ${name}`, async (t) => {
    const mesh = box(t);
    mesh.material[name] = value;
    await assert.rejects(writeSolidGlb(mesh), /CSG export material.*factor/);
  });
}

test("rejects emissive factors needing an unsupported strength extension", async (t) => {
  const mesh = box(t);
  mesh.material.emissive.setRGB(0.75, 0, 0);
  mesh.material.emissiveIntensity = 2;
  await assert.rejects(writeSolidGlb(mesh), /CSG export material.*factor/);
});

test("rejects BackSide rather than silently exporting FrontSide", async (t) => {
  const mesh = box(t);
  mesh.material.side = BackSide;
  await assert.rejects(writeSolidGlb(mesh), /BackSide/);
});

test("rejects coordinates that overflow glTF float32 storage", async (t) => {
  const mesh = box(t);
  const source = new Float64Array(mesh.geometry.getAttribute("position").array);
  source[0] = 1e39;
  mesh.geometry.setAttribute("position", new BufferAttribute(source, 3));
  await assert.rejects(writeSolidGlb(mesh), /finite float32/);
});

test("normalized vertex colors survive export without mutating input", async (t) => {
  const mesh = box(t);
  mesh.material.vertexColors = true;
  const colors = new Uint8Array(24 * 4);
  for (let i = 0; i < 24; i++) colors.set([255, 128, 0, 255], i * 4);
  mesh.geometry.setAttribute("color", new BufferAttribute(colors, 4, true));
  const document = await validate(await writeSolidGlb(mesh));
  const color = document.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute("COLOR_0");
  assert.deepEqual(Array.from(color.getArray().slice(0, 4)), [1, Math.fround(128 / 255), 0, 1]);
  assert.deepEqual(Array.from(colors.slice(0, 4)), [255, 128, 0, 255]);
});

test("doorway survives Khronos validation and the actual Three.js GLTFLoader", async (t) => {
  const wall = box(t);
  wall.geometry.dispose();
  wall.geometry = new BoxGeometry(4, 3, 0.3);
  wall.position.y = 1.5;
  const cutter = box(t);
  cutter.geometry.dispose();
  cutter.geometry = new BoxGeometry(1, 2.2, 1);
  cutter.position.y = 0.9;
  const result = evaluateSolid(wall, cutter, "subtract");
  t.after(() => result.dispose());
  const bytes = await writeSolidGlb(result.mesh);
  await validate(bytes);
  const scene = await reload(t, bytes);
  const hit = (x) =>
    new Raycaster(new Vector3(x, 1, 2), new Vector3(0, 0, -1)).intersectObject(scene, true).length >
    0;
  assert.equal(hit(0), false);
  assert.equal(hit(1.5), true);
});

for (const indexed of [true, false]) {
  test(`active triangles and two materials survive GLB export (indexed=${indexed})`, async (t) => {
    const mesh = box(t);
    if (!indexed) {
      const geometry = mesh.geometry.toNonIndexed();
      mesh.geometry.dispose();
      mesh.geometry = geometry;
    }
    const outer = mesh.material;
    outer.name = "outer";
    const inner = new MeshStandardMaterial({ color: 0x804020 });
    inner.name = "inner";
    mesh.material = [outer, inner];
    mesh.geometry.addGroup(0, 18, 0);
    mesh.geometry.addGroup(18, 18, 1);
    mesh.geometry.setDrawRange(6, 24);
    const original = Array.from(mesh.geometry.getAttribute("position").array);
    const document = await validate(await writeSolidGlb(mesh));
    const primitives = document.getRoot().listMeshes()[0].listPrimitives();
    assert.deepEqual(
      primitives.map((p) => p.getIndices().getCount()),
      [12, 12],
    );
    assert.deepEqual(
      primitives.map((p) => p.getMaterial().getName()),
      ["outer", "inner"],
    );
    assert.deepEqual(Array.from(mesh.geometry.getAttribute("position").array), original);
    assert.deepEqual(mesh.geometry.drawRange, { start: 6, count: 24 });
  });
}

test("disabled vertex colors stay disabled through GLB reload", async (t) => {
  const mesh = box(t);
  mesh.geometry.addGroup(0, 18, 0);
  mesh.geometry.addGroup(18, 18, 5);
  const colors = new Uint8Array(24 * 3).fill(128);
  const attribute = new BufferAttribute(colors, 3, true);
  mesh.geometry.setAttribute("color", attribute);
  const bytes = await writeSolidGlb(mesh);
  const document = await validate(bytes);
  const primitives = document.getRoot().listMeshes()[0].listPrimitives();
  assert.deepEqual(
    primitives.map((primitive) => primitive.getAttribute("COLOR_0")),
    [null, null],
  );
  const scene = await reload(t, bytes);
  let meshes = 0;
  scene.traverse((node) => {
    if (!node.isMesh) return;
    meshes++;
    assert.equal(node.material.vertexColors, false);
    assert.equal(node.geometry.getAttribute("color"), undefined);
  });
  assert.ok(meshes > 0);
  assert.equal(mesh.material.vertexColors, false);
  assert.equal(mesh.geometry.getAttribute("color"), attribute);
  assert.ok(colors.every((value) => value === 128));
});

for (const indexed of [true, false]) {
  test(`mixed material vertex-color flags survive GLB reload (indexed=${indexed})`, async (t) => {
    const mesh = box(t);
    if (!indexed) {
      const geometry = mesh.geometry.toNonIndexed();
      mesh.geometry.dispose();
      mesh.geometry = geometry;
    }
    const plain = mesh.material;
    plain.name = "plain";
    const painted = new MeshStandardMaterial({ vertexColors: true });
    painted.name = "painted";
    mesh.material = [plain, painted];
    mesh.geometry.addGroup(0, 18, 0);
    mesh.geometry.addGroup(18, 18, 1);
    const count = mesh.geometry.getAttribute("position").count;
    const colors = new Uint8Array(count * 3).fill(128);
    const attribute = new BufferAttribute(colors, 3, true);
    mesh.geometry.setAttribute("color", attribute);
    const bytes = await writeSolidGlb(mesh);
    const document = await validate(bytes);
    const primitives = document.getRoot().listMeshes()[0].listPrimitives();
    assert.deepEqual(
      primitives.map((primitive) => primitive.getAttribute("COLOR_0") !== null),
      [false, true],
    );
    assert.deepEqual(
      primitives.map((primitive) => primitive.getIndices().getCount()),
      [18, 18],
    );
    const scene = await reload(t, bytes);
    const observed = {};
    scene.traverse((node) => {
      if (!node.isMesh) return;
      observed[node.material.name] = node.material.vertexColors;
      assert.equal(node.geometry.getAttribute("color") !== undefined, node.material.vertexColors);
    });
    assert.deepEqual(observed, { plain: false, painted: true });
    assert.equal(plain.vertexColors, false);
    assert.equal(painted.vertexColors, true);
    assert.equal(mesh.geometry.getAttribute("color"), attribute);
    assert.ok(colors.every((value) => value === 128));
  });
}
