// Ordinary Three.js. Everything a screenshot shows lives here, in the game.
// The whole backdrop: gradient dome, cloud banks, and the hazy castle-and-
// windmill skyline the reference builds its depth out of.
import {
  BackSide,
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Scene,
  SphereGeometry,
} from "three";
import type { Materials } from "./materials.js";
import { createPine, createTree } from "./props.js";

export const SKY_HIGH = new Color(0x1f7fd0);
export const SKY_LOW = new Color(0xbfe6fb);

const DOME_RADIUS = 700;

function gradientTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Sky gradient needs a 2D canvas context.");
  const gradient = context.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, "#1668b8");
  gradient.addColorStop(0.38, `#${SKY_HIGH.getHexString()}`);
  gradient.addColorStop(0.72, "#6cb8ee");
  gradient.addColorStop(1, `#${SKY_LOW.getHexString()}`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 2, 256);
  return new CanvasTexture(canvas);
}

/** One cumulus: a pile of unlit spheres, flat-bottomed the way clouds read. */
function cloud(scale: number, seed: number): Group {
  const puff = new Group();
  const material = new MeshBasicMaterial({ color: 0xffffff, fog: false });
  const shade = new MeshBasicMaterial({ color: 0xd8e9f7, fog: false });
  const blobs: readonly [number, number, number, number][] = [
    [0, 0.1, 0, 1],
    [1.05, -0.1, 0.2, 0.78],
    [-1.1, -0.14, -0.15, 0.72],
    [0.45, 0.5, -0.1, 0.66],
    [-0.5, 0.42, 0.25, 0.6],
    [1.8, -0.26, -0.1, 0.5],
    [-1.85, -0.28, 0.1, 0.46],
  ];
  for (const [index, [x, y, z, radius]] of blobs.entries()) {
    const blob = new Mesh(
      new SphereGeometry(radius, 12, 10),
      y < 0 && (index + seed) % 2 === 0 ? shade : material,
    );
    blob.position.set(x, y, z);
    blob.scale.set(1, 0.82, 1);
    puff.add(blob);
  }
  puff.scale.setScalar(scale);
  return puff;
}

/** A far-off floating island: grass cap, layered rock, a tree or two. */
function distantIsland(materials: Materials, width: number, treed: boolean): Group {
  const island = new Group();
  const rock = new Mesh(new CylinderGeometry(width * 0.5, width * 0.34, width * 0.5, 7), materials.rock);
  rock.position.y = -width * 0.25;
  const cap = new Mesh(new CylinderGeometry(width * 0.54, width * 0.5, width * 0.16, 7), materials.grass);
  const spike = new Mesh(new ConeGeometry(width * 0.32, width * 1.1, 6), materials.rockDark);
  spike.rotation.x = Math.PI;
  spike.position.y = -width * 0.95;
  island.add(rock, cap, spike);
  if (treed) {
    const tree = createTree(materials, width * 0.16);
    tree.position.set(width * 0.12, width * 0.07, 0);
    const pine = createPine(materials, width * 0.14);
    pine.position.set(-width * 0.2, width * 0.07, -width * 0.1);
    island.add(tree, pine);
  }
  return island;
}

/** The castle on the horizon: keep, towers, conical roofs, a pennant. */
function castle(materials: Materials, scale: number): Group {
  const keep = new Group();
  const body = new Mesh(new BoxGeometry(9, 11, 7), materials.rock);
  body.position.y = 5.5;
  keep.add(body);
  for (const side of [-1, 1]) {
    const tower = new Mesh(new CylinderGeometry(2.1, 2.4, 15, 9), materials.rock);
    tower.position.set(side * 5.4, 7.5, 0.4);
    const roof = new Mesh(new ConeGeometry(2.9, 4.2, 9), materials.mushroomCap);
    roof.position.set(side * 5.4, 17, 0.4);
    keep.add(tower, roof);
  }
  const spire = new Mesh(new ConeGeometry(3.4, 5, 9), materials.mushroomCap);
  spire.position.y = 13.4;
  const pole = new Mesh(new CylinderGeometry(0.12, 0.12, 3.4, 5), materials.woodDark);
  pole.position.y = 17.4;
  const pennant = new Mesh(new BoxGeometry(1.8, 1, 0.06), materials.water);
  pennant.position.set(0.9, 18.4, 0);
  keep.add(spire, pole, pennant);
  keep.scale.setScalar(scale);
  return keep;
}

/** The windmill; its sails are named so the scene can turn them. */
function windmill(materials: Materials, scale: number): Group {
  const mill = new Group();
  const tower = new Mesh(new CylinderGeometry(1.5, 2.4, 8, 9), materials.cream);
  tower.position.y = 4;
  const roof = new Mesh(new ConeGeometry(2, 2.4, 9), materials.mushroomCap);
  roof.position.y = 9.2;
  mill.add(tower, roof);
  const sails = new Group();
  sails.name = "windmill.sails";
  sails.position.set(0, 8, 2.1);
  for (let index = 0; index < 4; index += 1) {
    const blade = new Mesh(new BoxGeometry(0.55, 6.4, 0.16), materials.woodDark);
    blade.position.y = 3.2;
    const arm = new Group();
    arm.rotation.z = (index * Math.PI) / 2;
    arm.add(blade);
    sails.add(arm);
  }
  mill.add(sails);
  mill.scale.setScalar(scale);
  return mill;
}

/** The airship drifting over the skyline; named so the scene can drift it. */
function airship(materials: Materials): Group {
  const ship = new Group();
  ship.name = "airship";
  const balloon = new Mesh(new SphereGeometry(3.4, 16, 12), materials.distant);
  balloon.scale.set(2.3, 1, 1);
  const gondola = new Mesh(new BoxGeometry(3.2, 1.1, 1.4), materials.woodDark);
  gondola.position.y = -3.6;
  const fin = new Mesh(new BoxGeometry(0.2, 2.2, 1.8), materials.mushroomCap);
  fin.position.set(-7.6, 0.6, 0);
  ship.add(balloon, gondola, fin);
  return ship;
}

/** A waterfall sheet with a plume where it lands. */
function waterfall(materials: Materials, width: number, height: number): Group {
  const fall = new Group();
  const sheet = new Mesh(new BoxGeometry(width, height, 0.6), materials.water);
  sheet.position.y = -height / 2;
  fall.add(sheet);
  for (const [index, offset] of [-0.35, 0, 0.4].entries()) {
    const plume = new Mesh(new SphereGeometry(width * (0.5 + index * 0.12), 10, 8), materials.water);
    plume.position.set(width * offset, -height, 0.2);
    plume.scale.set(1, 0.55, 0.7);
    fall.add(plume);
  }
  return fall;
}

/**
 * Sky dome, cloud banks, and the hazy skyline. Distance fog is set here too, so
 * far scenery melts into the horizon instead of ending on a hard silhouette.
 */
export function createSky(scene: Scene, materials: Materials): Group {
  scene.background = SKY_HIGH.clone();
  scene.fog = new Fog(0xaedcf5, 70, 400);

  const sky = new Group();
  const dome = new Mesh(
    new SphereGeometry(DOME_RADIUS, 24, 16),
    new MeshBasicMaterial({ fog: false, map: gradientTexture(), side: BackSide }),
  );
  sky.add(dome);

  // Fixed placements, never Math.random: the same sky every run keeps a
  // screenshot diff meaningful.
  const clouds: readonly [number, number, number, number][] = [
    [-60, 34, -180, 7],
    [26, 46, -220, 9],
    [92, 28, -160, 6],
    [150, 44, -240, 10],
    [-120, 52, -260, 9],
    [200, 36, -190, 7],
    [60, 62, -280, 12],
    [-20, 24, -150, 5],
  ];
  for (const [index, [x, y, z, scale]] of clouds.entries()) {
    const puff = cloud(scale, index);
    puff.position.set(x, y, z);
    sky.add(puff);
  }

  const islands: readonly [number, number, number, number, boolean][] = [
    [-46, 14, -120, 12, true],
    [24, 26, -150, 10, true],
    [78, 10, -110, 9, true],
    [128, 30, -170, 15, true],
    [-96, 8, -100, 10, false],
    [176, 18, -140, 11, true],
  ];
  for (const [x, y, z, width, treed] of islands) {
    const island = distantIsland(materials, width, treed);
    island.position.set(x, y, z);
    sky.add(island);
  }

  const keep = castle(materials, 2.4);
  keep.position.set(2, 2, -190);
  const mill = windmill(materials, 2.2);
  mill.position.set(96, 22, -175);
  const ship = airship(materials);
  ship.position.set(-56, 52, -150);
  sky.add(keep, mill, ship);

  // Waterfalls hang off the far islands' lips, never in open air.
  for (const [x, y, z, width, height] of [
    [-46, 12, -118, 3.4, 26],
    [128, 28, -168, 4, 34],
  ] as const) {
    const fall = waterfall(materials, width, height);
    fall.position.set(x, y, z);
    sky.add(fall);
  }
  return sky;
}

/** The two moving things on the skyline. Called once per frame by the scene. */
export function animateSky(sky: Group, elapsed: number, dt: number): void {
  const sails = sky.getObjectByName("windmill.sails");
  if (sails !== undefined) sails.rotation.z += dt * 0.6;
  const ship = sky.getObjectByName("airship");
  if (ship !== undefined) {
    ship.position.x = -56 + Math.sin(elapsed * 0.03) * 40;
    ship.position.y = 52 + Math.sin(elapsed * 0.11) * 2;
  }
}
