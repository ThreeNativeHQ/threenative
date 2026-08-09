import type { Ctx } from "@threenative/core";
import { physicsHandle } from "../handles.js";
import type { PhysicsContext, PhysicsOptions, PhysicsPlugin } from "../plugin.js";
import { PHYSICS_TRANSFORM_STRIDE } from "../simulation.js";
import type { Area3D } from "./Area3D.js";
import { CharacterBody3D } from "./CharacterBody3D.js";
import type { RigidBody3D } from "./RigidBody3D.js";
import { nativePhysicsHost } from "./host.js";
import type { NativeSimulation } from "./host.js";

type NativeBody3D = CharacterBody3D | RigidBody3D;

function grow(buffer: Float32Array, records: number): Float32Array {
  if (buffer.length >= records * PHYSICS_TRANSFORM_STRIDE) return buffer;
  return new Float32Array(
    Math.max(records, Math.max(1, buffer.length / PHYSICS_TRANSFORM_STRIDE) * 2) *
      PHYSICS_TRANSFORM_STRIDE,
  );
}

function writeTransform(buffer: Float32Array, index: number, body: NativeBody3D): void {
  const offset = index * PHYSICS_TRANSFORM_STRIDE;
  const { position, quaternion } = body.object;
  buffer.set(
    [
      body.body.id,
      position.x,
      position.y,
      position.z,
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w,
    ],
    offset,
  );
}

export function rapier(options: PhysicsOptions = {}): PhysicsPlugin {
  let simulation: NativeSimulation | undefined;
  let context: PhysicsContext | undefined;
  const bodies = new Set<NativeBody3D>();
  const bodiesById = new Map<number, NativeBody3D>();
  const areas = new Map<number, Area3D>();
  let kinematic: Float32Array<ArrayBufferLike> = new Float32Array(PHYSICS_TRANSFORM_STRIDE * 16);
  let visible: Float32Array<ArrayBufferLike> = new Float32Array(PHYSICS_TRANSFORM_STRIDE * 16);
  let events = new Uint32Array(64);

  const plugin = {
    setup: async (
      ctx: Ctx<Record<string, unknown>, PhysicsContext>,
      runtime?: { rapier?: string },
    ) => {
      const host = nativePhysicsHost();
      simulation = host.createSimulation(options);
      if (runtime !== undefined) runtime.rapier = host.version;
      context = {
        add: (body) => {
          const native = body as unknown as NativeBody3D;
          bodies.add(native);
          bodiesById.set(native.body.id, native);
        },
        addArea: (area) => {
          const native = area as unknown as Area3D;
          areas.set(native.body.id, native);
        },
        eventQueue: physicsHandle(simulation),
        numBodies: () => bodies.size,
        remove: (body) => {
          const native = body as unknown as NativeBody3D;
          bodies.delete(native);
          bodiesById.delete(native.body.id);
        },
        removeArea: (area) => areas.delete(area.body.id),
        simulation,
        world: physicsHandle(simulation),
      };
      ctx.physics = context;
    },
    update: (_ctx: unknown, dt: number) => {
      if (simulation === undefined) throw new Error("Native physics updated before setup.");
      let count = 0;
      kinematic = grow(kinematic, bodies.size + areas.size);
      for (const body of bodies) {
        if (body instanceof CharacterBody3D) body.prepareStep();
        if (body instanceof CharacterBody3D || body.type === "kinematic") {
          writeTransform(kinematic, count, body);
          count += 1;
        }
      }
      for (const area of areas.values()) {
        area.writeKinematic(kinematic, count * PHYSICS_TRANSFORM_STRIDE);
        count += 1;
      }
      simulation.step(dt, { kinematicCount: count, kinematicTransforms: kinematic });
      visible = grow(visible, bodies.size + areas.size);
      const visibleCount = simulation.readVisibleTransforms(visible);
      for (let index = 0; index < visibleCount; index += 1) {
        const offset = index * PHYSICS_TRANSFORM_STRIDE;
        const id = visible[offset];
        if (id === undefined || !Number.isInteger(id))
          throw new Error("Native physics returned an invalid body id.");
        bodiesById.get(id)?.applyTransform(visible, offset);
      }
      const pairCapacity = Math.max(16, (bodies.size + areas.size) ** 2 * 4);
      if (events.length < pairCapacity) events = new Uint32Array(pairCapacity);
      const eventCount = simulation.drainCollisionEvents(events);
      for (let index = 0; index < eventCount; index += 1) {
        const offset = index * 4;
        const left = events[offset];
        const right = events[offset + 1];
        const started = events[offset + 2] === 1;
        if (left === undefined || right === undefined)
          throw new Error("Native physics returned a malformed collision event.");
        const leftArea = areas.get(left);
        const rightArea = areas.get(right);
        const leftBody = bodiesById.get(left);
        const rightBody = bodiesById.get(right);
        if (leftArea !== undefined && rightBody !== undefined)
          leftArea.handleCollision(rightBody as never, started);
        if (rightArea !== undefined && leftBody !== undefined)
          rightArea.handleCollision(leftBody as never, started);
      }
    },
    sceneExit: () => {
      for (const area of [...areas.values()]) area.dispose();
      for (const body of [...bodies]) body.dispose();
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
    },
  };
  return plugin as PhysicsPlugin;
}
