import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BoxGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, type Object3D } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isStatic,
  refreshStaticTransforms,
  resetStaticTransforms,
} from "../src/static-transform.js";
import { type IWorldPackage, WorldCells } from "../src/world.js";

/**
 * The world's own meshes are static, and a static batch still uploads.
 *
 * Three skips a settled object's per-draw attribute scan, and the instance buffer of an
 * `InstancedMesh` is a vertex attribute of that draw — so a batch marked static without its writes
 * announcing them draws the instances it settled at, and the world quietly stops streaming. The
 * first two tests are the win: every batch, caster and chunk is frozen, which is what deletes the
 * per-object draw work. The third is the price, in the only form that can be checked here: a write
 * takes its mesh out of the settled path for the frame that has to draw it, and the next refresh
 * re-arms it.
 */

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "world-v1");
const manifest = JSON.parse(
  readFileSync(path.join(fixture, "world.json"), "utf8"),
) as IWorldPackage;
const CELL_SIZE = manifest.cellSize;
const MIN_X = manifest.extent.minX;
const MIN_Z = manifest.extent.minZ;
const surface = new MeshBasicMaterial();
const budgets = { bytes: 1_000_000_000, instances: 1_000_000, residentCells: 64 };

function fileResponse(buffer: Buffer): object {
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
    vi.fn(async (input: unknown): Promise<object> => {
      const url = String(input);
      if (url.endsWith("world.json"))
        return fileResponse(readFileSync(path.join(fixture, "world.json")));
      if (url.endsWith("placements.bin"))
        return fileResponse(readFileSync(path.join(fixture, "placements.bin")));
      if (url.endsWith("heightmap.u16"))
        return fileResponse(readFileSync(path.join(fixture, "terrain", "heightmap.u16")));
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

/** A chunk GLB: a placed group, the one subtree here with no records to announce. */
function model(): Object3D {
  const group = new Group();
  group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
  return group;
}

async function settle(world: WorldCells): Promise<void> {
  let stable = 0;
  let owed = Number.POSITIVE_INFINITY;
  for (let frame = 0; frame < 900; frame += 1) {
    world.update();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const done = world.stats().admission.backlog;
    if (done === 0 && world.stats().loadsInFlight === 0) {
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

interface ILoaded {
  readonly world: WorldCells;
  /** The live follow object the world holds, so a test can stream without reloading. */
  readonly follow: { position: { x: number; z: number } };
}

async function loadedWorld(): Promise<ILoaded> {
  stubFixtureFetch();
  const follow = {
    position: {
      x: MIN_X + 1.5 * CELL_SIZE,
      z: MIN_Z + 1.5 * CELL_SIZE,
    },
  };
  const world = await WorldCells.load({
    admissionBudgetMs: Number.POSITIVE_INFINITY,
    freshMeshesPerUpdate: Number.MAX_SAFE_INTEGER,
    budgets,
    follow: {
      position: {
        x: manifest.extent.minX + 1.5 * manifest.cellSize,
        z: manifest.extent.minZ + 1.5 * manifest.cellSize,
      },
    },
    loadModel: async () => model(),
    ring: 1,
    shadows: { cast: true },
    surface,
    url: "/world/world.json",
  });
  await settle(world);
  return { follow, world };
}

function batches(world: WorldCells, match: (name: string) => boolean): InstancedMesh[] {
  const found: InstancedMesh[] = [];
  world.traverse((object) => {
    if (object instanceof InstancedMesh && match(object.name)) found.push(object);
  });
  return found;
}

afterEach(() => {
  resetStaticTransforms();
  vi.unstubAllGlobals();
});

describe("WorldCells static meshes", () => {
  it("freezes every main batch, caster cluster and key-wide caster after admission", async () => {
    const { world } = await loadedWorld();
    // The render phase's refresh is what re-arms the meshes admission wrote, and it runs every
    // frame, so this is the state a world between writes is actually in.
    refreshStaticTransforms();
    const main = batches(world, (name) => !name.includes("@"));
    const clusters = batches(world, (name) => /^[^@]+@-?\d+,-?\d+$/u.test(name));
    const wide = batches(world, (name) => name.endsWith("@*"));
    expect(main.length).toBeGreaterThan(0);
    expect(clusters.length).toBeGreaterThan(0);
    expect(wide.length).toBeGreaterThan(0);
    for (const mesh of [...main, ...clusters, ...wide]) {
      expect(isStatic(mesh), `${mesh.name} is not a frozen root`).toBe(true);
      // Three's own flag is the one its settled path reads, and the saving it buys.
      expect((mesh as InstancedMesh & { static?: boolean }).static, mesh.name).toBe(true);
      expect(mesh.matrixAutoUpdate, mesh.name).toBe(false);
      expect(mesh.matrixWorldAutoUpdate, mesh.name).toBe(false);
    }
  });

  it("freezes a loaded chunk", async () => {
    const { world } = await loadedWorld();
    const chunks: Object3D[] = [];
    world.traverse((object) => {
      if (object.name === "world-chunk") chunks.push(object);
    });
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) expect(isStatic(chunk), chunk.name).toBe(true);
  });

  it("takes a written batch out of the settled path and re-arms it on the next refresh", async () => {
    // No refresh yet: the last thing that happened to these meshes is the admission that filled
    // their records, which is the frame that has to draw them.
    const { world } = await loadedWorld();
    const main = batches(world, (name) => !name.includes("@"));
    expect(main.length).toBeGreaterThan(0);
    const written = main.filter(
      (mesh) => mesh.instanceMatrix.version > 0 && isStatic(mesh) === false,
    );
    expect(
      written.length,
      "a batch whose records were just written stayed settled, so its upload would be skipped",
    ).toBeGreaterThan(0);
    for (const mesh of written)
      expect((mesh as InstancedMesh & { static?: boolean }).static, mesh.name).toBe(false);

    // The render phase's refresh runs once a frame, before the walk, which is where a world between
    // writes re-arms: the upload has been consumed, and the next write takes it out again.
    refreshStaticTransforms();
    for (const mesh of main) expect(isStatic(mesh), `${mesh.name} did not re-arm`).toBe(true);
  });
});
