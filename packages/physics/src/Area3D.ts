import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Vector3 } from "three";
import type { CollisionShape3D } from "./CollisionShape3D.js";
import { interactionGroups } from "./collision.js";
import {
  type PhysicsBodyHandle,
  type PhysicsColliderHandle,
  type PhysicsWorldHandle,
  physicsBodyHandle,
  physicsColliderHandle,
} from "./handles.js";
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
  /** @deprecated Prefer `physics`; a raw web world is backend-specific. */
  readonly world?: PhysicsWorldHandle | unknown;
  readonly shape: CollisionShape3D;
  readonly position?: Pick<Vector3, "x" | "y" | "z">;
  /** Godot's collision_layer — which layers this area occupies. Default 1. */
  readonly collisionLayer?: number;
  /** Godot's collision_mask — which layers this area scans. Default 0xffff. */
  readonly collisionMask?: number;
}

export class Area3D {
  readonly entity: string | undefined;
  readonly body: PhysicsBodyHandle;
  readonly collider: PhysicsColliderHandle;
  #world: RAPIER.World;
  #physics: PhysicsContext | undefined;
  #entered = new Map<number, PhysicsBody3D>();
  #contacts: AreaContact[] = [];
  #monitoring = true;
  #listeners: Record<AreaEvent, Set<AreaHandler>> = {
    bodyEntered: new Set(),
    bodyExited: new Set(),
  };
  #disposed = false;

  #rawBody(): RAPIER.RigidBody {
    return this.body.raw as RAPIER.RigidBody;
  }

  constructor(options: Area3DOptions) {
    const worldHandle = options.world ?? options.physics?.world;
    if (worldHandle === undefined) throw new Error("Area3D requires a physics context or world.");
    const world =
      typeof worldHandle === "object" && worldHandle !== null && "raw" in worldHandle
        ? ((worldHandle as PhysicsWorldHandle).raw as RAPIER.World)
        : (worldHandle as RAPIER.World);
    this.#world = world;
    this.#physics = options.physics;
    this.entity = options.entity;
    const position = options.position ?? { x: 0, y: 0, z: 0 };
    const rawBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z),
    );
    rawBody.userData = this;
    const shape = options.shape.setSensor(true).raw as RAPIER.ColliderDesc;
    shape.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    if (options.collisionLayer !== undefined || options.collisionMask !== undefined) {
      shape.setCollisionGroups(
        interactionGroups(options.collisionLayer ?? 1, options.collisionMask ?? 0xffff),
      );
    }
    const rawCollider = world.createCollider(shape, rawBody);
    this.body = physicsBodyHandle(rawBody.handle, rawBody);
    this.collider = physicsColliderHandle(rawCollider.handle, rawCollider);
    this.#physics?.addArea(this);
  }

  on(event: AreaEvent, handler: AreaHandler): () => void {
    this.#listeners[event].add(handler);
    return () => this.#listeners[event].delete(handler);
  }

  /** Mirrors Godot's Area3D.monitoring. When false the area reports no contacts. */
  get monitoring(): boolean {
    return this.#monitoring;
  }

  set monitoring(value: boolean) {
    if (this.#monitoring === value) return;
    this.#monitoring = value;
    if (!value) this.#entered.clear();
  }

  setPosition(position: Pick<Vector3, "x" | "y" | "z">): void {
    const body = this.#rawBody();
    if (this.#disposed || !body.isValid()) return;
    body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
  }

  handleCollision(body: PhysicsBody3D, started: boolean): void {
    if (this.#disposed || !this.#monitoring) return;
    const handle = body.body.id;
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
    const body = this.#rawBody();
    if (body.isValid()) this.#world.removeRigidBody(body);
    this.#entered.clear();
    this.#listeners.bodyEntered.clear();
    this.#listeners.bodyExited.clear();
  }
}
