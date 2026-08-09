import { type Ctx, type GamePluginHooks, Scene, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import {
  Area3D,
  CharacterBody3D,
  CollisionShape3D,
  type PhysicsBody3D,
  type PhysicsContext,
  RigidBody3D,
  rapier,
} from "@threenative/physics";
import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";

type VectorTuple = readonly [number, number, number];
interface ScenarioBody {
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
interface ScenarioMotion {
  readonly bodyId: number;
  readonly startStep: number;
  readonly endStep: number;
  readonly delta: VectorTuple;
}
interface ParityScenario {
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
  readonly bodies: readonly ScenarioBody[];
  readonly character: {
    readonly bodyId: number;
    readonly offset: number;
    readonly maxSlopeClimbAngle: number;
    readonly autostep: VectorTuple;
    readonly snapToGround: number;
    readonly oneWayLayers: number;
  };
  readonly motions: readonly ScenarioMotion[];
  readonly checkpoints: readonly number[];
}

interface ParityObservation extends Record<string, unknown> {
  areaMembership: readonly string[];
  areaMembershipSnapshots: readonly string[];
  characterDisplacement: VectorTuple;
  collisionEventSet: readonly string[];
  control: string;
  groundCollider: string | null;
  grounded: boolean;
  rapierVersion: string;
  restingPosition: VectorTuple;
  runtime: "native" | "web";
  scenarioSha256: string;
  scenarioCoverage: {
    areaExcludedCharacter: boolean;
    oneWayPassedUpward: boolean;
    platformGroundedObserved: boolean;
  };
  steps: number;
}
interface PhysicsState extends Record<string, unknown> {
  parity: ParityObservation;
}

declare global {
  var canvas: HTMLCanvasElement | undefined;
}
declare const __TN_PHYSICS_CONTROL__: "masked" | "normal" | "offset-box" | "wrong-gravity";
declare const __TN_PHYSICS_SCENARIO_BYTES__: string;
declare const __TN_PHYSICS_SCENARIO_SHA256__: string;
declare const __TN_PLAYTEST_ENABLED__: boolean;
declare const __TN_RUNTIME__: "native" | "web";

const scenario = JSON.parse(__TN_PHYSICS_SCENARIO_BYTES__) as ParityScenario;
if (scenario.schemaVersion !== 1) throw new Error("TN_PHYSICS_PARITY_SCENARIO_INVALID");
const bodiesByFixtureId = new Map<number, PhysicsBody3D>();
const namesByRuntimeId = new Map<number, string>();
const collisionEvents = new Set<string>();
const areaSnapshots: string[] = [];
let area: Area3D | undefined;
let character: CharacterBody3D | undefined;
let dynamicBox: RigidBody3D | undefined;
let initialCharacterPosition: VectorTuple = [0, 0, 0];
let completedSteps = 0;
let rapierVersion = "pending";
let characterMaxY = Number.NEGATIVE_INFINITY;
let platformGroundedObserved = false;
let markSceneReady: (() => void) | undefined;
const sceneReady = new Promise<void>((resolve) => {
  markSceneReady = resolve;
});

function collisionShape(body: ScenarioBody): CollisionShape3D {
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

function position(body: PhysicsBody3D): VectorTuple {
  return [body.object.position.x, body.object.position.y, body.object.position.z];
}

function observer(): GamePluginHooks<PhysicsState, PhysicsContext> {
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
      characterMaxY = Math.max(characterMaxY, characterPosition[1]);
      if (
        state?.grounded === true &&
        state.groundCollider !== undefined &&
        logicalName(state.groundCollider) === "movingPlatform"
      )
        platformGroundedObserved = true;
      ctx.state.set({
        parity: {
          areaMembership: members,
          areaMembershipSnapshots: [...areaSnapshots],
          characterDisplacement: [
            characterPosition[0] - initialCharacterPosition[0],
            characterPosition[1] - initialCharacterPosition[1],
            characterPosition[2] - initialCharacterPosition[2],
          ],
          collisionEventSet: [...collisionEvents].sort(),
          control: __TN_PHYSICS_CONTROL__,
          groundCollider:
            state?.groundCollider === undefined ? null : logicalName(state.groundCollider),
          grounded: state?.grounded ?? false,
          rapierVersion,
          restingPosition: position(currentBox),
          runtime: __TN_RUNTIME__,
          scenarioSha256: __TN_PHYSICS_SCENARIO_SHA256__,
          scenarioCoverage: {
            areaExcludedCharacter: !members.includes("character"),
            oneWayPassedUpward: characterMaxY > 1.23,
            platformGroundedObserved,
          },
          steps: completedSteps,
        },
      });
      if (completedSteps === scenario.steps)
        console.info(
          `TN_NATIVE_PHYSICS_PARITY:${__TN_RUNTIME__}:${__TN_PHYSICS_SCENARIO_SHA256__}`,
        );
    },
  };
}

function gatedPlaytest(): GamePluginHooks<PhysicsState, PhysicsContext> {
  const plugin = playtest<PhysicsState, PhysicsContext>();
  return {
    setup: (ctx, runtime) => {
      const cleanup = plugin.setup?.(ctx, runtime);
      const bridge = (
        globalThis as typeof globalThis & {
          __THREENATIVE_PLAYTEST_BRIDGE__?: {
            ready(): Promise<{ ready: boolean }> | { ready: boolean };
          };
        }
      ).__THREENATIVE_PLAYTEST_BRIDGE__;
      if (bridge === undefined) throw new Error("TN_PHYSICS_PARITY_BRIDGE_MISSING");
      bridge.ready = async () => {
        await sceneReady;
        return { ready: true };
      };
      return cleanup;
    },
  };
}

const initialParity: ParityObservation = {
  areaMembership: [],
  areaMembershipSnapshots: [],
  characterDisplacement: [0, 0, 0],
  collisionEventSet: [],
  control: __TN_PHYSICS_CONTROL__,
  groundCollider: null,
  grounded: false,
  rapierVersion: "pending",
  restingPosition: [0, 0, 0],
  runtime: __TN_RUNTIME__,
  scenarioSha256: __TN_PHYSICS_SCENARIO_SHA256__,
  scenarioCoverage: {
    areaExcludedCharacter: false,
    oneWayPassedUpward: false,
    platformGroundedObserved: false,
  },
  steps: 0,
};

class NativePhysicsParity extends Scene<PhysicsState, PhysicsContext> {
  static override readonly initialState: PhysicsState = { parity: initialParity };

  override enter(ctx: Ctx<PhysicsState, PhysicsContext>) {
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
    initialCharacterPosition = position(character as CharacterBody3D);
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
          body.object.position.x += motion.delta[0];
          body.object.position.y += motion.delta[1];
          body.object.position.z += motion.delta[2];
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
const game = defineGame<PhysicsState, PhysicsContext>({
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

void game.start().then(() => console.info("TN_NATIVE_SMOKE_READY:webgpu"));
