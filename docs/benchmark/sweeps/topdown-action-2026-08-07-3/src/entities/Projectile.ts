import type { Ctx } from "@threenative/core";
import { Mesh, type Material, Vector3 } from "three";
import { ball, block } from "../render/shapes.js";
import type { GameState } from "../state.js";
import type { PhysicsContext } from "@threenative/physics";

type GameCtx = Ctx<GameState, PhysicsContext>;

export interface ProjectileMaterials {
  readonly body: Material;
  readonly trail: Material;
}

export interface ProjectileTarget {
  readonly active: boolean;
  readonly health: number;
  readonly position: Vector3;
  hit(damage?: number): boolean;
}

export class Projectile {
  readonly mesh: Mesh;
  readonly #velocity: Vector3;
  #target: ProjectileTarget | undefined;
  #life = 1.15;

  constructor(
    ctx: GameCtx,
    origin: Vector3,
    direction: Vector3,
    materials: ProjectileMaterials,
    target?: ProjectileTarget,
  ) {
    this.mesh = ball(0.12, materials.body, { segments: 4 });
    this.mesh.position.copy(origin);
    this.#velocity = direction.clone().setY(0).normalize().multiplyScalar(12);
    this.#target = target;

    const trail = block(0.08, 0.08, 0.42, materials.trail, { radius: 0.03 });
    trail.position.z = 0.24;
    this.mesh.add(trail);
    this.mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, -1), this.#velocity.clone().normalize());
    ctx.add(this.mesh);
  }

  get target(): ProjectileTarget | undefined {
    return this.#target;
  }

  setTarget(target: ProjectileTarget): void {
    if (this.#target !== undefined) return;
    this.#target = target;
    this.#steerToTarget();
  }

  update(dt: number): boolean {
    this.#life -= dt;
    this.#steerToTarget();
    this.mesh.position.addScaledVector(this.#velocity, dt);
    const pulse = 1 + Math.sin((1.15 - this.#life) * 32) * 0.08;
    this.mesh.scale.setScalar(pulse);
    return this.#life > 0 && Math.abs(this.mesh.position.x) < 10 && Math.abs(this.mesh.position.z) < 8;
  }

  #steerToTarget(): void {
    if (this.#target === undefined || !this.#target.active) return;
    const direction = this.#target.position.clone().setY(this.mesh.position.y).sub(this.mesh.position);
    if (direction.lengthSq() < 0.0001) return;
    this.#velocity.copy(direction.normalize()).multiplyScalar(12);
    this.mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, -1), this.#velocity.clone().normalize());
  }

  dispose(): void {
    this.mesh.removeFromParent();
  }
}
