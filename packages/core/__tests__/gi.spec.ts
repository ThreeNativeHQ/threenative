import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from "three";
import { context, metalness, mrt, output, pass, roughness } from "three/tsl";
import { WGSLNodeBuilder } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { attachGBuffer, createGBuffer } from "../src/gi/gbuffer.js";
import { SurfelHashGrid } from "../src/gi/hash-grid.js";
import { SurfelGI } from "../src/gi/index.js";
import { SurfelIntegrator } from "../src/gi/integrate.js";
import { SurfelPool } from "../src/gi/surfel-pool.js";
import { GPUSceneBVH } from "../src/gpu-scene-bvh.js";
import type { IRendererLike } from "../src/renderer.js";

function containsNode(root: unknown, target: object, seen = new Set<object>()): boolean {
  if (root === target) return true;
  if (typeof root !== "object" || root === null || seen.has(root)) return false;
  seen.add(root);
  return Object.values(root).some((value) => containsNode(value, target, seen));
}

function renderer(dispatched: unknown[], readbackBytes = new ArrayBuffer(0)): IRendererLike {
  const canvas = new EventTarget() as HTMLCanvasElement;
  return {
    compileAsync: async () => undefined,
    compute: (node) => dispatched.push(node),
    dispose: () => undefined,
    domElement: canvas,
    info: {},
    kind: "webgpu",
    raw: {},
    render: () => undefined,
    readback: async () => readbackBytes,
    renderOverlay: () => undefined,
    setOutputNode: () => undefined,
    setSize: () => undefined,
    gpuFrameMs: () => undefined,
    resolveGpuFrame: () => undefined,
    setResolutionScale: () => undefined,
    surface: () => ({
      atFloor: false,
      drawingBufferHeight: 720,
      drawingBufferWidth: 1280,
      resolutionScale: 1,
      sampleCount: 1,
      scaleSource: "pinned" as const,
    }),
  };
}

function computeShader(computeNode: object): string {
  const builder = new WGSLNodeBuilder(
    computeNode as never,
    {
      contextNode: context(),
      hasFeature: () => false,
      library: { fromMaterial: () => null },
    } as never,
  ) as unknown as { build(): void; computeShader?: string };
  builder.build();
  return builder.computeShader ?? "";
}

describe("GBuffer", () => {
  it("exposes depth, normal, and albedo nodes only when constructed", () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const gbuffer = createGBuffer(scene, camera);

    expect(gbuffer.pass.getMRT()).not.toBeNull();
    expect(gbuffer.depth.isNode).toBe(true);
    expect(gbuffer.normal.isNode).toBe(true);
    expect(gbuffer.albedo.isNode).toBe(true);
    expect(gbuffer.viewZ.isNode).toBe(true);
  });

  it("keeps GI albedo separate from an existing SSR metalness attachment", () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, metalness, roughness }));
    const metalnessTexture = scenePass.getTextureNode("metalness");
    const gbuffer = attachGBuffer(scenePass);

    expect(gbuffer.albedo.value.name).toBe("albedo");
    expect(gbuffer.albedo.value).not.toBe(metalnessTexture.value);
    expect(gbuffer.pass.getTextureNode("metalness").value.name).toBe("metalness");
    expect(gbuffer.pass.getMRT()?.has("albedo")).toBe(true);
    expect(gbuffer.pass.getMRT()?.has("metalness")).toBe(true);
  });
});

describe("SurfelPool and SurfelHashGrid", () => {
  it("keeps allocation bounded, ages entries, and evicts the oldest entry", () => {
    const pool = new SurfelPool({ capacity: 2, maxAge: 2 });
    const first = pool.allocate({ position: [0, 0, 0], normal: [0, 1, 0] });
    const second = pool.allocate({ position: [1, 0, 0], normal: [0, 1, 0] });

    expect(first).toBe(0);
    expect(second).toBe(1);
    expect(pool.liveCount).toBe(2);
    pool.advanceAge(2);
    expect(pool.liveCount).toBe(0);

    pool.allocate({ position: [2, 0, 0], normal: [0, 1, 0] });
    pool.allocate({ position: [3, 0, 0], normal: [0, 1, 0] });
    const replacement = pool.allocate({ position: [4, 0, 0], normal: [0, 1, 0] });

    expect(replacement).toBe(0);
    expect(pool.liveCount).toBe(2);
    expect(pool.evictionCount).toBe(1);
    expect(pool.capacity).toBe(2);
  });

  it("uses fixed hash storage and reports overflow instead of growing", () => {
    const pool = new SurfelPool({ capacity: 4, maxAge: 10 });
    for (let index = 0; index < 4; index += 1) {
      pool.allocate({ position: [index * 0.01, 0, 0], normal: [0, 1, 0] });
    }
    const grid = new SurfelHashGrid({ cellCount: 1, cellSize: 1, maxEntriesPerCell: 2 });
    grid.rebuild(pool);

    expect(grid.entries.value.array.length).toBe(2);
    expect(grid.overflowCount).toBe(2);
    expect(grid.query(new Vector3(0, 0, 0))).toHaveLength(2);
  });

  it("does not CPU-upload GPU-owned flags while a surfel ages", () => {
    const pool = new SurfelPool({ capacity: 1, maxAge: 4 });
    pool.allocate({ position: [0, 0, 0], normal: [0, 1, 0] });
    const flagVersion = pool.flags.value.version;
    const ageVersion = pool.ages.value.version;
    const activeVersion = pool.active.value.version;

    pool.advanceAge(1);

    expect(pool.flags.value.version).toBe(flagVersion);
    expect(pool.ages.value.version).toBe(ageVersion + 1);
    expect(pool.active.value.version).toBe(activeVersion);
  });

  it("uploads residency changes, but never CPU-clears GPU flags, when a surfel expires", () => {
    const pool = new SurfelPool({ capacity: 1, maxAge: 1 });
    pool.allocate({ position: [0, 0, 0], normal: [0, 1, 0] });
    const flagVersion = pool.flags.value.version;
    const activeVersion = pool.active.value.version;

    pool.advanceAge(1);

    expect(pool.liveCount).toBe(0);
    expect(pool.flags.value.version).toBe(flagVersion);
    expect(pool.active.value.version).toBe(activeVersion + 1);
  });
});

describe("SurfelGI", () => {
  it("binds its indirect node to a game-owned GBuffer pass", () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const gbuffer = createGBuffer(scene, camera);
    const gi = new SurfelGI({
      hashCellCount: 8,
      hashCellSize: 1,
      maxAge: 30,
      rayBudget: 4,
      sampleRadius: 0.05,
      surfelBudget: 4,
      updateCadence: 2,
    });

    gi.attachGBuffer(gbuffer.pass);

    expect(gi.indirectLight.isNode).toBe(true);
    expect(gbuffer.pass.getTextureNode("albedo").isNode).toBe(true);
    gi.detach();
  });

  it("reads the integrated surfel radiance instead of a global hit fraction", () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    const sceneBvh = new GPUSceneBVH(scene);
    const gbuffer = createGBuffer(scene, camera);
    const gi = new SurfelGI({
      hashCellCount: 8,
      hashCellSize: 1,
      maxAge: 30,
      rayBudget: 4,
      sampleRadius: 0.05,
      sceneBvh,
      surfelBudget: 4,
      updateCadence: 2,
    });

    gi.attachGBuffer(gbuffer.pass);

    const radiance = (gi.pool as unknown as { readonly radiance?: object }).radiance;
    expect(radiance).toBeDefined();
    if (radiance !== undefined) {
      expect(containsNode(gi.indirectLight, radiance)).toBe(true);
    }
    expect(containsNode(gi.indirectLight, gi.pool.flags)).toBe(false);
    gi.detach();
    sceneBvh.detach();
  });

  it("reports only GPU-read integrated radiance through the game-owned albedo", async () => {
    const gi = new SurfelGI({
      hashCellCount: 8,
      hashCellSize: 1,
      maxAge: 30,
      rayBudget: 2,
      readbackEveryFrames: 1,
      sampleRadius: 0.05,
      surfelBudget: 2,
      updateCadence: 2,
    });
    gi.pool.allocate({ position: [0, 0, 0], normal: [0, 1, 0] });
    const gpu = renderer([], new Float32Array([0.25, 0, 0, 1, 0.5, 0, 0, 1]).buffer);

    gi.attachRenderer(gpu);
    gi.process(gpu);
    await Promise.resolve();

    expect(gi.sampleIndirectLight(0.4)).toBeCloseTo(0.05);
    gi.detach();
  });

  it("guards BVH integration behind the pool's active-lane state", () => {
    const pool = new SurfelPool({ capacity: 4, maxAge: 30 });
    const grid = new SurfelHashGrid({ cellCount: 8, cellSize: 1, maxEntriesPerCell: 1 });
    const scene = new Scene();
    const sceneBvh = new GPUSceneBVH(scene);
    const integrator = new SurfelIntegrator(pool, grid, { bvh: sceneBvh, rayBudget: 4 });

    const shader = computeShader(integrator.computeNode);
    const activeGuard = shader.match(/if \( \( [^\n]+ > 0u \) \) \{/);
    expect(activeGuard).not.toBeNull();
    const guardOffset = shader.indexOf(activeGuard?.[0] ?? "");
    expect(
      shader.indexOf("surfelSceneRadiance", guardOffset + (activeGuard?.[0].length ?? 0)),
    ).toBeGreaterThan(guardOffset);

    integrator.release();
    pool.release();
    grid.release();
    sceneBvh.detach();
  });

  it("dispatches its integration node and releases every owned buffer", () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    scene.add(mesh);
    const gi = new SurfelGI({
      camera,
      hashCellCount: 8,
      hashCellSize: 1,
      maxAge: 30,
      rayBudget: 4,
      scene,
      sampleRadius: 0.05,
      surfelBudget: 4,
      updateCadence: 2,
    });
    const dispatched: unknown[] = [];
    const gpu = renderer(dispatched);
    const poolDisposals = [
      vi.spyOn(gi.pool.positions.value, "dispose"),
      vi.spyOn(gi.pool.normals.value, "dispose"),
      vi.spyOn(gi.pool.ages.value, "dispose"),
      vi.spyOn(gi.pool.flags.value, "dispose"),
      vi.spyOn(gi.pool.active.value, "dispose"),
      vi.spyOn(gi.pool.radiance.value, "dispose"),
      vi.spyOn(gi.grid.cellCounts.value, "dispose"),
      vi.spyOn(gi.grid.entries.value, "dispose"),
    ];

    expect(gi.processCadence).toBe("fixed");
    expect(gi.requiresGBuffer).toBe(true);
    expect(gi.indirectLight.isNode).toBe(true);
    gi.attachRenderer(gpu);
    gi.process(gpu);
    gi.process(gpu);
    expect(dispatched).toHaveLength(2);
    gi.detach();
    expect(gi.released).toBe(true);
    for (const dispose of poolDisposals) expect(dispose).toHaveBeenCalledOnce();
  });

  it("releases fixed storage when the owning scene removes it", () => {
    const scene = new Scene();
    const gi = new SurfelGI({
      hashCellCount: 8,
      hashCellSize: 1,
      maxAge: 30,
      rayBudget: 4,
      sampleRadius: 0.05,
      surfelBudget: 4,
      updateCadence: 2,
    });
    const poolBytes = gi.pool.positions.value.array.byteLength;
    const gridEntries = gi.grid.entries.value.array.length;

    scene.add(gi);
    scene.remove(gi);

    expect(gi.released).toBe(true);
    expect(gi.pool.positions.value.array.byteLength).toBe(poolBytes);
    expect(gi.grid.entries.value.array.length).toBe(gridEntries);
    expect(gi.pool.liveCount).toBe(0);
  });
});
