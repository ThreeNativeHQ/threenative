import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, Vector3 } from "three";
import { ONE_WAY_LAYER } from "../level/Platform.js";
import { animateCharacter, createCharacterRig } from "../render/rig.js";
import type { ITouchInput } from "../render/touch-layout.js";
import type { GameState } from "../state.js";
type GameCtx = ICtx<GameState, IPhysicsContext>;
export const PLAYER_LAYER = 1;
export const PLATFORMER_FEEL = {
  airAcceleration: 24,
  blinkRate: 18,
  coyoteTime: 0.12,
  dashCooldown: 0.55,
  dashSpeed: 17,
  dashTime: 0.18,
  gravity: -28,
  groundAcceleration: 58,
  hurtHorizontalSpeed: 4.5,
  hurtVerticalSpeed: 5.5,
  invulnerabilityTime: 1.2,
  jumpBuffer: 0.14,
  jumpSpeed: 11,
  maxFallSpeed: 32,
  patrolSpeed: 1.6,
  runSpeed: 6.2,
  stompBounce: 9,
  stompFallSpeed: -0.5,
  stompHeight: 0.3,
} as const;

export type CharacterState = "dash" | "fall" | "hurt" | "idle" | "jump" | "run";

export class Character {
  readonly mesh: Group;
  readonly body: CharacterBody3D;
  readonly visual: Group;
  readonly tags = ["player"];
  state: CharacterState = "idle";
  coyoteJumps = 0;
  health = 3;
  jumps = 0;
  dashes = 0;
  #rig: ReturnType<typeof createCharacterRig>;
  #facing = Math.PI / 2;
  #coyote = 0;
  #buffered = 0;
  #dashTimer = 0;
  #dashCooldown = 0;
  #airJumpUsed = false;
  #time = 0;
  #dashDirection = new Vector3(1, 0, 0);
  #wants = new Vector3();

  constructor(ctx: GameCtx, spawn: Vector3) {
    this.mesh = new Group();
    this.mesh.position.copy(spawn);
    ctx.add(this.mesh);
    this.#rig = createCharacterRig();
    this.visual = this.#rig.root;
    this.visual.position.y = -0.72;
    this.mesh.add(this.visual);
    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.35, minWidth: 0.2 },
      collisionLayer: PLAYER_LAYER,
      collisionMask: 0xfffb,
      entity: "player",
      gravity: PLATFORMER_FEEL.gravity,
      maxFallSpeed: PLATFORMER_FEEL.maxFallSpeed,
      object: this.mesh,
      oneWayLayers: ONE_WAY_LAYER,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.35, 0.3),
      snapToGround: 0.25,
    });
  }

  update(ctx: GameCtx, dt: number, touch?: ITouchInput): void {
    this.#time += dt;
    this.#dashTimer = Math.max(0, this.#dashTimer - dt);
    this.#dashCooldown = Math.max(0, this.#dashCooldown - dt);
    this.#coyote = Math.max(0, this.#coyote - dt);
    this.#buffered = Math.max(0, this.#buffered - dt);
    const move = ctx.input.vector("move");
    this.#wants.set(move.x, 0, -move.y);
    if (touch !== undefined) {
      this.#wants.x += touch.move.x;
      this.#wants.z -= touch.move.y;
    }
    if (this.#wants.lengthSq() > 1) this.#wants.normalize();
    if (this.body.grounded) {
      this.#coyote = PLATFORMER_FEEL.coyoteTime;
      this.#airJumpUsed = false;
    }
    if (ctx.input.justPressed("jump") || touch?.jumpPressed === true)
      this.#buffered = PLATFORMER_FEEL.jumpBuffer;
    if (
      (ctx.input.justPressed("dash") || touch?.dashPressed === true) &&
      this.#dashCooldown <= 0 &&
      this.#dashTimer <= 0
    )
      this.#startDash(this.#wants);

    if (this.#dashTimer > 0) this.#driveDash();
    else this.#driveWalk(this.#wants, dt);
    this.#tryJump();
    this.body.moveAndSlide(dt);
    this.#face(dt);
    this.#applyState();
    animateCharacter(this.#rig, this.state, this.#time, this.body.velocity.x);
  }

  bounce(): void {
    this.body.velocity.y = PLATFORMER_FEEL.stompBounce;
    this.#coyote = 0;
    this.#buffered = 0;
  }

  respawn(position: Vector3): void {
    this.body.teleport(position);
    this.#dashTimer = 0;
    this.#dashCooldown = 0;
  }

  debug(): Record<string, unknown> {
    return {
      dashes: this.dashes,
      grounded: this.body.grounded,
      health: this.health,
      jumps: this.jumps,
      position: this.mesh.position.toArray(),
      state: this.state,
      velocity: this.body.velocity.toArray(),
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }

  #tryJump(): void {
    if (this.#buffered <= 0) return;
    if (this.#coyote > 0) {
      this.body.velocity.y = PLATFORMER_FEEL.jumpSpeed;
      this.#buffered = 0;
      this.#coyote = 0;
      this.coyoteJumps += 1;
      this.jumps += 1;
      return;
    }
    if (!this.#airJumpUsed) {
      this.body.velocity.y = PLATFORMER_FEEL.jumpSpeed;
      this.#buffered = 0;
      this.#airJumpUsed = true;
      this.jumps += 1;
    }
  }

  #startDash(wants: Vector3): void {
    this.#dashDirection.copy(
      wants.lengthSq() > 0.01
        ? wants
        : new Vector3(Math.sin(this.#facing), 0, Math.cos(this.#facing)),
    );
    this.#dashTimer = PLATFORMER_FEEL.dashTime;
    this.#dashCooldown = PLATFORMER_FEEL.dashCooldown;
    this.dashes += 1;
  }

  #driveDash(): void {
    this.body.velocity.set(
      this.#dashDirection.x * PLATFORMER_FEEL.dashSpeed,
      0,
      this.#dashDirection.z * PLATFORMER_FEEL.dashSpeed,
    );
  }

  #driveWalk(wants: Vector3, dt: number): void {
    const acceleration = this.body.grounded
      ? PLATFORMER_FEEL.groundAcceleration
      : PLATFORMER_FEEL.airAcceleration;
    this.body.velocity.x = approach(
      this.body.velocity.x,
      wants.x * PLATFORMER_FEEL.runSpeed,
      acceleration * dt,
    );
    this.body.velocity.z = approach(
      this.body.velocity.z,
      wants.z * PLATFORMER_FEEL.runSpeed,
      acceleration * dt,
    );
  }

  #face(dt: number): void {
    const horizontal = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    if (horizontal < 0.1) return;
    const target = Math.atan2(this.body.velocity.x, this.body.velocity.z);
    this.#facing +=
      (((target - this.#facing + Math.PI) % (Math.PI * 2)) - Math.PI) * (1 - Math.exp(-14 * dt));
    this.visual.rotation.y = this.#facing;
  }

  #applyState(): void {
    const speed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    this.state =
      this.#dashTimer > 0
        ? "dash"
        : !this.body.grounded
          ? this.body.velocity.y > 0.2
            ? "jump"
            : "fall"
          : speed > 0.6
            ? "run"
            : "idle";
  }
}

function approach(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  return Math.abs(delta) <= maxDelta ? target : current + Math.sign(delta) * maxDelta;
}
