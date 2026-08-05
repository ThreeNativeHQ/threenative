import { type Ctx, Scene } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { type PerspectiveCamera, Vector3 } from "three";
import { Character } from "../entities/Character.js";
import { Patrol } from "../entities/Patrol.js";
import { Pickup, coinArc } from "../entities/Pickup.js";
import { Checkpoints } from "../level/Checkpoints.js";
import { type PlatformNode, createPlatform } from "../level/Platform.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = Ctx<GameState, PhysicsContext>;

const SPAWN = new Vector3(0, 0.75, 0);
const KILL_PLANE = -8;

export class Level extends Scene<GameState, PhysicsContext> {
  #character: Character | undefined;
  #platforms: PlatformNode[] = [];
  #patrols: Array<{ id: string; value: Patrol }> = [];
  #pickups: Array<{ id: string; value: Pickup }> = [];
  #checkpoints = new Checkpoints([
    new Vector3(0, 0.75, 0),
    new Vector3(14, 0.75, 0),
    new Vector3(25, 0.75, 0),
  ]);
  #coins = 0;
  #defeated = 0;
  #cameraAnchor = new Vector3();

  override enter(ctx: GameCtx): void {
    setupSky(ctx.scene);
    const camera = ctx.camera as PerspectiveCamera;
    camera.fov = 54;
    camera.far = 220;
    camera.updateProjectionMatrix();

    this.#platforms = [
      createPlatform(ctx, new Vector3(0, 0, 0), 18, { depth: 7, seed: 3 }),
      createPlatform(ctx, new Vector3(14, 0, 0), 10, { depth: 7, seed: 7 }),
      createPlatform(ctx, new Vector3(25, 0, 0), 8, { depth: 7, seed: 11 }),
      createPlatform(ctx, new Vector3(0, 2.6, 0), 6, {
        depth: 5,
        oneWay: true,
        seed: 17,
      }),
    ];
    const character = new Character(ctx, SPAWN);
    this.#character = character;
    ctx.entities.add("player", character);

    this.#addPickup(ctx, new Vector3(2, 1.05, 0));
    this.#addPickup(ctx, new Vector3(3.2, 1.05, 0));
    this.#addPickup(ctx, new Vector3(4.4, 1.05, 0));
    for (const point of coinArc(new Vector3(11, 1.05, 0), 4, 3.6, 1.4)) this.#addPickup(ctx, point);

    const patrol = new Patrol(
      ctx,
      character,
      new Vector3(5.2, 0.66, 0),
      new Vector3(7.4, 0.66, 0),
      () => {
        this.#defeated += 1;
      },
      (fromX) => this.#checkpoints.hurt(character, fromX),
    );
    this.#patrols = [{ id: "patrol", value: patrol }];
    ctx.entities.add("patrol", patrol);
    this.#followCamera(camera, SPAWN, 1);
  }

  override update(ctx: GameCtx, dt: number): void {
    const character = this.#character;
    if (character === undefined) return;
    character.update(ctx, dt);
    for (const entry of this.#patrols) entry.value.update(dt);
    for (const entry of this.#pickups) entry.value.update(dt);
    this.#checkpoints.pass(character.mesh.position);
    this.#checkpoints.update(dt, character);
    if (character.mesh.position.y < KILL_PLANE) this.#checkpoints.respawn(character);

    this.#removeCollected(ctx);
    this.#removeDefeated(ctx);
    const rise = Math.max(0, character.mesh.position.y - SPAWN.y);
    const speed = Math.hypot(character.body.velocity.x, character.body.velocity.z);
    const previous = ctx.state.getState();
    ctx.state.set({
      checkpoint: this.#checkpoints.currentIndex,
      coins: this.#coins,
      coyoteJumps: character.coyoteJumps,
      defeated: this.#defeated,
      dashes: character.dashes,
      hearts: this.#checkpoints.hearts,
      jumps: character.jumps,
      peakRise: Math.max(previous.peakRise, rise),
      respawns: this.#checkpoints.respawns,
      topSpeed: Math.max(previous.topSpeed, speed),
    });
    this.#followCamera(ctx.camera as PerspectiveCamera, character.mesh.position, dt);
  }

  override exit(ctx: GameCtx): void {
    for (const entry of this.#pickups) {
      ctx.entities.remove(entry.id);
      entry.value.dispose();
    }
    for (const entry of this.#patrols) {
      ctx.entities.remove(entry.id);
      entry.value.dispose();
    }
    for (const platform of this.#platforms) platform.dispose();
    ctx.entities.remove("player");
    this.#character?.dispose();
    this.#pickups = [];
    this.#patrols = [];
    this.#platforms = [];
    this.#character = undefined;
  }

  #addPickup(ctx: GameCtx, at: Vector3): void {
    const character = this.#character;
    if (character === undefined) throw new Error("Level cannot add a pickup before its character.");
    const id = `coin.${this.#pickups.length}`;
    const pickup = new Pickup(ctx, character, at, () => {
      this.#coins += 1;
    });
    this.#pickups.push({ id, value: pickup });
    ctx.entities.add(id, pickup);
  }

  #removeCollected(ctx: GameCtx): void {
    this.#pickups = this.#pickups.filter((entry) => {
      if (!entry.value.collected) return true;
      ctx.entities.remove(entry.id);
      entry.value.dispose();
      return false;
    });
  }

  #removeDefeated(ctx: GameCtx): void {
    this.#patrols = this.#patrols.filter((entry) => {
      if (!entry.value.defeated) return true;
      ctx.entities.remove(entry.id);
      entry.value.dispose();
      return false;
    });
  }

  #followCamera(camera: PerspectiveCamera, target: Vector3, dt: number): void {
    const desired = this.#cameraAnchor.set(target.x, target.y + 4.4, target.z + 8.5);
    if (dt >= 1) camera.position.copy(desired);
    else camera.position.lerp(desired, 1 - Math.exp(-dt / 0.18));
    camera.lookAt(target.x, target.y + 0.9, target.z);
  }
}
