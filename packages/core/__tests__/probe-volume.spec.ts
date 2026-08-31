import { readFileSync } from "node:fs";
import { Box3, Data3DTexture, Scene, Vector3, WebGPUCoordinateSystem } from "three";
import type { Node } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { FrameBudget } from "../src/frame-budget.js";
import {
  ATLAS_PADDING,
  type IProbeVolumeCoefficient,
  PROBE_VOLUME_MARKER,
  ProbeVolume,
  readProbeVolumeObservation,
} from "../src/render/probe-volume.js";
import type { IRendererLike } from "../src/renderer.js";

const bounds = new Box3(new Vector3(0, 0, 0), new Vector3(2, 2, 2));

function coefficient(r: number, g: number, b: number): IProbeVolumeCoefficient[] {
  return Array.from({ length: 9 }, () => ({ r, g, b }));
}

function volume(options: Partial<ConstructorParameters<typeof ProbeVolume>[0]> = {}): ProbeVolume {
  return new ProbeVolume({
    bounds,
    density: 1,
    maxTextureDimension3D: 128,
    ...options,
  });
}

interface ITexture3DNode extends Node {
  readonly isTexture3DNode?: boolean;
  readonly referenceNode?: ITexture3DNode;
  readonly value?: unknown;
}

function samplerTextureDimensions(node: Node): readonly string[] {
  const dimensions = new Set<string>();
  node.traverse((child) => {
    const textureNode = child as ITexture3DNode;
    if (textureNode.isTexture3DNode !== true) return;
    const texture = (textureNode.referenceNode ?? textureNode).value;
    if (texture instanceof Data3DTexture) {
      dimensions.add(`${texture.image.width}x${texture.image.height}x${texture.image.depth}`);
    }
  });
  return [...dimensions];
}

describe("ProbeVolume", () => {
  it("rejects malformed density, bounds, and atlas limits at construction", () => {
    expect(() => volume({ density: 0 })).toThrow(/density/u);
    expect(() => volume({ density: -1 })).toThrow(/density/u);
    expect(
      () =>
        new ProbeVolume({
          bounds: new Box3(new Vector3(2, 0, 0), new Vector3(1, 2, 2)),
          density: 1,
        }),
    ).toThrow(/bounds/u);
    expect(
      () =>
        new ProbeVolume({
          bounds: new Box3(new Vector3(0, 0, 0), new Vector3(2, 2, 0)),
          density: 1,
        }),
    ).toThrow(/bounds/u);
    expect(() => volume({ maxTextureDimension3D: 16 })).toThrow(/maxTextureDimension3D/u);
  });

  it("samples both sides of every packed sub-volume seam through the public sampler", () => {
    const subject = volume({ report: () => undefined });
    expect(subject.probeCount).toBe(27);
    expect(subject.atlasDepth).toBe(7 * (3 + 2 * ATLAS_PADDING));
    expect(subject.atlasBytes).toBe(
      3 * 3 * subject.atlasDepth * 4 * Float32Array.BYTES_PER_ELEMENT,
    );

    const distinctCoefficients = Array.from({ length: 9 }, (_, index) => ({
      b: 40 + index,
      g: 20 + index,
      r: 1 + index,
    }));
    for (let iz = 0; iz < subject.resolution.z; iz += 1) {
      for (let iy = 0; iy < subject.resolution.y; iy += 1) {
        for (let ix = 0; ix < subject.resolution.x; ix += 1) {
          subject.setProbeCoefficients(ix, iy, iz, distinctCoefficients);
        }
      }
    }
    const normal = new Vector3(0, 1, 0);
    const centre = subject.sampleIrradiance(new Vector3(1, 1, 1), normal);
    const lowerSide = subject.sampleIrradiance(new Vector3(1, 1, 0), normal);
    const upperSide = subject.sampleIrradiance(new Vector3(1, 1, 2), normal);

    expect(lowerSide.distanceTo(centre)).toBeLessThan(0.00001);
    expect(upperSide.distanceTo(centre)).toBeLessThan(0.00001);
  });

  it("returns the emissive hue through the numeric probe diagnostic", () => {
    const subject = volume({ report: () => undefined });
    subject.setProbeCoefficients(0, 0, 0, coefficient(0.8, 0.05, 0.02));
    subject.setProbeCoefficients(2, 2, 2, coefficient(0.8, 0.05, 0.02));
    const irradiance = subject.sampleIrradiance(new Vector3(0, 0, 0), new Vector3(0, 1, 0));
    expect(irradiance.x).toBeGreaterThan(irradiance.y * 3);
    expect(irradiance.x).toBeGreaterThan(irradiance.z * 3);
  });

  it("reports an unbaked sample instead of hiding it as black", () => {
    const lines: string[] = [];
    const subject = volume({ report: (line) => lines.push(line) });
    const observation = subject.observation;
    expect(observation.marker).toBe(PROBE_VOLUME_MARKER);
    expect(observation.stale).toBe(true);
    expect(observation.unbaked).toBe(true);
    expect(observation.bakeProgress.completed).toBe(0);
    expect(lines.at(-1)).toMatch(/^TN_PROBE_VOLUME:/u);
  });

  it("rejects marker observations that omit staleness or progress data", () => {
    const subject = volume({ report: () => undefined });
    const observation = subject.observation;

    expect(readProbeVolumeObservation(observation)).toBe(observation);
    expect(
      readProbeVolumeObservation({
        ...observation,
        stalenessFrames: undefined,
      }),
    ).toBeUndefined();
    expect(
      readProbeVolumeObservation({
        ...observation,
        bakeProgress: { ...observation.bakeProgress, completed: Number.NaN },
      }),
    ).toBeUndefined();
  });

  it("rejects status, stale, and unbaked combinations the producer cannot emit", () => {
    const observation = volume({ report: () => undefined }).observation;
    const invalidStates = [
      ["unbaked", true, false],
      ["unbaked", false, true],
      ["unbaked", false, false],
      ["baking", false, false],
      ["baking", false, true],
      ["baking", true, true],
      ["ready", true, false],
      ["ready", false, true],
      ["ready", true, true],
    ] as const;

    for (const [status, stale, unbaked] of invalidStates) {
      expect(
        readProbeVolumeObservation({
          ...observation,
          stale,
          status,
          unbaked,
        }),
      ).toBeUndefined();
    }
  });

  it("rejects an isolated-state contradiction during the first bake pass", () => {
    const observation = volume({ report: () => undefined }).observation;

    expect(
      readProbeVolumeObservation({
        ...observation,
        samplingIsolated: false,
        status: "baking",
        stale: true,
        unbaked: false,
      }),
    ).toBeUndefined();
  });

  it("rejects inconsistent bake progress and pass relationships", () => {
    const observation = volume({ report: () => undefined }).observation;
    const progress = observation.bakeProgress;
    const invalidProgress = [
      { ...progress, fraction: 1 },
      { ...progress, passes: 0 },
      { ...progress, pass: progress.passes },
      { ...progress, total: 0 },
      {
        ...progress,
        completed: 1,
        fraction: 1 / progress.total,
        probesCompleted: 1,
      },
      { ...progress, probesTotal: progress.probesTotal + 1 },
      { ...progress, passes: progress.passes + 1, pass: progress.pass + 1 },
    ];

    for (const bakeProgress of invalidProgress) {
      expect(
        readProbeVolumeObservation({
          ...observation,
          bakeProgress,
        }),
      ).toBeUndefined();
    }
  });

  it("rejects progress that moves backwards across a bake pass", () => {
    const subject = volume({ report: () => undefined });
    void subject.requestBake(new Scene(), { bounces: 1 });
    const observation = subject.observation;
    const progress = observation.bakeProgress;
    const workPerPass = progress.total / progress.passes;
    const movedBackwards = {
      ...progress,
      completed: workPerPass,
      fraction: workPerPass / progress.total,
      pass: 1,
      probesCompleted: 0,
    };

    expect(
      readProbeVolumeObservation({
        ...observation,
        bakeProgress: movedBackwards,
      }),
    ).toBeUndefined();
  });

  it("keeps a large bake incremental across process calls", () => {
    let nowMs = 0;
    const subject = volume({
      bakeBudgetMs: 1,
      maxWorkItemsPerFrame: 1,
      now: () => nowMs,
      report: () => undefined,
    });
    const raw = {
      coordinateSystem: WebGPUCoordinateSystem,
      getRenderTarget: () => null,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      isWebGLRenderer: false,
      copyTextureToTexture: vi.fn(),
      reversedDepthBuffer: false,
      setRenderTarget: vi.fn(),
      render: vi.fn(() => {
        nowMs += 0.25;
      }),
      xr: { enabled: false },
    };
    const renderer = { kind: "webgpu" as const, raw } as unknown as IRendererLike;
    subject.attachRenderer(renderer);
    nowMs = 0;
    void subject.requestBake(new Scene());
    const initialBakeObservation = subject.observation;
    expect(readProbeVolumeObservation(initialBakeObservation)).toBe(initialBakeObservation);
    subject.process(renderer);
    const inProgressObservation = subject.observation;
    expect(readProbeVolumeObservation(inProgressObservation)).toBe(inProgressObservation);
    expect(subject.observation.bakeProgress.completed).toBeLessThan(subject.probeCount);
    expect(subject.observation.bakeProgress.completed).toBeGreaterThan(0);
    subject.process(renderer);
    expect(subject.observation.bakeProgress.completed).toBeGreaterThan(1);
  });

  it("keeps each incremental bake slice inside the registered render budget", () => {
    const bakeBudgetMs = 3;
    let nowMs = 0;
    const subject = volume({
      bakeBudgetMs,
      maxWorkItemsPerFrame: Number.MAX_SAFE_INTEGER,
      now: () => nowMs,
      report: () => undefined,
    });
    const raw = {
      coordinateSystem: WebGPUCoordinateSystem,
      copyTextureToTexture: vi.fn(() => {
        nowMs += 0.25;
      }),
      getRenderTarget: () => null,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      isWebGLRenderer: false,
      reversedDepthBuffer: false,
      setRenderTarget: vi.fn(),
      render: vi.fn(() => {
        nowMs += 1;
      }),
      xr: { enabled: false },
    };
    const renderer = { kind: "webgpu" as const, raw } as unknown as IRendererLike;
    subject.attachRenderer(renderer);
    nowMs = 0;
    const bake = subject.requestBake(new Scene());
    const budget = new FrameBudget({ reportEvery: Number.MAX_SAFE_INTEGER });
    const samples: Array<{ readonly render: number }> = [];
    let timestampMs = 0;
    for (let frame = 0; frame < 100 && subject.observation.status === "baking"; frame += 1) {
      nowMs += 16;
      timestampMs += 16;
      budget.beginFrame(timestampMs, nowMs);
      budget.markSimulationEnd(nowMs, 0);
      const renderStart = nowMs;
      subject.process(renderer);
      budget.addRender(nowMs - renderStart);
      const sample = budget.endFrame(nowMs);
      if (sample !== undefined) samples.push({ render: sample.render });
    }
    void bake;

    expect(subject.observation.status).toBe("ready");
    expect(Math.max(...samples.map((sample) => sample.render))).toBeLessThanOrEqual(bakeBudgetMs);
    expect(samples.length).toBeGreaterThan(1);
  });

  it("fails closed when the first bake work item exceeds its render budget", async () => {
    const bakeBudgetMs = 3;
    let nowMs = 0;
    const subject = volume({
      bakeBudgetMs,
      maxWorkItemsPerFrame: Number.MAX_SAFE_INTEGER,
      now: () => nowMs,
      report: () => undefined,
    });
    const raw = {
      coordinateSystem: WebGPUCoordinateSystem,
      copyTextureToTexture: vi.fn(),
      getRenderTarget: () => null,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      isWebGLRenderer: false,
      reversedDepthBuffer: false,
      setRenderTarget: vi.fn(),
      render: vi.fn(() => {
        nowMs += 4;
      }),
      xr: { enabled: false },
    };
    const renderer = { kind: "webgpu" as const, raw } as unknown as IRendererLike;
    subject.attachRenderer(renderer);
    nowMs = 0;
    const bake = subject.requestBake(new Scene());

    expect(() => subject.process(renderer)).toThrow(/exceeds bakeBudgetMs/u);
    await expect(bake).rejects.toThrow(/exceeds bakeBudgetMs/u);
    expect(subject.observation.status).toBe("unbaked");
  });

  it("fails closed when a later individual work item exceeds its render budget", async () => {
    const bakeBudgetMs = 3;
    let nowMs = 0;
    const renderCosts = [0, 1, 4];
    const subject = volume({
      bakeBudgetMs,
      maxWorkItemsPerFrame: 1,
      now: () => nowMs,
      report: () => undefined,
    });
    const raw = {
      coordinateSystem: WebGPUCoordinateSystem,
      copyTextureToTexture: vi.fn(),
      getRenderTarget: () => null,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      isWebGLRenderer: false,
      reversedDepthBuffer: false,
      setRenderTarget: vi.fn(),
      render: vi.fn(() => {
        nowMs += renderCosts.shift() ?? 0;
      }),
      xr: { enabled: false },
    };
    const renderer = { kind: "webgpu" as const, raw } as unknown as IRendererLike;
    subject.attachRenderer(renderer);
    nowMs = 0;
    const bake = subject.requestBake(new Scene());
    subject.process(renderer);

    expect(subject.observation.status).toBe("baking");
    expect(() => subject.process(renderer)).toThrow(/exceeds bakeBudgetMs/u);
    await expect(bake).rejects.toThrow(/exceeds bakeBudgetMs/u);
    expect(subject.observation.status).toBe("unbaked");
  });

  it("keeps depth testing enabled for cube-camera captures", () => {
    let cubeDepthBuffer: boolean | undefined;
    const subject = volume({ report: () => undefined });
    const raw = {
      coordinateSystem: WebGPUCoordinateSystem,
      copyTextureToTexture: vi.fn(),
      getRenderTarget: () => null,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      isWebGLRenderer: false,
      reversedDepthBuffer: false,
      setRenderTarget: vi.fn((target: unknown) => {
        if (
          typeof target === "object" &&
          target !== null &&
          (target as { readonly isCubeRenderTarget?: boolean }).isCubeRenderTarget === true
        ) {
          cubeDepthBuffer = (target as { readonly depthBuffer?: boolean }).depthBuffer;
        }
      }),
      render: vi.fn(),
      xr: { enabled: false },
    };
    const renderer = { kind: "webgpu" as const, raw } as unknown as IRendererLike;
    subject.attachRenderer(renderer);
    void subject.requestBake(new Scene());
    subject.process(renderer);

    expect(cubeDepthBuffer).toBe(true);
  });

  it("isolates the previous atlas while pass zero removes lighting during a re-bake", async () => {
    const subject = volume({
      bakeBudgetMs: 16,
      maxWorkItemsPerFrame: 3,
      report: () => undefined,
    });
    subject.setProbeCoefficients(0, 0, 0, coefficient(1, 0, 0));
    const samplePosition = new Vector3(0, 0, 0);
    const sampleNormal = new Vector3(0, 1, 0);
    expect(subject.sampleIrradiance(samplePosition, sampleNormal).x).toBeGreaterThan(0);

    const scene = new Scene();
    const samplesDuringCapture: Vector3[] = [];
    const samplerTexturesDuringCapture: string[] = [];
    const sampleNode = subject.sampleNode();
    const raw = {
      coordinateSystem: WebGPUCoordinateSystem,
      copyTextureToTexture: vi.fn(),
      getRenderTarget: () => null,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      isWebGLRenderer: false,
      reversedDepthBuffer: false,
      setRenderTarget: vi.fn(),
      render: vi.fn((renderedScene: Scene) => {
        if (renderedScene === scene) {
          samplesDuringCapture.push(subject.sampleIrradiance(samplePosition, sampleNormal));
          samplerTexturesDuringCapture.push(...samplerTextureDimensions(sampleNode));
        }
      }),
      xr: { enabled: false },
    };
    const renderer = { kind: "webgpu" as const, raw } as unknown as IRendererLike;
    subject.attachRenderer(renderer);
    const bake = subject.requestBake(scene);

    expect(subject.observation).toMatchObject({ samplingIsolated: true });
    const rebakeObservation = subject.observation;
    expect(readProbeVolumeObservation(rebakeObservation)).toBe(rebakeObservation);
    for (let frame = 0; frame < 300 && subject.observation.status === "baking"; frame += 1) {
      subject.process(renderer);
      await Promise.resolve();
    }
    expect(subject.observation).toMatchObject({
      bakeProgress: { completed: subject.totalWork },
      status: "ready",
    });
    await bake;

    expect(samplesDuringCapture.length).toBeGreaterThan(0);
    expect(samplesDuringCapture.every((sample) => sample.lengthSq() === 0)).toBe(true);
    expect(new Set(samplerTexturesDuringCapture)).toEqual(new Set(["1x1x1"]));
    expect(subject.sampleIrradiance(samplePosition, sampleNormal).lengthSq()).toBe(0);
    expect(samplerTextureDimensions(sampleNode)).toEqual(["3x3x35"]);
    expect(subject.observation).toMatchObject({ samplingIsolated: false, status: "ready" });
  });

  it("keeps the port on WebGPU render targets and away from the upstream WebGL class", () => {
    const source = readFileSync(new URL("../src/render/probe-volume.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/WebGL\w*RenderTarget/u);
    expect(source).not.toContain("three/addons/lighting/LightProbeGrid.js");
  });
});
