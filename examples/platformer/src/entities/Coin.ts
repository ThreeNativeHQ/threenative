import type { Ctx } from "@threenative/core";
import { Area3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { CylinderGeometry, Group, Mesh, OctahedronGeometry, type Vector3 } from "three";
import type { Materials } from "../render/materials.js";
import type { GameState } from "../state.js";

export type CoinKind = "coin" | "gem";

/**
 * One spinning pickup. Coins and gems differ only in mesh, tag and payout, so
 * they share a class rather than a near-identical copy of one.
 */
export class Coin {
  readonly area: Area3D;
  readonly kind: CoinKind;
  readonly mesh: Group;
  tags: string[];
  collected = false;
  #phase: number;
  #baseY: number;

  constructor(
    ctx: Ctx<GameState, PhysicsContext>,
    id: string,
    kind: CoinKind,
    position: Vector3,
    materials: Materials,
  ) {
    this.kind = kind;
    this.tags = [kind];
    this.mesh = new Group();
    this.mesh.position.copy(position);
    const face =
      kind === "coin"
        ? new Mesh(new CylinderGeometry(0.28, 0.28, 0.07, 18), materials.coin)
        : new Mesh(new OctahedronGeometry(0.3, 0), materials.gem);
    if (kind === "coin") face.rotation.x = Math.PI / 2;
    face.castShadow = true;
    this.mesh.add(face);
    ctx.add(this.mesh);

    this.area = new Area3D({
      entity: id,
      physics: ctx.physics,
      position,
      shape: CollisionShape3D.sphere(kind === "coin" ? 0.55 : 0.65),
    });
    // Deterministic per-position phase so the row of coins ripples instead of
    // pulsing in lockstep, and so two runs look identical.
    this.#phase = (position.x + position.z) * 0.7;
    this.#baseY = position.y;
  }

  update(elapsed: number, dt: number): void {
    if (this.collected) return;
    this.mesh.rotation.y += dt * 2.6;
    this.mesh.position.y = this.#baseY + Math.sin(elapsed * 2.4 + this.#phase) * 0.12;
  }

  /**
   * The entity stays in the registry after collection: its Area3D still holds
   * the contact that proves the pickup happened, and the drained tag count is
   * what a scenario reads to prove the level was cleared.
   */
  collect(): void {
    if (this.collected) return;
    this.collected = true;
    this.tags = [];
    this.mesh.visible = false;
    this.area.dispose();
  }

  debug(): Record<string, unknown> {
    return { collected: this.collected, kind: this.kind, position: this.mesh.position.toArray() };
  }

  dispose(): void {
    this.area.dispose();
    this.mesh.removeFromParent();
  }
}
