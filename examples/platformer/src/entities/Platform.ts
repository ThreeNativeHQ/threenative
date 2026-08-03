import type { Ctx } from "@threenative/core";
import { CollisionShape3D, type PhysicsContext, RigidBody3D } from "@threenative/physics";
import { BoxGeometry, Mesh, type Vector3 } from "three";
import { FOX_RISE } from "../render/fox.js";
import type { Materials } from "../render/materials.js";
import type { GameState } from "../state.js";

/**
 * A kinematic lift. Because the body is kinematic, the physics plugin reports
 * its per-tick delta and CharacterBody3D adds it to whoever is standing on it —
 * the fox rides without pressing anything.
 */
export class Platform {
  readonly body: RigidBody3D;
  readonly mesh: Mesh;
  #origin: Vector3;
  #travel: Vector3;
  #speed: number;
  #size: readonly [number, number, number];
  #time = 0;
  #departed = false;

  constructor(
    ctx: Ctx<GameState, PhysicsContext>,
    position: Vector3,
    size: readonly [number, number, number],
    travel: Vector3,
    seconds: number,
    materials: Materials,
  ) {
    this.#origin = position.clone();
    this.#travel = travel.clone();
    this.#speed = seconds > 0 ? 1 / seconds : 0;
    this.#size = size;
    this.mesh = new Mesh(new BoxGeometry(size[0], size[1], size[2]), materials.wood);
    this.mesh.position.copy(position);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    ctx.add(this.mesh);
    this.body = new RigidBody3D({
      mesh: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(size[0], size[1], size[2]),
      type: "kinematic",
    });
  }

  /**
   * A one-way ferry: it waits at its origin until something stands on it, then
   * runs to the far end and stays there. Departing on contact rather than on a
   * global clock is kinder to the player, and it is what makes "board it, press
   * nothing, arrive" reproducible instead of a timing puzzle.
   */
  update(dt: number): void {
    if (!this.#departed) return;
    this.#time += dt;
    const progress = Math.min(1, this.#time * this.#speed);
    this.mesh.position.copy(this.#origin).addScaledVector(this.#travel, progress);
  }

  /** True when `position` is a rider: within the deck's footprint and on it. */
  carries(position: Vector3, grounded: boolean): boolean {
    if (!grounded) return false;
    const top = this.mesh.position.y + this.#size[1] / 2;
    return (
      Math.abs(position.x - this.mesh.position.x) <= this.#size[0] / 2 + 0.25 &&
      Math.abs(position.z - this.mesh.position.z) <= this.#size[2] / 2 + 0.25 &&
      Math.abs(position.y - FOX_RISE - top) <= 0.25
    );
  }

  board(): void {
    this.#departed = true;
  }

  debug(): Record<string, unknown> {
    return { position: this.mesh.position.toArray() };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
