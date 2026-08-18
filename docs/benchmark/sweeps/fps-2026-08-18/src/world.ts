import * as THREE from "three";

export const ARENA_HALF = 17;
export const WALL_HEIGHT = 6;

export interface Blocker {
  /** axis-aligned footprint in world XZ */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** walkable top height; Infinity for walls */
  top: number;
}

export interface Ramp {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** height at maxZ edge */
  highZ: number;
  low: number;
  high: number;
}

export interface RangeTarget {
  pivot: THREE.Group;
  plate: THREE.Mesh;
  value: number;
  down: boolean;
  restore: number;
  swing: number;
  centre: THREE.Vector3;
}

export interface World {
  /** the flat salmon face a target wears while it is standing */
  plateMaterial: THREE.Material;
  targets: RangeTarget[];
  plates: THREE.Mesh[];
  blockers: Blocker[];
  ramps: Ramp[];
  /** meshes a bullet cannot pass through */
  occluders: THREE.Object3D[];
  sun: THREE.DirectionalLight;
}

const concrete = new THREE.MeshStandardMaterial({ color: 0x9a9c9d, roughness: 0.95, metalness: 0 });
const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x2f353e, roughness: 0.9, metalness: 0.05 });
const darkBlock = new THREE.MeshStandardMaterial({ color: 0x21262d, roughness: 0.8, metalness: 0.05 });
const steel = new THREE.MeshStandardMaterial({ color: 0x8d9094, roughness: 0.6, metalness: 0.3 });

function addBox(
  scene: THREE.Scene,
  world: World,
  size: [number, number, number],
  at: [number, number, number],
  material: THREE.Material,
  walkable: boolean,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(at[0], at[1] + size[1] / 2, at[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  world.blockers.push({
    minX: at[0] - size[0] / 2,
    maxX: at[0] + size[0] / 2,
    minZ: at[2] - size[2] / 2,
    maxZ: at[2] + size[2] / 2,
    top: walkable ? at[1] + size[1] : Number.POSITIVE_INFINITY,
  });
  world.occluders.push(mesh);
  return mesh;
}

const TARGET_LAYOUT: Array<{ at: [number, number, number]; size: [number, number]; value: number }> = [
  { at: [0.15, 1.72, -8.2], size: [0.62, 0.92], value: 150 },
  { at: [-8.6, 2.28, -1.2], size: [0.78, 1.06], value: 100 },
  { at: [2.75, 2.5, -15.4], size: [0.36, 0.5], value: 300 },
  { at: [8.6, 4.3, -12.6], size: [0.6, 0.9], value: 250 },
  { at: [-4.4, 1.45, -12.4], size: [0.5, 0.72], value: 150 },
  { at: [11.6, 1.6, -3.4], size: [0.55, 0.8], value: 100 },
  { at: [-11.4, 2.35, -14.2], size: [0.52, 0.76], value: 250 },
  { at: [5.6, 1.5, -4.6], size: [0.48, 0.7], value: 100 },
];

export function buildWorld(scene: THREE.Scene, floorMap: THREE.Texture, propMap: THREE.Texture): World {
  const world: World = {
    plateMaterial: new THREE.MeshBasicMaterial({ color: 0xff4f42, side: THREE.DoubleSide }),
    targets: [],
    plates: [],
    blockers: [],
    ramps: [],
    occluders: [],
    sun: new THREE.DirectionalLight(0xfff4e2, 3.7),
  };

  // ---- lighting: one high sun throwing long soft shadows, plus a cool sky fill.
  const sun = world.sun;
  sun.position.set(-26, 30, 19);
  sun.target.position.set(1, 0, -3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun);
  scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(0xbcd6f2, 0x8c8e8e, 0.9));

  // ---- floor: the shipped tiling concrete surface, ~1.9 m to a slab
  floorMap.wrapS = THREE.RepeatWrapping;
  floorMap.wrapT = THREE.RepeatWrapping;
  floorMap.repeat.set(3.4, 3.4);
  floorMap.anisotropy = 8;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
    new THREE.MeshStandardMaterial({ map: floorMap, color: 0xdcdedd, roughness: 0.94, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  world.occluders.push(floor);

  // ---- white lane stripes down the range plus the firing line
  const stripe = new THREE.MeshBasicMaterial({ color: 0xf4f6f6 });
  const laneStripe = (x: number) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.2, ARENA_HALF * 2 - 0.4), stripe);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.012, 0);
    scene.add(mesh);
  };
  laneStripe(-5.6);
  laneStripe(5.6);
  for (const z of [11.2, 2.0]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2 - 0.4, 0.2), stripe);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.012, z);
    scene.add(line);
  }

  // ---- perimeter walls
  const span = ARENA_HALF * 2;
  const wallSpecs: Array<[number, number, number, number]> = [
    [0, -ARENA_HALF - 0.25, span + 1, 0.5],
    [0, ARENA_HALF + 0.25, span + 1, 0.5],
    [-ARENA_HALF - 0.25, 0, 0.5, span + 1],
    [ARENA_HALF + 0.25, 0, 0.5, span + 1],
  ];
  for (const [x, z, sx, sz] of wallSpecs) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, WALL_HEIGHT, sz), wallMaterial);
    mesh.position.set(x, WALL_HEIGHT / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    world.occluders.push(mesh);
  }

  // ---- round barrier, left of the range
  propMap.wrapS = THREE.RepeatWrapping;
  propMap.wrapT = THREE.RepeatWrapping;
  propMap.repeat.set(4, 1);
  propMap.anisotropy = 8;
  const barrier = new THREE.Mesh(
    new THREE.CylinderGeometry(3.0, 3.0, 1.45, 44, 1, true),
    new THREE.MeshStandardMaterial({ map: propMap, color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide }),
  );
  barrier.position.set(-10.2, 0.725, 0.2);
  barrier.castShadow = true;
  barrier.receiveShadow = true;
  scene.add(barrier);
  world.occluders.push(barrier);
  world.blockers.push({ minX: -13.2, maxX: -7.2, minZ: -2.8, maxZ: 3.2, top: Number.POSITIVE_INFINITY });

  // ---- concrete barricades down the centre
  addBox(scene, world, [4.8, 1.58, 1.6], [0.1, 0, -5.0], concrete, false);
  addBox(scene, world, [3.4, 1.35, 1.3], [3.9, 0, -9.4], concrete, false);
  addBox(scene, world, [2.4, 1.0, 1.2], [-6.6, 0, -9.0], concrete, false);

  // ---- two dark lockers
  addBox(scene, world, [1.35, 2.3, 0.9], [6.7, 0, -10.6], darkBlock, false);
  addBox(scene, world, [1.35, 2.3, 0.9], [8.25, 0, -10.6], darkBlock, false);

  // ---- raised walkway on dark pillars with a pale deck edge, right of the range
  const deckY = 3.0;
  addBox(scene, world, [9.0, 0.35, 4.6], [9.5, deckY, -13.4], concrete, true);
  for (const px of [5.6, 9.5, 13.4]) {
    for (const pz of [-11.6, -15.2]) {
      addBox(scene, world, [0.5, deckY, 0.5], [px, 0, pz], darkBlock, false);
    }
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(9.0, 0.09, 0.12), new THREE.MeshStandardMaterial({ color: 0xf0f2f2, roughness: 0.8 }));
  rail.position.set(9.5, deckY + 0.42, -11.15);
  rail.castShadow = true;
  scene.add(rail);

  // ---- ramp up to the walkway
  const rampLength = 5.0;
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.24, rampLength), concrete);
  const rise = Math.atan2(deckY + 0.35, rampLength);
  ramp.position.set(9.5, (deckY + 0.35) / 2, -11.1 + rampLength / 2 - 0.1);
  ramp.rotation.x = -rise;
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  scene.add(ramp);
  world.occluders.push(ramp);
  world.ramps.push({
    minX: 8.2,
    maxX: 10.8,
    minZ: -11.2,
    maxZ: -11.2 + rampLength,
    highZ: -11.2,
    low: 0,
    high: deckY + 0.35,
  });

  // ---- far right block
  addBox(scene, world, [4.2, 3.2, 4.2], [14.2, 0, -5.6], concrete, false);
  addBox(scene, world, [3.0, 2.2, 2.0], [-14.0, 0, -14.4], darkBlock, false);

  // ---- targets
  // flat salmon, matching reference.png: the plates read the same tone whichever way the
  // sun is behind them
  const plateMaterial = world.plateMaterial;
  for (const spec of TARGET_LAYOUT) {
    const [x, y, z] = spec.at;
    const [w, h] = spec.size;
    const stand = new THREE.Group();
    stand.position.set(x, 0, z);
    scene.add(stand);

    const legY = y - h / 2;
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, legY, 0.07), steel);
      leg.position.set((side * w) / 2, legY / 2, 0);
      leg.castShadow = true;
      stand.add(leg);
    }
    const crossbar = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, 0.07, 0.07), steel);
    crossbar.position.set(0, legY, 0);
    crossbar.castShadow = true;
    stand.add(crossbar);

    const pivot = new THREE.Group();
    pivot.position.set(0, legY, 0.02);
    stand.add(pivot);

    const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, h), plateMaterial);
    plate.position.set(0, h / 2, 0);
    plate.castShadow = true;
    pivot.add(plate);

    const target: RangeTarget = {
      pivot,
      plate,
      value: spec.value,
      down: false,
      restore: 0,
      swing: 0,
      centre: new THREE.Vector3(x, y, z),
    };
    plate.userData.target = target;
    world.targets.push(target);
    world.plates.push(plate);
  }

  return world;
}

/** Advance the knock-down / swing-back animation of every target. */
export function stepTargets(world: World, dt: number): void {
  for (const target of world.targets) {
    if (target.down) {
      target.restore -= dt;
      target.swing = Math.min(1, target.swing + dt / 0.16);
      if (target.restore <= 0) target.down = false;
    } else {
      target.swing = Math.max(0, target.swing - dt / 0.22);
      if (target.plate.material !== world.plateMaterial) target.plate.material = world.plateMaterial;
    }
    target.pivot.rotation.x = -target.swing * 1.75;
  }
}

export function resetTargets(world: World): void {
  for (const target of world.targets) {
    target.down = false;
    target.restore = 0;
    target.swing = 0;
    target.pivot.rotation.x = 0;
  }
}

/** Ground height under a point: floor, a walkable top, or the ramp surface. */
export function groundHeight(world: World, x: number, z: number, current: number): number {
  let height = 0;
  for (const ramp of world.ramps) {
    if (x < ramp.minX || x > ramp.maxX || z < ramp.minZ || z > ramp.maxZ) continue;
    const t = (ramp.maxZ - z) / (ramp.maxZ - ramp.minZ);
    height = Math.max(height, ramp.low + (ramp.high - ramp.low) * t);
  }
  for (const blocker of world.blockers) {
    if (!Number.isFinite(blocker.top)) continue;
    if (x < blocker.minX || x > blocker.maxX || z < blocker.minZ || z > blocker.maxZ) continue;
    if (blocker.top <= current + 0.45) height = Math.max(height, blocker.top);
  }
  return height;
}

/** Push a circle of `radius` out of every blocker it overlaps and off the arena walls. */
export function resolveCollisions(
  world: World,
  position: THREE.Vector3,
  radius: number,
  feetY: number,
): void {
  const limit = ARENA_HALF - radius - 0.5;
  position.x = THREE.MathUtils.clamp(position.x, -limit, limit);
  position.z = THREE.MathUtils.clamp(position.z, -limit, limit);

  for (const blocker of world.blockers) {
    if (Number.isFinite(blocker.top) && blocker.top <= feetY + 0.05) continue;
    const nearestX = THREE.MathUtils.clamp(position.x, blocker.minX, blocker.maxX);
    const nearestZ = THREE.MathUtils.clamp(position.z, blocker.minZ, blocker.maxZ);
    const dx = position.x - nearestX;
    const dz = position.z - nearestZ;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq >= radius * radius) continue;
    if (distanceSq > 1e-6) {
      const distance = Math.sqrt(distanceSq);
      position.x = nearestX + (dx / distance) * radius;
      position.z = nearestZ + (dz / distance) * radius;
    } else {
      // centre inside the box: eject along the shallowest axis
      const toLeft = Math.abs(position.x - blocker.minX);
      const toRight = Math.abs(blocker.maxX - position.x);
      const toBack = Math.abs(position.z - blocker.minZ);
      const toFront = Math.abs(blocker.maxZ - position.z);
      const smallest = Math.min(toLeft, toRight, toBack, toFront);
      if (smallest === toLeft) position.x = blocker.minX - radius;
      else if (smallest === toRight) position.x = blocker.maxX + radius;
      else if (smallest === toBack) position.z = blocker.minZ - radius;
      else position.z = blocker.maxZ + radius;
    }
  }
}
