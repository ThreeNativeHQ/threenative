import type { Ctx } from "@threenative/core";
import { Area3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { BoxGeometry, CylinderGeometry, Group, Mesh, type Vector3 } from "three";
import { palette, toon } from "../render/palette.js";
import type { GameState } from "../state.js";
import type { Character } from "./Character.js";

type GameCtx = Ctx<GameState, PhysicsContext>;

export class Goal {
  readonly mesh: Group;
  readonly area: Area3D;
  readonly tags = ["goal"];
  reached = false;
  #unsubscribe: () => void;

  constructor(ctx: GameCtx, player: Character, at: Vector3, onReach: () => void) {
    this.mesh = new Group();
    const pole = new Mesh(new CylinderGeometry(0.055, 0.055, 2.1, 10), toon(palette.rock));
    pole.position.y = 1.05;
    pole.castShadow = true;
    const flag = new Mesh(new BoxGeometry(0.72, 0.38, 0.06), toon(palette.coin));
    flag.position.set(0.34, 1.76, 0);
    flag.castShadow = true;
    this.mesh.add(pole, flag);
    this.mesh.position.copy(at);
    ctx.add(this.mesh);

    const trigger = at.clone();
    trigger.y += 0.75;
    this.area = new Area3D({
      entity: "goal",
      physics: ctx.physics,
      position: trigger,
      shape: CollisionShape3D.sphere(0.82),
    });
    this.#unsubscribe = this.area.on("bodyEntered", (body) => {
      if (this.reached || body !== player.body) return;
      this.reached = true;
      onReach();
    });
  }

  dispose(): void {
    this.#unsubscribe();
    this.area.dispose();
    this.mesh.removeFromParent();
  }
}
