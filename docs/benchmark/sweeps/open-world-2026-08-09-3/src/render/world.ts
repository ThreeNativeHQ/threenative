import type { Ctx } from "@threenative/core";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  type MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import type { GameState } from "../state.js";
import { palette } from "./palette.js";

export const CHUNK_SIZE = 80;
const WORLD_DEPTH = 500;
const SEGMENTS_X = 24;
const SEGMENTS_Z = 56;

export type WorldMaterials = {
  readonly bark: MeshStandardMaterial;
  readonly grass: MeshStandardMaterial;
  readonly grassBlade: MeshStandardMaterial;
  readonly leaf: MeshStandardMaterial;
  readonly leafLight: MeshStandardMaterial;
  readonly path: MeshStandardMaterial;
  readonly rock: MeshStandardMaterial;
  readonly rockLight: MeshStandardMaterial;
};

function hash(value: number): number {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function pathCenter(x: number): number {
  return Math.sin(x * 0.018) * 9 + Math.sin(x * 0.007) * 5;
}

function terrainRelief(x: number, z: number): number {
  const broad = Math.sin(x * 0.014) * 5.2 + Math.cos(z * 0.018) * 4.1;
  const ridge = Math.sin((x + z) * 0.035) * 2.4 + Math.cos((x - z) * 0.021) * 1.8;
  const valleyWalls = Math.pow(Math.min(1, Math.abs(z - pathCenter(x)) / 180), 1.35) * 12;
  return broad + ridge + Math.sin(z * 0.062) * 1.1 + valleyWalls;
}

export function terrainHeight(x: number, z: number): number {
  const relief = terrainRelief(x, z);
  const pathDistance = Math.abs(z - pathCenter(x));
  const pathBlend = Math.max(0, 1 - pathDistance / 14);
  const trailHeight = terrainRelief(x, pathCenter(x)) - 0.38;
  return relief * (1 - pathBlend) + trailHeight * pathBlend;
}

function createTerrain(index: number, materials: WorldMaterials): Group {
  const centerX = index * CHUNK_SIZE;
  const group = new Group();
  group.name = `terrain-chunk-${index}`;
  const geometry = new PlaneGeometry(CHUNK_SIZE, WORLD_DEPTH, SEGMENTS_X, SEGMENTS_Z);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const dark = new Color(palette.grassDark);
  const grass = new Color(palette.grass);
  const light = new Color(palette.grassLight);
  const color = new Color();
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const worldX = centerX + position.getX(vertex);
    const worldZ = position.getZ(vertex);
    const y = terrainHeight(worldX, worldZ);
    position.setY(vertex, y);
    const t = Math.max(0, Math.min(1, (y + 10) / 24));
    color.copy(dark).lerp(grass, Math.min(1, t * 1.5)).lerp(light, Math.max(0, t - 0.55) * 0.75);
    colors.set([color.r, color.g, color.b], vertex * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const ground = new Mesh(geometry, materials.grass);
  ground.position.x = centerX;
  ground.receiveShadow = true;
  group.add(ground);

  const pathGeometry = new BufferGeometry();
  const pathPositions: number[] = [];
  const pathIndices: number[] = [];
  const steps = 40;
  for (let step = 0; step <= steps; step += 1) {
    const x = centerX - CHUNK_SIZE / 2 + (step / steps) * CHUNK_SIZE;
    const center = pathCenter(x);
    const width = 3.9 + Math.sin(x * 0.11) * 0.55;
    const pathY = terrainHeight(x, center) + 0.16;
    for (const z of [center - width, center + width]) {
      pathPositions.push(x, pathY, z);
    }
    if (step < steps) {
      const base = step * 2;
      pathIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  pathGeometry.setAttribute("position", new BufferAttribute(new Float32Array(pathPositions), 3));
  pathGeometry.setIndex(pathIndices);
  pathGeometry.computeVertexNormals();
  const path = new Mesh(pathGeometry, materials.path);
  path.receiveShadow = true;
  group.add(path);
  return group;
}

function addTree(group: Group, x: number, z: number, scale: number, materials: WorldMaterials): void {
  const tree = new Group();
  const y = terrainHeight(x, z);
  const trunk = new Mesh(new CylinderGeometry(0.35 * scale, 0.62 * scale, 5.5 * scale, 7), materials.bark);
  trunk.position.y = 2.7 * scale;
  trunk.castShadow = true;
  tree.add(trunk);
  for (let index = 0; index < 5; index += 1) {
    const crown = new Mesh(new IcosahedronGeometry((1.8 + (index % 2) * 0.45) * scale, 1), index % 2 ? materials.leafLight : materials.leaf);
    crown.position.set((index - 2) * 0.78 * scale, (5.3 + Math.abs(index - 2) * 0.22) * scale, ((index % 2) - 0.5) * scale);
    crown.castShadow = true;
    tree.add(crown);
  }
  tree.position.set(x, y, z);
  group.add(tree);
}

function addMesa(group: Group, materials: WorldMaterials): void {
  const x = 118;
  const z = -72;
  const base = terrainHeight(x, z);
  for (let level = 0; level < 3; level += 1) {
    const rock = new Mesh(new CylinderGeometry(18 - level * 3, 24 - level * 2, 8, 7), level === 2 ? materials.rockLight : materials.rock);
    rock.position.set(x + level * 1.5, base + 4 + level * 7.2, z);
    rock.rotation.y = level * 0.34;
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }
  for (let index = 0; index < 5; index += 1) addTree(group, x - 11 + index * 5, z + (index % 2) * 5, 0.75, materials);
}

function addArch(group: Group, materials: WorldMaterials): void {
  const x = 282;
  const z = 28;
  const y = terrainHeight(x, z);
  const left = new Mesh(new DodecahedronGeometry(4.7, 0), materials.rockLight);
  const right = left.clone();
  left.scale.set(0.8, 2.25, 0.9);
  right.scale.set(0.82, 2, 0.95);
  left.position.set(x, y + 6, z - 7);
  right.position.set(x, y + 5.5, z + 7);
  const lintel = new Mesh(new DodecahedronGeometry(5.6, 0), materials.rockLight);
  lintel.scale.set(0.9, 0.65, 2.2);
  lintel.position.set(x, y + 12.2, z);
  for (const mesh of [left, right, lintel]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

function decorate(index: number, group: Group, materials: WorldMaterials): void {
  const centerX = index * CHUNK_SIZE;
  const bladeGeometry = new ConeGeometry(0.12, 1.15, 3);
  const grass = new InstancedMesh(bladeGeometry, materials.grassBlade, 300);
  const rockGeometry = new DodecahedronGeometry(1, 0);
  const rocks = new InstancedMesh(rockGeometry, materials.rock, 24);
  const matrix = new Matrix4();
  const point = new Vector3();
  const rotation = new Quaternion();
  for (let instance = 0; instance < 300; instance += 1) {
    const x = centerX - 39 + hash(index * 1000 + instance) * 78;
    const z = -220 + hash(index * 1700 + instance + 71) * 440;
    const pathDistance = Math.abs(z - pathCenter(x));
    const hidden = pathDistance < 5.2;
    const scale = hidden ? 0 : 0.55 + hash(instance + index * 91) * 0.75;
    point.set(x, terrainHeight(x, z) + scale * 0.5, z);
    rotation.setFromAxisAngle(new Vector3(0, 1, 0), hash(instance) * Math.PI * 2);
    matrix.compose(point, rotation, new Vector3(scale, scale, scale));
    grass.setMatrixAt(instance, matrix);
  }
  grass.castShadow = true;
  group.add(grass);
  for (let instance = 0; instance < 24; instance += 1) {
    const x = centerX - 36 + hash(index * 300 + instance) * 72;
    const z = -190 + hash(index * 500 + instance + 9) * 380;
    const scale = 0.55 + hash(instance * 8 + index) * 1.7;
    point.set(x, terrainHeight(x, z) + scale * 0.45, z);
    rotation.setFromAxisAngle(new Vector3(0, 1, 0), hash(instance * 3) * Math.PI * 2);
    matrix.compose(point, rotation, new Vector3(scale * 1.4, scale * 0.8, scale));
    rocks.setMatrixAt(instance, matrix);
  }
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  group.add(rocks);
  for (let tree = 0; tree < 10; tree += 1) {
    const x = centerX - 34 + hash(index * 41 + tree) * 68;
    let z = -180 + hash(index * 67 + tree + 20) * 360;
    if (Math.abs(z - pathCenter(x)) < 13) z += z > 0 ? 22 : -22;
    addTree(group, x, z, 0.75 + hash(tree + index * 12) * 0.85, materials);
  }
  for (const side of [-1, 1]) {
    for (let peak = 0; peak < 3; peak += 1) {
      const x = centerX + 5 + peak * 24;
      const z = side * (188 + peak * 16);
      const mountain = new Mesh(new ConeGeometry(32 + peak * 6, 48 + peak * 13, 7), peak % 2 ? materials.rockLight : materials.rock);
      mountain.position.set(x, terrainHeight(x, z) + 19, z);
      mountain.rotation.y = peak * 0.7;
      mountain.receiveShadow = true;
      group.add(mountain);
    }
  }
  if (index === 0) addTree(group, 25, 28, 2.1, materials);
  if (index === 1) addMesa(group, materials);
  if (index === 4) addArch(group, materials);
}

class WorldChunk {
  readonly group: Group;

  constructor(readonly index: number, materials: WorldMaterials) {
    this.group = createTerrain(index, materials);
    decorate(index, this.group, materials);
  }

  debug(): { index: number; position: number[] } {
    return { index: this.index, position: [this.index * CHUNK_SIZE, 0, 0] };
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

export class StreamedWorld {
  readonly active: number[] = [];
  readonly #chunks = new Map<number, WorldChunk>();

  constructor(
    readonly ctx: Ctx<GameState>,
    readonly materials: WorldMaterials,
  ) {}

  update(playerX: number): number {
    const current = Math.floor((playerX + CHUNK_SIZE / 2) / CHUNK_SIZE);
    const required = new Set([current - 1, current, current + 1]);
    for (const [index] of this.#chunks) {
      if (required.has(index)) continue;
      this.ctx.entities.remove(`terrain-chunk-${index}`);
      this.#chunks.delete(index);
    }
    for (const index of required) {
      if (this.#chunks.has(index)) continue;
      const chunk = new WorldChunk(index, this.materials);
      this.#chunks.set(index, chunk);
      this.ctx.add(chunk.group);
      this.ctx.entities.add(`terrain-chunk-${index}`, chunk);
    }
    this.active.splice(0, this.active.length, ...this.#chunks.keys());
    this.active.sort((a, b) => a - b);
    return current;
  }
}
