import * as RAPIER from "@dimforge/rapier3d-compat";
import { Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import { Area3D } from "../src/Area3D.js";
import { CharacterBody3D } from "../src/CharacterBody3D.js";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { RigidBody3D } from "../src/RigidBody3D.js";
import { type NativeSimulation, createNativePhysicsSimulation } from "../src/native/host.js";
import {
  Area3D as NativeArea3D,
  CharacterBody3D as NativeCharacterBody3D,
  CollisionShape3D as NativeCollisionShape3D,
  RigidBody3D as NativeRigidBody3D,
} from "../src/native/index.js";
import { createWebPhysicsSimulation } from "../src/simulation.js";

describe("native physics contract", () => {
  it("exports one shared class for every public node", () => {
    expect(NativeArea3D).toBe(Area3D);
    expect(NativeCharacterBody3D).toBe(CharacterBody3D);
    expect(NativeCollisionShape3D).toBe(CollisionShape3D);
    expect(NativeRigidBody3D).toBe(RigidBody3D);
  });

  it("rejects native shapes outside the ABI before calling the host", () => {
    const createBody = vi.fn(() => {
      throw new Error("unsupported shapes must not reach the native host");
    });
    const native = createNativePhysicsSimulation(
      { createBody } as unknown as NativeSimulation,
      "0.30.0",
    );

    expect(() =>
      native.createBody({
        mass: 0,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        sensor: false,
        shape: CollisionShape3D.heightfield(2, 2, new Float32Array(4), {
          x: 1,
          y: 1,
          z: 1,
        }).descriptor,
        type: "fixed",
      }),
    ).toThrow(/TN_NATIVE_PHYSICS_SHAPE_UNSUPPORTED.*heightfield/);
    expect(createBody).not.toHaveBeenCalled();
  });

  it("requires matching sensor metadata on both adapters and keeps native raw values opaque", async () => {
    const createBody = vi.fn().mockReturnValueOnce(7).mockReturnValueOnce(8);
    const native = createNativePhysicsSimulation(
      { createBody } as unknown as NativeSimulation,
      "0.30.0",
    );
    const sensorShape = CollisionShape3D.capsule(0.35, 0.3).setSensor(true);
    const solidShape = CollisionShape3D.box(1, 1, 1);
    const options = (sensor: boolean, shape: CollisionShape3D) => ({
      mass: 0,
      position: { x: 0, y: 0, z: 0 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      sensor,
      shape: shape.descriptor,
      type: "fixed" as const,
    });

    expect(() => native.createBody(options(false, sensorShape))).toThrow(
      /TN_PHYSICS_SENSOR_CONFLICT/,
    );
    expect(() => native.createBody(options(true, solidShape))).toThrow(
      /TN_PHYSICS_SENSOR_CONFLICT/,
    );
    expect(createBody).not.toHaveBeenCalled();

    native.createBody(options(false, solidShape));
    const sensorRegistration = native.createBody(options(true, sensorShape));

    expect(createBody).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sensor: false, shape: solidShape.descriptor }),
    );
    expect(createBody).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sensor: true, shape: sensorShape.descriptor }),
    );
    expect(sensorRegistration.rawShape).not.toBe(sensorShape.descriptor);
    expect(sensorRegistration.rawShape).toEqual(
      expect.objectContaining({ backend: "native", kind: "capsule" }),
    );
    sensorShape.bindRaw(sensorRegistration.rawShape);
    expect(sensorShape.raw).toBe(sensorRegistration.rawShape);
    expect(sensorShape.raw).toEqual(
      expect.objectContaining({ backend: "native", kind: "capsule" }),
    );

    await RAPIER.init();
    const web = createWebPhysicsSimulation({
      eventQueue: new RAPIER.EventQueue(true),
      rapier: RAPIER,
      version: RAPIER.version(),
      world: new RAPIER.World({ x: 0, y: -9.81, z: 0 }),
    });
    expect(() => web.createBody(options(false, sensorShape))).toThrow(/TN_PHYSICS_SENSOR_CONFLICT/);
    expect(() => web.createBody(options(true, solidShape))).toThrow(/TN_PHYSICS_SENSOR_CONFLICT/);
    web.dispose();
  });

  it("passes a sensor shape through the shared rigid-body node", () => {
    const createBody = vi.fn().mockReturnValue(9);
    const native = createNativePhysicsSimulation(
      { createBody } as unknown as NativeSimulation,
      "0.30.0",
    );
    new RigidBody3D({
      object: new Object3D(),
      shape: CollisionShape3D.box(1, 1, 1).setSensor(true),
      world: native,
    });

    expect(createBody).toHaveBeenCalledWith(expect.objectContaining({ sensor: true }));
  });

  it("passes a sensor shape through the shared character node", () => {
    const createBody = vi.fn().mockReturnValue(10);
    const configureCharacter = vi.fn();
    const native = createNativePhysicsSimulation(
      { configureCharacter, createBody } as unknown as NativeSimulation,
      "0.30.0",
    );
    new CharacterBody3D({
      object: new Object3D(),
      shape: CollisionShape3D.box(1, 1, 1).setSensor(true),
      world: native,
    });

    expect(createBody).toHaveBeenCalledWith(expect.objectContaining({ sensor: true }));
    expect(configureCharacter).toHaveBeenCalledOnce();
  });
});
