import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BoxGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, type Object3D } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IWorldPackage } from "../src/world.js";
import { WorldCells } from "../src/world.js";

interface IResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: Headers;
  arrayBuffer: () => Promise<ArrayBuffer>;
  json: () => Promise<unknown>;
}

/**
 * PRD-458: hybrid caster granularity per shadow level. A level whose window is a fraction of the
 * resident ring culls the caster clusters down to the squares it covers; a level whose window holds
 * most of the ring submits one key-wide mesh for the key instead of one mesh per square, which for a
 * 640 m window over a 5 x 5 ring of 128 m cells is every square in the ring.
 *
 * The world writes both halves of every key — `key@x,z` on `VIRTUAL_SHADOW_CASTER_LAYER` and
 * `key@*` on `VIRTUAL_SHADOW_WIDE_CASTER_LAYER` — because a level picks its granularity, and the
 * half it did not pick must cost it nothing. What is asserted here is that culling by each level's
 * own window, over the layer that level renders, submits at most one draw per key-part on a wide
 * level and only the intersecting clusters on a fine one.
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

const CLUSTER_LAYER = 1 << 28;
const WIDE_LAYER = 1 << 27;

function fileResponse(body: Buffer): IResponseLike {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    arrayBuffer: async () =>
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    json: async () => JSON.parse(body.toString("utf8")),
  };
}

function model(): Object3D {
  const group = new Group();
  for (let part = 0; part < 2; part += 1)
    group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
  return group;
}

function cellCenter(x: number, z: number): { x: number; z: number } {
  return { x: MIN_X + (x + 0.5) * CELL_SIZE, z: MIN_Z + (z + 0.5) * CELL_SIZE };
}

/** A three-by-three grid of cells, each with `perCell` placements of one asset. */
function denseRing(perCell: number): { manifest: IWorldPackage; placements: Buffer } {
  const floats: number[] = [];
  const cells: {
    runs: { asset: string; count: number; offset: number }[];
    x: number;
    z: number;
  }[] = [];
  for (let x = 0; x < 3; x += 1)
    for (let z = 0; z < 3; z += 1) {
      const offset = floats.length / 8;
      for (let at = 0; at < perCell; at += 1)
        floats.push(
          MIN_X + (x + (at % 8) / 8) * CELL_SIZE,
          0,
          MIN_Z + (z + Math.floor(at / 8) / 8) * CELL_SIZE,
          0,
          0,
          0,
          1,
          1,
        );
      cells.push({ runs: [{ asset: "pine", count: perCell, offset }], x, z });
    }
  return {
    manifest: { ...manifest, cells } as IWorldPackage,
    placements: Buffer.from(new Float32Array(floats).buffer),
  };
}

function stubFetch(perCell: number): void {
  const { manifest: dense, placements } = denseRing(perCell);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown): Promise<IResponseLike> => {
      const url = String(input);
      if (url.endsWith("world.json")) return fileResponse(Buffer.from(JSON.stringify(dense)));
      if (url.endsWith("placements.bin")) return fileResponse(placements);
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

async function makeWorld(perCell = 24): Promise<WorldCells> {
  stubFetch(perCell);
  const follow = { position: cellCenter(1, 1) };
  return WorldCells.load({
    admissionBudgetMs: Number.POSITIVE_INFINITY,
    budgets,
    follow,
    loadModel: async () => model(),
    ring: 1,
    shadows: { cast: true },
    surface,
    url: "/world/world.json",
  });
}

async function settle(world: WorldCells, limit = 900): Promise<void> {
  let stable = 0;
  let owed = Number.POSITIVE_INFINITY;
  for (let frame = 0; frame < limit; frame += 1) {
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

/** Every batch mesh on one caster layer, keyed by the key it is a caster of. */
function castersOn(world: WorldCells, mask: number): Map<string, InstancedMesh> {
  const out = new Map<string, InstancedMesh>();
  world.traverse((object) => {
    if (!(object instanceof InstancedMesh) || object.layers.mask !== mask) return;
    out.set(object.name, object);
  });
  return out;
}

/** The `asset:level:part` a caster mesh is a half of. */
function keyOf(name: string): string {
  return name.slice(0, name.lastIndexOf("@"));
}

/**
 * What a shadow level's window submits, over the one caster layer it renders: the meshes with live
 * records whose own world sphere the window's box holds, which is the cull three runs before drawing.
 */
function submittedIn(
  world: WorldCells,
  mask: number,
  centre: { x: number; z: number },
  extent: number,
): string[] {
  return [...castersOn(world, mask).values()]
    .filter((mesh) => {
      if (mesh.count === 0) return false;
      const sphere = mesh.boundingSphere;
      if (sphere === null) return false;
      return (
        Math.abs(sphere.center.x - centre.x) <= extent + sphere.radius &&
        Math.abs(sphere.center.z - centre.z) <= extent + sphere.radius
      );
    })
    .map((mesh) => mesh.name);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WorldCells wide shadow casters", () => {
  it("gives every casting key both halves: clusters per square, and one key-wide mesh", async () => {
    const world = await makeWorld();
    new Group().add(world);
    await settle(world);
    const clusters = [...castersOn(world, CLUSTER_LAYER).values()].filter((mesh) => mesh.count > 0);
    const wide = [...castersOn(world, WIDE_LAYER).values()].filter((mesh) => mesh.count > 0);
    expect(clusters.length, "no caster cluster was minted").toBeGreaterThan(1);
    expect(wide.length, "no key-wide caster was minted").toBeGreaterThan(0);

    // One wide mesh per key-part, on the wide layer alone, casting and never receiving, and holding
    // every cell's records: the whole ring in one draw, which is the claim.
    const wideKeys = new Set(wide.map((mesh) => keyOf(mesh.name)));
    expect(wide.length, "a key has more than one wide caster").toBe(wideKeys.size);
    const clusterKeys = new Set(clusters.map((mesh) => keyOf(mesh.name)));
    expect(
      [...clusterKeys].every((key) => wideKeys.has(key)),
      "a key has no wide half",
    ).toBe(true);
    for (const mesh of wide) {
      expect(mesh.layers.mask, `${mesh.name} is not alone on the wide caster layer`).toBe(
        WIDE_LAYER,
      );
      expect(mesh.castShadow, `${mesh.name} does not cast`).toBe(true);
      expect(mesh.receiveShadow, `${mesh.name} receives`).toBe(false);
      expect(mesh.frustumCulled, `${mesh.name} is not cullable`).toBe(true);
      // The union of the ring: a wide caster bounded by one square would cull away the rest of the
      // world from a level that holds all of it.
      expect(
        (mesh.boundingBox?.max.x ?? 0) - (mesh.boundingBox?.min.x ?? 0),
        `${mesh.name} is bounded by one square, not the ring`,
      ).toBeGreaterThan(CELL_SIZE);
    }
    // The main pass is untouched: one mesh per key, on layer 0, casting nothing.
    const main: string[] = [];
    world.traverse((object) => {
      if (object instanceof InstancedMesh && object.layers.mask === 1) main.push(object.name);
    });
    expect(new Set(main).size, "the main pass drew more than one mesh for a key").toBe(main.length);
    world.dispose();
  });

  it("submits one caster draw per key on a wide window, and only intersecting clusters on a fine one", async () => {
    const world = await makeWorld();
    new Group().add(world);
    await settle(world);
    const centre = cellCenter(1, 1);
    // A window holding the whole three-by-three ring, and one holding a single cell of it.
    const wideWindow = 2 * CELL_SIZE;
    const fineWindow = CELL_SIZE * 0.5;

    const wideLevel = submittedIn(world, WIDE_LAYER, centre, wideWindow);
    const fineLevel = submittedIn(world, CLUSTER_LAYER, centre, fineWindow);

    // The wide level: at most one draw per key-part, and it drew something.
    expect(wideLevel.length, "a wide window submitted no wide caster").toBeGreaterThan(0);
    expect(
      new Set(wideLevel.map(keyOf)).size,
      "a wide window submitted more than one caster draw for a key",
    ).toBe(wideLevel.length);

    // The fine level: only the squares its window covers, and strictly fewer draws than a wide one
    // would submit for the same world.
    expect(fineLevel.length, "a fine window submitted no cluster").toBeGreaterThan(0);
    expect(fineLevel.length, "a fine window submitted the whole ring's clusters").toBeLessThan(
      clustersAcross(world).length,
    );
    for (const name of fineLevel) {
      const [x, z] = name
        .slice(name.lastIndexOf("@") + 1)
        .split(",")
        .map(Number) as [number, number];
      const square = { x: MIN_X + x * CELL_SIZE, z: MIN_Z + z * CELL_SIZE };
      expect(
        Math.abs(square.x - centre.x) <= fineWindow + CELL_SIZE &&
          Math.abs(square.z - centre.z) <= fineWindow + CELL_SIZE,
        `a fine window submitted the non-intersecting cluster ${name}`,
      ).toBe(true);
    }
    world.dispose();
  });
});

/** Every live caster cluster, one per `(key, square)`. */
function clustersAcross(world: WorldCells): InstancedMesh[] {
  return [...castersOn(world, CLUSTER_LAYER).values()].filter((mesh) => mesh.count > 0);
}
