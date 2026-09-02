import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, Vector3 } from "three";
import { prepareVehicleConventions } from "../conventions.js";
import { Boost } from "../kart/boost.js";
import { createMaterials } from "../render/materials.js";
import { vehicle } from "../render/shapes.js";
import type { ITouchInput } from "../render/touch-controls.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

export const RACING_FEEL = {
  acceleration: 9.5,
  brake: 20,
  drag: 2.6,
  gravity: -24,
  maxFallSpeed: 30,
  maxSpeed: 9,
  turnRate: 2.25,
} as const;

export class RacingCar {
  readonly mesh = new Group();
  readonly body: CharacterBody3D;
  readonly forward = new Vector3(1, 0, 0);
  readonly travelDirection = new Vector3(1, 0, 0);
  readonly boost = new Boost();
  #speed = 0;
  #heading = 0;
  #normaliseFactor: number;
  #topSpeed = 0;

  constructor(ctx: GameCtx, spawn: Vector3) {
    this.mesh.position.copy(spawn);
    this.mesh.castShadow = true;
    const visual = vehicle(createMaterials());
    this.#normaliseFactor = prepareVehicleConventions(visual);
    this.mesh.add(visual);
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.25, minWidth: 0.2 },
      collisionLayer: 1,
      collisionMask: 6,
      gravity: RACING_FEEL.gravity,
      maxFallSpeed: RACING_FEEL.maxFallSpeed,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(2.7, 0.35, 1.6),
      snapToGround: 0.25,
    });
  }

  update(ctx: GameCtx, dt: number, touch?: ITouchInput): void {
    this.boost.update(dt);
    if (ctx.input.justPressed("boost") || touch?.boostPressed === true) this.boost.activate();
    const move = ctx.input.vector("move");
    if (touch !== undefined) {
      move.x += touch.move.x;
      move.y += touch.move.y;
      move.clampLength(0, 1);
    }
    const throttle = move.y;
    const target =
      throttle * RACING_FEEL.maxSpeed * (this.boost.active ? this.boost.multiplier : 1);
    const rate =
      Math.abs(target) > Math.abs(this.#speed) ? RACING_FEEL.acceleration : RACING_FEEL.drag;
    this.#speed = approach(this.#speed, target, rate * dt);
    if (ctx.input.pressed("brake") || touch?.brakePressed === true)
      this.#speed = approach(this.#speed, 0, RACING_FEEL.brake * dt);
    const steering =
      move.x * (Math.min(1, Math.abs(this.#speed) / RACING_FEEL.maxSpeed) * 0.65 + 0.35);
    this.#heading += steering * RACING_FEEL.turnRate * dt * (this.#speed < 0 ? -1 : 1);
    this.forward.set(Math.cos(this.#heading), 0, Math.sin(this.#heading));
    this.travelDirection.copy(this.forward).multiplyScalar(this.#speed < -0.05 ? -1 : 1);
    this.mesh.rotation.y = this.#heading;
    this.body.velocity.x = this.forward.x * this.#speed;
    this.body.velocity.z = this.forward.z * this.#speed;
    this.body.moveAndSlide(dt);
    this.#topSpeed = Math.max(this.#topSpeed, Math.abs(this.#speed));
  }

  setHeading(heading: Vector3): void {
    const flat = heading.clone().setY(0);
    if (flat.lengthSq() < 0.0001) return;
    flat.normalize();
    this.#heading = Math.atan2(flat.z, flat.x);
    this.forward.copy(flat);
    this.travelDirection.copy(flat);
    this.mesh.rotation.y = this.#heading;
  }

  speedAfterBoost(): number {
    return this.boost.active ? 0 : Math.abs(this.#speed);
  }

  get speed(): number {
    return Math.abs(this.#speed);
  }

  get topSpeed(): number {
    return this.#topSpeed;
  }

  debug(): Record<string, unknown> {
    return {
      boostActive: this.boost.active,
      heading: this.#heading,
      normaliseFactor: this.#normaliseFactor,
      position: this.mesh.position.toArray(),
      speed: this.speed,
      topSpeed: this.#topSpeed,
      travelDirection: this.travelDirection.toArray(),
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}

function approach(current: number, target: number, delta: number): number {
  const difference = target - current;
  return Math.abs(difference) <= delta ? target : current + Math.sign(difference) * delta;
}
