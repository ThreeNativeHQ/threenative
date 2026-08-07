import type { Ctx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { MathUtils, type Material, Mesh } from "three";
import { ball, roundedBox } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = Ctx<GameState, PhysicsContext>;

// Tune these two timers for jump feel; they forgive a late or early button press.
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.14;
const JUMP_SPEED = 5.2;
const MOVE_SPEED = 3.2;
export const HUB_SPAWN = { x: 0, y: 0.62, z: 5.2 } as const;

export class Player {
  readonly mesh: Mesh;
  readonly body: CharacterBody3D;
  #coyoteTime = 0;
  #jumpBuffer = 0;
  #jumps = 0;
  #coyoteJumps = 0;
  #visualTime = 0;
  #beacon: Mesh;

  constructor(ctx: GameCtx, material: Material, glowMaterial: Material) {
    this.mesh = new Mesh(roundedBox(0.7, 1.15, 0.62, 0.16), material);
    this.mesh.position.set(HUB_SPAWN.x, HUB_SPAWN.y, HUB_SPAWN.z);
    this.mesh.castShadow = true;

    const shoulder = new Mesh(roundedBox(0.88, 0.2, 0.7, 0.09), material);
    shoulder.position.y = 0.28;
    shoulder.castShadow = true;
    this.mesh.add(shoulder);

    const visor = new Mesh(roundedBox(0.42, 0.18, 0.08, 0.035), glowMaterial);
    visor.position.set(0, 0.47, -0.3);
    visor.castShadow = true;
    this.mesh.add(visor);

    this.#beacon = ball(0.12, glowMaterial, { segments: 12, castShadow: false, receiveShadow: false });
    this.#beacon.position.set(0, 0.8, 0);
    this.mesh.add(this.#beacon);
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.4, minWidth: 0.2 },
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
    });
  }

  update(ctx: GameCtx, dt: number): void {
    this.#visualTime += dt;
    const grounded = this.body.grounded;
    this.#coyoteTime = Math.max(0, this.#coyoteTime - dt);
    this.#jumpBuffer = Math.max(0, this.#jumpBuffer - dt);
    if (grounded) this.#coyoteTime = COYOTE_TIME;
    if (ctx.input.justPressed("jump")) this.#jumpBuffer = JUMP_BUFFER;
    if (this.#jumpBuffer > 0 && this.#coyoteTime > 0) {
      this.body.velocity.y = JUMP_SPEED;
      this.#jumpBuffer = 0;
      this.#coyoteTime = 0;
      this.#jumps += 1;
      if (!grounded) this.#coyoteJumps += 1;
    }
    const move = ctx.input.vector("move");
    this.body.velocity.x = move.x * MOVE_SPEED;
    // input.vector("move").y is +up; world-space forward is negative z.
    this.body.velocity.z = -move.y * MOVE_SPEED;
    this.body.moveAndSlide(dt);

    const moveLength = Math.hypot(move.x, move.y);
    if (moveLength > 0.08) {
      const targetRotation = Math.atan2(move.x, -move.y);
      const delta = MathUtils.euclideanModulo(targetRotation - this.mesh.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
      this.mesh.rotation.y += delta * Math.min(1, dt * 10);
    }
    this.#beacon.position.y = 0.8 + Math.sin(this.#visualTime * 4.2) * 0.045;
  }

  respawn(spawn: { x: number; y: number; z: number } = HUB_SPAWN): void {
    this.body.teleport(spawn);
    this.#coyoteTime = 0;
    this.#jumpBuffer = 0;
  }

  debug(): { coyoteJumps: number; grounded: boolean; jumps: number; position: number[] } {
    return {
      coyoteJumps: this.#coyoteJumps,
      grounded: this.body.grounded,
      jumps: this.#jumps,
      position: this.mesh.position.toArray(),
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
