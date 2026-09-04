// Every prop in the game, built from the rounded primitives in shapes.ts. The
// rule that makes these read as toys rather than as level-editor blocks: a wide
// soft grass cap that overhangs the rock below it, a fringe of tufts breaking
// the straight top edge, and no sharp corner anywhere.
import { Group, type Mesh, MeshStandardMaterial, Object3D } from "three";
import type { Materials } from "./materials.js";
import { ball, block, spike, tube } from "./shapes.js";

/**
 * A grass-topped island: rock body, dirt band, grass cap with an overhanging
 * lip, and tufts along the rim so the silhouette is never a straight line.
 */
export function grassIsland(
  materials: Materials,
  width: number,
  depth: number,
  height: number,
  seed: () => number,
): Group {
  const group = new Group();
  const capHeight = 0.62;

  // The cliff is a stack of three shrinking slabs rather than one tall box. The
  // steps catch the sun at different angles, which is what turns a flat grey
  // wall into rock; a single box reads as poured concrete however it is tinted.
  const slabs = 3;
  let cursor = -capHeight / 2 - 0.5;
  for (let index = 0; index < slabs; index += 1) {
    const slabHeight = (height - 0.5) / slabs;
    const shrink = 0.96 - index * 0.07;
    const slab = block(
      width * shrink,
      slabHeight * 0.94,
      depth * shrink,
      index % 2 === 0 ? materials.rock : materials.rockDark,
      { radius: 0.28 },
    );
    slab.position.set((seed() - 0.5) * 0.2, cursor - slabHeight / 2, 0);
    group.add(slab);
    cursor -= slabHeight;
  }

  // Boulders bedded into the cliff faces. A cliff is a silhouette problem: a
  // flat wall stays a flat wall however it is shaded, and half-buried rounded
  // rocks are the cheapest way to break its outline.
  const boulders = Math.max(1, Math.round(width / 6));
  for (let index = 0; index < boulders; index += 1) {
    for (const side of [-1, 1]) {
      const size = 1 + seed() * 1.1;
      const rock = ball(size, materials.rockDark, { segments: 10 });
      rock.scale.set(1.5, 0.8, 1);
      rock.position.set(
        ((index + 0.5) / boulders - 0.5) * width * 0.8 + (seed() - 0.5) * 2,
        -capHeight / 2 - 1.4 - seed() * Math.max(0.6, height - 3),
        (side * depth) / 2 - side * size * 0.55,
      );
      group.add(rock);
    }
  }

  // Vines spilling over the lip. In the reference this is what stops the cliff
  // from being a wall: green interrupting the top edge, hanging into the stone.
  const vines = Math.max(2, Math.round(width / 3.5));
  for (let index = 0; index < vines; index += 1) {
    for (const side of [-1, 1]) {
      if (seed() > 0.55) continue;
      const drop = 0.6 + seed() * Math.min(2.6, height * 0.6);
      const x = ((index + 0.5) / vines - 0.5) * width * 0.92;
      let y = -capHeight / 2 - 0.2;
      while (y > -capHeight / 2 - drop) {
        const leaf = ball(0.16 + seed() * 0.16, seed() > 0.5 ? materials.leaf : materials.leafLight);
        leaf.position.set(x + (seed() - 0.5) * 0.3, y, (side * depth) / 2 + side * 0.06);
        leaf.scale.set(1, 0.8, 0.7);
        group.add(leaf);
        y -= 0.28;
      }
    }
  }

  // The warm band directly under the turf: soil, not stone. It is the single
  // strongest cue that the green on top is grass.
  const dirt = block(width * 0.99, 0.62, depth * 0.99, materials.dirt, { radius: 0.24 });
  dirt.position.y = -capHeight / 2 - 0.24;
  group.add(dirt);

  const cap = block(width, capHeight, depth, materials.grass, { radius: 0.3 });
  group.add(cap);
  // A brighter sliver on top so the turf has a lit face and a shaded edge.
  const lip = block(width * 0.98, 0.16, depth * 0.98, materials.grassLight, { radius: 0.07 });
  lip.position.y = capHeight / 2 - 0.05;
  group.add(lip);

  // The fringe. Half-buried balls around the rim read as grass spilling over
  // the edge, which is most of the toy look in the reference.
  // Tuft size scales with the island: fixed-size tufts swallow a 3-unit
  // stepping stone while disappearing on a 15-unit one.
  const tuftScale = Math.min(1, Math.min(width, depth) / 8);
  const rim = Math.max(3, Math.round(width / (1.1 * Math.max(0.5, tuftScale))));
  for (let index = 0; index < rim; index += 1) {
    const t = (index + 0.5) / rim;
    for (const side of [-1, 1]) {
      const tuft = ball(
        (0.34 + seed() * 0.24) * tuftScale,
        seed() > 0.5 ? materials.grass : materials.grassLight,
      );
      tuft.position.set(
        (t - 0.5) * width * 0.98,
        -0.12 + seed() * 0.12,
        (side * depth) / 2 + side * (seed() * 0.08 - 0.06),
      );
      tuft.scale.set(1, 0.72, 1);
      group.add(tuft);
    }
  }
  const sideTufts = Math.max(2, Math.round(depth / 1.4));
  for (let index = 0; index < sideTufts; index += 1) {
    const t = (index + 0.5) / sideTufts;
    for (const side of [-1, 1]) {
      const tuft = ball((0.3 + seed() * 0.2) * tuftScale, materials.grass);
      tuft.position.set((side * width) / 2, -0.1, (t - 0.5) * depth * 0.9);
      tuft.scale.set(1, 0.7, 1);
      group.add(tuft);
    }
  }
  return group;
}

/** A floating scenery island for the background — the same recipe, tapered. */
export function floatingIsland(materials: Materials, width: number, seed: () => number): Group {
  const group = new Group();
  const cap = block(width, 0.7, width * 0.8, materials.grass, { radius: 0.3 });
  group.add(cap);
  const dirt = block(width * 0.92, 0.6, width * 0.72, materials.dirt, { radius: 0.26 });
  dirt.position.y = -0.55;
  group.add(dirt);
  let radius = width * 0.4;
  let y = -1.1;
  while (radius > 0.5) {
    const chunk = block(radius * 2, radius * 1.3, radius * 1.7, materials.rock, { radius: 0.26 });
    chunk.position.set((seed() - 0.5) * 0.3, y, 0);
    group.add(chunk);
    y -= radius * 0.9;
    radius *= 0.68;
  }
  // A short, blunt tip. A long dark cone under every island turns the sky into
  // a field of grey spikes, which is the first thing that went wrong here.
  const tip = spike(radius * 2, radius * 2.2, materials.rock);
  tip.rotation.x = Math.PI;
  tip.position.y = y - radius * 0.6;
  group.add(tip);
  return group;
}

/** Stacked cones on a trunk. Three sizes of the same idea fill a treeline. */
export function pineTree(materials: Materials, scale = 1): Group {
  const group = new Group();
  const trunk = tube(0.16 * scale, 0.22 * scale, 0.9 * scale, materials.trunk);
  trunk.position.y = 0.45 * scale;
  group.add(trunk);
  const tiers = 3;
  for (let index = 0; index < tiers; index += 1) {
    const t = index / (tiers - 1);
    const cone = spike(
      (0.95 - t * 0.38) * scale,
      (1.15 - t * 0.22) * scale,
      index === tiers - 1 ? materials.leafLight : materials.leaf,
    );
    cone.position.y = (1.05 + index * 0.72) * scale;
    group.add(cone);
  }
  return group;
}

/** A round broadleaf shrub — the filler that keeps flat ground from reading empty. */
export function bush(materials: Materials, scale = 1, seed: () => number = Math.random): Group {
  const group = new Group();
  const lobes = 3 + Math.floor(seed() * 3);
  for (let index = 0; index < lobes; index += 1) {
    const lobe = ball(
      (0.34 + seed() * 0.3) * scale,
      seed() > 0.45 ? materials.leaf : materials.leafLight,
    );
    lobe.position.set(
      (seed() - 0.5) * 0.9 * scale,
      (0.2 + seed() * 0.35) * scale,
      (seed() - 0.5) * 0.8 * scale,
    );
    group.add(lobe);
  }
  return group;
}

/** A tiny flower: stem, petals, centre. Scattered by the handful, never alone. */
export function flower(materials: Materials, seed: () => number): Group {
  const group = new Group();
  const stem = tube(0.03, 0.03, 0.24, materials.leaf);
  stem.position.y = 0.12;
  group.add(stem);
  const petals = 5;
  for (let index = 0; index < petals; index += 1) {
    const angle = (index / petals) * Math.PI * 2;
    const petal = ball(0.075, seed() > 0.5 ? materials.petal : materials.white);
    petal.position.set(Math.cos(angle) * 0.09, 0.26, Math.sin(angle) * 0.09);
    petal.scale.set(1, 0.5, 1);
    group.add(petal);
  }
  const centre = ball(0.05, materials.coin);
  centre.position.y = 0.28;
  group.add(centre);
  return group;
}

/** A fence post with a rope span, matching the reference's cliff-edge railings. */
export function fenceRun(materials: Materials, length: number, posts: number): Group {
  const group = new Group();
  for (let index = 0; index < posts; index += 1) {
    const x = (index / (posts - 1) - 0.5) * length;
    const post = tube(0.13, 0.16, 1.15, materials.woodDark);
    post.position.set(x, 0.55, 0);
    group.add(post);
    const cap = ball(0.15, materials.woodLight);
    cap.position.set(x, 1.15, 0);
    cap.scale.y = 0.7;
    group.add(cap);
    if (index === posts - 1) continue;
    const span = length / (posts - 1);
    for (const droop of [0, 1]) {
      const rope = tube(0.045, 0.045, span * 0.98, materials.rope);
      rope.rotation.z = Math.PI / 2;
      rope.position.set(x + span / 2, 0.95 - droop * 0.28, 0);
      group.add(rope);
    }
  }
  return group;
}

/** The plank bridge over the first gap: alternating warm boards and end posts. */
export function plankBridge(materials: Materials, length: number, width: number): Group {
  const group = new Group();
  const planks = Math.max(4, Math.round(length / 0.62));
  for (let index = 0; index < planks; index += 1) {
    const x = (index / (planks - 1) - 0.5) * (length - 0.6);
    const plank = block(0.5, 0.22, width, index % 2 === 0 ? materials.wood : materials.woodLight, {
      radius: 0.09,
    });
    plank.position.set(x, 0, 0);
    group.add(plank);
  }
  for (const end of [-1, 1]) {
    for (const side of [-1, 1]) {
      const post = tube(0.17, 0.2, 1.6, materials.woodDark);
      post.position.set((end * (length - 0.2)) / 2, 0.55, (side * width) / 2);
      group.add(post);
      const cap = ball(0.2, materials.woodLight);
      cap.position.set((end * (length - 0.2)) / 2, 1.28, (side * width) / 2);
      cap.scale.y = 0.7;
      group.add(cap);
    }
    const rail = tube(0.06, 0.06, length - 0.2, materials.rope);
    rail.rotation.z = Math.PI / 2;
    // Below the character's shoulder: a rail at chest height cuts the player in
    // half from this camera.
    rail.position.set(0, 0.72, (end * width) / 2);
    group.add(rail);
  }
  return group;
}

/** A coin: gold rim, lighter core, and a star cut so it reads at a glance. */
export function coin(materials: Materials): Group {
  const group = new Group();
  const rim = tube(0.42, 0.42, 0.1, materials.coin, { segments: 24 });
  rim.rotation.x = Math.PI / 2;
  group.add(rim);
  const core = tube(0.33, 0.33, 0.14, materials.coinCore, { segments: 24 });
  core.rotation.x = Math.PI / 2;
  group.add(core);
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2 - Math.PI / 2;
    const point = spike(0.075, 0.24, materials.coin, { segments: 6 });
    point.position.set(Math.cos(angle) * 0.14, Math.sin(angle) * 0.14, 0);
    point.rotation.z = -angle + Math.PI / 2;
    point.rotation.x = Math.PI / 2;
    group.add(point);
  }
  return group;
}

/** The patrolling mushroom: red spotted cap, cream body, a cross face. */
export function mushroom(materials: Materials): Group {
  const group = new Group();
  const body = ball(0.42, materials.cream);
  body.scale.set(1, 0.92, 0.95);
  body.position.y = 0.42;
  group.add(body);
  const cap = ball(0.55, materials.capRed);
  cap.scale.set(1, 0.68, 1);
  cap.position.y = 0.74;
  group.add(cap);
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2;
    const spot = ball(0.13, materials.white);
    spot.position.set(Math.cos(angle) * 0.36, 0.86, Math.sin(angle) * 0.36);
    spot.scale.set(1, 0.4, 1);
    group.add(spot);
  }
  for (const side of [-1, 1]) {
    const eye = ball(0.075, materials.ink);
    eye.position.set(side * 0.15, 0.46, 0.38);
    eye.scale.set(0.8, 1.25, 0.6);
    group.add(eye);
    const brow = block(0.16, 0.05, 0.05, materials.ink, { radius: 0.02 });
    brow.position.set(side * 0.16, 0.58, 0.38);
    brow.rotation.z = side * -0.5;
    group.add(brow);
    const foot = ball(0.16, materials.cream);
    foot.position.set(side * 0.22, 0.09, 0.06);
    foot.scale.set(1.1, 0.6, 1.3);
    group.add(foot);
  }
  const mouth = block(0.2, 0.05, 0.05, materials.ink, { radius: 0.02 });
  mouth.position.set(0, 0.3, 0.38);
  group.add(mouth);
  return group;
}

/** The snail from the reference's foreground: spiral shell, sleepy eyes. */
export function snail(materials: Materials): Group {
  const group = new Group();
  const foot = ball(0.5, materials.snail);
  foot.scale.set(1.25, 0.42, 0.7);
  foot.position.y = 0.22;
  group.add(foot);
  const head = ball(0.28, materials.snail);
  head.position.set(0.52, 0.36, 0);
  group.add(head);
  for (const side of [-1, 1]) {
    const stalk = tube(0.045, 0.055, 0.34, materials.snail);
    stalk.position.set(0.6, 0.62, side * 0.13);
    stalk.rotation.z = -0.2;
    group.add(stalk);
    const eye = ball(0.09, materials.white);
    eye.position.set(0.66, 0.79, side * 0.13);
    group.add(eye);
    const pupil = ball(0.045, materials.ink);
    pupil.position.set(0.72, 0.8, side * 0.13);
    group.add(pupil);
  }
  // The shell: a spiral of shrinking balls, which is cheaper and rounder than
  // a torus and reads correctly from the game camera.
  const shell = new Group();
  let radius = 0.42;
  let angle = 0;
  let distance = 0.0;
  for (let index = 0; index < 7; index += 1) {
    const bead = ball(radius, index % 2 === 0 ? materials.shell : materials.capRed);
    bead.position.set(Math.cos(angle) * distance, Math.sin(angle) * distance, 0);
    bead.scale.z = 0.72;
    shell.add(bead);
    angle += 1.15;
    distance += radius * 0.62;
    radius *= 0.84;
  }
  shell.position.set(-0.16, 0.56, 0);
  group.add(shell);
  return group;
}

/** The goal: a checkered post, a bright flag, and a ring of light on the ground. */
export function goalFlag(materials: Materials): Group {
  const group = new Group();
  const base = tube(0.75, 0.95, 0.3, materials.rock, { segments: 20 });
  base.position.y = 0.15;
  group.add(base);
  const ring = tube(0.62, 0.62, 0.08, materials.goal, { segments: 24 });
  ring.position.y = 0.33;
  group.add(ring);
  const pole = tube(0.09, 0.11, 3.4, materials.white);
  pole.position.y = 1.85;
  group.add(pole);
  const knob = ball(0.16, materials.coin);
  knob.position.y = 3.6;
  group.add(knob);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const cell = block(0.34, 0.3, 0.05, (row + column) % 2 === 0 ? materials.goal : materials.white, {
        radius: 0.03,
      });
      cell.position.set(0.28 + column * 0.34, 3.1 - row * 0.3, 0);
      group.add(cell);
    }
  }
  return group;
}

/** Shared helper: mark a whole prop as scenery that receives but rarely casts. */
export function asScenery(object: Object3D, cast = true): Object3D {
  object.traverse((child) => {
    const mesh = child as Mesh;
    if (mesh.isMesh !== true) return;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
  });
  return object;
}

/** A flat-shaded billboard-ish water sheet for the waterfall gaps. */
export function waterfall(width: number, height: number): Mesh {
  const material = new MeshStandardMaterial({
    color: 0x7fd4ff,
    emissive: 0x2f9bd8,
    emissiveIntensity: 0.5,
    roughness: 0.2,
    metalness: 0.1,
    transparent: true,
    opacity: 0.82,
  });
  const sheet = block(width, height, 0.4, material, { radius: 0.18 });
  sheet.castShadow = false;
  return sheet;
}
