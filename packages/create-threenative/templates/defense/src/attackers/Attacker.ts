import { PathFollow3D } from "@threenative/core";
import { CollisionShape3D } from "@threenative/physics";
import { type Group, Vector3 } from "three";
import { ATTACKER_LAYER, type DefensePhysics, createEntityBody } from "../physics.js";
import { emitPlaytestEvent } from "../playtest-events.js";
import { attacker as attackerMesh } from "../render/shapes.js";

export const ATTACKER_SPEED = 7;
export const ATTACKER_HEALTH = 4;

export class Attacker {
  readonly id: string;
  readonly lateralOffset: number;
  readonly mesh: Group;
  readonly tags = ["attacker", "hostile"];
  readonly #body;
  readonly #path: PathFollow3D;
  #health = ATTACKER_HEALTH;
  #dead = false;
  #escaped = false;
  readonly #onDefeated: () => void;
  readonly #onLeak: () => void;

  constructor(options: {
    readonly id: string;
    readonly lateralOffset: number;
    readonly pathPoints: readonly Vector3[];
    readonly physics: DefensePhysics;
    readonly onDefeated: () => void;
    readonly onLeak: () => void;
  }) {
    this.id = options.id;
    this.lateralOffset = options.lateralOffset;
    this.#onDefeated = options.onDefeated;
    this.#onLeak = options.onLeak;
    this.#path = new PathFollow3D({ points: options.pathPoints, speed: ATTACKER_SPEED });
    this.mesh = attackerMesh();
    this.#place(this.lateralOffset);
    this.#body = createEntityBody({
      collisionLayer: ATTACKER_LAYER,
      collisionMask: 0,
      entity: this.id,
      object: this.mesh,
      physics: options.physics,
      shape: CollisionShape3D.sphere(0.42),
      type: "kinematic",
    });
  }

  get dead(): boolean {
    return this.#dead;
  }

  get escaped(): boolean {
    return this.#escaped;
  }

  takeDamage(amount: number): void {
    if (this.#dead || this.#escaped) return;
    if (!Number.isFinite(amount) || amount <= 0)
      throw new Error("Attacker damage must be positive.");
    this.#health = Math.max(0, this.#health - amount);
    if (this.#health > 0) return;
    this.#dead = true;
    this.mesh.visible = false;
    this.#onDefeated();
    emitPlaytestEvent({ entity: this.id, name: "defeated" });
  }

  update(dt: number): void {
    if (this.#dead || this.#escaped) return;
    const sample = this.#path.advance(dt);
    this.#place(this.lateralOffset, sample.point, sample.tangent);
    if (!this.#path.completed) return;
    this.#escaped = true;
    this.mesh.visible = false;
    this.#onLeak();
    emitPlaytestEvent({ entity: this.id, name: "leaked" });
  }

  debug(): Record<string, unknown> {
    return {
      health: this.#health,
      position: this.mesh.position.toArray(),
      progress: this.#path.progress,
      reachedBase: this.#escaped,
    };
  }

  dispose(): void {
    this.#body.dispose();
    this.mesh.removeFromParent();
  }

  #place(
    lateralOffset: number,
    point = this.#path.sample().point,
    tangent = this.#path.sample().tangent,
  ): void {
    const side = new Vector3(-tangent.z, 0, tangent.x).normalize();
    this.mesh.position.copy(point).addScaledVector(side, lateralOffset).setY(0);
    this.mesh.rotation.y = Math.atan2(tangent.x, tangent.z);
  }
}
