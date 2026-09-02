import { BoxGeometry, CylinderGeometry, Group, type Material, Mesh, SphereGeometry } from "three";
import type { ReturnTypeOfMaterials } from "./types.js";

export type RpgMaterials = ReturnTypeOfMaterials;

function block(
  width: number,
  height: number,
  depth: number,
  material: Material,
  castShadow = true,
): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  return mesh;
}

export function createDungeon(materials: RpgMaterials) {
  const group = new Group();
  group.name = "three-room-dungeon";
  const floor = block(36, 0.3, 12, materials.stone, false);
  floor.name = "dungeon-floor";
  floor.position.set(6, -0.15, 0);
  group.add(floor);

  const walls = [
    { name: "north-wall", size: [36, 2.8, 0.35] as const, position: [6, 1.4, -6] as const },
    { name: "south-wall", size: [36, 2.8, 0.35] as const, position: [6, 1.4, 6] as const },
    { name: "west-wall", size: [0.35, 2.8, 12] as const, position: [-12, 1.4, 0] as const },
    { name: "east-wall", size: [0.35, 2.8, 12] as const, position: [24, 1.4, 0] as const },
  ].map(({ name, position, size }) => {
    const wall = block(size[0], size[1], size[2], materials.stone);
    wall.name = name;
    wall.position.set(position[0], position[1], position[2]);
    group.add(wall);
    return wall;
  });

  const roomPillars: Mesh[] = [];
  for (const x of [0, 12]) {
    for (const z of [-4.5, 4.5]) {
      const pillar = block(0.7, 3.6, 1.2, materials.stone);
      pillar.position.set(x, 1.8, z);
      group.add(pillar);
      roomPillars.push(pillar);
    }
  }
  const lineOfSightWall = block(2.4, 2.1, 0.5, materials.stone);
  lineOfSightWall.name = "line-of-sight-wall";
  lineOfSightWall.position.set(-8, 1.05, -1.5);
  group.add(lineOfSightWall);

  for (const x of [-6, 6, 18]) {
    const rune = block(3.2, 0.04, 0.08, materials.trim, false);
    rune.position.set(x, 0.025, 0);
    group.add(rune);
  }
  return { floor, group, lineOfSightWall, roomPillars, walls };
}

export function createPlayerVisual(materials: RpgMaterials): Group {
  const group = new Group();
  group.name = "hero-visual";
  const body = block(0.72, 1.25, 0.72, materials.player);
  body.position.y = 0.65;
  group.add(body);
  const head = new Mesh(new SphereGeometry(0.32, 8, 6), materials.player);
  head.position.y = 1.42;
  head.castShadow = true;
  group.add(head);
  const blade = new Mesh(new BoxGeometry(0.08, 0.75, 0.16), materials.accent);
  blade.name = "held-blade";
  blade.position.set(0.52, 0.66, -0.1);
  blade.rotation.z = -0.32;
  blade.castShadow = true;
  group.add(blade);
  return group;
}

export function createEnemyVisual(materials: RpgMaterials, boss: boolean): Group {
  const group = new Group();
  group.name = boss ? "boss-visual" : "enemy-visual";
  const size = boss ? 1.2 : 0.82;
  const body = block(size, boss ? 1.9 : 1.35, size, materials.enemy);
  body.position.y = boss ? 0.95 : 0.67;
  group.add(body);
  const eye = new Mesh(new SphereGeometry(boss ? 0.18 : 0.12, 6, 4), materials.trim);
  eye.position.set(0, boss ? 1.45 : 1.08, -size / 2 - 0.03);
  eye.castShadow = true;
  group.add(eye);
  if (boss) {
    const crown = new Mesh(new CylinderGeometry(0.48, 0.24, 0.42, 6), materials.accent);
    crown.position.y = 2.0;
    crown.castShadow = true;
    group.add(crown);
  }
  return group;
}

export function createLootVisual(materials: RpgMaterials): Group {
  const group = new Group();
  const base = block(0.55, 0.12, 0.55, materials.accent);
  base.position.y = 0.06;
  group.add(base);
  const gem = new Mesh(new SphereGeometry(0.2, 6, 4), materials.player);
  gem.position.y = 0.36;
  gem.castShadow = true;
  group.add(gem);
  return group;
}
