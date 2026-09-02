// Generated for you. All arena silhouettes and gameplay visuals start here.
import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
  SphereGeometry,
  UnsignedByteType,
} from "three";

import type { ReturnTypeOfMaterials } from "./types.js";

const roundedCache = new Map<string, BufferGeometry>();

export type ShooterMaterials = ReturnTypeOfMaterials;

export const PICKUP_SPRITE_FRAMES = [
  { x: 0, y: 0, width: 8, height: 8, duration: 0.07 },
  { x: 8, y: 0, width: 12, height: 10, duration: 0.11 },
  { x: 20, y: 2, width: 12, height: 8, duration: 0.15 },
] as const;

const PICKUP_ATLAS_WIDTH = 32;
const PICKUP_ATLAS_HEIGHT = 16;

function setPixel(
  data: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  colour: readonly [number, number, number, number],
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const row = height - 1 - y;
  const index = (row * width + x) * 4;
  data[index] = colour[0];
  data[index + 1] = colour[1];
  data[index + 2] = colour[2];
  data[index + 3] = colour[3];
}

function createPickupAtlas(): DataTexture {
  const data = new Uint8Array(PICKUP_ATLAS_WIDTH * PICKUP_ATLAS_HEIGHT * 4);
  for (let y = 0; y < PICKUP_ATLAS_HEIGHT; y += 1) {
    for (let x = 0; x < PICKUP_ATLAS_WIDTH; x += 1) {
      const frame = PICKUP_SPRITE_FRAMES.find(
        ({ x: left, y: top, width, height }) =>
          x >= left && x < left + width && y >= top && y < top + height,
      );
      if (frame === undefined) continue;
      const localX = x - frame.x - (frame.width - 1) / 2;
      const localY = y - frame.y - (frame.height - 1) / 2;
      const radius = Math.min(frame.width, frame.height) * 0.42;
      if (Math.hypot(localX, localY) > radius) continue;
      const colour: readonly [number, number, number, number] = [
        100 + Math.round((frame.width / 12) * 100),
        225,
        255,
        255,
      ];
      setPixel(data, PICKUP_ATLAS_WIDTH, PICKUP_ATLAS_HEIGHT, x, y, colour);
    }
  }
  const texture = new DataTexture(
    data,
    PICKUP_ATLAS_WIDTH,
    PICKUP_ATLAS_HEIGHT,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

const NAMEPLATE_GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
};

const NAMEPLATE_WIDTH = 48;
const NAMEPLATE_HEIGHT = 12;
const NAMEPLATE_BACKGROUND: readonly [number, number, number, number] = [7, 18, 27, 240];
const NAMEPLATE_INK: readonly [number, number, number, number] = [138, 239, 255, 255];
const NAMEPLATE_BORDER: readonly [number, number, number, number] = [53, 128, 154, 255];

function fillNameplate(data: Uint8Array): void {
  for (let y = 0; y < NAMEPLATE_HEIGHT; y += 1) {
    for (let x = 0; x < NAMEPLATE_WIDTH; x += 1)
      setPixel(data, NAMEPLATE_WIDTH, NAMEPLATE_HEIGHT, x, y, NAMEPLATE_BACKGROUND);
  }
}

function drawNameplateBorder(data: Uint8Array): void {
  for (let x = 0; x < NAMEPLATE_WIDTH; x += 1) {
    setPixel(data, NAMEPLATE_WIDTH, NAMEPLATE_HEIGHT, x, 0, NAMEPLATE_BORDER);
    setPixel(data, NAMEPLATE_WIDTH, NAMEPLATE_HEIGHT, x, NAMEPLATE_HEIGHT - 1, NAMEPLATE_BORDER);
  }
  for (let y = 0; y < NAMEPLATE_HEIGHT; y += 1) {
    setPixel(data, NAMEPLATE_WIDTH, NAMEPLATE_HEIGHT, 0, y, NAMEPLATE_BORDER);
    setPixel(data, NAMEPLATE_WIDTH, NAMEPLATE_HEIGHT, NAMEPLATE_WIDTH - 1, y, NAMEPLATE_BORDER);
  }
}

function drawNameplateText(data: Uint8Array): void {
  for (const [index, character] of [..."TARGET"].entries()) {
    const glyph = NAMEPLATE_GLYPHS[character];
    if (glyph === undefined) continue;
    for (const [row, line] of glyph.entries()) {
      for (const [column, lit] of [...line].entries()) {
        if (lit === "1")
          setPixel(
            data,
            NAMEPLATE_WIDTH,
            NAMEPLATE_HEIGHT,
            6 + index * 7 + column,
            2 + row,
            NAMEPLATE_INK,
          );
      }
    }
  }
}

function createNameplateTexture(): DataTexture {
  const data = new Uint8Array(NAMEPLATE_WIDTH * NAMEPLATE_HEIGHT * 4);
  fillNameplate(data);
  drawNameplateBorder(data);
  drawNameplateText(data);
  const texture = new DataTexture(
    data,
    NAMEPLATE_WIDTH,
    NAMEPLATE_HEIGHT,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createTargetNameplate(): Group {
  const group = new Group();
  group.name = "target-nameplate";
  const mesh = new Mesh(
    new PlaneGeometry(2.4, 0.6),
    new MeshBasicMaterial({
      depthWrite: false,
      map: createNameplateTexture(),
      side: DoubleSide,
      transparent: true,
    }),
  );
  mesh.name = "target-nameplate-surface";
  group.add(mesh);
  return group;
}

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
  const floor = block(22, 0.4, 24, materials.arena);
  floor.name = "arena-floor";
  floor.position.set(0, -0.2, -1);
  group.add(floor);
  // Four walls, not three. In first person the player turns around, and an arena open at the back
  // shows the void the third-person camera never pointed at.
  const walls = [
    { depth: 24, position: [-11, 1.9, -1] as const, width: 0.4 },
    { depth: 24, position: [11, 1.9, -1] as const, width: 0.4 },
    { depth: 0.4, position: [0, 1.9, -13] as const, width: 22 },
    { depth: 0.4, position: [0, 1.9, 11] as const, width: 22 },
  ].map(({ depth, position, width }, index) => {
    const wall = block(width, 4.2, depth, materials.shadow);
    wall.name = `arena-wall-${index}`;
    wall.position.set(position[0], position[1], position[2]);
    group.add(wall);
    return wall;
  });
  // Cover. An arena with a flat floor is a shooting gallery: these are what turns "walk forward
  // and hold fire" into peeking, and they are what the crouch is for.
  const cover = [
    { height: 1.15, position: [-4.6, 0, -3.2] as const, size: [2.4, 1.2] as const },
    { height: 1.15, position: [4.6, 0, -3.2] as const, size: [2.4, 1.2] as const },
    { height: 0.95, position: [0, 0, -7.4] as const, size: [3.6, 1.1] as const },
    { height: 2.6, position: [-7.4, 0, -8.6] as const, size: [1.5, 1.5] as const },
    { height: 2.6, position: [7.4, 0, -8.6] as const, size: [1.5, 1.5] as const },
    { height: 0.9, position: [-2.4, 0, 2.4] as const, size: [1.4, 1.4] as const },
    { height: 0.9, position: [2.4, 0, 2.4] as const, size: [1.4, 1.4] as const },
  ].map(({ height, position, size }, index) => {
    const crate = block(size[0], height, size[1], materials.arena);
    crate.name = `arena-wall-cover-${index}`;
    crate.position.set(position[0], height / 2, position[2]);
    group.add(crate);
    // A lit lip along the top edge, so cover reads as cover at a glance in a dim arena.
    const lip = new Mesh(compactBox(size[0] + 0.06, 0.05, size[1] + 0.06), materials.trim);
    lip.position.set(position[0], height + 0.02, position[2]);
    lip.castShadow = false;
    lip.receiveShadow = false;
    group.add(lip);
    return crate;
  });
  for (let x = -9; x <= 9; x += 3) {
    const strip = new Mesh(compactBox(0.035, 0.012, 22), materials.trim);
    strip.position.set(x, 0.012, -1);
    strip.castShadow = false;
    strip.receiveShadow = false;
    group.add(strip);
  }
  for (let z = -12; z <= 9; z += 3) {
    const strip = new Mesh(compactBox(21, 0.012, 0.035), materials.trim);
    strip.position.set(0, 0.014, z);
    strip.castShadow = false;
    strip.receiveShadow = false;
    group.add(strip);
  }
  return { cover, floor, group, walls };
}

/**
 * The carbine and the hands that hold it, authored pointing -z.
 *
 * Deliberately built from primitives rather than loaded from a `.glb`: a kit that ships a
 * 12 MB weapon model teaches an agent to reach for one, and this reads as a weapon at a
 * fraction of the download. Swap it for a real model by loading a `.glb` in `Scene.load()` and
 * handing it to `preparePlayerConventions` instead — `normaliseToMetres` sizes either one.
 *
 * It is authored at roughly 0.55 m so `normaliseToMetres` has real work to do: the size that
 * ships is the one in `render/scale.ts`, never the one that happened to be convenient here.
 */
export function createViewmodelVisual(materials: ShooterMaterials): Group {
  const group = new Group();
  group.name = "viewmodel";

  const rifle = new Group();
  rifle.name = "held-rifle";

  const part = (
    geometry: BufferGeometry,
    material: Material,
    x: number,
    y: number,
    z: number,
  ): Mesh => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    // The viewmodel is drawn over the arena and never casts into it: a weapon held at the eye
    // throws a shadow the size of the room.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    rifle.add(mesh);
    return mesh;
  };

  part(compactBox(0.062, 0.072, 0.24), materials.gunmetal, 0, 0, -0.02);
  part(compactBox(0.05, 0.052, 0.15), materials.polymer, 0, -0.002, -0.2);
  part(
    new CylinderGeometry(0.011, 0.011, 0.2, 6).rotateX(Math.PI / 2),
    materials.gunmetal,
    0,
    0.012,
    -0.31,
  );
  part(
    new CylinderGeometry(0.021, 0.019, 0.07, 6).rotateX(Math.PI / 2),
    materials.gunmetal,
    0,
    0.012,
    -0.43,
  );
  // Magazine and pistol grip, both raked back the way a real one sits in the hand.
  const magazine = part(compactBox(0.04, 0.13, 0.062), materials.polymer, 0, -0.09, -0.04);
  magazine.rotation.x = -0.16;
  const grip = part(compactBox(0.038, 0.1, 0.05), materials.polymer, 0, -0.075, 0.07);
  grip.rotation.x = 0.3;
  part(compactBox(0.055, 0.062, 0.13), materials.polymer, 0, -0.006, 0.13);
  // The optic. `preparePlayerConventions` does not look for it by name, but a rigged replacement
  // usually ships one called this, and the aiming pose is authored against its position.
  const optic = part(compactBox(0.036, 0.038, 0.07), materials.gunmetal, 0, 0.057, -0.01);
  optic.name = "optic";
  part(compactBox(0.008, 0.008, 0.008), materials.sight, 0, 0.058, -0.045);
  part(compactBox(0.044, 0.012, 0.09), materials.gunmetal, 0, 0.04, -0.02);

  group.add(rifle);

  // Two gloved forearms. They live outside `held-rifle` so `normaliseToMetres` measures the
  // weapon and not the person carrying it.
  const arms = new Group();
  arms.name = "viewmodel-arms";
  const forearm = (x: number, y: number, z: number, pitch: number, yaw: number): void => {
    const mesh = new Mesh(compactBox(0.058, 0.055, 0.26), materials.glove);
    mesh.position.set(x, y, z);
    mesh.rotation.set(pitch, yaw, 0);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    arms.add(mesh);
  };
  forearm(0.06, -0.13, 0.16, 0.42, -0.3);
  forearm(-0.07, -0.11, -0.11, 0.34, 0.36);
  group.add(arms);
  return group;
}

/**
 * What the player sees when they look down: hips, thighs, shins, boots.
 *
 * Nothing above the waist, because a chest at eye height fills the frame and clips through the
 * near plane. `GroundSnap` measures this group, so the boots are what meets the floor.
 */
export function createLegsVisual(materials: ShooterMaterials): Group {
  const group = new Group();
  group.name = "player-legs";
  const leg = (side: number): void => {
    const thigh = block(0.19, 0.44, 0.21, materials.player);
    thigh.position.set(side * 0.13, -0.24, 0);
    group.add(thigh);
    const shin = block(0.15, 0.4, 0.17, materials.shadow);
    shin.position.set(side * 0.13, -0.64, 0.01);
    group.add(shin);
    const boot = block(0.17, 0.11, 0.3, materials.trim);
    boot.position.set(side * 0.13, -0.855, -0.04);
    group.add(boot);
  };
  leg(-1);
  leg(1);
  const hips = block(0.42, 0.2, 0.24, materials.player);
  hips.position.y = -0.02;
  group.add(hips);
  return group;
}

export function createTargetVisual(materials: ShooterMaterials): Group {
  const group = new Group();
  group.name = "target-visual";
  // Keep a non-zero parent rotation in the stock scene so the nameplate demonstrates world-space
  // billboarding instead of accidentally passing only in the unparented case.
  group.rotation.y = 0.22;
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
  const nameplate = createTargetNameplate();
  nameplate.position.y = 2.1;
  group.add(nameplate);
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
  const animated = new Mesh(
    new PlaneGeometry(0.9, 0.9),
    new MeshBasicMaterial({
      depthWrite: false,
      map: createPickupAtlas(),
      side: DoubleSide,
      transparent: true,
    }),
  );
  animated.name = "pickup-animation";
  animated.position.y = 0.7;
  group.add(animated);
  return group;
}

export function createProjectileVisual(materials: ShooterMaterials): Mesh {
  return shadowed(new Mesh(new SphereGeometry(0.12, 4, 3), materials.trim), false);
}
