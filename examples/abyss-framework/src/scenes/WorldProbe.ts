import { type ICtx, Scene } from "@threenative/core";
import { WorldCells } from "@threenative/core/world";
import { Color, DirectionalLight, HemisphereLight } from "three";
import fixtureManifestUrl from "../../../../packages/core/__tests__/fixtures/world-v1/world.json?url";
import { terrainMaterial } from "../render/terrain.js";

/**
 * PRD-448 Phase 4a: a deterministic fly-through of a committed `world-v1` package.
 *
 * The scene is the whole point the framework has to hold: the game names a package URL, a surface
 * and a follow target, and `WorldCells` streams the terrain, the instanced props and the hand-placed
 * chunks by cell as the camera crosses the 256 m fixture. The camera is the follow target and
 * travels one straight line at a fixed altitude while the scenario holds one input, so residency
 * rises and falls and the scenario can assert the stats the package promises.
 *
 * Nothing here decides how anything looks that belongs to the package: the terrain surface is this
 * example's own (`terrainMaterial`), the lights are the example's, and the props, colours and chunks
 * come from the GLBs the package names.
 */

/** The fixture is 4x4 cells of 64 m starting at (-128, -128). */
const START_X = -160;
const END_X = 180;
/** Metres per second; a straight x-axis crossing reaches every column of the fixture. */
const SPEED = 64;
/** Above the fixture's measured maximum height (4.86 m), so the camera never enters the terrain. */
const ALTITUDE = 24;
const RING = 1;
const BUDGETS = { bytes: 8_000_000, instances: 20_000, residentCells: 25 };

const initialState = {
  evictions: 0,
  failures: 0,
  instances: 0,
  loadsInFlight: 0,
  maxResidentCells: 0,
  residenceChanges: 0,
  residentCells: 0,
};

export type WorldState = typeof initialState;
type WorldCtx = ICtx<WorldState>;

export class WorldProbe extends Scene<WorldState> {
  static override readonly initialState = initialState;

  /**
   * The package URL the scene streams. Defaults to the committed fixture through Vite's `?url`;
   * a native entry that stages the same package as an asset sets it to a host-loadable path
   * (e.g. `/world.json`) before `game.start()`.
   */
  static manifestUrl: string | undefined;

  #world: WorldCells | undefined;
  #elapsed = 0;
  #previousResident = -1;
  #maxResident = 0;
  #residenceChanges = 0;

  override async load(ctx: WorldCtx): Promise<void> {
    this.#world = await WorldCells.load({
      budgets: BUDGETS,
      follow: ctx.camera,
      ring: RING,
      surface: terrainMaterial(),
      terrain: { tileResolution: 65 },
      url: WorldProbe.manifestUrl ?? fixtureManifestUrl,
    });
  }

  override enter(ctx: WorldCtx): void {
    const world = this.#world;
    if (world === undefined) throw new Error("WorldProbe.enter ran before load() resolved.");
    ctx.add(world);
    ctx.scene.background = new Color(0x0b1a2a);
    // The props' GLBs carry no materials, so three's default standard material needs a light to be
    // visible. The look is this example's, exactly as a game's would be.
    const sky = new HemisphereLight(0xbfd8ff, 0x2a2f22, 2.2);
    const sun = new DirectionalLight(0xffffff, 2.6);
    sun.position.set(-80, 120, 60);
    ctx.add(sky);
    ctx.add(sun);
    ctx.entities.add("world", {
      debug: () => this.#debug(),
      dispose: () => world.dispose(),
      object: world,
    });
    this.#update(ctx, 0);
  }

  override update(ctx: WorldCtx, dt: number): void {
    this.#update(ctx, dt);
  }

  #update(ctx: WorldCtx, dt: number): void {
    // Movement is gated on an input the scenario holds, not on the clock: the engine catches up
    // hundreds of fixed steps while first-use compilation settles, and a time-driven camera would
    // have crossed the whole fixture before the baseline observation.
    if (ctx.input.pressed("fly")) this.#elapsed += dt;
    const x = Math.min(START_X + this.#elapsed * SPEED, END_X);
    ctx.camera.position.set(x, ALTITUDE, 0);
    ctx.camera.lookAt(x + 40, ALTITUDE - 14, 0);
    this.#sample();
  }

  /** Sample the residency counters per step; the stats are read at observation time. */
  #sample(): void {
    const stats = this.#world?.stats();
    if (stats === undefined) return;
    if (stats.residentCells !== this.#previousResident) {
      this.#previousResident = stats.residentCells;
      this.#residenceChanges += 1;
    }
    this.#maxResident = Math.max(this.#maxResident, stats.residentCells);
  }

  #debug(): Record<string, number> {
    const stats = this.#world?.stats();
    return {
      evictions: stats?.evictions ?? 0,
      failures: stats?.failures ?? 0,
      instances: stats?.instances ?? 0,
      loadsInFlight: stats?.loadsInFlight ?? 0,
      maxResidentCells: this.#maxResident,
      residenceChanges: this.#residenceChanges,
      residentCells: stats?.residentCells ?? 0,
    };
  }
}
