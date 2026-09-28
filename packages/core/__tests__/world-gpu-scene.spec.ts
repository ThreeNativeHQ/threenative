import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BoxGeometry,
  type BufferGeometry,
  Frustum,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IRendererLike } from "../src/renderer.js";
import {
  type IGpuPlacement,
  type IKernelInput,
  type IRegion,
  WorldGpuScene,
  cullAndSelect,
  gpuSceneUnsupported,
  storageElementBytes,
  validationReport,
} from "../src/world-gpu-scene.js";
import { type IWorldPackage, WorldCells } from "../src/world.js";

/**
 * The GPU scene's per-instance kernel, proved against the CPU path it replaces.
 *
 * The reference is `cullAndSelect` — plain TypeScript, no GPU, the exact branch order the TSL
 * kernel mirrors — so this is where AC-1's "the drawn instance set equals the CPU reference path's
 * set, frame by frame" and AC-6's "regions never overflow" are proved at all. The kernel itself is
 * compiled in a browser and is not what these tests can see.
 */

/** A camera whose frustum every placement in the fixture is inside, so cull is not what is tested. */
function cameraAt(x: number, z: number): { camera: PerspectiveCamera; planes: Float32Array } {
  const camera = new PerspectiveCamera(60, 1, 0.1, 10_000);
  camera.position.set(x, 0, z);
  camera.lookAt(x, 0, z + 1);
  camera.updateMatrixWorld(true);
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  const planes = new Float32Array(24);
  for (const [index, plane] of frustum.planes.entries()) {
    const at = index * 4;
    planes[at] = plane.normal.x;
    planes[at + 1] = plane.normal.y;
    planes[at + 2] = plane.normal.z;
    planes[at + 3] = plane.constant;
  }
  return { camera, planes };
}

/** One placement at `(x, z)`, at the given distance from the origin along +Z. */
function placement(x: number, y: number, z: number, slot: number, radius = 0.5): IGpuPlacement {
  const matrix = new Matrix4().makeTranslation(x, y, z);
  return {
    centre: new Float32Array([x, y, z, radius]),
    matrix: new Float32Array(matrix.elements),
    slot,
  };
}

/**
 * The CPU path's own selection, written out from `world-cells.ts`: `levelAt` is the ascending
 * `distance > gate` test and `cullDistance` is `maxDistance` less its eighth. A key's drawn set is
 * the placements that reach it.
 */
function cpuReference(
  placements: readonly IGpuPlacement[],
  origin: { x: number; z: number; planes: Float32Array },
  slot: number,
  distances: readonly number[],
  cull: number | undefined,
  firstKey: number,
  parts: number,
): Map<number, number[]> {
  const drawn = new Map<number, number[]>();
  // One entry per level's part, exactly as the GPU scene's key table holds them.
  for (let key = firstKey; key < firstKey + parts * distances.length; key += 1) drawn.set(key, []);
  const planes = origin.planes;
  for (const [index, one] of placements.entries()) {
    // `#addPlacements` runs per asset: a key's drawn set is its own asset's placements only, so
    // another slot's placement reaching the same level is not in this key's set.
    if (one.slot !== slot) continue;
    const at = one.centre;
    // The coarse CPU cull and the GPU's per-placement sphere test are the same six planes: what is
    // compared here is the level selection and the per-key set, on the placements both keep.
    let inside = true;
    for (let plane = 0; plane < 6; plane += 1) {
      const base = plane * 4;
      const signed =
        (planes[base] as number) * (at[0] as number) +
        (planes[base + 1] as number) * (at[1] as number) +
        (planes[base + 2] as number) * (at[2] as number) +
        (planes[base + 3] as number);
      if (signed < -(at[3] as number)) {
        inside = false;
        break;
      }
    }
    if (inside === false) continue;
    const distance = Math.hypot((at[0] as number) - origin.x, (at[2] as number) - origin.z);
    if (cull !== undefined && distance > cull) continue;
    let level = 0;
    for (let gate = 1; gate < distances.length; gate += 1)
      if (distance > (distances[gate] as number)) level = gate;
    const key = firstKey + level * parts;
    drawn.get(key)?.push(index);
  }
  return drawn;
}

/** The reference kernel's drawn placement indexes per key, read back out of its `drawn` buffer. */
function kernelDrawn(
  result: ReturnType<typeof cullAndSelect>,
  input: IKernelInput,
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (let key = 0; key < input.regions.length; key += 1) out.set(key, []);
  // The regions are disjoint, so a drawn matrix names exactly one placement: the one whose world
  // translation it carries. `local` is the identity throughout this fixture, so the drawn matrix is
  // the placement matrix and the lookup is the translation, not a full compare.
  for (const [key, region] of input.regions.entries()) {
    const count = result.counts[key] as number;
    for (let taken = 0; taken < count; taken += 1) {
      const at = (region.start + taken) * 16;
      const x = result.drawn[at + 12] as number;
      const z = result.drawn[at + 14] as number;
      const found = input.placements.findIndex(
        (one, index) =>
          one.slot >= 0 &&
          Math.abs((one.matrix[12] as number) - x) < 1e-5 &&
          Math.abs((one.matrix[14] as number) - z) < 1e-5,
      );
      if (found < 0) throw new Error(`region ${String(key)} drew a matrix no placement owns.`);
      out.get(key)?.push(found);
    }
  }
  return out;
}

const DISTANCES = [0, 40, 120] as const;
const LOCAL = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/**
 * The committed `world-v1` package, which is what the wiring half below streams: one `pine` asset
 * with a run per cell, so a walk over its ring admits, refills and evicts real records. The harness
 * is the main-cull spec's, unchanged — the same package, the same camera, the same flush — so a
 * number here and a number there are about the same world.
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

/** Every `pine` placement each cell files, so a cell's own records are a number. */
const PINE = new Map<string, number>();
for (const cell of manifest.cells)
  for (const run of cell.runs)
    if (run.asset === "pine") PINE.set(`${String(cell.x)},${String(cell.z)}`, run.count);

function pineIn(...cells: string[]): number {
  return cells.reduce((sum, cell) => sum + (PINE.get(cell) ?? 0), 0);
}

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
 * The package with `pine`'s authored `lods` removed, so every one of its placements is drawn at level
 * 0 and a cell's worth of a key is exactly the count its run states.
 */
function stubManifestFetch(): void {
  const pine = manifest.assets.pine;
  if (pine === undefined) throw new Error("the committed package has no pine asset.");
  const pkg: IWorldPackage = {
    ...manifest,
    assets: { ...manifest.assets, pine: { bounds: pine.bounds, glb: pine.glb } },
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

/**
 * A player camera in the middle of cell (0,1) at head height, looking west: the main-cull spec's
 * camera, so the visible visibility cells are the ones the coarse gate below is judged against.
 */
function playerCamera(at: readonly [number, number] = [0, 1]): PerspectiveCamera {
  const centre = cellCentre(at[0], at[1]);
  const camera = new PerspectiveCamera(30, 1, 0.1, 1000);
  camera.position.set(centre.x, 4, centre.z);
  camera.lookAt(centre.x - CELL * 4, 4, centre.z);
  camera.updateMatrixWorld();
  return camera;
}

/** Every `WorldCells`-owned `InstancedMesh` under the world, whatever role or key it serves. */
function worldMeshes(world: WorldCells): InstancedMesh[] {
  const found: InstancedMesh[] = [];
  world.traverse((object: Object3D) => {
    if (object instanceof InstancedMesh) found.push(object);
  });
  return found;
}

/** The `pine` level-0 main mesh: one per key, the one every camera here draws. */
function mainMesh(world: WorldCells): InstancedMesh {
  const mesh = worldMeshes(world).find((one) => one.name === "pine:0:0");
  if (mesh === undefined) throw new Error("the world has no pine:0:0 mesh.");
  return mesh;
}

async function flush(rounds = 12): Promise<void> {
  for (let round = 0; round < rounds; round += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Let the loads settle, then step again: a build waiting on the frame's mesh allowance is deferred. */
async function flushed(world: WorldCells): Promise<void> {
  for (let pass = 0; pass < 200; pass += 1) {
    await flush();
    world.update();
    const stats = world.stats();
    if (
      stats.admission.backlog === 0 &&
      stats.admission.deferred === 0 &&
      stats.loadsInFlight === 0
    )
      return;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * A scene wired the way the package's own assets wire it, and the reference that says what each key
 * must draw.
 *
 * The shapes below are the ones a real package is made of: authored `lods` with a `maxDistance`, an
 * asset whose model is several parts, a key a walk outgrows, and a prop whose model does not
 * straddle the origin. Each is compared against `cpuReference` — the CPU path's own level and cull
 * tests, written out in this file — key for key and placement for placement.
 */

/** The region index one main key owns, which is what a gate table and the kernel both address. */
function keyOf(scene: WorldGpuScene, name: string): number {
  const at = scene.regions.findIndex((one) => one.name === name);
  if (at < 0) throw new Error(`the scene has no region for ${name}.`);
  return at;
}

/** A scene with one asset per name, every level's `parts` keys minted in part order. */
function wired(
  assets: readonly {
    readonly name: string;
    readonly levels: readonly number[];
    readonly cull?: number;
  }[],
  parts: number,
  capacity: number,
): WorldGpuScene {
  const scene = new WorldGpuScene();
  scene.enable(
    { kind: "webgpu", raw: { backend: { hasFeature: () => true } }, compute: () => {} } as never,
    true,
  );
  for (const asset of assets) {
    const gates: { firstKey: number; parts: number }[] = [];
    for (const [level, distance] of asset.levels.entries()) {
      const group = `${asset.name}:${String(level)}`;
      for (let part = 0; part < parts; part += 1)
        scene.key(`${group}:${String(part)}`, LOCAL, capacity, { group, part });
      gates.push(scene.levelKeys(group) ?? { firstKey: 0, parts: 0 });
    }
    scene.slot(asset.name, { cull: asset.cull, distances: asset.levels, levels: gates });
  }
  return scene;
}

/** `n` placements of `slot` spread along +Z from the origin, at the given spacing. */
function placed(
  scene: WorldGpuScene,
  slot: number,
  n: number,
  spacing: number,
  radius = 0.5,
): void {
  for (let index = 0; index < n; index += 1)
    scene.place(
      slot,
      new Matrix4().makeTranslation(0, 0, 12 + index * spacing),
      0,
      0,
      12 + index * spacing,
      radius,
    );
}

describe("WorldCells GPU-driven main pass", () => {
  it("draws the same set per key as the CPU path, over a 50-pose walk", () => {
    const slots = [
      {
        cull: undefined,
        distances: DISTANCES,
        levels: [
          { firstKey: 0, parts: 1 },
          { firstKey: 1, parts: 1 },
          { firstKey: 2, parts: 1 },
        ],
      },
      {
        cull: 260,
        distances: DISTANCES,
        levels: [
          { firstKey: 3, parts: 1 },
          { firstKey: 4, parts: 1 },
          { firstKey: 5, parts: 1 },
        ],
      },
    ];
    // Six contiguous regions, as a real key minting hands out.
    let start = 0;
    const regions: IRegion[] = slots.flatMap((slot) =>
      slot.levels.map((level, index) => {
        const region: { argsIndex: number; capacity: number; local: Float32Array; start: number } =
          {
            argsIndex: slots.indexOf(slot) * 3 + index,
            capacity: 4096,
            local: LOCAL,
            start,
          };
        start += region.capacity;
        return region;
      }),
    );

    // 200 placements over a 400 m square, every eighth on the second asset.
    const placements: IGpuPlacement[] = [];
    for (let index = 0; index < 200; index += 1) {
      const x = -200 + (index % 20) * 20;
      const z = -200 + Math.floor(index / 20) * 20;
      placements.push(placement(x, 0, z, index % 8 === 0 ? 1 : 0));
    }

    for (let pose = 0; pose < 50; pose += 1) {
      const origin = { x: -180 + pose * 7, z: -180 + (pose % 11) * 30 };
      const { planes } = cameraAt(origin.x, origin.z);
      const input: IKernelInput = {
        camera: { planes, x: origin.x, y: 0, z: origin.z },
        count: placements.length,
        placements,
        regionCount: regions.length,
        regions,
        slots,
      };
      const result = cullAndSelect(input);
      const fromKernel = kernelDrawn(result, input);
      for (const [slotIndex, slot] of slots.entries())
        for (const [level, gate] of slot.levels.entries()) {
          const key = slotIndex * 3 + level;
          const expected = cpuReference(
            placements,
            { planes, x: origin.x, z: origin.z },
            slotIndex,
            slot.distances,
            slot.cull,
            slot.levels[0]?.firstKey ?? 0,
            1,
          ).get(gate.firstKey) as number[];
          expect([...(fromKernel.get(key) as number[])].sort((a, b) => a - b)).toEqual(
            [...expected].sort((a, b) => a - b),
          );
          // And the args record the draw reads carries the same count.
          expect(result.args[gate.firstKey * 5 + 1]).toBe(expected.length);
          expect(result.args[gate.firstKey * 5 + 4]).toBe(regions[gate.firstKey]?.start);
        }
    }
  });

  it("never writes past a region, and regrows are structural only", () => {
    const scene = new WorldGpuScene();
    expect(scene.key("a:0:0", LOCAL, 2)).toBe(0);
    expect(scene.key("b:0:0", LOCAL, 4)).toBe(1);
    const first = scene.regionOf("a:0:0") as IRegion;
    const second = scene.regionOf("b:0:0") as IRegion;
    // Disjoint regions: a key's survivors can never land in another's.
    expect(first.start).toBe(0);
    expect(second.start).toBe(2);

    // Two placements, one region of two: the third is dropped, never written past the end.
    const regions: IRegion[] = [first, second];
    const slots = [
      { cull: undefined, distances: [0], levels: [{ firstKey: 0, parts: 1 }] },
      { cull: undefined, distances: [0], levels: [{ firstKey: 1, parts: 1 }] },
    ];
    const { planes } = cameraAt(0, 0);
    const result = cullAndSelect({
      camera: { planes, x: 0, y: 0, z: 0 },
      count: 3,
      placements: [placement(0, 0, 10, 0), placement(1, 0, 10, 0), placement(2, 0, 10, 0)],
      regionCount: 2,
      regions,
      slots,
    });
    expect(result.counts[0]).toBe(2);
    expect(result.counts[1]).toBe(0);
    expect(result.args[1]).toBe(2);

    // A key that asks for the room it already has is not a regrow, and one that asks for more is,
    // once, and lands at the tail.
    const version = scene.version;
    expect(scene.key("a:0:0", LOCAL, 2)).toBe(0);
    expect(scene.version).toBe(version);
    const grown = scene.key("a:0:0", LOCAL, 8);
    expect(grown).toBe(2);
    expect(scene.version).toBeGreaterThan(version);
    const regrown = scene.regionOf("a:0:0") as IRegion;
    expect(regrown.capacity).toBe(8);
    expect(regrown.start).toBe(6);
    scene.dispose();
  });

  it("falls back to the CPU path, and says why, on a backend without the three", () => {
    expect(gpuSceneUnsupported({ kind: "webgl2", raw: {} } as never)).toBe("backend=webgl2");
    expect(
      gpuSceneUnsupported({
        kind: "webgpu",
        raw: { backend: { hasFeature: () => false } },
      } as never),
    ).toBe("feature=core");
    expect(
      gpuSceneUnsupported({
        kind: "webgpu",
        raw: { backend: { hasFeature: (name: string) => name !== "indirect-first-instance" } },
      } as never),
    ).toBe("feature=indirect-first-instance");
    expect(
      gpuSceneUnsupported({
        kind: "webgpu",
        raw: { backend: { hasFeature: () => true } },
      } as never),
    ).toBe("");

    const lines: string[] = [];
    const log = (message: string): void => {
      lines.push(message);
    };
    console.info = log;
    try {
      const scene = new WorldGpuScene();
      // The option, not the backend: the same answer a WebGL renderer gets.
      expect(
        scene.enable(
          {
            kind: "webgpu",
            raw: { backend: { hasFeature: () => true } },
            compute: () => {},
          } as never,
          false,
        ),
      ).toBe(false);
      expect(scene.on).toBe(false);
      expect(scene.report().reason).toBe("option-off");
      expect(lines.join("\n")).toContain("TN_WORLD_GPU_SCENE off reason=option-off");
      // And a WebGL renderer, which is never asked.
      const gl = new WorldGpuScene();
      expect(gl.enable({ kind: "webgl2", raw: {} } as never, true)).toBe(false);
      expect(gl.report().reason).toBe("backend=webgl2");
      // A backend that can run it is on, and the marker says so.
      const on = new WorldGpuScene();
      expect(
        on.enable(
          {
            kind: "webgpu",
            raw: { backend: { hasFeature: () => true } },
            compute: () => {},
          } as never,
          true,
        ),
      ).toBe(true);
      expect(on.on).toBe(true);
      expect(on.report().reason).toBe("on");
      expect(lines.at(-1)).toContain("TN_WORLD_GPU_SCENE on reason=on");
    } finally {
      console.info = () => {};
    }
  });

  it("a released placement is skipped and its source record is handed back", () => {
    const scene = new WorldGpuScene();
    scene.enable(
      { kind: "webgpu", raw: { backend: { hasFeature: () => true } }, compute: () => {} } as never,
      true,
    );
    const slot = scene.slot("pine", {
      cull: undefined,
      distances: [0],
      levels: [{ firstKey: 0, parts: 1 }],
    });
    scene.key("pine:0:0", LOCAL, 8);
    const first = scene.place(slot, new Matrix4().makeTranslation(0, 0, 10), 0, 0, 10, 0.5);
    const second = scene.place(slot, new Matrix4().makeTranslation(1, 0, 10), 1, 0, 10, 0.5);
    expect(scene.report().instances).toBe(2);
    scene.release(first);
    expect(scene.report().instances).toBe(1);
    expect(scene.placements[first]?.slot).toBe(-1);
    // The record is reused rather than the buffer growing on a walk's back-traffic.
    expect(scene.place(slot, new Matrix4().makeTranslation(2, 0, 10), 2, 0, 10, 0.5)).toBe(first);
    expect(scene.placements[second]?.slot).toBe(slot);
    scene.dispose();
    // A disposed scene holds nothing, and a dispatch on it is a no-op rather than a throw.
    expect(scene.report().instances).toBe(0);
    expect(scene.place(0, new Matrix4(), 0, 0, 0, 1)).toBe(-1);
  });

  it("culls a placement the frustum leaves, exactly as the camera's planes say", () => {
    const camera = new PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, 1);
    camera.updateMatrixWorld(true);
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const planes = new Float32Array(24);
    for (const [index, plane] of frustum.planes.entries()) {
      const at = index * 4;
      planes[at] = plane.normal.x;
      planes[at + 1] = plane.normal.y;
      planes[at + 2] = plane.normal.z;
      planes[at + 3] = plane.constant;
    }
    const region: IRegion = { argsIndex: 0, capacity: 8, local: LOCAL, start: 0 };
    const result = cullAndSelect({
      camera: { planes, x: 0, y: 0, z: 0 },
      count: 2,
      placements: [placement(0, 0, 20, 0, 0.5), placement(0, 0, -20, 0, 0.5)],
      regionCount: 1,
      regions: [region],
      slots: [{ cull: undefined, distances: [0], levels: [{ firstKey: 0, parts: 1 }] }],
    });
    // Ahead of the camera and behind it: one survivor.
    expect(result.counts[0]).toBe(1);
    // A sphere large enough to touch the frustum from behind is drawn, which is the whole point of
    // testing a sphere rather than a point.
    const padded = cullAndSelect({
      camera: { planes, x: 0, y: 0, z: 0 },
      count: 1,
      placements: [placement(0, 0, -20, 0, 40)],
      regionCount: 1,
      regions: [region],
      slots: [{ cull: undefined, distances: [0], levels: [{ firstKey: 0, parts: 1 }] }],
    });
    expect(padded.counts[0]).toBe(1);
  });

  it("composes the part offset into the drawn matrix, the way the CPU path does", () => {
    const { planes } = cameraAt(0, 0);
    const offset = new Matrix4().makeTranslation(0, 3, 0);
    const local = new Float32Array(offset.elements);
    const result = cullAndSelect({
      camera: { planes, x: 0, y: 0, z: 0 },
      count: 1,
      placements: [placement(0, 0, 10, 0)],
      regionCount: 1,
      regions: [{ argsIndex: 0, capacity: 4, local, start: 0 }],
      slots: [{ cull: undefined, distances: [0], levels: [{ firstKey: 0, parts: 1 }] }],
    });
    // The placement at y 0 with a part three metres up draws at y 3.
    expect(result.drawn[13]).toBeCloseTo(3, 5);
    expect(result.drawn[14]).toBeCloseTo(10, 5);
  });
});

/**
 * The GPU scene wired into `WorldCells`, default off and proven with the flag on.
 *
 * The claims are the ones the walk has to earn: a moving follow point spends nothing on the CPU work
 * the dispatch replaced — no main regroup, no `maxDistance`/`lods` refilter — residency still feeds
 * the source buffer both ways, and every main key's mesh is dressed against the scene's own buffers
 * rather than its own. The renderer is a stub that reports the three features, because what is under
 * test is the wiring and the counters, not a draw.
 */
describe("WorldCells with the GPU-driven main pass", () => {
  it("spends no regroup and no refilter, feeds the source buffer, and dresses every main key", async () => {
    stubManifestFetch();
    const follow = { position: { ...cellCentre(0, 1), y: 0 } as { x: number; z: number } };
    const world = await WorldCells.load({
      admissionBudgetMs: Number.POSITIVE_INFINITY,
      budgets,
      follow,
      gpuScene: true,
      loadModel: async () => plainModel(),
      prefetchSeconds: 0,
      ring: 1,
      surface,
      url: "/world/world.json",
    });
    const renderer = {
      compute: (): void => {},
      kind: "webgpu",
      raw: { backend: { hasFeature: (): boolean => true } },
    } as unknown as IRendererLike;
    const camera = playerCamera();
    world.update(renderer, camera);
    await flushed(world);
    // Dressed and fed, both of them, before a single walked frame.
    const settled = world.stats();
    expect(settled.gpuScene.on).toBe(true);
    expect(settled.gpuScene.reason).toBe("on");
    expect(settled.gpuScene.keys).toBeGreaterThan(0);
    expect(settled.gpuScene.instances).toBeGreaterThan(0);
    const main = mainMesh(world);
    // The shared compaction buffer is the mesh's `instanceMatrix`, its own indirect record is on the
    // geometry, and three's whole-mesh test is off because the dispatch already did the culling.
    expect(
      (main.instanceMatrix as unknown as { isStorageInstancedBufferAttribute?: boolean })
        .isStorageInstancedBufferAttribute,
    ).toBe(true);
    expect((main.geometry as BufferGeometry & { indirect: unknown }).indirect).not.toBeNull();
    expect(main.frustumCulled).toBe(false);

    for (let index = 0; index < 200; index += 1) {
      // A walk across the ring, so residency changes underneath the camera rather than a camera
      // turning on the spot: this is the case the CPU per-instance work existed for.
      const at = cellCentre(index % 3, 1 + (index % 2));
      follow.position.x = at.x;
      follow.position.z = at.z;
      world.update(renderer, camera);
    }
    const after = world.stats();
    // The whole claim: 200 frames of a moving follow point, and not one main regroup and not one
    // refilter. With the option off the same walk repacks every time the window moves.
    expect(after.mainCull.repacks - settled.mainCull.repacks).toBe(0);
    expect(after.mainCull.windows - settled.mainCull.windows).toBe(0);
    expect(after.refilters - settled.refilters).toBe(0);
    expect(after.gpuScene.dispatches - settled.gpuScene.dispatches).toBe(200);
    expect(after.gpuScene.instances).toBeGreaterThan(0);
    expect(world.stats().failures).toBe(0);
    world.dispose();
  });

  it("hands the source records back when the ring empties, and says it is off by default", async () => {
    stubManifestFetch();
    const follow = { position: { ...cellCentre(0, 1), y: 0 } as { x: number; z: number } };
    const world = await WorldCells.load({
      admissionBudgetMs: Number.POSITIVE_INFINITY,
      budgets,
      follow,
      gpuScene: true,
      loadModel: async () => plainModel(),
      prefetchSeconds: 0,
      ring: 1,
      surface,
      url: "/world/world.json",
    });
    const renderer = {
      compute: (): void => {},
      kind: "webgpu",
      raw: { backend: { hasFeature: (): boolean => true } },
    } as unknown as IRendererLike;
    world.update(renderer, playerCamera());
    await flushed(world);
    const resident = world.stats().gpuScene.instances;
    expect(resident).toBeGreaterThan(0);

    // Six cells east, which evicts every resident cell. The records the dispatches were drawing are
    // handed back, or the source buffer would grow for the rest of the walk.
    const away = cellCentre(6, 1);
    follow.position.x = away.x;
    follow.position.z = away.z;
    world.update(renderer, playerCamera());
    await flushed(world);
    expect(world.stats().evictions).toBeGreaterThan(0);
    expect(world.stats().gpuScene.instances).toBe(0);
    world.dispose();
  });

  it("is the CPU path byte for byte with the option off", async () => {
    stubManifestFetch();
    const follow = { position: { ...cellCentre(0, 1), y: 0 } as { x: number; z: number } };
    const world = await WorldCells.load({
      admissionBudgetMs: Number.POSITIVE_INFINITY,
      budgets,
      follow,
      loadModel: async () => plainModel(),
      prefetchSeconds: 0,
      ring: 1,
      surface,
      url: "/world/world.json",
    });
    const renderer = {
      compute: (): void => {},
      kind: "webgl2",
      raw: {},
    } as unknown as IRendererLike;
    world.update(renderer, playerCamera());
    await flushed(world);
    // Off, and it says so: the option was not asked for, so a WebGL renderer is never even the
    // interesting answer — the marker names the option.
    expect(world.stats().gpuScene.on).toBe(false);
    expect(world.stats().gpuScene.reason).toBe("option-off");
    expect(world.stats().gpuScene.dispatches).toBe(0);
    // And the batch draws from its own buffer, which is the whole of "byte for byte today".
    const main = mainMesh(world);
    expect(main.frustumCulled).toBe(true);
    expect((main.geometry as BufferGeometry & { indirect: unknown }).indirect).toBeNull();
    expect(mainMesh(world).count).toBe(pineIn("0,0", "0,1", "0,2", "1,0", "1,1", "1,2"));
    world.dispose();
  });
});

describe("WorldCells GPU-driven main pass, against the CPU path's own drawn set", () => {
  it("draws every part of a multi-part asset into the level's own contiguous run", () => {
    // A tree is three parts at two levels — a trunk and two canopies, each with a coarser shape of
    // its own. The gate table addresses a level's parts as `firstKey + part`, so the run has to be
    // the level's own and start at its *first* part: a table that recorded the key it saw last named
    // the last part as the first, and the whole asset then drew into its neighbour's regions.
    const scene = wired([{ name: "oak", levels: [0, 40] }], 3, 64);
    const origin = { x: 0, z: 0, planes: cameraAt(0, 0).planes };
    placed(scene, 0, 12, 8);
    const input: IKernelInput = {
      camera: { planes: origin.planes, x: 0, y: 0, z: 0 },
      count: scene.placements.length,
      placements: scene.placements,
      regionCount: scene.regions.length,
      regions: scene.regions,
      slots: scene.gates(),
    };
    const fromKernel = kernelDrawn(cullAndSelect(input), input);
    // The run each level's parts occupy, from the first part and as wide as the asset's parts.
    expect(scene.levelKeys("oak:0")).toEqual({ firstKey: keyOf(scene, "oak:0:0"), parts: 3 });
    expect(scene.levelKeys("oak:1")).toEqual({ firstKey: keyOf(scene, "oak:1:0"), parts: 3 });
    // `cpuReference` is a single-part model — one key per level — so it is asked for the level's
    // first key, and every part of that level must carry the same placements as it.
    for (const level of [0, 1]) {
      // In the reference's own key space, where a level is `firstKey + level * parts`; from zero with
      // one part, level `n` is key `n`. The scene's region for it is the level's own run.
      const wanted = cpuReference(scene.placements, origin, 0, [0, 40], undefined, 0, 1).get(
        level,
      ) as number[];
      expect(wanted.length).toBeGreaterThan(0);
      for (let part = 0; part < 3; part += 1) {
        const key = keyOf(scene, `oak:${String(level)}:${String(part)}`);
        expect([...(fromKernel.get(key) as number[])].sort((a, b) => a - b)).toEqual(
          [...wanted].sort((a, b) => a - b),
        );
      }
    }
    // 12 m to 36 m at level 0, 44 m to 100 m at level 1: three parts each, nothing drawn nowhere.
    expect(fromKernel.get(keyOf(scene, "oak:0:2"))).toHaveLength(4);
    expect(fromKernel.get(keyOf(scene, "oak:1:2"))).toHaveLength(8);
    scene.dispose();
  });

  it("culls authored ground cover at its maxDistance and switches its lods inside it", () => {
    // `ground_cover` as the committed package writes it: a `lods` entry at 60 m under a `maxDistance`
    // of 30 m, so `assetLevels` drops the level outright — an instance that far out is culled, so
    // its shape is never asked for — and the asset is one level culled at 30 less its eighth.
    const ground = wired([{ name: "gc", levels: [0], cull: 26.25 }], 1, 64);
    const origin = { x: 0, z: 0, planes: cameraAt(0, 0).planes };
    placed(ground, 0, 4, 7);
    // 10 m, 17 m, 24 m inside the cull; 31 m past it.
    const input: IKernelInput = {
      camera: { planes: origin.planes, x: 0, y: 0, z: 0 },
      count: ground.placements.length,
      placements: ground.placements,
      regionCount: ground.regions.length,
      regions: ground.regions,
      slots: ground.gates(),
    };
    const fromKernel = kernelDrawn(cullAndSelect(input), input);
    const expected = cpuReference(ground.placements, origin, 0, [0], 26.25, 0, 1);
    expect([...(fromKernel.get(keyOf(ground, "gc:0:0")) as number[])]).toEqual([
      ...(expected.get(keyOf(ground, "gc:0:0")) as number[]),
    ]);
    expect(fromKernel.get(keyOf(ground, "gc:0:0"))).toHaveLength(3);
    ground.dispose();

    // The same asset with a `lods` entry inside its `maxDistance`: two levels, the switch at 20 m,
    // and the cull still at 26.25 m — a level the package named is the one that takes over.
    const both = wired([{ name: "gc", levels: [0, 20], cull: 26.25 }], 1, 64);
    placed(both, 0, 4, 7);
    const second: IKernelInput = {
      camera: { planes: origin.planes, x: 0, y: 0, z: 0 },
      count: both.placements.length,
      placements: both.placements,
      regionCount: both.regions.length,
      regions: both.regions,
      slots: both.gates(),
    };
    const drawn = kernelDrawn(cullAndSelect(second), second);
    const wanted = cpuReference(both.placements, origin, 0, [0, 20], 26.25, 0, 1);
    for (const [key, indexes] of wanted)
      expect([...(drawn.get(key) as number[])].sort((a, b) => a - b)).toEqual(
        [...indexes].sort((a, b) => a - b),
      );
    // 10 m and 17 m at level 0, 24 m at level 1, 31 m culled.
    expect(drawn.get(keyOf(both, "gc:0:0"))).toHaveLength(2);
    expect(drawn.get(keyOf(both, "gc:1:0"))).toHaveLength(1);
    both.dispose();
  });

  it("regrows a level whole when its placements outgrow the region, and draws all of them", () => {
    const scene = wired([{ name: "gc", levels: [0] }], 2, 2);
    const origin = { x: 0, z: 0, planes: cameraAt(0, 0).planes };
    const run = (): Map<number, number[]> => {
      const input: IKernelInput = {
        camera: { planes: origin.planes, x: 0, y: 0, z: 0 },
        count: scene.placements.length,
        placements: scene.placements,
        regionCount: scene.regions.length,
        regions: scene.regions,
        slots: scene.gates(),
      };
      return kernelDrawn(cullAndSelect(input), input);
    };
    placed(scene, 0, 5, 4);
    // The capacity guard drops what does not fit, and says so in the count rather than writing past
    // the region: two of five in each part.
    expect(run().get(keyOf(scene, "gc:0:0"))).toHaveLength(2);

    // A walk that brings the rest in: the level is regrown whole, both parts with it, and the run
    // the gate table addresses is still the two keys side by side.
    for (const part of [0, 1]) scene.key(`gc:0:${String(part)}`, LOCAL, 8, { group: "gc:0", part });
    expect(scene.levelKeys("gc:0")).toEqual({ firstKey: keyOf(scene, "gc:0:0"), parts: 2 });
    const grown = run();
    expect(grown.get(keyOf(scene, "gc:0:0"))).toHaveLength(5);
    expect(grown.get(keyOf(scene, "gc:0:1"))).toHaveLength(5);
    // The regrown region starts at the tail and the draw's own `firstInstance` says so.
    const region = scene.regionOf("gc:0:0") as IRegion;
    expect(region.capacity).toBe(8);
    expect(region.start).toBeGreaterThanOrEqual(4);
    expect(scene.regionOf("gc:0:1")?.start).toBe((region.start ?? 0) + 8);
    scene.dispose();
  });

  it("selects a level deeper than eight, which the kernel's own unrolled bound could not reach", () => {
    // A baked AutoLOD chain is not eight levels long by construction, and an unrolled loop bounded
    // by a fixed count drew everything past its last one at the wrong shape. The reference is the
    // branch the kernel mirrors, and it has no such bound.
    const distances = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
    const scene = wired([{ name: "pine", levels: distances }], 1, 64);
    const origin = { x: 0, z: 0, planes: cameraAt(0, 0).planes };
    placed(scene, 0, 3, 45);
    const input: IKernelInput = {
      camera: { planes: origin.planes, x: 0, y: 0, z: 0 },
      count: scene.placements.length,
      placements: scene.placements,
      regionCount: scene.regions.length,
      regions: scene.regions,
      slots: scene.gates(),
    };
    const fromKernel = kernelDrawn(cullAndSelect(input), input);
    const expected = cpuReference(scene.placements, origin, 0, distances, undefined, 0, 1);
    for (const [key, indexes] of expected)
      expect([...(fromKernel.get(key) as number[])].sort((a, b) => a - b)).toEqual(
        [...indexes].sort((a, b) => a - b),
      );
    // 10 m at level 1, 55 m at level 5, 100 m at level 10: past every fixed count a loop could hold.
    expect(fromKernel.get(keyOf(scene, "pine:1:0"))).toHaveLength(1);
    expect(fromKernel.get(keyOf(scene, "pine:5:0"))).toHaveLength(1);
    expect(fromKernel.get(keyOf(scene, "pine:10:0"))).toHaveLength(1);
    scene.dispose();
  });

  it("keeps a prop whose model reaches away from its placement point, the way the CPU path does", () => {
    // A 20 m pole: bounds from y 0 to y 20 and a hand's width across, so a sphere at the placement
    // with the bounds' half-diagonal as its radius covers the first ten metres and no more. A camera
    // above it looking down sees metres 10.8 to 20 of it and none of the placement, and a point
    // sphere culls the whole pole. The CPU path's own gate is the cell's box over the same widened
    // bounds, so it draws it; the dispatch has to.
    const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 20, 0);
    camera.lookAt(0, 0, 80);
    camera.updateMatrixWorld(true);
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const planes = new Float32Array(24);
    for (const [index, plane] of frustum.planes.entries()) {
      const at = index * 4;
      planes[at] = plane.normal.x;
      planes[at + 1] = plane.normal.y;
      planes[at + 2] = plane.normal.z;
      planes[at + 3] = plane.constant;
    }
    const scene = wired([{ name: "pole", levels: [0] }], 1, 8);
    scene.place(0, new Matrix4().makeTranslation(0, 0, 4), 0, 10, 4, 10);
    const input: IKernelInput = {
      camera: { planes, x: 0, y: 20, z: 0 },
      count: 1,
      placements: scene.placements,
      regionCount: scene.regions.length,
      regions: scene.regions,
      slots: scene.gates(),
    };
    // The bounds' own sphere, which is what `#addPlacements` places: centred where the bounds' centre
    // lands, with the same radius.
    expect(cullAndSelect(input).counts[keyOf(scene, "pole:0:0")]).toBe(1);
    // The same placement with a sphere at its own point, which is what the wiring used to place: the
    // pole's upper half is on screen and the placement is not.
    const atPoint: IGpuPlacement[] = [
      { ...(scene.placements[0] as IGpuPlacement), centre: new Float32Array([0, 0, 4, 10]) },
    ];
    expect(cullAndSelect({ ...input, placements: atPoint }).counts[keyOf(scene, "pole:0:0")]).toBe(
      0,
    );
    scene.dispose();
  });
});

describe("WorldCells whose GPU scene comes up under a built ring", () => {
  /** A world over the same package, the same ring and the same camera, built the way the test asks. */
  async function build(framesWithoutARenderer: number): Promise<WorldCells> {
    stubManifestFetch();
    const follow = { position: { ...cellCentre(0, 1), y: 0 } as { x: number; z: number } };
    const world = await WorldCells.load({
      admissionBudgetMs: Number.POSITIVE_INFINITY,
      budgets,
      follow,
      gpuScene: true,
      loadModel: async () => plainModel(),
      prefetchSeconds: 0,
      ring: 1,
      surface,
      url: "/world/world.json",
    });
    for (let index = 0; index < framesWithoutARenderer; index += 1) {
      world.update();
      await flush();
    }
    await flushed(world);
    return world;
  }

  it("gives the dispatch the ring it built before the scene came up", async () => {
    // The frames before the world has a renderer: the ring is admitted, decoded and swapped into the
    // CPU path's own batches, and not one of those placements has a source record. Nothing else in
    // the class would ever hand them over — a cell is only rebuilt when its records change, and
    // theirs have not.
    const late = await build(20);
    const renderer = {
      compute: (): void => {},
      kind: "webgpu",
      raw: { backend: { hasFeature: (): boolean => true } },
    } as unknown as IRendererLike;
    late.update(renderer, playerCamera());
    await flushed(late);
    const on = late.stats();
    expect(on.gpuScene.on).toBe(true);
    expect(on.gpuScene.instances).toBeGreaterThan(0);
    expect(on.failures).toBe(0);
    late.dispose();

    // And it is the same set a world whose scene was on from its first frame holds: the ring is not
    // half given over, it is all of it.
    const fromFirstFrame = await build(0);
    fromFirstFrame.update(renderer, playerCamera());
    await flushed(fromFirstFrame);
    expect(on.gpuScene.instances).toBe(fromFirstFrame.stats().gpuScene.instances);
    fromFirstFrame.dispose();
  });
});

/**
 * The cull kernel's bindings, against the sizes WebGPU holds them to.
 *
 * A real WebGPU run of `?scene=map-walk&tnGpuScene=1&tnGpuSceneValidate=1` raised a validation error
 * 956 times a run — `[Buffer (unlabeled)] bound with size 16 at group 0, binding 6 is too small` —
 * and `TN_WORLD_GPU_SCENE_VALIDATE ok keys=0` printed throughout, because the refused dispatch left
 * the args buffer holding what the clear pass wrote. The kernel never ran and the check agreed. So:
 * every buffer holds at least one element of the type the kernel declares it as, and a check that
 * compared nothing while placements existed is an error rather than a pass.
 */
describe("WorldGpuScene storage bindings and its validation verdict", () => {
  /**
   * Drive `count` frames of the dispatch and let the readbacks land, so a validation that runs every
   * thirtieth dispatch has actually run by the time this returns.
   */
  async function drive(
    scene: WorldGpuScene,
    renderer: IRendererLike,
    count: number,
  ): Promise<void> {
    const { camera } = cameraAt(0, 0);
    for (let index = 0; index < count; index += 1) {
      scene.dispatch(renderer, camera);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** Asserts every buffer the scene owns can be bound as the type the kernel declares it as. */
  function expectBindable(scene: WorldGpuScene, where: string): void {
    const footprint = scene.footprint();
    // Every buffer the class allocates, so a new one cannot join without being checked.
    expect(Object.keys(footprint).sort()).toEqual([
      "args",
      "drawn",
      "gates",
      "keys",
      "levels",
      "locals",
      "source",
    ]);
    for (const [name, buffer] of Object.entries(footprint)) {
      const floor = storageElementBytes(buffer.type);
      expect(buffer.bytes, `${where}: ${name} is under one ${buffer.type}`).toBeGreaterThanOrEqual(
        floor,
      );
      // And the item size the kernel indexes by is the declared element size, not a word count that
      // happens to divide: `drawn` at four words per `mat4` is 16 bytes against a 64-byte minimum.
      expect(buffer.count * floor, `${where}: ${name} element count`).toBe(buffer.bytes);
    }
  }

  it("holds every storage binding to at least one element of its declared type", () => {
    const scene = new WorldGpuScene();
    scene.enable({ kind: "webgpu", raw: { backend: { hasFeature: () => true } } } as never, true);
    // Nothing is bound before a slot or a key exists, so there is nothing that can be too small.
    expect(scene.footprint()).toEqual({});

    // Empty: a slot and no key and no placement. The smallest set of bindings there is, and the
    // state the real run failed in — the one-element `drawn` buffer was 16 bytes against the 64 a
    // `mat4` needs.
    scene.slot("pine", { cull: 100, distances: DISTANCES, levels: [{ firstKey: 0, parts: 0 }] });
    expectBindable(scene, "empty");

    // One key and one placement — the first structural change a real ring makes.
    scene.key("pine:0:0", LOCAL, 4, { group: "pine:0", part: 0 });
    scene.slot("pine", { cull: 100, distances: DISTANCES, levels: [{ firstKey: 0, parts: 1 }] });
    scene.place(0, new Matrix4().makeTranslation(0, 0, 8), 0, 0, 8, 0.5);
    expectBindable(scene, "one-key");

    // A regrow: the key outgrows its region and is re-minted at the tail, which replaces `keys`,
    // `locals`, `args` and `drawn` in one go.
    scene.key("pine:0:0", LOCAL, 4096);
    expectBindable(scene, "regrown");
    expect(scene.footprint().drawn?.count).toBeGreaterThan(1);
  });

  it("keeps the gate table whole when it is written", () => {
    // Two assets, three levels each: the table is sized before it is written, so the second asset's
    // first `vec4` is a value and not a hole the `Float32Array` swallowed.
    const scene = wired(
      [
        { cull: 120, levels: DISTANCES, name: "pine" },
        { cull: 40, levels: DISTANCES, name: "rock" },
      ],
      1,
      4,
    );
    const gates = scene.footprint().gates;
    expect(gates?.count).toBeGreaterThanOrEqual(2);
    // `wired` adopts both assets, and the second one's gate is only there if the table was sized
    // first; a table written at one `vec4` and grown afterwards leaves the tail zero.
    expect(scene.gates()).toHaveLength(2);
    const levels = scene.footprint().levels;
    expect((levels?.count ?? 0) * 4).toBeGreaterThanOrEqual(6);
  });

  it("keeps every regrown binding as wide as the kernel declares it", () => {
    // 40 keys, then one regrown past all of them: a regrow must re-allocate through the same
    // declared type, and a stride written at the call site is how `drawn` lost 48 bytes.
    const scene = wired([{ name: "pine", levels: DISTANCES }], 1, 8);
    scene.key("pine:2:0", LOCAL, 64);
    expectBindable(scene, "grown");
    const drawn = scene.footprint().drawn;
    expect(drawn?.type).toBe("mat4");
    expect(drawn?.bytes).toBe((drawn?.count ?? 0) * 64);
  });

  it("names what a device error and an empty comparison do to the verdict", () => {
    const base = {
      compared: 6,
      deviceError: "",
      instancesCpu: 120,
      instancesGpu: 120,
      mismatched: 0,
      mismatches: [] as readonly string[],
      placed: 400,
    };
    const agreed = validationReport(base);
    expect(agreed.verdict).toBe("ok");
    expect(agreed.line).toBe(
      "TN_WORLD_GPU_SCENE_VALIDATE ok compared=6 instancesGpu=120 instancesCpu=120 mismatched=0",
    );
    expect(agreed.lines).toEqual([]);

    // The run that shipped: a kernel the device refused, and a check that reported success anyway.
    const nothing = validationReport({
      ...base,
      compared: 0,
      instancesCpu: 0,
      instancesGpu: 0,
      placed: 0,
    });
    expect(nothing.verdict).toBe("ok");
    expect(nothing.line).toBe(
      "TN_WORLD_GPU_SCENE_VALIDATE ok compared=0 instancesGpu=0 instancesCpu=0 mismatched=0",
    );

    // Compared nothing with placements resident: nothing was checked, so it is not a pass.
    const blind = validationReport({
      ...base,
      compared: 0,
      instancesCpu: 0,
      instancesGpu: 0,
      placed: 812,
    });
    expect(blind.verdict).toBe("error");
    expect(blind.line).toBe(
      "TN_WORLD_GPU_SCENE_VALIDATE error compared=0 instancesGpu=0 instancesCpu=0 mismatched=0",
    );
    expect(blind.lines).toEqual(["reason=compared-0-with-placed=812"]);

    // A refused dispatch, however good the counts look.
    const refused = validationReport({
      ...base,
      deviceError: "GPUValidationError: bound with size 16 is too small",
    });
    expect(refused.verdict).toBe("error");
    expect(refused.line).toBe(
      "TN_WORLD_GPU_SCENE_VALIDATE error compared=6 instancesGpu=120 instancesCpu=120 mismatched=0",
    );
    expect(refused.lines).toEqual([
      "device-error GPUValidationError: bound with size 16 is too small",
    ]);

    const differing = validationReport({
      ...base,
      instancesGpu: 96,
      mismatched: 2,
      mismatches: ["pine:0:0 gpu=40 cpu=48", "pine:1:0 gpu=56 cpu=48"],
    });
    expect(differing.verdict).toBe("mismatch");
    expect(differing.line).toBe(
      "TN_WORLD_GPU_SCENE_VALIDATE mismatch compared=6 instancesGpu=96 instancesCpu=120 mismatched=2",
    );
    expect(differing.lines).toEqual(["pine:0:0 gpu=40 cpu=48", "pine:1:0 gpu=56 cpu=48"]);
  });

  it("reports the device's own uncaptured error instead of the counts", async () => {
    // The device three's backend wrapped, raising exactly the error the real run raised.
    let raise: ((event: unknown) => void) | null = null;
    const device: { onuncapturederror?: ((event: unknown) => void) | null } = {};
    const lines: string[] = [];
    const renderer = {
      compute: (): void => {},
      kind: "webgpu",
      // three chains its own handler onto the device, printing the message; ours must add to it, not
      // replace it, or the console line the evidence came from would go quiet.
      log: (line: string): void => {
        lines.push(line);
      },
      raw: {
        backend: {
          device,
          hasFeature: (): boolean => true,
        },
      },
      readback: async (attribute: unknown): Promise<ArrayBuffer> =>
        (attribute as { array: Uint32Array }).array.buffer.slice(0) as ArrayBuffer,
    } as unknown as IRendererLike;
    device.onuncapturederror = (): void => {
      raise = device.onuncapturederror ?? null;
    };
    const scene = new WorldGpuScene();
    expect(scene.enable(renderer, true, true)).toBe(true);
    raise = device.onuncapturederror ?? null;
    expect(typeof raise).toBe("function");

    scene.key("pine:0:0", LOCAL, 4, { group: "pine:0", part: 0 });
    scene.slot("pine", { cull: 100, distances: DISTANCES, levels: [{ firstKey: 0, parts: 1 }] });
    scene.place(0, new Matrix4().makeTranslation(0, 0, 8), 0, 0, 8, 0.5);

    // One dispatched frame, then the readback lands with the GPU half of the counts still zero —
    // and a device error in between, which is the whole point.
    (raise as unknown as (event: unknown) => void)({
      error: {
        constructor: { name: "GPUValidationError" },
        message:
          "[Buffer (unlabeled)] bound with size 16 at group 0, binding 6 is too small. The pipeline requires a buffer binding which is at least 64 bytes.",
      },
    });
    await drive(scene, renderer, 30);
    const reported = lines.filter((line) => line.startsWith("TN_WORLD_GPU_SCENE_VALIDATE"));
    expect(reported.length).toBeGreaterThan(0);
    expect(reported.some((line) => line.includes(" error "))).toBe(true);
    expect(
      reported.some((line) => line.includes("GPUValidationError") && line.includes("binding 6")),
    ).toBe(true);
    expect(scene.validation.verdict).toBe("error");
    expect(scene.validation.compared).toBe(1);

    // Reported once: the next check with no new error is a check of its own, and a cleared message
    // does not come back to claim a second one.
    lines.length = 0;
    await drive(scene, renderer, 30);
    expect(lines.some((line) => line.includes("device-error"))).toBe(false);
    expect(scene.validation.verdict).not.toBe("error");
  });
});
