import { BoxGeometry, CylinderGeometry, Group, Matrix4, MeshBasicMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { InstancedBatch } from "../src/instanced-batch.js";

function batch(): InstancedBatch {
  return new InstancedBatch({
    geometry: new BoxGeometry(1, 1, 1),
    material: new MeshBasicMaterial(),
  });
}

/** Position, scale and the axis a unit +Y shape ends up pointing along, read back off an instance. */
function readInstance(matrix: Matrix4) {
  const position = new Vector3();
  const scale = new Vector3();
  const axis = new Vector3();
  position.setFromMatrixPosition(matrix);
  scale.setFromMatrixScale(matrix);
  axis.set(0, 1, 0).transformDirection(matrix);
  return { axis, position, scale };
}

describe("InstancedBatch", () => {
  it("collapses every placement into one mesh with the transforms it was given", () => {
    const props = batch();
    props.place({ position: [1, 2, 3] });
    props.place({ position: [-4, 0, 5], scale: [2, 3, 4], rotation: [0, Math.PI / 2, 0] });
    expect(props.count).toBe(2);

    const mesh = props.build();
    expect(mesh).toBeDefined();
    expect(mesh?.count).toBe(2);

    const read = new Matrix4();
    mesh?.getMatrixAt(0, read);
    expect(readInstance(read).position.toArray()).toEqual([1, 2, 3]);
    mesh?.getMatrixAt(1, read);
    const second = readInstance(read);
    expect(second.position.toArray()).toEqual([-4, 0, 5]);
    expect(second.scale.x).toBeCloseTo(2, 6);
    expect(second.scale.y).toBeCloseTo(3, 6);
    expect(second.scale.z).toBeCloseTo(4, 6);
  });

  it("hands back the instance index so a game can keep animating one prop by name", () => {
    const props = batch();
    expect(props.place({ position: [0, 0, 0] })).toBe(0);
    const flame = props.place({ position: [0, 5, 0] });
    expect(flame).toBe(1);
    expect(props.place({ position: [0, 9, 0] })).toBe(2);

    const mesh = props.build();
    if (mesh === undefined) throw new Error("the batch had three placements");
    mesh.setMatrixAt(flame, new Matrix4().makeTranslation(7, 7, 7));
    const read = new Matrix4();
    mesh.getMatrixAt(flame, read);
    expect(readInstance(read).position.toArray()).toEqual([7, 7, 7]);
    // The neighbours are untouched: the index addresses one instance, not the whole batch.
    mesh.getMatrixAt(2, read);
    expect(readInstance(read).position.toArray()).toEqual([0, 9, 0]);
  });

  it("copies the matrix it is handed so one scratch Matrix4 can drive every call", () => {
    const props = batch();
    const scratch = new Matrix4();
    props.add(scratch.makeTranslation(1, 0, 0));
    props.add(scratch.makeTranslation(2, 0, 0));

    const mesh = props.build();
    const read = new Matrix4();
    mesh?.getMatrixAt(0, read);
    expect(readInstance(read).position.x).toBe(1);
    mesh?.getMatrixAt(1, read);
    expect(readInstance(read).position.x).toBe(2);
  });

  it("spans two points as a stretched unit-height shape", () => {
    const rods = new InstancedBatch({
      geometry: new CylinderGeometry(1, 1, 1, 6),
      material: new MeshBasicMaterial(),
    });
    rods.span([0, 0, 0], [0, 0, 10], 0.25);

    const mesh = rods.build();
    const read = new Matrix4();
    mesh?.getMatrixAt(0, read);
    const rod = readInstance(read);
    expect(rod.position.toArray()).toEqual([0, 0, 5]);
    expect(rod.scale.x).toBeCloseTo(0.25, 6);
    expect(rod.scale.y).toBeCloseTo(10, 6);
    expect(rod.scale.z).toBeCloseTo(0.25, 6);
    // The shape's +Y now points from `from` toward `to`.
    expect(rod.axis.x).toBeCloseTo(0, 6);
    expect(rod.axis.y).toBeCloseTo(0, 6);
    expect(rod.axis.z).toBeCloseTo(1, 6);
  });

  it("bounds the batch around every instance so the culler does not drop a spread-out one", () => {
    const props = batch();
    props.place({ position: [0, 0, 0] });
    props.place({ position: [100, 0, 0] });

    const mesh = props.build();
    // Without the explicit compute this is the bounds of one un-transformed copy, and the batch
    // pops out of view while half of it is still on screen.
    expect(mesh?.boundingSphere?.radius ?? 0).toBeGreaterThan(50);
  });

  it("passes the built mesh straight through to the parent, name and shadow flags", () => {
    const parent = new Group();
    const props = batch();
    props.place({ position: [0, 0, 0] });
    const mesh = props.build({ castShadow: true, name: "curbs", parent, receiveShadow: true });

    expect(parent.children).toEqual([mesh]);
    expect(mesh?.name).toBe("curbs");
    expect(mesh?.castShadow).toBe(true);
    expect(mesh?.receiveShadow).toBe(true);
    expect(props.mesh).toBe(mesh);
  });

  it("defaults the shadow flags to Three.js's own, so the batch decides nothing", () => {
    const props = batch();
    props.place({ position: [0, 0, 0] });
    const mesh = props.build();
    expect(mesh?.castShadow).toBe(false);
    expect(mesh?.receiveShadow).toBe(false);
  });

  it("returns undefined rather than a mesh that draws nothing", () => {
    const props = batch();
    // `new InstancedMesh(geometry, material, 0)` satisfies every type check and draws nothing, so
    // an empty batch would be indistinguishable from a working one.
    expect(props.build()).toBeUndefined();
    expect(props.mesh).toBeUndefined();
    expect(() => props.place({ position: [1, 0, 0] })).toThrow(/after build/u);
    expect(() => props.span([0, 0, 0], [0, 1, 0], 0.1)).toThrow(/after build/u);
    expect(() => props.add(new Matrix4())).toThrow(/after build/u);
  });

  it("refuses to place after build, because an InstancedMesh count is fixed", () => {
    const props = batch();
    props.place({ position: [0, 0, 0] });
    props.build();
    expect(() => props.place({ position: [1, 0, 0] })).toThrow(/after build/u);
    expect(() => props.span([0, 0, 0], [0, 1, 0], 0.1)).toThrow(/after build/u);
    expect(() => props.add(new Matrix4())).toThrow(/after build/u);
    expect(() => props.build()).toThrow(/already called/u);
  });

  it("fails closed on input that would silently shift every later index", () => {
    const props = batch();
    expect(() => props.span([1, 2, 3], [1, 2, 3], 0.2)).toThrow(/same point/u);
    expect(() => props.span([0, 0, 0], [0, 1, 0], 0)).toThrow(/positive finite/u);
    expect(() => props.place({ position: [0, Number.NaN, 0] })).toThrow(/finite/u);
    expect(() =>
      props.place({ position: [0, 0, 0], scale: [1, 2] as unknown as [number, number, number] }),
    ).toThrow(/triple/u);
    expect(props.count).toBe(0);
  });

  it("requires the game to supply both the shape and the surface", () => {
    expect(
      () =>
        new InstancedBatch({
          geometry: undefined as unknown as BoxGeometry,
          material: new MeshBasicMaterial(),
        }),
    ).toThrow(/geometry is required/u);
    expect(
      () =>
        new InstancedBatch({
          geometry: new BoxGeometry(1, 1, 1),
          material: undefined as unknown as MeshBasicMaterial,
        }),
    ).toThrow(/never chooses one/u);
  });
});
