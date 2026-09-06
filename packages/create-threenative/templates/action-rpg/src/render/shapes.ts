import { BoxGeometry, CylinderGeometry, Group, type Material, Mesh, SphereGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { ReturnTypeOfMaterials } from "./types.js";

export type RpgMaterials = ReturnTypeOfMaterials;

/**
 * Bake rigid pieces down to one mesh per material.
 *
 * Flagstones, wall caps, torch brackets and the bedrock outside the room are a hundred-odd meshes
 * that never move relative to the dungeon; authored one at a time they are a hundred-odd draw
 * calls, and with the shadow pass that doubles. Everything a playtest looks up by name — the
 * floor, the walls, the pillars, the line-of-sight wall — stays its own object.
 */
function bake(parts: readonly Mesh[], root: Group): void {
  const byMaterial = new Map<Material, Mesh[]>();
  for (const mesh of parts) {
    const bucket = byMaterial.get(mesh.material as Material);
    if (bucket === undefined) byMaterial.set(mesh.material as Material, [mesh]);
    else bucket.push(mesh);
  }
  for (const [material, meshes] of byMaterial) {
    const geometry = mergeGeometries(
      meshes.map((mesh) => {
        mesh.updateMatrix();
        const placed = mesh.geometry.clone().applyMatrix4(mesh.matrix);
        const cloned = placed.index === null ? placed : placed.toNonIndexed();
        for (const name of Object.keys(cloned.attributes)) {
          if (name !== "position") cloned.deleteAttribute(name);
        }
        return cloned;
      }),
      false,
    );
    if (geometry === null) throw new Error("mergeGeometries returned null baking the dungeon.");
    geometry.computeVertexNormals();
    const merged = new Mesh(geometry, material);
    merged.castShadow = meshes[0]?.castShadow ?? true;
    merged.receiveShadow = true;
    root.add(merged);
  }
}

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
  const dressing: Mesh[] = [];
  const floor = block(36, 0.3, 12, materials.stone, false);
  floor.name = "dungeon-floor";
  floor.position.set(6, -0.15, 0);
  group.add(floor);

  // Floor courses: alternating flagstones, so the deck is masonry rather than one flat value.
  for (let index = 0; index < 12; index += 1) {
    const slab = block(2.8, 0.06, 11.4, materials.stoneDark, false);
    slab.position.set(-10.6 + index * 3, 0.02, 0);
    dressing.push(slab);
  }

  // Walls tall enough to close the shot. At 2.8 the camera — 8.4 up — looked clean over them into
  // the empty sky, and the frame was half black void; a dungeon should be bounded by its walls.
  //
  // The **south** wall is the exception, and stays low. The camera sits behind it, so at full
  // height its inner face filled the bottom-left of every frame and the room was behind it. A
  // near wall you can see over is the oldest trick in an isometric dungeon and it costs one row
  // of this table.
  const walls = [
    { name: "north-wall", size: [36, 5.2, 0.5] as const, position: [6, 2.6, -6] as const },
    { name: "south-wall", size: [36, 2.2, 0.5] as const, position: [6, 1.1, 6] as const },
    { name: "west-wall", size: [0.5, 5.2, 12] as const, position: [-12, 2.6, 0] as const },
    { name: "east-wall", size: [0.5, 5.2, 12] as const, position: [24, 2.6, 0] as const },
  ].map(({ name, position, size }) => {
    const wall = block(size[0], size[1], size[2], materials.stone);
    wall.name = name;
    wall.position.set(position[0], position[1], position[2]);
    group.add(wall);
    // A darker cap course along the top of every wall: one line that turns a slab into masonry.
    const cap = block(size[0] + 0.24, 0.34, size[2] + 0.24, materials.stoneDark);
    cap.position.set(position[0], position[1] + size[1] / 2 + 0.1, position[2]);
    dressing.push(cap);
    return wall;
  });

  // Bedrock: a thick mass outside every wall, level with its cap. A dungeon is *cut into* rock,
  // and without this the frame showed black void wherever the follow camera drifted close enough
  // to a wall to see past it — which is most of the level, since the hero starts beside one.
  for (const [width, depth, x, z] of [
    [52, 9, 6, -11.2],
    [52, 9, 6, 11.6],
    [9, 34, -17, 0],
    [9, 34, 29, 0],
  ] as const) {
    const mass = block(width, 6.4, depth, materials.stoneDark);
    mass.position.set(x, 2.9, z);
    dressing.push(mass);
  }

  // Torches down both long walls. The one warm light source a dungeon needs to be a dungeon, and
  // on one wall only the near half of every room sat in the dark.
  for (const side of [-1, 1] as const) {
    for (const x of [-8, -2, 4, 10, 16, 22]) {
      const bracket = new Mesh(new CylinderGeometry(0.06, 0.08, 0.5, 5), materials.stoneDark);
      bracket.position.set(x, 2.2, side * 5.6);
      bracket.rotation.x = side * -0.4;
      bracket.castShadow = true;
      dressing.push(bracket);
      const flame = new Mesh(new SphereGeometry(0.2, 7, 5), materials.flame);
      flame.scale.y = 1.5;
      flame.position.set(x, 2.6, side * 5.35);
      dressing.push(flame);
    }
  }

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
    dressing.push(rune);
  }
  bake(dressing, group);
  return { floor, group, lineOfSightWall, roomPillars, walls };
}

/**
 * The hero: a cloaked figure with a helm, a shield arm and a sword that has a hilt.
 *
 * A 0.72-cube torso with a sphere on top and a thin box beside it is what shipped, and from the
 * dungeon camera it read as a teal box with a stick. The blade keeps the name `held-blade`
 * because the equip playtest looks it up.
 */
export function createPlayerVisual(materials: RpgMaterials): Group {
  const group = new Group();
  group.name = "hero-visual";
  const torso = block(0.6, 0.7, 0.44, materials.player);
  torso.position.y = 0.92;
  group.add(torso);
  const cloak = block(0.7, 0.9, 0.18, materials.stoneDark);
  cloak.position.set(0, 0.86, 0.24);
  group.add(cloak);
  const belt = block(0.64, 0.12, 0.48, materials.accent);
  belt.position.y = 0.6;
  group.add(belt);
  const head = new Mesh(new SphereGeometry(0.26, 8, 6), materials.player);
  head.position.y = 1.44;
  head.castShadow = true;
  group.add(head);
  const helm = block(0.34, 0.18, 0.36, materials.accent);
  helm.position.y = 1.6;
  group.add(helm);
  for (const side of [-1, 1]) {
    const leg = block(0.2, 0.56, 0.24, materials.stoneDark);
    leg.position.set(side * 0.16, 0.28, 0);
    group.add(leg);
    const arm = block(0.16, 0.5, 0.2, materials.player);
    arm.position.set(side * 0.38, 0.94, 0);
    group.add(arm);
  }
  const shield = block(0.1, 0.6, 0.46, materials.accent);
  shield.position.set(-0.48, 0.9, 0.04);
  shield.rotation.z = 0.12;
  group.add(shield);

  const blade = new Mesh(new BoxGeometry(0.07, 0.86, 0.16), materials.accent);
  blade.name = "held-blade";
  blade.position.set(0.52, 1.06, -0.12);
  blade.rotation.z = -0.28;
  blade.castShadow = true;
  group.add(blade);
  const hilt = block(0.06, 0.14, 0.3, materials.stoneDark);
  hilt.position.set(0.45, 0.68, -0.06);
  hilt.rotation.z = -0.28;
  group.add(hilt);
  return group;
}

/** The hostiles: a hunched brute, and a taller crowned one for the boss. */
export function createEnemyVisual(materials: RpgMaterials, boss: boolean): Group {
  const group = new Group();
  group.name = boss ? "boss-visual" : "enemy-visual";
  const scale = boss ? 1.4 : 1;
  const chest = block(0.86 * scale, 0.66 * scale, 0.6 * scale, materials.enemy);
  chest.position.y = 0.94 * scale;
  group.add(chest);
  const hips = block(0.6 * scale, 0.4 * scale, 0.48 * scale, materials.stoneDark);
  hips.position.y = 0.48 * scale;
  group.add(hips);
  const head = block(0.44 * scale, 0.34 * scale, 0.42 * scale, materials.enemy);
  head.position.set(0, 1.36 * scale, -0.1 * scale);
  group.add(head);
  const eye = new Mesh(new SphereGeometry(0.11 * scale, 6, 4), materials.trim);
  eye.position.set(0, 1.36 * scale, -0.34 * scale);
  eye.castShadow = true;
  group.add(eye);
  for (const side of [-1, 1]) {
    // Horns: the cheapest read that separates a hostile from a crate at dungeon-camera distance.
    const horn = new Mesh(
      new CylinderGeometry(0.02 * scale, 0.09 * scale, 0.4 * scale, 5),
      materials.stoneDark,
    );
    horn.position.set(side * 0.2 * scale, 1.6 * scale, -0.06 * scale);
    horn.rotation.z = side * 0.5;
    horn.castShadow = true;
    group.add(horn);
    const arm = block(0.2 * scale, 0.62 * scale, 0.22 * scale, materials.enemy);
    arm.position.set(side * 0.56 * scale, 0.9 * scale, 0);
    arm.rotation.z = side * -0.16;
    group.add(arm);
    const leg = block(0.24 * scale, 0.44 * scale, 0.28 * scale, materials.stoneDark);
    leg.position.set(side * 0.18 * scale, 0.22 * scale, 0);
    group.add(leg);
  }
  if (boss) {
    const crown = new Mesh(new CylinderGeometry(0.52, 0.3, 0.36, 6), materials.accent);
    crown.position.y = 2.02;
    crown.castShadow = true;
    group.add(crown);
    const mantle = block(1.3, 0.16, 0.9, materials.accent);
    mantle.position.y = 1.78;
    group.add(mantle);
  }
  return group;
}

/** Loot: a banded chest with a lit gem in its lid. A plinth with a marble on it read as neither. */
export function createLootVisual(materials: RpgMaterials): Group {
  const group = new Group();
  const body = block(0.66, 0.36, 0.46, materials.stoneDark);
  body.position.y = 0.18;
  group.add(body);
  const lid = block(0.7, 0.16, 0.5, materials.accent);
  lid.position.y = 0.44;
  group.add(lid);
  for (const x of [-0.22, 0.22]) {
    const band = block(0.07, 0.5, 0.52, materials.accent);
    band.position.set(x, 0.24, 0);
    group.add(band);
  }
  const gem = new Mesh(new SphereGeometry(0.13, 7, 5), materials.player);
  gem.position.y = 0.58;
  gem.castShadow = true;
  group.add(gem);
  return group;
}
