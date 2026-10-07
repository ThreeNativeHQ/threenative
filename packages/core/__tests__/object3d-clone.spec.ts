import { readFileSync } from "node:fs";
import {
  Box3,
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Scene,
  Vector3,
} from "three";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import { Fn } from "three/tsl";
import { MeshBasicNodeMaterial, type NodeBuilder, SpriteNodeMaterial } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { Atmosphere } from "../src/atmosphere/index.js";
import { ClusteredBatch, ClusteredBatchRoot } from "../src/clustered-batch.js";
import { ClusteredMesh, type IClusterTable } from "../src/clustered-mesh.js";
import { FluidField2D } from "../src/fluid-field.js";
import { FluidParticles3D } from "../src/fluid-particles.js";
import { GPUSceneBVH } from "../src/gpu-scene-bvh.js";
import { SpectralOcean } from "../src/ocean/spectral.js";
import { GPUParticles3D } from "../src/particles.js";
import { Daylight } from "../src/render/daylight.js";
import { ProbeVolume } from "../src/render/probe-volume.js";
import { VirtualShadowNode } from "../src/render/virtual-shadow.js";
import type { IRendererLike } from "../src/renderer.js";
import { SoftBody3D } from "../src/softbody.js";
import { Heightfield, TerrainTiles, WorldCells } from "../src/world.js";

const table: IClusterTable = {
  bounds: new Float32Array([0, 0, 0, 2]),
  cones: new Float32Array([0, 0, 1, -1]),
  errors: new Float32Array([0, 3.4e38]),
  indices: new Uint32Array([0, 1, 2]),
  parentSpheres: new Float32Array([0, 0, 0, 2]),
  sourceSpheres: new Float32Array([0, 0, 0, 2]),
  ranges: new Uint32Array([0, 3]),
};

// Every required-argument Object3D subclass in core; physics and UI have none.
const factories = [
  () =>
    new FluidField2D({
      resolution: 4,
      viscosity: 0.12,
      pressureIterations: 3,
      maxSplats: 2,
      timeStep: 1 / 30,
      vorticity: 0.3,
      splatRadius: 0.1,
    }),
  () =>
    new FluidParticles3D({
      capacity: 2,
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      spacing: 0.25,
      readbackEvery: 3,
    }),
  () =>
    new GPUParticles3D({
      amount: 3,
      material: new SpriteNodeMaterial(),
      start: () => Fn(() => {})().compute(3),
      process: () => Fn(() => {})().compute(3),
    }),
  () =>
    new Heightfield({
      columns: 2,
      rows: 2,
      width: 2,
      depth: 2,
      origin: { x: 0, z: 0 },
      heights: new Float32Array([1, 2, 3, 4]),
      flow: new Float32Array([4, 3, 2, 1]),
      moisture: new Float32Array([0.1, 0.2, 0.3, 0.4]),
    }),
  () =>
    new TerrainTiles({
      tileSize: 2,
      tileResolution: 3,
      residentTileBudget: 1,
      residentByteBudget: 100000,
      streamRadius: 0,
      lodFactors: [1],
      lodDistances: [],
      sampleHeight: () => 2,
      surface: new MeshBasicMaterial(),
      mergeTiles: false,
    }),
  () =>
    new Atmosphere({
      rayleigh: [0.0058, 0.0135, 0.0331],
      mie: [0.004, 0.004, 0.004],
      ozone: [0.00065, 0.00188, 0.000085],
      planetRadius: 6360,
      atmosphereRadius: 6460,
    }),
  () =>
    new SpectralOcean({
      resolution: 4,
      cascades: [{ patchSize: 200 }, { patchSize: 40 }],
      windSpeed: 12,
      windDirection: 0.6,
      gravity: 9.81,
      amplitude: 0.0004,
      directionality: 2,
      choppiness: 1.1,
      smallWaveCutoff: 0.4,
      seed: 1234,
      readbackResolution: 2,
      readbackEveryFrames: 3,
    }),
  () => new GPUSceneBVH(new Scene().add(new Mesh(new PlaneGeometry(), new MeshBasicMaterial()))),
  () =>
    new ProbeVolume({
      bounds: new Box3(new Vector3(), new Vector3(2, 2, 2)),
      density: 1,
      report: () => {},
    }),
  () =>
    new Daylight({
      follow: new Object3D(),
      exposure: 1,
      fill: { ground: new Color(0x555555), sky: new Color(0xaaaaaa), intensity: 2 },
      haze: { color: new Color(0x888888), density: 0.01 },
      shadowExtents: [24, 96],
      sky: { turbidity: 3, rayleigh: 1.4, mieCoefficient: 0.004, mieDirectionalG: 0.8 },
      skySize: 1600,
      sunColor: new Color(1, 0.93, 0.82),
      sunDirection: new Vector3(-0.5, 0.6, 0.6),
      sunIntensity: 4,
    }),
  () =>
    new ClusteredMesh(new PlaneGeometry(), new MeshBasicMaterial(), table, {
      errorPixels: 2,
      recutDistance: 0.1,
    }),
  () =>
    new ClusteredBatchRoot(
      new ClusteredBatch({
        geometry: new PlaneGeometry(),
        material: new MeshBasicMaterial(),
        table,
      }),
    ),
  () => {
    const node = new VirtualShadowNode(new DirectionalLight(), { clipExtents: [8], marker: false });
    node.setup({
      context: {},
      material: {},
      renderer: { shadowMap: { enabled: true } },
    } as unknown as NodeBuilder);
    const light = node.levelLights[0];
    if (!light) throw new Error("No LevelLight was constructed");
    return light;
  },
];

describe("Object3D subclass cloning", () => {
  it("clones SoftBody3D with its parameters and fresh simulation resources", () => {
    const collisionBuffers: Float32Array[] = [];
    const source = new SoftBody3D(new Mesh(new PlaneGeometry(2, 3), new MeshBasicNodeMaterial()), {
      pinned: [0, 1],
      stiffness: 35,
      damping: 1.8,
      gravity: [0, -9.81, 0],
      wind: [1.5, 0, 0.4],
      timeStep: 1 / 30,
      readbackEveryFrames: 2,
      collision: {
        capacity: 1,
        writeBoxes: (target) => {
          collisionBuffers.push(target);
          return 0;
        },
      },
    });
    source.position.set(1, 2, 3);
    source.add(new Object3D());
    const renderer = {
      kind: "webgpu",
      compute: vi.fn(),
      readback: async () => new ArrayBuffer(64),
    } as unknown as IRendererLike;
    source.attachRenderer(renderer);
    source.process();
    const copy = source.clone();
    expect(copy).toBeInstanceOf(SoftBody3D);
    expect(copy.position).toEqual(source.position);
    expect(copy.geometry).toBe(source.geometry);
    expect(copy.material).not.toBe(source.material);
    expect(copy.material.positionNode).not.toBe(source.material.positionNode);
    expect(copy.warmupNodes[0]).not.toBe(source.warmupNodes[0]);
    expect(copy.steps).toBe(0);
    expect(source.steps).toBe(1);
    expect(() => copy.process()).toThrow("not attached");
    copy.process(renderer);
    expect(collisionBuffers[1]).not.toBe(collisionBuffers[0]);
    expect(copy.debug().readbackStats).toBeDefined();
    for (const key of [
      "stiffness",
      "damping",
      "timeStep",
      "uniqueVertexCount",
      "springCount",
    ] as const)
      expect(copy[key]).toBe(source[key]);
    expect(copy.gravity).toEqual(source.gravity);
    expect(copy.gravity).not.toBe(source.gravity);
    expect(copy.wind).toEqual(source.wind);
    expect(copy.wind).not.toBe(source.wind);
    expect(copy.children).toHaveLength(1);
    expect(copy.children[0]).not.toBe(source.children[0]);
    expect(source.clone(false).children).toHaveLength(0);
    const scene = new Scene();
    scene.add(source);
    expect(scene.clone().children[0]).toBeInstanceOf(SoftBody3D);
    // The starter capture's page uses SkeletonUtils.clone, which starts with Scene.clone.
    expect(skeletonClone(scene).children[0]).toBeInstanceOf(SoftBody3D);
    copy.detach();
    expect(source.released).toBe(false);
  });

  it.each(factories.map((factory) => [factory().constructor.name, factory] as const))(
    "clones %s with state and independent runtime resources",
    (_name, factory) => {
      const source = factory();
      source.position.set(1, 2, 3);
      const child = new Object3D();
      child.name = "authored-child";
      source.add(child);
      if (source instanceof FluidParticles3D) source.viscosity = 0.2;
      if (source instanceof GPUParticles3D) source.emitting = false;
      if (source instanceof Atmosphere)
        source.setAtmosphere({ planetRadius: 6350 }).setSunDirection(new Vector3(1, 1, 0));
      if (source instanceof Daylight) source.sky.turbidity.value = 5;
      if (source instanceof TerrainTiles) source.follow(new Vector3());
      const copy = source.clone();
      expect(copy).toBeInstanceOf(source.constructor);
      expect(copy.position).toEqual(source.position);
      expect(copy.position).not.toBe(source.position);
      expect(copy.getObjectByName(child.name)).not.toBe(child);
      expect(copy.getObjectByName(child.name)).toBeDefined();
      expect(source.clone(false).getObjectByName(child.name)).toBeUndefined();
      if (source instanceof FluidField2D && copy instanceof FluidField2D) {
        for (const key of [
          "resolution",
          "viscosity",
          "pressureIterations",
          "maxSplats",
          "timeStep",
          "vorticity",
          "splatRadius",
        ] as const)
          expect(copy[key]).toBe(source[key]);
        expect(copy.velocity).not.toBe(source.velocity);
        expect(copy.dye).not.toBe(source.dye);
        expect(copy.warmupNodes[0]).not.toBe(source.warmupNodes[0]);
      } else if (source instanceof FluidParticles3D && copy instanceof FluidParticles3D) {
        expect(copy.capacity).toBe(source.capacity);
        expect(copy.viscosity).toBe(source.viscosity);
        expect(copy.bounds).toEqual(source.bounds);
        expect(copy.bounds.min).not.toBe(source.bounds.min);
        expect(copy.positions.value).not.toBe(source.positions.value);
        expect(copy.velocities.value).not.toBe(source.velocities.value);
        expect(copy.density).not.toBe(source.density);
      } else if (source instanceof GPUParticles3D && copy instanceof GPUParticles3D) {
        expect(copy.amount).toBe(source.amount);
        expect(copy.emitting).toBe(false);
        expect(copy.material).not.toBe(source.material);
        expect(copy.material.positionNode).not.toBe(source.material.positionNode);
        expect(copy.buffers.positions.value).not.toBe(source.buffers.positions.value);
        expect(copy.warmupNodes[0]).not.toBe(source.warmupNodes[0]);
      } else if (source instanceof Heightfield && copy instanceof Heightfield) {
        expect(copy.heights).toEqual(source.heights);
        expect(copy.flow).toEqual(source.flow);
        expect(copy.sample("moisture", 0, 0)).toBe(source.sample("moisture", 0, 0));
        expect(copy.origin).not.toBe(source.origin);
        copy.updateHeights({
          column: 0,
          row: 0,
          columns: 2,
          rows: 2,
          heights: new Float32Array([9, 9, 9, 9]),
        });
        expect(source.heights[0]).toBe(1);
      } else if (source instanceof TerrainTiles && copy instanceof TerrainTiles) {
        expect(copy.tileSize).toBe(source.tileSize);
        expect(copy.residentTileCount).toBe(0);
        expect(copy.children).toHaveLength(source.children.length);
        copy.follow(new Vector3());
        expect(copy.getTile("0:0")?.field).not.toBe(source.getTile("0:0")?.field);
        expect(copy.getTile("0:0")?.field.heights).toEqual(source.getTile("0:0")?.field.heights);
      } else if (source instanceof Atmosphere && copy instanceof Atmosphere) {
        expect(copy.parameters).toEqual(source.parameters);
        expect(copy.luts.resolutions).toEqual(source.luts.resolutions);
        expect(copy.luts.transmittance).not.toBe(source.luts.transmittance);
        expect(copy.getSunDirection(new Vector3())).toEqual(source.getSunDirection(new Vector3()));
      } else if (source instanceof SpectralOcean && copy instanceof SpectralOcean) {
        expect(copy.cascades).toEqual(source.cascades);
        expect(copy.cascades[0]).not.toBe(source.cascades[0]);
        expect(copy.resolution).toBe(source.resolution);
        expect(copy.readbackFloats).toBe(source.readbackFloats);
        expect(copy.warmupNodes[0]).not.toBe(source.warmupNodes[0]);
      } else if (source instanceof GPUSceneBVH && copy instanceof GPUSceneBVH) {
        expect(copy.triangleCount).toBe(source.triangleCount);
        expect(copy.positions.value).not.toBe(source.positions.value);
        expect(copy.indices.value).not.toBe(source.indices.value);
      } else if (source instanceof ProbeVolume && copy instanceof ProbeVolume) {
        expect(copy.boundingBox).toEqual(source.boundingBox);
        expect(copy.resolution).toEqual(source.resolution);
        expect(copy.texture).not.toBe(source.texture);
        expect(copy.atlasData).not.toBe(source.atlasData);
        expect(copy.observation.status).toBe("unbaked");
      } else if (source instanceof Daylight && copy instanceof Daylight) {
        expect(copy.children).toHaveLength(source.children.length);
        expect(copy.sun.color).toEqual(source.sun.color);
        expect(copy.sun.shadow.shadowNode).not.toBe(source.sun.shadow.shadowNode);
        expect(copy.sky.turbidity.value).toBe(5);
        expect(copy.sky.material).not.toBe(source.sky.material);
        expect(copy.sky.turbidity).not.toBe(source.sky.turbidity);
        expect(copy.children).toContain(copy.sun.target);
        expect(copy.haze).not.toBe(source.haze);
      } else if (source instanceof ClusteredMesh && copy instanceof ClusteredMesh) {
        expect(copy.table).toBe(source.table);
        expect(copy.errorPixels).toBe(source.errorPixels);
        expect(copy.geometry.index).not.toBe(source.geometry.index);
      } else if (source instanceof ClusteredBatchRoot && copy instanceof ClusteredBatchRoot) {
        expect(copy.batch).toBe(source.batch); // The existing documented batch sharing contract.
      } else {
        const light = source as Object3D & { shadow: DirectionalLight["shadow"]; target: Object3D };
        const lightCopy = copy as typeof light;
        expect(lightCopy.shadow).not.toBe(light.shadow);
        expect(lightCopy.shadow.mapSize).toEqual(light.shadow.mapSize);
        expect(lightCopy.target).not.toBe(light.target);
      }
      const scene = new Scene().add(source);
      expect(scene.clone().children[0]).toBeInstanceOf(source.constructor);
      expect(skeletonClone(scene).children[0]).toBeInstanceOf(source.constructor);
    },
  );

  it("clones a mixed scene through the capture's CPU clone path", () => {
    const scene = new Scene().add(...factories.map((factory) => factory()));
    const constructors = scene.children.map((child) => child.constructor);
    expect(scene.clone().children.map((child) => child.constructor)).toEqual(constructors);
    expect(skeletonClone(scene).children.map((child) => child.constructor)).toEqual(constructors);
  });

  it("clones WorldCells with fresh streaming ownership and authored children", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const file = String(input).replace(/^.*\/world\//u, "");
      try {
        const bytes = readFileSync(new URL(`./fixtures/world-v1/${file}`, import.meta.url));
        return new Response(bytes);
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    try {
      const source = await WorldCells.load({
        url: "/world/world.json",
        follow: new Object3D(),
        surface: new MeshBasicMaterial(),
        ring: 0,
        budgets: { bytes: 100000, instances: 10, residentCells: 1 },
      });
      source.add(new Object3D());
      const copy = source.clone();
      expect(copy).toBeInstanceOf(WorldCells);
      expect(copy.stats().residentCells).toBe(0);
      expect(copy.prewarmed).not.toBe(source.prewarmed);
      expect(copy.children).toHaveLength(2);
      expect(copy.children[0]).toBeInstanceOf(TerrainTiles);
      expect(copy.children[0]).not.toBe(source.children[0]);
      expect(copy.children[1]).not.toBe(source.children[1]);
      const scene = new Scene().add(source);
      expect(scene.clone().children[0]).toBeInstanceOf(WorldCells);
      expect(skeletonClone(scene).children[0]).toBeInstanceOf(WorldCells);
      copy.dispose();
      expect(source.released).toBe(false);
      source.dispose();
    } finally {
      fetch.mockRestore();
    }
  });
});
