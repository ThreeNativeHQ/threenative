import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from "three";
import { context, float, metalness, mrt, output, pass, roughness, vec3 } from "three/tsl";
import { WGSLNodeBuilder } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { attachGBuffer, createGBuffer } from "../src/gi/gbuffer.js";
import { SurfelHashGrid } from "../src/gi/hash-grid.js";
import { SurfelGI } from "../src/gi/index.js";
import type { ISurfelGatherInput } from "../src/gi/index.js";
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

function containsNumber(root: unknown, target: number, seen = new Set<object>()): boolean {
  if (typeof root === "number") return Object.is(root, target);
  if (typeof root !== "object" || root === null || seen.has(root)) return false;
  seen.add(root);
  return Object.values(root).some((value) => containsNumber(value, target, seen));
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

function testLighting() {
  return {
    attenuation: () => float(1),
    direction: vec3(0, 1, 0),
    gather: ({ available, sample, sampleDistance }: ISurfelGatherInput) =>
      sample.mul(float(1).add(sampleDistance.mul(0)).add(available.toFloat().mul(0))),
    normalResponse: () => float(1),
    radiance: vec3(0.8, 0.1, 0.05),
    strength: float(1),
  };
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
    expect(gbuffer.worldPosition.isNode).toBe(true);
    expect(gbuffer.pass.getTextureNode("worldPosition").value.name).toBe("worldPosition");
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
    expect(gbuffer.pass.getMRT()?.has("worldPosition")).toBe(true);
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

  it("uses cell controls for CPU lookup and marks rebuilt GPU storage dirty", () => {
    const pool = new SurfelPool({ capacity: 2, maxAge: 10 });
    pool.allocate({ position: [0.1, 0, 0], normal: [0, 1, 0] });
    pool.allocate({ position: [1.1, 0, 0], normal: [0, 1, 0] });
    const grid = new SurfelHashGrid({ cellCount: 4, cellSize: 1, maxEntriesPerCell: 1 });
    const countsVersion = grid.cellCounts.value.version;
    const entriesVersion = grid.entries.value.version;
    const positionsVersion = grid.positions.value.version;

    grid.rebuild(pool);

    expect(grid.cellCounts.value.version).toBeGreaterThan(countsVersion);
    expect(grid.entries.value.version).toBeGreaterThan(entriesVersion);
    expect(grid.positions.value.version).toBeGreaterThan(positionsVersion);
    expect(grid.query(new Vector3(1.1, 0, 0))).toEqual([1]);

    const coarser = new SurfelHashGrid({ cellCount: 4, cellSize: 2, maxEntriesPerCell: 1 });
    coarser.rebuild(pool);
    expect(coarser.query(new Vector3(1.1, 0, 0))).toEqual([0]);
    grid.release();
    coarser.release();
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
  it("rejects a scene without the BVH required for traced indirect light", () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();

    expect(
      () =>
        new SurfelGI({
          camera,
          hashCellCount: 8,
          hashCellSize: 1,
          maxAge: 30,
          rayBudget: 4,
          scene,
          surfelBudget: 4,
          updateCadence: 2,
        }),
    ).toThrow("SurfelGI.sceneBvh is required when scene is provided.");
  });

  it("rejects a BVH built from a different scene", () => {
    const sceneA = new Scene();
    const sceneB = new Scene();
    const sceneBvh = new GPUSceneBVH(sceneB);

    try {
      expect(
        () =>
          new SurfelGI({
            hashCellCount: 8,
            hashCellSize: 1,
            lighting: testLighting(),
            maxAge: 30,
            rayBudget: 4,
            scene: sceneA,
            sceneBvh,
            surfelBudget: 4,
            updateCadence: 2,
          }),
      ).toThrow("SurfelGI.sceneBvh must be built from the provided scene.");
    } finally {
      sceneBvh.detach();
    }
  });

  it("binds its indirect node to a game-owned GBuffer pass", () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const gbuffer = createGBuffer(scene, camera);
    const gi = new SurfelGI({
      hashCellCount: 8,
      hashCellSize: 1,
      maxAge: 30,
      rayBudget: 4,
      surfelBudget: 4,
      updateCadence: 2,
    });

    gi.attachGBuffer(gbuffer.pass);

    expect(gi.indirectLight.isNode).toBe(true);
    expect(gbuffer.pass.getTextureNode("albedo").isNode).toBe(true);
    gi.detach();
  });

  it("lets the game gather response change the live indirect node", () => {
    const create = (value: number) => {
      const scene = new Scene();
      scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
      const sceneBvh = new GPUSceneBVH(scene);
      const gbuffer = createGBuffer(scene, new PerspectiveCamera());
      const gather = vi.fn(() => vec3(value));
      const gi = new SurfelGI({
        hashCellCount: 8,
        hashCellSize: 1,
        lighting: { ...testLighting(), gather },
        maxAge: 30,
        rayBudget: 4,
        sceneBvh,
        surfelBudget: 4,
        updateCadence: 2,
      });
      gi.attachGBuffer(gbuffer.pass);
      return { gather, gi, sceneBvh };
    };

    const first = create(0.25);
    const second = create(0.75);

    expect(first.gather).toHaveBeenCalled();
    expect(second.gather).toHaveBeenCalled();
    expect(containsNumber(first.gi.indirectLight, 0.25)).toBe(true);
    expect(containsNumber(second.gi.indirectLight, 0.75)).toBe(true);

    first.gi.detach();
    first.sceneBvh.detach();
    second.gi.detach();
    second.sceneBvh.detach();
  });

  it("uses spatial hash samples and game-owned lighting input", () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    const sceneBvh = new GPUSceneBVH(scene);
    const gbuffer = createGBuffer(scene, camera);
    const gameOwnedRadiance = vec3(0.8, 0.1, 0.05);
    const gameLighting = { ...testLighting(), radiance: gameOwnedRadiance };
    const gi = new SurfelGI({
      hashCellCount: 8,
      hashCellSize: 1,
      maxAge: 30,
      rayBudget: 4,
      sceneBvh,
      surfelBudget: 4,
      updateCadence: 2,
      lighting: gameLighting,
    });

    gi.attachGBuffer(gbuffer.pass);

    const radiance = (gi.pool as unknown as { readonly radiance?: object }).radiance;
    expect(radiance).toBeDefined();
    expect(containsNode(gi.indirectLight, gi.pool.radiance)).toBe(true);
    expect(containsNode(gi.indirectLight, gi.grid.positions)).toBe(true);
    expect(containsNode(gi.indirectLight, gi.grid.cellCounts)).toBe(true);
    expect(containsNode(gi.indirectLight, gbuffer.pass.getTextureNode("worldPosition").value)).toBe(
      true,
    );
    expect(containsNode(gi.indirectLight, gbuffer.albedo, new Set([gbuffer.pass]))).toBe(false);
    expect(computeShader(gi.integrator.computeNode)).toContain("0.8");
    gi.detach();
    sceneBvh.detach();
  });

  it("reports only GPU-read integrated radiance", async () => {
    const gi = new SurfelGI({
      hashCellCount: 8,
      hashCellSize: 1,
      maxAge: 30,
      rayBudget: 2,
      readbackEveryFrames: 1,
      surfelBudget: 2,
      updateCadence: 2,
    });
    gi.pool.allocate({ position: [0, 0, 0], normal: [0, 1, 0] });
    const gpu = renderer([], new Float32Array([0.25, 0, 0, 1, 0.5, 0, 0, 1]).buffer);

    gi.attachRenderer(gpu);
    gi.process(gpu);
    await Promise.resolve();

    expect(gi.sampleIndirectLight()).toBeCloseTo(0.25);
    gi.detach();
  });

  it("refreshes BVH-backed surfels after their maximum age", () => {
    const scene = new Scene();
    scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    const sceneBvh = new GPUSceneBVH(scene);
    const gi = new SurfelGI({
      hashCellCount: 8,
      hashCellSize: 1,
      maxAge: 2,
      lighting: testLighting(),
      rayBudget: 4,
      sceneBvh,
      surfelBudget: 4,
      updateCadence: 2,
    });
    const gpu = renderer([]);
    const initialAllocations = gi.pool.allocationCount;

    gi.attachRenderer(gpu);
    for (let frame = 0; frame < 5; frame += 1) gi.process(gpu);

    expect(gi.pool.liveCount).toBeGreaterThan(0);
    expect(gi.pool.allocationCount).toBeGreaterThan(initialAllocations);
    gi.detach();
    sceneBvh.detach();
  });

  it("dispatches refreshed lanes before a later cadence can expose stale GPU results", () => {
    const scene = new Scene();
    scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    const sceneBvh = new GPUSceneBVH(scene);
    const gi = new SurfelGI({
      hashCellCount: 8,
      hashCellSize: 1,
      maxAge: 2,
      lighting: testLighting(),
      rayBudget: 4,
      sceneBvh,
      surfelBudget: 4,
      updateCadence: 3,
    });
    const dispatched: unknown[] = [];
    const gpu = renderer(dispatched);

    gi.attachRenderer(gpu);
    gi.process(gpu);
    gi.process(gpu);

    expect(gi.pool.allocationCount).toBeGreaterThan(4);
    expect(dispatched).toHaveLength(2);
    gi.detach();
    sceneBvh.detach();
  });

  it("guards BVH integration behind the pool's active-lane state", () => {
    const pool = new SurfelPool({ capacity: 4, maxAge: 30 });
    const grid = new SurfelHashGrid({ cellCount: 8, cellSize: 1, maxEntriesPerCell: 2 });
    const scene = new Scene();
    const sceneBvh = new GPUSceneBVH(scene);
    const integrator = new SurfelIntegrator(pool, grid, {
      bvh: sceneBvh,
      lighting: testLighting(),
      rayBudget: 4,
    });

    const shader = computeShader(integrator.computeNode);
    const activeGuard = shader.match(/if \( \( [^\n]+ > 0u \) \) \{/);
    expect(activeGuard).not.toBeNull();
    const guardOffset = shader.indexOf(activeGuard?.[0] ?? "");
    expect(
      shader.indexOf("surfelSceneHit", guardOffset + (activeGuard?.[0].length ?? 0)),
    ).toBeGreaterThan(guardOffset);
    expect(shader).toMatch(
      /NodeBuffer_\d+\.value\[ \( nodeVar\d+ \/ 2u \) \] > \( nodeVar\d+ % 2u \)/u,
    );

    integrator.release();
    pool.release();
    grid.release();
    sceneBvh.detach();
  });

  it("does not clear surfel zero when an empty hash slot reuses its sentinel", () => {
    const pool = new SurfelPool({ capacity: 2, maxAge: 30 });
    const surfelZero = pool.allocate({ position: [0.1, 0, 0], normal: [0, 1, 0] });
    const grid = new SurfelHashGrid({ cellCount: 1, cellSize: 1, maxEntriesPerCell: 2 });
    grid.rebuild(pool);
    expect(surfelZero).toBe(0);
    expect(grid.cellCounts.value.array[0]).toBe(1);
    expect(grid.entries.value.array[0]).toBe(0);
    expect(grid.entries.value.array[1]).toBe(0);

    const sceneBvh = new GPUSceneBVH(new Scene());
    const integrator = new SurfelIntegrator(pool, grid, {
      bvh: sceneBvh,
      lighting: testLighting(),
      rayBudget: 2,
    });
    const shader = computeShader(integrator.computeNode);
    const slotExpression = shader.search(/nodeVar\d+ % 2u/u);
    expect(slotExpression).toBeGreaterThan(-1);
    const openBrace = shader.indexOf("{", slotExpression);
    expect(openBrace).toBeGreaterThan(slotExpression);
    let depth = 0;
    let siblingElse = false;
    for (let index = openBrace; index < shader.length; index += 1) {
      const character = shader[index];
      if (character === "{") depth += 1;
      if (character !== "}") continue;
      depth -= 1;
      if (depth !== 0) continue;
      siblingElse = /^\s*else\s*\{/u.test(shader.slice(index + 1));
      break;
    }
    expect(siblingElse).toBe(false);

    integrator.release();
    pool.release();
    grid.release();
    sceneBvh.detach();
  });

  it("advances hash-entry coverage across budgeted dispatches", () => {
    const pool = new SurfelPool({ capacity: 8, maxAge: 30 });
    const grid = new SurfelHashGrid({ cellCount: 4, cellSize: 1, maxEntriesPerCell: 2 });
    const sceneBvh = new GPUSceneBVH(new Scene());
    const integrator = new SurfelIntegrator(pool, grid, {
      bvh: sceneBvh,
      lighting: testLighting(),
      rayBudget: 2,
    });
    const dispatched: unknown[] = [];
    const gpu = renderer(dispatched);
    const nextOffset = (): number =>
      (integrator as unknown as { nextDispatchOffset: number }).nextDispatchOffset;

    expect(integrator.dispatchCount).toBe(2);
    expect(nextOffset()).toBe(0);
    integrator.dispatch(gpu);
    expect(nextOffset()).toBe(2);
    integrator.dispatch(gpu);
    expect(nextOffset()).toBe(4);
    expect(dispatched).toHaveLength(2);

    integrator.release();
    pool.release();
    grid.release();
    sceneBvh.detach();
  });

  it("writes integrated radiance to the surfel selected by the hash entry", () => {
    const pool = new SurfelPool({ capacity: 4, maxAge: 30 });
    const grid = new SurfelHashGrid({ cellCount: 8, cellSize: 1, maxEntriesPerCell: 2 });
    const scene = new Scene();
    const sceneBvh = new GPUSceneBVH(scene);
    const integrator = new SurfelIntegrator(pool, grid, {
      bvh: sceneBvh,
      lighting: testLighting(),
      rayBudget: 4,
    });

    const shader = computeShader(integrator.computeNode);
    expect(shader).toMatch(
      /NodeBuffer_\d+\.value\[ NodeBuffer_\d+\.value\[ nodeVar\d+ \] \] = vec4<f32>\(/u,
    );

    integrator.release();
    pool.release();
    grid.release();
    sceneBvh.detach();
  });

  it("dispatches its integration node and releases every owned buffer", () => {
    const gi = new SurfelGI({
      hashCellCount: 8,
      hashCellSize: 1,
      maxAge: 30,
      rayBudget: 4,
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
      vi.spyOn(gi.grid.positions.value, "dispose"),
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
