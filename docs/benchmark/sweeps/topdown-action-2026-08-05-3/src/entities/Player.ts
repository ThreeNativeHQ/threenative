import type { Ctx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { Group, MathUtils, type Material, Mesh, Vector3 } from "three";
import { ball, block, tube } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = Ctx<GameState, PhysicsContext>;
const MOVE_SPEED = 4.5;
const SPAWN = { x: -5, y: 0.55, z: 3.4 } as const;

export class Player {
  readonly mesh: Group;
  readonly body: CharacterBody3D;
  readonly aim = new Vector3(1, 0, 0);
  readonly muzzle = new Vector3();
  #turret: Group;

  constructor(ctx: GameCtx, material: Material, darkMaterial: Material) {
    this.mesh = new Group();
    this.mesh.position.set(SPAWN.x, SPAWN.y, SPAWN.z);
    this.mesh.name = "player";

    const chassis = tube(0.42, 0.5, 0.42, material, { segments: 18 });
    chassis.position.y = -0.05;
    const rim = tube(0.51, 0.51, 0.1, darkMaterial, { segments: 18 });
    rim.position.y = -0.24;
    const core = ball(0.18, material, { segments: 14 });
    core.position.y = 0.24;
    this.#turret = new Group();
    this.#turret.position.y = 0.16;
    const barrel = block(0.18, 0.18, 0.78, darkMaterial, { radius: 0.06 });
    barrel.position.z = -0.36;
    this.#turret.add(barrel);
    this.mesh.add(chassis, rim, core, this.#turret);
    this.mesh.traverse((child) => {
      if (child instanceof Mesh) child.castShadow = true;
    });
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      gravity: 0,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.26, 0.42),
    });
  }

  update(ctx: GameCtx, dt: number, aimPoint: Vector3): void {
    const move = ctx.input.vector("move");
    this.body.velocity.x = move.x * MOVE_SPEED;
    this.body.velocity.y = 0;
    this.body.velocity.z = -move.y * MOVE_SPEED;
    this.body.moveAndSlide(dt);
    this.aim.set(aimPoint.x - this.mesh.position.x, 0, aimPoint.z - this.mesh.position.z);
    if (this.aim.lengthSq() > 0.01) {
      this.aim.normalize();
      this.#turret.rotation.y = Math.atan2(-this.aim.x, -this.aim.z);
    }
    this.mesh.position.y = SPAWN.y;
    this.muzzle.copy(this.mesh.position).addScaledVector(this.aim, 0.72);
    this.muzzle.y = 0.62;
  }

  debug(): { position: number[]; state: string; aim: number[] } {
    return { position: this.mesh.position.toArray(), state: "active", aim: this.aim.toArray() };
  }

  respawn(): void {
    this.body.teleport(SPAWN);
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
