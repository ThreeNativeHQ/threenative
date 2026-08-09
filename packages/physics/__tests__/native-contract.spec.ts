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
});
