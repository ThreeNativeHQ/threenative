import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { measureThreePose } from "../src/pose-measure.js";

describe("measureThreePose", () => {
  it("reports JSON-safe world transforms and local axes", () => {
    const parent = new Group();
    parent.position.set(3, 4, 5);
    parent.rotation.y = Math.PI / 2;
    const mesh = new Mesh(new BoxGeometry(2, 4, 6), new MeshBasicMaterial());
    mesh.name = "rifle";
    parent.add(mesh);

    const pose = measureThreePose(mesh);

    expect(pose.position).toEqual([3, 4, 5]);
    expect(pose.axes.z[0]).toBeCloseTo(1);
    expect(pose.axes.z[2]).toBeCloseTo(0);
    expect(pose.bounds?.size[0]).toBeCloseTo(6);
    expect(pose.bounds?.size[1]).toBeCloseTo(4);
    expect(pose.bounds?.size[2]).toBeCloseTo(2);
    expect(() => JSON.stringify(pose)).not.toThrow();
  });

  it("measures selected visuals without attached props", () => {
    const root = new Group();
    root.name = "enemy";
    const body = new Mesh(new BoxGeometry(1, 2, 1), new MeshBasicMaterial());
    body.position.y = 1;
    const floatingWeapon = new Mesh(new BoxGeometry(1, 1, 8), new MeshBasicMaterial());
    floatingWeapon.position.y = 10;
    root.add(body, floatingWeapon);

    const pose = measureThreePose(root, { bounds: [body] });

    expect(pose.bounds?.min[1]).toBeCloseTo(0);
    expect(pose.bounds?.max[1]).toBeCloseTo(2);
    expect(pose.bounds?.size[2]).toBeCloseTo(1);
  });

  it("measures a geometry-free bone or socket when bounds are disabled", () => {
    const socket = new Object3D();
    socket.name = "RightHand";
    socket.position.set(1, 2, 3);

    const pose = measureThreePose(socket, { bounds: false });

    expect(pose.position).toEqual([1, 2, 3]);
    expect(pose.bounds).toBeNull();
  });

  it("fails closed for empty or geometry-free bounds", () => {
    const root = new Object3D();

    expect(() => measureThreePose(root, { bounds: [] })).toThrow(/at least one Object3D/);
    expect(() => measureThreePose(root, { bounds: [new Object3D()] })).toThrow(
      /could not measure bounds/,
    );
  });
});
