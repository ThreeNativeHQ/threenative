import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Ctx, GamePluginHooks } from "@threenative/core";
import type { Area3D } from "./Area3D.js";
import { CharacterBody3D } from "./CharacterBody3D.js";
import { RigidBody3D } from "./RigidBody3D.js";
import type { NavigationContext } from "./navigation/index.js";

export interface PhysicsOptions {
  readonly gravity?: { readonly x: number; readonly y: number; readonly z: number };
}

export type PhysicsBody3D = RigidBody3D | CharacterBody3D;

export interface PhysicsContext {
  readonly world: RAPIER.World;
  readonly eventQueue: RAPIER.EventQueue;
  navigation?: NavigationContext;
  add(body: PhysicsBody3D): void;
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
  const areas = new Map<number, Area3D>();
  const kinematicMotions = new Map<
    number,
    { readonly x: number; readonly y: number; readonly z: number }
  >();

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
        kinematicMotion: (colliderHandle) => kinematicMotions.get(colliderHandle),
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
      kinematicMotions.clear();
      for (const body of bodies) {
        if (body instanceof RigidBody3D && body.type === "kinematic") {
          const before = body.body.translation();
          body.syncToPhysics();
          kinematicMotions.set(body.collider.handle, {
            x: body.object.position.x - before.x,
            y: body.object.position.y - before.y,
            z: body.object.position.z - before.z,
          });
        } else if (body instanceof RigidBody3D) body.syncToPhysics();
      }
      for (const body of bodies) {
        if (body instanceof CharacterBody3D) {
          body.syncToPhysics();
          body.step();
        }
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
        const areaMask = area.collider.collisionGroups() & 0xffff;
        physics.world.intersectionsWithShape(
          area.collider.translation(),
          area.collider.rotation(),
          area.collider.shape,
          (collider) => {
            const body = bodiesByCollider.get(collider.handle);
            if (body !== undefined && ((collider.collisionGroups() >>> 16) & areaMask) !== 0)
              current.set(body.body.handle, body);
            return true;
          },
          RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
          undefined,
          area.collider,
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
      context?.eventQueue.free();
      context?.world.free();
      context = undefined;
      bodies.clear();
      bodiesByCollider.clear();
      areas.clear();
      kinematicMotions.clear();
    },
  };
}
