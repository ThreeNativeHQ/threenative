import type { Ctx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { NavigationAgent3D, type NavigationContext } from "@threenative/physics/navigation";
import { Group, Mesh, SphereGeometry, Vector3 } from "three";
import { createMaterials } from "../render/materials.js";
import type { GameState } from "../state.js";
import type { Character } from "./Character.js";
type GameCtx = Ctx<GameState, PhysicsContext>;

export class Chaser {
  readonly mesh: Group;
  readonly body: CharacterBody3D;
  readonly agent: NavigationAgent3D;
  readonly tags = ["enemy", "chaser"];
  #retarget: ReturnType<GameCtx["every"]>;
  constructor(ctx: GameCtx, player: Character, navigation: NavigationContext, spawn: Vector3) {
    this.mesh = new Group();
    this.mesh.position.copy(spawn);
    const visual = new Mesh(new SphereGeometry(0.44, 12, 8), createMaterials().accent);
    visual.scale.y = 0.8;
    visual.castShadow = true;
    this.mesh.add(visual);
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      gravity: 0,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.35, 0.3),
    });
    this.body.collider.setSensor(true);
    this.agent = new NavigationAgent3D({
      maxSpeed: 3.4,
      navigation,
      object: this.mesh,
      targetDesiredDistance: 0.55,
    });
    this.agent.setTargetPosition(player.mesh.position);
    this.#retarget = ctx.every(() => this.agent.setTargetPosition(player.mesh.position));
  }
  update(dt: number): void {
    const next = this.agent.getNextPathPosition();
    const direction = new Vector3(next.x - this.mesh.position.x, 0, next.z - this.mesh.position.z);
    if (direction.lengthSq() > 0.0001) direction.normalize();
    this.body.velocity.set(
      direction.x * this.agent.maxSpeed,
      this.body.velocity.y,
      direction.z * this.agent.maxSpeed,
    );
    this.body.moveAndSlide(dt);
  }
  debug(): Record<string, unknown> {
    return {
      navigationFinished: this.agent.isNavigationFinished(),
      position: this.mesh.position.toArray(),
      targetReachable: this.agent.isTargetReachable(),
    };
  }
  dispose(): void {
    this.#retarget.cancel();
    this.agent.dispose();
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
