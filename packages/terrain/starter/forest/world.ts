// The forest starter world, as the game that copied it draws and collides with it.
//
// `bake.mjs` wrote a world package (heightmap, splat masks, placements, CC0 models) into `world/`;
// the engine's `WorldCells` streams it, `loadTerrainSplat` textures its ground, and everything
// that decides how the world looks or what stops the player is in this folder for the game to edit.
import type { ICtx } from "@threenative/core";
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
  readonly props: readonly RigidBody3D[];
}

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
    budgets: { residentCells: 64, instances: 40_000, bytes: 64_000_000 },
    terrain: { streamRadius: 6 },
  });
  ctx.add(world);
  return {
    world,
    ground: await groundCollider(ctx, url, manifest),
    props: await propColliders(ctx, url, manifest),
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

// ponytail: every prop collider exists from load (a few thousand fixed bodies); stream them with
// the cells when a world grows past what Rapier holds comfortably.
async function propColliders(
  ctx: ICtx<Record<string, unknown>, IPhysicsContext>,
  url: string,
  manifest: IWorldPackage,
): Promise<RigidBody3D[]> {
  const base = url.slice(0, url.lastIndexOf("/") + 1);
  const records = new Float32Array(
    await (await fetchAsset(ctx, base + manifest.placements)).arrayBuffer(),
  );
  const bodies: RigidBody3D[] = [];
  for (const cell of manifest.cells)
    for (const run of cell.runs) {
      const shape = COLLIDERS[run.asset];
      if (!shape) continue;
      for (let i = run.offset; i < run.offset + run.count; i++) {
        const [x, y, z] = records.subarray(i * 8, i * 8 + 3) as unknown as [number, number, number];
        const { lift, collider } = colliderAt(shape, records[i * 8 + 7] as number);
        bodies.push(
          new RigidBody3D({
            physics: ctx.physics,
            type: "fixed",
            entity: `${run.asset}.${String(i)}`,
            position: { x, y: y + lift, z },
            shape: collider,
          }),
        );
      }
    }
  return bodies;
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
