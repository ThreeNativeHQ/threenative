import { AnimationPlayer, type ICtx } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import {
  type AnimationClip,
  BoxGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Vector3,
} from "three";
import type { BoxCollider } from "../render/range.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

export type EnemyPhase = "patrol" | "suspicious" | "engage" | "search" | "return" | "dead";

const MAX_HEALTH = 36;
const BODY_HEIGHT = 1.8;
const WALK_SPEED = 2.4;
const CHASE_SPEED = 3.6;
const HEAR_RANGE = 26;
const VIEW_RANGE = 30;
const VIEW_HALF_ANGLE = MathUtils.degToRad(46);
const ENGAGE_RANGE = 13;
const BURST_ROUNDS = 3;
const BURST_SPACING = 0.11;
const BURST_COOLDOWN = 3.2;
const ROUND_DAMAGE = 9;
const RESPAWN_SECONDS = 4.5;

const ROUTE: readonly Vector3[] = [
  new Vector3(-4.5, 0, -9.5),
  new Vector3(-11.5, 0, -13.0),
  new Vector3(-1.0, 0, -15.0),
  new Vector3(4.5, 0, -11.0),
  new Vector3(1.5, 0, -6.5),
  new Vector3(-6.0, 0, -4.5),
];

export type EnemyHooks = {
  /** True when nothing in the yard blocks the segment. */
  readonly lineOfSight: (from: Vector3, to: Vector3) => boolean;
  readonly damagePlayer: (amount: number) => void;
  readonly onMuzzleFlash: (at: Vector3) => void;
};

export class Enemy {
  readonly group = new Group();
  readonly hitbox: Mesh;
  health = MAX_HEALTH;
  phase: EnemyPhase = "patrol";
  wounded = false;
  #animation: AnimationPlayer | undefined;
  #clips: ReadonlySet<string>;
  #routeIndex = 0;
  #target = new Vector3();
  #lastSeen = new Vector3();
  #alertTimer = 0;
  #burstLeft = 0;
  #burstTimer = 0;
  #cooldown = 0;
  #strafe = 1;
  #strafeTimer = 0;
  #deadFor = 0;
  #frozen = false;
  #colliders: readonly BoxCollider[];

  constructor(model: Object3D, clips: readonly AnimationClip[], colliders: readonly BoxCollider[]) {
    this.#colliders = colliders;
    model.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh === true) {
        mesh.castShadow = true;
        mesh.receiveShadow = false;
      }
    });
    this.group.add(model);
    this.group.name = "enemy";
    this.group.position.copy(ROUTE[0] as Vector3);
    this.#target.copy(ROUTE[1] as Vector3);
    this.#routeIndex = 1;
    this.group.rotation.y = Math.atan2(
      this.#target.x - this.group.position.x,
      this.#target.z - this.group.position.z,
    );

    // Skinned meshes are the slow path for picking, so the rifle traces a plain
    // box proxy that follows the body. Invisible, but still raycastable.
    this.hitbox = new Mesh(
      new BoxGeometry(0.62, BODY_HEIGHT, 0.44),
      new MeshBasicMaterial({ visible: false }),
    );
    this.hitbox.position.y = BODY_HEIGHT / 2;
    this.hitbox.userData.enemy = this;
    this.group.add(this.hitbox);

    this.#clips = new Set(clips.map((clip) => clip.name));
    if (clips.length > 0) {
      this.#animation = new AnimationPlayer({ clips, root: this.group });
      this.#play("RifleWalk");
    }
  }

  get alive(): boolean {
    return this.phase !== "dead";
  }

  /** Chest height, used as the eye and muzzle origin. */
  get chest(): Vector3 {
    return new Vector3(this.group.position.x, this.group.position.y + 1.42, this.group.position.z);
  }

  get bodyBase(): number {
    return this.group.position.y;
  }

  get bodyHeight(): number {
    return BODY_HEIGHT;
  }

  #play(name: string, fade = 0.18): void {
    if (this.#animation === undefined || !this.#clips.has(name)) return;
    if (this.#animation.current === name) return;
    this.#animation.play(name, { fade });
  }

  #blocked(x: number, z: number): boolean {
    for (const box of this.#colliders) {
      if (
        x > box.min[0] - 0.45 &&
        x < box.max[0] + 0.45 &&
        z > box.min[2] - 0.45 &&
        z < box.max[2] + 0.45 &&
        box.max[1] > 0.5
      ) {
        return true;
      }
    }
    return Math.abs(x) > 16 || Math.abs(z) > 16;
  }

  #step(dt: number, toX: number, toZ: number, speed: number): void {
    const dx = toX - this.group.position.x;
    const dz = toZ - this.group.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-3) return;
    const stepX = (dx / distance) * speed * dt;
    const stepZ = (dz / distance) * speed * dt;
    const nextX = this.group.position.x + stepX;
    const nextZ = this.group.position.z + stepZ;
    if (!this.#blocked(nextX, this.group.position.z)) this.group.position.x = nextX;
    if (!this.#blocked(this.group.position.x, nextZ)) this.group.position.z = nextZ;
    // Face the way it walks.
    const wanted = Math.atan2(stepX, stepZ);
    this.group.rotation.y = this.#turn(this.group.rotation.y, wanted, dt * 7);
  }

  #turn(from: number, to: number, rate: number): number {
    let delta = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return from + MathUtils.clamp(delta, -rate, rate);
  }

  #canSee(eye: Vector3, hooks: EnemyHooks): boolean {
    const chest = this.chest;
    const to = new Vector3().subVectors(eye, chest);
    const distance = to.length();
    if (distance > VIEW_RANGE) return false;
    const facing = new Vector3(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
    const flat = new Vector3(to.x, 0, to.z).normalize();
    if (facing.dot(flat) < Math.cos(VIEW_HALF_ANGLE)) return false;
    return hooks.lineOfSight(chest, eye);
  }

  hearShot(shooter: Vector3): void {
    if (!this.alive) return;
    if (shooter.distanceTo(this.group.position) > HEAR_RANGE) return;
    this.#lastSeen.copy(shooter);
    if (this.phase === "patrol" || this.phase === "return") {
      this.phase = "suspicious";
      this.#alertTimer = 0;
    }
  }

  /** Returns the score the shot earned: 300 for the kill, 100 for the first wound. */
  hurt(ctx: GameCtx, amount: number): number {
    if (!this.alive) return 0;
    this.health -= amount;
    let earned = 0;
    if (!this.wounded) {
      this.wounded = true;
      earned = 100;
    }
    if (this.health <= 0) {
      this.health = 0;
      this.phase = "dead";
      this.#deadFor = 0;
      this.#frozen = false;
      this.#play("DeathFront", 0.06);
      // Nothing in `AnimationPlayer` clamps a one-shot clip at its last frame, so
      // the ragdoll is held by stopping the mixer updates once it has played out.
      ctx.after(1.1, () => {
        this.#frozen = true;
      });
      ctx.after(RESPAWN_SECONDS, () => this.#respawn());
      return earned + 300;
    }
    this.#play("HitReaction", 0.05);
    if (this.phase !== "engage") this.phase = "engage";
    return earned;
  }

  #respawn(): void {
    this.health = MAX_HEALTH;
    this.wounded = false;
    this.phase = "patrol";
    this.#frozen = false;
    this.#routeIndex = 0;
    this.group.position.copy(ROUTE[0] as Vector3);
    this.#target.copy(ROUTE[1] as Vector3);
    this.#routeIndex = 1;
    this.group.rotation.set(
      0,
      Math.atan2(this.#target.x - this.group.position.x, this.#target.z - this.group.position.z),
      0,
    );
    this.#play("RifleWalk", 0.05);
  }

  update(ctx: GameCtx, dt: number, playerEye: Vector3, hooks: EnemyHooks): void {
    if (this.phase === "dead") {
      this.#deadFor += dt;
      if (!this.#frozen) this.#animation?.update(dt);
      return;
    }
    const sees = this.#canSee(playerEye, hooks);
    if (sees) {
      this.#lastSeen.copy(playerEye);
      this.phase = "engage";
      this.#alertTimer = 0;
    }

    switch (this.phase) {
      case "patrol": {
        this.#step(dt, this.#target.x, this.#target.z, WALK_SPEED);
        this.#play("RifleWalk");
        if (this.group.position.distanceTo(this.#target) < 0.9) {
          this.#routeIndex = (this.#routeIndex + 1) % ROUTE.length;
          this.#target.copy(ROUTE[this.#routeIndex] as Vector3);
        }
        break;
      }
      case "suspicious": {
        // Heard something: turn toward it, then go looking.
        this.#alertTimer += dt;
        const wanted = Math.atan2(
          this.#lastSeen.x - this.group.position.x,
          this.#lastSeen.z - this.group.position.z,
        );
        this.group.rotation.y = this.#turn(this.group.rotation.y, wanted, dt * 4);
        this.#play("RifleIdle");
        if (this.#alertTimer > 0.8) this.phase = "search";
        break;
      }
      case "engage": {
        this.#engage(ctx, dt, playerEye, hooks, sees);
        break;
      }
      case "search": {
        this.#step(dt, this.#lastSeen.x, this.#lastSeen.z, CHASE_SPEED);
        this.#play("RifleWalk");
        this.#alertTimer += dt;
        if (
          this.group.position.distanceTo(this.#lastSeen) < 1.6 ||
          this.#alertTimer > 7 ||
          this.#blocked(this.#lastSeen.x, this.#lastSeen.z)
        ) {
          this.phase = "return";
          this.#alertTimer = 0;
        }
        break;
      }
      case "return": {
        const home = ROUTE[this.#routeIndex] as Vector3;
        this.#step(dt, home.x, home.z, WALK_SPEED);
        this.#play("RifleWalk");
        if (this.group.position.distanceTo(home) < 1.0) this.phase = "patrol";
        break;
      }
    }
    this.#animation?.update(dt);
  }

  #engage(ctx: GameCtx, dt: number, playerEye: Vector3, hooks: EnemyHooks, sees: boolean): void {
    const chest = this.chest;
    const wanted = Math.atan2(playerEye.x - chest.x, playerEye.z - chest.z);
    this.group.rotation.y = this.#turn(this.group.rotation.y, wanted, dt * 6);
    const flatDistance = Math.hypot(playerEye.x - chest.x, playerEye.z - chest.z);

    this.#strafeTimer -= dt;
    if (this.#strafeTimer <= 0) {
      this.#strafeTimer = 1.3;
      this.#strafe = -this.#strafe;
    }

    if (flatDistance > ENGAGE_RANGE) {
      // Close to engagement range.
      this.#step(dt, playerEye.x, playerEye.z, CHASE_SPEED);
      this.#play("RifleWalk");
    } else {
      // Strafe across the player's front.
      const right = new Vector3(Math.cos(this.group.rotation.y), 0, -Math.sin(this.group.rotation.y));
      const toX = this.group.position.x + right.x * this.#strafe * 3;
      const toZ = this.group.position.z + right.z * this.#strafe * 3;
      if (this.#blocked(toX, toZ)) this.#strafe = -this.#strafe;
      this.#step(dt, toX, toZ, WALK_SPEED);
      this.#play("RifleWalk");
    }

    this.#cooldown -= dt;
    this.#burstTimer -= dt;
    if (this.#burstLeft > 0) {
      if (this.#burstTimer <= 0) {
        this.#burstLeft -= 1;
        this.#burstTimer = BURST_SPACING;
        // A round that connects costs the full 9; the ones that go wide do not.
        // Seeded, so a replay of the same run takes the same damage.
        const accuracy = MathUtils.clamp(0.75 - flatDistance * 0.035, 0.12, 0.75);
        if (ctx.random() < accuracy) hooks.damagePlayer(ROUND_DAMAGE);
        hooks.onMuzzleFlash(chest);
        this.#play("FiringRifle", 0.04);
        if (this.#burstLeft === 0) this.#cooldown = BURST_COOLDOWN;
      }
    } else if (sees && this.#cooldown <= 0) {
      this.#burstLeft = BURST_ROUNDS;
      this.#burstTimer = 0;
    }

    if (!sees) {
      this.#alertTimer += dt;
      if (this.#alertTimer > 1.4) {
        this.phase = "search";
        this.#alertTimer = 0;
        this.#burstLeft = 0;
      }
    }
  }

  debug(): { health: number; phase: EnemyPhase; position: number[]; deadFor: number } {
    return {
      health: this.health,
      phase: this.phase,
      position: this.group.position.toArray(),
      deadFor: this.#deadFor,
    };
  }

  dispose(): void {
    this.#animation?.dispose();
    this.group.removeFromParent();
  }
}
