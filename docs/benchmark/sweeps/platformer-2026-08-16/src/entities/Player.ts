import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Mesh, MeshBasicMaterial, Vector3 } from "three";
import { roundedBox } from "../render/shapes.js";
import { createFox, type IFoxRig } from "../render/character.js";
import type { Materials } from "../render/materials.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

// Jump feel, in one block. Apex ≈ 1.7 units and ≈ 0.75 s of air, which clears
// the 1.3-unit ledges and the 2.5-unit gap at the run speed below.
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.14;
const JUMP_SPEED = 9;
// Negative is down. `CharacterBody3D.gravity` is added to `velocity.y`, so the
// positive number that reads like "24 of gravity" flies the character upward —
// the type says `gravity: number` and nothing in it says which way.
const GRAVITY = -24;
const RUN_SPEED = 7;
const ACCELERATION = 44;
const AIR_ACCELERATION = 26;
const FRICTION = 30;
/**
 * The shortest jump a tap can produce, as a fraction of `JUMP_SPEED`. Releasing
 * early clamps the rise once to this — it does not decay per frame. Decaying it
 * every frame (0.45 ** (dt * 60)) removes 55% of the remaining rise sixty times
 * a second, so a two-frame tap barely leaves the ground and the "variable
 * jump" is really a broken jump.
 */
const MIN_HOP = 0.6;

export class Player {
  /**
   * The registry's view of the player: a real `Mesh` at the capsule's centre,
   * with the fox parented under it.
   *
   * It has to be a `Mesh` and not a `Group`. A playtest `visibility` assertion
   * measures the registered entity's own geometry, so a `Group` — however many
   * visible children it has — reports zero projected pixels and fails
   * `TN_PLAYTEST_VISIBILITY_FAILED` while the character is plainly on screen.
   */
  readonly mesh: Mesh;
  readonly body: CharacterBody3D;
  readonly rig: IFoxRig;
  /** The last safe place this player stood; a fall returns here, not to the start. */
  checkpoint: Vector3;
  #spawn: Vector3;
  #coyoteTime = 0;
  #jumpBuffer = 0;
  #jumps = 0;
  #coyoteJumps = 0;
  #elapsed = 0;
  #facing = Math.PI / 2;
  #groundedFor = 0;
  #grace = 0;

  constructor(ctx: GameCtx, materials: Materials, spawn: Vector3) {
    this.rig = createFox(materials);
    // The physics capsule is centred on the body's position, but the fox is
    // modelled standing on its own origin. Without this the character floats
    // half a capsule above every surface it lands on.
    this.mesh = new Mesh(
      roundedBox(0.56, 1.08, 0.56, 0.24),
      new MeshBasicMaterial({ depthWrite: false, opacity: 0, transparent: true }),
    );
    this.rig.root.position.y = -(0.26 + 0.28);
    this.mesh.add(this.rig.root);
    this.mesh.position.copy(spawn);
    this.mesh.rotation.y = this.#facing;
    ctx.add(this.mesh);
    this.#spawn = spawn.clone();
    this.checkpoint = spawn.clone();
    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.45, minWidth: 0.2 },
      gravity: GRAVITY,
      maxFallSpeed: 26,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.26, 0.28),
      snapToGround: 0.28,
    });
  }

  /** False for a moment after a respawn, so a hazard cannot chain-kill. */
  get vulnerable(): boolean {
    return this.#grace <= 0;
  }

  update(ctx: GameCtx, dt: number): void {
    this.#elapsed += dt;
    this.#grace = Math.max(0, this.#grace - dt);
    // Blink while invulnerable: the player has to be able to see the rule.
    this.rig.root.visible = this.#grace <= 0 || Math.sin(this.#grace * 40) > -0.2;
    const grounded = this.body.grounded;
    this.#groundedFor = grounded ? this.#groundedFor + dt : 0;
    this.#coyoteTime = grounded ? COYOTE_TIME : Math.max(0, this.#coyoteTime - dt);
    this.#jumpBuffer = Math.max(0, this.#jumpBuffer - dt);
    if (ctx.input.justPressed("jump")) this.#jumpBuffer = JUMP_BUFFER;
    if (this.#jumpBuffer > 0 && this.#coyoteTime > 0) {
      this.body.velocity.y = JUMP_SPEED;
      this.#jumpBuffer = 0;
      this.#jumps += 1;
      if (!grounded) this.#coyoteJumps += 1;
      this.#coyoteTime = 0;
    }
    // Releasing the button early cuts the rise, so a tap is a small hop.
    if (!ctx.input.pressed("jump") && this.body.velocity.y > JUMP_SPEED * MIN_HOP) {
      this.body.velocity.y = JUMP_SPEED * MIN_HOP;
    }

    const move = ctx.input.vector("move");
    const rate = grounded ? ACCELERATION : AIR_ACCELERATION;
    const wantX = move.x * RUN_SPEED;
    // `vector().y` is +up; a ground plane whose forward is -z needs the flip.
    const wantZ = -move.y * RUN_SPEED;
    this.body.velocity.x = approach(this.body.velocity.x, wantX, rate * dt, FRICTION * dt);
    this.body.velocity.z = approach(this.body.velocity.z, wantZ, rate * dt, FRICTION * dt);
    this.body.moveAndSlide(dt);

    const speed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    if (speed > 0.4) {
      const target = Math.atan2(this.body.velocity.x, this.body.velocity.z);
      this.#facing = turnToward(this.#facing, target, dt * 14);
    }
    this.mesh.rotation.y = this.#facing;
    this.rig.pose(this.#elapsed, speed / RUN_SPEED, !this.body.grounded, this.body.velocity.y);

  }

  /** Advance the retry point once the player is standing past a checkpoint. */
  reachCheckpoint(position: Vector3): void {
    this.checkpoint.copy(position);
  }

  /** Bounced off an enemy — a short hop and a moment of no control. */
  bounce(): void {
    this.body.velocity.y = JUMP_SPEED * 0.62;
  }

  respawn(toStart = false): void {
    const target = toStart ? this.#spawn : this.checkpoint;
    this.body.velocity.set(0, 0, 0);
    this.body.teleport(target);
    this.mesh.position.copy(target);
    this.#coyoteTime = 0;
    this.#jumpBuffer = 0;
    this.#groundedFor = 0;
    this.#grace = 1.1;
  }

  debug(): {
    coyoteJumps: number;
    grounded: boolean;
    jumps: number;
    position: number[];
    speed: number;
  } {
    return {
      coyoteJumps: this.#coyoteJumps,
      grounded: this.body.grounded,
      jumps: this.#jumps,
      position: this.mesh.position.toArray(),
      speed: Math.hypot(this.body.velocity.x, this.body.velocity.z),
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}

/** Accelerate toward a target, or brake toward zero when there is no input. */
function approach(current: number, target: number, accelerate: number, brake: number): number {
  const step = target === 0 ? brake : accelerate;
  const delta = target - current;
  if (Math.abs(delta) <= step) return target;
  return current + Math.sign(delta) * step;
}

function turnToward(current: number, target: number, step: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (Math.abs(delta) <= step) return target;
  return current + Math.sign(delta) * step;
}
