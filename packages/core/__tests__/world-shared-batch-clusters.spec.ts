import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Box3,
  BoxGeometry,
  Frustum,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  OrthographicCamera,
  Vector3,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IWorldPackage } from "../src/world.js";
import { WorldCells } from "../src/world.js";

/**
 * PRD-458 AC-1: a shared batch is one mesh per world-grid square of `clusterSize`, with the square's
 * own bounds, so every camera — the main one and each virtual-shadow level's — culls at square
 * granularity instead of submitting the whole resident ring.
 *
 * Three claims, each of which the unclustered implementation fails: a cluster's bounds hold exactly
 * its own live records; a frustum over one square's area selects that square's meshes and nothing
 * else; and a cluster that streams out and back is handed the mesh it had, never a second one.
 * Casting is the clusters themselves, so the `shadows.castDistance` companions are gone.
 */

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "world-v1");
const manifest = JSON.parse(
  readFileSync(path.join(fixture, "world.json"), "utf8"),
) as IWorldPackage;
const CELL_SIZE = manifest.cellSize;
const MIN_X = manifest.extent.minX;
const MIN_Z = manifest.extent.minZ;
const surface = new MeshBasicMaterial();
const budgets = { bytes: 1_000_000_000, instances: 1_000_000, residentCells: 16 };
/** The finest virtual-shadow level's window, from `VirtualShadowNode`'s own default level distances. */
const LEVEL_WINDOW = 48;

interface IResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: Headers;
  arrayBuffer: () => Promise<ArrayBuffer>;
  json: () => Promise<unknown>;
}

function fileResponse(buffer: Buffer): IResponseLike {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    arrayBuffer: async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    json: async () => JSON.parse(buffer.toString("utf8")),
  };
}

function stubFixtureFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown): Promise<IResponseLike> => {
      const url = String(input);
      if (url.endsWith("world.json"))
        return fileResponse(readFileSync(path.join(fixture, "world.json")));
      if (url.endsWith("placements.bin"))
        return fileResponse(readFileSync(path.join(fixture, "placements.bin")));
      if (url.endsWith("heightmap.u16"))
        return fileResponse(readFileSync(path.join(fixture, "terrain/heightmap.u16")));
      return {
        ok: false,
        status: 404,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0),
        json: async () => ({}),
      };
    }),
  );
}

/** Two drawable parts per model, so one key is not one mesh and the cull has something to cull. */
function model(): Object3D {
  const group = new Group();
  for (let part = 0; part < 2; part += 1)
    group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
  return group;
}

function cellCenter(x: number, z: number): { x: number; z: number } {
  return { x: MIN_X + (x + 0.5) * CELL_SIZE, z: MIN_Z + (z + 0.5) * CELL_SIZE };
}

async function makeWorld(overrides: { clusterSize?: number } = {}): Promise<{
  readonly follow: { position: { x: number; z: number } };
  readonly world: WorldCells;
}> {
  stubFixtureFetch();
  const follow = { position: cellCenter(1, 1) };
  const world = await WorldCells.load({
    admissionBudgetMs: Number.POSITIVE_INFINITY,
    budgets,
    clusterSize: overrides.clusterSize,
    follow,
    loadModel: async () => model(),
    ring: 1,
    // The stopgap option a game set, accepted and ignored, and the cast flags that make the
    // clusters themselves the casters.
    shadows: { cast: true, castDistance: 15 },
    surface,
    url: "/world/world.json",
  });
  return { follow, world };
}

async function flush(rounds = 8): Promise<void> {
  for (let round = 0; round < rounds; round += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Update until the world holds its ring, letting the model loads and the fresh-mesh allowance
 * resolve between frames. A synchronous loop settles nothing: the first pass queues promise work,
 * and a loop that never yields never gets it.
 */
async function settle(world: WorldCells, limit = 900): Promise<void> {
  let stable = 0;
  let owed = Number.POSITIVE_INFINITY;
  for (let frame = 0; frame < limit; frame += 1) {
    world.update();
    await flush(1);
    const stats = world.stats();
    const done = stats.admission.backlog;
    if (done === 0 && stats.loadsInFlight === 0 && stats.loadsQueued === 0) {
      stable = owed === done ? stable + 1 : 0;
      owed = done;
      if (stable > 8) return;
    } else {
      stable = 0;
      owed = done;
    }
  }
  throw new Error(`WorldCells still owed ${String(world.stats().admission.backlog)} units.`);
}

/** Every batch mesh the world drew, keyed by the `asset:level:part@x,z` cluster key it carries. */
function clusters(world: WorldCells): Map<string, InstancedMesh> {
  const meshes = new Map<string, InstancedMesh>();
  world.traverse((object) => {
    if (object instanceof InstancedMesh) meshes.set(object.name, object);
  });
  return meshes;
}

/** The world-grid square a cluster key ends in, and the batch key it is one cluster of. */
function squareOf(name: string): { readonly key: string; readonly x: number; readonly z: number } {
  const at = name.lastIndexOf("@");
  expect(at, `${name} is not a cluster key`).toBeGreaterThan(0);
  const [x, z] = name
    .slice(at + 1)
    .split(",")
    .map(Number) as [number, number];
  return { key: name.slice(0, at), x, z };
}

function originsOf(mesh: InstancedMesh): Vector3[] {
  const array = mesh.instanceMatrix.array as Float32Array;
  const out: Vector3[] = [];
  for (let index = 0; index < mesh.count; index += 1)
    out.push(
      new Vector3(
        array[index * 16 + 12] as number,
        array[index * 16 + 13] as number,
        array[index * 16 + 14] as number,
      ),
    );
  return out;
}

/**
 * The level camera a 48 m shadow window is: an orthographic box looking down the light from above,
 * tested the way three tests one — `projectionMatrix * matrixWorldInverse` against a `Frustum`, then
 * the mesh's own world bounding sphere.
 */
function levelWindowOver(
  centre: Vector3,
  extent: number,
): { readonly frustum: Frustum; readonly camera: OrthographicCamera } {
  const camera = new OrthographicCamera(-extent, extent, extent, -extent, 1, 400);
  camera.position.set(centre.x, centre.y + 200, centre.z);
  camera.lookAt(centre.x, centre.y, centre.z);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return {
    camera,
    frustum: new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    ),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WorldCells clustered shared batches", () => {
  it("holds one mesh per (key, cluster), each bounded by exactly its own live records", async () => {
    const { world } = await makeWorld();
    new Group().add(world);
    await settle(world);
    const drawn = [...clusters(world)].filter(([, mesh]) => mesh.count > 0);
    expect(drawn.length, "no batch mesh survived the residency pass").toBeGreaterThan(0);

    // One mesh per (key, square). A name without a square is still one-per-key, which is the whole
    // failure: that one mesh's bounds are the union of the ring, so no camera can cull any of it.
    const squares = new Map<string, Set<string>>();
    for (const [name] of drawn) {
      const { key, x, z } = squareOf(name);
      expect(Number.isFinite(x) && Number.isFinite(z), `${name} has no square`).toBe(true);
      const own = squares.get(key) ?? new Set<string>();
      own.add(`${String(x)},${String(z)}`);
      squares.set(key, own);
    }
    expect(
      [...squares.values()].filter((own) => own.size > 1).length,
      "no key was split into more than one cluster, so nothing was clustered",
    ).toBeGreaterThan(0);

    // A cluster's bounds hold its own live records, on every axis, and the sphere covers the box:
    // three tests the sphere, and a cluster it culls is a cluster no camera submits.
    for (const [name, mesh] of drawn) {
      const box = mesh.boundingBox as Box3;
      const sphere = mesh.boundingSphere as { containsPoint: (v: Vector3) => boolean };
      expect(mesh.frustumCulled, `${name} is not cullable`).toBe(true);
      expect(box.isEmpty(), `${name} has empty bounds`).toBe(false);
      expect(box.max.x - box.min.x, `${name} fell back to the package extent`).toBeLessThan(
        manifest.extent.sizeX,
      );
      for (const point of originsOf(mesh)) {
        expect(
          box.containsPoint(point),
          `${name} does not hold its record at ${point.x.toFixed(1)},${point.z.toFixed(1)}`,
        ).toBe(true);
        expect(
          sphere.containsPoint(point),
          `${name}'s sphere does not hold its record at ${point.x.toFixed(1)},${point.z.toFixed(1)}`,
        ).toBe(true);
      }
    }

    // Exactly: no cluster holds a record from another square of the grid, and no two clusters share
    // one box. A record sits in the cell its placement was baked into, and a mesh is the square that
    // cell is in, so the record's cell and the mesh's square must be the same cell.
    for (const [name, mesh] of drawn) {
      const { x, z } = squareOf(name);
      for (const point of originsOf(mesh)) {
        const cellX = Math.floor((point.x - MIN_X) / CELL_SIZE);
        const cellZ = Math.floor((point.z - MIN_Z) / CELL_SIZE);
        expect(
          cellX === x && cellZ === z,
          `${name} holds a record from cell ${String(cellX)},${String(cellZ)} at ${point.x.toFixed(1)},${point.z.toFixed(1)}`,
        ).toBe(true);
      }
    }
    const boxes = drawn.map(([name, mesh]) => `${name}:${JSON.stringify(mesh.boundingBox)}`);
    expect(new Set(boxes).size, "two clusters share one bounds box").toBe(boxes.length);
    world.dispose();
  });

  it("submits only the clusters a level's window covers, and casts them with no companion", async () => {
    const { world } = await makeWorld();
    new Group().add(world);
    await settle(world);
    const drawn = [...clusters(world)].filter(([, mesh]) => mesh.count > 0);

    // The clusters are the casters, so nothing sits on the shadow-only layer and no `:caster` mesh
    // survives: the companions are gone, not merely unused.
    const companions = [...clusters(world)].filter(([name]) => name.includes(":caster"));
    expect(companions, "the castDistance companions are still there").toEqual([]);
    // `castLevels` decides, per level, exactly as it did before: the finest level's clusters cast
    // and a far LOD's do not, because a far level's shadow is sub-texel in any open-world window.
    for (const [name, mesh] of drawn) {
      const level = Number(squareOf(name).key.split(":")[1]);
      expect(mesh.castShadow, `${name} (level ${String(level)}) cast the wrong way`).toBe(
        level === 0,
      );
    }

    // Every cluster's own 48 m window. On one mesh per key each window selected every batch in the
    // world, because each of those batches was drawn with the ring's bounds.
    const perWindow = drawn.map(([name, mesh]) => {
      const sphere = mesh.boundingSphere as { center: Vector3 };
      const { frustum } = levelWindowOver(sphere.center, LEVEL_WINDOW / 2);
      return [
        name,
        drawn.filter(([, other]) => {
          const sphere = other.boundingSphere;
          return sphere !== null && frustum.intersectsSphere(sphere);
        }),
      ];
    });
    for (const [name, selected] of perWindow) {
      expect(
        (selected as [string, InstancedMesh][]).length,
        `${name} selected nothing`,
      ).toBeGreaterThan(0);
      expect(
        (selected as [string, InstancedMesh][]).length,
        `a ${String(LEVEL_WINDOW)} m window over ${String(name)} submitted ${String((selected as unknown[]).length)} of ${String(drawn.length)} cluster meshes`,
      ).toBeLessThan(drawn.length);
    }
    // The worst window on the fixture, which is the number AC-1 bounds.
    const worst = Math.max(...perWindow.map(([, selected]) => (selected as unknown[]).length));
    expect(worst, "a level window still submits the whole ring").toBeLessThanOrEqual(150);
    world.dispose();
  });

  it("hands a cluster the same mesh when it streams out and back, with no second mint", async () => {
    const { follow, world } = await makeWorld();
    new Group().add(world);
    await settle(world);
    const home = clusters(world);
    expect(home.size).toBeGreaterThan(0);
    const uuids = new Map([...home].map(([name, mesh]) => [name, mesh.uuid]));
    // Cluster keys minted in total. A cluster that comes back under a new uuid is a node three
    // builds again, in a shadow pass, on the frame the walk first needs its shadow.
    const minted = new Set(uuids.values());

    // Far enough that the ring empties and every cluster is released into the retained set.
    follow.position.x += CELL_SIZE * 12;
    await settle(world);
    for (let frame = 0; frame < 30; frame += 1) {
      world.update();
      await flush(1);
    }
    expect(clusters(world).size, "the ring never emptied").toBe(0);

    // Home again. The retained mesh is the one the cell draws into: the prewarm must not mint a
    // second batch for a key the retained set is holding, and `#sharedFor` rebinds that one.
    follow.position.x -= CELL_SIZE * 12;
    await settle(world);
    for (let frame = 0; frame < 30; frame += 1) {
      world.update();
      await flush(1);
    }
    const back = clusters(world);
    expect(back.size).toBeGreaterThan(0);
    const reminted = [...back]
      .filter(([name, mesh]) => {
        const was = uuids.get(name);
        if (was === undefined) return false;
        minted.add(mesh.uuid);
        return was !== mesh.uuid;
      })
      .map(([name]) => name);
    expect(reminted, "a cluster was given a second mesh across a residency cycle").toEqual([]);
    // No re-mints at all, not none among the keys that came back: a cluster the walk never left
    // keeps the uuid it had too.
    for (const [name, mesh] of home) {
      const again = back.get(name);
      if (again === undefined) continue;
      expect(again.uuid, `${name} was re-minted`).toBe(mesh.uuid);
      minted.add(again.uuid);
    }
    expect(minted.size, "a fresh uuid appeared across the cycle").toBe(home.size);
    world.dispose();
  });

  it("takes the cluster grid from clusterSize, and validates it", async () => {
    const { world } = await makeWorld({ clusterSize: CELL_SIZE * 2 });
    new Group().add(world);
    await settle(world);
    const drawn = [...clusters(world)].filter(([, mesh]) => mesh.count > 0);
    // Two cells to a side, so the ring's cells land on four squares and each square's mesh carries
    // both cells' records — a cluster's box is wider than one cell and still not the whole ring.
    const boxes = new Set(
      drawn.map(([, mesh]) => JSON.stringify((mesh.boundingBox as Box3).min.toArray())),
    );
    expect(boxes.size, "a two-cell cluster grid produced one cluster").toBeGreaterThan(1);
    for (const [name, mesh] of drawn) {
      const box = mesh.boundingBox as Box3;
      expect(
        Math.max(box.max.x - box.min.x, box.max.z - box.min.z),
        `${name} is wider than the two-cell square it was clustered into`,
      ).toBeLessThan(CELL_SIZE * 2 + 1);
    }
    world.dispose();
    await expect(makeWorld({ clusterSize: 0 })).rejects.toThrow(/clusterSize/u);
  });
});
