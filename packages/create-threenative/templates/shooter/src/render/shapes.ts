// Generated for you. All arena silhouettes and gameplay visuals start here.
import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  type Material,
  Mesh,
  SphereGeometry,
} from "three";

import type { ReturnTypeOfMaterials } from "./types.js";

const roundedCache = new Map<string, BufferGeometry>();

export type ShooterMaterials = ReturnTypeOfMaterials;

function compactBox(width: number, height: number, depth: number): BufferGeometry {
  const halfX = width / 2;
  const halfY = height / 2;
  const halfZ = depth / 2;
  const positions = new Float32Array([
    -halfX,
    -halfY,
    -halfZ,
    halfX,
    -halfY,
    -halfZ,
    halfX,
    halfY,
    -halfZ,
    -halfX,
    halfY,
    -halfZ,
    -halfX,
    -halfY,
    halfZ,
    halfX,
    -halfY,
    halfZ,
    halfX,
    halfY,
    halfZ,
    -halfX,
    halfY,
    halfZ,
  ]);
  const normals = new Float32Array(positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index] ?? 0;
    const y = positions[index + 1] ?? 0;
    const z = positions[index + 2] ?? 0;
    const length = Math.hypot(x, y, z) || 1;
    normals[index] = x / length;
    normals[index + 1] = y / length;
    normals[index + 2] = z / length;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  geometry.setIndex([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 4, 0,
    3, 4, 3, 7,
  ]);
  return geometry;
}

function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius = 0.12,
  segments = 1,
): BufferGeometry {
  const key = `${width},${height},${depth},${radius},${segments}`;
  const cached = roundedCache.get(key);
  if (cached !== undefined) return cached;
  const geometry = compactBox(width, height, depth);
  roundedCache.set(key, geometry);
  return geometry;
}

function shadowed(mesh: Mesh, cast = true): Mesh {
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}

function block(width: number, height: number, depth: number, material: Material): Mesh {
  return shadowed(new Mesh(roundedBox(width, height, depth), material));
}

export function createArena(materials: ShooterMaterials) {
  const group = new Group();
  group.name = "arena";
  const floor = block(22, 0.4, 20, materials.arena);
  floor.name = "arena-floor";
  floor.position.set(0, -0.2, -2);
  group.add(floor);
  const walls = [
    { depth: 20, position: [-11, 1.7, -2] as const, width: 0.4 },
    { depth: 20, position: [11, 1.7, -2] as const, width: 0.4 },
    { depth: 0.4, position: [0, 1.7, -12] as const, width: 22 },
  ].map(({ depth, position, width }, index) => {
    const wall = block(width, 3.8, depth, materials.shadow);
    wall.name = `arena-wall-${index}`;
    wall.position.set(position[0], position[1], position[2]);
    group.add(wall);
    return wall;
  });
  for (let x = -9; x <= 9; x += 3) {
    const strip = new Mesh(compactBox(0.035, 0.012, 19), materials.trim);
    strip.position.set(x, 0.012, -2);
    strip.castShadow = false;
    strip.receiveShadow = false;
    group.add(strip);
  }
  for (let z = -11; z <= 7; z += 3) {
    const strip = new Mesh(compactBox(21, 0.012, 0.035), materials.trim);
    strip.position.set(0, 0.014, z);
    strip.castShadow = false;
    strip.receiveShadow = false;
    group.add(strip);
  }
  return { floor, group, walls };
}

export function createPlayerVisual(materials: ShooterMaterials): Group {
  const group = new Group();
  group.name = "player-visual";
  const body = block(0.76, 1.35, 0.76, materials.player);
  body.position.y = 0.62;
  group.add(body);
  const visor = new Mesh(compactBox(0.56, 0.22, 0.08), materials.trim);
  visor.position.set(0, 0.88, -0.4);
  visor.castShadow = true;
  group.add(visor);
  const muzzle = new Mesh(
    new CylinderGeometry(0.08, 0.1, 0.5, 6).rotateX(Math.PI / 2),
    materials.shadow,
  );
  muzzle.position.set(0, 0.52, -0.55);
  muzzle.castShadow = true;
  group.add(muzzle);
  return group;
}

export function createTargetVisual(materials: ShooterMaterials): Group {
  const group = new Group();
  group.name = "target-visual";
  const body = block(1.2, 1.8, 1, materials.hostile);
  body.position.y = 0.9;
  group.add(body);
  const ring = new Mesh(compactBox(1.4, 0.08, 0.08), materials.trim);
  ring.position.y = 0.9;
  ring.castShadow = true;
  group.add(ring);
  const crossbar = new Mesh(compactBox(0.08, 0.08, 1.4), materials.trim);
  crossbar.position.y = 0.9;
  crossbar.castShadow = true;
  group.add(crossbar);
  return group;
}

export function createFriendlyVisual(materials: ShooterMaterials): Group {
  const group = new Group();
  const body = block(0.9, 1.4, 0.9, materials.player);
  body.position.y = 0.7;
  group.add(body);
  const antenna = new Mesh(new CylinderGeometry(0.04, 0.04, 0.5, 8), materials.trim);
  antenna.position.y = 1.65;
  group.add(antenna);
  return group;
}

export function createWallVisual(materials: ShooterMaterials): Mesh {
  return block(0.65, 2.8, 2.8, materials.shadow);
}

export function createPickupVisual(materials: ShooterMaterials): Group {
  const group = new Group();
  const base = block(0.65, 0.12, 0.65, materials.trim);
  base.position.y = 0.06;
  group.add(base);
  const orb = new Mesh(new SphereGeometry(0.25, 4, 3), materials.player);
  orb.position.y = 0.45;
  orb.castShadow = true;
  group.add(orb);
  return group;
}

export function createProjectileVisual(materials: ShooterMaterials): Mesh {
  return shadowed(new Mesh(new SphereGeometry(0.12, 4, 3), materials.trim), false);
}
