import type { Ctx } from "@threenative/core";
import { AnimationPlayer } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { BufferGeometry, MathUtils, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { createFoxClips, createFoxRig } from "../render/foxRig.js";
import type { Materials } from "../render/materials.js";
import type { GameState } from "../state.js";

type GameCtx = Ctx<GameState, PhysicsContext>;

/**
 * Feel constants. These live in the entity on purpose: jump height, coyote
 * time and dash distance are gameplay, and gameplay is not the framework's to
 * own. Tune them here and nowhere else.
 */
const GRAVITY = -26;
const RUN_SPEED = 6.4;
const GROUND_ACCEL = 62;
const AIR_ACCEL = 26;
const JUMP_SPEED = 10.2; // apex ≈ 2.0m, airtime ≈ 0.78s, so a 4.5m gap is fair.
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.14;
const DASH_SPEED = 17;
const DASH_TIME = 0.2;
const DASH_COOLDOWN = 0.55;
const STOMP_BOUNCE = 9;
const HURT_TIME = 0.5;
const INVULNERABLE_TIME = 1.3;
const KILL_PLANE = -18;

export type FoxState = "idle" | "run" | "jump" | "fall" | "dash" | "hurt";

const CLIP_FOR: Record<FoxState, string> = {
  dash: "dash",
  fall: "jump",
  hurt: "hurt",
  idle: "idle",
  jump: "jump",
  run: "run",
};

export class Fox {
  readonly mesh: Mesh;
  readonly body: CharacterBody3D;
  readonly animation: AnimationPlayer;
  readonly tags = ["player"];
  /** Read by the playtest bridge as `runtime.state`. Keep it a plain string. */
  state: FoxState = "idle";
  hearts = 3;
  /** Counted here so the scene never has to infer a feat from a pose. */
  dashCount = 0;
  jumpCount = 0;
  #spawn: Vector3;
  #rig = createFoxRig;
  #root: ReturnType<typeof createFoxRig>;
  #facing = Math.PI / 2;
  #coyote = 0;
  #buffered = 0;
  #dashTimer = 0;
  #dashCooldown = 0;
  #hurtTimer = 0;
  #invulnerable = 0;
  #dashDirection = new Vector3(1, 0, 0);

  constructor(ctx: GameCtx, materials: Materials, spawn: Vector3) {
    // The physics root is an invisible Mesh because CharacterBody3D drives a
    // Mesh; everything you can see hangs off it as the rig below.
    this.mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ visible: false }));
    this.mesh.position.copy(spawn);
    this.#spawn = spawn.clone();
    ctx.add(this.mesh);

    this.#root = this.#rig(materials);
    // Capsule centre to feet: halfHeight + radius.
    this.#root.root.position.y = -0.74;
    this.#root.root.rotation.y = this.#facing;
    this.mesh.add(this.#root.root);

    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.42, minWidth: 0.2 },
      gravity: GRAVITY,
      maxFallSpeed: 34,
      mesh: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.4, 0.34),
      snapToGround: 0.35,
    });

    this.animation = new AnimationPlayer({ clips: createFoxClips(), root: this.#root.root });
    this.animation.play("idle");
  }

  get position(): Vector3 {
    return this.mesh.position;
  }

  get invulnerable(): boolean {
    return this.#invulnerable > 0;
  }

  update(ctx: GameCtx, dt: number): void {
    this.#tickTimers(dt);

    const move = ctx.input.vector("move");
    const wants = new Vector3(move.x, 0, -move.y);
    if (wants.lengthSq() > 1) wants.normalize();

    if (ctx.input.justPressed("jump")) this.#buffered = JUMP_BUFFER;
    if (this.body.grounded) this.#coyote = COYOTE_TIME;

    if (
      ctx.input.justPressed("dash") &&
      this.#dashCooldown <= 0 &&
      this.#dashTimer <= 0 &&
      this.#hurtTimer <= 0
    ) {
      this.#startDash(wants);
    }

    if (this.#dashTimer > 0) this.#driveDash();
    else if (this.#hurtTimer > 0) this.#driveHurt(dt);
    else this.#driveWalk(wants, dt);

    if (this.#buffered > 0 && this.#coyote > 0 && this.#hurtTimer <= 0) {
      this.body.velocity.y = JUMP_SPEED;
      this.jumpCount += 1;
      this.#buffered = 0;
      this.#coyote = 0;
    }

    this.body.moveAndSlide(dt);
    this.#face(dt);
    this.#applyState();
    this.animation.update(dt);

    if (this.mesh.position.y < KILL_PLANE) this.respawn();
  }

  /** Bounced off an enemy's head. Godot's name for it would be the same word. */
  bounce(): void {
    this.body.velocity.y = STOMP_BOUNCE;
    this.#coyote = 0;
    this.#buffered = 0;
  }

  /** Returns false when the hit was ignored because the fox is still blinking. */
  hurt(fromX: number): boolean {
    if (this.#invulnerable > 0) return false;
    this.hearts = Math.max(0, this.hearts - 1);
    this.#hurtTimer = HURT_TIME;
    this.#invulnerable = INVULNERABLE_TIME;
    const away = Math.sign(this.mesh.position.x - fromX) || -1;
    this.body.velocity.set(away * 5.5, 6.2, 0);
    if (this.hearts === 0) this.respawn();
    return true;
  }

  respawn(): void {
    this.body.velocity.set(0, 0, 0);
    this.body.body.setTranslation(
      { x: this.#spawn.x, y: this.#spawn.y, z: this.#spawn.z },
      true,
    );
    this.mesh.position.copy(this.#spawn);
    this.#hurtTimer = 0;
    this.#invulnerable = INVULNERABLE_TIME;
    if (this.hearts === 0) this.hearts = 3;
  }

  debug(): Record<string, unknown> {
    return {
      dashReady: this.#dashCooldown <= 0,
      grounded: this.body.grounded,
      hearts: this.hearts,
      position: this.mesh.position.toArray(),
      state: this.state,
      velocity: this.body.velocity.toArray(),
    };
  }

  dispose(): void {
    this.animation.dispose();
    this.body.dispose();
    this.mesh.removeFromParent();
  }

  #tickTimers(dt: number): void {
    this.#coyote = Math.max(0, this.#coyote - dt);
    this.#buffered = Math.max(0, this.#buffered - dt);
    this.#dashTimer = Math.max(0, this.#dashTimer - dt);
    this.#dashCooldown = Math.max(0, this.#dashCooldown - dt);
    this.#hurtTimer = Math.max(0, this.#hurtTimer - dt);
    this.#invulnerable = Math.max(0, this.#invulnerable - dt);
    // Blink while invulnerable — the cheapest possible damage feedback.
    this.#root.root.visible = this.#invulnerable <= 0 || Math.floor(this.#invulnerable * 14) % 2 === 0;
  }

  #startDash(wants: Vector3): void {
    this.#dashDirection.copy(
      wants.lengthSq() > 0.01 ? wants : new Vector3(Math.sin(this.#facing), 0, Math.cos(this.#facing)),
    );
    this.#dashTimer = DASH_TIME;
    this.#dashCooldown = DASH_COOLDOWN;
    this.dashCount += 1;
  }

  #driveDash(): void {
    this.body.velocity.set(
      this.#dashDirection.x * DASH_SPEED,
      0,
      this.#dashDirection.z * DASH_SPEED,
    );
  }

  #driveHurt(dt: number): void {
    this.body.velocity.x = MathUtils.damp(this.body.velocity.x, 0, 3, dt);
    this.body.velocity.z = MathUtils.damp(this.body.velocity.z, 0, 3, dt);
  }

  #driveWalk(wants: Vector3, dt: number): void {
    const accel = this.body.grounded ? GROUND_ACCEL : AIR_ACCEL;
    const targetX = wants.x * RUN_SPEED;
    const targetZ = wants.z * RUN_SPEED;
    this.body.velocity.x = approach(this.body.velocity.x, targetX, accel * dt);
    this.body.velocity.z = approach(this.body.velocity.z, targetZ, accel * dt);
  }

  #face(dt: number): void {
    const vx = this.body.velocity.x;
    const vz = this.body.velocity.z;
    if (vx * vx + vz * vz < 0.4) return;
    // The rig faces +Z, so this is atan2(x, z) and not the usual atan2(z, x).
    const desired = Math.atan2(vx, vz);
    this.#facing = dampAngle(this.#facing, desired, 16, dt);
    this.#root.root.rotation.y = this.#facing;
  }

  #applyState(): void {
    const speed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    const next: FoxState =
      this.#hurtTimer > 0
        ? "hurt"
        : this.#dashTimer > 0
          ? "dash"
          : !this.body.grounded
            ? this.body.velocity.y > 0.2
              ? "jump"
              : "fall"
            : speed > 0.6
              ? "run"
              : "idle";
    if (next === this.state) return;
    this.state = next;
    this.animation.play(CLIP_FOR[next], { fade: next === "dash" ? 0.05 : 0.12 });
  }
}

function approach(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  return Math.abs(delta) <= maxDelta ? target : current + Math.sign(delta) * maxDelta;
}

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let delta = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}
