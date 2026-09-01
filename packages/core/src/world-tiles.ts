import { BufferAttribute, BufferGeometry, LOD, Mesh, Object3D, Vector3 } from "three";
import type { InterleavedBufferAttribute, Matrix4 } from "three";
import type { IAssetLoader } from "./assets.js";
import type { IComputeDriven } from "./compute-driven.js";
import type { IRendererLike } from "./renderer.js";
import { summarizeWorldTopology } from "./world-topology.js";
import {
  Heightfield,
  type IHeightfieldOrigin,
  type IHeightfieldSamplerOptions,
  type IHeightfieldWorldPassOptions,
} from "./world.js";

type MeshSurface = NonNullable<ConstructorParameters<typeof Mesh>[1]>;

export interface IWorldTileCollider {
  dispose(): void;
}

export interface IWorldTileColliderInput {
  readonly field: Heightfield;
  readonly key: string;
  readonly object: Object3D;
  readonly tileX: number;
  readonly tileZ: number;
}

export interface IWorldTile {
  readonly bytes: number;
  readonly collider: IWorldTileCollider;
  readonly field: Heightfield;
  readonly key: string;
  readonly lod: LOD;
  readonly lodLevel: number;
  readonly object: Object3D;
  readonly skirtVertexCount: number;
  readonly tileX: number;
  readonly tileZ: number;
}

export interface IWorldTilesFollowPosition {
  readonly x: number;
  readonly z: number;
}

export interface IWorldTilesTopologyObservation {
  readonly columns: number;
  readonly depth: number;
  readonly origin: IHeightfieldOrigin;
  readonly rows: number;
  readonly width: number;
}

export interface IWorldTilesOptions {
  /** Releases a caller-supplied model key when its last tile reference is evicted. */
  readonly assets?: Pick<IAssetLoader, "release">;
  /** A game-owned, already-loaded logical model key, or a key resolver per tile. */
  readonly assetKey?: string | ((tileX: number, tileZ: number) => string);
  /** Creates the physics body from the field's explicit collider-order copy. */
  readonly createCollider?: (input: IWorldTileColliderInput) => IWorldTileCollider;
  /** TSL pass options are game supplied and are forwarded to each resident field. */
  readonly worldPasses?: IHeightfieldWorldPassOptions;
  /** Game-owned surface; this class never creates or mutates it. */
  readonly surface: MeshSurface;
  readonly residentByteBudget: number;
  readonly residentTileBudget: number;
  readonly sampleHeight: IHeightfieldSamplerOptions["sampleHeight"];
  /** How deep each edge skirt extends below its surface. Defaults to one tile width. */
  readonly skirtDepth?: number;
  /** Square tile neighborhood to consider around the followed point. Defaults to 1. */
  readonly streamRadius?: number;
  readonly tileResolution: number;
  readonly tileSize: number;
  /** Vertex decimation factors. Defaults to 1, 2, and 4 over the same field. */
  readonly lodFactors?: readonly number[];
  /** Distances in world units at which the next LOD becomes active. */
  readonly lodDistances?: readonly number[];
  /** Explicit game-owned measurement region used by the topology evaluator. */
  readonly topologyObservation?: IWorldTilesTopologyObservation;
}

interface ILevelGeometry {
  readonly edgeSamples: IEdgeSamples;
  readonly geometry: BufferGeometry;
  readonly mesh: Mesh;
  readonly resolution: number;
  readonly skirtDepth: number;
  readonly skirtVertexCount: number;
}

interface IEdgeSamples {
  readonly east: Float32Array;
  readonly north: Float32Array;
  readonly south: Float32Array;
  readonly west: Float32Array;
}

interface IResidentTile extends Omit<IWorldTile, "lodLevel"> {
  readonly assetKey?: string;
  readonly levels: readonly ILevelGeometry[];
  lodTransition?: ILodTransition;
  lodLevel: number;
  readonly origin: IHeightfieldOrigin;
  readonly skirts: number;
}

interface ILodTransition {
  readonly from: number;
  readonly to: number;
  elapsedFrames: number;
  remainingFrames: number;
}

interface IStitchBridge {
  readonly keys: readonly [string, string];
  geometry: BufferGeometry;
  readonly mesh: Mesh;
  resolution: number;
  coverageDepth: number;
  bytes: number;
}

interface ILodFrameSnapshot {
  readonly heights: Float32Array;
  readonly resolution: number;
  readonly tile: IResidentTile;
}

const MAX_RAW_TOPOLOGY_SAMPLES = 10_000;
const LOD_POP_THRESHOLD = 16;
const LOD_TRANSITION_FRAMES = 3;
const BRIDGE_COORDINATE_EPSILON = 1e-4;
const BRIDGE_COORDINATE_RELATIVE_EPSILON = 2 ** -22;
type PositionAttribute = BufferAttribute | InterleavedBufferAttribute;

function bridgeCoordinateMatches(actual: number, expected: number): boolean {
  return (
    Math.abs(actual - expected) <=
    Math.max(
      BRIDGE_COORDINATE_EPSILON,
      Math.max(1, Math.abs(actual), Math.abs(expected)) * BRIDGE_COORDINATE_RELATIVE_EPSILON,
    )
  );
}

class EmptyCollider implements IWorldTileCollider {
  #disposed = false;

  get disposed(): boolean {
    return this.#disposed;
  }

  dispose(): void {
    this.#disposed = true;
  }
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`TerrainTiles ${name} must be finite.`);
  return value;
}

function positive(value: number, name: string): number {
  finite(value, name);
  if (value <= 0) throw new Error(`TerrainTiles ${name} must be greater than zero.`);
  return value;
}

function integerAtLeast(value: number, minimum: number, name: string): number {
  if (!Number.isInteger(value) || value < minimum)
    throw new Error(`TerrainTiles ${name} must be an integer of at least ${minimum}.`);
  return value;
}

function keyFor(tileX: number, tileZ: number): string {
  return `${String(tileX)}:${String(tileZ)}`;
}

function lodLevelForDistance(distance: number, thresholds: readonly number[]): number {
  let level = 0;
  for (const threshold of thresholds) {
    if (distance < threshold) break;
    level += 1;
  }
  return level;
}

function resolutionFor(tileResolution: number, factor: number): number {
  const cells = (tileResolution - 1) / factor;
  if (!Number.isInteger(cells))
    throw new Error("TerrainTiles tileResolution minus one must divide every lod factor.");
  return cells + 1;
}

function estimatedLevelBytes(resolution: number): number {
  const vertices = resolution * resolution + resolution * 4;
  const triangles = (resolution - 1) * (resolution - 1) + (resolution - 1) * 4;
  const edgeSampleBytes = resolution * 4 * Float32Array.BYTES_PER_ELEMENT;
  return (
    vertices * 3 * Float32Array.BYTES_PER_ELEMENT * 2 +
    triangles * 6 * Uint32Array.BYTES_PER_ELEMENT +
    edgeSampleBytes
  );
}

function estimatedFieldBytes(
  tileResolution: number,
  worldPasses: IHeightfieldWorldPassOptions | undefined,
): number {
  const sampleBytes = tileResolution * tileResolution * Float32Array.BYTES_PER_ELEMENT;
  if (worldPasses === undefined) return sampleBytes * 2;
  // The GPU path retains the canonical/collider values plus several ping-pong storage buffers.
  // Admission is deliberately conservative so backend allocation overhead cannot break the cap.
  return sampleBytes * (worldPasses.gpu === false ? 4 : 24);
}

function estimatedTileBytes(
  tileResolution: number,
  factors: readonly number[],
  worldPasses: IHeightfieldWorldPassOptions | undefined,
): number {
  return factors.reduce(
    (total, factor) => total + estimatedLevelBytes(resolutionFor(tileResolution, factor)),
    estimatedFieldBytes(tileResolution, worldPasses),
  );
}

function tiledObservationResolution(
  extent: number,
  tileSize: number,
  tileResolution: number,
  axis: string,
): number {
  const tileCount = extent / tileSize;
  if (!Number.isInteger(tileCount) || tileCount < 1)
    throw new Error(
      `TerrainTiles topologyObservation ${axis} must cover a positive whole number of rendered tiles.`,
    );
  return tileCount * (tileResolution - 1) + 1;
}

function validateTopologyObservation(
  observation: IWorldTilesTopologyObservation,
  tileSize: number,
  tileResolution: number,
): void {
  const expectedColumns = tiledObservationResolution(
    observation.width,
    tileSize,
    tileResolution,
    "width",
  );
  const expectedRows = tiledObservationResolution(
    observation.depth,
    tileSize,
    tileResolution,
    "depth",
  );
  if (observation.columns !== expectedColumns)
    throw new Error(
      `TerrainTiles topologyObservation columns must match the rendered tile grid (expected ${String(expectedColumns)}, received ${String(observation.columns)}).`,
    );
  if (observation.rows !== expectedRows)
    throw new Error(
      `TerrainTiles topologyObservation rows must match the rendered tile grid (expected ${String(expectedRows)}, received ${String(observation.rows)}).`,
    );
}

function edgeSamplesFor(values: readonly number[], resolution: number): IEdgeSamples {
  const north = new Float32Array(resolution);
  const south = new Float32Array(resolution);
  const west = new Float32Array(resolution);
  const east = new Float32Array(resolution);
  for (let index = 0; index < resolution; index += 1) {
    north[index] = values[index] as number;
    south[index] = values[(resolution - 1) * resolution + index] as number;
    west[index] = values[index * resolution] as number;
    east[index] = values[index * resolution + resolution - 1] as number;
  }
  return { east, north, south, west };
}

function edgeVertexIndex(level: ILevelGeometry, side: keyof IEdgeSamples, index: number): number {
  const row = side === "north" ? 0 : side === "south" ? level.resolution - 1 : index;
  const column = side === "west" ? 0 : side === "east" ? level.resolution - 1 : index;
  return row * level.resolution + column;
}

function appendQuad(
  indices: number[],
  topLeft: number,
  bottomLeft: number,
  topRight: number,
  bottomRight: number,
): void {
  indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
}

function buildLevel(
  field: Heightfield,
  resolution: number,
  skirtDepth: number,
  surface: MeshSurface,
): ILevelGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const heights: number[] = [];
  const minimumX = field.origin.x - field.width / 2;
  const minimumZ = field.origin.z - field.depth / 2;
  const cellWidth = field.width / (resolution - 1);
  const cellDepth = field.depth / (resolution - 1);
  const normal = new Vector3();
  for (let row = 0; row < resolution; row += 1) {
    const z = minimumZ + row * cellDepth;
    for (let column = 0; column < resolution; column += 1) {
      const x = minimumX + column * cellWidth;
      const height = field.heightAt(x, z);
      heights.push(height);
      positions.push(x - field.origin.x, height, z - field.origin.z);
      field.normalAt(x, z, normal);
      normals.push(normal.x, normal.y, normal.z);
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < resolution - 1; row += 1) {
    for (let column = 0; column < resolution - 1; column += 1) {
      const topLeft = row * resolution + column;
      appendQuad(indices, topLeft, topLeft + resolution, topLeft + 1, topLeft + resolution + 1);
    }
  }

  const edges = [
    (index: number) => index,
    (index: number) => (resolution - 1) * resolution + index,
    (index: number) => index * resolution,
    (index: number) => index * resolution + resolution - 1,
  ];
  for (const edge of edges) {
    const bottom = positions.length / 3;
    for (let index = 0; index < resolution; index += 1) {
      const top = edge(index);
      positions.push(
        positions[top * 3] as number,
        (positions[top * 3 + 1] as number) - skirtDepth,
        positions[top * 3 + 2] as number,
      );
      normals.push(0, 1, 0);
    }
    for (let index = 0; index < resolution - 1; index += 1) {
      const topLeft = edge(index);
      const topRight = edge(index + 1);
      appendQuad(indices, topLeft, bottom + index, topRight, bottom + index + 1);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(Float32Array.from(positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(Float32Array.from(normals), 3));
  geometry.setIndex(new BufferAttribute(Uint32Array.from(indices), 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const skirt = inspectSkirtGeometry(geometry, resolution, edges);
  return {
    edgeSamples: edgeSamplesFor(heights, resolution),
    geometry,
    mesh: new Mesh(geometry, surface),
    resolution,
    skirtDepth: skirt.depth,
    skirtVertexCount: skirt.vertexCount,
  };
}

function inspectSkirtGeometry(
  geometry: BufferGeometry,
  resolution: number,
  edges: readonly ((index: number) => number)[],
): { depth: number; vertexCount: number } {
  const position = geometry.getAttribute("position");
  const surfaceVertexCount = resolution * resolution;
  const vertexCount = position.count - surfaceVertexCount;
  if (vertexCount < 0 || vertexCount % edges.length !== 0)
    throw new Error("TerrainTiles generated skirt geometry has an invalid vertex count.");
  if (vertexCount === 0) return { depth: 0, vertexCount: 0 };
  const edgeVertexCount = vertexCount / edges.length;
  let depth = Number.POSITIVE_INFINITY;
  for (const [edgeIndex, edge] of edges.entries()) {
    for (let index = 0; index < edgeVertexCount; index += 1) {
      const top = edge(index);
      const bottom = surfaceVertexCount + edgeIndex * edgeVertexCount + index;
      depth = Math.min(depth, position.getY(top) - position.getY(bottom));
    }
  }
  if (!Number.isFinite(depth) || depth < 0)
    throw new Error("TerrainTiles generated skirt geometry has an invalid depth.");
  return { depth, vertexCount };
}

function opposingEdge(
  a: IResidentTile,
  b: IResidentTile,
): [keyof IEdgeSamples, keyof IEdgeSamples] {
  if (a.tileX < b.tileX) return ["east", "west"];
  if (a.tileX > b.tileX) return ["west", "east"];
  if (a.tileZ < b.tileZ) return ["south", "north"];
  return ["north", "south"];
}

function renderedLevel(tile: IResidentTile): ILevelGeometry | undefined {
  return tile.levels.find(({ mesh }) => mesh.visible) ?? tile.levels[tile.lodLevel];
}

function edgeVertexHeight(level: ILevelGeometry, side: keyof IEdgeSamples, index: number): number {
  const value = level.geometry.getAttribute("position").getY(edgeVertexIndex(level, side, index));
  if (!Number.isFinite(value))
    throw new Error("TerrainTiles seam diagnostic edge height must be finite.");
  return value;
}

function edgeHeight(level: ILevelGeometry, side: keyof IEdgeSamples, normalized: number): number {
  const position = Math.max(0, Math.min(1, normalized)) * (level.resolution - 1);
  const lower = Math.floor(position);
  const upper = Math.min(level.resolution - 1, lower + 1);
  const mix = position - lower;
  return (
    edgeVertexHeight(level, side, lower) * (1 - mix) + edgeVertexHeight(level, side, upper) * mix
  );
}

function edgeWorldVertexHeight(
  level: ILevelGeometry,
  side: keyof IEdgeSamples,
  index: number,
  target: Vector3,
): number {
  const position = level.geometry.getAttribute("position");
  const vertex = edgeVertexIndex(level, side, index);
  const localX = position.getX(vertex);
  const localY = position.getY(vertex);
  const localZ = position.getZ(vertex);
  if (!Number.isFinite(localX) || !Number.isFinite(localY) || !Number.isFinite(localZ))
    throw new Error("TerrainTiles seam diagnostic bridge coordinates must be finite.");
  target.set(localX, localY, localZ).applyMatrix4(level.mesh.matrixWorld);
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z))
    throw new Error("TerrainTiles seam diagnostic bridge world coordinates must be finite.");
  return target.y;
}

function edgeWorldHeight(
  level: ILevelGeometry,
  side: keyof IEdgeSamples,
  normalized: number,
  target: Vector3,
): number {
  const position = Math.max(0, Math.min(1, normalized)) * (level.resolution - 1);
  const lower = Math.floor(position);
  const upper = Math.min(level.resolution - 1, lower + 1);
  const mix = position - lower;
  return (
    edgeWorldVertexHeight(level, side, lower, target) * (1 - mix) +
    edgeWorldVertexHeight(level, side, upper, target) * mix
  );
}

function bridgeEndpointWorldHeight(
  position: PositionAttribute,
  matrixWorld: Matrix4,
  vertex: number,
  expectedX: number,
  expectedY: number,
  expectedZ: number,
  worldPosition: Vector3,
): number {
  const localX = position.getX(vertex);
  const localY = position.getY(vertex);
  const localZ = position.getZ(vertex);
  if (!Number.isFinite(localX) || !Number.isFinite(localY) || !Number.isFinite(localZ))
    throw new Error("TerrainTiles seam diagnostic bridge coordinates must be finite.");
  worldPosition.set(localX, localY, localZ).applyMatrix4(matrixWorld);
  if (
    !Number.isFinite(worldPosition.x) ||
    !Number.isFinite(worldPosition.y) ||
    !Number.isFinite(worldPosition.z)
  )
    throw new Error("TerrainTiles seam diagnostic bridge world coordinates must be finite.");
  if (
    !Number.isFinite(expectedX) ||
    !Number.isFinite(expectedY) ||
    !Number.isFinite(expectedZ) ||
    !bridgeCoordinateMatches(worldPosition.x, expectedX) ||
    !bridgeCoordinateMatches(worldPosition.y, expectedY) ||
    !bridgeCoordinateMatches(worldPosition.z, expectedZ)
  )
    throw new Error(
      "TerrainTiles seam diagnostic bridge topology does not match current neighboring edges.",
    );
  return worldPosition.y;
}

function bridgeEndpointHeight(
  bridge: IStitchBridge,
  position: PositionAttribute,
  sample: number,
  endpoint: number,
  tile: IResidentTile,
  side: keyof IEdgeSamples,
  level: ILevelGeometry,
  worldPosition: Vector3,
  expectedWorldPosition: Vector3,
): number {
  const sampleNormalized = sample / (bridge.resolution - 1);
  const [expectedX, , expectedZ] = edgeWorldPoint(tile.field, side, sampleNormalized, 0);
  const expectedY = edgeWorldHeight(level, side, sampleNormalized, expectedWorldPosition);
  return bridgeEndpointWorldHeight(
    position,
    bridge.mesh.matrixWorld,
    sample * 2 + endpoint,
    expectedX,
    expectedY,
    expectedZ,
    worldPosition,
  );
}

interface IBridgeEndpoint {
  readonly level: ILevelGeometry;
  readonly side: keyof IEdgeSamples;
  readonly tile: IResidentTile;
}

function bridgeEndpointPair(
  a: IResidentTile,
  aSide: keyof IEdgeSamples,
  b: IResidentTile,
  bSide: keyof IEdgeSamples,
): readonly [IBridgeEndpoint, IBridgeEndpoint] {
  const aLevel = renderedLevel(a);
  const bLevel = renderedLevel(b);
  if (aLevel === undefined || bLevel === undefined)
    throw new Error(
      "TerrainTiles seam diagnostic bridge topology has no rendered neighboring edge.",
    );
  const aEndpoint = { level: aLevel, side: aSide, tile: a };
  const bEndpoint = { level: bLevel, side: bSide, tile: b };
  return aLevel.resolution > bLevel.resolution ? [aEndpoint, bEndpoint] : [bEndpoint, aEndpoint];
}

function interpolatedEdgeSample(samples: Float32Array, normalized: number, name: string): number {
  const position = Math.max(0, Math.min(1, normalized)) * (samples.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(samples.length - 1, lower + 1);
  const mix = position - lower;
  const lowerValue = samples[lower] as number;
  const upperValue = samples[upper] as number;
  if (!Number.isFinite(lowerValue) || !Number.isFinite(upperValue))
    throw new Error(`TerrainTiles retained ${name} edge sample must be finite.`);
  return lowerValue * (1 - mix) + upperValue * mix;
}

function refreshEdgeSamples(level: ILevelGeometry): void {
  for (const side of ["east", "north", "south", "west"] as const) {
    const samples = level.edgeSamples[side];
    for (let index = 0; index < level.resolution; index += 1)
      samples[index] = edgeVertexHeight(level, side, index);
  }
}

function edgeWorldPoint(
  field: Heightfield,
  side: keyof IEdgeSamples,
  normalized: number,
  height: number,
): [number, number, number] {
  const minimumX = field.origin.x - field.width / 2;
  const minimumZ = field.origin.z - field.depth / 2;
  const x =
    side === "west"
      ? minimumX
      : side === "east"
        ? minimumX + field.width
        : minimumX + normalized * field.width;
  const z =
    side === "north"
      ? minimumZ
      : side === "south"
        ? minimumZ + field.depth
        : minimumZ + normalized * field.depth;
  return [x, height, z];
}

function restoreLevelEdge(
  field: Heightfield,
  level: ILevelGeometry,
  side: keyof IEdgeSamples,
): boolean {
  const position = level.geometry.getAttribute("position");
  const normalAttribute = level.geometry.getAttribute("normal");
  const normal = new Vector3();
  let changed = false;
  for (let index = 0; index < level.resolution; index += 1) {
    const normalized = index / (level.resolution - 1);
    const [x, , z] = edgeWorldPoint(field, side, normalized, 0);
    const vertex = edgeVertexIndex(level, side, index);
    const height = field.heightAt(x, z);
    field.normalAt(x, z, normal);
    if (position.getY(vertex) !== height) {
      position.setY(vertex, height);
      changed = true;
    }
    if (
      normalAttribute.getX(vertex) !== normal.x ||
      normalAttribute.getY(vertex) !== normal.y ||
      normalAttribute.getZ(vertex) !== normal.z
    ) {
      normalAttribute.setXYZ(vertex, normal.x, normal.y, normal.z);
      changed = true;
    }
  }
  if (!changed) return false;
  updateLevelSkirts(level);
  refreshEdgeSamples(level);
  position.needsUpdate = true;
  normalAttribute.needsUpdate = true;
  level.geometry.computeBoundingBox();
  level.geometry.computeBoundingSphere();
  return true;
}

interface IStitchGeometryData {
  readonly coverageDepth: number;
  readonly indices: Uint32Array;
  readonly normals: Float32Array;
  readonly positions: Float32Array;
}

function stitchGeometryData(
  finer: IResidentTile,
  finerLevel: ILevelGeometry,
  finerSide: keyof IEdgeSamples,
  coarser: IResidentTile,
  coarserLevel: ILevelGeometry,
  coarserSide: keyof IEdgeSamples,
): IStitchGeometryData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let coverageDepth = 0;
  for (let index = 0; index < finerLevel.resolution; index += 1) {
    const normalized = index / (finerLevel.resolution - 1);
    const fineHeight = interpolatedEdgeSample(
      finerLevel.edgeSamples[finerSide],
      normalized,
      `${finerSide} of finer LOD`,
    );
    const coarseHeight = interpolatedEdgeSample(
      coarserLevel.edgeSamples[coarserSide],
      normalized,
      `${coarserSide} of coarser LOD`,
    );
    coverageDepth = Math.max(coverageDepth, Math.abs(fineHeight - coarseHeight));
    positions.push(...edgeWorldPoint(finer.field, finerSide, normalized, fineHeight));
    positions.push(...edgeWorldPoint(coarser.field, coarserSide, normalized, coarseHeight));
    normals.push(0, 1, 0, 0, 1, 0);
  }
  for (let index = 0; index < finerLevel.resolution - 1; index += 1) {
    const fine = index * 2;
    const coarse = fine + 1;
    const nextFine = fine + 2;
    const nextCoarse = coarse + 2;
    indices.push(
      fine,
      coarse,
      nextFine,
      nextFine,
      coarse,
      nextCoarse,
      nextFine,
      coarse,
      fine,
      nextCoarse,
      coarse,
      nextFine,
    );
  }
  return {
    coverageDepth,
    indices: Uint32Array.from(indices),
    normals: Float32Array.from(normals),
    positions: Float32Array.from(positions),
  };
}

function stitchGeometry(data: IStitchGeometryData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(data.normals, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function geometryBytes(geometry: BufferGeometry): number {
  const index = geometry.getIndex();
  return (
    geometry.getAttribute("position").array.byteLength +
    geometry.getAttribute("normal").array.byteLength +
    (index?.array.byteLength ?? 0)
  );
}

function validateBridgeTriangleTopology(geometry: BufferGeometry, vertexCount: number): void {
  const index = geometry.getIndex();
  const drawRange = geometry.drawRange;
  if (
    index === null ||
    index.itemSize !== 1 ||
    !Number.isInteger(index.count) ||
    index.array.length !== index.count ||
    index.count < 3 ||
    index.count % 3 !== 0 ||
    !Number.isInteger(drawRange.start) ||
    drawRange.start !== 0 ||
    (drawRange.count !== Number.POSITIVE_INFINITY &&
      (!Number.isInteger(drawRange.count) ||
        drawRange.count < index.count ||
        drawRange.count % 3 !== 0))
  )
    throw new Error(
      "TerrainTiles seam diagnostic bridge topology has invalid rendered triangle data.",
    );
  for (let offset = 0; offset < index.count; offset += 1) {
    const vertex = index.getX(offset);
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= vertexCount)
      throw new Error("TerrainTiles seam diagnostic bridge topology has invalid index data.");
  }
}

function updateStitchBridge(bridge: IStitchBridge, data: IStitchGeometryData): void {
  const position = bridge.geometry.getAttribute("position");
  if (position === undefined)
    throw new Error("TerrainTiles seam diagnostic bridge topology has invalid coverage.");
  validateBridgeTriangleTopology(bridge.geometry, position.count);
  if (bridge.resolution !== data.positions.length / 6) {
    const previous = bridge.geometry;
    bridge.geometry = stitchGeometry(data);
    bridge.mesh.geometry = bridge.geometry;
    bridge.resolution = data.positions.length / 6;
    bridge.bytes = geometryBytes(bridge.geometry);
    previous.dispose();
  } else {
    const normal = bridge.geometry.getAttribute("normal");
    const index = bridge.geometry.getIndex();
    if (index === null)
      throw new Error("TerrainTiles seam diagnostic bridge topology has invalid index data.");
    position.array.set(data.positions);
    normal.array.set(data.normals);
    index.array.set(data.indices);
    position.needsUpdate = true;
    normal.needsUpdate = true;
    index.needsUpdate = true;
    bridge.geometry.computeBoundingBox();
    bridge.geometry.computeBoundingSphere();
  }
  bridge.coverageDepth = data.coverageDepth;
}

function levelHeight(level: ILevelGeometry, row: number, column: number): number {
  const position = level.geometry.getAttribute("position");
  const value = position.getY(row * level.resolution + column);
  if (!Number.isFinite(value)) throw new Error("TerrainTiles LOD geometry has an invalid height.");
  return value;
}

function interpolatedLevelHeight(level: ILevelGeometry, x: number, z: number): number {
  const column = Math.max(0, Math.min(1, x)) * (level.resolution - 1);
  const row = Math.max(0, Math.min(1, z)) * (level.resolution - 1);
  const column0 = Math.floor(column);
  const row0 = Math.floor(row);
  const column1 = Math.min(level.resolution - 1, column0 + 1);
  const row1 = Math.min(level.resolution - 1, row0 + 1);
  const columnMix = column - column0;
  const rowMix = row - row0;
  const upperLeft = levelHeight(level, row0, column0);
  const upperRight = levelHeight(level, row0, column1);
  const lowerLeft = levelHeight(level, row1, column0);
  const lowerRight = levelHeight(level, row1, column1);
  const upper = upperLeft + (upperRight - upperLeft) * columnMix;
  const lower = lowerLeft + (lowerRight - lowerLeft) * columnMix;
  return upper + (lower - upper) * rowMix;
}

function interpolatedLevelNormal(
  level: ILevelGeometry,
  x: number,
  z: number,
  target: Vector3,
): Vector3 {
  const column = Math.max(0, Math.min(1, x)) * (level.resolution - 1);
  const row = Math.max(0, Math.min(1, z)) * (level.resolution - 1);
  const column0 = Math.floor(column);
  const row0 = Math.floor(row);
  const column1 = Math.min(level.resolution - 1, column0 + 1);
  const row1 = Math.min(level.resolution - 1, row0 + 1);
  const columnMix = column - column0;
  const rowMix = row - row0;
  const normal = level.geometry.getAttribute("normal");
  const upperLeft = row0 * level.resolution + column0;
  const upperRight = row0 * level.resolution + column1;
  const lowerLeft = row1 * level.resolution + column0;
  const lowerRight = row1 * level.resolution + column1;
  const blend = (upper: number, lower: number): number => upper + (lower - upper) * rowMix;
  const interpolate = (
    topLeft: number,
    topRight: number,
    bottomLeft: number,
    bottomRight: number,
  ) =>
    blend(
      topLeft + (topRight - topLeft) * columnMix,
      bottomLeft + (bottomRight - bottomLeft) * columnMix,
    );
  return target
    .set(
      interpolate(
        normal.getX(upperLeft),
        normal.getX(upperRight),
        normal.getX(lowerLeft),
        normal.getX(lowerRight),
      ),
      interpolate(
        normal.getY(upperLeft),
        normal.getY(upperRight),
        normal.getY(lowerLeft),
        normal.getY(lowerRight),
      ),
      interpolate(
        normal.getZ(upperLeft),
        normal.getZ(upperRight),
        normal.getZ(lowerLeft),
        normal.getZ(lowerRight),
      ),
    )
    .normalize();
}

function updateLevelSkirts(level: ILevelGeometry): void {
  const position = level.geometry.getAttribute("position");
  const normal = level.geometry.getAttribute("normal");
  const surfaceVertexCount = level.resolution * level.resolution;
  const edges = [
    (index: number) => index,
    (index: number) => (level.resolution - 1) * level.resolution + index,
    (index: number) => index * level.resolution,
    (index: number) => index * level.resolution + level.resolution - 1,
  ];
  for (const [edgeIndex, edge] of edges.entries()) {
    for (let index = 0; index < level.resolution; index += 1) {
      const top = edge(index);
      const bottom = surfaceVertexCount + edgeIndex * level.resolution + index;
      position.setY(bottom, position.getY(top) - level.skirtDepth);
      normal.setXYZ(bottom, 0, 1, 0);
    }
  }
}

function restoreLevelSurface(field: Heightfield, level: ILevelGeometry): void {
  const position = level.geometry.getAttribute("position");
  const normalAttribute = level.geometry.getAttribute("normal");
  const minimumX = field.origin.x - field.width / 2;
  const minimumZ = field.origin.z - field.depth / 2;
  const cellWidth = field.width / (level.resolution - 1);
  const cellDepth = field.depth / (level.resolution - 1);
  const normal = new Vector3();
  for (let row = 0; row < level.resolution; row += 1) {
    const z = minimumZ + row * cellDepth;
    for (let column = 0; column < level.resolution; column += 1) {
      const x = minimumX + column * cellWidth;
      const index = row * level.resolution + column;
      position.setY(index, field.heightAt(x, z));
      field.normalAt(x, z, normal);
      normalAttribute.setXYZ(index, normal.x, normal.y, normal.z);
    }
  }
  updateLevelSkirts(level);
  refreshEdgeSamples(level);
  position.needsUpdate = true;
  normalAttribute.needsUpdate = true;
  level.geometry.computeBoundingBox();
  level.geometry.computeBoundingSphere();
}

function updateLodTransitionGeometry(
  tile: IResidentTile,
  transition: ILodTransition,
  progress: number,
): void {
  const from = tile.levels[transition.from];
  const to = tile.levels[transition.to];
  if (from === undefined || to === undefined)
    throw new Error("TerrainTiles LOD transition references a missing level.");
  const finer = from.resolution >= to.resolution ? from : to;
  const coarser = finer === from ? to : from;
  const fromIsFiner = finer === from;
  const position = finer.geometry.getAttribute("position");
  const normalAttribute = finer.geometry.getAttribute("normal");
  const minimumX = tile.field.origin.x - tile.field.width / 2;
  const minimumZ = tile.field.origin.z - tile.field.depth / 2;
  const cellWidth = tile.field.width / (finer.resolution - 1);
  const cellDepth = tile.field.depth / (finer.resolution - 1);
  const fineNormal = new Vector3();
  const coarseNormal = new Vector3();
  const blendedNormal = new Vector3();
  for (let row = 0; row < finer.resolution; row += 1) {
    const z = minimumZ + row * cellDepth;
    const normalizedZ = row / (finer.resolution - 1);
    for (let column = 0; column < finer.resolution; column += 1) {
      const x = minimumX + column * cellWidth;
      const normalizedX = column / (finer.resolution - 1);
      const index = row * finer.resolution + column;
      const fineHeight = tile.field.heightAt(x, z);
      const coarseHeight = interpolatedLevelHeight(coarser, normalizedX, normalizedZ);
      const startHeight = fromIsFiner ? fineHeight : coarseHeight;
      const endHeight = fromIsFiner ? coarseHeight : fineHeight;
      position.setY(index, startHeight + (endHeight - startHeight) * progress);

      tile.field.normalAt(x, z, fineNormal);
      interpolatedLevelNormal(coarser, normalizedX, normalizedZ, coarseNormal);
      const startNormal = fromIsFiner ? fineNormal : coarseNormal;
      const endNormal = fromIsFiner ? coarseNormal : fineNormal;
      blendedNormal
        .set(
          startNormal.x + (endNormal.x - startNormal.x) * progress,
          startNormal.y + (endNormal.y - startNormal.y) * progress,
          startNormal.z + (endNormal.z - startNormal.z) * progress,
        )
        .normalize();
      normalAttribute.setXYZ(index, blendedNormal.x, blendedNormal.y, blendedNormal.z);
    }
  }
  updateLevelSkirts(finer);
  refreshEdgeSamples(finer);
  position.needsUpdate = true;
  normalAttribute.needsUpdate = true;
  finer.geometry.computeBoundingBox();
  finer.geometry.computeBoundingSphere();
}

function surfaceHeights(level: ILevelGeometry): Float32Array {
  const position = level.geometry.getAttribute("position");
  const heights = new Float32Array(level.resolution * level.resolution);
  for (let index = 0; index < heights.length; index += 1) heights[index] = position.getY(index);
  return heights;
}

function interpolatedSamplesHeight(
  samples: Float32Array,
  resolution: number,
  x: number,
  z: number,
): number {
  const column = Math.max(0, Math.min(1, x)) * (resolution - 1);
  const row = Math.max(0, Math.min(1, z)) * (resolution - 1);
  const column0 = Math.floor(column);
  const row0 = Math.floor(row);
  const column1 = Math.min(resolution - 1, column0 + 1);
  const row1 = Math.min(resolution - 1, row0 + 1);
  const columnMix = column - column0;
  const rowMix = row - row0;
  const upperLeft = samples[row0 * resolution + column0] as number;
  const upperRight = samples[row0 * resolution + column1] as number;
  const lowerLeft = samples[row1 * resolution + column0] as number;
  const lowerRight = samples[row1 * resolution + column1] as number;
  const upper = upperLeft + (upperRight - upperLeft) * columnMix;
  const lower = lowerLeft + (lowerRight - lowerLeft) * columnMix;
  return upper + (lower - upper) * rowMix;
}

function surfaceDeltaFromSamples(
  samples: Float32Array,
  resolution: number,
  level: ILevelGeometry,
): number {
  const sampleCount = Math.max(resolution, level.resolution);
  let maximum = 0;
  for (let row = 0; row < sampleCount; row += 1) {
    for (let column = 0; column < sampleCount; column += 1) {
      const x = column / (sampleCount - 1);
      const z = row / (sampleCount - 1);
      maximum = Math.max(
        maximum,
        Math.abs(
          interpolatedSamplesHeight(samples, resolution, x, z) -
            interpolatedLevelHeight(level, x, z),
        ),
      );
    }
  }
  return maximum;
}

function seamCoverageDepth(a: IResidentTile, b: IResidentTile): number {
  const aLevel = a.levels[a.lodLevel];
  const bLevel = b.levels[b.lodLevel];
  if (aLevel === undefined || bLevel === undefined) return 0;
  return Math.min(aLevel.skirtDepth, bLevel.skirtDepth);
}

function bridgeCoverageAt(
  bridge: IStitchBridge,
  a: IResidentTile,
  aSide: keyof IEdgeSamples,
  b: IResidentTile,
  bSide: keyof IEdgeSamples,
  normalized: number,
): number {
  if (bridge.mesh.geometry !== bridge.geometry)
    throw new Error("TerrainTiles seam diagnostic bridge geometry is not attached to its mesh.");
  if (!Number.isInteger(bridge.resolution) || bridge.resolution < 2)
    throw new Error("TerrainTiles seam diagnostic bridge resolution is invalid.");
  if (
    bridge.keys[0] !== (a.key < b.key ? a.key : b.key) ||
    bridge.keys[1] !== (a.key < b.key ? b.key : a.key)
  )
    throw new Error("TerrainTiles seam diagnostic bridge topology does not match its tile pair.");
  if (!Number.isFinite(normalized))
    throw new Error("TerrainTiles seam diagnostic bridge sample coordinate must be finite.");
  const position = bridge.mesh.geometry.getAttribute("position");
  if (position.count !== bridge.resolution * 2)
    throw new Error("TerrainTiles seam diagnostic bridge geometry has invalid coverage.");
  validateBridgeTriangleTopology(bridge.mesh.geometry, position.count);
  const [finer, coarser] = bridgeEndpointPair(a, aSide, b, bSide);
  bridge.mesh.updateWorldMatrix(true, false);
  finer.level.mesh.updateWorldMatrix(true, false);
  coarser.level.mesh.updateWorldMatrix(true, false);
  const worldPosition = new Vector3();
  const expectedWorldPosition = new Vector3();
  const samplePosition = Math.max(0, Math.min(1, normalized)) * (bridge.resolution - 1);
  const lower = Math.floor(samplePosition);
  const upper = Math.min(bridge.resolution - 1, lower + 1);
  const mix = samplePosition - lower;
  const fine =
    bridgeEndpointHeight(
      bridge,
      position,
      lower,
      0,
      finer.tile,
      finer.side,
      finer.level,
      worldPosition,
      expectedWorldPosition,
    ) *
      (1 - mix) +
    bridgeEndpointHeight(
      bridge,
      position,
      upper,
      0,
      finer.tile,
      finer.side,
      finer.level,
      worldPosition,
      expectedWorldPosition,
    ) *
      mix;
  const coarse =
    bridgeEndpointHeight(
      bridge,
      position,
      lower,
      1,
      coarser.tile,
      coarser.side,
      coarser.level,
      worldPosition,
      expectedWorldPosition,
    ) *
      (1 - mix) +
    bridgeEndpointHeight(
      bridge,
      position,
      upper,
      1,
      coarser.tile,
      coarser.side,
      coarser.level,
      worldPosition,
      expectedWorldPosition,
    ) *
      mix;
  const coverage = Math.abs(fine - coarse);
  if (!Number.isFinite(coverage))
    throw new Error("TerrainTiles seam diagnostic bridge coverage must be finite.");
  return coverage;
}

function seamObservation(
  a: IResidentTile,
  b: IResidentTile,
  bridge: IStitchBridge | undefined,
  owner: Object3D,
  includeBridgeCoverage: boolean,
): { gap: number; visualGap: number } {
  const [aSide, bSide] = opposingEdge(a, b);
  const aLevel = renderedLevel(a);
  const bLevel = renderedLevel(b);
  if (aLevel === undefined || bLevel === undefined)
    throw new Error("TerrainTiles seam diagnostic observation has no rendered level.");
  const samples = Math.max(aLevel.resolution, bLevel.resolution);
  const bridgeAttached =
    includeBridgeCoverage &&
    bridge !== undefined &&
    bridge.mesh.parent === owner &&
    bridge.mesh.visible === true;
  let gap = 0;
  let visualGap = 0;
  for (let index = 0; index < samples; index += 1) {
    const normalized = samples === 1 ? 0 : index / (samples - 1);
    const currentGap = Math.abs(
      edgeHeight(aLevel, aSide, normalized) - edgeHeight(bLevel, bSide, normalized),
    );
    if (!Number.isFinite(currentGap))
      throw new Error("TerrainTiles seam diagnostic observation must be finite.");
    gap = Math.max(gap, currentGap);
    const bridgeCoverage = bridgeAttached
      ? bridgeCoverageAt(bridge as IStitchBridge, a, aSide, b, bSide, normalized)
      : 0;
    const coverage = Math.max(seamCoverageDepth(a, b), bridgeCoverage);
    visualGap = Math.max(visualGap, Math.max(0, currentGap - coverage));
  }
  if (!Number.isFinite(visualGap))
    throw new Error("TerrainTiles visual seam diagnostic observation must be finite.");
  return { gap, visualGap };
}

function areNeighbors(a: IResidentTile, b: IResidentTile): boolean {
  return Math.abs(a.tileX - b.tileX) + Math.abs(a.tileZ - b.tileZ) === 1;
}

type NeighborPair = readonly [IResidentTile, IResidentTile];

function neighborPairKey(pair: NeighborPair): string {
  const [a, b] = pair;
  return a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`;
}

function neighborPairs(tiles: readonly IResidentTile[]): NeighborPair[] {
  const pairs: NeighborPair[] = [];
  for (let index = 0; index < tiles.length; index += 1) {
    const tile = tiles[index] as IResidentTile;
    for (let neighborIndex = index + 1; neighborIndex < tiles.length; neighborIndex += 1) {
      const neighbor = tiles[neighborIndex] as IResidentTile;
      if (areNeighbors(tile, neighbor)) pairs.push([tile, neighbor]);
    }
  }
  return pairs;
}

function neighborLodCorrection(
  pair: NeighborPair,
): { coarser: IResidentTile; level: number } | undefined {
  const [a, b] = pair;
  if (Math.abs(a.lodLevel - b.lodLevel) <= 1) return undefined;
  const finer = a.lodLevel < b.lodLevel ? a : b;
  const coarser = finer === a ? b : a;
  return { coarser, level: finer.lodLevel + 1 };
}

function reconcileNeighborPair(
  pair: NeighborPair,
  surface: MeshSurface,
  existingBridge: IStitchBridge | undefined,
): IStitchBridge | undefined {
  const [a, b] = pair;
  const [aSide, bSide] = opposingEdge(a, b);
  const aLevel = renderedLevel(a);
  const bLevel = renderedLevel(b);
  if (aLevel === undefined || bLevel === undefined)
    throw new Error("TerrainTiles cannot reconcile a neighbor with no rendered LOD level.");
  restoreLevelEdge(a.field, aLevel, aSide);
  restoreLevelEdge(b.field, bLevel, bSide);
  if (aLevel.resolution === bLevel.resolution) return undefined;
  const finer = aLevel.resolution > bLevel.resolution ? a : b;
  const finerLevel = aLevel.resolution > bLevel.resolution ? aLevel : bLevel;
  const finerSide = aLevel.resolution > bLevel.resolution ? aSide : bSide;
  const coarser = finer === a ? b : a;
  const coarserLevel = finer === a ? bLevel : aLevel;
  const coarserSide = finer === a ? bSide : aSide;
  const data = stitchGeometryData(finer, finerLevel, finerSide, coarser, coarserLevel, coarserSide);
  if (existingBridge === undefined) {
    const geometry = stitchGeometry(data);
    const mesh = new Mesh(geometry, surface);
    mesh.frustumCulled = true;
    return {
      bytes: geometryBytes(geometry),
      coverageDepth: data.coverageDepth,
      geometry,
      keys: [a.key, b.key].sort() as [string, string],
      mesh,
      resolution: finerLevel.resolution,
    };
  }
  updateStitchBridge(existingBridge, data);
  return existingBridge;
}

function setManualLodLevel(lod: LOD, level: number): void {
  // Three's renderer reads `autoUpdate`, and its update method owns this private-ish marker. Keep
  // that marker aligned with the visible child for callers that inspect the composed LOD.
  (lod as LOD & { _currentLevel: number })._currentLevel = level;
}

/**
 * Stream a bounded square of game-authored heightfields and keep their render and physics units
 * together. The class composes ordinary THREE.LOD objects and leaves frustum/projection culling
 * to the renderer's existing scene path.
 *
 * @situation stream terrain without cracks
 * @situation keep generated terrain resident around a moving player
 * @situation put a generated terrain tile into a game-owned physics world
 * @constraint sampleHeight and surface are required game choices; no landform or surface preset is installed
 * @constraint residentTileBudget and residentByteBudget are hard caps; a tile that cannot fit throws
 * @override tileSize, tileResolution, lodFactors, lodDistances, skirtDepth, streamRadius, and budgets
 * @example const tiles = new TerrainTiles({ sampleHeight, surface: gameSurface(), tileSize: 256, tileResolution: 129, residentTileBudget: 25, residentByteBudget: 32_000_000 });
 */
export class TerrainTiles extends Object3D implements IComputeDriven {
  readonly residentTileBudget: number;
  readonly residentByteBudget: number;
  readonly skirtDepth: number;
  readonly tileResolution: number;
  readonly tileSize: number;
  readonly processCadence = "render" as const;
  readonly #assets: Pick<IAssetLoader, "release"> | undefined;
  readonly #assetKey: IWorldTilesOptions["assetKey"];
  readonly #createCollider: IWorldTilesOptions["createCollider"];
  readonly #factors: readonly number[];
  readonly #lodDistances: readonly number[];
  readonly #surface: MeshSurface;
  readonly #sampleHeight: IWorldTilesOptions["sampleHeight"];
  readonly #streamRadius: number;
  /** Canonical topology samples retained only for the declared diagnostics region. */
  readonly #topologyField: Heightfield | undefined;
  readonly #topologyBytes: number;
  readonly #worldPasses: IHeightfieldWorldPassOptions | undefined;
  readonly #resident = new Map<string, IResidentTile>();
  #topologyMetrics: ReturnType<typeof summarizeWorldTopology> | undefined;
  #focus: IWorldTilesFollowPosition | undefined;
  #peakBytes = 0;
  #peakTiles = 0;
  #lodTransitions = 0;
  #maxLodPop = 0;
  #maxLodTransitionFrames = 0;
  // These diagnostics are lifetime maxima for this residency owner. Zero is the deliberate
  // empty/evicted value; each finite live-geometry observation can only increase it.
  #maxSeamGap = 0;
  #maxVisualSeamGap = 0;
  #stitchedEdges = 0;
  #stitchBytes = 0;
  readonly #stitches = new Map<string, IStitchBridge>();
  #released = false;
  #renderer: IRendererLike | undefined;

  constructor(options: IWorldTilesOptions) {
    super();
    this.tileSize = positive(options.tileSize, "tileSize");
    this.tileResolution = integerAtLeast(options.tileResolution, 3, "tileResolution");
    this.residentTileBudget = integerAtLeast(options.residentTileBudget, 1, "residentTileBudget");
    this.residentByteBudget = integerAtLeast(options.residentByteBudget, 1, "residentByteBudget");
    this.skirtDepth = positive(options.skirtDepth ?? this.tileSize, "skirtDepth");
    this.#streamRadius = integerAtLeast(options.streamRadius ?? 1, 0, "streamRadius");
    this.#surface = options.surface;
    if (options.surface === undefined || options.surface === null)
      throw new Error("TerrainTiles surface is required and must be game-owned.");
    this.#sampleHeight = options.sampleHeight;
    if (typeof options.sampleHeight !== "function")
      throw new Error("TerrainTiles sampleHeight is required.");
    this.#factors = [...(options.lodFactors ?? [1, 2, 4])];
    if (this.#factors.length < 1) throw new Error("TerrainTiles lodFactors must not be empty.");
    for (const factor of this.#factors) integerAtLeast(factor, 1, "lod factor");
    for (const factor of this.#factors) resolutionFor(this.tileResolution, factor);
    this.#lodDistances = [...(options.lodDistances ?? [this.tileSize * 2, this.tileSize * 4])];
    if (this.#lodDistances.length !== this.#factors.length - 1)
      throw new Error("TerrainTiles lodDistances must contain one threshold per LOD transition.");
    this.#lodDistances.forEach((distance, index) => {
      positive(distance, `lodDistances[${String(index)}]`);
      if (index > 0 && distance <= (this.#lodDistances[index - 1] as number))
        throw new Error("TerrainTiles lodDistances must be strictly increasing.");
    });
    if (options.assetKey !== undefined && options.assets === undefined)
      throw new Error("TerrainTiles assetKey requires an assets.release consumer.");
    this.#assets = options.assets;
    this.#assetKey = options.assetKey;
    this.#createCollider = options.createCollider;
    this.#worldPasses = options.worldPasses;
    if (options.topologyObservation !== undefined)
      validateTopologyObservation(options.topologyObservation, this.tileSize, this.tileResolution);
    this.#topologyField =
      options.topologyObservation === undefined
        ? undefined
        : Heightfield.fromSampler({
            ...options.topologyObservation,
            sampleHeight: this.#sampleHeight,
            ...(this.#worldPasses === undefined ? {} : { worldPasses: this.#worldPasses }),
          });
    this.#topologyBytes = this.#topologyField?.memoryBytes ?? 0;
    if (this.#topologyBytes > this.residentByteBudget)
      throw new Error("TerrainTiles residentByteBudget cannot fit the topology observation.");
    this.#recordPeaks();
    this.#recordSeamDiagnostics();
    this.frustumCulled = true;
  }

  get released(): boolean {
    return this.#released;
  }

  get residentTileCount(): number {
    return this.#resident.size;
  }

  get residentBytes(): number {
    return (
      this.#topologyBytes +
      this.#stitchBytes +
      [...this.#resident.values()].reduce((total, tile) => total + tile.bytes, 0)
    );
  }

  get peakResidentTileCount(): number {
    return this.#peakTiles;
  }

  get peakResidentBytes(): number {
    return this.#peakBytes;
  }

  get residentKeys(): readonly string[] {
    return [...this.#resident.keys()].sort();
  }

  get residentColliderKeys(): readonly string[] {
    return [...this.#resident.values()]
      .filter((tile) => tile.collider !== undefined)
      .map((tile) => tile.key)
      .sort();
  }

  get lodLevelCount(): number {
    return this.#factors.length;
  }

  get lodTransitions(): number {
    return this.#lodTransitions;
  }

  /** Maximum per-render-frame displacement of the visible LOD surface during transitions. */
  get maxLodPop(): number {
    return this.#maxLodPop;
  }

  /** Maximum number of rendered frames during which an LOD transition remained observable. */
  get maxLodTransitionFrames(): number {
    return this.#maxLodTransitionFrames;
  }

  /** Maximum visible edge gap observed across follow/process calls for this residency owner. */
  get maxSeamGap(): number {
    return this.#maxSeamGap;
  }

  /** Maximum remaining visible gap after skirt or bridge coverage observed across follow/process calls. */
  get maxVisualSeamGap(): number {
    return this.#maxVisualSeamGap;
  }

  /** Number of mixed-LOD edge reconciliations observed during this residency lifetime. */
  get stitchedEdgeCount(): number {
    return this.#stitchedEdges;
  }

  get warmupNodes(): readonly unknown[] {
    return [
      ...(this.#topologyField?.warmupNodes ?? []),
      ...[...this.#resident.values()].flatMap((tile) => tile.field.warmupNodes),
    ];
  }

  getTile(key: string): IWorldTile | undefined {
    return this.#resident.get(key);
  }

  follow(position: IWorldTilesFollowPosition | Pick<Vector3, "x" | "z">): void {
    if (this.#released) throw new Error("TerrainTiles cannot follow after release.");
    const x = finite(position.x, "follow x");
    const z = finite(position.z, "follow z");
    const hadFocus = this.#focus !== undefined;
    this.#focus = { x, z };
    const centerX = Math.floor((x + this.tileSize / 2) / this.tileSize);
    const centerZ = Math.floor((z + this.tileSize / 2) / this.tileSize);
    const wanted: Array<{ distance: number; tileX: number; tileZ: number }> = [];
    for (
      let tileZ = centerZ - this.#streamRadius;
      tileZ <= centerZ + this.#streamRadius;
      tileZ += 1
    ) {
      for (
        let tileX = centerX - this.#streamRadius;
        tileX <= centerX + this.#streamRadius;
        tileX += 1
      ) {
        const tileCenterX = tileX * this.tileSize;
        const tileCenterZ = tileZ * this.tileSize;
        wanted.push({
          distance: Math.hypot(x - tileCenterX, z - tileCenterZ),
          tileX,
          tileZ,
        });
      }
    }
    wanted.sort((a, b) => a.distance - b.distance || a.tileZ - b.tileZ || a.tileX - b.tileX);
    const selected = wanted.slice(0, this.residentTileBudget);
    const selectedKeys = new Set(selected.map(({ tileX, tileZ }) => keyFor(tileX, tileZ)));
    for (const tile of [...this.#resident.values()]) {
      if (!selectedKeys.has(tile.key)) this.#evict(tile);
    }
    for (const candidate of selected) {
      const key = keyFor(candidate.tileX, candidate.tileZ);
      if (this.#resident.has(key)) {
        this.#selectLod(this.#resident.get(key) as IResidentTile, candidate.distance);
        continue;
      }
      const estimate = estimatedTileBytes(this.tileResolution, this.#factors, this.#worldPasses);
      if (this.residentBytes + estimate > this.residentByteBudget) {
        if (candidate.tileX === centerX && candidate.tileZ === centerZ)
          throw new Error("TerrainTiles residentByteBudget cannot fit the followed tile.");
        continue;
      }
      const tile = this.#createTile(candidate.tileX, candidate.tileZ, candidate.distance);
      if (this.residentBytes + tile.bytes > this.residentByteBudget) {
        this.#disposeTile(tile);
        if (candidate.tileX === centerX && candidate.tileZ === centerZ)
          throw new Error("TerrainTiles residentByteBudget cannot fit the followed tile.");
        continue;
      }
      this.#resident.set(tile.key, tile);
      this.add(tile.lod);
      this.#recordPeaks();
    }
    this.#recordPeaks();
    this.#coordinateNeighborLods(hadFocus);
    this.#recordSeamDiagnostics(false);
    this.#reconcileNeighbors();
    this.#recordSeamDiagnostics();
    this.#recordPeaks();
  }

  heightAt(x: number, z: number): number {
    return this.#fieldAt(x, z).heightAt(x, z);
  }

  normalAt(x: number, z: number, target = new Vector3()): Vector3 {
    return this.#fieldAt(x, z).normalAt(x, z, target);
  }

  sample(channel: string, x: number, z: number): number {
    if (channel === "slope") return 1 - this.normalAt(x, z).y;
    return this.#fieldAt(x, z).sample(channel, x, z);
  }

  attachRenderer(renderer: IRendererLike): void {
    if (this.#released) throw new Error("TerrainTiles cannot attach after release.");
    this.#renderer = renderer;
    this.#topologyField?.attachRenderer(renderer);
    for (const tile of this.#resident.values()) tile.field.attachRenderer(renderer);
  }

  process(renderer = this.#renderer): void {
    if (this.#released) return;
    const lodFrame = this.#captureLodFrame();
    this.#advanceLodTransitions();
    if (renderer !== undefined) {
      this.#topologyField?.process(renderer);
      for (const tile of this.#resident.values()) {
        tile.field.attachRenderer(renderer);
        tile.field.process(renderer);
      }
    }
    this.#recordSeamDiagnostics(false);
    this.#reconcileNeighbors();
    this.#recordSeamDiagnostics();
    this.#recordLodPopAfterReconciliation(lodFrame);
    this.#recordPeaks();
  }

  debug(): Record<string, unknown> {
    const topologyField = this.#topologyField;
    const topology =
      topologyField === undefined
        ? undefined
        : (() => {
            const heights = topologyField.heights;
            const flow = topologyField.flow;
            const description = {
              columns: topologyField.columns,
              depth: topologyField.depth,
              origin: topologyField.origin,
              rows: topologyField.rows,
              width: topologyField.width,
            };
            if (heights.length <= MAX_RAW_TOPOLOGY_SAMPLES)
              return {
                ...description,
                heights: Array.from(heights),
                ...(flow === undefined ? {} : { flow: Array.from(flow) }),
              };
            if (flow === undefined) return description;
            if (this.#topologyMetrics === undefined)
              this.#topologyMetrics = summarizeWorldTopology({
                columns: topologyField.columns,
                depth: topologyField.depth,
                flow,
                heights,
                rows: topologyField.rows,
                width: topologyField.width,
              });
            return {
              ...description,
              metrics: this.#topologyMetrics,
            };
          })();
    return {
      maxSeamGap: this.maxSeamGap,
      maxVisualSeamGap: this.maxVisualSeamGap,
      maxLodTransitionFrames: this.#maxLodTransitionFrames,
      peakResidentBytes: this.#peakBytes,
      peakResidentTiles: this.#peakTiles,
      residentBytes: this.residentBytes,
      residentByteBudget: this.residentByteBudget,
      residentKeys: this.residentKeys,
      residentTiles: this.residentTileCount,
      residentTileBudget: this.residentTileBudget,
      topologyBytes: this.#topologyBytes,
      lodTransitions: this.#lodTransitions,
      maxLodPop: this.#maxLodPop,
      stitchedEdges: this.#stitchedEdges,
      skirtVertexCount: [...this.#resident.values()].reduce(
        (total, tile) => total + tile.skirtVertexCount,
        0,
      ),
      released: this.#released,
      ...(topology === undefined ? {} : { topology }),
    };
  }

  detach(): void {
    this.dispose();
  }

  dispose(): void {
    if (this.#released) return;
    this.#released = true;
    this.#renderer = undefined;
    this.#topologyField?.detach();
    for (const tile of [...this.#resident.values()]) this.#evict(tile);
    this.#resident.clear();
    this.removeFromParent();
  }

  #createField(origin: IHeightfieldOrigin): Heightfield {
    const sampler: IHeightfieldSamplerOptions = {
      columns: this.tileResolution,
      depth: this.tileSize,
      origin,
      rows: this.tileResolution,
      sampleHeight: this.#sampleHeight,
      width: this.tileSize,
      ...(this.#worldPasses === undefined ? {} : { worldPasses: this.#worldPasses }),
    };
    return Heightfield.fromSampler(sampler);
  }

  #createTile(tileX: number, tileZ: number, distance: number): IResidentTile {
    const origin = { x: tileX * this.tileSize, z: tileZ * this.tileSize };
    const assetKey =
      this.#assetKey === undefined
        ? undefined
        : typeof this.#assetKey === "function"
          ? this.#assetKey(tileX, tileZ)
          : this.#assetKey;
    if (assetKey !== undefined && (typeof assetKey !== "string" || assetKey.trim().length === 0))
      throw new Error("TerrainTiles assetKey must resolve to a non-empty string.");
    const field = this.#createField(origin);
    const levels: ILevelGeometry[] = [];
    let lod: LOD | undefined;
    let collider: IWorldTileCollider | undefined;
    try {
      for (const factor of this.#factors)
        levels.push(
          buildLevel(
            field,
            resolutionFor(this.tileResolution, factor),
            this.skirtDepth,
            this.#surface,
          ),
        );
      lod = new LOD();
      lod.autoUpdate = false;
      lod.position.set(origin.x, 0, origin.z);
      levels.forEach(({ mesh }, index) => {
        mesh.visible = index === 0;
        lod?.addLevel(mesh, index === 0 ? 0 : (this.#lodDistances[index - 1] as number));
        mesh.frustumCulled = true;
      });
      collider =
        this.#createCollider?.({ field, key: keyFor(tileX, tileZ), object: lod, tileX, tileZ }) ??
        new EmptyCollider();
      const bytes =
        levels.reduce((total, level) => total + estimatedLevelBytes(level.resolution), 0) +
        field.memoryBytes;
      const tile: IResidentTile = {
        ...(assetKey === undefined ? {} : { assetKey }),
        bytes,
        collider,
        field,
        key: keyFor(tileX, tileZ),
        lod,
        lodLevel: 0,
        levels,
        object: lod,
        origin,
        skirtVertexCount: levels.reduce((total, level) => total + level.skirtVertexCount, 0),
        skirts: this.skirtDepth,
        tileX,
        tileZ,
      };
      this.#selectLod(tile, distance, false);
      return tile;
    } catch (error) {
      collider?.dispose();
      lod?.removeFromParent();
      for (const level of levels) level.geometry.dispose();
      field.detach();
      throw error;
    }
  }

  #selectLod(tile: IResidentTile, distance: number, countTransition = true): void {
    this.#setLodLevel(tile, lodLevelForDistance(distance, this.#lodDistances), countTransition);
  }

  #setLodLevel(tile: IResidentTile, level: number, countTransition = true): void {
    if (level === tile.lodLevel) {
      setManualLodLevel(tile.lod, level);
      return;
    }
    const interruptedFrame =
      tile.lodTransition === undefined ? undefined : this.#captureLodFrameForTile(tile);
    if (tile.lodTransition !== undefined) this.#finishLodTransition(tile);
    const previousLevel = tile.lodLevel;
    const previous = tile.levels[previousLevel];
    const next = tile.levels[level];
    if (previous === undefined || next === undefined)
      throw new Error("TerrainTiles LOD transition references a missing level.");
    tile.lodLevel = level;
    if (!countTransition) {
      setManualLodLevel(tile.lod, level);
      this.#setLodVisibility(tile);
      this.#recordLodPopAfterRetarget(interruptedFrame);
      return;
    }
    this.#lodTransitions += 1;
    tile.lodTransition = {
      elapsedFrames: 0,
      from: previousLevel,
      remainingFrames: LOD_TRANSITION_FRAMES,
      to: level,
    };
    const finerLevel = previous.resolution >= next.resolution ? previousLevel : level;
    const finer = previous.resolution >= next.resolution ? previous : next;
    setManualLodLevel(tile.lod, finerLevel);
    updateLodTransitionGeometry(tile, tile.lodTransition, 0);
    this.#setLodVisibility(tile, [finerLevel]);
    this.#recordLodPopAfterRetarget(interruptedFrame);
  }

  #setLodVisibility(tile: IResidentTile, visibleLevels = [tile.lodLevel]): void {
    const visible = new Set(visibleLevels);
    tile.levels.forEach(({ mesh }, index) => {
      mesh.visible = visible.has(index);
    });
  }

  #captureLodFrame(): ILodFrameSnapshot[] {
    const snapshots: ILodFrameSnapshot[] = [];
    for (const tile of this.#resident.values()) {
      if (tile.lodTransition === undefined) continue;
      snapshots.push(this.#captureLodFrameForTile(tile));
    }
    return snapshots;
  }

  #captureLodFrameForTile(tile: IResidentTile): ILodFrameSnapshot {
    const level = renderedLevel(tile);
    if (level === undefined)
      throw new Error("TerrainTiles cannot measure an LOD transition without a visible level.");
    return { heights: surfaceHeights(level), resolution: level.resolution, tile };
  }

  #recordLodPopAfterReconciliation(snapshots: readonly ILodFrameSnapshot[]): void {
    for (const snapshot of snapshots) {
      const level = renderedLevel(snapshot.tile);
      if (level === undefined)
        throw new Error("TerrainTiles cannot measure an LOD frame without a visible level.");
      this.#recordLodPop(surfaceDeltaFromSamples(snapshot.heights, snapshot.resolution, level));
    }
  }

  #recordLodPopAfterRetarget(snapshot: ILodFrameSnapshot | undefined): void {
    if (snapshot === undefined) return;
    const level = renderedLevel(snapshot.tile);
    if (level === undefined)
      throw new Error(
        "TerrainTiles cannot measure a retargeted LOD frame without a visible level.",
      );
    this.#recordLodPop(surfaceDeltaFromSamples(snapshot.heights, snapshot.resolution, level));
  }

  #advanceLodTransitions(): void {
    for (const tile of this.#resident.values()) {
      const transition = tile.lodTransition;
      if (transition === undefined) continue;
      const from = tile.levels[transition.from];
      if (from === undefined || tile.levels[transition.to] === undefined)
        throw new Error("TerrainTiles LOD transition references a missing level.");
      transition.elapsedFrames += 1;
      transition.remainingFrames -= 1;
      updateLodTransitionGeometry(
        tile,
        transition,
        Math.min(1, transition.elapsedFrames / LOD_TRANSITION_FRAMES),
      );
      if (transition.remainingFrames > 0) continue;
      this.#maxLodTransitionFrames = Math.max(
        this.#maxLodTransitionFrames,
        transition.elapsedFrames,
      );
      this.#restoreLodTransition(tile, transition);
      tile.lodTransition = undefined;
      setManualLodLevel(tile.lod, transition.to);
      this.#setLodVisibility(tile);
    }
  }

  #coordinateNeighborLods(countTransitions: boolean): void {
    const pairs = neighborPairs([...this.#resident.values()]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const pair of pairs) {
        const correction = neighborLodCorrection(pair);
        if (correction === undefined) continue;
        this.#setLodLevel(correction.coarser, correction.level, countTransitions);
        changed = true;
      }
    }
  }

  #reconcileNeighbors(): void {
    const pairs = neighborPairs([...this.#resident.values()]);
    const active = new Set<string>();
    for (const pair of pairs) {
      const key = neighborPairKey(pair);
      active.add(key);
      const previousBytes = this.#stitches.get(key)?.bytes ?? 0;
      const bridge = reconcileNeighborPair(pair, this.#surface, this.#stitches.get(key));
      if (bridge === undefined) {
        this.#removeStitch(key);
        continue;
      }
      if (this.#stitches.has(key)) {
        this.#stitchBytes += bridge.bytes - previousBytes;
      } else {
        this.#stitches.set(key, bridge);
        this.add(bridge.mesh);
        this.#stitchBytes += bridge.bytes;
      }
      this.#stitchedEdges += 1;
    }
    for (const key of this.#stitches.keys()) {
      if (!active.has(key)) this.#removeStitch(key);
    }
    if (this.residentBytes > this.residentByteBudget)
      throw new Error("TerrainTiles residentByteBudget cannot fit stitched neighbor geometry.");
  }

  #finishLodTransition(tile: IResidentTile): void {
    const transition = tile.lodTransition;
    if (transition === undefined) return;
    this.#maxLodTransitionFrames = Math.max(this.#maxLodTransitionFrames, transition.elapsedFrames);
    this.#restoreLodTransition(tile, transition);
    tile.lodTransition = undefined;
    setManualLodLevel(tile.lod, transition.to);
    this.#setLodVisibility(tile);
  }

  #restoreLodTransition(tile: IResidentTile, transition: ILodTransition): void {
    const from = tile.levels[transition.from];
    const to = tile.levels[transition.to];
    if (from === undefined || to === undefined) return;
    restoreLevelSurface(tile.field, from.resolution >= to.resolution ? from : to);
  }

  #recordLodPop(pop: number): void {
    if (!Number.isFinite(pop)) throw new Error("TerrainTiles LOD pop observation must be finite.");
    this.#maxLodPop = Math.max(this.#maxLodPop, pop);
    if (pop > LOD_POP_THRESHOLD)
      throw new Error(
        `TerrainTiles LOD pop threshold ${String(LOD_POP_THRESHOLD)} exceeded by ${String(pop)}.`,
      );
  }

  #removeStitch(key: string): void {
    const bridge = this.#stitches.get(key);
    if (bridge === undefined) return;
    this.#stitches.delete(key);
    this.remove(bridge.mesh);
    this.#stitchBytes -= bridge.bytes;
    bridge.geometry.dispose();
  }

  #removeStitchesForTile(tileKey: string): void {
    for (const [key, bridge] of this.#stitches) {
      if (bridge.keys.includes(tileKey)) this.#removeStitch(key);
    }
  }

  #recordSeamDiagnostics(includeBridgeCoverage = true): void {
    const tiles = [...this.#resident.values()];
    for (const tile of tiles) {
      for (const neighbor of tiles) {
        if (tile.key >= neighbor.key || !areNeighbors(tile, neighbor)) continue;
        const { gap, visualGap } = seamObservation(
          tile,
          neighbor,
          this.#stitches.get(neighborPairKey([tile, neighbor])),
          this,
          includeBridgeCoverage,
        );
        this.#maxSeamGap = Math.max(this.#maxSeamGap, gap);
        this.#maxVisualSeamGap = Math.max(this.#maxVisualSeamGap, visualGap);
      }
    }
  }

  #fieldAt(x: number, z: number): Heightfield {
    finite(x, "query x");
    finite(z, "query z");
    const tileX = Math.floor((x + this.tileSize / 2) / this.tileSize);
    const tileZ = Math.floor((z + this.tileSize / 2) / this.tileSize);
    const tile = this.#resident.get(keyFor(tileX, tileZ));
    if (tile === undefined)
      throw new Error(`TerrainTiles query (${x}, ${z}) is outside its resident region.`);
    return tile.field;
  }

  #evict(tile: IResidentTile): void {
    if (this.#resident.get(tile.key) === tile) this.#resident.delete(tile.key);
    this.#removeStitchesForTile(tile.key);
    this.remove(tile.lod);
    tile.collider.dispose();
    tile.field.detach();
    for (const level of tile.levels) level.geometry.dispose();
    this.#releaseAsset(tile);
  }

  #disposeTile(tile: IResidentTile): void {
    tile.collider.dispose();
    tile.field.detach();
    for (const level of tile.levels) level.geometry.dispose();
    tile.lod.removeFromParent();
    this.#releaseAsset(tile);
  }

  #releaseAsset(tile: IResidentTile): void {
    if (this.#assets === undefined || tile.assetKey === undefined) return;
    const stillReferenced = [...this.#resident.values()].some(
      (resident) => resident !== tile && resident.assetKey === tile.assetKey,
    );
    if (!stillReferenced) this.#assets.release("model", tile.assetKey);
  }

  #recordPeaks(): void {
    this.#peakTiles = Math.max(this.#peakTiles, this.residentTileCount);
    this.#peakBytes = Math.max(this.#peakBytes, this.residentBytes);
  }
}
