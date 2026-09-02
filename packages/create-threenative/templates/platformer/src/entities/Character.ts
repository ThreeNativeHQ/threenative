import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, Vector3 } from "three";
import { type IPlatformerConventions, prepareCharacterConventions } from "../conventions.js";
import { ONE_WAY_LAYER } from "../level/Platform.js";
import { animateCharacter, createCharacterRig } from "../render/rig.js";
import type { ITouchInput } from "../render/touch-layout.js";
import type { GameState } from "../state.js";
type GameCtx = ICtx<GameState, IPhysicsContext>;
export const PLAYER_LAYER = 1;
const VISUAL_ATTACHMENT_TOLERANCE = 0.1;
export const PLATFORMER_FEEL = {
  airAcceleration: 24,
  blinkRate: 18,
  // 0.12s is 7.2 ticks at the 1/60 step. `playtests/coyote.playtest.json` waits 4 ticks after
  // walking off the ledge before it jumps, which keeps the jump inside this window with margin.
  // It waited 8 — longer than the window — and so asserted that a jump taken after coyote time
  // still counts as one; it passed only when the player left the ledge late. If you change this
  // number, change that wait with it.
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
  #supportSurfaceY = 0;
  #dashDirection = new Vector3(1, 0, 0);
  #wants = new Vector3();
  #bodyWorldPosition = new Vector3();
  #visualWorldPosition = new Vector3();
  #visualBodyOffsetY: number | undefined;
  #visualWasGrounded = false;
  #visualBaselineSupportY: number | undefined;
  #conventions: IPlatformerConventions;

  constructor(ctx: GameCtx, spawn: Vector3) {
    this.mesh = new Group();
    this.mesh.position.copy(spawn);
    ctx.add(this.mesh);
    this.#rig = createCharacterRig();
    this.visual = this.#rig.root;
    this.visual.position.y = -0.72;
    this.mesh.add(this.visual);
    this.#conventions = prepareCharacterConventions(this.visual);
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

  update(
    ctx: GameCtx,
    dt: number,
    touch?: ITouchInput,
    supportSurfaceY?: (position: Pick<Vector3, "x" | "y" | "z">) => number | undefined,
  ): void {
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
    const supportingSurfaceY = supportSurfaceY?.(this.mesh.position);
    const canCorrectGrounding =
      this.body.grounded && this.body.velocity.y <= 0 && supportingSurfaceY !== undefined;
    // The platform resolver identifies the supporting collider and supplies the authored surface
    // plane GroundSnap must use. This stays correct when a one-way controller reports the
    // underside of a slab after passing through it, and keeps the visual on its body.
    if (canCorrectGrounding) this.#supportSurfaceY = supportingSurfaceY;
    this.#conventions.groundSnap.enabled = canCorrectGrounding;
    this.#conventions.applyGrounding(this.#supportSurfaceY, dt);
    this.#captureVisualBodyOffset(supportingSurfaceY);
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
    const visualAttachmentDrift = this.#visualAttachmentDrift();
    return {
      dashes: this.dashes,
      grounded: this.body.grounded,
      groundClearance: this.#conventions.groundSnap.clearance,
      groundCorrectionEnabled: this.#conventions.groundSnap.enabled,
      groundSurfaceY: this.#supportSurfaceY,
      health: this.health,
      jumps: this.jumps,
      normaliseFactor: this.#conventions.normaliseFactor,
      position: this.mesh.position.toArray(),
      state: this.state,
      visualAttached:
        visualAttachmentDrift !== null && visualAttachmentDrift <= VISUAL_ATTACHMENT_TOLERANCE,
      visualAttachmentDrift,
      velocity: this.body.velocity.toArray(),
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }

  #captureVisualBodyOffset(supportingSurfaceY: number | undefined): void {
    if (!this.body.grounded || this.body.velocity.y > 0) {
      this.#visualWasGrounded = false;
      return;
    }
    const supportChanged =
      supportingSurfaceY !== undefined &&
      this.#visualBaselineSupportY !== undefined &&
      Math.abs(supportingSurfaceY - this.#visualBaselineSupportY) > VISUAL_ATTACHMENT_TOLERANCE;
    if (this.#visualWasGrounded && !supportChanged) return;
    // GroundSnap may move the visual relative to a one-way body's collider. Capture that offset
    // once after each grounded contact, then compare only visual and body positions so a later
    // visual detachment cannot be hidden by a continuously refreshed baseline.
    this.mesh.getWorldPosition(this.#bodyWorldPosition);
    this.visual.getWorldPosition(this.#visualWorldPosition);
    this.#visualBodyOffsetY = this.#visualWorldPosition.y - this.#bodyWorldPosition.y;
    this.#visualBaselineSupportY = supportingSurfaceY;
    this.#visualWasGrounded = true;
  }

  #visualAttachmentDrift(): number | null {
    if (this.#visualBodyOffsetY === undefined) return null;
    this.mesh.getWorldPosition(this.#bodyWorldPosition);
    this.visual.getWorldPosition(this.#visualWorldPosition);
    return Math.abs(
      this.#visualWorldPosition.y - this.#bodyWorldPosition.y - this.#visualBodyOffsetY,
    );
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
    if (wants.lengthSq() > 0.01) this.#dashDirection.copy(wants);
    else this.#dashDirection.set(Math.sin(this.#facing), 0, Math.cos(this.#facing));
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
