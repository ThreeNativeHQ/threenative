import { BufferAttribute, BufferGeometry, LOD, Mesh, Object3D, Vector3 } from "three";
import type { IAssetLoader } from "./assets.js";
import type { IComputeDriven } from "./compute-driven.js";
import type { IRendererLike } from "./renderer.js";
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
  lodLevel: number;
  readonly origin: IHeightfieldOrigin;
  readonly skirts: number;
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

function resolutionFor(tileResolution: number, factor: number): number {
  const cells = (tileResolution - 1) / factor;
  if (!Number.isInteger(cells))
    throw new Error("TerrainTiles tileResolution minus one must divide every lod factor.");
  return cells + 1;
}

function estimatedLevelBytes(resolution: number): number {
  const vertices = resolution * resolution + resolution * 4;
  const triangles = (resolution - 1) * (resolution - 1) + (resolution - 1) * 4;
  return (
    vertices * 3 * Float32Array.BYTES_PER_ELEMENT * 2 +
    triangles * 6 * Uint32Array.BYTES_PER_ELEMENT
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

function edgeValue(values: Float32Array, normalized: number): number {
  const position = normalized * (values.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(values.length - 1, lower + 1);
  const mix = position - lower;
  return (values[lower] as number) * (1 - mix) + (values[upper] as number) * mix;
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

function seamGap(a: IResidentTile, b: IResidentTile): number {
  const [aSide, bSide] = opposingEdge(a, b);
  const aEdge = a.levels[a.lodLevel]?.edgeSamples[aSide];
  const bEdge = b.levels[b.lodLevel]?.edgeSamples[bSide];
  if (aEdge === undefined || bEdge === undefined) return Number.POSITIVE_INFINITY;
  const samples = Math.max(aEdge.length, bEdge.length);
  let maximum = 0;
  for (let index = 0; index < samples; index += 1) {
    const normalized = samples === 1 ? 0 : index / (samples - 1);
    maximum = Math.max(
      maximum,
      Math.abs(edgeValue(aEdge, normalized) - edgeValue(bEdge, normalized)),
    );
  }
  return maximum;
}

function seamCoverageDepth(a: IResidentTile, b: IResidentTile): number {
  const aLevel = a.levels[a.lodLevel];
  const bLevel = b.levels[b.lodLevel];
  if (aLevel === undefined || bLevel === undefined) return 0;
  return Math.min(aLevel.skirtDepth, bLevel.skirtDepth);
}

function areNeighbors(a: IResidentTile, b: IResidentTile): boolean {
  return Math.abs(a.tileX - b.tileX) + Math.abs(a.tileZ - b.tileZ) === 1;
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
  readonly #topologyField: Heightfield | undefined;
  readonly #worldPasses: IHeightfieldWorldPassOptions | undefined;
  readonly #resident = new Map<string, IResidentTile>();
  #focus: IWorldTilesFollowPosition | undefined;
  #peakBytes = 0;
  #peakTiles = 0;
  #lodTransitions = 0;
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
    this.#topologyField =
      options.topologyObservation === undefined
        ? undefined
        : Heightfield.fromSampler({
            ...options.topologyObservation,
            sampleHeight: this.#sampleHeight,
            ...(this.#worldPasses === undefined ? {} : { worldPasses: this.#worldPasses }),
          });
    this.frustumCulled = true;
  }

  get released(): boolean {
    return this.#released;
  }

  get residentTileCount(): number {
    return this.#resident.size;
  }

  get residentBytes(): number {
    return [...this.#resident.values()].reduce((total, tile) => total + tile.bytes, 0);
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

  get maxSeamGap(): number {
    let maximum = 0;
    const tiles = [...this.#resident.values()];
    for (const tile of tiles) {
      for (const neighbor of tiles) {
        if (tile.key >= neighbor.key || !areNeighbors(tile, neighbor)) continue;
        maximum = Math.max(maximum, seamGap(tile, neighbor));
      }
    }
    return maximum;
  }

  /** The remaining visible gap after the skirt depths observed in generated geometry. */
  get maxVisualSeamGap(): number {
    let maximum = 0;
    const tiles = [...this.#resident.values()];
    for (const tile of tiles) {
      for (const neighbor of tiles) {
        if (tile.key >= neighbor.key || !areNeighbors(tile, neighbor)) continue;
        maximum = Math.max(
          maximum,
          Math.max(0, seamGap(tile, neighbor) - seamCoverageDepth(tile, neighbor)),
        );
      }
    }
    return maximum;
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
    if (this.#released || renderer === undefined) return;
    this.#topologyField?.process(renderer);
    for (const tile of this.#resident.values()) {
      tile.field.attachRenderer(renderer);
      tile.field.process(renderer);
    }
  }

  debug(): Record<string, unknown> {
    const topology =
      this.#topologyField === undefined
        ? undefined
        : {
            columns: this.#topologyField.columns,
            depth: this.#topologyField.depth,
            heights: Array.from(this.#topologyField.heights),
            origin: this.#topologyField.origin,
            rows: this.#topologyField.rows,
            width: this.#topologyField.width,
            ...(this.#topologyField.flow === undefined
              ? {}
              : { flow: Array.from(this.#topologyField.flow) }),
          };
    return {
      maxSeamGap: this.maxSeamGap,
      maxVisualSeamGap: this.maxVisualSeamGap,
      peakResidentBytes: this.#peakBytes,
      peakResidentTiles: this.#peakTiles,
      residentBytes: this.residentBytes,
      residentKeys: this.residentKeys,
      residentTiles: this.residentTileCount,
      lodTransitions: this.#lodTransitions,
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
    const sampler: IHeightfieldSamplerOptions = {
      columns: this.tileResolution,
      depth: this.tileSize,
      origin,
      rows: this.tileResolution,
      sampleHeight: this.#sampleHeight,
      width: this.tileSize,
      ...(this.#worldPasses === undefined ? {} : { worldPasses: this.#worldPasses }),
    };
    const field = Heightfield.fromSampler(sampler);
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
        estimatedFieldBytes(this.tileResolution, this.#worldPasses);
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
      this.#selectLod(tile, distance);
      return tile;
    } catch (error) {
      collider?.dispose();
      lod?.removeFromParent();
      for (const level of levels) level.geometry.dispose();
      field.detach();
      throw error;
    }
  }

  #selectLod(tile: IResidentTile, distance: number): void {
    let level = 0;
    for (const threshold of this.#lodDistances) {
      if (distance < threshold) break;
      level += 1;
    }
    if (level === tile.lodLevel) return;
    tile.lodLevel = level;
    this.#lodTransitions += 1;
    tile.levels.forEach(({ mesh }, index) => {
      mesh.visible = index === level;
    });
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
