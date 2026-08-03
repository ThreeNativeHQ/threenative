// Ordinary Three.js. Everything a screenshot shows lives here, in the game.
// Scenery only: nothing here has a collider, so nothing here can be stood on.
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, SphereGeometry } from "three";
import type { Materials } from "./materials.js";

/** The big round broadleaf the reference plants on every island shoulder. */
export function createTree(materials: Materials, scale = 1): Group {
  const tree = new Group();
  const trunk = new Mesh(new CylinderGeometry(0.18, 0.3, 1.5, 7), materials.trunk);
  trunk.position.y = 0.75;
  trunk.castShadow = true;
  tree.add(trunk);
  const canopy: readonly [number, number, number, number][] = [
    [0, 2.1, 0, 0.95],
    [0.7, 1.7, 0.25, 0.68],
    [-0.65, 1.75, -0.2, 0.72],
    [0.15, 1.6, -0.7, 0.6],
    [-0.1, 2.6, 0.35, 0.55],
  ];
  for (const [x, y, z, radius] of canopy) {
    const blob = new Mesh(
      new SphereGeometry(radius, 12, 10),
      radius > 0.7 ? materials.leaf : materials.leafDark,
    );
    blob.position.set(x, y, z);
    blob.castShadow = true;
    tree.add(blob);
  }
  tree.scale.setScalar(scale);
  return tree;
}

/** The stumpy conifer that fills the middle distance. */
export function createPine(materials: Materials, scale = 1): Group {
  const pine = new Group();
  const trunk = new Mesh(new CylinderGeometry(0.14, 0.2, 0.9, 7), materials.trunk);
  trunk.position.y = 0.45;
  trunk.castShadow = true;
  pine.add(trunk);
  const tiers: readonly [number, number, number][] = [
    [1, 0.8, 1.15],
    [1.6, 0.62, 0.95],
    [2.1, 0.42, 0.75],
  ];
  for (const [index, [y, radius, height]] of tiers.entries()) {
    const tier = new Mesh(
      new ConeGeometry(radius, height, 8),
      index === 0 ? materials.leafDark : materials.leaf,
    );
    tier.position.y = y;
    tier.castShadow = true;
    pine.add(tier);
  }
  pine.scale.setScalar(scale);
  return pine;
}

/** A round bush; three overlapping spheres read as leafy at this scale. */
export function createBush(materials: Materials, scale = 1): Group {
  const bush = new Group();
  const blobs: readonly [number, number, number, number][] = [
    [0, 0.36, 0, 0.46],
    [0.36, 0.26, 0.12, 0.32],
    [-0.32, 0.28, -0.1, 0.34],
  ];
  for (const [x, y, z, radius] of blobs) {
    const blob = new Mesh(new SphereGeometry(radius, 10, 8), materials.leaf);
    blob.position.set(x, y, z);
    blob.castShadow = true;
    bush.add(blob);
  }
  bush.scale.setScalar(scale);
  return bush;
}

/** A tuft of blades, sometimes flowered, scattered over the grass caps. */
export function createTuft(materials: Materials, flowered: boolean): Group {
  const tuft = new Group();
  const blades: readonly [number, number, number][] = [
    [0, 0, 0.26],
    [0.1, 0.28, 0.21],
    [-0.11, -0.24, 0.23],
    [0.06, -0.1, 0.17],
  ];
  for (const [x, z, height] of blades) {
    const blade = new Mesh(new ConeGeometry(0.045, height, 4), materials.grassBright);
    blade.position.set(x, height / 2, z);
    blade.rotation.z = x * 1.6;
    tuft.add(blade);
  }
  if (!flowered) return tuft;
  for (const [x, z] of [
    [0.16, -0.1],
    [-0.14, 0.12],
  ] as const) {
    const stem = new Mesh(new CylinderGeometry(0.02, 0.02, 0.26, 4), materials.grassDark);
    stem.position.set(x, 0.13, z);
    const bloom = new Mesh(new SphereGeometry(0.07, 6, 5), materials.flower);
    bloom.position.set(x, 0.28, z);
    tuft.add(stem, bloom);
  }
  return tuft;
}

/** Post-and-rope fencing along an island edge, as in the reference's midground. */
export function createFence(materials: Materials, length: number, posts = 3): Group {
  const fence = new Group();
  const span = length / (posts - 1);
  for (let index = 0; index < posts; index += 1) {
    const post = new Mesh(new CylinderGeometry(0.1, 0.12, 1.1, 7), materials.woodDark);
    post.position.set(length * (index / (posts - 1) - 0.5), 0.55, 0);
    post.castShadow = true;
    fence.add(post);
    if (index === posts - 1) continue;
    for (const height of [0.78, 0.46]) {
      const rope = new Mesh(new CylinderGeometry(0.035, 0.035, span, 5), materials.rope);
      rope.rotation.z = Math.PI / 2;
      rope.position.set(length * ((index + 0.5) / (posts - 1) - 0.5), height, 0);
      fence.add(rope);
    }
  }
  return fence;
}

/** Ivy spilling over a cliff lip: the detail that softens every hard edge. */
export function createIvy(materials: Materials, width: number): Group {
  const ivy = new Group();
  const leaves = Math.max(3, Math.round(width * 1.4));
  for (let index = 0; index < leaves; index += 1) {
    const drop = 0.35 + ((index * 7) % 5) * 0.16;
    const strand = new Mesh(new BoxGeometry(0.2, drop, 0.06), materials.leafDark);
    strand.position.set(width * ((index + 0.5) / leaves - 0.5), -drop / 2, 0);
    ivy.add(strand);
    const leaf = new Mesh(new SphereGeometry(0.16, 7, 6), materials.leaf);
    leaf.scale.set(1, 0.7, 0.5);
    leaf.position.set(strand.position.x, -drop, 0.03);
    ivy.add(leaf);
  }
  return ivy;
}
