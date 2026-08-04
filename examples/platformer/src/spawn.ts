import type { Ctx } from "@threenative/core";
import { CollisionShape3D, type PhysicsContext, RigidBody3D } from "@threenative/physics";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { Coin } from "./entities/Coin.js";
import { Mushroom } from "./entities/Mushroom.js";
import { Platform } from "./entities/Platform.js";
import { Snail } from "./entities/Snail.js";
import type { LevelEntry, Vec3 } from "./levels/level-1.js";
import type { Materials } from "./render/materials.js";
import {
  createBush,
  createFence,
  createIvy,
  createPine,
  createTree,
  createTuft,
} from "./render/props.js";
import { ball, block, makeRandom, roundedBox } from "./render/shapes.js";
import type { GameState } from "./state.js";

type LevelCtx = Ctx<GameState, PhysicsContext>;

export interface SpawnedLevel {
  readonly coins: Coin[];
  readonly enemies: (Mushroom | Snail)[];
  readonly gemCount: number;
  readonly lifts: Platform[];
  readonly solids: RigidBody3D[];
}

/** A tiny deterministic sequence: the same island dresses itself the same way. */
function scatter(seed: number): () => number {
  let state = Math.abs(Math.trunc(seed * 9301)) + 49297;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

function vector(position: Vec3): Vector3 {
  return new Vector3(position[0], position[1], position[2]);
}

function solid(ctx: LevelCtx, mesh: Mesh, size: Vec3): RigidBody3D {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  ctx.add(mesh);
  return new RigidBody3D({
    mesh,
    physics: ctx.physics,
    shape: CollisionShape3D.box(size[0], size[1], size[2]),
    type: "fixed",
  });
}

/**
 * One floating island: an overhanging grass cap, a banded rock body, a cliff
 * hanging under it, and the dressing — tufts, flowers, ivy, fencing, trees.
 * The collider is the plain box; everything else is decoration parented to it.
 */
function island(entry: Extract<LevelEntry, { kind: "island" }>, materials: Materials): Mesh {
  const [width, height, depth] = entry.size;
  const mesh = new Mesh(roundedBox(width, height * 0.7, depth, 0.3), materials.rock);
  mesh.position.set(entry.position[0], entry.position[1], entry.position[2]);
  const top = height / 2;

  // The cap overhangs the rock, which is what gives the reference's islands
  // their mushroom-lipped silhouette.
  const cap = block(width + 0.7, height * 0.42, depth + 0.7, materials.grass, { radius: 0.28 });
  cap.position.y = top - height * 0.21;
  const lawn = block(width + 0.62, 0.14, depth + 0.62, materials.grassBright, {
    castShadow: false,
    radius: 0.06,
  });
  lawn.position.y = top + 0.005;
  // The dark band under the lip: the reference's grass always casts onto its
  // own cliff, and without it the cap reads as a floating sheet of paper.
  const lip = block(width + 0.56, 0.22, depth + 0.56, materials.grassDark, {
    castShadow: false,
    radius: 0.1,
  });
  lip.position.y = top - height * 0.42;
  mesh.add(cap, lawn, lip);

  // Layered rock below: two tapering slabs, then a spike into the cloud. The
  // colours alternate rather than repeat — that banding is the strata, and it
  // is why none of this needs a texture.
  for (const [index, [scale, drop, thickness]] of (
    [
      [0.92, 0.9, 1.6],
      [0.74, 2.4, 1.4],
      [0.52, 3.6, 1],
    ] as const
  ).entries()) {
    const strata = [materials.rockLight, materials.rockDark, materials.rock];
    const layer = block(width * scale, thickness, depth * scale, strata[index] ?? materials.rock, {
      radius: 0.3,
      receiveShadow: false,
    });
    layer.position.y = -top - drop + height * 0.15;
    mesh.add(layer);
  }

  // The fringe: grass lobes drooping over the rock lip. This is the trick that
  // breaks the silhouette, so the eye never resolves the cap as one solid box.
  const fringeRandom = makeRandom(Math.abs(Math.round(entry.position[0] * 131 + depth * 17)) + 1);
  const lobes = Math.max(6, Math.round((width + depth) * 0.8));
  for (let index = 0; index < lobes; index += 1) {
    const onX = fringeRandom() > 0.5;
    const sign = fringeRandom() > 0.5 ? 1 : -1;
    const lobe = ball(0.24 + fringeRandom() * 0.2, materials.grassDark, {
      castShadow: false,
      segments: 8,
    });
    lobe.scale.set(1, 1.5 + fringeRandom(), 1);
    const sag = top - height * 0.34 - fringeRandom() * 0.3;
    if (onX)
      lobe.position.set(sign * (width / 2 + 0.3), sag, (fringeRandom() - 0.5) * depth * 0.92);
    else lobe.position.set((fringeRandom() - 0.5) * width * 0.92, sag, sign * (depth / 2 + 0.3));
    mesh.add(lobe);
  }
  const spike = new Mesh(
    new ConeGeometry(Math.min(width, depth) * 0.26, height * 3.2, 6),
    materials.rockDark,
  );
  spike.rotation.x = Math.PI;
  spike.position.y = -top - height * 2.4;
  spike.castShadow = true;
  mesh.add(spike);

  const ivy = createIvy(materials, Math.min(width, 6));
  ivy.position.set(0, top - height * 0.3, depth / 2 + 0.26);
  mesh.add(ivy);

  const random = scatter(entry.position[0] + entry.position[2] * 3.7);
  // No darker ground patches here: flat quads laid a hair above the lawn read
  // as decals, not as grass. The lawn's variety comes from the fringe breaking
  // its edge and from the tufts standing up off it.
  const tufts = Math.round(width * depth * 0.11);
  for (let index = 0; index < tufts; index += 1) {
    const tuft = createTuft(materials, index % 3 === 0);
    tuft.position.set(
      (random() - 0.5) * (width - 0.8),
      top + 0.06,
      (random() - 0.5) * (depth - 0.8),
    );
    tuft.rotation.y = random() * Math.PI;
    mesh.add(tuft);
  }

  if (width >= 8) {
    const fence = createFence(materials, width * 0.5, 3);
    fence.position.set(-width * 0.16, top, -depth / 2 + 0.55);
    mesh.add(fence);
  }

  for (const [index, [x, , z]] of (entry.trees ?? []).entries()) {
    const tree = index % 2 === 0 ? createTree(materials, 0.85) : createPine(materials, 0.95);
    tree.position.set(x - entry.position[0], top + 0.05, z - entry.position[2]);
    mesh.add(tree);
  }
  for (const [x, , z] of entry.bushes ?? []) {
    const bush = createBush(materials, 1.05);
    bush.position.set(x - entry.position[0], top + 0.05, z - entry.position[2]);
    mesh.add(bush);
  }
  return mesh;
}

/** Rope-and-plank crossing: chunky planks, fat end posts, ropes, ivy. */
function bridge(entry: Extract<LevelEntry, { kind: "bridge" }>, materials: Materials): Mesh {
  const [width, height, depth] = entry.size;
  const mesh = new Mesh(roundedBox(width, height, depth, 0.08), materials.woodDark);
  mesh.position.set(entry.position[0], entry.position[1], entry.position[2]);
  const planks = Math.max(2, Math.round(width / 0.82));
  const grain = [materials.woodLight, materials.wood, materials.woodDark];
  const plankRandom = makeRandom(Math.abs(Math.round(entry.position[0] * 977)) + 13);
  for (let index = 0; index < planks; index += 1) {
    // Cycling three woods across the run is the grain; the tilt is why a plank
    // deck reads as laid by hand rather than extruded.
    const plank = block(
      width / planks - 0.03,
      0.22,
      depth - 0.06,
      grain[index % grain.length] ?? materials.wood,
      { radius: 0.07 },
    );
    plank.position.set(width * ((index + 0.5) / planks - 0.5), height / 2 + 0.06, 0);
    plank.rotation.x = (plankRandom() - 0.5) * 0.05;
    mesh.add(plank);
  }
  // Rails on the far edge only. On the near edge they would cross the camera's
  // line to the fox, which is exactly what the reference avoids.
  for (const side of [-1, 1]) {
    for (const [edge, tall] of [
      [-1, true],
      [1, false],
    ] as const) {
      const height = tall ? 2.1 : 1.1;
      const post = new Mesh(new CylinderGeometry(0.19, 0.22, height, 8), materials.trunk);
      post.position.set((width / 2 - 0.25) * side, height / 2 - 0.3, (depth / 2 - 0.16) * edge);
      post.castShadow = true;
      const cap = new Mesh(new CylinderGeometry(0.21, 0.19, 0.14, 8), materials.woodDark);
      cap.position.set(post.position.x, height - 0.36, post.position.z);
      mesh.add(post, cap);
    }
  }
  for (const [index, height] of [1.35, 0.95].entries()) {
    const rope = new Mesh(new CylinderGeometry(0.05, 0.05, width - 0.5, 5), materials.rope);
    rope.rotation.z = Math.PI / 2;
    rope.position.set(0, height - index * 0.05, -(depth / 2 - 0.16));
    mesh.add(rope);
  }
  return mesh;
}

/** The goal marker. Scenery: reaching it is proved by position, not by touch. */
function flag(position: Vec3, materials: Materials): Group {
  const group = new Group();
  group.position.set(position[0], position[1], position[2]);
  const base = new Mesh(new CylinderGeometry(0.5, 0.62, 0.3, 10), materials.rock);
  base.position.y = 0.15;
  base.castShadow = true;
  const pole = new Mesh(new CylinderGeometry(0.09, 0.09, 3.8, 8), materials.cream);
  pole.position.y = 2;
  pole.castShadow = true;
  const cloth = new Mesh(
    new BoxGeometry(1.2, 0.75, 0.06),
    new MeshBasicMaterial({ color: 0x4fc3f7 }),
  );
  cloth.position.set(0.65, 3.4, 0);
  const finial = new Mesh(new ConeGeometry(0.14, 0.3, 8), materials.coin);
  finial.position.y = 4;
  group.add(base, pole, cloth, finial);
  return group;
}

/**
 * Builds the level. Fails closed on an unknown kind: a typo'd prefab must stop
 * the run, never quietly leave a hole where a platform should be.
 */
export function spawn(
  ctx: LevelCtx,
  level: readonly LevelEntry[],
  materials: Materials,
): SpawnedLevel {
  const coins: Coin[] = [];
  const enemies: (Mushroom | Snail)[] = [];
  const lifts: Platform[] = [];
  const solids: RigidBody3D[] = [];
  let gemCount = 0;

  for (const entry of level) {
    switch (entry.kind) {
      case "island":
        solids.push(solid(ctx, island(entry, materials), entry.size));
        break;
      case "bridge":
        solids.push(solid(ctx, bridge(entry, materials), entry.size));
        break;
      case "block": {
        const mesh = new Mesh(roundedBox(1.3, 1.3, 1.3, 0.16), materials.block);
        mesh.position.set(entry.position[0], entry.position[1], entry.position[2]);
        // The `?` crate's face was a painted texture until CanvasTexture turned
        // out to sample black under WebGPU. Geometry says the same thing: a
        // recessed border and four corner rivets, built once per crate.
        for (const [x, y] of [
          [-0.46, 0.46],
          [0.46, 0.46],
          [-0.46, -0.46],
          [0.46, -0.46],
        ] as const) {
          for (const face of [1, -1]) {
            const rivet = ball(0.075, materials.blockTrim, { receiveShadow: false, segments: 8 });
            rivet.position.set(x, y, face * 0.655);
            mesh.add(rivet);
          }
        }
        for (const size of [
          [1.34, 0.13, 1.34],
          [0.13, 1.34, 1.34],
        ] as const) {
          mesh.add(new Mesh(roundedBox(size[0], size[1], size[2], 0.05), materials.blockTrim));
        }
        solids.push(solid(ctx, mesh, [1.3, 1.3, 1.3]));
        break;
      }
      case "lift": {
        const lift = new Platform(
          ctx,
          vector(entry.position),
          entry.size,
          vector(entry.travel),
          entry.seconds,
          materials,
        );
        ctx.entities.add(entry.id, lift);
        lifts.push(lift);
        break;
      }
      case "coin":
      case "gem": {
        const coin = new Coin(ctx, entry.id, entry.kind, vector(entry.position), materials);
        ctx.entities.add(entry.id, coin);
        coins.push(coin);
        if (entry.kind === "gem") gemCount += 1;
        break;
      }
      case "mushroom": {
        const mushroom = new Mushroom(
          ctx,
          entry.id,
          vector(entry.position),
          entry.axis,
          entry.distance,
          materials,
        );
        ctx.entities.add(entry.id, mushroom);
        enemies.push(mushroom);
        break;
      }
      case "snail": {
        const snail = new Snail(
          ctx,
          entry.id,
          vector(entry.position),
          entry.axis,
          entry.distance,
          materials,
        );
        ctx.entities.add(entry.id, snail);
        enemies.push(snail);
        break;
      }
      case "flag":
        ctx.add(flag(entry.position, materials));
        break;
      default:
        throw new Error(
          `Unknown level prefab kind '${(entry as { kind: string }).kind}' in level data.`,
        );
    }
  }
  return { coins, enemies, gemCount, lifts, solids };
}
