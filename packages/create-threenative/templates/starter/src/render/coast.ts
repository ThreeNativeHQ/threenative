// Generated for you: ordinary Three.js, with every coastal shape and colour game-owned.
// This file composes the starter's scene; it does not add physics or choose a framework look.
import {
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  type Material,
  Mesh,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { block } from "./shapes.js";
import { type IWaveDisplacementSource, createWaterMaterial } from "./water.js";

export interface ICoastalMaterials {
  readonly flower: Material;
  readonly grass: Material;
  readonly grassDark: Material;
  readonly rock: Material;
  readonly sand: Material;
  readonly shoreline: Material;
}
const TUFTS = [
  [-4.25, -1.28, 0.85],
  [-3.65, 1.32, 0.72],
  [-2.5, -1.42, 0.66],
  [-1.05, 1.38, 0.76],
  [0.75, -1.4, 0.74],
  [1.9, 1.35, 0.82],
  [3.15, -1.3, 0.68],
  [4.12, 1.18, 0.78],
] as const;
const REEDS = [-4.45, -0.3, 3.95] as const;

/** Builds the little island, its water, and the repeated vegetation around the play route. */
export function createCoastalScene(
  materials: ICoastalMaterials,
  waves: IWaveDisplacementSource,
  random: () => number,
): Group {
  const coast = new Group();
  coast.name = "coastal-diorama";

  const water = new Mesh(new PlaneGeometry(72, 72, 64, 64), createWaterMaterial(waves));
  water.geometry.rotateX(-Math.PI / 2);
  water.name = "stylized-water";
  // The wave crest reaches above the base plane; leave clearance below the lower goal
  // sandbar so the animated surface never clips through its top.
  water.position.set(0, -0.78, -18);
  water.frustumCulled = false;
  water.receiveShadow = true;
  coast.add(water);

  const beach = new Mesh(new CylinderGeometry(1, 1, 0.18, 32), materials.sand);
  beach.name = "island-beach";
  beach.position.y = -0.06;
  beach.scale.set(5.25, 1, 2.15);
  beach.receiveShadow = true;
  coast.add(beach);

  const grass = new Mesh(new CylinderGeometry(1, 1, 0.09, 32), materials.grass);
  grass.name = "island-grass";
  grass.position.y = 0.02;
  grass.scale.set(4.82, 1, 1.72);
  grass.receiveShadow = true;
  coast.add(grass);

  const shoreRing = new Mesh(new TorusGeometry(1, 0.055, 5, 32), materials.shoreline);
  shoreRing.name = "island-shoreline";
  shoreRing.position.y = 0.025;
  shoreRing.scale.set(5.12, 1, 2.02);
  shoreRing.receiveShadow = true;
  coast.add(shoreRing);

  const path = block(4.8, 0.035, 0.5, materials.sand, {
    castShadow: false,
    radius: 0.12,
  });
  path.name = "island-footpath";
  path.position.set(0.1, 0.065, 0);
  coast.add(path);

  const bladeGeometry = new ConeGeometry(0.075, 0.58, 5);
  for (const [x, z, scale] of TUFTS) addTuft(coast, bladeGeometry, materials, x, z, scale, random);

  const reedGeometry = new ConeGeometry(0.06, 0.82, 5);
  for (const x of REEDS) addReeds(coast, reedGeometry, materials, x, random);

  const rockGeometry = new DodecahedronGeometry(1, 0);
  for (const [x, z, scale] of [
    [-4.45, 0.65, 0.42],
    [-3.95, -0.52, 0.3],
    [4.42, -0.62, 0.4],
    [4.05, 0.72, 0.28],
  ] as const) {
    const rock = new Mesh(rockGeometry, materials.rock);
    rock.position.set(x, 0.12, z);
    rock.scale.set(scale * 1.35, scale, scale * 0.9);
    rock.rotation.set(random() * 0.3, random() * Math.PI, random() * 0.2);
    rock.castShadow = true;
    rock.receiveShadow = true;
    coast.add(rock);
  }

  for (const [x, z] of [
    [-2.95, 1.05],
    [2.55, -1.03],
    [3.45, 0.92],
  ] as const)
    addFlower(coast, materials, x, z);

  addDistantIslands(coast, materials.rock);
  return coast;
}

function addTuft(
  parent: Group,
  geometry: ConeGeometry,
  materials: ICoastalMaterials,
  x: number,
  z: number,
  scale: number,
  random: () => number,
): void {
  const tuft = new Group();
  tuft.position.set(x, 0.09, z);
  const lean = (random() - 0.5) * 0.28;
  for (const [offset, material] of [
    [-0.09, materials.grassDark],
    [0, materials.grass],
    [0.09, materials.grassDark],
  ] as const) {
    const blade = new Mesh(geometry, material);
    blade.position.x = offset;
    blade.rotation.z = lean + offset;
    blade.rotation.y = random() * Math.PI;
    blade.scale.setScalar(scale * (0.9 + random() * 0.18));
    blade.castShadow = true;
    tuft.add(blade);
  }
  parent.add(tuft);
}

function addReeds(
  parent: Group,
  geometry: ConeGeometry,
  materials: ICoastalMaterials,
  x: number,
  random: () => number,
): void {
  const reeds = new Group();
  reeds.position.set(x, 0.1, -1.5);
  for (let index = 0; index < 3; index += 1) {
    const reed = new Mesh(geometry, materials.grassDark);
    reed.position.set((index - 1) * 0.1, index * 0.03, (random() - 0.5) * 0.14);
    reed.rotation.z = (random() - 0.5) * 0.32;
    reed.rotation.y = random() * Math.PI;
    reed.scale.setScalar(0.72 + random() * 0.2);
    reed.castShadow = true;
    reeds.add(reed);
  }
  parent.add(reeds);
}

function addFlower(parent: Group, materials: ICoastalMaterials, x: number, z: number): void {
  const flower = new Group();
  flower.position.set(x, 0.1, z);
  const stem = new Mesh(new CylinderGeometry(0.018, 0.028, 0.34, 6), materials.grassDark);
  stem.position.y = 0.17;
  const head = new Mesh(new SphereGeometry(0.095, 8, 6), materials.flower);
  head.position.y = 0.37;
  stem.castShadow = true;
  head.castShadow = true;
  flower.add(stem, head);
  parent.add(flower);
}

function addDistantIslands(parent: Group, material: Material): void {
  const horizon = new Group();
  horizon.name = "distant-islands";
  const geometry = new DodecahedronGeometry(1, 1);
  for (const [x, z, scale] of [
    [-10, -13, 2.1],
    [-3.7, -16, 1.4],
    [5.5, -14, 1.8],
    [12, -19, 2.7],
  ] as const) {
    const island = new Mesh(geometry, material);
    island.position.set(x, -0.25, z);
    island.scale.set(scale * 1.45, scale * 0.62, scale);
    island.rotation.y = x * 0.13;
    island.castShadow = false;
    island.receiveShadow = false;
    horizon.add(island);
  }
  parent.add(horizon);
}
