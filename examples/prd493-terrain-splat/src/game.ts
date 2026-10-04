import { type ICtx, Scene, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { WorldCells, loadTerrainSplat } from "@threenative/core/world";
import { Color, DirectionalLight, type PerspectiveCamera } from "three";
import { SKY_COLOR, addDaylight, frameTerrain, orbitPose } from "./render/terrain-look.js";

const BUDGETS = { bytes: 8_000_000, instances: 2_000, residentCells: 9 };

/**
 * Sixteen terrain layers, each with an albedo, a normal and an ORM map, over one streamed
 * heightfield. Every map is an uncompressed JPEG — the shape that used to bind one sampler per map,
 * 48 textures against WebGPU's 16 sampled textures a stage. Same-size layers now stack into one
 * array texture per set, and the material reports what it costs in `userData.TN_TERRAIN_SPLAT`, so
 * this scene publishes those numbers and the playtest scenario asserts them: a regression to one
 * sampler per map fails the run instead of merely looking wrong.
 */
class TerrainSplatScene extends Scene {
  static override initialState = { layers: -1, samplers: -1, stacked: -1 };

  #world: WorldCells | undefined;
  #surface: Awaited<ReturnType<typeof loadTerrainSplat>> | undefined;
  #sun = new DirectionalLight();
  #elapsed = 0;

  override async load(ctx: ICtx): Promise<void> {
    // The renderer is what stacks the uncompressed layers: one GPU copy per layer into one array
    // texture per set, so the surface samples four textures instead of forty-eight.
    this.#surface = await loadTerrainSplat({
      assets: ctx.assets,
      renderer: ctx.renderer,
      url: "world/world.json",
    });
    this.#world = await WorldCells.load({
      assets: ctx.assets,
      budgets: BUDGETS,
      follow: ctx.camera,
      ring: 2,
      surface: this.#surface,
      terrain: { tileResolution: 65 },
      url: "world/world.json",
    });
  }

  override enter(ctx: ICtx): void {
    const world = this.#world;
    if (world === undefined) throw new Error("TerrainSplat.enter ran before load() resolved.");
    ctx.add(world);
    ctx.scene.background = new Color(SKY_COLOR);
    addDaylight(ctx.scene, this.#sun);
    frameTerrain(ctx.camera as PerspectiveCamera);
    ctx.entities.add("splat", {
      debug: () => ({
        ...this.#costs(),
        orbitSeconds: Number(this.#elapsed.toFixed(2)),
        residentCells: world.stats().residentCells,
      }),
      dispose: () => world.dispose(),
      object: world,
    });
  }

  override update(ctx: ICtx, dt: number): void {
    this.#elapsed += dt;
    const pose = orbitPose(this.#elapsed);
    ctx.camera.position.copy(pose.position);
    ctx.camera.lookAt(pose.target);
  }

  /** The marker's own numbers, so the runner asserts the cost rather than a screenshot's opinion. */
  #costs(): { layers: number; samplers: number; stacked: number } {
    const marker = String(this.#surface?.userData.TN_TERRAIN_SPLAT ?? "");
    const number = (key: string): number => {
      const found = new RegExp(`${key}=(\\d+)`, "u").exec(marker);
      return found === null ? -1 : Number(found[1]);
    };
    return { layers: number("layers"), samplers: number("samplers"), stacked: number("stacked") };
  }
}

export default defineGame({
  plugins: [playtest()],
  render: { preferWebGPU: true },
  scenes: { terrainSplat: TerrainSplatScene },
  start: "terrainSplat",
  step: 1 / 60,
});
