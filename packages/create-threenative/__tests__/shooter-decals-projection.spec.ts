import {
  BatchedMesh,
  BoxGeometry,
  type BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SkinnedMesh,
  Texture,
  Vector3,
} from "three";
import { DecalGeometry } from "three/addons/geometries/DecalGeometry.js";
import { describe, expect, it, vi } from "vitest";
import { baseGeometryOf } from "../../core/src/model-lod.js";
import { DecalField } from "../templates/shooter/src/render/decals.js";

function fixture(count = 2) {
  const root = new Group();
  const map = new Texture();
  const receiver = new Mesh<BufferGeometry, MeshBasicMaterial>(
    new PlaneGeometry(8, 8),
    new MeshBasicMaterial(),
  );
  root.add(receiver);
  const field = new DecalField(root, {
    countPerVariant: count,
    map,
    offset: 0.01,
    size: 1,
    tints: { stone: 0xffffff },
  });
  const slots = root.children.filter(
    (child): child is Mesh<BufferGeometry, MeshBasicMaterial> =>
      child instanceof Mesh && child !== receiver,
  );
  return { root, map, receiver, field, slots };
}

const normal = new Vector3(0, 0, 1);

describe("game-owned receiver decal projection", () => {
  it("uses upstream projection on only the selected receiver with authored UVs and bias", () => {
    const { root, receiver, field, slots } = fixture();
    const other = new Mesh(new PlaneGeometry(8, 8), new MeshBasicMaterial());
    other.position.z = 0.02;
    root.add(other);
    expect(
      field.project(receiver, baseGeometryOf(receiver), new Vector3(), normal, "stone", {
        depth: 0.2,
      }),
    ).toBe(true);
    const slot = slots[0];
    expect(slot?.parent).toBe(receiver);
    expect(slot?.geometry).toBeInstanceOf(DecalGeometry);
    expect(other.children).toHaveLength(0);
    const positions = slot?.geometry.getAttribute("position");
    const uvs = slot?.geometry.getAttribute("uv");
    expect(positions?.count).toBeGreaterThan(0);
    for (let index = 0; index < (positions?.count ?? 0); index += 1) {
      expect(positions?.getZ(index)).toBeCloseTo(0.01, 6);
      expect(uvs?.getX(index)).toBeGreaterThanOrEqual(-1e-6);
      expect(uvs?.getX(index)).toBeLessThanOrEqual(1 + 1e-6);
      expect(uvs?.getY(index)).toBeGreaterThanOrEqual(-1e-6);
      expect(uvs?.getY(index)).toBeLessThanOrEqual(1 + 1e-6);
    }
    field.dispose();
  });

  it("retains local geometry through rigid receiver and ancestor motion", () => {
    const { root, receiver, field, slots } = fixture();
    const parent = new Group();
    root.add(parent);
    parent.add(receiver);
    receiver.position.set(2, 1, 3);
    receiver.rotation.y = 0.7;
    receiver.scale.setScalar(2);
    receiver.updateWorldMatrix(true, false);
    const point = receiver.localToWorld(new Vector3());
    const worldNormal = normal.clone().transformDirection(receiver.matrixWorld);
    field.project(receiver, receiver.geometry, point, worldNormal, "stone", { depth: 0.2 });
    const slot = slots[0];
    if (slot === undefined) throw new Error("Missing slot");
    const local = new Vector3().fromBufferAttribute(slot.geometry.getAttribute("position"), 0);
    parent.position.set(-3, 4, 1);
    parent.rotation.z = 0.4;
    receiver.position.x += 1;
    receiver.rotation.y += 0.5;
    root.updateMatrixWorld(true);
    const expected = receiver.localToWorld(local.clone());
    const actual = slot.localToWorld(local.clone());
    expect(actual.distanceTo(expected)).toBeLessThan(1e-6);
    expect(
      new Vector3().fromBufferAttribute(slot.geometry.getAttribute("position"), 0).equals(local),
    ).toBe(true);
    field.dispose();
  });

  it("does not project the back face of a thin receiver", () => {
    const { receiver, field, slots } = fixture();
    receiver.geometry = new BoxGeometry(2, 2, 0.01);
    field.project(receiver, receiver.geometry, new Vector3(0, 0, 0.005), normal, "stone", {
      depth: 0.2,
    });
    const geometry = slots[0]?.geometry;
    const positions = geometry?.getAttribute("position");
    const indices = geometry?.getIndex();
    expect(indices?.count).toBeGreaterThan(0);
    for (let index = 0; index < (indices?.count ?? 0); index += 1) {
      expect(positions?.getZ(indices?.getX(index) ?? -1)).toBeCloseTo(0.015, 6);
    }
    field.dispose();
  });

  it("bounds 1,024 impacts to 256 slots and disposes evicted projected geometry", () => {
    const { receiver, field, slots, map } = fixture(256);
    const borrowed = receiver.geometry;
    const borrowedDisposed = vi.fn();
    borrowed.addEventListener("dispose", borrowedDisposed);
    const mapDisposed = vi.fn();
    map.addEventListener("dispose", mapDisposed);
    let disposed = 0;
    for (let hit = 0; hit < 1024; hit += 1) {
      expect(
        field.project(receiver, borrowed, new Vector3(), normal, "stone", { depth: 0.2 }),
      ).toBe(true);
      slots[hit % 256]?.geometry.addEventListener("dispose", () => {
        disposed += 1;
      });
      expect(receiver.children).toHaveLength(Math.min(hit + 1, 256));
    }
    expect(disposed).toBe(768);
    expect(field.capacity).toBe(256);
    expect(field.placed).toBe(1024);
    field.dispose();
    field.dispose();
    expect(disposed).toBe(1024);
    expect(receiver.children).toHaveLength(0);
    expect(borrowedDisposed).not.toHaveBeenCalled();
    expect(mapDisposed).not.toHaveBeenCalled();
  });

  it("releases a removed receiver immediately and a detached ancestor on update", () => {
    const { root, receiver, field, slots } = fixture();
    const parent = new Group();
    root.add(parent);
    parent.add(receiver);
    field.project(receiver, receiver.geometry, new Vector3(), normal, "stone", { depth: 0.2 });
    const firstDisposed = vi.fn();
    slots[0]?.geometry.addEventListener("dispose", firstDisposed);
    receiver.removeFromParent();
    expect(firstDisposed).toHaveBeenCalledTimes(1);
    expect(receiver.children).toHaveLength(0);
    parent.add(receiver);
    field.project(receiver, receiver.geometry, new Vector3(), normal, "stone", { depth: 0.2 });
    const secondDisposed = vi.fn();
    slots[1]?.geometry.addEventListener("dispose", secondDisposed);
    parent.removeFromParent();
    field.update();
    field.update();
    expect(secondDisposed).toHaveBeenCalledTimes(1);
    expect(receiver.children).toHaveLength(0);
    field.dispose();
  });

  it("restores the legacy plane on reuse and clears only owned projected geometry", () => {
    const { root, receiver, field, slots } = fixture(1);
    const plane = slots[0]?.geometry;
    field.project(receiver, receiver.geometry, new Vector3(), normal, "stone", { depth: 0.2 });
    const projectedDisposed = vi.fn();
    slots[0]?.geometry.addEventListener("dispose", projectedDisposed);
    field.place(new Vector3(1, 2, 3), normal, "stone", 2);
    expect(projectedDisposed).toHaveBeenCalledTimes(1);
    expect(slots[0]?.parent).toBe(root);
    expect(slots[0]?.geometry).toBe(plane);
    expect(slots[0]?.position.toArray()).toEqual([1, 2, 3.01]);
    expect(slots[0]?.scale.x).toBe(2);
    field.project(receiver, receiver.geometry, new Vector3(), normal, "stone", { depth: 0.2 });
    const clearedDisposed = vi.fn();
    slots[0]?.geometry.addEventListener("dispose", clearedDisposed);
    field.clear();
    field.clear();
    expect(clearedDisposed).toHaveBeenCalledTimes(1);
    expect(slots[0]?.geometry).toBe(plane);
    expect(receiver.children).toHaveLength(0);
    field.dispose();
  });

  it("uses a supplied base geometry across render LOD swaps without mutating or owning it", () => {
    const { receiver, field, slots } = fixture();
    const base = baseGeometryOf(receiver);
    const coarse = new PlaneGeometry(0.1, 0.1);
    receiver.geometry = coarse;
    field.project(receiver, base, new Vector3(2, 0, 0), normal, "stone", { depth: 0.2 });
    expect(slots[0]?.geometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(receiver.geometry).toBe(coarse);
    const localPositions = Array.from(slots[0]?.geometry.getAttribute("position").array ?? []);
    coarse.dispose();
    receiver.geometry = base;
    expect(Array.from(slots[0]?.geometry.getAttribute("position").array ?? [])).toEqual(
      localPositions,
    );
    field.dispose();
  });

  it.each([
    ["skinned", () => new SkinnedMesh(new PlaneGeometry(8, 8), new MeshBasicMaterial())],
    ["instanced", () => new InstancedMesh(new PlaneGeometry(8, 8), new MeshBasicMaterial(), 1)],
    ["batched", () => new BatchedMesh(2, 20, 30, new MeshBasicMaterial())],
    [
      "transparent",
      () => new Mesh(new PlaneGeometry(8, 8), new MeshBasicMaterial({ transparent: true })),
    ],
    ["cutout", () => new Mesh(new PlaneGeometry(8, 8), new MeshBasicMaterial({ alphaTest: 0.5 }))],
    [
      "morphed",
      () => {
        const mesh = new Mesh(new PlaneGeometry(8, 8), new MeshBasicMaterial());
        mesh.geometry.morphAttributes.position = [
          new Float32BufferAttribute(new Float32Array(12), 3),
        ];
        return mesh;
      },
    ],
    [
      "nonuniform",
      () => {
        const mesh = new Mesh(new PlaneGeometry(8, 8), new MeshBasicMaterial());
        mesh.scale.set(1, 2, 1);
        return mesh;
      },
    ],
    [
      "mirrored",
      () => {
        const mesh = new Mesh(new PlaneGeometry(8, 8), new MeshBasicMaterial());
        mesh.scale.x = -1;
        return mesh;
      },
    ],
    [
      "singular",
      () => {
        const mesh = new Mesh(new PlaneGeometry(8, 8), new MeshBasicMaterial());
        mesh.scale.x = 0;
        return mesh;
      },
    ],
  ])("refuses %s receivers before recycling a live slot", (_name, makeReceiver) => {
    const { root, receiver, field, slots } = fixture(1);
    field.project(receiver, receiver.geometry, new Vector3(), normal, "stone", { depth: 0.2 });
    const existing = slots[0]?.geometry;
    const unsupported = makeReceiver();
    root.add(unsupported);
    expect(() =>
      field.project(unsupported, unsupported.geometry, new Vector3(), normal, "stone", {
        depth: 0.2,
      }),
    ).toThrow(/unsupported receiver/i);
    expect(slots[0]?.geometry).toBe(existing);
    expect(field.placed).toBe(1);
    field.dispose();
  });

  it("does not consume a slot on a miss, after disposal, or with an invalid projector", () => {
    const { receiver, field, slots } = fixture(1);
    const original = slots[0]?.geometry;
    expect(
      field.project(receiver, receiver.geometry, new Vector3(20, 0, 0), normal, "stone", {
        depth: 0.2,
      }),
    ).toBe(false);
    expect(() =>
      field.project(receiver, receiver.geometry, new Vector3(), normal, "stone", { depth: 0 }),
    ).toThrow(/projector/i);
    expect(() =>
      field.project(receiver, receiver.geometry, new Vector3(), new Vector3(), "stone", {
        depth: 0.2,
      }),
    ).toThrow(/projector/i);
    expect(() =>
      field.project(receiver, receiver.geometry, new Vector3(), new Vector3(1e308, 0, 0), "stone", {
        depth: 0.2,
      }),
    ).toThrow(/projector/i);
    expect(field.placed).toBe(0);
    expect(slots[0]?.geometry).toBe(original);
    field.dispose();
    expect(
      field.project(receiver, receiver.geometry, new Vector3(), normal, "stone", { depth: 0.2 }),
    ).toBe(false);
  });

  it("refuses nonuniform ancestor scale and shear", () => {
    const { root, receiver, field } = fixture();
    const parent = new Group();
    root.add(parent);
    parent.add(receiver);
    parent.scale.set(1, 2, 1);
    expect(() =>
      field.project(receiver, receiver.geometry, new Vector3(), normal, "stone", { depth: 0.2 }),
    ).toThrow(/unsupported receiver/i);
    parent.scale.setScalar(1);
    receiver.matrixAutoUpdate = false;
    receiver.matrix.makeShear(0.5, 0, 0, 0, 0, 0);
    expect(() =>
      field.project(receiver, receiver.geometry, new Vector3(), normal, "stone", { depth: 0.2 }),
    ).toThrow(/unsupported receiver/i);
    field.dispose();
  });

  it("explicit receiver cleanup does not retire another receiver's marks", () => {
    const { root, receiver, field, slots } = fixture();
    const other = new Mesh(new PlaneGeometry(8, 8), new MeshBasicMaterial());
    root.add(other);
    field.project(receiver, receiver.geometry, new Vector3(), normal, "stone", { depth: 0.2 });
    field.project(other, other.geometry, new Vector3(), normal, "stone", { depth: 0.2 });
    const retained = slots[1]?.geometry;
    field.removeReceiver(receiver);
    field.removeReceiver(receiver);
    expect(receiver.children).toHaveLength(0);
    expect(other.children).toHaveLength(1);
    expect(slots[1]?.geometry).toBe(retained);
    field.dispose();
  });
});
