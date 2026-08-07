import type { Ctx } from "@threenative/core";
import { CollisionShape3D, type PhysicsContext, RigidBody3D } from "@threenative/physics";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Vector3,
} from "three";
import { ball, block, ring, spike, tube } from "./render/shapes.js";
import type { GameState } from "./state.js";

type GameCtx = Ctx<GameState, PhysicsContext>;
type Materials = ReturnType<typeof import("./render/materials.js").createMaterials>;

export interface Level {
  readonly bodies: RigidBody3D[];
  readonly goal: Group;
  readonly goalPosition: { x: number; y: number; z: number };
  readonly hazard: Group;
  readonly hazardPosition: { x: number; y: number; z: number };
  readonly root: Group;
  readonly spawn: { x: number; y: number; z: number };
  dispose(): void;
}

const invisibleMaterial = new MeshBasicMaterial({ visible: false });

function addTo(root: Group, object: Object3D, x = 0, y = 0, z = 0): Object3D {
  object.position.set(x, y, z);
  root.add(object);
  return object;
}

function addStaticBox(
  ctx: GameCtx,
  root: Group,
  bodies: RigidBody3D[],
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
): RigidBody3D {
  const collisionMesh = new Mesh(new BoxGeometry(width, height, depth), invisibleMaterial);
  addTo(root, collisionMesh, x, y, z);
  const body = new RigidBody3D({
    object: collisionMesh,
    physics: ctx.physics,
    shape: CollisionShape3D.box(width, height, depth),
    type: "fixed",
  });
  bodies.push(body);
  return body;
}

function addRouteConnector(
  ctx: GameCtx,
  root: Group,
  bodies: RigidBody3D[],
  fromZ: number,
  toZ: number,
  top: number,
): void {
  const thickness = 0.2;
  addStaticBox(
    ctx,
    root,
    bodies,
    0,
    top - thickness / 2,
    (fromZ + toZ) / 2,
    2.2,
    thickness,
    Math.abs(toZ - fromZ),
  );
}

function addFlower(root: Group, materials: Materials, x: number, y: number, z: number): void {
  const stem = tube(0.025, 0.035, 0.26, materials.grassDark, { castShadow: false });
  addTo(root, stem, x, y + 0.13, z);
  const petalMaterial = (Math.round((x + z) * 10) & 1) === 0 ? materials.flowerPink : materials.flowerWhite;
  const flower = ball(0.105, petalMaterial, { castShadow: false, receiveShadow: false, segments: 10 });
  addTo(root, flower, x, y + 0.3, z);
}

function addGrassTuft(root: Group, materials: Materials, x: number, y: number, z: number): void {
  for (let index = 0; index < 3; index += 1) {
    const blade = spike(0.055, 0.34, index === 1 ? materials.grassLight : materials.grassDark, {
      castShadow: false,
      receiveShadow: false,
      segments: 7,
    });
    blade.rotation.z = (index - 1) * 0.26;
    addTo(root, blade, x + (index - 1) * 0.08, y + 0.17, z);
  }
}

function addTree(root: Group, materials: Materials, x: number, y: number, z: number, scale = 1): void {
  const trunk = tube(0.16 * scale, 0.23 * scale, 1.35 * scale, materials.trunk, { segments: 10 });
  addTo(root, trunk, x, y + 0.68 * scale, z);
  const trunkBand = tube(0.2 * scale, 0.2 * scale, 0.12 * scale, materials.grassDark, { segments: 10 });
  addTo(root, trunkBand, x, y + 0.45 * scale, z);
  const canopy = new Group();
  addTo(root, canopy, x, y + 1.48 * scale, z);
  const lower = ball(0.75 * scale, materials.leaf, { segments: 14 });
  const upper = ball(0.62 * scale, materials.leafLight, { segments: 14 });
  const side = ball(0.5 * scale, materials.leaf, { segments: 14 });
  lower.scale.set(1.22, 0.78, 1.04);
  upper.position.set(0.1 * scale, 0.3 * scale, -0.05 * scale);
  upper.scale.set(1.12, 0.86, 0.94);
  side.position.set(-0.5 * scale, 0.05 * scale, 0.08 * scale);
  side.scale.set(0.8, 0.76, 0.88);
  canopy.add(lower, upper, side);
}

function addCloud(root: Group, materials: Materials, x: number, y: number, z: number, scale = 1): void {
  const cloud = new Group();
  addTo(root, cloud, x, y, z);
  const puffs = [
    [-1.05, 0, 0, 0.76],
    [-0.42, 0.2, -0.04, 1.0],
    [0.36, 0.08, 0.02, 0.88],
    [0.94, -0.02, 0.02, 0.6],
  ] as const;
  for (const [px, py, pz, radius] of puffs) {
    const puff = ball(radius * scale, materials.cloud, {
      castShadow: false,
      receiveShadow: false,
      segments: 14,
    });
    addTo(cloud, puff, px * scale, py * scale, pz * scale);
  }
}

function addFloatingIsland(
  root: Group,
  materials: Materials,
  x: number,
  y: number,
  z: number,
  scale: number,
): void {
  const rock = block(3.1 * scale, 0.8 * scale, 2.3 * scale, materials.dirtDark, { radius: 0.3 });
  addTo(root, rock, x, y, z);
  rock.scale.y = 1.5;
  const cap = block(3.3 * scale, 0.22 * scale, 2.5 * scale, materials.grass, { radius: 0.24 });
  addTo(root, cap, x, y + 0.68 * scale, z);
  const dangling = [
    [-0.8, -0.76, 0.22],
    [0.1, -0.92, -0.12],
    [0.72, -0.7, 0.1],
  ] as const;
  for (const [dx, dy, dz] of dangling) {
    const shard = spike(0.25 * scale, 0.85 * scale, materials.stone, {
      castShadow: true,
      receiveShadow: true,
      segments: 7,
    });
    shard.rotation.x = Math.PI;
    addTo(root, shard, x + dx * scale, y + dy * scale, z + dz * scale);
  }
}

function addPlatform(
  ctx: GameCtx,
  root: Group,
  bodies: RigidBody3D[],
  materials: Materials,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
): number {
  const capHeight = 0.22;
  addStaticBox(ctx, root, bodies, x, y + capHeight / 2, z, width, height + capHeight, depth);
  const base = block(width, height, depth, materials.dirt, { radius: 0.22 });
  addTo(root, base, x, y, z);
  const cap = block(width + 0.12, capHeight, depth + 0.12, materials.grass, { radius: 0.14 });
  const top = y + height / 2 + capHeight;
  addTo(root, cap, x, top - capHeight / 2, z);
  const edge = block(width + 0.06, 0.12, depth + 0.06, materials.grassLight, { radius: 0.06 });
  addTo(root, edge, x, top - 0.04, z);

  addGrassTuft(root, materials, x - width * 0.31, top, z - depth * 0.24);
  addGrassTuft(root, materials, x + width * 0.28, top, z + depth * 0.2);
  addFlower(root, materials, x - width * 0.16, top, z + depth * 0.18);
  addFlower(root, materials, x + width * 0.33, top, z - depth * 0.22);
  return top;
}

function addBridge(
  ctx: GameCtx,
  root: Group,
  bodies: RigidBody3D[],
  materials: Materials,
): number {
  const width = 6.2;
  const depth = 7.3;
  addStaticBox(ctx, root, bodies, 0, 0.21, 1, width, 0.7, depth);
  const under = block(width, 0.38, depth, materials.woodDark, { radius: 0.16 });
  addTo(root, under, 0, 0.1, 1);
  const plankMaterials = [materials.wood, materials.woodLight, materials.wood, materials.woodDark];
  for (let index = 0; index < 8; index += 1) {
    const plankMaterial = plankMaterials[index % plankMaterials.length] ?? materials.wood;
    const plank = block(5.84 + (index % 2) * 0.08, 0.2, 0.84, plankMaterial, {
      radius: 0.08,
    });
    plank.rotation.y = (index % 3 === 0 ? -1 : 1) * 0.012;
    addTo(root, plank, (index % 2 === 0 ? -0.04 : 0.05), 0.46, 3.55 - index * 0.92);
    const nail = ball(0.045, materials.goal, { segments: 8, castShadow: false, receiveShadow: false });
    addTo(root, nail, -2.35, 0.59, 3.55 - index * 0.92);
    const nailTwo = nail.clone();
    addTo(root, nailTwo, 2.35, 0.59, 3.55 - index * 0.92);
  }
  for (const z of [3.9, -1.9]) {
    for (const x of [-3.18, 3.18]) {
      const post = tube(0.22, 0.27, 1.55, materials.trunkLight, { segments: 12 });
      addTo(root, post, x, 0.78, z);
      const cap = ball(0.25, materials.grassLight, { segments: 10 });
      addTo(root, cap, x, 1.58, z);
    }
  }
  return 0.56;
}

function addGoal(root: Group, materials: Materials, top: number): Group {
  const goal = new Group();
  goal.name = "star-gate";
  root.add(goal);
  const poleLeft = tube(0.14, 0.2, 2.6, materials.goal, { segments: 14 });
  const poleRight = poleLeft.clone();
  const crossbar = block(2.3, 0.24, 0.24, materials.goal, { radius: 0.08 });
  addTo(goal, poleLeft, -0.95, top + 1.3, 0);
  addTo(goal, poleRight, 0.95, top + 1.3, 0);
  addTo(goal, crossbar, 0, top + 2.55, 0);
  const halo = ring(0.74, 0.14, materials.goal, { segments: 24 });
  halo.rotation.x = Math.PI / 2;
  addTo(goal, halo, 0, top + 1.42, 0);
  const core = ball(0.34, materials.coinBright, { segments: 16 });
  addTo(goal, core, 0, top + 1.42, -0.08);
  const flag = block(1.12, 0.62, 0.08, materials.hazard, { radius: 0.1 });
  addTo(goal, flag, 0.42, top + 2.23, 0);
  const flagDot = ball(0.1, materials.goal, { segments: 10 });
  addTo(goal, flagDot, 0.55, top + 2.23, -0.06);
  return goal;
}

function addHazard(root: Group, materials: Materials, x: number, top: number, z: number): Group {
  const hazard = new Group();
  hazard.name = "red-shell-hazard";
  addTo(root, hazard, x, top, z);
  const body = block(1.02, 0.54, 0.82, materials.hazardDark, { radius: 0.22 });
  addTo(hazard, body, 0, 0.28, 0);
  const shell = ball(0.58, materials.hazard, { segments: 16 });
  shell.scale.set(1, 1, 0.65);
  addTo(hazard, shell, 0.15, 0.78, 0.12);
  const shellSpiral = ring(0.2, 0.045, materials.goal, { segments: 16 });
  shellSpiral.rotation.x = Math.PI / 2;
  addTo(hazard, shellSpiral, 0.15, 0.8, -0.25);
  for (const xOffset of [-0.23, 0.23]) {
    const eyeStem = tube(0.05, 0.05, 0.28, materials.playerCream, { segments: 8 });
    addTo(hazard, eyeStem, xOffset, 0.7, -0.34);
    const eye = ball(0.1, materials.eye, { segments: 10 });
    addTo(hazard, eye, xOffset, 0.86, -0.36);
  }
  const mouth = block(0.3, 0.06, 0.04, materials.eye, { radius: 0.025, castShadow: false });
  addTo(hazard, mouth, 0, 0.48, -0.43);
  return hazard;
}

export function createLevel(ctx: GameCtx, materials: Materials): Level {
  const root = new Group();
  root.name = "storybook-platformer-level";
  ctx.add(root);
  const bodies: RigidBody3D[] = [];

  const bridgeTop = addBridge(ctx, root, bodies, materials);
  const meadowTop = addPlatform(ctx, root, bodies, materials, 0, 0.24, -5.2, 5.6, 0.8, 3.6);
  const leftTop = addPlatform(ctx, root, bodies, materials, -1.4, 1.1, -9, 4.3, 0.8, 3.4);
  const rightTop = addPlatform(ctx, root, bodies, materials, 2, 2, -13.1, 5.4, 0.85, 3.6);
  const finishTop = addPlatform(ctx, root, bodies, materials, 0, 2.9, -17.6, 7, 0.9, 5);

  addRouteConnector(ctx, root, bodies, -2.65, -3.4, meadowTop);
  addRouteConnector(ctx, root, bodies, -7, -7.3, leftTop);
  addRouteConnector(ctx, root, bodies, -10.7, -11.3, rightTop);
  addRouteConnector(ctx, root, bodies, -14.9, -15.1, finishTop);

  const hazardPosition = { x: 2, y: meadowTop, z: -5.25 };
  const hazard = addHazard(root, materials, hazardPosition.x, hazardPosition.y, hazardPosition.z);
  const goal = addGoal(root, materials, finishTop);
  goal.position.z = -18.6;

  addTree(root, materials, -3.5, 0.46, -1.1, 0.85);
  addTree(root, materials, 3.65, meadowTop - 0.08, -6.1, 0.8);
  addTree(root, materials, -3.9, leftTop - 0.12, -9.7, 0.72);
  addTree(root, materials, 4.25, rightTop - 0.1, -13.8, 0.88);
  addTree(root, materials, -3.6, finishTop - 0.1, -18.4, 1.05);
  addTree(root, materials, 3.4, finishTop - 0.1, -19.2, 0.72);

  addFloatingIsland(root, materials, -7.5, -0.9, -8, 1.1);
  addFloatingIsland(root, materials, 7, 0.2, -12.5, 1.35);
  addFloatingIsland(root, materials, -7, 1.6, -18, 0.8);
  addCloud(root, materials, -6.5, 7.4, -14, 1.35);
  addCloud(root, materials, 6.7, 8.7, -24, 1.7);
  addCloud(root, materials, -2, 10.6, -35, 1.95);
  addCloud(root, materials, 10.2, 5.9, -8, 0.88);

  const waterfall = block(1.25, 3.1, 0.12, materials.water, { radius: 0.18, castShadow: false });
  addTo(root, waterfall, 4.65, 1.75, -15.1);
  const waterfallFoam = block(1.45, 0.16, 0.38, materials.cloud, {
    radius: 0.08,
    castShadow: false,
  });
  addTo(root, waterfallFoam, 4.65, 0.2, -15.12);
  const waterfallSide = block(0.14, 3.2, 0.16, materials.water, {
    radius: 0.06,
    castShadow: false,
  });
  addTo(root, waterfallSide, 4.05, 1.75, -15.14);
  addTree(root, materials, 5.15, 0.38, -15.6, 1.1);

  const signpost = tube(0.08, 0.1, 1.45, materials.trunk, { segments: 10 });
  addTo(root, signpost, -2.75, 1.12, -5.8);
  const sign = block(1.55, 0.52, 0.12, materials.woodLight, { radius: 0.08 });
  addTo(root, sign, -2.75, 1.82, -5.8);
  const signPeg = ball(0.08, materials.goal, { segments: 8 });
  addTo(root, signPeg, -3.25, 1.82, -5.87);
  const signPegTwo = signPeg.clone();
  addTo(root, signPegTwo, -2.25, 1.82, -5.87);

  const goalPosition = { x: 0, y: finishTop + 0.65, z: -18.6 };
  const hazardAreaPosition = { x: hazardPosition.x, y: hazardPosition.y + 0.48, z: hazardPosition.z };
  const rootVector = new Vector3();
  root.getWorldPosition(rootVector);

  return {
    bodies,
    goal,
    goalPosition,
    hazard,
    hazardPosition: hazardAreaPosition,
    root,
    spawn: { x: 0, y: bridgeTop + 0.5, z: 2.55 },
    dispose(): void {
      for (const body of bodies) body.dispose();
      root.removeFromParent();
      root.clear();
      rootVector.set(0, 0, 0);
    },
  };
}
