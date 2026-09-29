import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
} from "three";
import { BundleGroup } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IRendererLike } from "../src/renderer.js";
import { type IWorldPackage, WorldCells } from "../src/world.js";

/**
 * The main pass's draw bundles: every GPU-dressed batch mesh parented under one `BundleGroup`, and
 * that group re-recorded only when the set of things it draws changes.
 *
 * The claim is a count. Three fixes a bundle's render list when it records it and replays the
 * encoded draws until `bundleGroup.version` moves, so a walk that re-records every frame is a walk
 * that paid the whole per-draw cost twice, and a walk that re-records only on a key arriving or
 * leaving is the one this is for. The renderer here is a stub that never executes a bundle, so what
 * is under test is the parenting, the visibility and the version bookkeeping — not a draw.
 */

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "world-v1");
const manifest = JSON.parse(
  readFileSync(path.join(fixture, "world.json"), "utf8"),
) as IWorldPackage;
const placementBytes = readFileSync(path.join(fixture, "placements.bin"));
const surface = new MeshBasicMaterial();
const budgets = { bytes: 1_000_000_000, instances: 1_000_000, residentCells: 64 };
/** The fixture's `cellSize`; a square is one cell unless the test says otherwise. */
const CELL = 64;

/** The world-space centre of cell `(x, z)`, from the package's own extent and cell size. */
function cellCentre(x: number, z: number): { x: number; z: number } {
  return { x: manifest.extent.minX + (x + 0.5) * CELL, z: manifest.extent.minZ + (z + 0.5) * CELL };
}

function plainModel(): Group {
  const group = new Group();
  group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
  return group;
}

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

/**
 * The package with `pine`'s authored `lods` removed, so one level and one part is the whole cast.
 *
 * `rockInWest` also drops `rock` from every cell but the westernmost column. Every asset is in every
 * cell of the committed package, so no key's refcount ever reaches zero and a walk over this fixture
 * can never retire one — which is the one event the version is supposed to answer. A world where an
 * asset belongs to part of the map is the ordinary case, and it is what makes a key come and go. One
 * column is what it takes: the ring is three cells wide, so a key has to be out of all three before
 * its refcount reaches zero.
 */
function stubManifestFetch(rockInWest = false): void {
  const pine = manifest.assets.pine;
  if (pine === undefined) throw new Error("the committed package has no pine asset.");
  const pkg: IWorldPackage = {
    ...manifest,
    assets: { ...manifest.assets, pine: { bounds: pine.bounds, glb: pine.glb } },
    cells: rockInWest
      ? manifest.cells.map((cell) =>
          cell.x < 1 ? cell : { ...cell, runs: cell.runs.filter((run) => run.asset !== "rock") },
        )
      : manifest.cells,
  };
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
      if (url.endsWith("placements.bin")) return fileResponse(placementBytes);
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

/** A player camera in the middle of cell (0,1) at head height, looking west. */
function playerCamera(at: readonly [number, number] = [0, 1]): PerspectiveCamera {
  const centre = cellCentre(at[0], at[1]);
  const camera = new PerspectiveCamera(30, 1, 0.1, 1000);
  camera.position.set(centre.x, 4, centre.z);
  camera.lookAt(centre.x - CELL * 4, 4, centre.z);
  camera.updateMatrixWorld();
  return camera;
}

/** Every `InstancedMesh` under the world, wherever it hangs — including inside a bundle group. */
function worldMeshes(world: WorldCells): InstancedMesh[] {
  const found: InstancedMesh[] = [];
  world.traverse((object: Object3D) => {
    if (object instanceof InstancedMesh) found.push(object);
  });
  return found;
}

/** The main pass's own meshes. A caster half carries an `@` in its key, and the main half does not. */
function mainKeys(world: WorldCells): InstancedMesh[] {
  return worldMeshes(world).filter((one) => one.name !== "" && !one.name.includes("@"));
}

/**
 * Count the writes each mesh's `visible` takes, keyed by name, and leave the flag frozen at whatever
 * it was. Returns the live counts, so a walk's writes are read with `writes.get(name)`.
 */
function watchVisible(meshes: readonly InstancedMesh[]): Map<string, { count: number }> {
  const writes = new Map<string, { count: number }>();
  for (const mesh of meshes) {
    const held = { count: 0 };
    const current = mesh.visible;
    Object.defineProperty(mesh, "visible", {
      configurable: true,
      get: (): boolean => current,
      set: (): void => {
        held.count += 1;
      },
    });
    writes.set(mesh.name, held);
  }
  return writes;
}

/** The world's one `BundleGroup`, or `undefined` when it has not dressed a mesh into one. */
function bundleGroup(world: WorldCells): BundleGroup | undefined {
  let found: BundleGroup | undefined;
  world.traverse((object: Object3D) => {
    if (object instanceof BundleGroup) found = object;
  });
  return found;
}

/** A WebGPU renderer with no GPU behind it: the world's dispatch and markers run, no draw does. */
function gpuRendererStub(): IRendererLike {
  return {
    compute: (): void => {},
    kind: "webgpu",
    readback: async (args: { array: Uint32Array }): Promise<ArrayBuffer> =>
      args.array.slice().buffer as ArrayBuffer,
    raw: { backend: { hasFeature: (): boolean => true } },
  } as unknown as IRendererLike;
}

async function flush(rounds = 12): Promise<void> {
  for (let round = 0; round < rounds; round += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Let the loads settle, then step again: a build waiting on the frame's mesh allowance is deferred.
 *
 * The camera comes with the renderer, because a world with no camera never runs `#cullMainPass` and so
 * never dresses a key or builds a bundle — everything these tests look at has to exist before the
 * walk under test starts.
 */
async function flushed(
  world: WorldCells,
  renderer: IRendererLike,
  camera: PerspectiveCamera,
): Promise<void> {
  for (let pass = 0; pass < 200; pass += 1) {
    await flush();
    world.update(renderer, camera);
    const stats = world.stats();
    if (
      stats.admission.backlog === 0 &&
      stats.admission.deferred === 0 &&
      stats.loadsInFlight === 0
    )
      return;
  }
}

/** A world on the committed package, walked the way the GPU-scene spec walks it. */
async function world(
  options: { readonly bundles?: boolean; readonly rockInWest?: boolean } = {},
): Promise<{
  follow: { position: { x: number; z: number; y: number } };
  renderer: IRendererLike;
  world: WorldCells;
}> {
  stubManifestFetch(options.rockInWest === true);
  const follow = { position: { ...cellCentre(0, 1), y: 0 } as { x: number; z: number; y: number } };
  const cells = await WorldCells.load({
    admissionBudgetMs: Number.POSITIVE_INFINITY,
    budgets,
    follow,
    loadModel: async () => plainModel(),
    prefetchSeconds: 0,
    ring: 1,
    shadows: { cast: true, receive: true },
    surface,
    url: "/world/world.json",
    ...options,
  });
  return { follow, renderer: gpuRendererStub(), world: cells };
}

/**
 * Turn the camera with the follow point parked, which is the one walk that changes no residency and
 * so re-dresses nothing: every write these tests count is the frame's own answer, not a key arriving.
 */
function turn(
  cells: WorldCells,
  renderer: IRendererLike,
  frames: number,
  at: readonly [number, number],
): void {
  for (let index = 0; index < frames; index += 1) {
    const centre = cellCentre(at[0], at[1]);
    const camera = playerCamera(at);
    camera.lookAt(centre.x + Math.sin(index / 9) * CELL * 4, 4, centre.z - CELL * 4);
    camera.updateMatrixWorld();
    cells.update(renderer, camera);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the main pass's draw bundles", () => {
  it("parents every GPU-dressed main mesh under one group and never re-records a settled frame", async () => {
    const { renderer, world: cells } = await world();
    cells.update(renderer, playerCamera());
    await flushed(cells, renderer, playerCamera());

    const group = bundleGroup(cells);
    expect(group).toBeDefined();
    const dressed = mainKeys(cells);
    expect(dressed.length).toBeGreaterThan(0);
    // One group, and every dressed main mesh in it — the whole point of the thing, since a mesh left
    // outside is a mesh whose per-object path still runs every frame.
    for (const mesh of dressed) expect(mesh.parent).toBe(group);
    expect(group?.children.length).toBe(dressed.length);
    // The casters are not in it: a bundle is recorded per pass, and the shadow levels are not this
    // group. A caster parented here would be drawn by the main pass too.
    const casters = worldMeshes(cells).filter((one) => one.name.includes("@"));
    expect(casters.length).toBeGreaterThan(0);
    for (const mesh of casters) expect(mesh.parent).not.toBe(group);

    const settled = cells.stats().bundle;
    expect(settled.on).toBe(true);
    // A camera at rest: 200 frames that mint nothing, retire nothing and re-dress nothing.
    for (let index = 0; index < 200; index += 1) cells.update(renderer, playerCamera());
    const after = cells.stats().bundle;
    expect(after.records).toBe(settled.records);
    expect(after.children).toBe(settled.children);
    cells.dispose();
  });

  it("re-records a streaming walk only where a key is minted or retired", async () => {
    // The follow point walks two cells east and back, which carries `rock`'s keys out of the ring and
    // into it while the ring itself stays full. Five crossings is what the counter is allowed to move
    // for; 200 frames at one record a frame is what it must not do.
    const { follow, renderer, world: cells } = await world({ rockInWest: true });
    cells.update(renderer, playerCamera([0, 1]));
    await flushed(cells, renderer, playerCamera([0, 1]));
    const dressed = mainKeys(cells).length;
    expect(dressed).toBeGreaterThan(0);
    const before = cells.stats().bundle.records;
    // The same names the last census held, so a mint is a name arriving and a retire a name leaving.
    const seen = new Set(mainKeys(cells).map((mesh) => mesh.name));
    let structural = 0;
    const census = (): void => {
      const names = new Set(mainKeys(cells).map((mesh) => mesh.name));
      for (const name of names) if (!seen.has(name)) structural += 1;
      for (const name of seen) if (!names.has(name)) structural += 1;
      seen.clear();
      for (const name of names) seen.add(name);
    };
    for (let phase = 0; phase < 5; phase += 1) {
      const at = cellCentre(phase % 2 === 0 ? 3 : 1, 1);
      follow.position.x = at.x;
      follow.position.z = at.z;
      cells.update(renderer, playerCamera([0, 1]));
      await census();
      await flushed(cells, renderer, playerCamera([0, 1]));
      for (let index = 0; index < 40; index += 1) cells.update(renderer, playerCamera([0, 1]));
      await census();
    }
    const after = cells.stats().bundle.records - before;
    // The walk really did stream, so this is not the settled case proving itself twice.
    expect(structural).toBeGreaterThan(0);
    // Every key that came and went cost at least its own re-record, and none of the 200 frames cost
    // one of its own: a walk that re-recorded per frame would be `200 * dressed`, not `structural`.
    expect(after).toBeGreaterThanOrEqual(structural);
    expect(after).toBeLessThan(200 * dressed);
    // The over-count is the ring refilling: a key handed back by the retained set starts on a region
    // sized for the cells that are resident, so each buffer regrow behind it is one more record — a
    // listed structural cause, and still a handful against 200 frames. Culling and LOD are not on the
    // list, and a settled camera records nothing at all: the case above.
    expect(cells.stats().failures).toBe(0);
    cells.dispose();
  });

  it("never writes `visible` on a bundled mesh, so a bundle is never re-recorded to hide one", async () => {
    const { renderer, world: cells } = await world({ bundles: true });
    cells.update(renderer, playerCamera());
    await flushed(cells, renderer, playerCamera());

    // Count the writes rather than reading the flag: hiding a bundled mesh and showing it again
    // leaves it visible, and that pair is what a bundle pays a whole re-record for. The coarse gate
    // in `visibleFrom` is the writer, and the prewarm settle is the one other.
    const meshes = mainKeys(cells);
    const watched = watchVisible(meshes);
    turn(cells, renderer, 200, [0, 1]);
    for (const held of watched.values()) expect(held.count).toBe(0);
    // The bundle is still whole, and still the whole of the main pass. The meshes are the ones that
    // were watched, so "never written" is about the meshes that are actually drawing.
    const group = bundleGroup(cells);
    for (const mesh of meshes) expect(mesh.parent).toBe(group);
    expect(group?.children.length).toBe(watched.size);
    expect(cells.stats().bundle.children).toBe(watched.size);
    cells.dispose();
  });

  it("is the coarse per-key visibility again with the option off", async () => {
    const { renderer, world: cells } = await world({ bundles: false });
    cells.update(renderer, playerCamera());
    await flushed(cells, renderer, playerCamera());

    // No group, and the marker and the stats say so.
    expect(bundleGroup(cells)).toBeUndefined();
    expect(cells.stats().bundle).toEqual({ children: 0, on: false, records: 0 });
    const dressed = mainKeys(cells);
    expect(dressed.length).toBeGreaterThan(0);
    for (const mesh of dressed) expect(mesh.parent).toBe(cells);

    // The one behaviour the two paths disagree about: with the option off the coarse gate runs and
    // writes `visible` on every dressed mesh every frame, and the walk costs what it always cost.
    const watched = watchVisible(dressed);
    turn(cells, renderer, 200, [0, 1]);
    for (const held of watched.values()) expect(held.count).toBeGreaterThan(0);
    for (const mesh of dressed) expect(mesh.parent).toBe(cells);
    // The GPU scene is still on either way: the option is about the draw commands, not the cull.
    expect(cells.stats().gpuScene.on).toBe(true);
    cells.dispose();
  });
});
