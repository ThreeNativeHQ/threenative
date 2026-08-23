import * as RAPIER from "@dimforge/rapier3d-compat";
import { describe, expect, it, vi } from "vitest";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { type INativeSimulation, createNativePhysicsSimulation } from "../src/native/host.js";
import { createWebPhysicsSimulation } from "../src/simulation.js";

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

function rayQuery() {
  return { collisionMask: 1, from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 0, z: 0 } };
}

function shapeQuery() {
  return {
    collisionMask: 1,
    maxResults: 4,
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    shape: CollisionShape3D.sphere(0.5).descriptor,
  };
}

function characterOptions() {
  return { maxSlopeClimbAngle: 0, offset: 0, oneWayLayers: 0 };
}

/**
 * After dispose() both backends have freed their backend state (the C++ world on native,
 * `world.free()` + `eventQueue.free()` on web). Every post-step surface must therefore throw
 * the shared "Physics simulation is disposed." error instead of reaching freed backend memory
 * or silently returning stale data.
 */
describe("post-dispose contract", () => {
  it("rejects every post-step surface on native without reaching the freed host", () => {
    const raw = {
      areaIntersections: vi.fn(() => 0),
      configureCharacter: vi.fn(),
      createBody: vi.fn(() => 0),
      dispose: vi.fn(),
      drainCollisionEvents: vi.fn(() => 0),
      intersectPoint: vi.fn(() => []),
      intersectRay: vi.fn(() => null),
      intersectShape: vi.fn(() => []),
      readAreaIntersections: vi.fn(() => 0),
      readCharacterStates: vi.fn(() => 0),
      readVisibleTransforms: vi.fn(() => 0),
      removeBody: vi.fn(),
      setBodyTransform: vi.fn(),
      step: vi.fn(),
    };
    const native = createNativePhysicsSimulation(raw as unknown as INativeSimulation, "0.30.0");
    native.createBody(bodyOptions());
    native.dispose();

    expect(() => native.step(1 / 60)).toThrow(/Physics simulation is disposed\./);
    expect(raw.step).not.toHaveBeenCalled();

    expect(() => native.setBodyTransform(0, { x: 0, y: 0, z: 0 })).toThrow(
      /Physics simulation is disposed\./,
    );
    expect(raw.setBodyTransform).not.toHaveBeenCalled();

    expect(() => native.configureCharacter(0, characterOptions())).toThrow(
      /Physics simulation is disposed\./,
    );
    expect(raw.configureCharacter).not.toHaveBeenCalled();

    expect(() => native.intersectRay(rayQuery())).toThrow(/Physics simulation is disposed\./);
    expect(raw.intersectRay).not.toHaveBeenCalled();

    expect(() => native.intersectShape(shapeQuery())).toThrow(/Physics simulation is disposed\./);
    expect(raw.intersectShape).not.toHaveBeenCalled();

    expect(() =>
      native.intersectPoint({ collisionMask: 1, maxResults: 4, position: { x: 0, y: 0, z: 0 } }),
    ).toThrow(/Physics simulation is disposed\./);
    expect(raw.intersectPoint).not.toHaveBeenCalled();

    expect(() => native.readVisibleTransforms(new Float32Array(64))).toThrow(
      /Physics simulation is disposed\./,
    );
    expect(raw.readVisibleTransforms).not.toHaveBeenCalled();

    expect(() => native.drainCollisionEvents(new Uint32Array(16))).toThrow(
      /Physics simulation is disposed\./,
    );
    expect(raw.drainCollisionEvents).not.toHaveBeenCalled();

    expect(native.readCharacterState).toBeDefined();
    expect(() => native.readCharacterState?.(0)).toThrow(/Physics simulation is disposed\./);
    expect(raw.readCharacterStates).not.toHaveBeenCalled();

    expect(native.areaIntersections).toBeDefined();
    expect(() => native.areaIntersections?.(0)).toThrow(/Physics simulation is disposed\./);
    expect(raw.readAreaIntersections).not.toHaveBeenCalled();
  });

  it("rejects every post-step surface on web instead of touching the freed Rapier world", async () => {
    await RAPIER.init();
    const web = createWebPhysicsSimulation({
      eventQueue: new RAPIER.EventQueue(true),
      rapier: RAPIER,
      version: RAPIER.version(),
      world: new RAPIER.World({ x: 0, y: 0, z: 0 }),
    });
    web.createBody(bodyOptions());
    web.dispose();

    expect(() => web.step(1 / 60)).toThrow(/Physics simulation is disposed\./);
    expect(() => web.setBodyTransform(0, { x: 0, y: 0, z: 0 })).toThrow(
      /Physics simulation is disposed\./,
    );
    expect(() => web.configureCharacter(0, characterOptions())).toThrow(
      /Physics simulation is disposed\./,
    );
    expect(() => web.intersectRay(rayQuery())).toThrow(/Physics simulation is disposed\./);
    expect(() => web.intersectShape(shapeQuery())).toThrow(/Physics simulation is disposed\./);
    expect(() =>
      web.intersectPoint({ collisionMask: 1, maxResults: 4, position: { x: 0, y: 0, z: 0 } }),
    ).toThrow(/Physics simulation is disposed\./);
    expect(() => web.readVisibleTransforms(new Float32Array(64))).toThrow(
      /Physics simulation is disposed\./,
    );
    expect(() => web.drainCollisionEvents(new Uint32Array(16))).toThrow(
      /Physics simulation is disposed\./,
    );
    expect(web.readCharacterState).toBeDefined();
    expect(() => web.readCharacterState?.(0)).toThrow(/Physics simulation is disposed\./);
    expect(web.areaIntersections).toBeDefined();
    expect(() => web.areaIntersections?.(0)).toThrow(/Physics simulation is disposed\./);
  });
});
