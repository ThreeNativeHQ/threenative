import { type ICtx, type IGamePluginHooks, Scene, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import {
  Area3D,
  CharacterBody3D,
  CollisionShape3D,
  type IPhysicsContext,
  type PhysicsBody3D,
  RigidBody3D,
  rapier,
} from "@threenative/physics";
import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";

type VectorTuple = readonly [number, number, number];
interface ISpatialQueryObservation {
  readonly clearHitCount: number;
  readonly maskedHitCount: number;
  readonly pointCount: number;
  readonly pointMaskedHitCount: number;
  readonly pointMissCount: number;
  readonly rayDistance: number;
  readonly rayNormal: VectorTuple;
  readonly rayPosition: VectorTuple;
  readonly shapeCount: number;
  readonly shapeMaskedHitCount: number;
  readonly shapeMissCount: number;
}

interface IScenarioBody {
  readonly id: number;
  readonly name: string;
  readonly type: "character" | "dynamic" | "fixed" | "kinematic";
  readonly shape: "box" | "capsule" | "sphere";
  readonly shapeSize: VectorTuple;
  readonly position: VectorTuple;
  readonly mass: number;
  readonly collisionLayer: number;
  readonly collisionMask: number;
  readonly sensor: boolean;
}
interface IScenarioMotion {
  readonly bodyId: number;
  readonly startStep: number;
  readonly endStep: number;
  readonly delta: VectorTuple;
}
interface IParityScenario {
  readonly schemaVersion: number;
  readonly expectedRapierVersions: { readonly web: string; readonly rust: string };
  readonly gravity: VectorTuple;
  readonly deltaTime: number;
  readonly steps: number;
  readonly removeAtStep: number;
  readonly removeBodyId: number;
  readonly teleportAtStep: number;
  readonly teleportBodyId: number;
  readonly teleportPosition: VectorTuple;
  readonly bodies: readonly IScenarioBody[];
  readonly character: {
    readonly bodyId: number;
    readonly offset: number;
    readonly maxSlopeClimbAngle: number;
    readonly autostep: VectorTuple;
    readonly snapToGround: number;
    readonly oneWayLayers: number;
  };
  readonly motions: readonly IScenarioMotion[];
  readonly checkpoints: readonly number[];
}

interface IParityObservation extends Record<string, unknown> {
  areaMembership: readonly string[];
  areaMembershipSnapshots: readonly string[];
  characterDisplacement: VectorTuple;
  collisionEventSet: readonly string[];
  control: string;
  groundBody: string | null;
  groundCollider: string | null;
  groundNormal: VectorTuple;
  grounded: boolean;
  rapierVersion: string;
  restingPosition: VectorTuple;
  runtime: "native" | "web";
  scenarioSha256: string;
  slopeAngle: number;
  scenarioCoverage: {
    areaExcludedCharacter: boolean;
    oneWayPassedUpward: boolean;
    platformGroundedObserved: boolean;
  };
  spatialQuery: ISpatialQueryObservation;
  steps: number;
}
interface IPhysicsState extends Record<string, unknown> {
  parity: IParityObservation;
}

declare global {
  var canvas: HTMLCanvasElement | undefined;
}
declare const __TN_PHYSICS_CONTROL__: "masked" | "normal" | "offset-box" | "wrong-gravity";
declare const __TN_PHYSICS_SCENARIO_BYTES__: string;
declare const __TN_PHYSICS_SCENARIO_SHA256__: string;
declare const __TN_PLAYTEST_ENABLED__: boolean;
declare const __TN_RUNTIME__: "native" | "web";

const scenario = JSON.parse(__TN_PHYSICS_SCENARIO_BYTES__) as IParityScenario;
if (scenario.schemaVersion !== 1) throw new Error("TN_PHYSICS_PARITY_SCENARIO_INVALID");
const bodiesByFixtureId = new Map<number, PhysicsBody3D>();
const namesByRuntimeId = new Map<number, string>();
const collisionEvents = new Set<string>();
const areaSnapshots: string[] = [];
let area: Area3D | undefined;
let character: CharacterBody3D | undefined;
let dynamicBox: RigidBody3D | undefined;
let initialCharacterPosition: VectorTuple = [0, 0, 0];
let initialDynamicBoxPosition: VectorTuple = [0, 0, 0];
let completedSteps = 0;
let rapierVersion = "pending";
let characterMaxY = Number.NEGATIVE_INFINITY;
let platformGroundedObserved = false;
let spatialQueryLogged = false;
let invalidRayChecked = false;
let markSceneReady: (() => void) | undefined;
const sceneReady = new Promise<void>((resolve) => {
  markSceneReady = resolve;
});

function collisionShape(body: IScenarioBody): CollisionShape3D {
  if (body.shape === "capsule")
    return CollisionShape3D.capsule(body.shapeSize[0], body.shapeSize[1]);
  if (body.shape === "sphere") return CollisionShape3D.sphere(body.shapeSize[0]);
  return CollisionShape3D.box(body.shapeSize[0] * 2, body.shapeSize[1] * 2, body.shapeSize[2] * 2);
}

function logicalName(runtimeId: number): string {
  const name = namesByRuntimeId.get(runtimeId);
  if (name === undefined) throw new Error(`TN_PHYSICS_PARITY_UNKNOWN_BODY:${runtimeId}`);
  return name;
}

function logicalPair(left: number, right: number, started: number): string {
  return `${[logicalName(left), logicalName(right)].sort().join("-")}-${started}`;
}

function rigidBodyObject(body: PhysicsBody3D) {
  const object = body.object;
  if (object === undefined) throw new Error("TN_PHYSICS_OBJECT_MISSING");
  return object;
}

function position(body: PhysicsBody3D): VectorTuple {
  const object = rigidBodyObject(body);
  return [object.position.x, object.position.y, object.position.z];
}

const spatialQueryShape = CollisionShape3D.sphere(0.1);

function verifyNativeInvalidRay(space: IPhysicsContext["directSpaceState"]): void {
  if (__TN_RUNTIME__ !== "native" || invalidRayChecked) return;
  const f32Max = 3.4028234663852886e38;
  try {
    space.intersectRay({
      collisionMask: 1,
      from: { x: -f32Max, y: 0, z: 0 },
      to: { x: f32Max, y: 0, z: 0 },
    });
  } catch {
    invalidRayChecked = true;
    console.info("TN_NATIVE_PHYSICS_INVALID_RAY_THROW");
    return;
  }
  throw new Error("TN_NATIVE_PHYSICS_INVALID_RAY_DID_NOT_THROW");
}

function spatialQuery(space: IPhysicsContext["directSpaceState"]): ISpatialQueryObservation {
  const ray = space.intersectRay({
    collisionMask: 1,
    from: { x: 0, y: 2, z: 1 },
    to: { x: 0, y: -2, z: 1 },
  });
  if (ray === undefined) throw new Error("TN_PHYSICS_SPATIAL_QUERY_RAY_MISSING");
  const clear = space.intersectRay({
    collisionMask: 1,
    from: { x: 0, y: 2, z: 1 },
    to: { x: 0, y: 2, z: -5 },
  });
  const masked = space.intersectRay({
    collisionMask: 2,
    from: { x: 0, y: 2, z: 1 },
    to: { x: 0, y: -2, z: 1 },
  });
  const shape = space.intersectShape({
    collisionMask: 1,
    maxResults: 16,
    position: { x: 0, y: -0.2, z: 1 },
    shape: spatialQueryShape,
  });
  const point = space.intersectPoint({
    collisionMask: 1,
    maxResults: 16,
    position: { x: 0, y: -0.2, z: 1 },
  });
  const shapeMiss = space.intersectShape({
    collisionMask: 1,
    maxResults: 16,
    position: { x: 100, y: 100, z: 100 },
    shape: spatialQueryShape,
  });
  const shapeMasked = space.intersectShape({
    collisionMask: 2,
    maxResults: 16,
    position: { x: 0, y: -0.2, z: 1 },
    shape: spatialQueryShape,
  });
  const pointMiss = space.intersectPoint({
    collisionMask: 1,
    maxResults: 16,
    position: { x: 100, y: 100, z: 100 },
  });
  const pointMasked = space.intersectPoint({
    collisionMask: 2,
    maxResults: 16,
    position: { x: 0, y: -0.2, z: 1 },
  });
  verifyNativeInvalidRay(space);
  const round = (value: number) => Number(value.toFixed(6));
  return {
    clearHitCount: clear === undefined ? 0 : 1,
    maskedHitCount: masked === undefined ? 0 : 1,
    pointCount: point.length,
    pointMaskedHitCount: pointMasked.length,
    pointMissCount: pointMiss.length,
    rayDistance: round(ray.distance),
    rayNormal: [round(ray.normal.x), round(ray.normal.y), round(ray.normal.z)],
    rayPosition: [round(ray.position.x), round(ray.position.y), round(ray.position.z)],
    shapeCount: shape.length,
    shapeMaskedHitCount: shapeMasked.length,
    shapeMissCount: shapeMiss.length,
  };
}

function observer(): IGamePluginHooks<IPhysicsState, IPhysicsContext> {
  return {
    setup: (ctx, runtime) => {
      const simulation = ctx.physics.simulation;
      if (runtime?.rapier === null || runtime?.rapier === undefined)
        throw new Error("TN_PHYSICS_PARITY_VERSION_MISSING");
      rapierVersion = runtime.rapier;
      const drain = simulation.drainCollisionEvents.bind(simulation);
      simulation.drainCollisionEvents = (output) => {
        const count = drain(output);
        for (let index = 0; index < count; index += 1) {
          const offset = index * 3;
          const left = output[offset];
          const right = output[offset + 1];
          const started = output[offset + 2];
          if (left === undefined || right === undefined || started === undefined)
            throw new Error("TN_PHYSICS_PARITY_COLLISION_MALFORMED");
          collisionEvents.add(logicalPair(left, right, started));
        }
        return count;
      };
      return undefined;
    },
    update: (ctx) => {
      if (completedSteps >= scenario.steps) return;
      const step = completedSteps;
      completedSteps += 1;
      const simulation = ctx.physics.simulation;
      const currentCharacter = character;
      const currentArea = area;
      const currentBox = dynamicBox;
      if (currentCharacter === undefined || currentArea === undefined || currentBox === undefined)
        throw new Error("TN_PHYSICS_PARITY_SCENE_INCOMPLETE");
      const memberIds = [...(simulation.areaIntersections?.(currentArea.body.id) ?? [])].sort(
        (left, right) => left - right,
      );
      const members = memberIds.map(logicalName);
      if (scenario.checkpoints.includes(step)) areaSnapshots.push(members.join(","));
      const state = simulation.readCharacterState?.(currentCharacter.body.id);
      const characterPosition = position(currentCharacter);
      const query = spatialQuery(ctx.physics.directSpaceState);
      characterMaxY = Math.max(characterMaxY, characterPosition[1]);
      if (
        currentCharacter.grounded &&
        currentCharacter.groundBody !== undefined &&
        logicalName(currentCharacter.groundBody.id) === "movingPlatform"
      )
        platformGroundedObserved = true;
      const parity: IParityObservation = {
        areaMembership: members,
        areaMembershipSnapshots: [...areaSnapshots],
        characterDisplacement: [
          characterPosition[0] - initialCharacterPosition[0],
          characterPosition[1] - initialCharacterPosition[1],
          characterPosition[2] - initialCharacterPosition[2],
        ],
        collisionEventSet: [...collisionEvents].sort(),
        control: __TN_PHYSICS_CONTROL__,
        groundBody:
          currentCharacter.groundBody === undefined
            ? null
            : logicalName(currentCharacter.groundBody.id),
        groundCollider:
          state?.groundCollider === undefined ? null : logicalName(state.groundCollider),
        groundNormal: currentCharacter.groundNormal.toArray(),
        grounded: state?.grounded ?? false,
        rapierVersion,
        restingPosition: position(currentBox),
        runtime: __TN_RUNTIME__,
        scenarioSha256: __TN_PHYSICS_SCENARIO_SHA256__,
        slopeAngle: currentCharacter.slopeAngle,
        scenarioCoverage: {
          areaExcludedCharacter: !members.includes("character"),
          oneWayPassedUpward: characterMaxY > 1.23,
          platformGroundedObserved,
        },
        spatialQuery: query,
        steps: completedSteps,
      };
      ctx.state.set({ parity });
      if (!spatialQueryLogged) {
        spatialQueryLogged = true;
        console.info(`TN_NATIVE_PHYSICS_QUERY:${JSON.stringify(query)}`);
      }
      if (completedSteps === scenario.steps)
        console.info(
          `TN_NATIVE_PHYSICS_PARITY:${__TN_RUNTIME__}:${__TN_PHYSICS_SCENARIO_SHA256__}`,
        );
      if (completedSteps === scenario.steps)
        console.info(
          `TN_NATIVE_PHYSICS_PLAYTEST:${JSON.stringify({
            movement: { after: position(currentBox), before: initialDynamicBoxPosition },
            parity,
          })}`,
        );
    },
  };
}

function gatedPlaytest(): IGamePluginHooks<IPhysicsState, IPhysicsContext> {
  // The proof runs scenario.steps fixed steps from frame 0 -- about three seconds at 60fps.
  // Without holding for the runner it can finish before the first observation, which reports
  // TN_PLAYTEST_ASSERTION_TRIVIAL and a zero-distance movement failure purely as a function of
  // how fast the device booted. Holding in the plugin also holds the physics plugin's first
  // step, which gating this file's observer alone would not.
  const plugin = playtest<IPhysicsState, IPhysicsContext>({ holdUntilAttached: true });
  return {
    setup: async (ctx, runtime) => {
      const cleanup = await plugin.setup?.(ctx, runtime);
      const bridge = (
        globalThis as typeof globalThis & {
          __THREENATIVE_PLAYTEST_BRIDGE__?: {
            ready(): Promise<{ ready: boolean }> | { ready: boolean };
          };
        }
      ).__THREENATIVE_PLAYTEST_BRIDGE__;
      if (bridge === undefined) throw new Error("TN_PHYSICS_PARITY_BRIDGE_MISSING");
      const originalReady = bridge.ready;
      bridge.ready = async () => {
        await sceneReady;
        return originalReady();
      };
      return cleanup;
    },
  };
}

const initialParity: IParityObservation = {
  areaMembership: [],
  areaMembershipSnapshots: [],
  characterDisplacement: [0, 0, 0],
  collisionEventSet: [],
  control: __TN_PHYSICS_CONTROL__,
  groundBody: null,
  groundCollider: null,
  groundNormal: [0, 1, 0],
  grounded: false,
  rapierVersion: "pending",
  restingPosition: [0, 0, 0],
  runtime: __TN_RUNTIME__,
  scenarioSha256: __TN_PHYSICS_SCENARIO_SHA256__,
  slopeAngle: 0,
  scenarioCoverage: {
    areaExcludedCharacter: false,
    oneWayPassedUpward: false,
    platformGroundedObserved: false,
  },
  spatialQuery: {
    clearHitCount: 0,
    maskedHitCount: 0,
    pointCount: 0,
    pointMaskedHitCount: 0,
    pointMissCount: 0,
    rayDistance: 0,
    rayNormal: [0, 0, 0],
    rayPosition: [0, 0, 0],
    shapeCount: 0,
    shapeMaskedHitCount: 0,
    shapeMissCount: 0,
  },
  steps: 0,
};

class NativePhysicsParity extends Scene<IPhysicsState, IPhysicsContext> {
  static override readonly initialState: IPhysicsState = { parity: initialParity };

  override enter(ctx: ICtx<IPhysicsState, IPhysicsContext>) {
    ctx.camera.position.set(0, 2, 8);
    for (const spec of scenario.bodies) {
      const object = ctx.add(
        new Mesh(new BoxGeometry(), new MeshBasicMaterial({ color: 0x44aaff })),
      );
      object.position.set(...spec.position);
      if (__TN_PHYSICS_CONTROL__ === "offset-box" && spec.name === "dynamicBox")
        object.position.x += 0.001;
      ctx.entities.add(spec.name, object);
      if (spec.sensor) {
        area = new Area3D({
          entity: spec.name,
          collisionLayer: spec.collisionLayer,
          collisionMask: spec.collisionMask,
          physics: ctx.physics,
          position: object.position,
          shape: collisionShape(spec),
        });
        namesByRuntimeId.set(area.body.id, spec.name);
        continue;
      }
      const body =
        spec.type === "character"
          ? new CharacterBody3D({
              autostep: {
                includeDynamicBodies: scenario.character.autostep[2] === 1,
                maxHeight: scenario.character.autostep[0],
                minWidth: scenario.character.autostep[1],
              },
              collisionLayer: spec.collisionLayer,
              collisionMask: spec.collisionMask,
              maxSlopeClimbAngle: scenario.character.maxSlopeClimbAngle,
              object,
              offset: scenario.character.offset,
              oneWayLayers: scenario.character.oneWayLayers,
              physics: ctx.physics,
              shape: collisionShape(spec),
              snapToGround: scenario.character.snapToGround,
            })
          : new RigidBody3D({
              collisionLayer: spec.collisionLayer,
              collisionMask:
                __TN_PHYSICS_CONTROL__ === "masked" && spec.name === "dynamicBox"
                  ? spec.collisionLayer
                  : spec.collisionMask,
              mass: spec.mass,
              object,
              physics: ctx.physics,
              shape: collisionShape(spec),
              type: spec.type,
            });
      if (body.body.id !== spec.id)
        throw new Error(`TN_PHYSICS_PARITY_BODY_ID:${spec.name}:${body.body.id}:${spec.id}`);
      bodiesByFixtureId.set(spec.id, body);
      namesByRuntimeId.set(body.body.id, spec.name);
      if (spec.id === scenario.character.bodyId) character = body as CharacterBody3D;
      if (spec.name === "dynamicBox") dynamicBox = body as RigidBody3D;
    }
    if (area?.body.id !== scenario.bodies.find((body) => body.sensor)?.id)
      throw new Error("TN_PHYSICS_PARITY_AREA_ID");
    if (dynamicBox === undefined) throw new Error("TN_PHYSICS_PARITY_DYNAMIC_BODY_MISSING");
    initialCharacterPosition = position(character as CharacterBody3D);
    initialDynamicBoxPosition = position(dynamicBox);
    characterMaxY = initialCharacterPosition[1];
    markSceneReady?.();

    return () => {
      if (completedSteps >= scenario.steps) return;
      const step = completedSteps;
      if (step === scenario.removeAtStep) {
        bodiesByFixtureId.get(scenario.removeBodyId)?.dispose();
        bodiesByFixtureId.delete(scenario.removeBodyId);
      }
      if (step === scenario.teleportAtStep) {
        character?.teleport({
          x: scenario.teleportPosition[0],
          y: scenario.teleportPosition[1],
          z: scenario.teleportPosition[2],
        });
      }
      for (const motion of scenario.motions) {
        if (step < motion.startStep || step >= motion.endStep) continue;
        const body = bodiesByFixtureId.get(motion.bodyId);
        if (body instanceof CharacterBody3D) {
          body.move({ x: motion.delta[0], y: motion.delta[1], z: motion.delta[2] });
        } else if (body instanceof RigidBody3D) {
          const object = rigidBodyObject(body);
          object.position.x += motion.delta[0];
          object.position.y += motion.delta[1];
          object.position.z += motion.delta[2];
        }
      }
      if (step === 0) console.info("TN_NATIVE_SMOKE_FIRST_FRAME");
    };
  }
}

const runtimeCanvas = globalThis.canvas;
if (runtimeCanvas === undefined)
  throw new Error("TN_NATIVE_CANVAS_MISSING: globalThis.canvas is required");

const gravityY =
  __TN_PHYSICS_CONTROL__ === "wrong-gravity" ? -scenario.gravity[1] : scenario.gravity[1];
const game = defineGame<IPhysicsState, IPhysicsContext>({
  canvas: runtimeCanvas,
  inputTarget: runtimeCanvas,
  plugins: [
    ...(__TN_PLAYTEST_ENABLED__ ? [gatedPlaytest()] : []),
    rapier({ gravity: { x: scenario.gravity[0], y: gravityY, z: scenario.gravity[2] } }),
    observer(),
  ],
  scenes: { parity: NativePhysicsParity },
  start: "parity",
  step: scenario.deltaTime,
});

export default game;
