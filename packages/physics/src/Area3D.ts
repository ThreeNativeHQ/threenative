import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Vector3 } from "three";
import type { PhysicsBody3D, PhysicsContext } from "./plugin.js";

export type AreaEvent = "bodyEntered" | "bodyExited";
export type AreaHandler = (body: PhysicsBody3D) => void;
const MAX_CONTACT_LOG = 1_000;

export interface AreaContact {
  readonly area: Area3D;
  readonly body: PhysicsBody3D;
  readonly entity?: string;
  readonly started: boolean;
}

export interface Area3DOptions {
  readonly entity?: string;
  readonly physics?: PhysicsContext;
  readonly world?: RAPIER.World;
  readonly shape: RAPIER.ColliderDesc;
  readonly position?: Pick<Vector3, "x" | "y" | "z">;
}

export class Area3D {
  readonly entity: string | undefined;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  #world: RAPIER.World;
  #physics: PhysicsContext | undefined;
  #entered = new Map<number, PhysicsBody3D>();
  #contacts: AreaContact[] = [];
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
    this.entity = options.entity;
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

  setPosition(position: Pick<Vector3, "x" | "y" | "z">): void {
    if (this.#disposed || !this.body.isValid()) return;
    this.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
  }

  handleCollision(body: PhysicsBody3D, started: boolean): void {
    if (this.#disposed) return;
    const handle = body.body.handle;
    if (started) {
      if (this.#entered.has(handle)) return;
      this.#entered.set(handle, body);
      this.#contacts.push({ area: this, body, entity: this.entity, started: true });
      if (this.#contacts.length > MAX_CONTACT_LOG) this.#contacts.shift();
      for (const handler of this.#listeners.bodyEntered) handler(body);
      return;
    }
    const entered = this.#entered.get(handle);
    if (entered === undefined) return;
    this.#entered.delete(handle);
    this.#contacts.push({ area: this, body: entered, entity: this.entity, started: false });
    if (this.#contacts.length > MAX_CONTACT_LOG) this.#contacts.shift();
    for (const handler of this.#listeners.bodyExited) handler(entered);
  }

  drainContacts(): AreaContact[] {
    const contacts = this.#contacts;
    this.#contacts = [];
    return contacts;
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
