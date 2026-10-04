import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BoxGeometry,
  DirectionalLight,
  Frustum,
  type InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
} from "three";
import type { NodeBuilder, NodeFrame } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VIRTUAL_SHADOW_CASTER_LAYER,
  VIRTUAL_SHADOW_SMALL_CASTER_LAYER,
  VIRTUAL_SHADOW_WIDE_CASTER_LAYER,
  VirtualShadowNode,
} from "../src/render/virtual-shadow.js";
import {
  type IGpuPlacement,
  type IKernelInput,
  type IRegion,
  type IShadowLevel,
  cullAndSelectShadow,
} from "../src/world-gpu-scene.js";
import { type IWorldPackage, WorldCells } from "../src/world.js";

/**
 * PRD-478 phase 2: a shadow level's GPU-key selection against the cluster path it would replace, on
 * the committed `world-v1` package rather than on a fixture invented to agree with it.
 *
 * The cluster path is measured rather than modelled. A real `WorldCells` streams the package with the
 * GPU scene on, a real `VirtualShadowNode` runs `#probe` and takes its level renders, and the harness
 * mirrors three's own draw gate over the meshes that survive — so "what the old path submits for
 * this map" is read off the meshes and their instance matrices. The other side is
 * `cullAndSelectShadow` on an input this file builds from the package: the placement spheres, the
 * cull distances and the gate table come from the manifest, and the key layout is this file's own,
 * so a kernel that read the wrong planes, centre, gate or level cannot agree with it by sharing the
 * mistake. Every frustum test below is three's own, applied here rather than through the reference.
 */

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "world-v1");
const manifest = JSON.parse(
  readFileSync(path.join(fixture, "world.json"), "utf8"),
) as IWorldPackage;
const CELL = manifest.cellSize;
const RING = 1;
const MIN_CASTER_TEXELS = 1.5;
const CLIP_EXTENTS = [48, 192, 320] as const;
const MAP_SIZE = 256;
const ASSETS = Object.keys(manifest.assets).sort();
const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
/** The follow point, and the cell it stands in: the ring is `ring` cells of it in Chebyshev distance. */
const FOLLOW = {
  x: manifest.extent.minX + 1.5 * CELL,
  z: manifest.extent.minZ + 1.5 * CELL,
};
const FOLLOW_CELL = {
  x: Math.floor((FOLLOW.x - manifest.extent.minX) / CELL),
  z: Math.floor((FOLLOW.z - manifest.extent.minZ) / CELL),
};
const budgets = { bytes: 1_000_000_000, instances: 1_000_000, residentCells: 64 };

interface IPlacement {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly cull: number | undefined;
  /** Which asset's gate table this placement is selected against. */
  readonly slot: number;
  /** `x,z`, which is how both sides name a placement: the instance matrix is a translation here. */
  readonly key: string;
}

/** Half the diagonal of an asset's authored bounds: the sphere radius its placements are culled with. */
function radiusOf(id: string): number {
  const bounds = manifest.assets[id]?.bounds;
  if (bounds === undefined) throw new Error(`the committed package has no ${id} asset.`);
  return (
    0.5 *
    Math.hypot(
      (bounds.max[0] as number) - (bounds.min[0] as number),
      (bounds.max[1] as number) - (bounds.min[1] as number),
      (bounds.max[2] as number) - (bounds.min[2] as number),
    )
  );
}

/** `cullDistance(maxDistance)`: the authored reach less its eighth, which is what the world filters on. */
function cullOf(id: string): number | undefined {
  const max = manifest.assets[id]?.maxDistance;
  return max === undefined ? undefined : max - max / 8;
}

/**
 * One asset as a single box over its authored bounds, so the geometry radius the cluster path's texel
 * gate measures is the same number the placement's own sphere came from: a box at the origin would be
 * judged as 13.86 m wide while its fern placements are 1.41 m, and the two gates would then be
 * answering different questions.
 */
function modelFor(id: string): Object3D {
  const bounds = manifest.assets[id]?.bounds;
  if (bounds === undefined) throw new Error(`the committed package has no ${id} asset.`);
  const mesh = new Mesh(
    new BoxGeometry(
      (bounds.max[0] as number) - (bounds.min[0] as number),
      (bounds.max[1] as number) - (bounds.min[1] as number),
      (bounds.max[2] as number) - (bounds.min[2] as number),
    ),
    new MeshBasicMaterial(),
  );
  mesh.position.set(
    ((bounds.max[0] as number) + (bounds.min[0] as number)) * 0.5,
    ((bounds.max[1] as number) + (bounds.min[1] as number)) * 0.5,
    ((bounds.max[2] as number) + (bounds.min[2] as number)) * 0.5,
  );
  return mesh;
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

function stubFixtureFetch(): void {
  const body = JSON.stringify(manifest);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown): Promise<object> => {
      const url = String(input);
      if (url.endsWith("world.json"))
        return {
          arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
          headers: new Headers(),
          json: async () => manifest,
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

async function flush(rounds = 4): Promise<void> {
  for (let round = 0; round < rounds; round += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function cameraAt(x: number, z: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, 1.7, 0.1, 900);
  camera.position.set(x, 12, z);
  camera.lookAt(x + 60, 0, z);
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  return camera;
}

/** What `VirtualShadowNode.setup` needs: a shadow-enabled renderer and a material context. */
const builder = {
  context: {},
  material: {},
  renderer: { shadowMap: { enabled: true } },
} as unknown as NodeBuilder;

function frustumOf(camera: PerspectiveCamera): Frustum {
  return new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
}

/** The six planes of a level's own shadow camera, in the order `cameraPlanes` writes them. */
function planesOf(camera: PerspectiveCamera): Float32Array {
  const planes = new Float32Array(24);
  for (const [index, plane] of frustumOf(camera).planes.entries()) {
    const at = index * 4;
    planes[at] = plane.normal.x;
    planes[at + 1] = plane.normal.y;
    planes[at + 2] = plane.normal.z;
    planes[at + 3] = plane.constant;
  }
  return planes;
}

/** Whether a placement of `radius` at `(x, z)` is in this camera's frustum, as three tests it. */
function inFrustum(camera: PerspectiveCamera, one: IPlacement): boolean {
  return frustumOf(camera).intersectsSphere(new Sphere(new Vector3(one.x, 0, one.z), one.radius));
}

interface ILevelNode {
  readonly light: DirectionalLight;
  readonly shadow: { readonly camera: PerspectiveCamera };
  updateShadow(frame: NodeFrame): void;
}

/** One level's last render: what it submitted, what its gate hid, and the four numbers it selects by. */
interface ILevelRender {
  readonly gated: Set<string>;
  readonly level: IShadowLevel;
  readonly submitted: Set<string>;
  draws: number;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a shadow level's GPU-key selection against the cluster path", () => {
  it("selects the cluster path's own instances, and drops only what its own frustum or gate drops", async () => {
    stubFixtureFetch();
    const scene = new Scene();
    const light = new DirectionalLight(0xffffff, 1);
    light.position.set(60, 200, -40);
    light.castShadow = true;
    scene.add(light, light.target);
    const node = new VirtualShadowNode(light, {
      clipExtents: [...CLIP_EXTENTS],
      mapSize: MAP_SIZE,
      marker: false,
      // The package's own default, named here because the reference computes this level's gate from
      // it: `minCasterTexels * 2 * extent / mapSize`.
      minCasterTexels: MIN_CASTER_TEXELS,
    });
    node.setup(builder);

    /**
     * One level's render, as three performs it for a caster: `#probe` has already hidden what this
     * level's texel gate drops and chosen this level's caster layers, so what is left is the whole of
     * the cluster path's bill — the camera's layer mask, the frustum, `visible` and `castShadow` —
     * with the instances read off the meshes' own matrices.
     */
    const casterLayers =
      (1 << VIRTUAL_SHADOW_CASTER_LAYER) |
      (1 << VIRTUAL_SHADOW_WIDE_CASTER_LAYER) |
      (1 << VIRTUAL_SHADOW_SMALL_CASTER_LAYER);
    const renders = new Map<number, ILevelRender>();
    for (const [index, levelNode] of node.levelNodes.entries()) {
      const level = levelNode as unknown as ILevelNode;
      level.updateShadow = (): void => {
        level.light.shadow.updateMatrices(level.light);
        const camera = level.shadow.camera;
        camera.updateMatrixWorld(true);
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        const frustum = frustumOf(camera);
        // The window centre this render is made against is where its own light target was put:
        // `offsetU`/`offsetV` exist because a deferred level's map sits where it was drawn, so the
        // followed centre is not the one its selection belongs to.
        const centre = level.light.target.position;
        const extent = node.stats.perLevel[index]?.extent ?? 0;
        const held: ILevelRender = {
          draws: 0,
          gated: new Set<string>(),
          level: {
            base: 0,
            centre: { x: centre.x, z: centre.z },
            gate: (MIN_CASTER_TEXELS * 2 * extent) / MAP_SIZE,
            planes: planesOf(camera),
          },
          submitted: new Set<string>(),
        };
        renders.set(index, held);
        scene.traverse((object: Object3D) => {
          const mesh = object as InstancedMesh;
          if ((mesh as { isInstancedMesh?: boolean }).isInstancedMesh !== true) return;
          if (mesh.castShadow !== true) return;
          if ((mesh.layers.mask & camera.layers.mask) === 0) return;
          if ((mesh.layers.mask & casterLayers) === 0) return;
          // A merged chunk proxy stands in for meshes the GPU keys do not draw — the box's own
          // residual — so it is not part of either side's set.
          if (mesh.name.endsWith("-shadow")) return;
          const reaches = frustum.intersectsObject(mesh);
          const matrix = mesh.instanceMatrix.array as Float32Array;
          const name = (instance: number): string => {
            const at = instance * 16;
            return `${(matrix[at + 12] as number).toFixed(3)},${(matrix[at + 14] as number).toFixed(3)}`;
          };
          if (mesh.visible === false) {
            // Hidden by this level's texel gate, which is the cluster path's own decision. Counted only
            // where the frustum would have kept the square, because a square the frustum drops is not
            // drawn by either path and the gate never got a say in it.
            if (reaches === false) return;
            for (let instance = 0; instance < mesh.count; instance += 1)
              held.gated.add(name(instance));
            return;
          }
          if (reaches === false) return;
          held.draws += 1;
          for (let instance = 0; instance < mesh.count; instance += 1)
            held.submitted.add(name(instance));
        });
      };
    }

    const world = await WorldCells.load({
      admissionBudgetMs: Number.POSITIVE_INFINITY,
      budgets,
      follow: { position: { ...FOLLOW } },
      gpuScene: true,
      loadModel: async (url: string) => modelFor(path.basename(url, ".glb").replace("_lod1", "")),
      prefetchSeconds: 0,
      ring: RING,
      shadows: { cast: true, castLevels: CLIP_EXTENTS.length },
      surface: new MeshBasicMaterial(),
      url: "/world/world.json",
    });
    scene.add(world);
    const camera = cameraAt(FOLLOW.x, FOLLOW.z);
    for (let frame = 1; frame <= 30; frame += 1) {
      world.update(undefined, camera);
      node.updateBefore({ camera, renderer: {}, time: frame } as unknown as NodeFrame);
      await flush();
    }
    expect(world.stats().loadsInFlight, "the world streamed").toBe(0);

    // The resident set, from the ring rule, checked against the world's own count: the reference is
    // fed the placements a resident world holds, and a placement from a cell that left the ring has
    // no caster mesh anywhere for either side to agree about.
    const resident = new Set(
      manifest.cells
        .filter(
          (cell) =>
            Math.abs(cell.x - FOLLOW_CELL.x) <= RING && Math.abs(cell.z - FOLLOW_CELL.z) <= RING,
        )
        .map((cell) => `${String(cell.x)},${String(cell.z)}`),
    );
    expect(resident.size).toBe(world.stats().residentCells);

    // The reference's input, built from the package: one key per asset at its near level, in asset
    // order, and every resident placement the package files — each admitted on the world's own
    // `maxDistance` rule, measured from the follow point as `#addPlacements` measures it.
    const bytes = readFileSync(path.join(fixture, "placements.bin"));
    const records = new Float32Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const placements: IPlacement[] = [];
    const slots: {
      cull: number | undefined;
      distances: readonly number[];
      levels: { firstKey: number; parts: number }[];
    }[] = [];
    const regions: IRegion[] = [];
    for (const [slot, id] of ASSETS.entries()) {
      const definition = manifest.assets[id];
      if (definition === undefined) continue;
      const radius = radiusOf(id);
      const cull = cullOf(id);
      slots.push({
        cull,
        distances: [0, ...(definition.lods ?? []).map((lod) => lod.distance)],
        levels: [{ firstKey: slot, parts: 1 }],
      });
      regions.push({
        argsIndex: slot,
        capacity: 4096,
        indexCount: 36,
        local: IDENT,
        name: `${id}:0:0`,
        start: slot * 4096,
      });
      for (const cell of manifest.cells) {
        if (!resident.has(`${String(cell.x)},${String(cell.z)}`)) continue;
        for (const run of cell.runs) {
          if (run.asset !== id) continue;
          for (let at = 0; at < run.count; at += 1) {
            const base = (run.offset + at) * 8;
            const x = records[base] as number;
            const z = records[base + 2] as number;
            const scale = Math.abs(records[base + 7] as number);
            if (cull !== undefined && Math.hypot(x - FOLLOW.x, z - FOLLOW.z) > cull) continue;
            placements.push({
              cull,
              key: `${x.toFixed(3)},${z.toFixed(3)}`,
              radius: radius * scale,
              slot,
              x,
              z,
            });
          }
        }
      }
    }
    expect(placements.length, "the resident world holds placements").toBeGreaterThan(0);

    let saved = 0;
    let drawnTotal = 0;
    for (const [index, held] of renders) {
      const levelCamera = (node.levelNodes[index] as unknown as ILevelNode).shadow.camera;
      const { base, centre, gate, planes } = held.level;
      const level: IShadowLevel = { base, centre, gate, planes };
      const kernel: IKernelInput = {
        camera: { planes, x: centre.x, y: 0, z: centre.z },
        count: placements.length,
        placements: placements.map((one) => ({
          centre: new Float32Array([one.x, 0, one.z, one.radius]),
          matrix: new Float32Array(new Matrix4().makeTranslation(one.x, 0, one.z).elements),
          slot: one.slot,
        })),
        regionCount: regions.length,
        regions,
        slots,
      };
      const result = cullAndSelectShadow(kernel, level);
      const drawn = new Set<string>();
      for (const [key, count] of [...result.counts.entries()]) {
        const region = regions[key] as IRegion;
        for (let taken = 0; taken < count; taken += 1) {
          const at = (region.start + taken) * 16;
          drawn.add(
            `${(result.drawn[at + 12] as number).toFixed(3)},${(result.drawn[at + 14] as number).toFixed(3)}`,
          );
        }
      }
      const byKey = new Map(placements.map((one) => [one.key, one] as const));
      const owns = (one: string): IPlacement => {
        const found = byKey.get(one);
        if (found === undefined) throw new Error(`no resident placement owns ${one}.`);
        return found;
      };

      // Nothing this map draws is something the cluster path did not draw for it: the shadow set is
      // a subset of the old path's own submissions, so no shadow in this map is a new loss.
      expect(
        [...drawn].filter((one) => held.submitted.has(one) === false),
        `level ${String(index)} drew an instance its caster meshes never submitted`,
      ).toEqual([]);
      expect(drawn.size, `level ${String(index)} drew something`).toBeGreaterThan(0);
      // Every instance it draws is inside this map's own light frustum and past its own texel gate,
      // by three's own test applied here: the planes and the gate are the map's, not the camera's.
      for (const one of drawn) {
        const found = owns(one);
        expect(
          inFrustum(levelCamera, found),
          `level ${String(index)} drew ${one}, which its own frustum excludes`,
        ).toBe(true);
        expect(
          found.radius * 2,
          `level ${String(index)} drew a sub-texel instance`,
        ).toBeGreaterThanOrEqual(gate);
      }
      // Every instance it drops is one this map's own frustum excludes, or its own gate resolves, or
      // its asset's authored reach ends: the per-square over-draw the cluster path pays and the
      // per-placement test does not.
      const dropped = [...held.submitted].filter((one) => drawn.has(one) === false);
      for (const one of dropped) {
        const found = owns(one);
        const beyond =
          found.cull !== undefined &&
          Math.hypot(found.x - centre.x, found.z - centre.z) > found.cull;
        expect(
          inFrustum(levelCamera, found) === false || found.radius * 2 < gate || beyond,
          `level ${String(index)} dropped ${one}, which its own frustum holds and its own gate resolves`,
        ).toBe(true);
      }
      // And the gate answers the cluster path's own: every instance the reference drops for being
      // sub-texel is one on a mesh `#probe` hid, and as many as it hid.
      // A gate-hidden square submits nothing, so the sub-texel set is the one over every square the
      // frustum reached — submitted or hidden by the gate.
      const reached = new Set([...held.submitted, ...held.gated]);
      const subTexel = [...reached].filter((one) => owns(one).radius * 2 < gate);
      expect(
        [...subTexel].filter((one) => drawn.has(one)),
        `level ${String(index)} drew a sub-texel`,
      ).toEqual([]);
      expect(
        held.gated.size,
        `level ${String(index)}'s gate hid as many instances as the reference drops`,
      ).toBe(subTexel.length);
      saved += dropped.length + held.gated.size;
      drawnTotal += drawn.size;
    }
    // Every level rendered, and the per-placement test saved real submissions: the candidates this
    // phase exists to cut are the squares a whole-square frustum test keeps alive.
    expect(renders.size).toBe(CLIP_EXTENTS.length);
    expect(saved).toBeGreaterThan(0);
    console.info(
      `TN_SHADOW_GPU_KEYS levels=${String(renders.size)} drawn=${String(drawnTotal)} ` +
        `saved=${String(saved)} placements=${String(placements.length)}`,
    );
    world.dispose();
  });
});
