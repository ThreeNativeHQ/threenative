// The forest starter world, as the game that copied it draws and collides with it.
//
// `bake.mjs` wrote a world package (heightmap, splat masks, placements, CC0 models) into `world/`;
// the engine's `WorldCells` streams it, `loadTerrainSplat` textures its ground, and everything
// that decides how the world looks or what stops the player is in this folder for the game to edit.
import type { IComputeDriven, ICtx } from "@threenative/core";
import {
  Heightfield,
  type IWorldPackage,
  WorldCells,
  heightSamplerFromHeightmap,
  loadTerrainSplat,
  loadWorldHeightmap,
} from "@threenative/core/world";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { EquirectangularReflectionMapping, type Material, Object3D } from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

/** Where the game's asset source holds the baked `world/` folder. */
export const FOREST_URL = "terrain/forest/world.json";

/**
 * What stops the player, per placed asset, in metres at the placement's scale 1. `null` walks
 * through. A capsule stands on the placement's origin. Change a row to change every copy.
 */
export const COLLIDERS: Readonly<
  Record<
    string,
    { capsule: readonly [halfHeight: number, radius: number] } | { sphere: number } | null
  >
> = {
  fir: { capsule: [3, 0.35] },
  boulder: { sphere: 0.9 },
};

/** How strongly the sky lights the props; the sun stays the dominant light on a crown. */
export const PROP_SKY_LIGHT = 0.5;

export interface IForestWorld {
  readonly world: WorldCells;
  /** One heightfield for the whole world, in place before `addForest` resolves. */
  readonly ground: RigidBody3D;
  /** The prop colliders near `follow`; they stream with it (see `PROP_COLLIDER_REACH`). */
  readonly colliders: PropColliders;
}

/** Metres around `follow` within which props collide; beyond it they only draw. */
export const PROP_COLLIDER_REACH = 60;

/** Stream the forest around `follow` (usually the player or the camera) and give it collision. */
export async function addForest(
  ctx: ICtx<Record<string, unknown>, IPhysicsContext>,
  follow: Object3D,
  url = FOREST_URL,
): Promise<IForestWorld> {
  const manifest = (await (await fetchAsset(ctx, url)).json()) as IWorldPackage;
  const surface = await loadTerrainSplat({ assets: ctx.assets, url });
  await lightProps(ctx, url, manifest);
  const world = await WorldCells.load({
    url,
    assets: ctx.assets,
    surface,
    follow,
    ring: 5,
    // Far firs draw as engine-baked impostors; the authored model stays the shadow caster.
    impostors: true,
    // The GPU-culled path drops the near firs from the main pass while their shadows still draw
    // (measured in a fresh game, 2026-10-05); the CPU path draws them. Engine finding, PRD-466.
    gpuScene: false,
    // Trees and rocks shade the ground and each other; impostors keep the authored model as the caster.
    shadows: { cast: true, receive: true },
    budgets: { residentCells: 64, instances: 40_000, bytes: 64_000_000 },
    terrain: { streamRadius: 6 },
  });
  ctx.add(world);
  return {
    world,
    ground: await groundCollider(ctx, url, manifest),
    colliders: ctx.add(
      new PropColliders(ctx, follow, manifest, await placements(ctx, url, manifest)),
    ),
  };
}

// Cutout foliage with no environment draws flat and dark (the engine says TN_UNLIT_FOLIAGE): give
// every prop the sky as its own envMap before WorldCells adopts the shared cached models.
async function lightProps(
  ctx: ICtx<Record<string, unknown>, IPhysicsContext>,
  url: string,
  manifest: IWorldPackage,
): Promise<void> {
  const base = url.slice(0, url.lastIndexOf("/") + 1);
  const [skyUrl] = await ctx.assets.resolve(`${base}sky.hdr`);
  if (skyUrl === undefined) throw new Error("Forest world: 'sky.hdr' is not served.");
  const sky = await new HDRLoader().loadAsync(skyUrl);
  sky.mapping = EquirectangularReflectionMapping;
  for (const asset of Object.values(manifest.assets)) {
    const model = await ctx.assets.model<{ scene: Object3D }>(base + asset.glb);
    model.scene.traverse((object) => {
      const surface = (object as { material?: Material | Material[] }).material;
      for (const material of [surface ?? []].flat() as (Material & {
        envMap?: unknown;
        envMapIntensity?: number;
      })[]) {
        material.envMap = sky;
        material.envMapIntensity = PROP_SKY_LIGHT;
      }
    });
  }
}

// The streamed terrain tiles arrive over several frames; a player spawned before its tile would fall
// through. One heightfield for the whole package (a few hundred kilobytes of samples) avoids that.
async function groundCollider(
  ctx: ICtx<Record<string, unknown>, IPhysicsContext>,
  url: string,
  manifest: IWorldPackage,
): Promise<RigidBody3D> {
  const base = url.slice(0, url.lastIndexOf("/") + 1);
  const [heightmapUrl] = await ctx.assets.resolve(base + manifest.terrain.heightmap);
  if (heightmapUrl === undefined) throw new Error("Forest world: its heightmap is not served.");
  const { extent, terrain } = manifest;
  const field = Heightfield.fromSampler({
    columns: terrain.columns,
    rows: terrain.rows,
    width: extent.sizeX,
    depth: extent.sizeZ,
    origin: { x: extent.minX + extent.sizeX / 2, z: extent.minZ + extent.sizeZ / 2 },
    sampleHeight: heightSamplerFromHeightmap(
      terrain,
      extent,
      await loadWorldHeightmap(heightmapUrl),
    ),
  });
  const anchor = new Object3D();
  anchor.position.set(extent.minX + extent.sizeX / 2, 0, extent.minZ + extent.sizeZ / 2);
  ctx.add(anchor);
  return new RigidBody3D({
    object: anchor,
    physics: ctx.physics,
    type: "fixed",
    entity: "terrain",
    shape: CollisionShape3D.heightfield(field.rows, field.columns, field.toColliderHeights(), {
      x: extent.sizeX,
      y: 1,
      z: extent.sizeZ,
    }),
  });
}

async function placements(
  ctx: ICtx<Record<string, unknown>, IPhysicsContext>,
  url: string,
  manifest: IWorldPackage,
): Promise<Float32Array> {
  const base = url.slice(0, url.lastIndexOf("/") + 1);
  return new Float32Array(await (await fetchAsset(ctx, base + manifest.placements)).arrayBuffer());
}

/**
 * Fixed bodies for the props within `PROP_COLLIDER_REACH` of `follow`, rebuilt when it has moved a
 * few metres. Thousands of resident bodies cost Rapier ~0.5 s per 8 s (measured); a hundred do not.
 */
export class PropColliders extends Object3D implements IComputeDriven {
  readonly warmupNodes: readonly unknown[] = [];
  readonly processCadence = "render" as const;
  readonly #live = new Map<number, RigidBody3D>();
  readonly #runs: { asset: string; offset: number; count: number }[] = [];
  readonly #at = { x: Number.NaN, z: Number.NaN };
  #released = false;

  constructor(
    private readonly ctx: ICtx<Record<string, unknown>, IPhysicsContext>,
    private readonly follow: Object3D,
    manifest: IWorldPackage,
    private readonly records: Float32Array,
  ) {
    super();
    this.name = "forest-prop-colliders";
    for (const cell of manifest.cells)
      for (const run of cell.runs) if (COLLIDERS[run.asset]) this.#runs.push(run);
    this.#rebuild();
  }

  /** How many prop bodies exist right now. */
  get active(): number {
    return this.#live.size;
  }

  get released(): boolean {
    return this.#released;
  }

  attachRenderer(): void {}

  process(): void {
    const p = this.follow.position;
    if (Math.hypot(p.x - this.#at.x, p.z - this.#at.z) > 4 || Number.isNaN(this.#at.x))
      this.#rebuild();
  }

  detach(): void {
    for (const body of this.#live.values()) body.dispose();
    this.#live.clear();
    this.#released = true;
  }

  #rebuild(): void {
    const { x: fx, z: fz } = this.follow.getWorldPosition(this.position.clone());
    this.#at.x = fx;
    this.#at.z = fz;
    const keep = new Set<number>();
    for (const run of this.#runs) {
      const shape = COLLIDERS[run.asset];
      if (!shape) continue;
      for (let i = run.offset; i < run.offset + run.count; i++) {
        const x = this.records[i * 8] as number;
        const z = this.records[i * 8 + 2] as number;
        if (Math.hypot(x - fx, z - fz) > PROP_COLLIDER_REACH) continue;
        keep.add(i);
        if (this.#live.has(i)) continue;
        const { lift, collider } = colliderAt(shape, this.records[i * 8 + 7] as number);
        this.#live.set(
          i,
          new RigidBody3D({
            physics: this.ctx.physics,
            type: "fixed",
            entity: `${run.asset}.${String(i)}`,
            position: { x, y: (this.records[i * 8 + 1] as number) + lift, z },
            shape: collider,
          }),
        );
      }
    }
    for (const [i, body] of this.#live)
      if (!keep.has(i)) {
        body.dispose();
        this.#live.delete(i);
      }
  }
}

/** One table row at one placement's scale; a capsule stands on the origin, a sphere sits on it. */
function colliderAt(
  shape: NonNullable<(typeof COLLIDERS)[string]>,
  scale: number,
): { lift: number; collider: CollisionShape3D } {
  if ("sphere" in shape)
    return { lift: 0, collider: CollisionShape3D.sphere(shape.sphere * scale) };
  const [halfHeight, radius] = shape.capsule;
  return {
    lift: (halfHeight + radius) * scale,
    collider: CollisionShape3D.capsule(halfHeight * scale, radius * scale),
  };
}

async function fetchAsset(
  ctx: ICtx<Record<string, unknown>, IPhysicsContext>,
  path: string,
): Promise<Response> {
  for (const candidate of await ctx.assets.resolve(path)) {
    const response = await fetch(candidate);
    if (response.ok) return response;
  }
  throw new Error(`Forest world: '${path}' is not served.`);
}
