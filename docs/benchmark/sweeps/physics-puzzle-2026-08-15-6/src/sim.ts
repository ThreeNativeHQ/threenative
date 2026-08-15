import RAPIER from "@dimforge/rapier3d-compat";
import { CRATE_SIZE, FIXED_STEP, GOAL, PLAYER, ROOM, buildLayout } from "./level.js";
import type { ILayout } from "./level.js";
import { Rng, foldHash, quantise } from "./rng.js";

export const INPUT_RIGHT = 1;
export const INPUT_UP = 2;
export const INPUT_DOWN = 4;

const GRAVITY = -22;
const CRATE_DENSITY = 0.32;
const CONTACT_LOG_LIMIT = 240;
const CONTACT_KEY_LIMIT = 24;

export interface IContactRecord {
  readonly entity: string;
  readonly kind: string;
  readonly with: string;
}

export interface IBodyPose {
  readonly id: string;
  readonly position: [number, number, number];
  readonly quaternion: [number, number, number, number];
  readonly sleeping: boolean;
}

export interface ISimSnapshot {
  readonly awakeCrates: number;
  readonly crateCollisions: number;
  readonly crateGoalHits: number;
  readonly ghostPasses: number;
  readonly playerGoalHits: number;
  readonly playerPose: IBodyPose;
  readonly pushEvents: number;
  readonly pushing: boolean;
  readonly settledCrates: number;
  readonly tick: number;
  readonly walking: boolean;
  readonly won: boolean;
}

/** Rapier must be initialised once before any simulation is constructed. */
export async function initPhysics(): Promise<void> {
  await RAPIER.init();
}

/**
 * The whole game, minus pixels.
 *
 * Nothing here reads the clock, the DOM or the renderer, so `Simulation` can be rebuilt from
 * the seed and replayed headlessly — which is exactly what the determinism check does.
 */
export class Simulation {
  readonly layout: ILayout;
  readonly seed: number;

  #contacts: IContactRecord[] = [];
  #contactKeyCounts = new Map<string, number>();
  #crateBodies: RAPIER.RigidBody[] = [];
  #crateCollisions = 0;
  #crateColliderIds = new Map<number, number>();
  #controller: RAPIER.KinematicCharacterController;
  #crateGoalHits = 0;
  #events = new RAPIER.EventQueue(true);
  #ghostColliders: RAPIER.Collider[] = [];
  #ghostPasses = 0;
  #goalCollider: RAPIER.Collider;
  #openGhostPairs = new Set<string>();
  #openPushPairs = new Set<number>();
  #playerBody: RAPIER.RigidBody;
  #playerCollider: RAPIER.Collider;
  #playerGoalHits = 0;
  #playerYaw = 0;
  #pushEvents = 0;
  #pushing = false;
  #rng: Rng;
  #tick = 0;
  #verticalVelocity = 0;
  #walking = false;
  #won = false;
  #world: RAPIER.World;

  constructor(seed: number) {
    this.seed = seed;
    this.#rng = new Rng(seed);
    this.layout = buildLayout(this.#rng);
    this.#world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.#world.timestep = FIXED_STEP;

    this.#buildRoom();
    this.#buildCrates();
    this.#goalCollider = this.#buildGoal();
    this.#buildGhosts();

    const player = this.#buildPlayer();
    this.#playerBody = player.body;
    this.#playerCollider = player.collider;

    this.#controller = this.#world.createCharacterController(0.02);
    this.#controller.setUp({ x: 0, y: 1, z: 0 });
    this.#controller.setApplyImpulsesToDynamicBodies(true);
    this.#controller.setCharacterMass(PLAYER.mass);
    this.#controller.setSlideEnabled(true);
    this.#controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.#controller.setMinSlopeSlideAngle((30 * Math.PI) / 180);
    this.#controller.enableAutostep(0.4, 0.18, true);
    this.#controller.enableSnapToGround(0.35);
  }

  get contacts(): readonly IContactRecord[] {
    return this.#contacts;
  }

  get randomState(): number {
    return this.#rng.state;
  }

  get tick(): number {
    return this.#tick;
  }

  get won(): boolean {
    return this.#won;
  }

  /** Advances exactly one fixed step under the supplied input bitmask. */
  step(input: number): void {
    const right = (input & INPUT_RIGHT) !== 0 ? 1 : 0;
    const forward = (input & INPUT_UP) !== 0 ? 1 : 0;
    const back = (input & INPUT_DOWN) !== 0 ? 1 : 0;
    const moveX = right * PLAYER.speed * FIXED_STEP;
    const moveZ = (back - forward) * PLAYER.speed * FIXED_STEP;

    this.#walking = moveX !== 0 || moveZ !== 0;
    if (this.#walking) this.#playerYaw = Math.atan2(moveX, moveZ);

    this.#verticalVelocity += GRAVITY * FIXED_STEP;
    // Sensors are excluded from the sweep on purpose: the ghost crates and the destination pad
    // are bodies the character walks through, and a character controller treats every collider
    // it is shown as solid.
    this.#controller.computeColliderMovement(
      this.#playerCollider,
      { x: moveX, y: this.#verticalVelocity * FIXED_STEP, z: moveZ },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    if (this.#controller.computedGrounded()) this.#verticalVelocity = 0;

    this.#recordCharacterCollisions();

    const movement = this.#controller.computedMovement();
    const current = this.#playerBody.translation();
    this.#playerBody.setNextKinematicTranslation({
      x: current.x + movement.x,
      y: current.y + movement.y,
      z: current.z + movement.z,
    });

    this.#world.step(this.#events);
    this.#tick += 1;

    this.#readCrateCollisions();
    this.#readGhostIntersections();
    this.#readGoalIntersections();
  }

  /** 32-bit fingerprint of every simulated pose. Two identical runs fold to the same value. */
  fingerprint(): number {
    let hash = 0x811c9dc5;
    const player = this.#playerBody.translation();
    for (const value of [player.x, player.y, player.z, this.#playerYaw]) {
      hash = foldHash(hash, quantise(value));
    }
    for (const body of this.#crateBodies) {
      const translation = body.translation();
      const rotation = body.rotation();
      for (const value of [
        translation.x,
        translation.y,
        translation.z,
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w,
      ]) {
        hash = foldHash(hash, quantise(value));
      }
    }
    return foldHash(hash, this.#won ? 1 : 0);
  }

  /** Crate and player poses, for the renderer and for the harness physics provider. */
  poses(): IBodyPose[] {
    const poses: IBodyPose[] = [this.playerPose()];
    for (const [index, body] of this.#crateBodies.entries()) {
      const translation = body.translation();
      const rotation = body.rotation();
      poses.push({
        id: `crate.${index}`,
        position: [translation.x, translation.y, translation.z],
        quaternion: [rotation.x, rotation.y, rotation.z, rotation.w],
        sleeping: body.isSleeping(),
      });
    }
    return poses;
  }

  playerPose(): IBodyPose {
    const translation = this.#playerBody.translation();
    const half = Math.sin(this.#playerYaw * 0.5);
    return {
      id: "player",
      position: [translation.x, translation.y, translation.z],
      quaternion: [0, half, 0, Math.cos(this.#playerYaw * 0.5)],
      sleeping: !this.#walking && this.#verticalVelocity === 0,
    };
  }

  snapshot(): ISimSnapshot {
    let settled = 0;
    for (const body of this.#crateBodies) if (body.isSleeping()) settled += 1;
    return {
      awakeCrates: this.#crateBodies.length - settled,
      crateCollisions: this.#crateCollisions,
      crateGoalHits: this.#crateGoalHits,
      ghostPasses: this.#ghostPasses,
      playerGoalHits: this.#playerGoalHits,
      playerPose: this.playerPose(),
      pushEvents: this.#pushEvents,
      pushing: this.#pushing,
      settledCrates: settled,
      tick: this.#tick,
      walking: this.#walking,
      won: this.#won,
    };
  }

  dispose(): void {
    this.#events.free();
    this.#world.free();
  }

  #buildRoom(): void {
    const floor = this.#world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.#world.createCollider(
      RAPIER.ColliderDesc.cuboid(ROOM.halfX, 0.5, ROOM.halfZ)
        .setTranslation(0, -0.5, 0)
        .setFriction(0.85),
      floor,
    );

    const walls: readonly [number, number, number, number, number][] = [
      [0, ROOM.halfZ + ROOM.wallThickness, ROOM.halfX, ROOM.wallHeight, ROOM.wallThickness],
      [0, -ROOM.halfZ - ROOM.wallThickness, ROOM.halfX, ROOM.wallHeight, ROOM.wallThickness],
      [ROOM.halfX + ROOM.wallThickness, 0, ROOM.wallThickness, ROOM.wallHeight, ROOM.halfZ],
      [-ROOM.halfX - ROOM.wallThickness, 0, ROOM.wallThickness, ROOM.wallHeight, ROOM.halfZ],
    ];
    for (const [x, z, halfX, halfY, halfZ] of walls) {
      const body = this.#world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      this.#world.createCollider(
        RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ).setTranslation(x, halfY, z),
        body,
      );
    }
  }

  #buildCrates(): void {
    const half = CRATE_SIZE / 2;
    for (const spec of this.layout.crates) {
      const body = this.#world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(spec.x, spec.y, spec.z)
          .setRotation(quaternionFromYaw(spec.yaw))
          .setLinearDamping(0.12)
          .setAngularDamping(0.35),
      );
      const collider = this.#world.createCollider(
        RAPIER.ColliderDesc.cuboid(half, half, half)
          .setDensity(CRATE_DENSITY)
          .setFriction(0.75)
          .setRestitution(0.02)
          .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      this.#crateColliderIds.set(collider.handle, spec.index);
      this.#crateBodies.push(body);
    }
  }

  #buildGoal(): RAPIER.Collider {
    const body = this.#world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(GOAL.center.x, GOAL.halfY, GOAL.center.z),
    );
    return this.#world.createCollider(
      RAPIER.ColliderDesc.cuboid(GOAL.halfX, GOAL.halfY, GOAL.halfZ)
        .setSensor(true)
        .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
  }

  #buildGhosts(): void {
    const half = CRATE_SIZE / 2;
    for (const spec of this.layout.ghosts) {
      const body = this.#world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(spec.x, spec.y, spec.z)
          .setRotation(quaternionFromYaw(spec.yaw)),
      );
      this.#ghostColliders.push(
        this.#world.createCollider(
          RAPIER.ColliderDesc.cuboid(half, half, half)
            .setSensor(true)
            .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
          body,
        ),
      );
    }
  }

  #buildPlayer(): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const body = this.#world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        PLAYER.spawn.x,
        PLAYER.spawn.y,
        PLAYER.spawn.z,
      ),
    );
    const collider = this.#world.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER.halfHeight, PLAYER.radius)
        .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    return { body, collider };
  }

  /**
   * The character controller reports exactly which colliders it hit while resolving this
   * step's motion. That is the push: a crate only moves because the capsule ran into it.
   */
  #recordCharacterCollisions(): void {
    const touched = new Set<number>();
    this.#pushing = false;
    for (let index = 0; index < this.#controller.numComputedCollisions(); index += 1) {
      const collision = this.#controller.computedCollision(index);
      const handle = collision?.collider?.handle;
      if (handle === undefined) continue;
      const crateIndex = this.#crateColliderIds.get(handle);
      if (crateIndex === undefined) continue;
      touched.add(crateIndex);
      this.#pushing = true;
      this.#crateBodies[crateIndex]?.wakeUp();
      if (this.#openPushPairs.has(crateIndex)) continue;
      this.#pushEvents += 1;
      this.#record("player", "crate", "contact");
      this.#record("player", `crate.${crateIndex}`, "contact");
    }
    this.#openPushPairs = touched;
  }

  /** Crate-on-crate collisions from the opening drop, straight off the narrow phase. */
  #readCrateCollisions(): void {
    this.#events.drainCollisionEvents((first, second, started) => {
      if (!started) return;
      const left = this.#crateColliderIds.get(first);
      const right = this.#crateColliderIds.get(second);
      if (left === undefined || right === undefined) return;
      this.#crateCollisions += 1;
      this.#record("crate", "crate", "contact");
    });
    this.#events.clear();
  }

  #readGhostIntersections(): void {
    const open = new Set<string>();
    for (const [index, ghost] of this.#ghostColliders.entries()) {
      this.#world.intersectionPairsWith(ghost, (other) => {
        if (other.handle !== this.#playerCollider.handle) return;
        const key = `ghost.${index}`;
        open.add(key);
        if (this.#openGhostPairs.has(key)) return;
        this.#ghostPasses += 1;
        this.#record("player", "ghost", "trigger");
        this.#record("player", key, "trigger");
      });
    }
    this.#openGhostPairs = open;
  }

  /**
   * The win. It fires only when the goal sensor actually overlaps the character capsule or a
   * crate the character pushed there — no distance test, no timer.
   */
  #readGoalIntersections(): void {
    this.#world.intersectionPairsWith(this.#goalCollider, (other) => {
      if (other.handle === this.#playerCollider.handle) {
        this.#playerGoalHits += 1;
        if (this.#playerGoalHits === 1) {
          this.#record("player", "goal", "trigger");
          this.#record("goal", "player", "trigger");
        }
        this.#won = true;
        return;
      }
      const crateIndex = this.#crateColliderIds.get(other.handle);
      if (crateIndex === undefined) return;
      const body = this.#crateBodies[crateIndex];
      if (body === undefined) return;
      // Only a crate that was pushed here counts: it has to be resting inside the pad.
      if (body.translation().y > GOAL.halfY * 1.6) return;
      this.#crateGoalHits += 1;
      if (this.#crateGoalHits === 1) {
        this.#record("crate", "goal", "trigger");
        this.#record(`crate.${crateIndex}`, "goal", "trigger");
      }
      this.#won = true;
    });
  }

  #record(entity: string, other: string, kind: string): void {
    if (this.#contacts.length >= CONTACT_LOG_LIMIT) return;
    const key = `${entity}:${other}:${kind}`;
    const seen = this.#contactKeyCounts.get(key) ?? 0;
    if (seen >= CONTACT_KEY_LIMIT) return;
    this.#contactKeyCounts.set(key, seen + 1);
    this.#contacts.push({ entity, kind, with: other });
  }
}

function quaternionFromYaw(yaw: number): RAPIER.Rotation {
  return { w: Math.cos(yaw / 2), x: 0, y: Math.sin(yaw / 2), z: 0 };
}
