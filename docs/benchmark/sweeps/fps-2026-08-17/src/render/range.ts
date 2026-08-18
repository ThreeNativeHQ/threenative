// The yard itself: a 34 m walled square, tiled deck, painted lanes, and the
// props the reference frame shows — a round barrier left, concrete barricades
// centre, two lockers and a raised walkway on the right.
import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Texture,
} from "three";
import { Target, type TargetSpec } from "../entities/Target.js";
import { type RangeMaterials, tiled } from "./materials.js";

export const YARD = 34;
export const WALL_HEIGHT = 4.6;
/** Where the player stands; the yard runs away from here toward -z. */
export const FIRING_LINE_Z = 13.4;

export type BoxCollider = {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
};

export type Range = {
  readonly group: Group;
  readonly hittable: Mesh[];
  readonly targets: Target[];
  readonly colliders: BoxCollider[];
};

const TARGETS: readonly TargetSpec[] = [
  { position: { x: -11.4, y: 2.45, z: -1.0 }, value: 150, width: 1.4, height: 1.95 },
  { position: { x: 0.2, y: 1.95, z: -2.6 }, value: 100, width: 1.3, height: 1.85 },
  { position: { x: 3.9, y: 2.3, z: -8.4 }, value: 250, width: 0.75, height: 1.05 },
  { position: { x: 10.6, y: 5.15, z: -8.6 }, value: 300, width: 1.3, height: 1.8 },
  { position: { x: -6.4, y: 1.95, z: -9.2 }, value: 150, width: 1.4, height: 1.95 },
  { position: { x: -2.6, y: 1.75, z: -13.4 }, value: 250, width: 1.0, height: 1.45 },
  { position: { x: 6.2, y: 1.8, z: -13.8 }, value: 250, width: 1.0, height: 1.45 },
  { position: { x: 15.0, y: 2.1, z: -2.8 }, value: 300, width: 1.4, height: 1.95 },
  { position: { x: -13.4, y: 1.95, z: -6.4 }, value: 150, width: 1.4, height: 1.95 },
  { position: { x: 8.6, y: 1.8, z: -2.2 }, value: 100, width: 1.15, height: 1.6 },
];

function addBox(
  group: Group,
  colliders: BoxCollider[],
  material: Mesh["material"],
  size: readonly [number, number, number],
  at: readonly [number, number, number],
  options: { readonly collide?: boolean; readonly hittable?: Mesh[] } = {},
): Mesh {
  const mesh = new Mesh(new BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(at[0], at[1], at[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  options.hittable?.push(mesh);
  if (options.collide !== false) {
    colliders.push({
      min: [at[0] - size[0] / 2, at[1] - size[1] / 2, at[2] - size[2] / 2],
      max: [at[0] + size[0] / 2, at[1] + size[1] / 2, at[2] + size[2] / 2],
    });
  }
  return mesh;
}

export function buildRange(materials: RangeMaterials): Range {
  const group = new Group();
  group.name = "range";
  const hittable: Mesh[] = [];
  const colliders: BoxCollider[] = [];

  // Deck.
  const floor = new Mesh(new PlaneGeometry(YARD, YARD), materials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = "deck";
  group.add(floor);
  hittable.push(floor);

  // Lane paint: four long stripes down range plus the firing line across it.
  for (const x of [-10.8, -3.6, 3.6, 10.8]) {
    const stripe = new Mesh(new PlaneGeometry(0.22, YARD - 1.6), materials.paint);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(x, 0.012, 0);
    stripe.receiveShadow = true;
    group.add(stripe);
  }
  const firingLine = new Mesh(new PlaneGeometry(YARD - 1.6, 0.26), materials.paint);
  firingLine.rotation.x = -Math.PI / 2;
  firingLine.position.set(0, 0.014, FIRING_LINE_Z - 0.9);
  group.add(firingLine);

  // Perimeter wall, near-black, with a lighter capping course along the top.
  const half = YARD / 2;
  const walls: readonly (readonly [number, number, number, number, number, number])[] = [
    [YARD + 1.2, WALL_HEIGHT, 0.6, 0, WALL_HEIGHT / 2, -half],
    [YARD + 1.2, WALL_HEIGHT, 0.6, 0, WALL_HEIGHT / 2, half],
    [0.6, WALL_HEIGHT, YARD + 1.2, -half, WALL_HEIGHT / 2, 0],
    [0.6, WALL_HEIGHT, YARD + 1.2, half, WALL_HEIGHT / 2, 0],
  ];
  for (const [sx, sy, sz, px, py, pz] of walls) {
    addBox(group, colliders, materials.wall, [sx, sy, sz], [px, py, pz], { hittable });
  }

  // Round barrier, left of the lane: an open concrete drum the player can shoot over.
  const drumMap = tiled((materials.floor as MeshStandardMaterial).map as Texture, 9);
  const drum = new Mesh(
    new CylinderGeometry(3.7, 3.7, 1.55, 40, 1, true, Math.PI * 0.15, Math.PI * 1.7),
    new MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x1c1e1f,
      map: drumMap,
      roughness: 0.95,
      side: DoubleSide,
    }),
  );
  drum.position.set(-11.4, 0.78, 0.6);
  drum.castShadow = true;
  drum.receiveShadow = true;
  group.add(drum);
  hittable.push(drum);
  colliders.push({ min: [-15.1, 0, -3.1], max: [-7.7, 1.55, 4.3] });

  // Concrete barricades down the centre lane.
  addBox(group, colliders, materials.concrete, [5.2, 1.2, 1.5], [0.3, 0.6, 1.2], { hittable });
  addBox(group, colliders, materials.concrete, [4.4, 1.1, 1.2], [2.6, 0.55, -4.6], { hittable });
  addBox(group, colliders, materials.concrete, [3.0, 0.9, 1.2], [-5.2, 0.45, -6.0], { hittable });

  // Two dark lockers, right of centre.
  addBox(group, colliders, materials.block, [1.5, 2.5, 0.95], [6.4, 1.25, -5.4], { hittable });
  addBox(group, colliders, materials.block, [1.5, 2.5, 0.95], [8.0, 1.25, -5.4], { hittable });

  // Raised walkway on the right, with a ramp up to it from the firing side.
  const deckY = 3.5;
  addBox(group, colliders, materials.block, [9.4, 0.36, 5.6], [11.6, deckY, -8.6], { hittable });
  for (const px of [7.5, 15.6]) {
    for (const pz of [-6.4, -10.8]) {
      addBox(group, colliders, materials.block, [1.0, deckY, 1.0], [px, deckY / 2, pz], {
        hittable,
      });
    }
  }
  const rail = new Mesh(new BoxGeometry(9.6, 0.12, 0.14), materials.paint);
  rail.position.set(11.6, deckY + 1.05, -5.9);
  rail.castShadow = true;
  group.add(rail);
  const ramp = new Mesh(new BoxGeometry(2.6, 0.3, 7.4), materials.concrete);
  ramp.position.set(11.6, deckY / 2 - 0.2, -2.1);
  ramp.rotation.x = -Math.atan2(deckY - 0.2, 7.0);
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  group.add(ramp);
  hittable.push(ramp);

  // Solid dark blocks: one hard right, one squat pair mid-right.
  addBox(group, colliders, materials.block, [4.2, 3.2, 4.2], [14.4, 1.6, 1.6], { hittable });
  addBox(group, colliders, materials.block, [2.4, 2.4, 2.4], [7.2, 1.2, -1.6], { hittable });
  addBox(group, colliders, materials.block, [2.0, 1.6, 2.0], [-8.0, 0.8, -12.4], { hittable });

  const targets = TARGETS.map((spec) => {
    const target = new Target(materials, spec);
    group.add(target.group);
    hittable.push(target.plate);
    return target;
  });

  return { group, hittable, targets, colliders };
}
