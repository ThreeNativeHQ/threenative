import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as RAPIER from "@dimforge/rapier3d-compat";
import type { ICtx } from "@threenative/core";
import { BoxGeometry, Mesh } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CharacterBody3D } from "../src/CharacterBody3D.js";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { RigidBody3D } from "../src/RigidBody3D.js";
import { type IPhysicsContext, rapier } from "../src/plugin.js";
import "../src/index.js";
import { type INativeSimulation, createNativePhysicsSimulation } from "../src/native/host.js";
import {
  type IPhysicsBodyCreateOptions,
  type IPhysicsRuntimeSimulation,
  type IPhysicsSimulation,
  PHYSICS_COLLISION_EVENT_STRIDE,
  PHYSICS_TRANSFORM_STRIDE,
  createWebPhysicsSimulation,
} from "../src/simulation.js";

interface IScenarioBody {
  readonly id: number;
  readonly name: string;
  readonly type: IPhysicsBodyCreateOptions["type"];
  readonly shape: "box" | "capsule" | "sphere";
  readonly shapeSize: readonly [number, number, number];
  readonly position: readonly [number, number, number];
  readonly mass: number;
  readonly collisionLayer: number;
  readonly collisionMask: number;
  readonly sensor: boolean;
}

interface IScenarioMotion {
  readonly bodyId: number;
  readonly startStep: number;
  readonly endStep: number;
  readonly delta: readonly [number, number, number];
}

interface IParityScenario {
  readonly schemaVersion: number;
  readonly expectedRapierVersions: { readonly web: string; readonly rust: string };
  readonly gravity: readonly [number, number, number];
  readonly deltaTime: number;
  readonly steps: number;
  readonly removeAtStep: number;
  readonly removeBodyId: number;
  readonly teleportAtStep: number;
  readonly teleportBodyId: number;
  readonly teleportPosition: readonly [number, number, number];
  readonly bodies: readonly IScenarioBody[];
  readonly character: {
    readonly bodyId: number;
    readonly offset: number;
    readonly maxSlopeClimbAngle: number;
    readonly autostep: readonly [number, number, number];
    readonly snapToGround: number;
    readonly oneWayLayers: number;
  };
  readonly motions: readonly IScenarioMotion[];
  readonly checkpoints: readonly number[];
}

interface IArmObservation {
  readonly arm: "web";
  readonly rapierVersion: string;
  readonly scenarioSha256: string;
  readonly bodyCount: number;
  readonly restingPosition: readonly [number, number, number];
  readonly characterDisplacement: readonly [number, number, number];
  readonly grounded: boolean;
  readonly groundCollider: number | null;
  readonly groundNormal: readonly [number, number, number];
  readonly areaMembership: readonly number[];
  readonly areaMembershipSnapshots: readonly string[];
  readonly collisionEventSet: readonly string[];
  readonly collisionEventSequence: readonly string[];
  readonly removeStoppedEventCount: number;
  readonly freshnessBeforeVisible: { readonly statePresent: boolean; readonly areaCount: number };
  readonly teleportState: {
    readonly beforeGrounded: boolean;
    readonly afterGrounded: boolean;
    readonly beforeGroundCollider: number | null;
    readonly afterGroundCollider: number | null;
  };
  readonly validationOutcomes: Readonly<Record<string, string>>;
  readonly averageStepNanoseconds: number;
  readonly quadraticBufferBytes: { readonly event: number; readonly area: number };
  readonly scenarioCoverage: {
    readonly oneWayPassedUpward: boolean;
    readonly platformGroundedObserved: boolean;
    readonly areaExcludedCharacter: boolean;
  };
  readonly feetOnFloor: {
    readonly grounded: boolean;
    readonly groundCollider: number | null;
    readonly groundNormal: readonly [number, number, number];
    readonly position: readonly [number, number, number];
  };
}

const fixturePath = fileURLToPath(
  new URL("./fixtures/physics-parity.scenario.json", import.meta.url),
);
const webArtifactPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../runtime-native/native/physics/target/parity-web.json",
);
const fixtureBytes = readFileSync(fixturePath);
const scenario = JSON.parse(fixtureBytes.toString("utf8")) as IParityScenario;
const scenarioSha256 = createHash("sha256").update(fixtureBytes).digest("hex");
let observation: IArmObservation;

function shape(body: IScenarioBody): IPhysicsBodyCreateOptions["shape"] {
  return {
    collisionLayer: body.collisionLayer,
    collisionMask: body.collisionMask,
    kind: body.shape,
    sensor: body.sensor,
    x: body.shapeSize[0],
    y: body.shapeSize[1],
    z: body.shapeSize[2],
  };
}

function createSimulation(): IPhysicsRuntimeSimulation {
  return createWebPhysicsSimulation({
    eventQueue: new RAPIER.EventQueue(true),
    rapier: RAPIER,
    version: RAPIER.version(),
    world: new RAPIER.World({
      x: scenario.gravity[0],
      y: scenario.gravity[1],
      z: scenario.gravity[2],
    }),
  });
}

async function runFeetOnFloorSubject(): Promise<IArmObservation["feetOnFloor"]> {
  const plugin = rapier({
    gravity: { x: scenario.gravity[0], y: scenario.gravity[1], z: scenario.gravity[2] },
  });
  const ctx = { physics: undefined } as unknown as ICtx<Record<string, unknown>, IPhysicsContext>;
  await plugin.setup?.(ctx);
  const physics = ctx.physics;
  if (physics === undefined)
    throw new Error("feet-on-floor subject did not create a physics context");

  const floorMesh = new Mesh(new BoxGeometry(10, 0.2, 4));
  floorMesh.position.set(0, -0.1, 0);
  const floor = new RigidBody3D({
    object: floorMesh,
    physics,
    shape: CollisionShape3D.box(10, 0.2, 4),
    type: "fixed",
  });
  const characterMesh = new Mesh(new BoxGeometry(0.6, 1, 0.6));
  characterMesh.position.set(0, 0.5, 0);
  const character = new CharacterBody3D({
    gravity: scenario.gravity[1],
    maxSlopeClimbAngle: Math.PI / 4,
    object: characterMesh,
    offset: 0.01,
    oneWayLayers: 0,
    physics,
    shape: CollisionShape3D.capsule(0.2, 0.3),
  });

  try {
    for (let step = 0; step < 30; step += 1) {
      character.moveAndSlide(1 / 60);
      plugin.update?.(ctx, 1 / 60);
    }
    return {
      grounded: character.grounded,
      groundCollider: character.groundBody?.id ?? null,
      groundNormal: [character.groundNormal.x, character.groundNormal.y, character.groundNormal.z],
      position: [characterMesh.position.x, characterMesh.position.y, characterMesh.position.z],
    };
  } finally {
    character.dispose();
    floor.dispose();
    plugin.dispose?.(ctx);
  }
}

function transforms(
  simulation: IPhysicsRuntimeSimulation,
): Map<number, [number, number, number, number, number, number, number]> {
  const buffer = new Float32Array(scenario.bodies.length * PHYSICS_TRANSFORM_STRIDE);
  const count = simulation.readVisibleTransforms(buffer);
  const result = new Map<number, [number, number, number, number, number, number, number]>();
  for (let index = 0; index < count; index += 1) {
    const offset = index * PHYSICS_TRANSFORM_STRIDE;
    result.set(buffer[offset] as number, [
      buffer[offset + 1] as number,
      buffer[offset + 2] as number,
      buffer[offset + 3] as number,
      buffer[offset + 4] as number,
      buffer[offset + 5] as number,
      buffer[offset + 6] as number,
      buffer[offset + 7] as number,
    ]);
  }
  return result;
}

function outcome(action: () => void): string {
  try {
    action();
    return "accepted";
  } catch (error) {
    return error instanceof Error ? error.constructor.name : "unknown-error";
  }
}

function validationAdapters(): {
  readonly native: IPhysicsSimulation;
  readonly raw: INativeSimulation;
  readonly web: IPhysicsSimulation;
} {
  let nextId = 0;
  const raw: INativeSimulation = {
    configureCharacter: vi.fn(),
    createBody: vi.fn(() => nextId++),
    dispose: vi.fn(),
    drainCollisionEvents: vi.fn(() => 0),
    readAreaIntersections: vi.fn(() => 0),
    readBodySleepStates: vi.fn(() => 0),
    readCharacterStates: vi.fn(() => 0),
    readVisibleTransforms: vi.fn(() => 0),
    removeBody: vi.fn(),
    setBodyTransform: vi.fn(),
    step: vi.fn(),
    intersectRay: vi.fn(() => 0),
    intersectShape: vi.fn(() => []),
    intersectPoint: vi.fn(() => []),
  };
  const web = createSimulation();
  const native = createNativePhysicsSimulation(raw, "0.30.0");
  const body: IPhysicsBodyCreateOptions = {
    mass: 0,
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    sensor: false,
    shape: {
      collisionLayer: 1,
      collisionMask: 65535,
      kind: "box",
      sensor: false,
      x: 1,
      y: 1,
      z: 1,
    },
    type: "fixed",
  };
  web.createBody(body);
  native.createBody(body);
  return { native, raw, web };
}

function errorClass(action: () => void): typeof Error | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    return error instanceof Error ? (error.constructor as typeof Error) : undefined;
  }
}

function transformWith(index: number, value: number): Float32Array {
  const transform = new Float32Array([0, 0, 0, 0, 0, 0, 0, 1]);
  transform[index] = value;
  return transform;
}

function validationOutcomes(): Record<string, string> {
  const simulation = createSimulation();
  simulation.createBody({
    mass: 0,
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    sensor: false,
    shape: {
      collisionLayer: 1,
      collisionMask: 65535,
      kind: "box",
      sensor: false,
      x: 1,
      y: 1,
      z: 1,
    },
    type: "fixed",
  });
  const outcomes = {
    nonFiniteDelta: outcome(() => simulation.step(Number.NaN)),
    float64Input: outcome(() =>
      simulation.step(1 / 60, {
        kinematicCount: 0,
        kinematicTransforms: new Float64Array(0) as unknown as Float32Array,
      }),
    ),
    oversizedKinematicCount: outcome(() =>
      simulation.step(1 / 60, {
        kinematicCount: 1,
        kinematicTransforms: new Float32Array(0),
      }),
    ),
    unknownKinematicId: outcome(() =>
      simulation.step(1 / 60, {
        kinematicCount: 1,
        kinematicTransforms: new Float32Array([999, 0, 0, 0, 0, 0, 0, 1]),
      }),
    ),
    unknownRemoveBody: outcome(() => simulation.removeBody(999)),
    undersizedRenderBuffer: outcome(() => simulation.readVisibleTransforms(new Float32Array(0))),
  };
  simulation.dispose();
  return outcomes;
}

function drainEvents(simulation: IPhysicsRuntimeSimulation): string[] {
  const buffer = new Uint32Array(
    scenario.bodies.length * scenario.bodies.length * PHYSICS_COLLISION_EVENT_STRIDE,
  );
  const count = simulation.drainCollisionEvents(buffer);
  const events: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = index * PHYSICS_COLLISION_EVENT_STRIDE;
    const left = buffer[offset] as number;
    const right = buffer[offset + 1] as number;
    events.push(`${Math.min(left, right)}-${Math.max(left, right)}-${buffer[offset + 2]}`);
  }
  return events;
}

async function runScenario(): Promise<IArmObservation> {
  const simulation = createSimulation();
  for (const body of scenario.bodies) {
    const created = simulation.createBody({
      mass: body.mass,
      position: { x: body.position[0], y: body.position[1], z: body.position[2] },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      sensor: body.sensor,
      shape: shape(body),
      type: body.type,
    });
    expect(created.body.id, `${body.name} must retain its fixture id`).toBe(body.id);
  }
  simulation.configureCharacter(scenario.character.bodyId, {
    autostep: {
      includeDynamicBodies: scenario.character.autostep[2] === 1,
      maxHeight: scenario.character.autostep[0],
      minWidth: scenario.character.autostep[1],
    },
    maxSlopeClimbAngle: scenario.character.maxSlopeClimbAngle,
    offset: scenario.character.offset,
    oneWayLayers: scenario.character.oneWayLayers,
    snapToGround: scenario.character.snapToGround,
  });

  const initial = transforms(simulation);
  const initialCharacter = initial.get(scenario.character.bodyId);
  if (initialCharacter === undefined) throw new Error("Parity scenario is missing its character");
  const allEvents: string[] = [];
  const areaSnapshots: string[] = [];
  let freshnessBeforeVisible = { areaCount: -1, statePresent: false };
  let removeStoppedEventCount = 0;
  let teleportState = {
    afterGroundCollider: null as number | null,
    afterGrounded: false,
    beforeGroundCollider: null as number | null,
    beforeGrounded: false,
  };
  let elapsedNanoseconds = 0;
  let characterMaxY = initialCharacter[1];
  let platformGroundedObserved = false;

  for (let step = 0; step < scenario.steps; step += 1) {
    if (step === scenario.removeAtStep) {
      simulation.removeBody(scenario.removeBodyId);
      const removalEvents = drainEvents(simulation);
      removeStoppedEventCount = removalEvents.filter(
        (event) => event.includes(`-${scenario.removeBodyId}-`) && event.endsWith("-0"),
      ).length;
      allEvents.push(...removalEvents);
    }
    if (step === scenario.teleportAtStep) {
      const before = simulation.readCharacterState?.(scenario.teleportBodyId);
      simulation.setBodyTransform(scenario.teleportBodyId, {
        x: scenario.teleportPosition[0],
        y: scenario.teleportPosition[1],
        z: scenario.teleportPosition[2],
      });
      const after = simulation.readCharacterState?.(scenario.teleportBodyId);
      teleportState = {
        afterGroundCollider: after?.groundCollider ?? null,
        afterGrounded: after?.grounded ?? false,
        beforeGroundCollider: before?.groundCollider ?? null,
        beforeGrounded: before?.grounded ?? false,
      };
    }

    const current = transforms(simulation);
    const active = scenario.motions.filter(
      (motion) => step >= motion.startStep && step < motion.endStep,
    );
    const input = new Float32Array(active.length * PHYSICS_TRANSFORM_STRIDE);
    for (const [index, motion] of active.entries()) {
      const position = current.get(motion.bodyId);
      if (position === undefined)
        throw new Error(`Motion references missing body ${motion.bodyId}`);
      input.set(
        [
          motion.bodyId,
          position[0] + motion.delta[0],
          position[1] + motion.delta[1],
          position[2] + motion.delta[2],
          0,
          0,
          0,
          1,
        ],
        index * PHYSICS_TRANSFORM_STRIDE,
      );
    }
    const started = process.hrtime.bigint();
    simulation.step(scenario.deltaTime, {
      kinematicCount: active.length,
      kinematicTransforms: input,
    });
    elapsedNanoseconds += Number(process.hrtime.bigint() - started);

    if (step === 0) {
      const state = simulation.readCharacterState?.(scenario.character.bodyId);
      freshnessBeforeVisible = {
        areaCount: simulation.areaIntersections?.(5).size ?? -1,
        statePresent: state !== undefined,
      };
    }
    const postStepCharacter = transforms(simulation).get(scenario.character.bodyId);
    if (postStepCharacter !== undefined)
      characterMaxY = Math.max(characterMaxY, postStepCharacter[1]);
    const postStepState = simulation.readCharacterState?.(scenario.character.bodyId);
    if (postStepState?.grounded === true && postStepState.groundCollider === 2)
      platformGroundedObserved = true;
    allEvents.push(...drainEvents(simulation));
    if (scenario.checkpoints.includes(step)) {
      areaSnapshots.push(
        [...(simulation.areaIntersections?.(5) ?? [])]
          .sort((left, right) => left - right)
          .join(","),
      );
    }
  }

  const final = transforms(simulation);
  const restingTransform = final.get(1);
  const finalCharacter = final.get(scenario.character.bodyId);
  if (restingTransform === undefined || finalCharacter === undefined)
    throw new Error("Parity scenario did not produce final transforms");
  const state = simulation.readCharacterState?.(scenario.character.bodyId);
  const areaMembership = [...(simulation.areaIntersections?.(5) ?? [])].sort(
    (left, right) => left - right,
  );
  const feetOnFloor = await runFeetOnFloorSubject();
  const result: IArmObservation = {
    arm: "web",
    areaMembership,
    areaMembershipSnapshots: areaSnapshots,
    averageStepNanoseconds: elapsedNanoseconds / scenario.steps,
    bodyCount: scenario.bodies.length,
    characterDisplacement: [
      finalCharacter[0] - initialCharacter[0],
      finalCharacter[1] - initialCharacter[1],
      finalCharacter[2] - initialCharacter[2],
    ],
    collisionEventSet: [...new Set(allEvents)].sort(),
    collisionEventSequence: allEvents,
    freshnessBeforeVisible,
    groundCollider: state?.groundCollider ?? null,
    groundNormal: [
      state?.groundNormal?.x ?? 0,
      state?.groundNormal?.y ?? 1,
      state?.groundNormal?.z ?? 0,
    ],
    grounded: state?.grounded ?? false,
    quadraticBufferBytes: {
      area: scenario.bodies.length ** 2 * 2 * Uint32Array.BYTES_PER_ELEMENT,
      event:
        scenario.bodies.length ** 2 *
        PHYSICS_COLLISION_EVENT_STRIDE *
        Uint32Array.BYTES_PER_ELEMENT,
    },
    rapierVersion: RAPIER.version(),
    removeStoppedEventCount,
    restingPosition: [restingTransform[0], restingTransform[1], restingTransform[2]],
    scenarioSha256,
    scenarioCoverage: {
      areaExcludedCharacter: !areaMembership.includes(scenario.character.bodyId),
      oneWayPassedUpward: characterMaxY > 1.23,
      platformGroundedObserved,
    },
    teleportState,
    validationOutcomes: validationOutcomes(),
    feetOnFloor,
  };
  // `computedCollision()` leaves a wasm-bindgen borrow alive in Rapier 0.19.3, so freeing the
  // world after reading character state throws. This short-lived measurement process owns the
  // world until exit; avoiding that cleanup bug does not change any observation above.
  return result;
}

beforeAll(async () => {
  await RAPIER.init();
  observation = await runScenario();
  mkdirSync(dirname(webArtifactPath), { recursive: true });
  writeFileSync(webArtifactPath, `${JSON.stringify(observation, null, 2)}\n`);
});

describe("physics parity web measurement arm", () => {
  it("should read the shared scenario and resolve the expected web Rapier identity", () => {
    expect(scenario.schemaVersion).toBe(1);
    expect(scenarioSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(observation.scenarioSha256).toBe(scenarioSha256);
    expect(observation.rapierVersion).toBe(scenario.expectedRapierVersions.web);
    expect(observation.rapierVersion).not.toBe(scenario.expectedRapierVersions.rust);
  });

  it("should measure feet-on-floor through the public CharacterBody3D lifecycle", () => {
    expect(observation.feetOnFloor.grounded).toBe(true);
    expect(observation.feetOnFloor.groundCollider).toBe(0);
    expect(observation.feetOnFloor.groundNormal[0]).toBeCloseTo(0, 5);
    expect(observation.feetOnFloor.groundNormal[1]).toBeCloseTo(1, 5);
    expect(observation.feetOnFloor.groundNormal[2]).toBeCloseTo(0, 2);
    expect(observation.feetOnFloor.position[1]).toBeGreaterThan(0.5);
  });

  it("should report every tolerance row with a finite measurement", () => {
    expect(observation.restingPosition.every(Number.isFinite)).toBe(true);
    expect(observation.characterDisplacement.every(Number.isFinite)).toBe(true);
    expect(typeof observation.grounded).toBe("boolean");
    expect(observation.areaMembership).toBeDefined();
    expect(observation.collisionEventSet).toBeDefined();
    expect(observation.collisionEventSequence).toBeDefined();
    expect(Object.keys(observation.validationOutcomes)).toHaveLength(6);
    expect(observation.averageStepNanoseconds).toBeGreaterThan(0);
    expect(observation.areaMembershipSnapshots).toHaveLength(scenario.checkpoints.length);
    expect(observation.scenarioCoverage).toEqual({
      areaExcludedCharacter: true,
      oneWayPassedUpward: true,
      platformGroundedObserved: true,
    });
  });

  it("should write the observation artifact consumed by the Rust arm", () => {
    const written = JSON.parse(readFileSync(webArtifactPath, "utf8")) as IArmObservation;
    expect(written).toEqual(observation);
  });

  it("preserves repeated area crossing edges in order", () => {
    const simulation = createSimulation();
    const area = simulation.createBody({
      mass: 0,
      position: { x: 0, y: 0, z: 0 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      sensor: true,
      shape: {
        collisionLayer: 1,
        collisionMask: 65535,
        kind: "box",
        sensor: true,
        x: 1,
        y: 1,
        z: 1,
      },
      type: "fixed",
    });
    const body = simulation.createBody({
      mass: 0,
      position: { x: -3, y: 0, z: 0 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      sensor: false,
      shape: {
        collisionLayer: 1,
        collisionMask: 65535,
        kind: "box",
        sensor: false,
        x: 0.5,
        y: 0.5,
        z: 0.5,
      },
      type: "kinematic",
    });
    const input = new Float32Array(PHYSICS_TRANSFORM_STRIDE);
    let wasInside = false;
    const edges: string[] = [];
    for (const positionX of [0, 3, 0, 3]) {
      input.set([body.body.id, positionX, 0, 0, 0, 0, 0, 1]);
      simulation.step(1 / 60, {
        kinematicCount: 1,
        kinematicTransforms: input,
      });
      const isInside = simulation.areaIntersections?.(area.body.id)?.has(body.body.id) ?? false;
      if (!wasInside && isInside) edges.push("entered");
      if (wasInside && !isInside) edges.push("exited");
      wasInside = isInside;
    }
    simulation.dispose();

    expect(edges).toEqual(["entered", "exited", "entered", "exited"]);
  });
});

describe("native adapter freshness", () => {
  it("preserves quaternion component order in web visible transform records", () => {
    const simulation = createSimulation();
    simulation.createBody({
      mass: 0,
      position: { x: 0, y: 0, z: 0 },
      rotation: { w: -0.5, x: 0.5, y: -0.5, z: 0.5 },
      sensor: false,
      shape: {
        collisionLayer: 1,
        collisionMask: 65535,
        kind: "box",
        sensor: false,
        x: 1,
        y: 1,
        z: 1,
      },
      type: "fixed",
    });
    const buffer = new Float32Array(PHYSICS_TRANSFORM_STRIDE);

    expect(simulation.readVisibleTransforms(buffer)).toBe(1);
    expect([...buffer.slice(4, 8)]).toEqual([0.5, -0.5, 0.5, -0.5]);
    simulation.dispose();
  });

  it("keeps area membership views stable across refreshes and absent ids", () => {
    const { native, web } = validationAdapters();
    const area = native.createBody({
      mass: 0,
      position: { x: 0, y: 0, z: 0 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      sensor: true,
      shape: {
        collisionLayer: 1,
        collisionMask: 65535,
        kind: "box",
        sensor: true,
        x: 1,
        y: 1,
        z: 1,
      },
      type: "kinematic",
    });
    const first = native.areaIntersections?.(area.body.id);
    const second = native.areaIntersections?.(area.body.id);
    const missingBefore = native.areaIntersections?.(999);
    native.step(1 / 60);
    const third = native.areaIntersections?.(area.body.id);
    const missingAfter = native.areaIntersections?.(999);

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(missingBefore).toBe(missingAfter);
    expect([...(third ?? [])]).toEqual([]);
    native.dispose();
    web.dispose();
  });

  it("reuses the web character state record while preserving its values", () => {
    const simulation = createSimulation();
    const character = simulation.createBody({
      mass: 0,
      position: { x: 0, y: 0, z: 0 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      sensor: false,
      shape: {
        collisionLayer: 1,
        collisionMask: 65535,
        kind: "capsule",
        sensor: false,
        x: 0.2,
        y: 0.3,
        z: 0,
      },
      type: "character",
    });
    simulation.configureCharacter(character.body.id, {
      maxSlopeClimbAngle: Math.PI / 4,
      offset: 0.01,
      oneWayLayers: 0,
    });
    simulation.step(1 / 60);
    const first = simulation.readCharacterState?.(character.body.id);
    const second = simulation.readCharacterState?.(character.body.id);

    expect(first).toBe(second);
    expect({ grounded: second?.grounded, groundCollider: second?.groundCollider }).toEqual({
      grounded: false,
      groundCollider: undefined,
    });
    simulation.dispose();
  });

  it("refreshes state and area caches independently without reading visible transforms", () => {
    let nextId = 0;
    const raw: INativeSimulation = {
      configureCharacter: vi.fn(),
      createBody: vi.fn(() => nextId++),
      dispose: vi.fn(),
      drainCollisionEvents: vi.fn(() => 0),
      readAreaIntersections: vi.fn((buffer) => {
        buffer.set([1, 2]);
        return 1;
      }),
      readBodySleepStates: vi.fn(() => 0),
      readCharacterStates: vi.fn((buffer) => {
        buffer.set([0, 1, 2, 0, 1, 0]);
        return 1;
      }),
      readVisibleTransforms: vi.fn(() => 0),
      removeBody: vi.fn(),
      setBodyTransform: vi.fn(),
      step: vi.fn(),
      intersectRay: vi.fn(() => 0),
      intersectShape: vi.fn(() => []),
      intersectPoint: vi.fn(() => []),
    };
    const simulation = createNativePhysicsSimulation(raw, "0.30.0");
    const createBody = (type: "character" | "dynamic" | "kinematic", sensor = false) =>
      simulation.createBody({
        mass: 0,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        sensor,
        shape: {
          collisionLayer: 1,
          collisionMask: 65535,
          kind: "box",
          sensor,
          x: 1,
          y: 1,
          z: 1,
        },
        type,
      });
    createBody("character");
    createBody("kinematic", true);
    createBody("dynamic");
    simulation.configureCharacter(0, {
      maxSlopeClimbAngle: Math.PI / 4,
      offset: 0.01,
      oneWayLayers: 0,
    });
    simulation.step(1 / 60);

    const state = simulation.readCharacterState?.(0);
    const members = [...(simulation.areaIntersections?.(1) ?? [])];
    expect({ members, state }).toEqual({
      members: [2],
      state: {
        groundBody: expect.objectContaining({ id: 2 }),
        groundCollider: 2,
        groundNormal: { x: 0, y: 1, z: 0 },
        grounded: true,
      },
    });
    simulation.readCharacterState?.(0);
    simulation.areaIntersections?.(1);
    expect(raw.readCharacterStates).toHaveBeenCalledTimes(1);
    expect(raw.readAreaIntersections).toHaveBeenCalledTimes(1);
    expect(raw.readVisibleTransforms).not.toHaveBeenCalled();

    simulation.step(1 / 60);
    simulation.readCharacterState?.(0);
    expect(simulation.readCharacterState?.(0)).toBe(state);
    expect(raw.readCharacterStates).toHaveBeenCalledTimes(2);
    expect(raw.readAreaIntersections).toHaveBeenCalledTimes(1);
    simulation.areaIntersections?.(1);
    expect(raw.readAreaIntersections).toHaveBeenCalledTimes(2);

    simulation.configureCharacter(0, {
      maxSlopeClimbAngle: Math.PI / 4,
      offset: 0.01,
      oneWayLayers: 0,
    });
    simulation.readCharacterState?.(0);
    simulation.areaIntersections?.(1);
    expect(raw.readCharacterStates).toHaveBeenCalledTimes(3);
    expect(raw.readAreaIntersections).toHaveBeenCalledTimes(3);

    const extra = createBody("dynamic");
    simulation.readCharacterState?.(0);
    simulation.areaIntersections?.(1);
    expect(raw.readCharacterStates).toHaveBeenCalledTimes(4);
    expect(raw.readAreaIntersections).toHaveBeenCalledTimes(4);
    simulation.removeBody(extra.body.id);
    simulation.readCharacterState?.(0);
    simulation.areaIntersections?.(1);
    expect(raw.readCharacterStates).toHaveBeenCalledTimes(5);
    expect(raw.readAreaIntersections).toHaveBeenCalledTimes(5);
    expect(raw.readVisibleTransforms).not.toHaveBeenCalled();
  });

  it("grows the area-pair buffer geometrically after a fail-closed capacity error", () => {
    const capacities: number[] = [];
    const { native: simulation, raw } = validationAdapters();
    let nextId = 1;
    raw.createBody = vi.fn(() => nextId++);
    raw.readAreaIntersections = vi.fn((buffer) => {
      capacities.push(buffer.length);
      if (buffer.length < 128) throw new Error("area intersection buffer is too small");
      return 0;
    });
    for (let index = 0; index < 19; index += 1) {
      const sensor = index === 0;
      simulation.createBody({
        mass: 0,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        sensor,
        shape: {
          collisionLayer: 1,
          collisionMask: 65535,
          kind: "box",
          sensor,
          x: 1,
          y: 1,
          z: 1,
        },
        type: sensor ? "kinematic" : "dynamic",
      });
    }

    expect([...(simulation.areaIntersections?.(1) ?? [])]).toEqual([]);
    expect(capacities).toEqual([64, 128]);
  });
});

describe("physics adapter fail-closed symmetry", () => {
  const rejectedInputs: readonly (readonly [string, (simulation: IPhysicsSimulation) => void])[] = [
    ["non-finite delta", (simulation) => simulation.step(Number.NaN)],
    [
      "Float64 input",
      (simulation) =>
        simulation.step(1 / 60, {
          kinematicCount: 0,
          kinematicTransforms: new Float64Array(0) as unknown as Float32Array,
        }),
    ],
    [
      "negative count",
      (simulation) =>
        simulation.step(1 / 60, {
          kinematicCount: -1,
          kinematicTransforms: new Float32Array(0),
        }),
    ],
    [
      "fractional count",
      (simulation) =>
        simulation.step(1 / 60, {
          kinematicCount: 0.5,
          kinematicTransforms: new Float32Array(0),
        }),
    ],
    [
      "oversized count",
      (simulation) =>
        simulation.step(1 / 60, {
          kinematicCount: 2,
          kinematicTransforms: new Float32Array(PHYSICS_TRANSFORM_STRIDE),
        }),
    ],
    ...Array.from(
      { length: PHYSICS_TRANSFORM_STRIDE },
      (_, index) =>
        [
          `non-finite record scalar ${index}`,
          (simulation: IPhysicsSimulation) =>
            simulation.step(1 / 60, {
              kinematicCount: 1,
              kinematicTransforms: transformWith(index, Number.NaN),
            }),
        ] as const,
    ),
    [
      "negative body id",
      (simulation) =>
        simulation.step(1 / 60, {
          kinematicCount: 1,
          kinematicTransforms: transformWith(0, -1),
        }),
    ],
    [
      "fractional body id",
      (simulation) =>
        simulation.step(1 / 60, {
          kinematicCount: 1,
          kinematicTransforms: transformWith(0, 0.5),
        }),
    ],
    [
      "unknown body id",
      (simulation) =>
        simulation.step(1 / 60, {
          kinematicCount: 1,
          kinematicTransforms: transformWith(0, 999),
        }),
    ],
    [
      "undersized render buffer",
      (simulation) => simulation.readVisibleTransforms(new Float32Array(0)),
    ],
    [
      "event array class",
      (simulation) =>
        simulation.drainCollisionEvents(new Float32Array(0) as unknown as Uint32Array),
    ],
  ];

  it.each(rejectedInputs)("rejects %s with the same JavaScript Error class", (_, action) => {
    const { native, web } = validationAdapters();
    const webClass = errorClass(() => action(web));
    const nativeClass = errorClass(() => action(native));
    expect(webClass).toBe(Error);
    expect(nativeClass).toBe(webClass);
  });

  it("silently accepts removal of a valid unknown id on both adapters", () => {
    const { native, raw, web } = validationAdapters();
    expect(() => web.removeBody(999)).not.toThrow();
    expect(() => native.removeBody(999)).not.toThrow();
    expect(raw.removeBody).toHaveBeenCalledWith(999);
  });
});
