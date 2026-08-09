import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Ctx, GamePluginHooks } from "@threenative/core";
import type { Area3D } from "./Area3D.js";
import { CharacterBody3D } from "./CharacterBody3D.js";
import { RigidBody3D } from "./RigidBody3D.js";
import { type PhysicsHandle, type PhysicsWorldHandle, physicsHandle } from "./handles.js";
import type { NavigationContext } from "./navigation/index.js";
import {
  PHYSICS_TRANSFORM_STRIDE,
  type PhysicsInputSnapshot,
  type PhysicsSimulation,
  createWebPhysicsSimulation,
} from "./simulation.js";

export interface PhysicsOptions {
  readonly gravity?: { readonly x: number; readonly y: number; readonly z: number };
}

export type PhysicsBody3D = RigidBody3D | CharacterBody3D;

export interface PhysicsContext {
  readonly world: PhysicsWorldHandle;
  readonly eventQueue: PhysicsHandle;
  readonly simulation: PhysicsSimulation;
  navigation?: NavigationContext;
  add(body: PhysicsBody3D): void;
  numBodies(): number;
  kinematicMotion?(
    colliderHandle: number,
  ): { readonly x: number; readonly y: number; readonly z: number } | undefined;
  remove(body: PhysicsBody3D): void;
  addArea(area: Area3D): void;
  removeArea(area: Area3D): void;
}

export type PhysicsPlugin = GamePluginHooks<Record<string, unknown>, PhysicsContext>;

let initialized: Promise<void> | undefined;

function initialize(): Promise<void> {
  initialized ??= RAPIER.init();
  return initialized;
}

export function rapier(options: PhysicsOptions = {}): PhysicsPlugin {
  let context: PhysicsContext | undefined;
  const bodies = new Set<PhysicsBody3D>();
  const bodiesByCollider = new Map<number, PhysicsBody3D>();
  const bodyIds = new Map<PhysicsBody3D, number>();
  const bodiesById = new Map<number, PhysicsBody3D>();
  const simulationBodies = new Set<{ readonly id: number; readonly body: RAPIER.RigidBody }>();
  const simulationBodiesById = new Map<
    number,
    { readonly id: number; readonly body: RAPIER.RigidBody }
  >();
  const areas = new Map<number, Area3D>();
  const kinematicMotions = new Map<
    number,
    { readonly x: number; readonly y: number; readonly z: number }
  >();
  let nextBodyId = 0;
  let kinematicInput: Float32Array<ArrayBufferLike> = new Float32Array(
    PHYSICS_TRANSFORM_STRIDE * 16,
  );
  let visibleTransforms: Float32Array<ArrayBufferLike> = new Float32Array(
    PHYSICS_TRANSFORM_STRIDE * 16,
  );

  const rawBody = (body: PhysicsBody3D): RAPIER.RigidBody => body.body.raw as RAPIER.RigidBody;

  function ensureBufferCapacity(
    buffer: Float32Array<ArrayBufferLike>,
    requiredRecords: number,
  ): Float32Array<ArrayBufferLike> {
    if (buffer.length >= requiredRecords * PHYSICS_TRANSFORM_STRIDE) return buffer;
    const next = new Float32Array(
      Math.max(requiredRecords, Math.max(1, buffer.length / PHYSICS_TRANSFORM_STRIDE) * 2) *
        PHYSICS_TRANSFORM_STRIDE,
    );
    next.set(buffer);
    return next;
  }

  function visibleValue(index: number): number {
    const value = visibleTransforms[index];
    if (value === undefined || !Number.isFinite(value))
      throw new Error("PhysicsSimulation returned a malformed transform.");
    return value;
  }

  function applyVisibleTransforms(count: number): void {
    if (
      !Number.isInteger(count) ||
      count < 0 ||
      count * PHYSICS_TRANSFORM_STRIDE > visibleTransforms.length
    )
      throw new Error("PhysicsSimulation returned an invalid visible transform count.");
    for (let index = 0; index < count; index += 1) {
      const offset = index * PHYSICS_TRANSFORM_STRIDE;
      const id = visibleValue(offset);
      if (!Number.isInteger(id) || id < 0)
        throw new Error("PhysicsSimulation returned an invalid visible body id.");
      const body = bodiesById.get(id);
      if (body === undefined) throw new Error("PhysicsSimulation returned an unknown body id.");
      body.object.position.set(
        visibleValue(offset + 1),
        visibleValue(offset + 2),
        visibleValue(offset + 3),
      );
      body.object.quaternion.set(
        visibleValue(offset + 4),
        visibleValue(offset + 5),
        visibleValue(offset + 6),
        visibleValue(offset + 7),
      );
    }
  }

  return {
    setup: async (ctx: Ctx<Record<string, unknown>, PhysicsContext>, runtime) => {
      await initialize();
      if (runtime !== undefined) runtime.rapier = RAPIER.version();
      const world = new RAPIER.World(options.gravity ?? { x: 0, y: -9.81, z: 0 });
      const eventQueue = new RAPIER.EventQueue(true);
      const simulation = createWebPhysicsSimulation({
        bodies: () => simulationBodies,
        bodyById: (id) => simulationBodiesById.get(id),
        eventQueue,
        world,
      });
      context = {
        add: (body) => {
          const id = nextBodyId;
          nextBodyId += 1;
          const simulationBody = { body: rawBody(body), id };
          bodies.add(body);
          bodiesByCollider.set(body.collider.id, body);
          bodyIds.set(body, id);
          bodiesById.set(id, body);
          simulationBodies.add(simulationBody);
          simulationBodiesById.set(id, simulationBody);
        },
        addArea: (area) => areas.set(area.collider.id, area),
        eventQueue: physicsHandle(eventQueue),
        kinematicMotion: (colliderHandle) => kinematicMotions.get(colliderHandle),
        numBodies: () => bodies.size,
        remove: (body) => {
          bodies.delete(body);
          bodiesByCollider.delete(body.collider.id);
          const id = bodyIds.get(body);
          if (id !== undefined) {
            const simulationBody = simulationBodiesById.get(id);
            if (simulationBody !== undefined) simulationBodies.delete(simulationBody);
            bodyIds.delete(body);
            bodiesById.delete(id);
            simulationBodiesById.delete(id);
          }
        },
        removeArea: (area) => areas.delete(area.collider.id),
        simulation,
        world: physicsHandle(world),
      };
      ctx.physics = context;
      return undefined;
    },
    update: (ctx, dt) => {
      const physics = context ?? ctx.physics;
      const world = physics.world.raw as RAPIER.World;
      const eventQueue = physics.eventQueue.raw as RAPIER.EventQueue;
      kinematicMotions.clear();
      let kinematicCount = 0;
      for (const body of bodies) {
        if (body instanceof RigidBody3D && body.type === "kinematic") {
          const before = rawBody(body).translation();
          kinematicMotions.set(body.collider.id, {
            x: body.object.position.x - before.x,
            y: body.object.position.y - before.y,
            z: body.object.position.z - before.z,
          });
          const bodyId = bodyIds.get(body);
          if (bodyId === undefined) throw new Error("Physics body is missing a simulation id.");
          kinematicInput = ensureBufferCapacity(kinematicInput, kinematicCount + 1);
          const offset = kinematicCount * PHYSICS_TRANSFORM_STRIDE;
          kinematicInput[offset] = bodyId;
          kinematicInput[offset + 1] = body.object.position.x;
          kinematicInput[offset + 2] = body.object.position.y;
          kinematicInput[offset + 3] = body.object.position.z;
          kinematicInput[offset + 4] = body.object.quaternion.x;
          kinematicInput[offset + 5] = body.object.quaternion.y;
          kinematicInput[offset + 6] = body.object.quaternion.z;
          kinematicInput[offset + 7] = body.object.quaternion.w;
          kinematicCount += 1;
        } else if (body instanceof RigidBody3D) body.syncToPhysics();
      }
      for (const body of bodies) {
        if (body instanceof CharacterBody3D) {
          body.syncToPhysics();
          body.step();
        }
      }
      const inputSnapshot: PhysicsInputSnapshot = {
        kinematicCount,
        kinematicTransforms: kinematicInput,
      };
      physics.simulation.step(dt, inputSnapshot);
      visibleTransforms = ensureBufferCapacity(visibleTransforms, bodies.size);
      const visibleCount = physics.simulation.readVisibleTransforms(visibleTransforms);
      applyVisibleTransforms(visibleCount);
      eventQueue.drainCollisionEvents((handle1, handle2, started) => {
        const area1 = areas.get(handle1);
        const area2 = areas.get(handle2);
        const body1 = bodiesByCollider.get(handle1);
        const body2 = bodiesByCollider.get(handle2);
        if (area1 !== undefined && body2 instanceof RigidBody3D) {
          area1.handleCollision(body2, started);
        }
        if (area1 !== undefined && body2 instanceof CharacterBody3D) {
          area1.handleCollision(body2, started);
        }
        if (area2 !== undefined && body1 instanceof RigidBody3D) {
          area2.handleCollision(body1, started);
        }
        if (area2 !== undefined && body1 instanceof CharacterBody3D) {
          area2.handleCollision(body1, started);
        }
      });
      for (const area of areas.values()) {
        const current = new Map<number, PhysicsBody3D>();
        const areaCollider = area.collider.raw as RAPIER.Collider;
        const areaMask = areaCollider.collisionGroups() & 0xffff;
        world.intersectionsWithShape(
          areaCollider.translation(),
          areaCollider.rotation(),
          areaCollider.shape,
          (collider) => {
            const body = bodiesByCollider.get(collider.handle);
            if (body !== undefined && ((collider.collisionGroups() >>> 16) & areaMask) !== 0)
              current.set(body.body.id, body);
            return true;
          },
          RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
          undefined,
          areaCollider,
        );
        area.reconcileIntersections(current);
      }
      kinematicMotions.clear();
    },
    sceneExit: () => {
      for (const area of [...areas.values()]) area.dispose();
      for (const body of [...bodies]) body.dispose();
      kinematicMotions.clear();
    },
    dispose: () => {
      for (const area of [...areas.values()]) area.dispose();
      for (const body of [...bodies]) body.dispose();
      (context?.eventQueue.raw as RAPIER.EventQueue | undefined)?.free();
      (context?.world.raw as RAPIER.World | undefined)?.free();
      context = undefined;
      bodies.clear();
      bodiesByCollider.clear();
      bodyIds.clear();
      bodiesById.clear();
      simulationBodies.clear();
      simulationBodiesById.clear();
      areas.clear();
      kinematicMotions.clear();
      nextBodyId = 0;
    },
  };
}
