import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Ctx, GamePluginHooks } from "@threenative/core";
import type { Area3D } from "./Area3D.js";
import { CharacterBody3D } from "./CharacterBody3D.js";
import { RigidBody3D } from "./RigidBody3D.js";

export interface PhysicsOptions {
  readonly gravity?: { readonly x: number; readonly y: number; readonly z: number };
}

export type PhysicsBody3D = RigidBody3D | CharacterBody3D;

export interface PhysicsContext {
  readonly world: RAPIER.World;
  readonly eventQueue: RAPIER.EventQueue;
  add(body: PhysicsBody3D): void;
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
  const areas = new Map<number, Area3D>();

  return {
    setup: async (ctx: Ctx<Record<string, unknown>, PhysicsContext>) => {
      await initialize();
      const world = new RAPIER.World(options.gravity ?? { x: 0, y: -9.81, z: 0 });
      const eventQueue = new RAPIER.EventQueue(true);
      context = {
        add: (body) => {
          bodies.add(body);
          bodiesByCollider.set(body.collider.handle, body);
        },
        addArea: (area) => areas.set(area.collider.handle, area),
        eventQueue,
        remove: (body) => {
          bodies.delete(body);
          bodiesByCollider.delete(body.collider.handle);
        },
        removeArea: (area) => areas.delete(area.collider.handle),
        world,
      };
      ctx.physics = context;
      return undefined;
    },
    update: (ctx, dt) => {
      const physics = context ?? ctx.physics;
      physics.world.timestep = dt;
      for (const body of bodies) {
        if (body instanceof CharacterBody3D) body.step();
        else body.syncToPhysics();
      }
      physics.world.step(physics.eventQueue);
      for (const body of bodies) body.syncFromPhysics();
      physics.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
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
        physics.world.intersectionsWithShape(
          area.collider.translation(),
          area.collider.rotation(),
          area.collider.shape,
          (collider) => {
            const body = bodiesByCollider.get(collider.handle);
            if (body !== undefined) current.set(body.body.handle, body);
            return true;
          },
          RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
          undefined,
          area.collider,
        );
        area.reconcileIntersections(current);
      }
    },
    dispose: () => {
      for (const area of areas.values()) area.dispose();
      for (const body of bodies) body.dispose();
      context?.eventQueue.free();
      context?.world.free();
      context = undefined;
      bodies.clear();
      bodiesByCollider.clear();
      areas.clear();
    },
  };
}
