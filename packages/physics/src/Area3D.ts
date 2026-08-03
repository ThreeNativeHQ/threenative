import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Vector3 } from "three";
import type { PhysicsBody3D, PhysicsContext } from "./plugin.js";

export type AreaEvent = "bodyEntered" | "bodyExited";
export type AreaHandler = (body: PhysicsBody3D) => void;

export interface Area3DOptions {
  readonly physics?: PhysicsContext;
  readonly world?: RAPIER.World;
  readonly shape: RAPIER.ColliderDesc;
  readonly position?: Pick<Vector3, "x" | "y" | "z">;
}

export class Area3D {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  #world: RAPIER.World;
  #physics: PhysicsContext | undefined;
  #entered = new Map<number, PhysicsBody3D>();
  #listeners: Record<AreaEvent, Set<AreaHandler>> = {
    bodyEntered: new Set(),
    bodyExited: new Set(),
  };
  #disposed = false;

  constructor(options: Area3DOptions) {
    const world = options.world ?? options.physics?.world;
    if (world === undefined) throw new Error("Area3D requires a physics context or world.");
    this.#world = world;
    this.#physics = options.physics;
    const position = options.position ?? { x: 0, y: 0, z: 0 };
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z),
    );
    this.body.userData = this;
    this.collider = world.createCollider(
      options.shape.setSensor(true).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    this.#physics?.addArea(this);
  }

  on(event: AreaEvent, handler: AreaHandler): () => void {
    this.#listeners[event].add(handler);
    return () => this.#listeners[event].delete(handler);
  }

  handleCollision(body: PhysicsBody3D, started: boolean): void {
    if (this.#disposed) return;
    const handle = body.body.handle;
    if (started) {
      if (this.#entered.has(handle)) return;
      this.#entered.set(handle, body);
      for (const handler of this.#listeners.bodyEntered) handler(body);
      return;
    }
    const entered = this.#entered.get(handle);
    if (entered === undefined) return;
    this.#entered.delete(handle);
    for (const handler of this.#listeners.bodyExited) handler(entered);
  }

  reconcileIntersections(current: ReadonlyMap<number, PhysicsBody3D>): void {
    for (const body of current.values()) this.handleCollision(body, true);
    for (const [handle, body] of this.#entered) {
      if (!current.has(handle)) this.handleCollision(body, false);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#physics?.removeArea(this);
    if (this.body.isValid()) this.#world.removeRigidBody(this.body);
    this.#entered.clear();
    this.#listeners.bodyEntered.clear();
    this.#listeners.bodyExited.clear();
  }
}
