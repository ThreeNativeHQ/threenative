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
