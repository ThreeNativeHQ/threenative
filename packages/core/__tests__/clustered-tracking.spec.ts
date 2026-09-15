import {
  BufferAttribute,
  BufferGeometry,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
} from "three";
import { describe, expect, it, vi } from "vitest";
import { ClusteredMesh, type IClusterTable, updateClusteredMeshes } from "../src/clustered-mesh.js";

// A Midway-class scene carries thousands of objects and zero clustered meshes, and the engine
// used to walk all of them every frame to discover nothing. These tests hold the replacement:
// lifecycle-aware tracking, where a static graph costs no traversal no matter how large it is,
// and every structural change is still seen.

/** One cluster, one triangle: the smallest table the constructor accepts. */
function tinyTable(): IClusterTable {
  return {
    bounds: new Float32Array([0, 0, 0, 1]),
    cones: new Float32Array([0, 0, 1, 0.5]),
    errors: new Float32Array([0, 1e30]),
    indices: new Uint32Array([0, 1, 2]),
    parentSpheres: new Float32Array([0, 0, 0, 1]),
    ranges: new Uint32Array([0, 3]),
    sourceSpheres: new Float32Array([0, 0, 0, 1]),
  };
}

function tinyMesh(): ClusteredMesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  );
  return new ClusteredMesh(geometry, new MeshBasicMaterial(), tinyTable());
}

/** A batch root without the bake: detection is structural, so a stub exercises the same path. */
function stubBatchRoot(triangles: number): Object3D {
  const root = new Object3D();
  (root as unknown as { batch: { update(): number } }).batch = { update: () => triangles };
  return root;
}

function camera(): PerspectiveCamera {
  const created = new PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  created.position.set(0, 0, 6);
  return created;
}

/** A Midway-shaped haystack: thousands of objects, nothing clustered. */
function haystack(objects: number): Object3D {
  const scene = new Object3D();
  for (let index = 0; index < objects; index += 1) scene.add(new Object3D());
  return scene;
}

describe("updateClusteredMeshes tracking", () => {
  it("an empty scene costs no traversal per frame, however large", () => {
    const scene = haystack(2000);
    const spy = vi.spyOn(scene, "traverse");
    const viewed = camera();

    expect(updateClusteredMeshes(scene, viewed, 1080)).toBe(0);
    const census = spy.mock.calls.length;
    for (let frame = 0; frame < 10; frame += 1)
      expect(updateClusteredMeshes(scene, viewed, 1080)).toBe(0);
    expect(spy.mock.calls.length).toBe(census);
  });

  it("a mesh added after the empty census is still found, with no rescan", () => {
    const scene = new Object3D();
    const viewed = camera();
    const spy = vi.spyOn(scene, "traverse");

    expect(updateClusteredMeshes(scene, viewed, 1080)).toBe(0);
    expect(spy.mock.calls.length).toBe(1);
    scene.add(tinyMesh());
    expect(updateClusteredMeshes(scene, viewed, 1080)).toBe(1);
    expect(spy.mock.calls.length).toBe(1);
  });

  it("a removed mesh stops being updated", () => {
    const scene = new Object3D();
    const viewed = camera();
    const mesh = tinyMesh();
    scene.add(mesh);

    expect(updateClusteredMeshes(scene, viewed, 1080)).toBe(1);
    const spy = vi.spyOn(mesh, "update");
    scene.remove(mesh);
    expect(updateClusteredMeshes(scene, viewed, 1080)).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a mesh reparented inside the scene keeps being updated", () => {
    const scene = new Object3D();
    const group = new Object3D();
    scene.add(group);
    const viewed = camera();
    const mesh = tinyMesh();
    scene.add(mesh);

    expect(updateClusteredMeshes(scene, viewed, 1080)).toBe(1);
    group.add(mesh);
    expect(updateClusteredMeshes(scene, viewed, 1080)).toBe(1);
    expect(mesh.parent).toBe(group);
  });

  it("a nested add finds the mesh buried inside the added group", () => {
    const scene = new Object3D();
    const viewed = camera();
    expect(updateClusteredMeshes(scene, viewed, 1080)).toBe(0);

    const group = new Object3D();
    const inner = new Object3D();
    inner.add(tinyMesh());
    group.add(inner);
    scene.add(group);
    expect(updateClusteredMeshes(scene, viewed, 1080)).toBe(1);
  });

  it("a mesh moved between roots follows the move", () => {
    const first = new Object3D();
    const second = new Object3D();
    const viewed = camera();
    const mesh = tinyMesh();
    first.add(mesh);

    expect(updateClusteredMeshes(first, viewed, 1080)).toBe(1);
    expect(updateClusteredMeshes(second, viewed, 1080)).toBe(0);
    second.add(mesh);
    expect(updateClusteredMeshes(first, viewed, 1080)).toBe(0);
    expect(updateClusteredMeshes(second, viewed, 1080)).toBe(1);
  });

  it("roots do not share state", () => {
    const first = new Object3D();
    const second = haystack(500);
    const viewed = camera();
    first.add(tinyMesh());

    expect(updateClusteredMeshes(first, viewed, 1080)).toBe(1);
    const spy = vi.spyOn(second, "traverse");
    expect(updateClusteredMeshes(second, viewed, 1080)).toBe(0);
    for (let frame = 0; frame < 5; frame += 1)
      expect(updateClusteredMeshes(second, viewed, 1080)).toBe(0);
    expect(spy.mock.calls.length).toBe(1);
  });

  it("batch roots are tracked the same way, including removal", () => {
    const scene = new Object3D();
    const viewed = camera();
    expect(updateClusteredMeshes(scene, viewed, 1080)).toBe(0);

    const root = stubBatchRoot(7);
    scene.add(root);
    expect(updateClusteredMeshes(scene, viewed, 1080)).toBe(7);
    scene.remove(root);
    expect(updateClusteredMeshes(scene, viewed, 1080)).toBe(0);
  });

  it("clear() drops everything it held", () => {
    const scene = new Object3D();
    const viewed = camera();
    scene.add(tinyMesh());
    scene.add(stubBatchRoot(7));
    expect(updateClusteredMeshes(scene, viewed, 1080)).toBe(8);

    scene.clear();
    expect(updateClusteredMeshes(scene, viewed, 1080)).toBe(0);
  });
});
