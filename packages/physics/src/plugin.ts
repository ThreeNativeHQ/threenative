import type { Ctx, GamePluginHooks } from "@threenative/core";
import type { Area3D } from "./Area3D.js";
import { CharacterBody3D } from "./CharacterBody3D.js";
import { RigidBody3D } from "./RigidBody3D.js";
import { physicsHandle, physicsWorldHandle } from "./handles.js";
import type { NavigationContext } from "./navigation/index.js";
import {
  PHYSICS_COLLISION_EVENT_STRIDE,
  PHYSICS_TRANSFORM_STRIDE,
  type PhysicsInputSnapshot,
  type PhysicsSimulation,
  physicsSimulationBackend,
} from "./simulation.js";

export interface PhysicsOptions {
  readonly gravity?: { readonly x: number; readonly y: number; readonly z: number };
}

export type PhysicsBody3D = RigidBody3D | CharacterBody3D;

export interface PhysicsContext {
  readonly world: ReturnType<typeof physicsWorldHandle>;
  readonly eventQueue: ReturnType<typeof physicsHandle>;
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

function growFloat(
  buffer: Float32Array<ArrayBufferLike>,
  records: number,
): Float32Array<ArrayBufferLike> {
  if (buffer.length >= records * PHYSICS_TRANSFORM_STRIDE) return buffer;
  return new Float32Array(
    Math.max(records, Math.max(1, buffer.length / PHYSICS_TRANSFORM_STRIDE) * 2) *
      PHYSICS_TRANSFORM_STRIDE,
  );
}

function growEvents(
  buffer: Uint32Array<ArrayBufferLike>,
  bodyCount: number,
): Uint32Array<ArrayBufferLike> {
  const required = Math.max(16, bodyCount * bodyCount * PHYSICS_COLLISION_EVENT_STRIDE);
  return buffer.length >= required ? buffer : new Uint32Array(required);
}

function visibleId(buffer: Readonly<Float32Array>, offset: number): number {
  const value = buffer[offset];
  if (value === undefined || !Number.isInteger(value) || value < 0)
    throw new Error("PhysicsSimulation returned an invalid visible body id.");
  return value;
}

export function rapier(options: PhysicsOptions = {}): PhysicsPlugin {
  const backend = physicsSimulationBackend();
  let simulation: PhysicsSimulation | undefined;
  let context: PhysicsContext | undefined;
  const bodies = new Set<PhysicsBody3D>();
  const bodiesById = new Map<number, PhysicsBody3D>();
  const areas = new Map<number, Area3D>();
  const kinematicMotions = new Map<
    number,
    { readonly x: number; readonly y: number; readonly z: number }
  >();
  let kinematic: Float32Array<ArrayBufferLike> = new Float32Array(PHYSICS_TRANSFORM_STRIDE * 16);
  let visible: Float32Array<ArrayBufferLike> = new Float32Array(PHYSICS_TRANSFORM_STRIDE * 16);
  let events: Uint32Array<ArrayBufferLike> = new Uint32Array(64);

  return {
    setup: async (ctx: Ctx<Record<string, unknown>, PhysicsContext>, runtime) => {
      await backend.initialize();
      const selected = backend.createSimulation(options);
      simulation = selected;
      if (runtime !== undefined) runtime.rapier = selected.version;
      context = {
        add: (body) => {
          bodies.add(body);
          bodiesById.set(body.body.id, body);
        },
        addArea: (area) => areas.set(area.body.id, area),
        eventQueue: physicsHandle(selected.rawEventQueue),
        kinematicMotion: (colliderHandle) => kinematicMotions.get(colliderHandle),
        numBodies: () => bodies.size,
        remove: (body) => {
          bodies.delete(body);
          bodiesById.delete(body.body.id);
        },
        removeArea: (area) => areas.delete(area.body.id),
        simulation: selected,
        world: physicsWorldHandle(selected.rawWorld, selected),
      };
      ctx.physics = context;
      return undefined;
    },
    update: (_ctx, dt) => {
      if (simulation === undefined) throw new Error("Physics plugin updated before setup.");
      kinematicMotions.clear();
      let count = 0;
      kinematic = growFloat(kinematic, bodies.size + areas.size);
      for (const body of bodies) {
        if (body instanceof RigidBody3D && body.type === "kinematic") {
          kinematicMotions.set(body.collider.id, body.kinematicMotion());
          body.writeKinematic(kinematic, count * PHYSICS_TRANSFORM_STRIDE);
          count += 1;
        }
      }
      for (const body of bodies) {
        if (body instanceof CharacterBody3D) {
          body.writeKinematic(kinematic, count * PHYSICS_TRANSFORM_STRIDE);
          count += 1;
        }
      }
      for (const area of areas.values()) {
        area.writeKinematic(kinematic, count * PHYSICS_TRANSFORM_STRIDE);
        count += 1;
      }
      const input: PhysicsInputSnapshot = {
        kinematicCount: count,
        kinematicTransforms: kinematic,
      };
      simulation.step(dt, input);

      visible = growFloat(visible, bodies.size + areas.size);
      const visibleCount = simulation.readVisibleTransforms(visible);
      for (let index = 0; index < visibleCount; index += 1) {
        const offset = index * PHYSICS_TRANSFORM_STRIDE;
        const id = visibleId(visible, offset);
        const body = bodiesById.get(id);
        if (body !== undefined) body.applyTransform(visible, offset);
        else {
          const area = areas.get(id);
          if (area === undefined)
            throw new Error("PhysicsSimulation returned an unknown visible body id.");
          area.applyTransform(visible, offset);
        }
      }

      events = growEvents(events, bodies.size + areas.size);
      const eventCount = simulation.drainCollisionEvents(events);
      for (let index = 0; index < eventCount; index += 1) {
        const offset = index * PHYSICS_COLLISION_EVENT_STRIDE;
        const left = events[offset];
        const right = events[offset + 1];
        const started = events[offset + 2] === 1;
        if (left === undefined || right === undefined)
          throw new Error("PhysicsSimulation returned a malformed collision event.");
        const leftArea = areas.get(left);
        const rightArea = areas.get(right);
        const leftBody = bodiesById.get(left);
        const rightBody = bodiesById.get(right);
        if (leftArea !== undefined && rightBody !== undefined)
          leftArea.handleCollision(rightBody, started);
        if (rightArea !== undefined && leftBody !== undefined)
          rightArea.handleCollision(leftBody, started);
      }
      if (simulation.areaIntersections !== undefined) {
        for (const area of areas.values()) {
          const current = new Map<number, PhysicsBody3D>();
          for (const bodyId of simulation.areaIntersections(area.body.id)) {
            const body = bodiesById.get(bodyId);
            if (body !== undefined) current.set(bodyId, body);
          }
          area.reconcileIntersections(current);
        }
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
      simulation?.dispose();
      simulation = undefined;
      context = undefined;
      areas.clear();
      bodies.clear();
      bodiesById.clear();
      kinematicMotions.clear();
    },
  };
}
