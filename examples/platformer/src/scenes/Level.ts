import { type Ctx, Scene } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { PerspectiveCamera, Vector3 } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { Fox } from "../entities/Fox.js";
import { SPAWN, level1 } from "../levels/level-1.js";
import { type World, createWorld, disposeWorld, spawn } from "../levels/spawn.js";
import { createSpringArm, type SpringArm } from "../render/camera.js";
import { setupLighting, type SunRig } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { type Backdrop, setupSky } from "../render/sky.js";
import { type Counters, createCounters, type GameState } from "../state.js";

export type GameCtx = Ctx<GameState, PhysicsContext>;

export class Level extends Scene<GameState, PhysicsContext> {
  #fox: Fox | undefined;
  #world: World = createWorld();
  #arm: SpringArm | undefined;
  #sun: SunRig | undefined;
  #sky: Backdrop | undefined;
  #counters: Counters = createCounters();
  #anchor = new Vector3();

  override enter(ctx: GameCtx): void {
    const materials = createMaterials();
    this.#sun = setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    this.#sky = setupSky(ctx.scene);
    setupPost(ctx.renderer.raw as WebGPURenderer, ctx.scene, ctx.camera);

    this.#counters = createCounters();
    this.#fox = new Fox(ctx, materials, new Vector3(SPAWN.x, SPAWN.y, SPAWN.z));
    ctx.entities.add("fox", this.#fox);

    for (const prefab of level1) {
      spawn(ctx, materials, prefab, this.#fox, this.#counters, this.#world);
    }

    // ctx.camera is a plain PerspectiveCamera. The rig writes to it; nothing
    // wraps it, and the framework has no opinion about where it points.
    const camera = ctx.camera as PerspectiveCamera;
    camera.fov = 52;
    camera.far = 600;
    camera.updateProjectionMatrix();
    this.#arm = createSpringArm(camera);
    this.#arm.snap(this.#fox.position);
    this.#sun.aimSun(this.#fox.position);
  }

  override update(ctx: GameCtx, dt: number): void {
    const fox = this.#fox;
    if (fox === undefined) return;

    fox.update(ctx, dt);
    this.#trackFeats(fox);

    for (const collectible of this.#world.collectibles) collectible.update(dt);
    for (const enemy of this.#world.enemies) enemy.update(dt);
    for (const crate of this.#world.crates) crate.update(dt);
    for (const ferry of this.#world.ferries) ferry.update(dt);

    this.#counters.hearts = fox.hearts;
    this.#counters.timeMs += dt * 1000;

    this.#anchor.copy(fox.position);
    this.#arm?.follow(this.#anchor, dt);
    this.#sun?.aimSun(this.#anchor);
    if (this.#sky !== undefined) {
      this.#sky.update(dt);
      // Move the backdrop *with* the camera at 86% of its travel, so it slides
      // by at 14% relative speed. Static would read as a painted wall.
      this.#sky.group.position.x = ctx.camera.position.x * 0.86;
      this.#sky.group.position.z = ctx.camera.position.z * 0.86;
    }

    // Absolute writes, never `set(s => s.coins + 1)`: the store coalesces on a
    // timer and a functional patch would read a stale base. See state.ts.
    ctx.state.set({
      coins: this.#counters.coins,
      defeated: this.#counters.defeated,
      dashes: this.#counters.dashes,
      gems: this.#counters.gems,
      hearts: this.#counters.hearts,
      jumps: this.#counters.jumps,
      peakRise: this.#counters.peakRise,
      stars: this.#counters.stars,
      timeMs: this.#counters.timeMs,
      topSpeed: this.#counters.topSpeed,
    });
  }

  override exit(ctx: GameCtx): void {
    ctx.entities.remove("fox");
    disposeWorld(this.#world);
    this.#fox?.dispose();
    this.#fox = undefined;
    this.#arm = undefined;
    this.#sun = undefined;
    this.#sky = undefined;
  }

  /**
   * The numbers a playtest asserts on. Peaks and counters rather than the
   * fox's current pose, because a scenario's exact end tick is not something
   * the harness promises — see examples/AGENTS.md.
   */
  #trackFeats(fox: Fox): void {
    const rise = fox.position.y - SPAWN.y;
    if (rise > this.#counters.peakRise) this.#counters.peakRise = rise;
    const speed = Math.hypot(fox.body.velocity.x, fox.body.velocity.z);
    if (speed > this.#counters.topSpeed) this.#counters.topSpeed = speed;
    this.#counters.dashes = fox.dashCount;
    this.#counters.jumps = fox.jumpCount;
  }
}
