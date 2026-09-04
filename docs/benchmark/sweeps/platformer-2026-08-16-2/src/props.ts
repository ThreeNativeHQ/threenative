import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three/webgpu";
import { PALETTE } from "./palette.js";

const materialCache = new Map<string, MeshStandardMaterial>();

/** Shared toy-plastic material: high roughness, zero metal, saturated base. */
export function matte(color: Color, roughness = 0.85): MeshStandardMaterial {
  const key = `${color.getHexString()}:${roughness}`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const material = new MeshStandardMaterial({ color, roughness, metalness: 0 });
  materialCache.set(key, material);
  return material;
}

export function shiny(color: Color, emissive = 0.18): MeshStandardMaterial {
  const key = `shiny:${color.getHexString()}:${emissive}`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const material = new MeshStandardMaterial({
    color,
    roughness: 0.28,
    metalness: 0.55,
    emissive: color.clone().multiplyScalar(emissive),
  });
  materialCache.set(key, material);
  return material;
}

function solid(geometry: BufferGeometry, color: Color): Mesh {
  const mesh = new Mesh(geometry, matte(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A grass-topped island: bright cap, rounded lip, tapered rock skirt. */
export function makeIsland(width: number, depth: number, height: number): Group {
  const group = new Group();

  const cap = solid(new BoxGeometry(width, 0.55, depth), PALETTE.grass);
  cap.position.y = -0.28;
  group.add(cap);

  const lip = solid(new BoxGeometry(width + 0.28, 0.34, depth + 0.28), PALETTE.grassLight);
  lip.position.y = -0.16;
  group.add(lip);

  // stepped rock strata, each layer inset — reads as a tapered cliff, not a grey box
  const strata: Array<[number, number, Color]> = [
    [0.0, 0.34, PALETTE.rock],
    [0.5, 0.3, PALETTE.rockMid],
    [1.15, 0.26, PALETTE.rockDark],
  ];
  let cursor = -0.5;
  for (const [inset, share, color] of strata) {
    const layerHeight = height * share;
    const layer = solid(
      new BoxGeometry(Math.max(0.6, width - inset * 2), layerHeight, Math.max(0.6, depth - inset * 2)),
      color,
    );
    layer.position.y = cursor - layerHeight / 2;
    cursor -= layerHeight;
    group.add(layer);
  }
  const tip = new Mesh(
    new ConeGeometry(Math.min(width, depth) * 0.22, height * 0.28, 8),
    matte(PALETTE.rockDark),
  );
  tip.position.y = cursor - height * 0.14 + 0.08;
  tip.rotation.y = Math.PI / 7;
  tip.castShadow = true;
  group.add(tip);

  // vertical striation on the faces the camera sees, so the cliff is not one flat slab
  const columns = Math.max(2, Math.round(width / 2.2));
  for (let index = 0; index < columns; index += 1) {
    const tone = index % 2 === 0 ? PALETTE.rockMid : PALETTE.rock;
    const bandHeight = height * (0.26 + (index % 3) * 0.06);
    for (const [face, extent] of [
      ["z", depth],
      ["x", width],
    ] as Array<["z" | "x", number]>) {
      const span = face === "z" ? width : depth;
      const band = solid(
        face === "z"
          ? new BoxGeometry(span / columns - 0.22, bandHeight, 0.18)
          : new BoxGeometry(0.18, bandHeight, span / columns - 0.22),
        tone,
      );
      const along = -span / 2 + span / (columns * 2) + (index * span) / columns;
      band.position.set(
        face === "z" ? along : extent / 2 - 0.06,
        -0.5 - height * 0.17 - bandHeight / 2 + height * 0.18,
        face === "z" ? extent / 2 - 0.06 : along,
      );
      group.add(band);
    }
  }

  // grass tufts spilling over the lip on both visible edges
  const tuftCount = Math.max(3, Math.round(width * 1.1));
  for (let index = 0; index < tuftCount; index += 1) {
    for (const side of [1, -1]) {
      const tuft = solid(
        new SphereGeometry(0.3 + (index % 3) * 0.09, 8, 6),
        index % 2 === 0 ? PALETTE.grassDark : PALETTE.leaf,
      );
      tuft.position.set(
        -width / 2 + 0.4 + (index * (width - 0.8)) / Math.max(1, tuftCount - 1),
        -0.44 - (index % 3) * 0.05,
        (side * (depth + 0.1)) / 2,
      );
      tuft.scale.set(1, 0.8, 0.7);
      group.add(tuft);
    }
  }
  return group;
}

export function makePine(scale = 1): Group {
  const group = new Group();
  const trunk = solid(new CylinderGeometry(0.13, 0.17, 0.7, 7), PALETTE.woodDark);
  trunk.position.y = 0.35;
  group.add(trunk);
  const tiers = [
    { radius: 0.75, height: 1.1, y: 1.0, color: PALETTE.leafDeep },
    { radius: 0.6, height: 1.0, y: 1.6, color: PALETTE.leaf },
    { radius: 0.42, height: 0.9, y: 2.15, color: PALETTE.grassLight },
  ];
  for (const tier of tiers) {
    const cone = new Mesh(new ConeGeometry(tier.radius, tier.height, 9), matte(tier.color));
    cone.position.y = tier.y;
    cone.castShadow = true;
    cone.receiveShadow = true;
    group.add(cone);
  }
  group.scale.setScalar(scale);
  return group;
}

export function makeRoundTree(scale = 1): Group {
  const group = new Group();
  const trunk = solid(new CylinderGeometry(0.16, 0.24, 0.9, 8), PALETTE.woodDark);
  trunk.position.y = 0.45;
  group.add(trunk);
  const blobs = [
    { x: 0, y: 1.5, z: 0, r: 0.85, c: PALETTE.leaf },
    { x: -0.6, y: 1.2, z: 0.2, r: 0.6, c: PALETTE.leafDeep },
    { x: 0.62, y: 1.25, z: -0.15, r: 0.62, c: PALETTE.leafDeep },
    { x: 0.1, y: 2.0, z: 0.1, r: 0.55, c: PALETTE.grassLight },
  ];
  for (const blob of blobs) {
    const sphere = new Mesh(new IcosahedronGeometry(blob.r, 1), matte(blob.c));
    sphere.position.set(blob.x, blob.y, blob.z);
    sphere.scale.set(1, 0.86, 1);
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    group.add(sphere);
  }
  group.scale.setScalar(scale);
  return group;
}

export function makeBush(scale = 1): Group {
  const group = new Group();
  for (let index = 0; index < 3; index += 1) {
    const blob = new Mesh(new IcosahedronGeometry(0.34 - index * 0.05, 1), matte(PALETTE.leaf));
    blob.position.set(-0.28 + index * 0.3, 0.22 + (index === 1 ? 0.12 : 0), index === 1 ? 0.06 : 0);
    blob.castShadow = true;
    blob.receiveShadow = true;
    group.add(blob);
  }
  group.scale.setScalar(scale);
  return group;
}

export function makeFlower(color: Color): Group {
  const group = new Group();
  const stem = solid(new CylinderGeometry(0.02, 0.02, 0.22, 5), PALETTE.leafDeep);
  stem.position.y = 0.11;
  group.add(stem);
  for (let index = 0; index < 5; index += 1) {
    const petal = new Mesh(new SphereGeometry(0.07, 6, 5), matte(color));
    const angle = (index / 5) * Math.PI * 2;
    petal.position.set(Math.cos(angle) * 0.08, 0.24, Math.sin(angle) * 0.08);
    group.add(petal);
  }
  const middle = new Mesh(new SphereGeometry(0.06, 6, 5), matte(PALETTE.gold));
  middle.position.y = 0.26;
  group.add(middle);
  return group;
}

/** Wooden fence: two chunky posts with a slack rope between them. */
export function makeFencePost(height = 1.0): Group {
  const group = new Group();
  const post = solid(new CylinderGeometry(0.14, 0.16, height, 8), PALETTE.wood);
  post.position.y = height / 2;
  group.add(post);
  const cap = solid(new CylinderGeometry(0.17, 0.15, 0.12, 8), PALETTE.woodLight);
  cap.position.y = height;
  group.add(cap);
  return group;
}

export function makeRope(length: number, sag = 0.18): Group {
  const group = new Group();
  const segments = 8;
  const up = new Vector3(0, 1, 0);
  const pointAt = (t: number): Vector3 =>
    new Vector3(-length / 2 + t * length, -Math.sin(t * Math.PI) * sag, 0);
  for (let index = 0; index < segments; index += 1) {
    const start = pointAt(index / segments);
    const end = pointAt((index + 1) / segments);
    const direction = end.clone().sub(start);
    const piece = solid(
      new CylinderGeometry(0.045, 0.045, direction.length() * 1.06, 6),
      PALETTE.rope,
    );
    piece.position.copy(start).add(end).multiplyScalar(0.5);
    piece.quaternion.setFromUnitVectors(up, direction.clone().normalize());
    group.add(piece);
  }
  return group;
}

/** Plank bridge in warm wood, the reference's foreground motif. */
export function makeBridge(length: number, width: number): Group {
  const group = new Group();
  const plankCount = Math.round(length / 0.62);
  for (let index = 0; index < plankCount; index += 1) {
    const tone = index % 2 === 0 ? PALETTE.wood : PALETTE.woodLight;
    const plank = solid(new BoxGeometry(0.55, 0.22, width), tone);
    plank.position.set(-length / 2 + 0.31 + index * 0.62, -0.11, 0);
    group.add(plank);
  }
  for (const side of [-1, 1]) {
    const beam = solid(new BoxGeometry(length, 0.18, 0.22), PALETTE.woodDark);
    beam.position.set(0, -0.3, (side * width) / 2 - side * 0.12);
    group.add(beam);
    for (const end of [-1, 1]) {
      const post = makeFencePost(1.25);
      post.position.set((end * length) / 2 - end * 0.3, -0.22, (side * width) / 2);
      group.add(post);
      const stump = solid(new CylinderGeometry(0.3, 0.34, 1.4, 9), PALETTE.woodDark);
      stump.position.set((end * length) / 2 - end * 0.3, -0.95, (side * width) / 2);
      group.add(stump);
    }
    const rope = makeRope(length - 0.6, 0.22);
    rope.position.set(0, 0.85, (side * width) / 2);
    group.add(rope);
  }
  return group;
}

/** Banded wooden crate — reference foreground filler. */
export function makeCrate(size = 1): Group {
  const group = new Group();
  const box = solid(new BoxGeometry(size, size, size), PALETTE.wood);
  box.position.y = size / 2;
  group.add(box);
  for (const axis of ["x", "z"] as const) {
    for (const side of [-1, 1]) {
      const band = solid(
        axis === "x"
          ? new BoxGeometry(size * 1.04, size * 0.16, size * 0.14)
          : new BoxGeometry(size * 0.14, size * 0.16, size * 1.04),
        PALETTE.woodDark,
      );
      band.position.set(
        axis === "z" ? (side * size) / 2.4 : 0,
        size / 2,
        axis === "x" ? (side * size) / 2.4 : 0,
      );
      group.add(band);
    }
  }
  const frame = solid(new BoxGeometry(size * 1.02, size * 0.12, size * 1.02), PALETTE.woodDark);
  frame.position.y = size * 0.97;
  group.add(frame);
  return group;
}

/** Floating "?" block, straight out of the reference's right-hand side. */
export function makeQuestionBlock(size = 1): Group {
  const group = new Group();
  const box = solid(new BoxGeometry(size, size, size), new Color("#f2a12a"));
  box.position.y = size / 2;
  group.add(box);
  for (const [x, z] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ] as Array<[number, number]>) {
    const mark = new Mesh(new BoxGeometry(size * 0.16, size * 0.34, size * 0.08), matte(PALETTE.cloud));
    mark.position.set((x * size) / 2 + 0, size * 0.58, (z * size) / 2);
    mark.rotation.y = x !== 0 ? Math.PI / 2 : 0;
    group.add(mark);
    const dot = new Mesh(new BoxGeometry(size * 0.14, size * 0.14, size * 0.08), matte(PALETTE.cloud));
    dot.position.set((x * size) / 2, size * 0.3, (z * size) / 2);
    dot.rotation.y = x !== 0 ? Math.PI / 2 : 0;
    group.add(dot);
  }
  for (const [cx, cz] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as Array<[number, number]>) {
    const rivet = new Mesh(new SphereGeometry(size * 0.07, 8, 6), matte(new Color("#c96f14")));
    rivet.position.set((cx * size) / 2.4, size * 0.14, (cz * size) / 2.4);
    group.add(rivet);
  }
  return group;
}

/** Weathered boulder cluster. */
export function makeRocks(scale = 1): Group {
  const group = new Group();
  const spots: Array<[number, number, number, number]> = [
    [0, 0.22, 0, 0.36],
    [0.42, 0.14, 0.16, 0.24],
    [-0.34, 0.12, -0.18, 0.2],
  ];
  for (const [x, y, z, radius] of spots) {
    const rock = new Mesh(new IcosahedronGeometry(radius, 0), matte(PALETTE.rockMid));
    rock.position.set(x, y, z);
    rock.rotation.set(x, y * 3, z);
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }
  group.scale.setScalar(scale);
  return group;
}

/** Stone keep with battlements and a pennant — the reference's mid-distance landmark. */
export function makeCastle(scale = 1): Group {
  const group = new Group();
  const stone = new Color("#b9a692");
  const stoneDark = new Color("#8e7d6c");
  const roof = new Color("#2f8fd8");

  const keep = solid(new BoxGeometry(4.4, 6.0, 4.4), stone);
  keep.position.y = 3.0;
  group.add(keep);
  const band = solid(new BoxGeometry(4.7, 0.5, 4.7), stoneDark);
  band.position.y = 3.4;
  group.add(band);
  const crown = solid(new BoxGeometry(5.2, 0.7, 5.2), stoneDark);
  crown.position.y = 6.3;
  group.add(crown);
  for (let index = 0; index < 8; index += 1) {
    const side = index % 4;
    const slot = index < 4 ? -1 : 1;
    const merlon = solid(new BoxGeometry(0.7, 0.8, 0.7), stone);
    const offset = slot * 1.6;
    merlon.position.set(
      side < 2 ? offset : (side === 2 ? -1 : 1) * 2.3,
      7.0,
      side < 2 ? (side === 0 ? -2.3 : 2.3) : offset,
    );
    group.add(merlon);
  }

  for (const [x, z] of [
    [-2.6, -2.6],
    [2.6, 2.6],
    [2.6, -2.6],
  ] as Array<[number, number]>) {
    const tower = solid(new CylinderGeometry(1.0, 1.15, 8.0, 12), stone);
    tower.position.set(x, 4.0, z);
    group.add(tower);
    const cone = new Mesh(new ConeGeometry(1.35, 2.2, 12), matte(roof));
    cone.position.set(x, 9.1, z);
    cone.castShadow = true;
    group.add(cone);
    const finial = new Mesh(new SphereGeometry(0.2, 8, 6), shiny(PALETTE.gold, 0.5));
    finial.position.set(x, 10.35, z);
    group.add(finial);
  }

  const door = solid(new BoxGeometry(1.2, 1.8, 0.2), PALETTE.woodDark);
  door.position.set(0, 0.9, 2.25);
  group.add(door);
  for (const y of [2.6, 4.6]) {
    const window = solid(new BoxGeometry(0.5, 0.8, 0.16), new Color("#2a4c74"));
    window.position.set(0, y, 2.25);
    group.add(window);
  }

  const pole = solid(new CylinderGeometry(0.07, 0.07, 2.4, 8), PALETTE.woodLight);
  pole.position.set(0, 8.4, 0);
  group.add(pole);
  const pennant = new Mesh(
    new PlaneGeometry(1.1, 0.6),
    new MeshStandardMaterial({ color: PALETTE.flag, roughness: 0.6, metalness: 0, side: DoubleSide }),
  );
  pennant.position.set(0.55, 9.2, 0);
  group.add(pennant);

  group.scale.setScalar(scale);
  return group;
}

/** Four-bladed windmill; the sails turn from the caller's tick. */
export function makeWindmill(scale = 1): { group: Group; sails: Group } {
  const group = new Group();
  const body = solid(new CylinderGeometry(1.1, 1.6, 4.6, 12), new Color("#e8dcc4"));
  body.position.y = 2.3;
  group.add(body);
  const cap = new Mesh(new ConeGeometry(1.5, 1.4, 12), matte(new Color("#c0432f")));
  cap.position.y = 5.2;
  cap.castShadow = true;
  group.add(cap);
  const door = solid(new BoxGeometry(0.7, 1.2, 0.2), PALETTE.woodDark);
  door.position.set(0, 0.6, 1.35);
  group.add(door);

  const sails = new Group();
  sails.position.set(0, 4.5, 1.5);
  group.add(sails);
  const hub = solid(new CylinderGeometry(0.2, 0.2, 0.4, 8), PALETTE.woodDark);
  hub.rotation.x = Math.PI / 2;
  sails.add(hub);
  for (let index = 0; index < 4; index += 1) {
    const arm = new Group();
    arm.rotation.z = (index / 4) * Math.PI * 2;
    sails.add(arm);
    const spar = solid(new BoxGeometry(0.16, 3.2, 0.16), PALETTE.woodDark);
    spar.position.y = 1.6;
    arm.add(spar);
    const blade = solid(new BoxGeometry(0.62, 2.4, 0.08), new Color("#f4ead2"));
    blade.position.set(0.42, 1.9, 0.08);
    arm.add(blade);
  }

  group.scale.setScalar(scale);
  return { group, sails };
}

export function makeCloud(scale = 1): Group {
  const group = new Group();
  const puffs = [
    { x: 0, y: 0, z: 0, r: 1.0 },
    { x: -1.15, y: -0.2, z: 0.1, r: 0.72 },
    { x: 1.1, y: -0.16, z: -0.1, r: 0.8 },
    { x: 0.35, y: 0.55, z: 0.15, r: 0.65 },
    { x: -0.55, y: 0.45, z: -0.12, r: 0.58 },
    { x: 2.0, y: -0.35, z: 0.05, r: 0.5 },
  ];
  for (const puff of puffs) {
    const mesh = new Mesh(
      new IcosahedronGeometry(puff.r, 2),
      new MeshStandardMaterial({
        color: PALETTE.cloud,
        roughness: 1,
        metalness: 0,
        emissive: PALETTE.cloudShade,
        emissiveIntensity: 0.45,
      }),
    );
    mesh.position.set(puff.x, puff.y, puff.z);
    mesh.scale.set(1, 0.78, 0.9);
    group.add(mesh);
  }
  group.scale.setScalar(scale);
  return group;
}

/** Five-pointed star outline, used on coin faces and the goal flag. */
export function starGeometry(outer: number, inner: number, points = 5): ShapeGeometry {
  const shape = new Shape();
  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = (index / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new ShapeGeometry(shape);
}

/** Spinning gold coin with an embossed star face. */
export function makeCoin(): Group {
  const group = new Group();
  const disc = new Mesh(new CylinderGeometry(0.3, 0.3, 0.1, 22), shiny(PALETTE.gold, 0.34));
  disc.rotation.x = Math.PI / 2;
  disc.castShadow = true;
  group.add(disc);
  const rim = new Mesh(new TorusGeometry(0.285, 0.055, 8, 24), shiny(PALETTE.goldDeep, 0.26));
  group.add(rim);
  for (const face of [-1, 1]) {
    const star = new Mesh(starGeometry(0.17, 0.08), shiny(PALETTE.goldDeep, 0.4));
    star.position.z = face * 0.055;
    star.rotation.y = face < 0 ? Math.PI : 0;
    group.add(star);
  }
  return group;
}

/** Red-capped mushroom walker with white spots and a grumpy face. */
export function makeMushroom(): Group {
  const group = new Group();
  const stem = solid(new CapsuleGeometry(0.34, 0.26, 5, 12), PALETTE.mushroomStem);
  stem.position.y = 0.45;
  group.add(stem);

  const cap = new Mesh(new SphereGeometry(0.56, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), matte(PALETTE.mushroomCap));
  cap.position.y = 0.74;
  cap.scale.set(1, 0.82, 1);
  cap.castShadow = true;
  group.add(cap);
  const capUnder = solid(new CylinderGeometry(0.55, 0.5, 0.14, 18), PALETTE.mushroomStem);
  capUnder.position.y = 0.71;
  group.add(capUnder);

  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2 + 0.4;
    const spot = new Mesh(new SphereGeometry(0.13, 10, 8), matte(PALETTE.cloud));
    spot.position.set(Math.cos(angle) * 0.34, 0.92 + Math.sin(index) * 0.04, Math.sin(angle) * 0.34);
    spot.scale.set(1, 0.5, 1);
    group.add(spot);
  }

  for (const side of [-1, 1]) {
    const eye = new Mesh(new SphereGeometry(0.09, 10, 8), matte(new Color("#241a14")));
    eye.position.set(side * 0.15, 0.5, 0.31);
    group.add(eye);
    const brow = solid(new BoxGeometry(0.16, 0.05, 0.05), new Color("#241a14"));
    brow.position.set(side * 0.16, 0.63, 0.3);
    brow.rotation.z = side * -0.4;
    group.add(brow);
    const foot = solid(new SphereGeometry(0.14, 8, 6), PALETTE.mushroomStem);
    foot.position.set(side * 0.18, 0.12, 0.04);
    foot.scale.set(1, 0.7, 1.3);
    group.add(foot);
  }
  return group;
}

/** Goal flag: striped pole, cyan pennant, spinning star. */
export function makeGoalFlag(): { group: Group; star: Object3D; pennant: Object3D } {
  const group = new Group();
  const base = solid(new CylinderGeometry(0.62, 0.75, 0.36, 12), PALETTE.rock);
  base.position.y = 0.18;
  group.add(base);
  const pole = solid(new CylinderGeometry(0.09, 0.11, 3.4, 10), PALETTE.woodLight);
  pole.position.y = 1.9;
  group.add(pole);

  const pennant = new Mesh(
    new PlaneGeometry(1.25, 0.75, 8, 2),
    new MeshStandardMaterial({
      color: PALETTE.flag,
      roughness: 0.55,
      metalness: 0,
      side: DoubleSide,
      emissive: PALETTE.flag.clone().multiplyScalar(0.22),
    }),
  );
  const pennantPosition = pennant.geometry.attributes.position;
  if (pennantPosition) {
    for (let index = 0; index < pennantPosition.count; index += 1) {
      const x = pennantPosition.getX(index);
      pennantPosition.setZ(index, Math.sin((x + 0.62) * 3.4) * 0.16 * (x + 0.62));
    }
    pennant.geometry.computeVertexNormals();
  }
  pennant.rotation.y = -0.25;
  pennant.position.set(0.66, 3.15, 0);
  pennant.castShadow = true;
  group.add(pennant);

  const starMaterial = new MeshStandardMaterial({
    color: PALETTE.gold,
    roughness: 0.35,
    metalness: 0.1,
    emissive: PALETTE.gold.clone().multiplyScalar(0.55),
  });
  const star = new Mesh(starGeometry(0.55, 0.24), starMaterial);
  star.position.set(0, 2.35, 0.14);
  group.add(star);
  const starBack = new Mesh(starGeometry(0.55, 0.24), starMaterial);
  starBack.position.set(0, 0, -0.28);
  starBack.rotation.y = Math.PI;
  star.add(starBack);

  const ring = new Mesh(new TorusGeometry(0.9, 0.07, 8, 28), shiny(PALETTE.flag, 0.5));
  ring.position.y = 0.9;
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  return { group, star, pennant };
}

/** Translucent falling water for the background cliffs. */
export function makeWaterfall(width: number, height: number): Mesh {
  const mesh = new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({ color: PALETTE.water, transparent: true, opacity: 0.85, side: DoubleSide }),
  );
  return mesh;
}
