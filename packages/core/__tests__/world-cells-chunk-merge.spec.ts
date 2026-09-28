import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  FrontSide,
  Group,
  InstancedMesh,
  InterleavedBufferAttribute,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Vector3,
} from "three";
import { PerspectiveCamera } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DISCRETE_LOD_SCHEMA_VERSION,
  DiscreteLodPlugin,
  TN_DISCRETE_LOD,
  lodChainOf,
} from "../src/model-lod.js";
import { VIRTUAL_SHADOW_CASTER_LAYER } from "../src/render/virtual-shadow.js";
import type { IRendererLike } from "../src/renderer.js";
import { isStatic } from "../src/static-transform.js";
import { type IWorldPackage, WorldCells } from "../src/world.js";

/**
 * A hand-placed chunk submits one draw per mesh node, in the main pass and again in every shadow
 * level that redraws it — 42 nodes over 8 materials is 42 calls where 8 would do. The chunk is the
 * one subtree here that never moves, so it is merged by material before it is ever added.
 *
 * Everything the bake cannot flatten keeps its own geometry: a chain-carried mesh has a `ModelLod`
 * that swaps it, a morph-target mesh would lose its targets, and an instanced mesh past the triangle
 * cap is already one cheap draw.
 */

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "world-v1");
const manifest = JSON.parse(
  readFileSync(path.join(fixture, "world.json"), "utf8"),
) as IWorldPackage;

const CELL_SIZE = manifest.cellSize;
const CHUNK_PATH = "chunks/yard_1_1.glb";
/** The centre of the one cell the fixture keeps, so the follow point lands in the chunk's cell. */
const FOLLOW = {
  x: manifest.extent.minX + 1.5 * CELL_SIZE,
  z: manifest.extent.minZ + 1.5 * CELL_SIZE,
};
/** Where the chunk sits in the world, so a baked vertex is at its authored place and not at zero. */
const CHUNK_ORIGIN = new Vector3(10, 0, -5);
/** Box sides cycling per mesh, so a merged vertex proves which piece it came from. */
const SIDES = [1, 2, 3];
const PER_MATERIAL = 4;
const INSTANCES = 5;
const INSTANCE_GAP = 4;

const surface = new MeshBasicMaterial();
const budgets = { bytes: 1_000_000_000, instances: 1_000_000, residentCells: 64 };

function fileResponse(buffer: Buffer): object {
  return {
    arrayBuffer: async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    headers: new Headers(),
    json: async () => JSON.parse(buffer.toString("utf8")),
    ok: true,
    status: 200,
  };
}

/** The committed package with one cell, one chunk and nothing scattered: only the chunk is tested. */
function oneChunk(): IWorldPackage {
  const cell = manifest.cells.find((candidate) => candidate.x === 1 && candidate.z === 1);
  if (cell === undefined) throw new Error("the committed package has no cell 1:1.");
  return { ...manifest, cells: [{ ...cell, chunks: [CHUNK_PATH], runs: [] }] };
}

function stubManifestFetch(pkg: IWorldPackage): void {
  const body = JSON.stringify(pkg);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown): Promise<object> => {
      const url = String(input);
      if (url.endsWith("world.json"))
        return {
          arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
          headers: new Headers(),
          json: async () => pkg,
          ok: true,
          status: 200,
        };
      if (url.endsWith("placements.bin"))
        return fileResponse(readFileSync(path.join(fixture, "placements.bin")));
      if (url.endsWith("heightmap.u16"))
        return fileResponse(readFileSync(path.join(fixture, "terrain", "heightmap.u16")));
      return {
        arrayBuffer: async () => new ArrayBuffer(0),
        headers: new Headers(),
        ok: false,
        status: 404,
      };
    }),
  );
}

/** The chunk a 2 km package's cook would hand over: 12 boxes over 3 materials, plus 5 repeats. */
function chunkModel(): { readonly group: Group; readonly materials: MeshBasicMaterial[] } {
  const group = new Group();
  group.position.copy(CHUNK_ORIGIN);
  const materials = [0, 1, 2].map(() => new MeshBasicMaterial());
  let placed = 0;
  for (const material of materials)
    for (let part = 0; part < PER_MATERIAL; part += 1) {
      const mesh = new Mesh(new BoxGeometry(SIDES[part % SIDES.length] as number, 2, 3), material);
      mesh.position.set(placed * INSTANCE_GAP, part, 0);
      group.add(mesh);
      placed += 1;
    }
  const repeated = new InstancedMesh(
    new BoxGeometry(2, 2, 2),
    materials[0] as MeshBasicMaterial,
    INSTANCES,
  );
  for (let instance = 0; instance < INSTANCES; instance += 1)
    repeated.setMatrixAt(
      instance,
      new Matrix4().makeTranslation(placed * INSTANCE_GAP + instance * INSTANCE_GAP, 4, 0),
    );
  repeated.instanceMatrix.needsUpdate = true;
  group.add(repeated);
  return { group, materials };
}

/** Where every piece of the chunk is, in world space: the box the merged geometry has to reproduce. */
function sourceBox(group: Object3D): Box3 {
  const box = new Box3().makeEmpty();
  const matrix = new Matrix4();
  const placed = new Matrix4();
  group.updateMatrixWorld(true);
  group.traverse((object) => {
    const mesh = object as Mesh & { isInstancedMesh?: boolean };
    if (mesh.isMesh !== true) return;
    mesh.geometry.computeBoundingBox();
    const piece = (mesh.geometry.boundingBox as Box3).clone();
    if (mesh.isInstancedMesh === true) {
      const instanced = mesh as InstancedMesh;
      for (let instance = 0; instance < instanced.count; instance += 1) {
        instanced.getMatrixAt(instance, matrix);
        box.union(piece.clone().applyMatrix4(placed.multiplyMatrices(mesh.matrixWorld, matrix)));
      }
      return;
    }
    box.union(piece.applyMatrix4(mesh.matrixWorld));
  });
  return box;
}

function meshesIn(root: Object3D): Mesh[] {
  const found: Mesh[] = [];
  root.traverse((object) => {
    if ((object as Mesh).isMesh === true) found.push(object as Mesh);
  });
  return found;
}

function markers(): string[] {
  return (console.info as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith("TN_WORLD_CHUNK_MERGE"));
}

async function flush(rounds = 12): Promise<void> {
  for (let round = 0; round < rounds; round += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Step the world until the chunk has attached, or fail rather than assert on nothing. */
async function chunkAttached(world: WorldCells, renderer?: IRendererLike): Promise<Group> {
  for (let pass = 0; pass < 200; pass += 1) {
    await flush();
    world.update(renderer, followCamera);
    if (world.stats().loadsInFlight === 0) {
      const chunk = world.getObjectByName("world-chunk");
      if (chunk !== undefined) return chunk as Group;
    }
  }
  throw new Error("the world never attached the chunk.");
}

/** Load the chunk, wait for the world to settle it, and hand back the chunk it attached. */
const followCamera = new PerspectiveCamera(60, 1, 0.1, 1000);
followCamera.position.set(FOLLOW.x, 20, FOLLOW.z);
followCamera.lookAt(FOLLOW.x, 0, FOLLOW.z);
followCamera.updateMatrixWorld();

/**
 * A renderer whose WebGPU backend counts the attributes it is asked to create, which is the whole
 * of what the seam does: the buffers the bake made, before anything can draw them.
 */
function countingRenderer(uploaded: BufferGeometry[]): IRendererLike {
  return {
    compileAsync: () => Promise.resolve(),
    uploadAttributes: (batch) => {
      let created = 0;
      for (const geometry of batch) {
        uploaded.push(geometry);
        created += Object.keys(geometry.attributes).length;
        if (geometry.getIndex() !== null) created += 1;
      }
      return created;
    },
  } as unknown as IRendererLike;
}

async function attached(
  model: Object3D,
  options: Partial<Parameters<typeof WorldCells.load>[0]>,
  renderer?: IRendererLike,
): Promise<{ readonly chunk: Group; readonly world: WorldCells }> {
  stubManifestFetch(oneChunk());
  const world = await WorldCells.load({
    ...options,
    admissionBudgetMs: Number.POSITIVE_INFINITY,
    budgets,
    follow: { position: { ...FOLLOW } },
    loadModel: async () => model,
    prefetchSeconds: 0,
    ring: 0,
    surface,
    url: "/world/world.json",
  });
  return { chunk: await chunkAttached(world, renderer), world };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * A grid over its own baked AutoLOD chain, registered by the real plugin — the parser is the only
 * fake part, exactly as `world-cells-chain-lod.spec.ts` builds it.
 */
async function chainedMesh(): Promise<Mesh> {
  const triangles = 16;
  const quads = triangles / 2;
  const positions = new Float32Array((quads + 1) * 2 * 3);
  for (let vertex = 0; vertex <= quads; vertex += 1) {
    const at = (vertex / quads - 0.5) * 2;
    positions.set([at, 0, at, at, 1, at], vertex * 6);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const indices = (count: number): Uint32Array => {
    const at = new Uint32Array(count * 3);
    for (let quad = 0; quad < count / 2; quad += 1) {
      const offset = quad * 6;
      at[offset] = quad * 2;
      at[offset + 1] = quad * 2 + 1;
      at[offset + 2] = quad * 2 + 2;
      at[offset + 3] = quad * 2 + 1;
      at[offset + 4] = quad * 2 + 3;
      at[offset + 5] = quad * 2 + 2;
    }
    return at;
  };
  geometry.setIndex(new BufferAttribute(indices(triangles), 1));
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  const levels = [indices(8), indices(4)];
  const plugin = new DiscreteLodPlugin();
  plugin.setParser({
    associations: new Map<object, { meshes: number; primitives: number }>([
      [mesh, { meshes: 0, primitives: 0 }],
    ]),
    getDependency: async (_type: string, index: number) => ({ array: levels[index] }),
    json: {
      meshes: [
        {
          primitives: [
            {
              extensions: {
                [TN_DISCRETE_LOD]: {
                  absoluteErrors: [0.05, 0.2],
                  counts: [8, 4],
                  errors: [0.05, 0.2],
                  indices: [0, 1],
                  lod0Triangles: triangles,
                  schemaVersion: DISCRETE_LOD_SCHEMA_VERSION,
                },
              },
            },
          ],
        },
      ],
    },
  });
  await plugin.afterRoot({});
  plugin.attach(mesh, { hysteresis: 0.15, maxPixelError: 1 });
  return mesh;
}

/** A mesh with a morph target the bake would drop: the target is the mesh's own business. */
function morphed(): Mesh {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  mesh.geometry.morphAttributes.position = [
    new BufferAttribute(
      Float32Array.from(mesh.geometry.getAttribute("position").array as Float32Array),
      3,
    ),
  ];
  return mesh;
}

/** Three opaque materials and one cutout: the per-material shadow bill, before the proxy. */
function shadowChunkModel(): {
  readonly cutout: MeshBasicMaterial;
  readonly group: Group;
  readonly opaque: MeshBasicMaterial[];
} {
  const group = new Group();
  group.position.copy(CHUNK_ORIGIN);
  const opaque = [0, 1, 2].map(() => new MeshBasicMaterial());
  const cutout = new MeshBasicMaterial({ alphaTest: 0.5 });
  let placed = 0;
  for (const material of [...opaque, cutout])
    for (let part = 0; part < PER_MATERIAL; part += 1) {
      const mesh = new Mesh(new BoxGeometry(2, 2, 2), material);
      mesh.position.set(placed * INSTANCE_GAP, part, 0);
      group.add(mesh);
      placed += 1;
    }
  return { cutout, group, opaque };
}

describe("a hand-placed chunk merged by material", () => {
  it("uploads the merged buffers during admission, not on the first draw", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { group } = chunkModel();
    const uploaded: BufferGeometry[] = [];
    const { chunk, world } = await attached(group, {}, countingRenderer(uploaded));

    // Every one of the three merged groups — position, normal, uv and the index, four buffers each —
    // was handed the renderer during admission, which is the frame that used to create them.
    const merged = meshesIn(chunk);
    expect(merged).toHaveLength(3);
    expect(uploaded).toEqual(merged.map((mesh) => mesh.geometry));
    expect(markers()).toEqual([
      "TN_WORLD_CHUNK_MERGE meshes=13 draws=3 bytes=14280 uploaded=12 instancedExpanded=1 keptInstanced=0 shadowDraws=0",
    ]);
    // And the chunk is attached, so the seam is admission and not a replacement for it.
    expect(chunk.parent).not.toBeNull();
    world.dispose();
  });

  it("attaches as one mesh per material, at the vertices the package authored", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { group, materials } = chunkModel();
    const authored = sourceBox(group);
    const { chunk, world } = await attached(group, {});

    // Thirteen nodes in, three draws out: the four boxes and the five repeats under `materials[0]`
    // are one buffer now, and the other two materials are one each. `bytes` is what those buffers
    // hold, indices included: 19,584 before the bake kept its index (nine boxes plus four plus four,
    // de-indexed at 36 vertices and 32 bytes each) and 14,280 after, which is what a first draw of a
    // merged chunk uploads.
    const meshes = meshesIn(chunk);
    expect(meshes).toHaveLength(3);
    expect(meshes.map((mesh) => mesh.material).sort()).toEqual([...materials].sort());
    expect(markers()).toEqual([
      "TN_WORLD_CHUNK_MERGE meshes=13 draws=3 bytes=14280 uploaded=0 instancedExpanded=1 keptInstanced=0 shadowDraws=0",
    ]);

    // The whole point of the bake is that the geometry did not move: every vertex is where the
    // export put it, so the chunk's box is the union of the pieces it was made of.
    meshes[0]?.geometry.computeBoundingBox();
    const box = (meshes[0]?.geometry.boundingBox as Box3).clone().applyMatrix4(chunk.matrixWorld);
    for (let component = 0; component < 3; component += 1)
      expect([box.min.getComponent(component), box.max.getComponent(component)]).toEqual([
        expect.closeTo(authored.min.getComponent(component), 5),
        expect.closeTo(authored.max.getComponent(component), 5),
      ]);

    // Behaviour kept: the chunk is still one frozen subtree, still casting and receiving as the
    // world's shadow options say, and the merged groups are the chunk's own children.
    expect(isStatic(chunk)).toBe(true);
    for (const mesh of meshes) {
      expect(mesh.parent).toBe(chunk);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(false);
    }
    expect(world.stats().failures).toBe(0);
    world.dispose();
  });

  it("keeps an instanced mesh whose group would cross the triangle cap", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { group, materials } = chunkModel();
    // The cap is on the expanded triangles alone: five repeats of a 12-triangle box is 60, and the
    // instanced draw that already exists costs one call to draw them.
    const { chunk, world } = await attached(group, { chunkMergeMaxTriangles: 1 });

    const meshes = meshesIn(chunk);
    expect(meshes).toHaveLength(4);
    expect(meshes.filter((mesh) => mesh instanceof InstancedMesh)).toHaveLength(1);
    expect((meshes.find((mesh) => mesh instanceof InstancedMesh) as InstancedMesh).count).toBe(
      INSTANCES,
    );
    // Still the chunk's own material, and still its own node: an instanced mesh kept in place draws
    // exactly what it drew before the bake.
    const kept = meshes.find((mesh) => mesh instanceof InstancedMesh) as InstancedMesh;
    expect(kept.material).toBe(materials[0]);
    expect(markers()).toEqual([
      "TN_WORLD_CHUNK_MERGE meshes=13 draws=4 bytes=10080 uploaded=0 instancedExpanded=0 keptInstanced=1 shadowDraws=0",
    ]);
    expect(world.stats().failures).toBe(0);
    world.dispose();
  });

  it("disposes the merged buffers when the chunk's cell is evicted", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { group } = chunkModel();
    const follow = { position: { ...FOLLOW } };
    stubManifestFetch(oneChunk());
    const world = await WorldCells.load({
      admissionBudgetMs: Number.POSITIVE_INFINITY,
      budgets,
      follow,
      loadModel: async () => group,
      prefetchSeconds: 0,
      ring: 0,
      surface,
      url: "/world/world.json",
    });
    const merged = meshesIn(await chunkAttached(world));
    expect(merged).toHaveLength(3);
    const disposed = merged.map((mesh) => vi.spyOn(mesh.geometry, "dispose"));

    // Past the hysteresis ring the cell leaves, and the buffers the bake made go with it — they
    // belong to the chunk, unlike the package's own geometry, which the loader cache still holds.
    follow.position.x += 4 * CELL_SIZE;
    for (let pass = 0; pass < 40 && world.stats().residentKeys.length > 0; pass += 1) {
      world.update();
      await flush();
    }
    expect(world.stats().residentKeys).toEqual([]);
    for (const spy of disposed) expect(spy).toHaveBeenCalled();
    expect(world.getObjectByName("world-chunk")).toBeUndefined();
    world.dispose();
  });

  it("leaves a chained or morphed mesh exactly where the package put it", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { group, materials } = chunkModel();
    const chained = await chainedMesh();
    const target = morphed();
    group.add(chained, target);
    const { chunk, world } = await attached(group, {});

    // Fifteen nodes in, five draws out: the three material groups, plus the two meshes the bake
    // cannot flatten. A merged buffer would carry a `ModelLod` with no geometry to swap, and would
    // drop the morph target outright — so each keeps its own geometry and its own node.
    const meshes = meshesIn(chunk);
    expect(meshes).toHaveLength(5);
    expect(meshes).toContain(chained);
    expect(meshes).toContain(target);
    expect(
      meshes
        .filter((mesh) => materials.includes(mesh.material as MeshBasicMaterial))
        .map((mesh) => mesh.material)
        .sort(),
    ).toEqual([...materials].sort());
    expect(lodChainOf(chained.geometry)).toBeDefined();
    expect(target.geometry.morphAttributes.position).toHaveLength(1);
    expect(markers()).toEqual([
      "TN_WORLD_CHUNK_MERGE meshes=15 draws=5 bytes=14280 uploaded=0 instancedExpanded=1 keptInstanced=0 shadowDraws=0",
    ]);
    expect(world.stats().failures).toBe(0);
    world.dispose();
  });

  it("collapses the chunk's shadow bill into one position-only proxy per side", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { cutout, group, opaque } = shadowChunkModel();
    const follow = { position: { ...FOLLOW } };
    stubManifestFetch(oneChunk());
    const world = await WorldCells.load({
      admissionBudgetMs: Number.POSITIVE_INFINITY,
      budgets,
      follow,
      loadModel: async () => group,
      prefetchSeconds: 0,
      ring: 0,
      shadows: { cast: true, receive: true },
      surface,
      url: "/world/world.json",
    });
    const chunk = await chunkAttached(world);
    const proxy = chunk.getObjectByName("world-chunk-shadow") as Mesh | undefined;
    if (proxy === undefined) throw new Error("Expected one shadow-only proxy on the chunk.");

    // One draw per level instead of one per material: the four material groups are still four
    // meshes in the main pass, and the depth pass reads this one.
    expect(markers()).toEqual([
      "TN_WORLD_CHUNK_MERGE meshes=16 draws=5 bytes=13440 uploaded=0 instancedExpanded=0 keptInstanced=0 shadowDraws=1",
    ]);
    expect(meshesIn(chunk)).toHaveLength(5);
    // On the layer the level shadow cameras draw and the main camera never does, and nothing else.
    expect(proxy.layers.mask).toBe(1 << VIRTUAL_SHADOW_CASTER_LAYER);
    expect(proxy.castShadow).toBe(true);
    expect(proxy.receiveShadow).toBe(false);
    // The group's own material, by reference: the side it is grouped by is that material's own
    // `side`, so the depth pass reads exactly what the covered mesh's depth material would have.
    expect(opaque).toContain(proxy.material as MeshBasicMaterial);
    expect((proxy.material as Material).side).toBe(FrontSide);
    // Positions and indices, because a depth pass reads no more than that.
    expect(proxy.geometry.getAttribute("position")).toBeDefined();
    expect(proxy.geometry.getAttribute("normal")).toBeUndefined();
    expect(proxy.geometry.getIndex()).not.toBeNull();

    // The three opaque groups keep drawing the main pass with the game's own materials and keep
    // receiving, and stop casting: the proxy carries the same vertices, so casting from both would
    // pay the bill twice.
    const covered = meshesIn(chunk).filter(
      (mesh) => mesh !== proxy && opaque.includes(mesh.material as MeshBasicMaterial),
    );
    expect(covered).toHaveLength(3);
    for (const mesh of covered) {
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(true);
    }
    // A cutout's depth is its own alpha test, so it is not covered and keeps casting itself.
    const cut = meshesIn(chunk).filter((mesh) => mesh !== proxy && mesh.material === cutout);
    expect(cut).toHaveLength(1);
    expect(cut[0]?.castShadow).toBe(true);

    // And the proxy's vertices are the covered ones, in the chunk's own space.
    const coveredBox = new Box3().makeEmpty();
    for (const mesh of covered) {
      mesh.geometry.computeBoundingBox();
      coveredBox.union(mesh.geometry.boundingBox as Box3);
    }
    const proxyPosition = proxy.geometry.getAttribute("position");
    if (proxyPosition instanceof InterleavedBufferAttribute)
      throw new Error("Expected a plain position attribute on the proxy.");
    const proxyBox = new Box3().setFromBufferAttribute(proxyPosition);
    expect(proxyBox.equals(coveredBox)).toBe(true);

    // The proxy belongs to the chunk: evicting the cell releases it with the rest of the subtree.
    const disposed = vi.spyOn(proxy.geometry, "dispose");
    follow.position.x += 4 * CELL_SIZE;
    for (let pass = 0; pass < 40 && world.stats().residentKeys.length > 0; pass += 1) {
      world.update();
      await flush();
    }
    expect(world.stats().residentKeys).toEqual([]);
    expect(disposed).toHaveBeenCalled();
    world.dispose();
  });
});
