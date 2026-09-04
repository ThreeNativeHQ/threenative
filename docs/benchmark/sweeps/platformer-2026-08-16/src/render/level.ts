// The level: one authored route running along +x, plus every piece of scenery
// around it. This file owns the *look and the layout*; `Play.ts` turns the
// returned collider boxes into fixed bodies and the marker lists into entities.
//
// Keeping it here means the whole shape of the world is readable in one place,
// and moving a platform never means editing physics code.
import { Group, Object3D, Vector3 } from "three";
import { createMaterials, type Materials } from "./materials.js";
import {
  asScenery,
  bush,
  coin as coinProp,
  fenceRun,
  floatingIsland,
  flower,
  goalFlag,
  grassIsland,
  mushroom,
  pineTree,
  plankBridge,
  snail as snailProp,
  waterfall,
} from "./props.js";
import { makeRandom } from "./shapes.js";

/** A solid box in world space. `y` is the *top* surface — what a player lands on. */
export interface ISurface {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly thickness: number;
}

export interface IEnemySpot {
  readonly kind: "mushroom" | "snail";
  readonly y: number;
  readonly z: number;
  readonly from: number;
  readonly to: number;
  readonly speed: number;
}

export interface ILevel {
  readonly root: Group;
  readonly materials: Materials;
  readonly surfaces: readonly ISurface[];
  readonly coins: readonly Vector3[];
  readonly enemies: readonly IEnemySpot[];
  readonly goal: Vector3;
  readonly spawn: Vector3;
  /** Safe retry points, in route order. A fall returns to the last one passed. */
  readonly checkpoints: readonly Vector3[];
  readonly killPlane: number;
  readonly finishX: number;
  readonly enemyMesh: (kind: IEnemySpot["kind"]) => Group;
  readonly coinMesh: () => Group;
}

const CAP_TOP = 0.31; // grassIsland puts its cap's top face here, in local space.

export function buildLevel(): ILevel {
  const materials = createMaterials();
  const random = makeRandom(20260815);
  const root = new Group();
  root.name = "level";
  const surfaces: ISurface[] = [];

  /** Places a grass island whose walking surface is exactly `y`. */
  const island = (x: number, y: number, width: number, depth: number, height: number): Group => {
    const group = grassIsland(materials, width, depth, height, random);
    group.position.set(x, y - CAP_TOP, 0);
    root.add(group);
    surfaces.push({ x, y, z: 0, width, depth, thickness: height + 0.62 });
    return group;
  };

  /** Scatters the small stuff that keeps a flat green top from reading empty. */
  const dress = (x: number, y: number, width: number, depth: number, density = 1): void => {
    const count = Math.round(width * density);
    for (let index = 0; index < count; index += 1) {
      const px = x + (random() - 0.5) * width * 0.9;
      const pz = (random() - 0.5) * depth * 0.82;
      // Keep the walking lane down the middle clear of props.
      if (Math.abs(pz) < 1.5) continue;
      const roll = random();
      if (roll < 0.34) {
        const tree = pineTree(materials, 0.75 + random() * 0.7);
        tree.position.set(px, y, pz);
        tree.rotation.y = random() * Math.PI;
        root.add(tree);
      } else if (roll < 0.72) {
        const shrub = bush(materials, 0.8 + random() * 0.7, random);
        shrub.position.set(px, y, pz);
        root.add(shrub);
      } else {
        for (let petal = 0; petal < 3; petal += 1) {
          const bloom = flower(materials, random);
          bloom.position.set(px + (random() - 0.5) * 0.7, y, pz + (random() - 0.5) * 0.7);
          root.add(bloom);
        }
      }
    }
  };

  // ── The route ────────────────────────────────────────────────────────────
  island(0, 0, 15, 8, 5.5);
  dress(-1, 0, 13, 8, 1.1);
  const startFence = fenceRun(materials, 6, 5);
  startFence.position.set(-4.5, 0, -3.3);
  root.add(startFence);

  // Gap one, crossed on the plank bridge from the reference's foreground.
  const bridge = plankBridge(materials, 8, 3.6);
  bridge.position.set(11.5, 0, 0);
  root.add(bridge);
  surfaces.push({ x: 11.5, y: 0.11, z: 0, width: 8, depth: 3.6, thickness: 0.4 });

  island(21.5, 0, 12, 8, 6.5);
  dress(22.5, 0, 10, 8, 1);
  const ledgeFence = fenceRun(materials, 7, 6);
  ledgeFence.position.set(21, 0, 3.4);
  root.add(ledgeFence);

  // The raised platform: a jump up, three coins, and the high line back down.
  island(20.5, 1.3, 5.2, 4.4, 1.2);
  const ledgeTree = pineTree(materials, 0.9);
  ledgeTree.position.set(19.2, 1.3, 1.5);
  root.add(ledgeTree);

  // Gap two: 2.5 units of nothing. This is the jump the brief asks for.
  island(35, 0, 10, 8, 7.5);
  dress(35.5, 0, 8, 8, 1);

  // Two stepping stones up to the goal terrace.
  island(41.5, 1.3, 3.6, 3.6, 1.4);
  island(45.4, 2.6, 3.6, 3.6, 1.4);

  island(52, 3.9, 9, 8, 9);
  dress(53.5, 3.9, 7, 8, 0.9);

  // ── Scenery beyond the route ─────────────────────────────────────────────
  for (let index = 0; index < 6; index += 1) {
    const sky = floatingIsland(materials, 5 + random() * 7, random);
    sky.position.set(-30 + random() * 120, 10 + random() * 22, -85 - random() * 70);
    root.add(sky);
    for (let tree = 0; tree < 2; tree += 1) {
      const pine = pineTree(materials, 0.9 + random() * 0.8);
      pine.position.set(
        sky.position.x + (random() - 0.5) * 4,
        sky.position.y + CAP_TOP,
        sky.position.z + (random() - 0.5) * 3,
      );
      root.add(pine);
    }
  }
  // A far ridge behind the route so the horizon is not empty sky. Big and low:
  // it reads as the far side of a valley, which is what puts the route on a
  // cliff rather than on a table.
  for (let index = 0; index < 8; index += 1) {
    const ridge = grassIsland(materials, 26 + random() * 16, 18, 30, random);
    // Staggered heights, some of them above the route's plane. A background at
    // one constant height is a horizon line, and a horizon line reads as a
    // painted backdrop however much is standing on it.
    ridge.position.set(
      -30 + index * 22 + random() * 6,
      (index % 3 === 0 ? 6 : -9) + random() * 10,
      -88 - random() * 34,
    );
    root.add(ridge);
    for (let tree = 0; tree < 5; tree += 1) {
      const pine = pineTree(materials, 2 + random() * 1.4);
      pine.position.set(
        ridge.position.x + (random() - 0.5) * 20,
        ridge.position.y + CAP_TOP,
        ridge.position.z + (random() - 0.5) * 12,
      );
      root.add(pine);
    }
  }
  // Mesas: tall, narrow, far. Three vertical silhouettes are enough to stop the
  // background from reading as one continuous ridge.
  for (let index = 0; index < 4; index += 1) {
    const mesa = grassIsland(materials, 9 + random() * 7, 11, 34, random);
    mesa.position.set(-10 + index * 40 + random() * 12, 8 + random() * 12, -105 - random() * 30);
    root.add(mesa);
    for (let tree = 0; tree < 4; tree += 1) {
      const pine = pineTree(materials, 1.6 + random() * 1.2);
      pine.position.set(
        mesa.position.x + (random() - 0.5) * 7,
        mesa.position.y + CAP_TOP,
        mesa.position.z + (random() - 0.5) * 6,
      );
      root.add(pine);
    }
  }

  // Waterfalls pouring off the two big cliffs, as in the reference.
  for (const [x, z, height] of [
    [27.5, -3.6, 9],
    [46.5, -3.4, 11],
  ] as const) {
    const fall = waterfall(2.2, height);
    fall.position.set(x, -height / 2 - 0.4, z);
    root.add(fall);
  }

  const goal = new Vector3(52.5, 3.9, 0);
  const flag = goalFlag(materials);
  flag.position.copy(goal);
  root.add(flag);

  // ── Collectibles ─────────────────────────────────────────────────────────
  const coins: Vector3[] = [];
  // The readable line across the bridge.
  for (let index = 0; index < 8; index += 1) coins.push(new Vector3(3.2 + index * 1.5, 1.15, 0));
  // Three on the raised platform.
  for (let index = 0; index < 3; index += 1) coins.push(new Vector3(19.4 + index * 1.1, 2.4, 0));
  // An arc over the second gap, which is also the jump's aiming line.
  for (let index = 0; index < 5; index += 1) {
    const t = index / 4;
    coins.push(new Vector3(27.4 + t * 2.8, 1.2 + Math.sin(t * Math.PI) * 1.3, 0));
  }
  // A last run up the stepping stones and onto the goal terrace.
  coins.push(new Vector3(41.5, 2.45, 0));
  coins.push(new Vector3(45.4, 3.75, 0));
  coins.push(new Vector3(49.6, 5.05, 0));

  const enemies: IEnemySpot[] = [
    { kind: "mushroom", y: 0, z: 0.2, from: 18, to: 25, speed: 2.1 },
    // Patrols start clear of the checkpoints below: a hazard standing on a
    // retry point respawns the player straight back into it.
    { kind: "mushroom", y: 0, z: -0.4, from: 33, to: 38.5, speed: 2.6 },
    { kind: "snail", y: 0, z: 1.7, from: 34, to: 37.5, speed: 0.9 },
  ];

  asScenery(root);
  // Big background pieces should not fight the shadow map for the route.
  root.traverse((child: Object3D) => {
    if (child.position.z < -20) child.castShadow = false;
  });

  return {
    root,
    materials,
    surfaces,
    coins,
    enemies,
    goal,
    // Island centres, never edges: a retry point set wherever the player last
    // stood puts them back on the lip of the gap they just fell into, and they
    // fall again on the next frame.
    // y is the capsule centre: 0.54 above the surface, so the player starts
    // standing rather than falling. Spawning airborne silently eats the first
    // jump of a scenario and skews `peakRise` negative on the first frame.
    checkpoints: [
      new Vector3(-4.5, 0.56, 0),
      new Vector3(19, 0.56, 0),
      new Vector3(31, 0.56, 0),
      new Vector3(41.5, 1.86, 0),
      new Vector3(45.4, 3.16, 0),
    ],
    spawn: new Vector3(-4.5, 0.56, 0),
    killPlane: -9,
    finishX: 52,
    coinMesh: () => coinProp(materials),
    enemyMesh: (kind) => (kind === "snail" ? snailProp(materials) : mushroom(materials)),
  };
}
