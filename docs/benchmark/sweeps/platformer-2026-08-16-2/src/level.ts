import {
  BackSide,
  BoxGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Scene,
  SphereGeometry,
} from "three/webgpu";
import { PALETTE } from "./palette.js";
import {
  makeBridge,
  makeBush,
  makeCloud,
  makeCastle,
  makeCoin,
  makeCrate,
  makeFencePost,
  makeFlower,
  makeGoalFlag,
  makeIsland,
  makeMushroom,
  makePine,
  makeQuestionBlock,
  makeRocks,
  makeRope,
  makeRoundTree,
  makeWaterfall,
  makeWindmill,
  matte,
} from "./props.js";

/** An axis-aligned walkable slab. Collision is resolved against these only. */
export interface IPlatform {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
}

export interface ICoinEntity {
  object: Group;
  x: number;
  y: number;
  z: number;
  collected: boolean;
}

export interface IEnemyEntity {
  object: Group;
  minX: number;
  maxX: number;
  x: number;
  y: number;
  z: number;
  direction: number;
  speed: number;
}

export interface ILevel {
  platforms: IPlatform[];
  coins: ICoinEntity[];
  enemies: IEnemyEntity[];
  goal: { x: number; y: number; z: number; radius: number };
  goalStar: Object3D;
  goalGroup: Group;
  windmillSails: Object3D;
  spawn: { x: number; y: number; z: number };
  killY: number;
}

function skyDome(): Mesh {
  const geometry = new SphereGeometry(160, 32, 24);
  const colors: number[] = [];
  const position = geometry.attributes.position;
  if (!position) throw new Error("sky geometry has no position attribute");
  const color = new Color();
  const smooth = (t: number): number => {
    const clamped = Math.min(1, Math.max(0, t));
    return clamped * clamped * (3 - 2 * clamped);
  };
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index) / 160;
    color.copy(PALETTE.skyHorizon).lerp(PALETTE.skyMid, smooth((y + 0.06) / 0.22));
    color.lerp(PALETTE.skyTop, smooth((y - 0.2) / 0.55));
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false }));
}

function decorateGrass(
  group: Group,
  minX: number,
  maxX: number,
  z: number,
  top: number,
  small = false,
): void {
  let seed = Math.abs(Math.round(minX * 37 + maxX * 11));
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const count = Math.max(4, Math.round((maxX - minX) * 1.1));
  for (let index = 0; index < count; index += 1) {
    const x = minX + 0.7 + random() * (maxX - minX - 1.4);
    const roll = random();
    let prop: Group;
    if (small) {
      prop =
        roll < 0.55
          ? makeFlower(random() > 0.5 ? PALETTE.blossom : new Color("#ffd75e"))
          : makeBush(0.5 + random() * 0.3);
    } else if (roll < 0.34) prop = makeBush(0.8 + random() * 0.6);
    else if (roll < 0.6) prop = makeFlower(random() > 0.5 ? PALETTE.blossom : new Color("#ffd75e"));
    else if (roll < 0.82) prop = makePine(0.55 + random() * 0.4);
    else prop = makeRoundTree(0.45 + random() * 0.3);
    prop.position.set(x, top, z + (random() - 0.5) * 1.1);
    prop.rotation.y = random() * Math.PI * 2;
    group.add(prop);
  }
}

/** Builds the whole playable level plus the background diorama. */
export function buildLevel(scene: Scene): ILevel {
  scene.background = new Color("#4fa9ec");
  scene.fog = new Fog(new Color("#a9d6f2"), 62, 190);
  scene.add(skyDome());

  const sun = new DirectionalLight(new Color("#fff0cc"), 3.3);
  sun.position.set(-14, 20, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 80;
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -14;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  const hemi = new HemisphereLight(new Color("#a8d9fb"), new Color("#6b8f3c"), 0.95);
  scene.add(hemi);

  const world = new Group();
  scene.add(world);

  const platforms: IPlatform[] = [];
  const addSlab = (
    minX: number,
    maxX: number,
    top: number,
    depth: number,
    z = 0,
    skirt = 4.5,
  ): Group => {
    const island = makeIsland(maxX - minX, depth, skirt);
    island.position.set((minX + maxX) / 2, top, z);
    world.add(island);
    platforms.push({ minX, maxX, minZ: z - depth / 2, maxZ: z + depth / 2, top });
    return island;
  };

  // --- the run: bridge -> meadow -> gap with a stepping stone -> raised ledge ---
  const bridge = makeBridge(7.2, 4.4);
  bridge.position.set(-6.0, 0, 0);
  world.add(bridge);
  platforms.push({ minX: -9.6, maxX: -2.4, minZ: -2.2, maxZ: 2.2, top: 0 });

  addSlab(-2.6, 14.0, 0, 5.2, 0, 6.5);
  decorateGrass(world, -2.0, 13.5, 2.15, 0, true);
  decorateGrass(world, -2.0, 13.5, -2.05, 0);

  addSlab(14.9, 18.3, 1.15, 3.4, 0, 3.0);
  const stoneTuft = makeBush(0.8);
  stoneTuft.position.set(16.4, 1.15, -0.9);
  world.add(stoneTuft);

  addSlab(19.0, 29.0, 2.3, 5.0, 0, 7.5);
  decorateGrass(world, 19.5, 28.5, 2.05, 2.3, true);
  decorateGrass(world, 19.5, 26.5, -1.95, 2.3);

  // fence line along the back edge of the meadow, reference-style
  for (let x = -1.5; x <= 13.5; x += 2.4) {
    const post = makeFencePost(1.05);
    post.position.set(x, 0, -2.45);
    world.add(post);
    if (x + 2.4 <= 13.5) {
      const rope = makeRope(2.4, 0.2);
      rope.position.set(x + 1.2, 0.85, -2.45);
      world.add(rope);
      const rope2 = makeRope(2.4, 0.16);
      rope2.position.set(x + 1.2, 0.52, -2.45);
      world.add(rope2);
    }
  }

  // Dressing lives on the far side of the running lane: anything tall on the near side
  // sits between the chase camera and the player and eats the shot.
  const dressing: Array<[string, number, number, number, number]> = [
    ["crate", 1.6, 0, -2.0, 0.9],
    ["crate", 2.5, 0, -2.0, 0.9],
    ["crate", 2.05, 0.9, -2.0, 0.9],
    ["rocks", 6.4, 0, -2.05, 1.2],
    ["bush", 8.2, 0, -2.05, 1.3],
    ["flower", 9.4, 0, 2.2, 1.0],
    ["flower", 5.2, 0, 2.25, 1.0],
    ["flower", 12.2, 0, 2.1, 1.0],
    ["rocks", 3.4, 0, 2.2, 0.8],
    ["crate", 11.6, 0, -2.0, 0.85],
    ["rocks", 12.9, 0, -1.95, 1.0],
    ["question", 7.0, 1.9, -1.85, 0.95],
    ["question", 21.8, 4.2, -1.8, 0.95],
    ["crate", 25.6, 2.3, -1.85, 0.9],
    ["crate", 26.5, 2.3, -1.85, 0.9],
    ["rocks", 20.4, 2.3, -1.8, 1.1],
    ["bush", 23.4, 2.3, -2.0, 1.2],
    ["tree", 4.2, 0, -2.1, 0.85],
    ["tree", 24.0, 2.3, -2.05, 0.8],
    ["pine", 0.4, 0, -2.05, 0.9],
    ["pine", 19.8, 2.3, -2.05, 0.85],
  ];

  for (const [kind, x, y, z, scale] of dressing) {
    let prop: Group;
    if (kind === "crate") prop = makeCrate(scale);
    else if (kind === "question") prop = makeQuestionBlock(scale);
    else if (kind === "rocks") prop = makeRocks(scale);
    else if (kind === "bush") prop = makeBush(scale);
    else if (kind === "tree") prop = makeRoundTree(scale);
    else if (kind === "pine") prop = makePine(scale);
    else prop = makeFlower(PALETTE.blossom);
    prop.position.set(x, y, z);
    prop.rotation.y = (x % 3) * 0.7;
    world.add(prop);
  }

  // --- collectibles: a visible line of coins leading over the gap ---
  const coinSpots: Array<[number, number]> = [
    [0.5, 1.1],
    [2.3, 1.1],
    [4.1, 1.1],
    [5.9, 1.1],
    [7.7, 1.1],
    [9.5, 1.1],
    [11.3, 1.1],
    [13.1, 1.3],
    [15.0, 2.3],
    [16.6, 2.9],
    [18.2, 3.1],
    [20.2, 3.5],
    [22.4, 3.5],
    [24.6, 3.5],
  ];
  const coins: ICoinEntity[] = coinSpots.map(([x, y]) => {
    const object = makeCoin();
    object.position.set(x, y, 0.2);
    world.add(object);
    return { object, x, y, z: 0.2, collected: false };
  });

  // --- hazards ---
  const enemySpecs: Array<{ minX: number; maxX: number; y: number; z: number; speed: number }> = [
    { minX: 4.4, maxX: 9.6, y: 0, z: -1.45, speed: 2.1 },
    { minX: 10.2, maxX: 13.4, y: 0, z: 1.55, speed: 1.6 },
    { minX: 20.0, maxX: 26.5, y: 2.3, z: -1.45, speed: 2.4 },
  ];
  const enemies: IEnemyEntity[] = enemySpecs.map((spec) => {
    const object = makeMushroom();
    object.position.set(spec.minX, spec.y, spec.z);
    world.add(object);
    return {
      object,
      minX: spec.minX,
      maxX: spec.maxX,
      x: spec.minX,
      y: spec.y,
      z: spec.z,
      direction: 1,
      speed: spec.speed,
    };
  });

  // --- goal ---
  const goal = makeGoalFlag();
  goal.group.position.set(27.4, 2.3, 0.2);
  world.add(goal.group);

  // --- background diorama: floating islands, cliffs, waterfalls, clouds ---
  const backdrops: Array<[number, number, number, number, number]> = [
    [-26, 9.5, -54, 12, 8],
    [-6, 16.0, -74, 16, 9],
    [16, 7.0, -48, 11, 7],
    [34, 14.5, -66, 15, 9],
    [54, 6.0, -56, 12, 8],
    [-48, 4.0, -44, 11, 7],
    [4, 24.0, -104, 22, 12],
    [-34, 20.0, -96, 18, 10],
    [40, 27.0, -118, 26, 14],
    [-62, 12.0, -86, 16, 9],
    [70, 18.0, -92, 18, 10],
    [-14, 30.0, -140, 30, 16],
    // mid-distance islands ahead of the run, so the sky the camera faces is not empty
    [44, 2.5, -20, 10, 7],
    [66, 8.0, -34, 13, 8],
    [30, -3.0, -17, 9, 6],
    [-28, -2.0, -16, 9, 6],
    [88, 14.0, -50, 15, 9],
  ];
  for (const [x, y, z, width, depth] of backdrops) {
    const island = makeIsland(width, depth, 9);
    island.position.set(x, y, z);
    world.add(island);
    const trees = Math.max(2, Math.round(width / 3));
    for (let index = 0; index < trees; index += 1) {
      const tree = index % 2 === 0 ? makePine(1.1 + (index % 3) * 0.25) : makeRoundTree(0.9);
      tree.position.set(
        x - width / 2 + 1 + (index * (width - 2)) / Math.max(1, trees - 1),
        y,
        z + (index % 2 === 0 ? -1.2 : 1.4),
      );
      world.add(tree);
    }
    if (width > 12) {
      const fall = makeWaterfall(width * 0.22, 13);
      fall.position.set(x + width * 0.22, y - 7, z + depth / 2 + 0.25);
      world.add(fall);
      const crest = new Mesh(new SphereGeometry(width * 0.12, 12, 10), matte(new Color("#e6f8ff"), 0.9));
      crest.position.set(x + width * 0.22, y - 0.5, z + depth / 2 + 0.3);
      crest.scale.set(1.1, 0.4, 0.6);
      world.add(crest);
      const foam = new Mesh(new SphereGeometry(width * 0.16, 12, 10), matte(new Color("#dff5ff"), 0.9));
      foam.position.set(x + width * 0.22, y - 13.4, z + depth / 2 + 0.25);
      foam.scale.set(1.4, 0.5, 1);
      world.add(foam);
    }
  }

  // mid-distance landmarks: keep on one island, windmill on another
  const castle = makeCastle(1.25);
  castle.position.set(16, 7.0, -48);
  castle.rotation.y = -0.35;
  world.add(castle);

  const windmill = makeWindmill(1.1);
  windmill.group.position.set(38, 14.5, -66);
  windmill.group.rotation.y = 0.5;
  world.add(windmill.group);

  const farCastle = makeCastle(1.6);
  farCastle.position.set(-8, 16.0, -74);
  farCastle.rotation.y = 0.4;
  world.add(farCastle);

  const cloudSpots: Array<[number, number, number, number]> = [
    [-34, 26, -72, 4.0],
    [-4, 34, -96, 5.4],
    [26, 28, -78, 4.4],
    [58, 33, -104, 6.0],
    [-58, 22, -62, 3.6],
    [12, 42, -128, 7.5],
    [-28, 38, -132, 6.4],
    [78, 24, -70, 4.2],
    // low banks that sit on the horizon and hide the empty pale band
    [-20, 6.5, -150, 8.0],
    [24, 5.0, -160, 9.0],
    [64, 8.0, -172, 8.5],
    [-70, 7.0, -166, 7.5],
  ];
  for (const [x, y, z, scale] of cloudSpots) {
    const cloud = makeCloud(scale);
    cloud.position.set(x, y, z);
    world.add(cloud);
  }

  return {
    platforms,
    coins,
    enemies,
    goal: { x: 27.4, y: 2.3, z: 0.2, radius: 1.5 },
    goalStar: goal.star,
    goalGroup: goal.group,
    windmillSails: windmill.sails,
    spawn: { x: -6.0, y: 0.2, z: 0 },
    killY: -9,
  };
}
