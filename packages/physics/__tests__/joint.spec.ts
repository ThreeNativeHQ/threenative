import * as RAPIER from "@dimforge/rapier3d-compat";
import { Object3D } from "three";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "../src/index.js";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { Joint3D } from "../src/Joint3D.js";
import { RigidBody3D } from "../src/RigidBody3D.js";

const worlds: RAPIER.World[] = [];

beforeAll(async () => {
  await RAPIER.init();
});

afterEach(() => {
  for (const world of worlds.splice(0)) world.free();
});

function world(): RAPIER.World {
  const instance = new RAPIER.World({ x: 0, y: 0, z: 0 });
  instance.timestep = 1 / 60;
  worlds.push(instance);
  return instance;
}

function body(
  instance: RAPIER.World,
  x: number,
  type: "dynamic" | "fixed" = "dynamic",
): RigidBody3D {
  const object = new Object3D();
  object.position.x = x;
  return new RigidBody3D({
    object,
    shape: CollisionShape3D.sphere(0.2),
    type,
    world: instance,
  });
}

function step(instance: RAPIER.World, bodies: readonly RigidBody3D[], count = 120): void {
  for (let index = 0; index < count; index += 1) {
    instance.step();
    for (const physicsBody of bodies) physicsBody.syncFromPhysics();
  }
}

function nextFloat32(value: number): number {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value);
  view.setUint32(0, view.getUint32(0) + 1);
  return view.getFloat32(0);
}

describe("Joint3D", () => {
  it("holds pin anchors at a fixed separation across 120 steps", () => {
    const instance = world();
    const anchor = body(instance, 0, "fixed");
    const child = body(instance, 2);
    const joint = Joint3D.pin({
      anchorA: { x: 0, y: 0, z: 0 },
      anchorB: { x: -2, y: 0, z: 0 },
      bodyA: anchor,
      bodyB: child,
      world: instance,
    });
    child.applyImpulse({ x: 4, y: 0, z: 0 });

    step(instance, [anchor, child]);

    expect(child.object.position.distanceTo(anchor.object.position)).toBeCloseTo(2, 2);
    joint.dispose();
  });

  it("constrains a hinge to its axis and honors angular limits", () => {
    const instance = world();
    const anchor = body(instance, 0, "fixed");
    const door = body(instance, 1);
    const joint = Joint3D.hinge({
      anchorA: { x: 0, y: 0, z: 0 },
      anchorB: { x: -1, y: 0, z: 0 },
      axis: { x: 0, y: 1, z: 0 },
      bodyA: anchor,
      bodyB: door,
      limit: { lower: -0.4, upper: 0.4 },
      world: instance,
    });
    (door.body.raw as RAPIER.RigidBody).applyTorqueImpulse({ x: 4, y: 4, z: 0 }, true);

    step(instance, [anchor, door]);

    expect(Math.abs(door.object.quaternion.x) + Math.abs(door.object.quaternion.z)).toBeLessThan(
      0.05,
    );
    const angle = 2 * Math.atan2(Math.abs(door.object.quaternion.y), door.object.quaternion.w);
    expect(angle).toBeGreaterThan(0.3);
    expect(angle).toBeLessThan(0.55);
    joint.dispose();
  });

  it("keeps a fixed joint relative transform constant", () => {
    const instance = world();
    const anchor = body(instance, 0, "fixed");
    const child = body(instance, 2);
    const joint = Joint3D.fixed({
      anchorA: { x: 0, y: 0, z: 0 },
      anchorB: { x: -2, y: 0, z: 0 },
      bodyA: anchor,
      bodyB: child,
      world: instance,
    });
    (child.body.raw as RAPIER.RigidBody).applyTorqueImpulse({ x: 0, y: 4, z: 0 }, true);

    step(instance, [anchor, child]);

    expect(child.object.position.x - anchor.object.position.x).toBeCloseTo(2, 2);
    expect(child.object.position.y - anchor.object.position.y).toBeCloseTo(0, 2);
    expect(child.object.position.z - anchor.object.position.z).toBeCloseTo(0, 2);
    expect(child.object.quaternion.angleTo(anchor.object.quaternion)).toBeCloseTo(0, 2);
    joint.dispose();
  });

  it("removes the constraint once, and body disposal leaves the next step safe", () => {
    const instance = world();
    const anchor = body(instance, 0, "fixed");
    const child = body(instance, 2);
    const joint = Joint3D.pin({
      anchorA: { x: 0, y: 0, z: 0 },
      anchorB: { x: -2, y: 0, z: 0 },
      bodyA: anchor,
      bodyB: child,
      world: instance,
    });

    joint.dispose();
    joint.dispose();
    child.applyImpulse({ x: 4, y: 0, z: 0 });
    step(instance, [anchor, child], 30);
    expect(child.object.position.x).toBeGreaterThan(2.5);

    const second = body(instance, 2);
    const secondJoint = Joint3D.pin({
      bodyA: anchor,
      bodyB: second,
      world: instance,
    });
    second.dispose();
    expect(() => instance.step()).not.toThrow();
    expect(() => secondJoint.dispose()).not.toThrow();
  });

  it("rejects a NaN anchor before reaching the backend seam", () => {
    const createJoint = vi.fn(() => 1);
    const simulation = {
      createBody: vi.fn(),
      createJoint,
      removeJoint: vi.fn(),
      step: vi.fn(),
    };
    const handle = { id: 0, raw: {} };

    expect(() =>
      Joint3D.pin({
        anchorA: { x: Number.NaN, y: 0, z: 0 },
        bodyA: handle,
        bodyB: { id: 1, raw: {} },
        world: simulation,
      }),
    ).toThrow(/TN_PHYSICS_NON_FINITE/u);
    expect(createJoint).not.toHaveBeenCalled();
  });

  it("rejects near-zero native-invalid frames and axes at the shared seam", () => {
    const createJoint = vi.fn(() => 1);
    const simulation = {
      createBody: vi.fn(),
      createJoint,
      removeJoint: vi.fn(),
      step: vi.fn(),
    };
    const bodyA = { id: 0, raw: {} };
    const bodyB = { id: 1, raw: {} };

    expect(() =>
      Joint3D.hinge({
        axis: { x: 1e-7, y: 0, z: 0 },
        bodyA,
        bodyB,
        world: simulation,
      }),
    ).toThrow(/IPhysicsSimulation hinge axis must not have zero length/u);
    expect(() =>
      Joint3D.fixed({
        frameA: { x: 0.0001, y: 0, z: 0, w: 0 },
        bodyA,
        bodyB,
        world: simulation,
      }),
    ).toThrow(/TN_PHYSICS_INVALID: joint frameA/u);
    expect(createJoint).not.toHaveBeenCalled();
  });

  it("brackets native f32 epsilon boundaries for frames and hinge axes", () => {
    const instance = world();
    const fixedAnchor = body(instance, 0, "fixed");
    const fixedChild = body(instance, 1);
    const frameBoundary = Math.sqrt(2 ** -23);

    expect(() =>
      Joint3D.fixed({
        bodyA: fixedAnchor,
        bodyB: fixedChild,
        frameA: { x: frameBoundary, y: 0, z: 0, w: 0 },
        world: instance,
      }),
    ).toThrow(/TN_PHYSICS_INVALID: joint frameA/u);

    const acceptedFrame = Joint3D.fixed({
      bodyA: fixedAnchor,
      bodyB: fixedChild,
      frameA: { x: nextFloat32(Math.fround(frameBoundary)), y: 0, z: 0, w: 0 },
      world: instance,
    });
    acceptedFrame.dispose();

    const hingeAnchor = body(instance, 2, "fixed");
    const hingeChild = body(instance, 3);
    const axisBoundaryAboveF32 = 2 ** -23 + Number.EPSILON;

    expect(() =>
      Joint3D.hinge({
        axis: { x: axisBoundaryAboveF32, y: 0, z: 0 },
        bodyA: hingeAnchor,
        bodyB: hingeChild,
        world: instance,
      }),
    ).toThrow(/IPhysicsSimulation hinge axis must not have zero length/u);

    const acceptedAxis = Joint3D.hinge({
      axis: { x: nextFloat32(2 ** -23), y: 0, z: 0 },
      bodyA: hingeAnchor,
      bodyB: hingeChild,
      world: instance,
    });
    acceptedAxis.dispose();
  });
});
