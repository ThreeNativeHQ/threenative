import type { ICtx } from "@threenative/core";
import type { WaveField } from "@threenative/core";
import {
  Buoyancy3D,
  CollisionShape3D,
  type IPhysicsContext,
  RigidBody3D,
} from "@threenative/physics";
import { Group } from "three";
import { prepareShipConventions } from "../conventions.js";
import { createMaterials } from "../render/materials.js";
import { createShipModel } from "../render/props.js";
import type { ITouchInput } from "../render/touch-controls.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

const MAX_SPEED = 3.8;
const STEERING_SPEED = 2.5;

export class Ship {
  readonly mesh = new Group();
  readonly body: RigidBody3D;
  readonly buoyancy: Buoyancy3D;
  #capsized = false;
  #normaliseFactor: number;

  constructor(ctx: GameCtx, field: WaveField) {
    this.mesh.position.set(0, 0.24, 7);
    this.mesh.castShadow = true;
    const model = createShipModel(createMaterials());
    this.#normaliseFactor = prepareShipConventions(model);
    this.mesh.add(model);
    ctx.add(this.mesh);

    this.body = new RigidBody3D({
      collisionLayer: 1,
      collisionMask: 0,
      mass: 420,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(1.4, 0.7, 2.4),
    });
    this.buoyancy = new Buoyancy3D({
      body: this.body,
      density: 1_000,
      drag: 12,
      field,
      gravity: 9.81,
      hullPoints: [
        { position: [-0.45, -0.32, -0.75], volume: 0.275 },
        { position: [0.45, -0.32, -0.75], volume: 0.275 },
        { position: [-0.45, 0.32, 0.75], volume: 0.275 },
        { position: [0.45, 0.32, 0.75], volume: 0.275 },
      ],
      pointSpacing: 0.64,
      volume: 1.1,
    });
  }

  update(ctx: GameCtx, deltaTime: number, wind: number, touch?: ITouchInput): void {
    const move = ctx.input.vector("move");
    if (touch !== undefined) {
      move.x += touch.move.x;
      move.y += touch.move.y;
      move.clampLength(0, 1);
    }
    const speed = MAX_SPEED * Math.max(0, Math.min(1, wind));
    const targetX = move.x * STEERING_SPEED * Math.max(0.4, wind);
    const targetZ = -move.y * speed;
    const blend = Math.min(1, Math.max(0, deltaTime) * 8);
    const velocity = this.body.linearVelocity;
    this.body.linearVelocity = {
      x: velocity.x + (targetX - velocity.x) * blend,
      y: velocity.y,
      z: velocity.z + (targetZ - velocity.z) * blend,
    };
    this.mesh.rotation.y += move.x * deltaTime * 0.35;
  }

  capsize(): void {
    if (this.#capsized) return;
    this.#capsized = true;
    const model = this.mesh.children[0];
    if (model !== undefined) model.rotation.z = Math.PI / 2;
  }

  get capsized(): boolean {
    return this.#capsized;
  }

  debug(): Record<string, unknown> {
    const velocity = this.body.linearVelocity;
    return {
      capsized: this.#capsized,
      linearVelocity: [velocity.x, velocity.y, velocity.z],
      normaliseFactor: this.#normaliseFactor,
      position: this.mesh.position.toArray(),
      submergedFraction: this.buoyancy.submergedFraction,
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
