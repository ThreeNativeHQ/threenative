import type { Ctx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { Group, type Material, Mesh, Vector3 } from "three";
import { ball, block, roundedBox, tube } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = Ctx<GameState, PhysicsContext>;

export interface PlayerMaterials {
  readonly body: Material;
  readonly detail: Material;
  readonly shot: Material;
}

// These timers stay with the entity so the movement still feels forgiving even
// though the game is now a top-down action scene.
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.14;
const JUMP_SPEED = 5;
const MOVE_SPEED = 3.2;
const ATTACK_DURATION = 0.2;
const SPAWN = { x: 0, y: 0.5, z: 3.1 } as const;

export class Player {
  readonly mesh: Mesh;
  readonly body: CharacterBody3D;
  readonly #aimDirection = new Vector3(0, 0, -1);
  readonly #weapon = new Group();
  readonly #muzzleFlash: Mesh;
  #muzzleTimer = 0;
  #coyoteTime = 0;
  #jumpBuffer = 0;
  #jumps = 0;
  #coyoteJumps = 0;
  #time = 0;
  #attackTimer = 0;
  #attackFrames = 0;
  #attackCount = 0;
  #lastAnimationClip: "idle" | "attack" = "idle";

  constructor(ctx: GameCtx, materials: PlayerMaterials) {
    this.mesh = new Mesh(roundedBox(0.72, 0.7, 0.72, 0.17), materials.body);
    this.mesh.position.set(SPAWN.x, SPAWN.y, SPAWN.z);
    this.mesh.castShadow = true;

    const visor = block(0.36, 0.13, 0.14, materials.detail, { radius: 0.04 });
    visor.position.set(0, 0.12, -0.36);

    const shoulder = tube(0.28, 0.28, 0.06, materials.detail, { segments: 16 });
    shoulder.rotation.x = Math.PI / 2;
    shoulder.position.y = 0.34;

    const barrel = block(0.13, 0.13, 0.68, materials.detail, { radius: 0.045 });
    barrel.position.z = -0.36;
    const mount = block(0.24, 0.12, 0.24, materials.detail, { radius: 0.05 });
    mount.position.y = -0.03;
    this.#muzzleFlash = ball(0.14, materials.shot, { segments: 4 });
    this.#muzzleFlash.position.z = -0.78;
    this.#muzzleFlash.visible = false;
    this.#weapon.position.y = 0.22;
    this.#weapon.add(mount, barrel, this.#muzzleFlash);

    this.mesh.add(visor, shoulder, this.#weapon);
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.25, minWidth: 0.15 },
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.27),
    });
  }

  get aimDirection(): Vector3 {
    return this.#aimDirection;
  }

  setAim(direction: Vector3): void {
    this.#aimDirection.copy(direction).setY(0);
    if (this.#aimDirection.lengthSq() < 0.0001) this.#aimDirection.set(0, 0, -1);
    else this.#aimDirection.normalize();
    this.mesh.rotation.y = Math.atan2(this.#aimDirection.x, -this.#aimDirection.z);
    this.#weapon.rotation.y = 0;
  }

  muzzlePosition(): Vector3 {
    return this.mesh.position
      .clone()
      .addScaledVector(this.#aimDirection, 0.82)
      .add(new Vector3(0, 0.3, 0));
  }

  triggerFire(): void {
    this.#attackTimer = ATTACK_DURATION;
    this.#attackFrames = 1;
    this.#attackCount += 1;
    this.#lastAnimationClip = "attack";
    this.#muzzleTimer = 0.08;
    this.#muzzleFlash.visible = true;
    this.#muzzleFlash.scale.setScalar(1.4);
  }

  update(ctx: GameCtx, dt: number): void {
    this.#time += dt;
    if (this.#attackTimer > 0) {
      this.#attackTimer = Math.max(0, this.#attackTimer - dt);
      this.#attackFrames += 1;
      const progress = 1 - this.#attackTimer / ATTACK_DURATION;
      this.#weapon.position.z = Math.sin(Math.min(1, progress) * Math.PI) * 0.12;
    } else {
      this.#weapon.position.z = 0;
    }
    this.#muzzleTimer = Math.max(0, this.#muzzleTimer - dt);
    this.#muzzleFlash.visible = this.#muzzleTimer > 0;
    if (this.#muzzleTimer > 0) this.#muzzleFlash.scale.setScalar(1 + this.#muzzleTimer * 5);

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
    this.setAim(this.#aimDirection);
    this.mesh.rotation.z = Math.sin(this.#time * 5.2) * 0.025;
    const rotation = this.mesh.quaternion;
    this.body.body.setNextKinematicRotation({
      x: rotation.x,
      y: rotation.y,
      z: rotation.z,
      w: rotation.w,
    });
  }

  get animation(): {
    advancedFrames: number;
    current: "idle" | "attack";
    entered: boolean;
    playing: boolean;
  } {
    return {
      advancedFrames: this.#attackFrames,
      current: this.#lastAnimationClip,
      entered: this.#attackCount > 0,
      playing: this.#attackTimer > 0,
    };
  }

  respawn(): void {
    this.body.teleport(SPAWN);
    this.#coyoteTime = 0;
    this.#jumpBuffer = 0;
  }

  debug(): {
    animation: {
      advancedFrames: number;
      clip: "idle" | "attack";
      entered: boolean;
      playing: boolean;
    };
    coyoteJumps: number;
    grounded: boolean;
    jumps: number;
    position: number[];
    rotation: number[];
  } {
    return {
      animation: {
        advancedFrames: this.#attackFrames,
        clip: this.#lastAnimationClip,
        entered: this.#attackCount > 0,
        playing: this.#attackTimer > 0,
      },
      coyoteJumps: this.#coyoteJumps,
      grounded: this.body.grounded,
      jumps: this.#jumps,
      position: this.mesh.position.toArray(),
      rotation: [this.mesh.rotation.x, this.mesh.rotation.y, this.mesh.rotation.z],
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
