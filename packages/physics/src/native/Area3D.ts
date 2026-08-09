import type { Vector3 } from "three";
import type { Area3DOptions, AreaContact, AreaEvent, AreaHandler } from "../Area3D.js";
import { physicsBodyHandle, physicsColliderHandle } from "../handles.js";
import type { PhysicsBodyHandle, PhysicsColliderHandle } from "../handles.js";
import type { PhysicsBody3D } from "../plugin.js";
import type { CollisionShape3D } from "./CollisionShape3D.js";
import { nativeSimulation } from "./host.js";
import type { NativeSimulation } from "./host.js";

const MAX_CONTACT_LOG = 1_000;

export class Area3D {
  readonly entity: string | undefined;
  readonly body: PhysicsBodyHandle;
  readonly collider: PhysicsColliderHandle;
  readonly #simulation: NativeSimulation;
  readonly #physics: Area3DOptions["physics"];
  readonly #position = { x: 0, y: 0, z: 0 };
  #entered = new Map<number, PhysicsBody3D>();
  #contacts: AreaContact[] = [];
  #monitoring = true;
  #disposed = false;
  #listeners: Record<AreaEvent, Set<AreaHandler>> = {
    bodyEntered: new Set(),
    bodyExited: new Set(),
  };

  constructor(options: Omit<Area3DOptions, "shape"> & { readonly shape: CollisionShape3D }) {
    const world = options.world ?? options.physics?.world;
    if (world === undefined) throw new Error("Area3D requires a physics context or world.");
    this.#simulation = nativeSimulation(
      typeof world === "object" && world !== null && "raw" in world ? world.raw : world,
    );
    this.#physics = options.physics;
    this.entity = options.entity;
    Object.assign(this.#position, options.position ?? { x: 0, y: 0, z: 0 });
    const shape = options.shape.setSensor(true).raw;
    const id = this.#simulation.createBody({
      collisionLayer: options.collisionLayer ?? shape.collisionLayer,
      collisionMask: options.collisionMask ?? shape.collisionMask,
      mass: 0,
      position: this.#position,
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      sensor: true,
      shape,
      type: "kinematic",
    });
    const raw = { backend: "native", id } as const;
    this.body = physicsBodyHandle(id, raw);
    this.collider = physicsColliderHandle(id, raw);
    this.#physics?.addArea(this as never);
  }

  on(event: AreaEvent, handler: AreaHandler): () => void {
    this.#listeners[event].add(handler);
    return () => this.#listeners[event].delete(handler);
  }

  get monitoring(): boolean {
    return this.#monitoring;
  }

  set monitoring(value: boolean) {
    if (this.#monitoring === value) return;
    this.#monitoring = value;
    if (!value) this.#entered.clear();
  }

  setPosition(position: Pick<Vector3, "x" | "y" | "z">): void {
    if (!this.#disposed) Object.assign(this.#position, position);
  }

  writeKinematic(buffer: Float32Array, offset: number): void {
    buffer.set(
      [this.body.id, this.#position.x, this.#position.y, this.#position.z, 0, 0, 0, 1],
      offset,
    );
  }

  handleCollision(body: PhysicsBody3D, started: boolean): void {
    if (this.#disposed || !this.#monitoring) return;
    const id = body.body.id;
    if (started) {
      if (this.#entered.has(id)) return;
      this.#entered.set(id, body);
      this.#contacts.push({ area: this as never, body, entity: this.entity, started: true });
      if (this.#contacts.length > MAX_CONTACT_LOG) this.#contacts.shift();
      for (const handler of this.#listeners.bodyEntered) handler(body);
      return;
    }
    const entered = this.#entered.get(id);
    if (entered === undefined) return;
    this.#entered.delete(id);
    this.#contacts.push({
      area: this as never,
      body: entered,
      entity: this.entity,
      started: false,
    });
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
    for (const [id, body] of this.#entered) if (!current.has(id)) this.handleCollision(body, false);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#physics?.removeArea(this as never);
    this.#simulation.removeBody(this.body.id);
    this.#entered.clear();
    this.#listeners.bodyEntered.clear();
    this.#listeners.bodyExited.clear();
  }
}
