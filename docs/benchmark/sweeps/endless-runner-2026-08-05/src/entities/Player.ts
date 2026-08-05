import type { Ctx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { type Material, Mesh } from "three";
import { roundedBox } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = Ctx<GameState, PhysicsContext>;

const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.14;
const JUMP_SPEED = 6.1;
const LANE_WIDTH = 2.8;
const LANE_SNAP = 12;
const SPAWN = { x: 0, y: 0.55, z: 0 } as const;

export class Player {
  readonly mesh: Mesh;
  readonly body: CharacterBody3D;
  #coyoteTime = 0;
  #jumpBuffer = 0;
  #jumps = 0;
  #coyoteJumps = 0;
  #lane = 1;
  #targetLane = 1;
  #laneInputHeld = false;
  #slideTime = 0;

  constructor(ctx: GameCtx, material: Material) {
    this.mesh = new Mesh(roundedBox(0.82, 1.1, 0.72, 0.18), material);
    this.mesh.position.set(SPAWN.x, SPAWN.y, SPAWN.z);
    this.mesh.castShadow = true;
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.4, minWidth: 0.2 },
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.28, 0.32),
    });
  }

  get lane(): number {
    return this.#lane;
  }

  get isSliding(): boolean {
    return this.#slideTime > 0;
  }

  get height(): number {
    return this.isSliding ? 0.55 : 1.1;
  }

  update(ctx: GameCtx, dt: number, speed: number): void {
    const grounded = this.body.grounded;
    this.#coyoteTime = Math.max(0, this.#coyoteTime - dt);
    this.#jumpBuffer = Math.max(0, this.#jumpBuffer - dt);
    this.#slideTime = Math.max(0, this.#slideTime - dt);
    if (grounded) this.#coyoteTime = COYOTE_TIME;

    const horizontal = ctx.input.vector("move").x;
    if (!this.#laneInputHeld && horizontal < -0.5) this.#targetLane = Math.max(0, this.#targetLane - 1);
    if (!this.#laneInputHeld && horizontal > 0.5) this.#targetLane = Math.min(2, this.#targetLane + 1);
    this.#laneInputHeld = Math.abs(horizontal) > 0.5;
    if (ctx.input.justPressed("jump")) this.#jumpBuffer = JUMP_BUFFER;
    if (ctx.input.pressed("slide") && grounded) this.#slideTime = 0.22;

    if (this.#jumpBuffer > 0 && this.#coyoteTime > 0 && !this.isSliding) {
      this.body.velocity.y = JUMP_SPEED;
      this.#jumpBuffer = 0;
      this.#coyoteTime = 0;
      this.#jumps += 1;
      if (!grounded) this.#coyoteJumps += 1;
    }

    const targetX = (this.#targetLane - 1) * LANE_WIDTH;
    const laneDelta = targetX - this.mesh.position.x;
    this.body.velocity.x = Math.max(-9, Math.min(9, laneDelta * LANE_SNAP));
    this.body.velocity.z = -speed;
    this.body.moveAndSlide(dt);
    this.#lane = this.#targetLane;
    this.mesh.scale.y = this.isSliding ? 0.55 : 1;
    this.mesh.position.y = this.isSliding ? 0.35 : Math.max(0.55, this.mesh.position.y);
  }

  respawn(): void {
    this.body.teleport(SPAWN);
    this.body.velocity.set(0, 0, 0);
    this.#coyoteTime = 0;
    this.#jumpBuffer = 0;
    this.#slideTime = 0;
    this.#lane = 1;
    this.#targetLane = 1;
    this.#laneInputHeld = false;
    this.mesh.scale.y = 1;
  }

  debug(): Record<string, unknown> {
    return {
      action: this.isSliding ? "slide" : this.body.grounded ? "run" : "jump",
      coyoteJumps: this.#coyoteJumps,
      grounded: this.body.grounded,
      jumps: this.#jumps,
      lane: this.#lane,
      position: this.mesh.position.toArray(),
      targetLane: this.#targetLane,
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
