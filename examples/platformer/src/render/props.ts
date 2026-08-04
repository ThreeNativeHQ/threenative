// Yours: ordinary Three.js. ThreeNative does not read this file.
//
// The set dressing, built from `shapes.ts` primitives. Everything here is
// visual only — the level's colliders are plain boxes created in
// `levels/spawn.ts`, deliberately simpler than what you see.
//
// The one idea running through all of it: break the silhouette. A grass slab is
// a rectangle; a grass slab with a fringe overhanging its rim, a tapering rock
// underside and two trees crossing its edge is a shape you can name at a
// glance. That is most of the difference between this and a grey box.
import { Group, type Material, Mesh } from "three";
import { type Materials, shades } from "./materials.js";
import { ball, block, makeRandom, spike, tube } from "./shapes.js";

const FRINGE_DROP = 0.34;

/**
 * A floating island: grass cap, an overhanging fringe that hides the seam, and
 * three shrinking rock chunks underneath so it reads as torn out of the ground
 * rather than sliced.
 */
export function grassIsland(
  materials: Materials,
  width: number,
  depth: number,
  seed: number,
): Group {
  const group = new Group();
  const random = makeRandom(seed);
  const capMaterials = [materials.grass, materials.grassLit] as const;

  const cap = block(width, 0.9, depth, shades(capMaterials, seed), { radius: 0.32 });
  cap.position.y = -0.45;
  group.add(cap);

  // The fringe: short grass tabs hanging past the rim. Cheap, and it is what
  // stops the island reading as a table top.
  const perSide = Math.max(3, Math.round(width / 1.3));
  for (let index = 0; index < perSide; index += 1) {
    const t = (index + 0.5) / perSide;
    for (const side of [1, -1]) {
      const tab = block(width / perSide + 0.14, FRINGE_DROP + random() * 0.3, 0.36, materials.grass, {
        radius: 0.14,
      });
      tab.position.set(-width / 2 + t * width, -0.9 - random() * 0.12, (side * depth) / 2);
      group.add(tab);
    }
  }

  let chunkWidth = width * 0.92;
  let chunkDepth = depth * 0.92;
  let y = -1.2;
  const rockMaterials = [materials.rock, materials.rockDark, materials.rockLit] as const;
  for (let index = 0; index < 3; index += 1) {
    const height = 1.5 + index * 0.7;
    const chunk = block(chunkWidth, height, chunkDepth, shades(rockMaterials, seed + index), {
      radius: 0.4,
    });
    chunk.position.set((random() - 0.5) * 0.5, y - height / 2, (random() - 0.5) * 0.5);
    group.add(chunk);
    y -= height;
    chunkWidth *= 0.66;
    chunkDepth *= 0.66;
  }
  // A blunt point so the underside terminates instead of just stopping.
  const tip = spike(chunkWidth * 0.6, 2.2, materials.rockDark, { segments: 8 });
  tip.rotation.x = Math.PI;
  tip.position.y = y - 1.1;
  group.add(tip);

  return group;
}

/** A rope-and-plank bridge spanning `length` metres along +X. */
export function plankBridge(materials: Materials, length: number, seed: number): Group {
  const group = new Group();
  const random = makeRandom(seed);
  const count = Math.max(2, Math.round(length / 0.62));
  const plankMaterials = [materials.plank, materials.plankDark] as const;
  for (let index = 0; index < count; index += 1) {
    const plank = block(0.52, 0.2, 3.1, shades(plankMaterials, index), { radius: 0.08 });
    plank.position.set((index + 0.5) * (length / count), -0.1, 0);
    // A few degrees of scatter reads as rope-hung; perfectly flat reads as CAD.
    plank.rotation.z = (random() - 0.5) * 0.035;
    plank.rotation.y = (random() - 0.5) * 0.03;
    group.add(plank);
  }
  for (const side of [1, -1]) {
    const rope = block(length, 0.09, 0.09, materials.rope, { radius: 0.045 });
    rope.position.set(length / 2, 0.42, (side * 3.1) / 2);
    group.add(rope);
  }
  for (const end of [0, length]) {
    for (const side of [1, -1]) {
      const post = tube(0.19, 0.23, 1.5, materials.plankDark, { segments: 10 });
      post.position.set(end, 0.35, (side * 3.1) / 2);
      group.add(post);
    }
  }
  return group;
}

/** A tree: tapered trunk, three stacked leaf balls, a lean so it is not a lamp post. */
export function tree(materials: Materials, seed: number): Group {
  const group = new Group();
  const random = makeRandom(seed);
  const height = 1.5 + random() * 0.9;
  const trunk = tube(0.13, 0.22, height, materials.trunk, { segments: 9 });
  trunk.position.y = height / 2;
  group.add(trunk);
  const leafMaterials = [materials.leaf, materials.leafDark] as const;
  for (let index = 0; index < 3; index += 1) {
    const crown = ball(0.72 - index * 0.15, shades(leafMaterials, seed + index), { segments: 12 });
    crown.position.set((random() - 0.5) * 0.3, height + index * 0.46, (random() - 0.5) * 0.3);
    group.add(crown);
  }
  group.rotation.z = (random() - 0.5) * 0.16;
  return group;
}

/** A low bush, occasionally flowering. Reads as ground clutter at any distance. */
export function bush(materials: Materials, seed: number): Group {
  const group = new Group();
  const random = makeRandom(seed);
  const leafMaterials = [materials.leaf, materials.leafDark] as const;
  for (let index = 0; index < 3; index += 1) {
    const lobe = ball(0.3 + random() * 0.24, shades(leafMaterials, seed + index), { segments: 10 });
    lobe.position.set((random() - 0.5) * 0.7, 0.22 + random() * 0.18, (random() - 0.5) * 0.7);
    group.add(lobe);
  }
  if (random() > 0.45) {
    const petal = ball(0.11, materials.flower, { segments: 8 });
    petal.position.set((random() - 0.5) * 0.5, 0.55, (random() - 0.5) * 0.5);
    group.add(petal);
  }
  return group;
}

/** A fence run along +X — the reference uses these to edge every drop. */
export function fence(materials: Materials, length: number, seed: number): Group {
  const group = new Group();
  const posts = Math.max(2, Math.round(length / 1.5));
  for (let index = 0; index <= posts; index += 1) {
    const post = tube(0.09, 0.11, 0.95, materials.plankDark, { segments: 8 });
    post.position.set((index / posts) * length, 0.47, 0);
    group.add(post);
  }
  for (const height of [0.4, 0.72]) {
    const rail = block(length, 0.1, 0.12, materials.plank, { radius: 0.05 });
    rail.position.set(length / 2, height, 0);
    group.add(rail);
  }
  makeRandom(seed);
  return group;
}

/**
 * A waterfall: a translucent sheet, a widening plume, and foam at the lip. It
 * does not animate — the emissive water material and the foam do the work.
 */
export function waterfall(materials: Materials, width: number, height: number): Group {
  const group = new Group();
  const sheet = block(width, height, 0.5, materials.water, {
    castShadow: false,
    radius: 0.2,
  });
  sheet.position.y = -height / 2;
  group.add(sheet);
  // Foam only at the lip, and small: a big white ball at the top of a fall
  // reads as a cloud that has landed on the grass, which is what this was.
  for (let index = 0; index < 3; index += 1) {
    const foam = ball(width * 0.11, materials.foam, { castShadow: false, segments: 10 });
    // Below the lip, not on it: foam sitting proud of the grass reads as snow.
    foam.position.set((index - 1) * width * 0.28, -0.24, 0.14);
    group.add(foam);
  }
  // The fall widens as it drops — one extra sheet is enough to imply it.
  const spread = block(width * 1.5, height * 0.5, 0.4, materials.water, {
    castShadow: false,
    radius: 0.2,
  });
  spread.position.y = -height * 0.78;
  group.add(spread);
  return group;
}

/** Scatter `count` props across an island's cap without hitting the middle lane. */
export function scatter(
  parent: Group,
  make: (seed: number) => Group | Mesh,
  count: number,
  width: number,
  depth: number,
  seed: number,
): void {
  const random = makeRandom(seed);
  for (let index = 0; index < count; index += 1) {
    const prop = make(seed + index * 17);
    const z = (random() < 0.5 ? -1 : 1) * (1.9 + random() * (depth / 2 - 2.2));
    prop.position.set((random() - 0.5) * (width - 1.6), 0, z);
    parent.add(prop);
  }
}

/** Tint helper for props that should not share a material instance. */
export function recolour(object: Group | Mesh, material: Material): void {
  object.traverse((child) => {
    if (child instanceof Mesh) child.material = material;
  });
}
