import { AnimationPlayer, type Ctx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { Mesh, MeshBasicMaterial, SphereGeometry, type Vector3 } from "three";
import { FOX_RISE, createFoxRig } from "../render/fox.js";
import type { Materials } from "../render/materials.js";
import type { GameState } from "../state.js";

export type FoxCtx = Ctx<GameState, PhysicsContext>;
export type FoxState = "dash" | "idle" | "jump" | "run";

// Feel constants live with the game, not the framework: tuning is gameplay.
const RUN_SPEED = 7.5;
const GRAVITY = -30;
const JUMP_VELOCITY = 11.5;
// One jump off the ground, one more in the air. The second is a shade weaker
// and spins the fox, so the player can see which one they just spent.
const AIR_JUMPS = 1;
const AIR_JUMP_VELOCITY = 10.5;
const SPIN_TIME = 0.42;
const COYOTE_TIME = 0.1;
const JUMP_BUFFER = 0.12;
const DASH_SPEED = 26;
// A dash is a fixed lunge, not a timed one: it always covers the same ground,
// so what it clears is a level-design decision rather than a frame-rate one.
const DASH_DISTANCE = 6;
const DASH_TIMEOUT = 0.6;
const DASH_COOLDOWN = 0.35;
const INVULNERABLE_TIME = 1.2;
const KNOCKBACK_TIME = 0.25;
const KNOCKBACK_SPEED = 6;
const TURN_RATE = 14;

function shortestAngle(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export class Fox {
  readonly animation: AnimationPlayer;
  readonly body: CharacterBody3D;
  readonly mesh: Mesh;
  state: FoxState = "idle";
  #dashLeft = 0;
  #dashTimeout = 0;
  #dashCooldown = 0;
  #dashX = 1;
  #dashZ = 0;
  #coyoteLeft = 0;
  #bufferLeft = 0;
  #airJumps = AIR_JUMPS;
  #spinLeft = 0;
  #invulnerableLeft = 0;
  #knockbackLeft = 0;
  // The level runs along +x, so that is where the fox looks before it moves.
  #facing = Math.PI / 2;

  constructor(ctx: FoxCtx, materials: Materials, spawn: Vector3) {
    // A hidden material rather than visible = false: the latter would take the
    // whole visual rig down with it, since visibility applies to the subtree.
    this.mesh = new Mesh(new SphereGeometry(0.01, 3, 2), new MeshBasicMaterial({ visible: false }));
    this.mesh.position.copy(spawn);
    const { clips, rig } = createFoxRig(materials);
    this.mesh.add(rig);
    ctx.add(this.mesh);

    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.35, minWidth: 0.15 },
      gravity: GRAVITY,
      maxSlopeClimbAngle: Math.PI / 3.6,
      mesh: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.3, 0.25),
      snapToGround: 0.3,
    });
    this.animation = new AnimationPlayer({ clips, root: rig });
    this.animation.play("idle");
  }

  get dashReady(): boolean {
    return this.#dashCooldown <= 0;
  }

  get invulnerable(): boolean {
    return this.#invulnerableLeft > 0;
  }

  update(ctx: FoxCtx, dt: number, controllable: boolean): void {
    const move = controllable ? ctx.input.vector("move") : { x: 0, y: 0 };
    // Screen right is +x and "up" on the stick pushes into the screen, which is
    // -z with the camera parked behind the fox.
    const inputX = move.x;
    const inputZ = -move.y;

    this.#dashCooldown = Math.max(0, this.#dashCooldown - dt);
    this.#invulnerableLeft = Math.max(0, this.#invulnerableLeft - dt);
    this.#knockbackLeft = Math.max(0, this.#knockbackLeft - dt);
    this.#coyoteLeft = this.body.grounded ? COYOTE_TIME : Math.max(0, this.#coyoteLeft - dt);
    if (this.body.grounded) this.#airJumps = AIR_JUMPS;
    this.#spinLeft = Math.max(0, this.#spinLeft - dt);
    this.#bufferLeft =
      controllable && ctx.input.justPressed("jump")
        ? JUMP_BUFFER
        : Math.max(0, this.#bufferLeft - dt);

    if (controllable && ctx.input.justPressed("dash") && this.#dashCooldown <= 0) {
      const length = Math.hypot(inputX, inputZ);
      this.#dashX = length > 0.1 ? inputX / length : Math.sin(this.#facing);
      this.#dashZ = length > 0.1 ? inputZ / length : Math.cos(this.#facing);
      this.#dashLeft = DASH_DISTANCE;
      this.#dashTimeout = DASH_TIMEOUT;
      this.#dashCooldown = DASH_COOLDOWN;
    }

    const dashing = this.#dashLeft > 0 && this.#dashTimeout > 0;
    if (dashing) {
      // The step is capped by what is left of the lunge, so the last tick lands
      // exactly on the dash's end instead of overshooting it.
      const step = Math.min(DASH_SPEED * dt, this.#dashLeft);
      this.#dashLeft -= step;
      this.#dashTimeout = Math.max(0, this.#dashTimeout - dt);
      const speed = dt > 0 ? step / dt : 0;
      this.body.gravity = 0;
      this.body.velocity.set(this.#dashX * speed, 0, this.#dashZ * speed);
    } else {
      this.#dashLeft = 0;
      this.body.gravity = GRAVITY;
      // Steering is suspended for the length of the knockback, otherwise the
      // next tick's input would erase the hit before it ever moved the fox.
      if (this.#knockbackLeft <= 0) {
        this.body.velocity.x = inputX * RUN_SPEED;
        this.body.velocity.z = inputZ * RUN_SPEED;
      }
      if (this.#bufferLeft > 0 && this.#coyoteLeft > 0) {
        this.body.velocity.y = JUMP_VELOCITY;
        this.#bufferLeft = 0;
        this.#coyoteLeft = 0;
      } else if (this.#bufferLeft > 0 && this.#airJumps > 0) {
        this.body.velocity.y = AIR_JUMP_VELOCITY;
        this.#airJumps -= 1;
        this.#spinLeft = SPIN_TIME;
        this.#bufferLeft = 0;
      }
    }

    this.body.moveAndSlide(dt);

    if (Math.hypot(inputX, inputZ) > 0.05 || dashing) {
      const target = Math.atan2(dashing ? this.#dashX : inputX, dashing ? this.#dashZ : inputZ);
      this.#facing += shortestAngle(this.#facing, target) * Math.min(1, TURN_RATE * dt);
    }
    const rig = this.mesh.children[0];
    if (rig !== undefined) {
      rig.rotation.y = this.#facing;
      // A full forward flip over the length of the air jump, driven here rather
      // than as a clip: it has to compose with whatever clip is playing.
      rig.rotation.x = this.#spinLeft <= 0 ? 0 : -(1 - this.#spinLeft / SPIN_TIME) * Math.PI * 2;
      // A hurt fox blinks; the rig is the only thing left to blink, since the
      // collision proxy never renders.
      rig.visible =
        this.#invulnerableLeft <= 0 || Math.floor(this.#invulnerableLeft * 12) % 2 === 0;
    }

    // Airborne is one state, not a jump/fall pair: there is one airborne clip,
    // and splitting it would only add a transition nothing reads.
    this.state = dashing
      ? "dash"
      : !this.body.grounded
        ? "jump"
        : Math.hypot(this.body.velocity.x, this.body.velocity.z) > 0.5
          ? "run"
          : "idle";
    this.animation.play(this.state === "run" ? "run" : this.state === "idle" ? "idle" : "jump", {
      fade: 0.12,
    });
    this.animation.update(dt);
  }

  /** Returns false when the hit was ignored because the fox is still blinking. */
  hurt(fromX: number): boolean {
    if (this.#invulnerableLeft > 0) return false;
    this.#invulnerableLeft = INVULNERABLE_TIME;
    this.#knockbackLeft = KNOCKBACK_TIME;
    this.#dashLeft = 0;
    this.body.gravity = GRAVITY;
    this.body.velocity.set(this.mesh.position.x < fromX ? -KNOCKBACK_SPEED : KNOCKBACK_SPEED, 7, 0);
    return true;
  }

  respawn(position: Vector3): void {
    this.#dashLeft = 0;
    this.#knockbackLeft = 0;
    this.#spinLeft = 0;
    this.#airJumps = AIR_JUMPS;
    this.#bufferLeft = 0;
    this.body.velocity.set(0, 0, 0);
    this.body.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    this.body.syncFromPhysics();
  }

  debug(): Record<string, unknown> {
    return {
      airJumps: this.#airJumps,
      dashReady: this.dashReady,
      grounded: this.body.grounded,
      position: this.mesh.position.toArray(),
      state: this.state,
    };
  }

  dispose(): void {
    this.animation.dispose();
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}

export { FOX_RISE };
