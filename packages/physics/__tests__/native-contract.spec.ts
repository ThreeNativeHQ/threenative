import * as RAPIER from "@dimforge/rapier3d-compat";
import { afterEach, describe, expect, it } from "vitest";
import { Area3D } from "../src/Area3D.js";
import { CharacterBody3D } from "../src/CharacterBody3D.js";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { RigidBody3D } from "../src/RigidBody3D.js";
import {
  type NativeBodyOptions,
  type NativeSimulation,
  createNativePhysicsSimulation,
} from "../src/native/host.js";
import {
  Area3D as NativeArea3D,
  CharacterBody3D as NativeCharacterBody3D,
  CollisionShape3D as NativeCollisionShape3D,
  RigidBody3D as NativeRigidBody3D,
} from "../src/native/index.js";
import {
  type PhysicsCharacterOptions,
  type PhysicsInputSnapshot,
  type PhysicsRuntimeSimulation,
  createWebPhysicsSimulation,
} from "../src/simulation.js";

class NativeHostOverWeb implements NativeSimulation {
  readonly #areas = new Set<number>();
  readonly #characters = new Set<number>();
  readonly #simulation: PhysicsRuntimeSimulation;

  constructor(simulation: PhysicsRuntimeSimulation) {
    this.#simulation = simulation;
  }

  createBody(options: NativeBodyOptions): number {
    const registration = this.#simulation.createBody({
      mass: options.mass,
      position: options.position,
      rotation: options.rotation,
      sensor: options.sensor,
      shape: options.shape,
      type: options.type,
    });
    if (options.type === "character") this.#characters.add(registration.body.id);
    if (options.sensor) this.#areas.add(registration.body.id);
    return registration.body.id;
  }

  configureCharacter(id: number, options: PhysicsCharacterOptions): void {
    this.#simulation.configureCharacter(id, options);
  }

  removeBody(id: number): void {
    this.#simulation.removeBody(id);
    this.#characters.delete(id);
    this.#areas.delete(id);
  }

  setBodyTransform(id: number, position: { x: number; y: number; z: number }): void {
    this.#simulation.setBodyTransform(id, position);
  }

  step(deltaTime: number, input?: PhysicsInputSnapshot): void {
    this.#simulation.step(deltaTime, input);
  }

  readVisibleTransforms(buffer: Float32Array): number {
    return this.#simulation.readVisibleTransforms(buffer);
  }

  readCharacterStates(buffer: Float32Array): number {
    if (buffer.length < this.#characters.size * 3) throw new Error("buffer is too small");
    let index = 0;
    for (const id of this.#characters) {
      const state = this.#simulation.readCharacterState?.(id);
      buffer.set([id, state?.grounded === true ? 1 : 0, state?.groundCollider ?? -1], index * 3);
      index += 1;
    }
    return index;
  }

  readAreaIntersections(buffer: Uint32Array): number {
    let index = 0;
    for (const areaId of this.#areas) {
      for (const bodyId of this.#simulation.areaIntersections?.(areaId) ?? []) {
        if ((index + 1) * 2 > buffer.length) throw new Error("buffer is too small");
        buffer.set([areaId, bodyId], index * 2);
        index += 1;
      }
    }
    return index;
  }

  drainCollisionEvents(buffer: Uint32Array): number {
    return this.#simulation.drainCollisionEvents(buffer);
  }

  dispose(): void {
    this.#simulation.dispose();
    this.#areas.clear();
    this.#characters.clear();
  }
}

function webSimulation(): PhysicsRuntimeSimulation {
  return createWebPhysicsSimulation({
    eventQueue: new RAPIER.EventQueue(true),
    rapier: RAPIER,
    version: RAPIER.version(),
    world: new RAPIER.World({ x: 0, y: 0, z: 0 }),
  });
}

async function runConformanceScenario(simulation: PhysicsRuntimeSimulation) {
  const floor = simulation.createBody({
    mass: 0,
    position: { x: 0, y: -0.1, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    sensor: false,
    shape: CollisionShape3D.box(10, 0.2, 10).descriptor,
    type: "fixed",
  });
  const character = simulation.createBody({
    mass: 0,
    position: { x: 0, y: 0.5, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    sensor: false,
    shape: CollisionShape3D.capsule(0.2, 0.3).descriptor,
    type: "character",
  });
  simulation.configureCharacter(character.body.id, {
    autostep: { includeDynamicBodies: false, maxHeight: 0.4, minWidth: 0.2 },
    maxSlopeClimbAngle: Math.PI / 4,
    offset: 0.01,
    oneWayLayers: 2,
    snapToGround: 0.1,
  });
  const input = new Float32Array(8);
  const output = new Float32Array(16);
  for (let step = 0; step < 10; step += 1) {
    simulation.readVisibleTransforms(output);
    const characterOffset = output[0] === character.body.id ? 0 : 8;
    input.set([
      character.body.id,
      (output[characterOffset + 1] ?? 0) + 0.02,
      (output[characterOffset + 2] ?? 0) - 0.02,
      output[characterOffset + 3] ?? 0,
      0,
      Math.sin(Math.PI / 8),
      0,
      Math.cos(Math.PI / 8),
    ]);
    simulation.step(1 / 60, { kinematicCount: 1, kinematicTransforms: input });
  }
  simulation.readVisibleTransforms(output);
  const state = simulation.readCharacterState?.(character.body.id);
  const transforms = [...output];
  simulation.removeBody(floor.body.id);
  simulation.removeBody(character.body.id);
  simulation.dispose();
  return { state, transforms };
}

function runAreaScenario(simulation: PhysicsRuntimeSimulation): number[] {
  const areaShape = CollisionShape3D.box(2, 2, 2).descriptor;
  areaShape.collisionLayer = 8;
  areaShape.collisionMask = 2;
  const bodyShape = CollisionShape3D.box(1, 1, 1).descriptor;
  bodyShape.collisionLayer = 2;
  bodyShape.collisionMask = 4;
  const area = simulation.createBody({
    mass: 0,
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    sensor: true,
    shape: areaShape,
    type: "kinematic",
  });
  const body = simulation.createBody({
    mass: 0,
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    sensor: false,
    shape: bodyShape,
    type: "fixed",
  });
  simulation.step(1 / 60, {
    kinematicCount: 1,
    kinematicTransforms: new Float32Array([area.body.id, 0, 0, 0, 0, 0, 0, 1]),
  });
  simulation.readVisibleTransforms(new Float32Array(16));
  const result = [...(simulation.areaIntersections?.(area.body.id) ?? [])];
  expect(result).toEqual([body.body.id]);
  simulation.dispose();
  return result;
}

describe("two-backend physics conformance", () => {
  afterEach(() => {
    globalThis.__THREENATIVE_NATIVE__ = undefined;
  });

  it("exports one shared class for every public node", () => {
    expect(NativeArea3D).toBe(Area3D);
    expect(NativeCharacterBody3D).toBe(CharacterBody3D);
    expect(NativeCollisionShape3D).toBe(CollisionShape3D);
    expect(NativeRigidBody3D).toBe(RigidBody3D);
  });

  it("produces the same character transforms and state through both adapters", async () => {
    await RAPIER.init();
    const web = webSimulation();
    const native = createNativePhysicsSimulation(new NativeHostOverWeb(webSimulation()), "0.30.0");
    const webResult = await runConformanceScenario(web);
    const nativeResult = await runConformanceScenario(native);

    expect(nativeResult.transforms).toEqual(webResult.transforms);
    expect(nativeResult.state).toEqual(webResult.state);
    expect(nativeResult.state?.grounded).toBe(true);
  });

  it("uses Area3D's mask on both backends when the body does not scan the area", async () => {
    await RAPIER.init();
    const webResult = runAreaScenario(webSimulation());
    const nativeResult = runAreaScenario(
      createNativePhysicsSimulation(new NativeHostOverWeb(webSimulation()), "0.30.0"),
    );
    expect(nativeResult).toEqual(webResult);
  });

  it("rejects native shapes outside the ABI instead of silently dropping them", async () => {
    await RAPIER.init();
    const native = createNativePhysicsSimulation(new NativeHostOverWeb(webSimulation()), "0.30.0");
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
    native.dispose();
  });
});
