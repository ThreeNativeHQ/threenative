import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { type Material, Mesh, type Vector3 } from "three";
import { roundedBox } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

// Tune these two timers for jump feel; they forgive a late or early button press.
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.14;
const JUMP_SPEED = 5;
const MOVE_SPEED = 2;
const SPAWN = { x: -2, y: 0.5, z: 0 } as const;

export class Player {
  readonly mesh: Mesh;
  readonly body: CharacterBody3D;
  #coyoteTime = 0;
  #jumpBuffer = 0;
  #jumps = 0;
  #coyoteJumps = 0;
  #odometer = 0;
  #previousPosition: Vector3 | undefined;

  constructor(
    ctx: GameCtx,
    material: Material,
    spawn: { readonly x: number; readonly y: number; readonly z: number } = SPAWN,
  ) {
    this.mesh = new Mesh(roundedBox(0.6, 1, 0.6), material);
    this.mesh.position.set(spawn.x, spawn.y, spawn.z);
    this.mesh.castShadow = true;
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.4, minWidth: 0.2 },
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
    });
  }

  update(ctx: GameCtx, dt: number): void {
    if (this.#previousPosition !== undefined) {
      this.#odometer += this.mesh.position.distanceTo(this.#previousPosition);
    }
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
    this.body.velocity.z = -move.y * MOVE_SPEED;
    const before = this.mesh.position.clone();
    this.body.moveAndSlide(dt);
    this.#previousPosition = before;
    if (this.body.grounded) this.#coyoteTime = COYOTE_TIME;
  }

  respawn(): void {
    this.body.teleport(SPAWN);
    this.#coyoteTime = 0;
    this.#jumpBuffer = 0;
    this.#previousPosition = undefined;
  }

  debug(): {
    coyoteJumps: number;
    grounded: boolean;
    jumps: number;
    odometer: number;
    position: number[];
  } {
    return {
      coyoteJumps: this.#coyoteJumps,
      grounded: this.body.grounded,
      jumps: this.#jumps,
      odometer: this.#odometer,
      position: this.mesh.position.toArray(),
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
