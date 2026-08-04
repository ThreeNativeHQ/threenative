import type { Ctx } from "@threenative/core";
import { CollisionShape3D, type PhysicsContext, RigidBody3D } from "@threenative/physics";
import { Group, Mesh, MeshBasicMaterial, type Object3D, Vector3 } from "three";
import { Collectible } from "../entities/Collectible.js";
import { Crate } from "../entities/Crate.js";
import { Enemy } from "../entities/Enemy.js";
import { Ferry } from "../entities/Ferry.js";
import type { Fox } from "../entities/Fox.js";
import type { Materials } from "../render/materials.js";
import { bush, fence, grassIsland, plankBridge, scatter, tree, waterfall } from "../render/props.js";
import { ball, block, roundedBox, tube } from "../render/shapes.js";
import type { Counters, GameState } from "../state.js";
import type { Prefab } from "./level-1.js";

type GameCtx = Ctx<GameState, PhysicsContext>;

const BRIDGE_WIDTH = 3.1;
const ISLAND_CAP = 0.9;

export interface World {
  readonly collectibles: Collectible[];
  readonly crates: Crate[];
  readonly enemies: Enemy[];
  readonly ferries: Ferry[];
  readonly bodies: RigidBody3D[];
  readonly objects: Object3D[];
}

export function createWorld(): World {
  return { bodies: [], collectibles: [], crates: [], enemies: [], ferries: [], objects: [] };
}

/** An invisible collider mesh. What you see is always a separate, nicer prop. */
function collider(
  ctx: GameCtx,
  world: World,
  width: number,
  height: number,
  depth: number,
  at: Vector3,
): void {
  const mesh = new Mesh(roundedBox(width, height, depth, 0.05), new MeshBasicMaterial());
  mesh.visible = false;
  mesh.position.copy(at);
  ctx.add(mesh);
  world.objects.push(mesh);
  world.bodies.push(
    new RigidBody3D({
      mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(width, height, depth),
      type: "fixed",
    }),
  );
}

function place(ctx: GameCtx, world: World, object: Object3D, x: number, y: number, z: number): void {
  object.position.set(x, y, z);
  ctx.add(object);
  world.objects.push(object);
}

function goalFlag(materials: Materials): Group {
  const group = new Group();
  const pole = tube(0.07, 0.09, 3.2, materials.rope, { segments: 10 });
  pole.position.y = 1.6;
  const flag = block(0.9, 0.6, 0.06, materials.gem, { radius: 0.05 });
  flag.position.set(0.5, 2.9, 0);
  const knob = ball(0.14, materials.coin, { segments: 12 });
  knob.position.y = 3.3;
  const base = tube(0.5, 0.62, 0.3, materials.rockLit, { segments: 12 });
  base.position.y = 0.15;
  group.add(pole, flag, knob, base);
  return group;
}

/**
 * Turn one prefab into meshes, colliders and entities.
 *
 * The `default` branch throws. That is the whole reason this is a switch and
 * not a lookup with a fallback: a level typo has to stop the run, because a
 * silently missing platform is a bug you find by falling through the world.
 */
export function spawn(
  ctx: GameCtx,
  materials: Materials,
  prefab: Prefab,
  fox: Fox,
  counters: Counters,
  world: World,
): void {
  const z = prefab.z ?? 0;
  switch (prefab.kind) {
    case "island": {
      const visual = grassIsland(materials, prefab.width, prefab.depth, prefab.seed ?? 1);
      place(ctx, world, visual, prefab.x, prefab.y, z);
      collider(
        ctx,
        world,
        prefab.width,
        ISLAND_CAP,
        prefab.depth,
        new Vector3(prefab.x, prefab.y - ISLAND_CAP / 2, z),
      );
      return;
    }
    case "bridge": {
      place(ctx, world, plankBridge(materials, prefab.length, 7), prefab.x, prefab.y, z);
      collider(
        ctx,
        world,
        prefab.length,
        0.3,
        BRIDGE_WIDTH,
        new Vector3(prefab.x + prefab.length / 2, prefab.y - 0.15, z),
      );
      return;
    }
    case "ferry": {
      const ferry = new Ferry(
        ctx,
        materials,
        new Vector3(prefab.x, prefab.y - 0.25, z),
        prefab.to,
        prefab.speed,
        fox,
      );
      world.ferries.push(ferry);
      return;
    }
    case "coin":
    case "gem": {
      world.collectibles.push(
        new Collectible(
          ctx,
          materials,
          prefab.kind,
          new Vector3(prefab.x, prefab.y, z),
          fox,
          counters,
        ),
      );
      return;
    }
    case "coinArc": {
      for (let index = 0; index < prefab.count; index += 1) {
        const t = prefab.count === 1 ? 0.5 : index / (prefab.count - 1);
        world.collectibles.push(
          new Collectible(
            ctx,
            materials,
            "coin",
            new Vector3(
              prefab.x + t * prefab.span,
              prefab.y + Math.sin(t * Math.PI) * prefab.rise,
              z,
            ),
            fox,
            counters,
          ),
        );
      }
      return;
    }
    case "mushroom":
    case "snail": {
      world.enemies.push(
        new Enemy(
          ctx,
          materials,
          prefab.kind,
          new Vector3(prefab.x, prefab.y, z),
          prefab.range,
          fox,
          counters,
        ),
      );
      return;
    }
    case "crate": {
      world.crates.push(
        new Crate(ctx, materials, new Vector3(prefab.x, prefab.y, z), fox, counters),
      );
      return;
    }
    case "grove": {
      const group = new Group();
      scatter(group, (seed) => tree(materials, seed), 5, prefab.width, prefab.depth, prefab.seed ?? 5);
      scatter(group, (seed) => bush(materials, seed), 7, prefab.width, prefab.depth, (prefab.seed ?? 5) + 91);
      place(ctx, world, group, prefab.x, prefab.y, z);
      return;
    }
    case "fence": {
      place(ctx, world, fence(materials, prefab.length, 13), prefab.x, prefab.y, z);
      return;
    }
    case "waterfall": {
      place(ctx, world, waterfall(materials, prefab.width, prefab.height), prefab.x, prefab.y, z);
      return;
    }
    case "goal": {
      place(ctx, world, goalFlag(materials), prefab.x, prefab.y, z);
      return;
    }
    default: {
      // Exhaustive: if a new prefab kind is added above without a branch here,
      // TypeScript fails this line before the game ever runs.
      const unknown: never = prefab;
      throw new Error(
        `Unknown prefab kind '${(unknown as { kind?: string }).kind ?? "undefined"}'.`,
      );
    }
  }
}

export function disposeWorld(world: World): void {
  for (const collectible of world.collectibles) collectible.dispose();
  for (const enemy of world.enemies) enemy.dispose();
  for (const crate of world.crates) crate.dispose();
  for (const ferry of world.ferries) ferry.dispose();
  for (const body of world.bodies) body.dispose();
  for (const object of world.objects) object.removeFromParent();
  world.collectibles.length = 0;
  world.enemies.length = 0;
  world.crates.length = 0;
  world.ferries.length = 0;
  world.bodies.length = 0;
  world.objects.length = 0;
}
