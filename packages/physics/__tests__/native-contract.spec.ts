import * as RAPIER from "@dimforge/rapier3d-compat";
import { Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import { Area3D } from "../src/Area3D.js";
import { CharacterBody3D } from "../src/CharacterBody3D.js";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { PhysicsDirectSpaceState3D } from "../src/PhysicsDirectSpaceState3D.js";
import { RigidBody3D } from "../src/RigidBody3D.js";
import * as webEntry from "../src/index.js";
import { type INativeSimulation, createNativePhysicsSimulation } from "../src/native/host.js";
import {
  Area3D as NativeArea3D,
  CharacterBody3D as NativeCharacterBody3D,
  CollisionShape3D as NativeCollisionShape3D,
  PhysicsDirectSpaceState3D as NativePhysicsDirectSpaceState3D,
  RigidBody3D as NativeRigidBody3D,
} from "../src/native/index.js";
import * as nativeEntry from "../src/native/index.js";
import type { IPhysicsContext } from "../src/plugin.js";
import {
  MAX_PHYSICS_QUERY_RESULTS,
  PHYSICS_SLEEP_STATE_STRIDE,
  PHYSICS_TRANSFORM_STRIDE,
  createWebPhysicsSimulation,
} from "../src/simulation.js";

function bodyOptions(type: "dynamic" | "fixed" = "dynamic") {
  return {
    mass: type === "dynamic" ? 1 : 0,
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    sensor: false,
    shape: CollisionShape3D.sphere(0.5).descriptor,
    type,
  };
}

describe("native physics contract", () => {
  it("keeps web and native runtime entry-point exports in parity", () => {
    expect(Object.keys(nativeEntry).sort()).toEqual(Object.keys(webEntry).sort());
  });

  it("exports one shared class for every public node", () => {
    expect(NativeArea3D).toBe(Area3D);
    expect(NativeCharacterBody3D).toBe(CharacterBody3D);
    expect(NativeCollisionShape3D).toBe(CollisionShape3D);
    expect(NativeRigidBody3D).toBe(RigidBody3D);
    expect(NativePhysicsDirectSpaceState3D).toBe(PhysicsDirectSpaceState3D);
  });

  it("reads ground body and normal through the existing bulk character-state call", () => {
    let nextId = 0;
    const readCharacterStates = vi.fn((buffer: Float32Array) => {
      buffer.set([0, 1, 1, 0, 0.8, 0.6]);
      return 1;
    });
    const raw = {
      configureCharacter: vi.fn(),
      createBody: vi.fn(() => nextId++),
      dispose: vi.fn(),
      drainCollisionEvents: vi.fn(() => 0),
      intersectPoint: vi.fn(() => []),
      intersectRay: vi.fn(() => null),
      intersectShape: vi.fn(() => []),
      readAreaIntersections: vi.fn(() => 0),
      readBodySleepStates: vi.fn(() => 0),
      readCharacterStates,
      readVisibleTransforms: vi.fn(() => 0),
      removeBody: vi.fn(),
      step: vi.fn(),
    } as unknown as INativeSimulation;
    const simulation = createNativePhysicsSimulation(raw, "0.30.0");
    const character = simulation.createBody({ ...bodyOptions("fixed"), type: "character" });
    const floor = simulation.createBody(bodyOptions("fixed"));
    simulation.configureCharacter(character.body.id, {
      maxSlopeClimbAngle: Math.PI / 4,
      offset: 0.01,
      oneWayLayers: 0,
    });
    simulation.step(1 / 60);

    const state = simulation.readCharacterState?.(character.body.id);
    expect(state).toEqual(
      expect.objectContaining({
        groundBody: floor.body,
        groundCollider: floor.body.id,
        grounded: true,
      }),
    );
    expect(state?.groundNormal?.x).toBe(0);
    expect(state?.groundNormal?.y).toBeCloseTo(0.8, 6);
    expect(state?.groundNormal?.z).toBeCloseTo(0.6, 6);
    expect(readCharacterStates).toHaveBeenCalledOnce();
  });

  it("rejects the old three-float native character-state row", () => {
    let nextId = 0;
    const raw = {
      configureCharacter: vi.fn(),
      createBody: vi.fn(() => nextId++),
      dispose: vi.fn(),
      drainCollisionEvents: vi.fn(() => 0),
      intersectPoint: vi.fn(() => []),
      intersectRay: vi.fn(() => null),
      intersectShape: vi.fn(() => []),
      readAreaIntersections: vi.fn(() => 0),
      readBodySleepStates: vi.fn(() => 0),
      readCharacterStates: vi.fn((buffer: Float32Array) => {
        buffer.set([0, 1, -1]);
        return 1;
      }),
      readVisibleTransforms: vi.fn(() => 0),
      removeBody: vi.fn(),
      step: vi.fn(),
    } as unknown as INativeSimulation;
    const simulation = createNativePhysicsSimulation(raw, "old-runtime");
    const character = simulation.createBody({ ...bodyOptions("fixed"), type: "character" });
    simulation.configureCharacter(character.body.id, {
      maxSlopeClimbAngle: Math.PI / 4,
      offset: 0.01,
      oneWayLayers: 0,
    });
    simulation.step(1 / 60);

    expect(() => simulation.readCharacterState?.(character.body.id)).toThrow(
      /malformed six-float character state/,
    );
  });

  it("rejects native shapes outside the ABI before calling the host", () => {
    const createBody = vi.fn(() => {
      throw new Error("unsupported shapes must not reach the native host");
    });
    const native = createNativePhysicsSimulation(
      { createBody } as unknown as INativeSimulation,
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

  it("rejects a non-finite or negative mass before calling the host, like the web seam", () => {
    const createBody = vi.fn(() => 0);
    const native = createNativePhysicsSimulation(
      { createBody } as unknown as INativeSimulation,
      "0.30.0",
    );

    for (const mass of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      expect(() =>
        native.createBody({
          mass,
          position: { x: 0, y: 0, z: 0 },
          rotation: { w: 1, x: 0, y: 0, z: 0 },
          sensor: false,
          shape: CollisionShape3D.sphere(0.5).descriptor,
          type: "dynamic",
        }),
      ).toThrow(/mass must be a finite non-negative number/);
    }
    expect(createBody).not.toHaveBeenCalled();
  });

  it("fails closed when syncFromPhysics hits a backend without readBodyTransform", () => {
    // Both shipped backends read transforms. The guard exists for any other simulation reaching
    // these nodes, so prove it against one that genuinely lacks the capability rather than
    // against an adapter that has it.
    const simulation = {
      configureCharacter: vi.fn(),
      createBody: vi.fn(() => ({
        body: { entity: undefined, id: 0 },
        collider: { id: 0 },
        controller: { id: 0 },
        rawShape: undefined,
      })),
      removeBody: vi.fn(),
    } as unknown as IPhysicsContext["simulation"];
    const physics = {
      add: () => {},
      addArea: () => {},
      remove: () => {},
      removeArea: () => {},
      simulation,
    } as unknown as IPhysicsContext;

    const crate = new Object3D();
    crate.position.set(1, 2, 3);
    const body = new RigidBody3D({ object: crate, physics, shape: CollisionShape3D.sphere(0.5) });
    expect(() => body.syncFromPhysics()).toThrow(/TN_PHYSICS_READ_TRANSFORM_MISSING/);
    expect(crate.position.x).toBe(1);

    const character = new CharacterBody3D({
      object: new Object3D(),
      physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
    });
    expect(() => character.syncFromPhysics()).toThrow(/TN_PHYSICS_READ_TRANSFORM_MISSING/);
  });

  it("reads one body transform on the native seam like the web seam", () => {
    // The seam only had the bulk render read, so `syncFromPhysics()` — a public method with no
    // caller inside the framework — threw on native and worked on web. That is the web-only
    // split the framework exists to prevent.
    let nextId = 0;
    const placed = new Map<number, readonly number[]>();
    const raw = {
      configureCharacter: vi.fn(),
      createBody: vi.fn(() => {
        const id = nextId;
        nextId += 1;
        placed.set(id, [id + 1, id + 2, id + 3, 0, 0, 0, 1]);
        return id;
      }),
      dispose: vi.fn(),
      drainCollisionEvents: vi.fn(() => 0),
      intersectPoint: vi.fn(() => []),
      intersectRay: vi.fn(() => null),
      intersectShape: vi.fn(() => []),
      readAreaIntersections: vi.fn(() => 0),
      readCharacterStates: vi.fn(() => 0),
      readVisibleTransforms: vi.fn((buffer: Float32Array) => {
        let index = 0;
        for (const [id, row] of placed) {
          const offset = index * PHYSICS_TRANSFORM_STRIDE;
          buffer[offset] = id;
          for (let scalar = 0; scalar < row.length; scalar += 1)
            buffer[offset + 1 + scalar] = row[scalar] as number;
          index += 1;
        }
        return index;
      }),
      removeBody: vi.fn(),
      step: vi.fn(),
    } as unknown as INativeSimulation;
    const simulation = createNativePhysicsSimulation(raw, "0.30.0");
    const physics = {
      add: () => {},
      addArea: () => {},
      remove: () => {},
      removeArea: () => {},
      simulation,
    } as unknown as IPhysicsContext;

    const first = new Object3D();
    const second = new Object3D();
    new RigidBody3D({ object: first, physics, shape: CollisionShape3D.sphere(0.5) });
    const secondBody = new RigidBody3D({
      object: second,
      physics,
      shape: CollisionShape3D.sphere(0.5),
    });

    expect(simulation.readBodyTransform?.(0)).toEqual({
      position: { x: 1, y: 2, z: 3 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
    });
    expect(simulation.readBodyTransform?.(1)?.position).toEqual({ x: 2, y: 3, z: 4 });
    expect(simulation.readBodyTransform?.(99)).toBeUndefined();

    secondBody.syncFromPhysics();
    expect(second.position.toArray()).toEqual([2, 3, 4]);

    // One bulk read per step, not one per body.
    const reads = (raw.readVisibleTransforms as unknown as { mock: { calls: unknown[] } }).mock
      .calls.length;
    simulation.readBodyTransform?.(0);
    expect(
      (raw.readVisibleTransforms as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(reads);

    simulation.dispose();
    expect(() => simulation.readBodyTransform?.(0)).toThrow(/disposed/);
  });

  it("requires matching sensor metadata on both adapters and keeps native raw values opaque", async () => {
    const createBody = vi.fn().mockReturnValueOnce(7).mockReturnValueOnce(8);
    const native = createNativePhysicsSimulation(
      { createBody } as unknown as INativeSimulation,
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
      { createBody } as unknown as INativeSimulation,
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
      { configureCharacter, createBody } as unknown as INativeSimulation,
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

  it("reads native sleep state through one fixed-width bulk call and fails closed", () => {
    let nextId = 0;
    const readBodySleepStates = vi.fn((buffer: Float32Array) => {
      buffer.set([0, 1, 1, 0]);
      return 2;
    });
    const removeBody = vi.fn();
    const dispose = vi.fn();
    const native = createNativePhysicsSimulation(
      {
        createBody: () => nextId++,
        dispose,
        readBodySleepStates,
        removeBody,
      } as unknown as INativeSimulation,
      "0.30.0",
    );
    native.createBody(bodyOptions());
    native.createBody(bodyOptions());

    expect(() => native.readBodySleepStates(new Float32Array(3))).toThrow(
      /sleep state buffer is too small/i,
    );
    expect(readBodySleepStates).not.toHaveBeenCalled();

    const states = new Float32Array(2 * PHYSICS_SLEEP_STATE_STRIDE);
    expect(native.readBodySleepStates(states)).toBe(2);
    expect([...states]).toEqual([0, 1, 1, 0]);
    expect(readBodySleepStates).toHaveBeenCalledOnce();

    native.removeBody(0);
    readBodySleepStates.mockImplementationOnce((buffer) => {
      buffer.set([1, 0]);
      return 1;
    });
    const remaining = new Float32Array(PHYSICS_SLEEP_STATE_STRIDE);
    expect(native.readBodySleepStates(remaining)).toBe(1);
    expect([...remaining]).toEqual([1, 0]);
    expect(removeBody).toHaveBeenCalledWith(0);

    native.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(() => native.readBodySleepStates(new Float32Array(0))).toThrow(/disposed/i);
    expect(readBodySleepStates).toHaveBeenCalledTimes(2);
  });

  it("reports Rapier sleep state truthfully and excludes removed bodies", async () => {
    await RAPIER.init();
    const web = createWebPhysicsSimulation({
      eventQueue: new RAPIER.EventQueue(true),
      rapier: RAPIER,
      version: RAPIER.version(),
      world: new RAPIER.World({ x: 0, y: 0, z: 0 }),
    });
    const sleeping = web.createBody(bodyOptions());
    web.createBody(bodyOptions());
    (sleeping.body.raw as RAPIER.RigidBody).sleep();

    expect(() => web.readBodySleepStates(new Float32Array(3))).toThrow(
      /sleep state buffer is too small/i,
    );
    const states = new Float32Array(2 * PHYSICS_SLEEP_STATE_STRIDE);
    expect(web.readBodySleepStates(states)).toBe(2);
    expect([...states]).toEqual([0, 1, 1, 0]);

    web.removeBody(0);
    const remaining = new Float32Array(PHYSICS_SLEEP_STATE_STRIDE);
    expect(web.readBodySleepStates(remaining)).toBe(1);
    expect([...remaining]).toEqual([1, 0]);

    web.dispose();
    expect(() => web.readBodySleepStates(new Float32Array(0))).toThrow(/disposed/i);
  });

  it("rejects oversized maxResults before reaching native allocations", () => {
    const intersectShape = vi.fn(() => []);
    const intersectPoint = vi.fn(() => []);
    const native = createNativePhysicsSimulation(
      { intersectPoint, intersectShape } as unknown as INativeSimulation,
      "0.30.0",
    );
    const shape = CollisionShape3D.sphere(1).descriptor;
    const oversized = 2 ** 32;

    expect(
      native.intersectShape({
        collisionMask: 1,
        maxResults: MAX_PHYSICS_QUERY_RESULTS,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        shape,
      }),
    ).toEqual([]);
    expect(
      native.intersectPoint({
        collisionMask: 1,
        maxResults: MAX_PHYSICS_QUERY_RESULTS,
        position: { x: 0, y: 0, z: 0 },
      }),
    ).toEqual([]);
    expect(() =>
      native.intersectShape({
        collisionMask: 1,
        maxResults: oversized,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        shape,
      }),
    ).toThrow(/maxResults/);
    expect(() =>
      native.intersectPoint({
        collisionMask: 1,
        maxResults: oversized,
        position: { x: 0, y: 0, z: 0 },
      }),
    ).toThrow(/maxResults/);
    expect(intersectShape).toHaveBeenCalledTimes(1);
    expect(intersectPoint).toHaveBeenCalledTimes(1);
  });

  it("maps native query records through the shared simulation boundary", () => {
    const raw = {
      createBody: vi.fn().mockReturnValue(0),
      intersectPoint: vi.fn().mockReturnValue([{ bodyId: 0, position: { x: 1, y: 2, z: 3 } }]),
      intersectRay: vi.fn().mockReturnValue({
        bodyId: 0,
        distance: 3.5,
        normal: { x: -1, y: 0, z: 0 },
        position: { x: 3.5, y: 0, z: 0 },
      }),
      intersectShape: vi.fn().mockReturnValue([{ bodyId: 0, position: { x: 1, y: 2, z: 3 } }]),
    };
    const native = createNativePhysicsSimulation(raw as unknown as INativeSimulation, "0.30.0");
    const shape = CollisionShape3D.sphere(1);
    const registration = native.createBody({
      entity: "player",
      mass: 0,
      position: { x: 0, y: 0, z: 0 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      sensor: false,
      shape: shape.descriptor,
      type: "fixed",
    });

    expect(
      native.intersectRay({
        collisionMask: 1,
        from: { x: 0, y: 0, z: 0 },
        to: { x: 10, y: 0, z: 0 },
      }),
    ).toEqual(
      expect.objectContaining({
        body: expect.objectContaining({ entity: "player", id: registration.body.id }),
        distance: 3.5,
        normal: { x: -1, y: 0, z: 0 },
        position: { x: 3.5, y: 0, z: 0 },
      }),
    );
    expect(
      native.intersectShape({
        collisionMask: 1,
        maxResults: 16,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        shape: shape.descriptor,
      })[0]?.entity,
    ).toBe("player");
    expect(
      native.intersectPoint({
        collisionMask: 1,
        maxResults: 16,
        position: { x: 0, y: 0, z: 0 },
      })[0]?.body.id,
    ).toBe(0);
  });

  it("keeps the old-runtime actuation guard removal-sensitive", () => {
    const native = createNativePhysicsSimulation({} as unknown as INativeSimulation, "0.30.0");
    const vector = { x: 1, y: 0, z: 0 };

    expect(() => native.applyBodyImpulse(0, vector)).toThrow(/TN_NATIVE_PHYSICS_ACTUATION_MISSING/);
    expect(() => native.applyBodyForce(0, vector)).toThrow(/TN_NATIVE_PHYSICS_ACTUATION_MISSING/);
    expect(() => native.applyBodyForceAtPoint(0, vector, vector)).toThrow(
      /TN_NATIVE_PHYSICS_ACTUATION_MISSING/,
    );
    expect(() => native.setBodyLinearVelocity(0, vector)).toThrow(
      /TN_NATIVE_PHYSICS_ACTUATION_MISSING/,
    );
    expect(() => native.readBodyLinearVelocity(0)).toThrow(/TN_NATIVE_PHYSICS_ACTUATION_MISSING/);
  });

  it("forwards native actuation and refuses malformed or disposed calls", () => {
    const applyBodyImpulse = vi.fn();
    const applyBodyForce = vi.fn();
    const applyBodyForceAtPoint = vi.fn();
    const setBodyLinearVelocity = vi.fn();
    const readBodyLinearVelocity = vi.fn(() => ({ x: 4, y: 0, z: 0 }));
    const dispose = vi.fn();
    const native = createNativePhysicsSimulation(
      {
        applyBodyForce,
        applyBodyForceAtPoint,
        applyBodyImpulse,
        dispose,
        readBodyLinearVelocity,
        setBodyLinearVelocity,
      } as unknown as INativeSimulation,
      "0.30.0",
    );

    native.applyBodyImpulse(7, { x: 1, y: 2, z: 3 });
    native.applyBodyForce(7, { x: 4, y: 5, z: 6 });
    native.applyBodyForceAtPoint(7, { x: 10, y: 11, z: 12 }, { x: 13, y: 14, z: 15 });
    native.setBodyLinearVelocity(7, { x: 7, y: 8, z: 9 });

    expect(applyBodyImpulse).toHaveBeenCalledWith(7, { x: 1, y: 2, z: 3 });
    expect(applyBodyForce).toHaveBeenCalledWith(7, { x: 4, y: 5, z: 6 });
    expect(applyBodyForceAtPoint).toHaveBeenCalledWith(
      7,
      { x: 10, y: 11, z: 12 },
      { x: 13, y: 14, z: 15 },
    );
    expect(setBodyLinearVelocity).toHaveBeenCalledWith(7, { x: 7, y: 8, z: 9 });
    expect(native.readBodyLinearVelocity(7)).toEqual({ x: 4, y: 0, z: 0 });

    expect(() => native.applyBodyImpulse(7, { x: Number.NaN, y: 0, z: 0 })).toThrow(
      /TN_PHYSICS_NON_FINITE/,
    );
    expect(applyBodyImpulse).toHaveBeenCalledTimes(1);

    native.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(() => native.applyBodyForce(7, { x: 1, y: 0, z: 0 })).toThrow(/disposed/i);
    expect(() => native.readBodyLinearVelocity(7)).toThrow(/disposed/i);
  });

  it("rejects non-finite or zero-length body placement at both seams before the backend", async () => {
    // Impulse, force, and velocity already reject non-finite values at this seam;
    // createBody did not, so a NaN spawn position reached Rapier and surfaced
    // frames later as a body that silently vanished. A zero-length quaternion on
    // a kinematic input normalizes to NaN inside Rapier for the same reason.
    await RAPIER.init();
    const web = createWebPhysicsSimulation({
      eventQueue: new RAPIER.EventQueue(true),
      rapier: RAPIER,
      version: RAPIER.version(),
      world: new RAPIER.World({ x: 0, y: -9.81, z: 0 }),
    });
    expect(() =>
      web.createBody({ ...bodyOptions(), position: { x: Number.NaN, y: 0, z: 0 } }),
    ).toThrow(/TN_PHYSICS_NON_FINITE.*position/u);
    expect(() =>
      web.createBody({ ...bodyOptions(), rotation: { w: 0, x: 0, y: 0, z: 0 } }),
    ).toThrow(/TN_PHYSICS_INVALID.*rotation/u);
    web.dispose();

    const createBody = vi.fn(() => 1);
    const native = createNativePhysicsSimulation(
      { createBody } as unknown as INativeSimulation,
      "0.30.0",
    );
    expect(() =>
      native.createBody({
        ...bodyOptions(),
        position: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 },
      }),
    ).toThrow(/TN_PHYSICS_NON_FINITE.*position/u);
    expect(() =>
      native.createBody({ ...bodyOptions(), rotation: { w: 0, x: 0, y: 0, z: 0 } }),
    ).toThrow(/TN_PHYSICS_INVALID.*rotation/u);
    expect(createBody).not.toHaveBeenCalled();
  });

  it("refuses body creation and removal on a disposed native adapter like the web adapter", () => {
    // Every other native-adapter entry point guards with requireLive(); createBody
    // and removeBody let calls through after dispose(), so teardown ordering that
    // the web backend rejects with a clean throw reached the native host past its
    // lifetime instead — one bug, two platforms, two different outcomes.
    const createBody = vi.fn(() => 1);
    const removeBody = vi.fn();
    const native = createNativePhysicsSimulation(
      { createBody, dispose: vi.fn(), removeBody } as unknown as INativeSimulation,
      "0.30.0",
    );
    native.dispose();

    expect(() => native.createBody(bodyOptions())).toThrow(/disposed/i);
    expect(() => native.removeBody(1)).toThrow(/disposed/i);
    expect(createBody).not.toHaveBeenCalled();
    expect(removeBody).not.toHaveBeenCalled();
  });
});
