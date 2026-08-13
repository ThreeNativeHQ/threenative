import type { ICtx } from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, Mesh, SphereGeometry, type Vector3 } from "three";
import { createMaterials } from "../render/materials.js";
import type { GameState } from "../state.js";
import type { Character, PLATFORMER_FEEL } from "./Character.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

export class Patrol {
  readonly mesh: Group;
  readonly area: Area3D;
  readonly tags = ["enemy", "patrol"];
  defeated = false;
  #from: Vector3;
  #to: Vector3;
  #direction = 1;
  #feel: typeof PLATFORMER_FEEL;
  #unsubscribe: () => void;

  constructor(
    ctx: GameCtx,
    player: Character,
    from: Vector3,
    to: Vector3,
    onStomp: () => void,
    onTouch: (fromX: number) => void,
    feel: typeof PLATFORMER_FEEL,
  ) {
    this.#from = from.clone();
    this.#to = to.clone();
    this.#feel = feel;
    this.mesh = new Group();
    const body = new Mesh(new SphereGeometry(0.46, 12, 8), createMaterials().accent);
    body.scale.y = 0.72;
    body.castShadow = true;
    this.mesh.add(body);
    this.mesh.position.copy(from);
    ctx.add(this.mesh);
    this.area = new Area3D({
      entity: "patrol",
      physics: ctx.physics,
      position: from,
      shape: CollisionShape3D.sphere(0.62),
    });
    this.#unsubscribe = this.area.on("bodyEntered", (body) => {
      if (this.defeated || body !== player.body) return;
      const stomped =
        player.mesh.position.y > this.mesh.position.y + this.#feel.stompHeight &&
        player.body.velocity.y < this.#feel.stompFallSpeed;
      if (stomped) {
        this.defeated = true;
        this.mesh.visible = false;
        player.bounce();
        onStomp();
        ctx.entities.queueFree(this);
      } else onTouch(this.mesh.position.x);
    });
  }

  update(dt: number): void {
    if (this.defeated) return;
    const next = this.mesh.position.x + this.#direction * this.#feel.patrolSpeed * dt;
    if (next >= this.#to.x) {
      this.mesh.position.x = this.#to.x;
      this.#direction = -1;
    } else if (next <= this.#from.x) {
      this.mesh.position.x = this.#from.x;
      this.#direction = 1;
    } else this.mesh.position.x = next;
    this.mesh.rotation.y = this.#direction > 0 ? 0 : Math.PI;
    this.area.setPosition(this.mesh.position);
  }

  debug(): Record<string, unknown> {
    return {
      defeated: this.defeated,
      direction: this.#direction,
      position: this.mesh.position.toArray(),
    };
  }

  dispose(): void {
    this.#unsubscribe();
    this.area.dispose();
    this.mesh.removeFromParent();
  }
}
