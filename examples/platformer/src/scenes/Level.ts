import { type Ctx, Scene } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { type Group, type PerspectiveCamera, Vector3 } from "three";
import { type FollowCamera, createFollowCamera } from "../camera/follow.js";
import { Fox } from "../entities/Fox.js";
import { Mushroom } from "../entities/Mushroom.js";
import { LEVEL_1, SPAWN } from "../levels/level-1.js";
import { FOX_RISE } from "../render/fox.js";
import { createLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { animateSky, createSky } from "../render/sky.js";
import { type SpawnedLevel, spawn } from "../spawn.js";
import { type GameState, HEARTS } from "../state.js";

export type LevelCtx = Ctx<GameState, PhysicsContext>;

const VOID_Y = -16;
const STOMP_CLEARANCE = 0.4;
const STOMP_BOUNCE = 9;
const STOMP_REWARD = 5;

export class Level extends Scene<GameState, PhysicsContext> {
  #camera: FollowCamera | undefined;
  #fox: Fox | undefined;
  #level: SpawnedLevel | undefined;
  #sun: Group | undefined;
  #sky: Group | undefined;
  #off: Array<() => void> = [];
  #checkpoint = new Vector3(...SPAWN);
  #coins = 0;
  #gems = 0;
  #hearts = HEARTS;
  #elapsed = 0;
  #status: GameState["status"] = "play";

  override enter(ctx: LevelCtx): void {
    const camera = ctx.camera as PerspectiveCamera;
    camera.fov = 55;
    camera.near = 0.1;
    camera.far = 1600;
    // The core owns the camera but nothing owns its aspect: the renderer
    // resizes its buffer, the projection matrix is the game's business.
    const layout = () => {
      camera.aspect = globalThis.innerWidth / Math.max(globalThis.innerHeight, 1);
      camera.updateProjectionMatrix();
      ctx.renderer.setSize(globalThis.innerWidth, globalThis.innerHeight);
    };
    globalThis.addEventListener("resize", layout);
    this.#off.push(() => globalThis.removeEventListener("resize", layout));
    layout();

    const materials = createMaterials();
    this.#sky = ctx.add(createSky(ctx.scene, materials)) as Group;
    this.#sun = ctx.add(
      createLighting(ctx.renderer.raw as { shadowMap: { enabled: boolean } }),
    ) as Group;

    const level = spawn(ctx, LEVEL_1, materials);
    this.#level = level;
    const fox = new Fox(ctx, materials, new Vector3(...SPAWN));
    this.#fox = fox;
    ctx.entities.add("fox", fox);

    this.#camera = createFollowCamera(camera);
    this.#camera.snap(fox.mesh.position);

    for (const coin of level.coins) {
      this.#off.push(
        coin.area.on("bodyEntered", (body) => {
          if (body !== fox.body || coin.collected) return;
          coin.collect();
          if (coin.kind === "gem") this.#gems += 1;
          else this.#coins += 1;
        }),
      );
    }
    for (const enemy of level.enemies) {
      this.#off.push(enemy.area.on("bodyEntered", (body) => this.#touch(enemy, body === fox.body)));
    }
    this.#publish(ctx);
    ctx.state.flush();
  }

  #touch(enemy: SpawnedLevel["enemies"][number], isFox: boolean): void {
    const fox = this.#fox;
    if (!isFox || fox === undefined || this.#status !== "play") return;
    const stompable = enemy instanceof Mushroom && enemy.alive;
    const above = fox.mesh.position.y - FOX_RISE > enemy.mesh.position.y + STOMP_CLEARANCE;
    if (stompable && above && fox.body.velocity.y <= 0) {
      (enemy as Mushroom).squash();
      fox.body.velocity.y = STOMP_BOUNCE;
      this.#coins += STOMP_REWARD;
      return;
    }
    if (enemy instanceof Mushroom && !enemy.alive) return;
    if (fox.hurt(enemy.mesh.position.x)) this.#hearts -= 1;
  }

  override update(ctx: LevelCtx, dt: number): void {
    const fox = this.#fox;
    const level = this.#level;
    if (fox === undefined || level === undefined) return;

    // Restarting rebuilds the scene, so nothing below may touch the old one.
    if (this.#status !== "play" && ctx.input.justPressed("restart")) {
      void ctx.goto("level");
      return;
    }

    const playing = this.#status === "play";
    if (playing) this.#elapsed += dt;
    fox.update(ctx, dt, playing);

    for (const lift of level.lifts) {
      if (playing && lift.carries(fox.mesh.position, fox.body.grounded)) lift.board();
      lift.update(dt);
    }
    for (const coin of level.coins) coin.update(this.#elapsed, dt);
    for (const enemy of level.enemies) enemy.update(this.#elapsed, dt);

    if (fox.body.grounded && playing) this.#checkpoint.copy(fox.mesh.position);
    if (fox.mesh.position.y < VOID_Y && playing) {
      this.#hearts -= 1;
      fox.respawn(this.#checkpoint);
    }
    if (this.#hearts <= 0) this.#status = "over";
    else if (this.#gems >= level.gemCount && level.gemCount > 0) this.#status = "clear";

    if (this.#sky !== undefined) animateSky(this.#sky, this.#elapsed, dt);
    this.#camera?.update(fox.mesh.position, dt);
    this.#sun?.position.set(fox.mesh.position.x, 0, fox.mesh.position.z);
    this.#publish(ctx);
  }

  #publish(ctx: LevelCtx): void {
    ctx.state.set({
      coins: this.#coins,
      dashReady: this.#fox?.dashReady ?? true,
      elapsed: this.#elapsed,
      gems: this.#gems,
      gemsTotal: this.#level?.gemCount ?? 0,
      hearts: Math.max(0, this.#hearts),
      stars: Math.floor(this.#coins / 10),
      status: this.#status,
    });
  }

  override exit(ctx: LevelCtx): void {
    for (const off of this.#off.splice(0)) off();
    ctx.entities.remove("fox");
    this.#fox?.dispose();
    for (const coin of this.#level?.coins ?? []) coin.dispose();
    for (const enemy of this.#level?.enemies ?? []) enemy.dispose();
    for (const lift of this.#level?.lifts ?? []) lift.dispose();
    for (const body of this.#level?.solids ?? []) body.dispose();
    this.#camera = undefined;
    this.#fox = undefined;
    this.#level = undefined;
    this.#sun = undefined;
    this.#sky = undefined;
  }
}
