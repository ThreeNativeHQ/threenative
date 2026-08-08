import type { Ctx } from "@threenative/core";
import { Group, Mesh, type Material, Vector3 } from "three";
import { ball, block, spike, tube } from "../render/shapes.js";
import type { GameState } from "../state.js";
import type { PhysicsContext } from "@threenative/physics";

type GameCtx = Ctx<GameState, PhysicsContext>;

export interface EnemyMaterials {
  readonly body: Material;
  readonly detail: Material;
  readonly health: Material;
}

export class EnemyTarget {
  readonly group: Group;
  readonly core: Mesh;
  readonly maxHealth = 2;
  health = this.maxHealth;

  #defeated = false;
  #hitTimer = 0;
  #deathTimer = 0;
  #phase: number;
  readonly #baseY: number;
  readonly #segments: Mesh[] = [];

  constructor(
    ctx: GameCtx,
    position: { readonly x: number; readonly y?: number; readonly z: number },
    materials: EnemyMaterials,
    phase: number,
  ) {
    this.group = new Group();
    this.group.position.set(position.x, position.y ?? 0, position.z);
    this.#baseY = this.group.position.y;
    this.#phase = phase;

    const shadow = tube(0.48, 0.48, 0.05, materials.detail, { segments: 18 });
    shadow.rotation.x = Math.PI / 2;
    shadow.position.y = 0.06;

    const base = block(0.9, 0.18, 0.9, materials.detail, { radius: 0.16 });
    base.position.y = 0.12;

    this.core = ball(0.43, materials.body, { segments: 18 });
    this.core.position.y = 0.63;

    const crown = spike(0.2, 0.35, materials.body, { segments: 12 });
    crown.position.y = 1.12;
    crown.rotation.y = Math.PI / 4;

    const eye = block(0.27, 0.12, 0.12, materials.detail, { radius: 0.04 });
    eye.position.set(0, 0.68, -0.4);

    const healthBar = new Group();
    healthBar.position.set(0, 1.48, 0);
    for (let index = 0; index < this.maxHealth; index += 1) {
      const segment = block(0.22, 0.06, 0.09, materials.health, { radius: 0.025 });
      segment.position.x = (index - (this.maxHealth - 1) / 2) * 0.27;
      this.#segments.push(segment);
      healthBar.add(segment);
    }

    this.group.add(shadow, base, this.core, crown, eye, healthBar);
    this.group.traverse((object) => {
      object.userData.enemyTarget = this;
    });
    ctx.add(this.group);
  }

  get active(): boolean {
    return !this.#defeated;
  }

  get position(): Vector3 {
    return this.group.position;
  }

  hit(damage = 1): boolean {
    if (this.#defeated) return false;
    this.health = Math.max(0, this.health - damage);
    this.#hitTimer = 0.15;
    for (let index = 0; index < this.#segments.length; index += 1) {
      this.#segments[index]!.visible = index < this.health;
    }
    if (this.health > 0) return false;
    this.#defeated = true;
    this.#deathTimer = 0.42;
    return true;
  }

  update(dt: number, time: number): void {
    if (this.#defeated) {
      this.#deathTimer -= dt;
      this.group.scale.lerp(new Vector3(0.2, 0.2, 0.2), Math.min(1, dt * 11));
      this.group.rotation.y += dt * 8;
      if (this.#deathTimer <= 0) this.group.visible = false;
      return;
    }

    this.#hitTimer = Math.max(0, this.#hitTimer - dt);
    const bob = Math.sin(time * 2.2 + this.#phase) * 0.055;
    this.group.position.y = this.#baseY + bob;
    this.group.rotation.y += dt * 0.3;
    const hitScale = this.#hitTimer > 0 ? 1.12 : 1;
    this.core.scale.setScalar(hitScale);
  }

  debug(): { defeated: boolean; health: number; position: number[] } {
    return { defeated: this.#defeated, health: this.health, position: this.position.toArray() };
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
