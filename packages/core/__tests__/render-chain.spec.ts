import { describe, expect, it, vi } from "vitest";
import { type IRenderChainStage, RenderChain } from "../src/render/chain.js";
import type { IRendererLike } from "../src/renderer.js";

function renderer(
  kind: IRendererLike["kind"],
): IRendererLike & { installed: unknown[]; velocityEnabled: { value: boolean } } {
  const installed: unknown[] = [];
  const velocityEnabled = { value: false };
  return {
    clearOutputNode: () => undefined,
    compileAsync: async () => undefined,
    compute: () => undefined,
    dispose: () => undefined,
    domElement: {} as HTMLCanvasElement,
    get info() {
      return {};
    },
    gpuFrameMs: () => undefined,
    installed,
    kind,
    raw: { mrt: new Set<string>() },
    readback: async () => new ArrayBuffer(0),
    render: () => undefined,
    renderOverlay: () => undefined,
    setRenderChainVelocityEnabled: (enabled) => {
      velocityEnabled.value = enabled;
    },
    resolveGpuFrame: () => undefined,
    setOutputNode: (node) => installed.push(node),
    setResolutionScale: () => undefined,
    setSize: () => undefined,
    surface: () => ({
      atFloor: false,
      drawingBufferHeight: 1,
      drawingBufferWidth: 1,
      resolutionScale: 1,
      sampleCount: 1,
      scaleSource: "pinned",
    }),
    velocityEnabled,
  };
}

function stage(name: IRenderChainStage["name"], order: string[]): IRenderChainStage {
  return {
    build: (input) => {
      order.push(name);
      return { input, name };
    },
    name,
  };
}

describe("RenderChain", () => {
  it("drops a stage that cannot run and emits an honest marker", () => {
    const report: string[] = [];
    const chain = new RenderChain(renderer("webgl2"), {
      report: (line) => report.push(line),
      stages: [stage("ssgi", [])],
      request: { stages: ["ssgi"], tier: "high" },
    });

    expect(chain.applied.stages).toEqual([]);
    expect(chain.applied.dropped).toEqual([{ name: "ssgi", reason: "renderer:webgl2" }]);
    expect(report[0]).toMatch(/^TN_RENDER_CHAIN:/u);
  });

  it("uses canonical order and reports the velocity provisioning route", () => {
    const order: string[] = [];
    const current = renderer("webgpu");
    Object.assign(current, { raw: { mrt: new Set(["velocity"]) } });
    const chain = new RenderChain(current, {
      stages: [stage("traa", order), stage("denoise", order), stage("ssgi", order)],
      request: { stages: ["traa", "ssgi", "denoise"], tier: "high" },
    });

    expect(order).toEqual(["ssgi", "denoise", "traa"]);
    expect(chain.applied.velocity).toMatchObject({ provisioned: true, source: "mrt" });
    expect(current.installed).toHaveLength(1);
  });

  it("places godRays between ssgi and ssr, and vignette after bloom, whatever was requested", () => {
    // GodRays add scattered light after the GI/contact terms and before reflections;
    // vignette is a camera-lens darkening applied to the lit frame before the other
    // camera stages. The caller cannot get the order wrong because the order is not
    // theirs to choose.
    const order: string[] = [];
    const chain = new RenderChain(renderer("webgpu"), {
      stages: [
        stage("vignette", order),
        stage("bloom", order),
        stage("godRays", order),
        stage("ssr", order),
        stage("ssgi", order),
      ],
      request: { stages: ["vignette", "bloom", "godRays", "ssr", "ssgi"], tier: "high" },
    });

    expect(order).toEqual(["ssgi", "godRays", "ssr", "bloom", "vignette"]);
    expect(chain.applied.stages).toEqual(["ssgi", "godRays", "ssr", "bloom", "vignette"]);
  });

  it("drops a temporal stage when no velocity source is provisioned", () => {
    const chain = new RenderChain(renderer("webgpu"), {
      stages: [stage("traa", [])],
      request: { stages: ["traa"], tier: "high" },
    });

    expect(chain.applied.stages).toEqual([]);
    expect(chain.applied.dropped[0]?.reason).toBe("velocity:missing");
    expect(chain.applied.velocity).toMatchObject({ provisioned: false, source: null });
  });

  it("turns core-owned per-object history on only for an active temporal stage", () => {
    const current = renderer("webgpu");
    const chain = new RenderChain(current, {
      stages: [stage("traa", [])],
      request: { stages: ["traa"], tier: "high", velocity: { perObject: true } },
    });

    expect(chain.applied.stages).toEqual(["traa"]);
    expect(current.velocityEnabled.value).toBe(true);
    chain.dispose();
    expect(current.velocityEnabled.value).toBe(false);
  });

  it("samples temporal rejection only after a completed frame", () => {
    const current = renderer("webgpu");
    Object.assign(current, { raw: { mrt: new Set(["velocity"]) } });
    const measurement = vi.fn(() => ({ frame: 7, rejectionFraction: 0.12 }));
    const chain = new RenderChain(current, {
      stages: [stage("traa", [])],
      request: {
        stages: ["traa"],
        tier: "high",
        velocity: { rejectionMeasurement: measurement },
      },
    });

    expect(measurement).not.toHaveBeenCalled();
    expect(chain.applied.velocity.rejectionFraction).toBeUndefined();
    chain.observeFrame();
    expect(measurement).toHaveBeenCalledTimes(1);
    expect(chain.applied.velocity).toMatchObject({
      measurementFrame: 7,
      rejectionFraction: 0.12,
    });
  });

  it("rejects a repeated temporal rejection measurement as stale", () => {
    const current = renderer("webgpu");
    Object.assign(current, { raw: { mrt: new Set(["velocity"]) } });
    const chain = new RenderChain(current, {
      stages: [stage("traa", [])],
      request: {
        stages: ["traa"],
        tier: "high",
        velocity: { rejectionMeasurement: () => ({ frame: 2, rejectionFraction: 0.1 }) },
      },
    });

    chain.observeFrame();
    expect(() => chain.observeFrame()).toThrow(/must advance/u);
  });

  it("steps down an automatic tier after an over-budget window but never moves a pinned tier", () => {
    const automatic = new RenderChain(renderer("webgpu"), {
      stages: [stage("ssgi", [])],
      request: { stages: ["ssgi"], tier: "auto" },
      targetFps: 60,
    });
    automatic.observeFrameBudget({ phases: { render: { p95: 30 } } });
    automatic.observeFrameBudget({ phases: { render: { p95: 30 } } });
    expect(automatic.applied.tier).toBe("medium");
    expect(automatic.applied.source).toBe("auto");

    const pinned = new RenderChain(renderer("webgpu"), {
      stages: [stage("ssgi", [])],
      request: { stages: ["ssgi"], tier: "high" },
      targetFps: 60,
    });
    pinned.observeFrameBudget({ phases: { render: { p95: 30 } } });
    pinned.observeFrameBudget({ phases: { render: { p95: 30 } } });
    expect(pinned.applied.tier).toBe("high");
    expect(pinned.applied.source).toBe("pinned");
  });

  it("rejects unknown stages and malformed quality", () => {
    expect(
      () =>
        new RenderChain(renderer("webgpu"), {
          request: { stages: ["not-a-stage"] },
        }),
    ).toThrow(/unknown render-chain stage/u);
    expect(
      () =>
        new RenderChain(renderer("webgpu"), {
          request: { stages: [], tier: "ultra" as never },
        }),
    ).toThrow(/tier/u);
  });

  /**
   * The browser bridge reads this report from `dist/playtest.js`, which `tsup` emits as its own
   * entry with its own copy of this module — so a module-scoped map is written by one copy and
   * read by another, and every `renderChain` assertion fails closed as UNOBSERVABLE while the
   * chain is installed and printing its marker. Two `import()`s across `vi.resetModules()` are
   * that pair of copies.
   */
  it("publishes its report where a second copy of this module can read it", async () => {
    const current = renderer("webgpu");
    vi.resetModules();
    const first = await import("../src/render/chain.js");
    new first.RenderChain(current as never, {
      input: { node: "scene" },
      report: () => undefined,
      request: { stages: ["bloom"] },
      stages: [{ build: (input) => ({ bloomed: input }), name: "bloom" }],
    });
    vi.resetModules();
    const second = await import("../src/render/chain.js");

    expect(second.readRenderChainObservation(current)?.tier).toBe("high");
    expect(second.readRenderChainObservation(current)?.stages).toEqual(["bloom"]);
  });

  it("accepts an empty request as a no-op", () => {
    const current = renderer("webgpu");
    const marker = vi.fn();
    const chain = new RenderChain(current, { report: marker });

    expect(chain.applied.stages).toEqual([]);
    expect(current.installed).toEqual([]);
    expect(marker).not.toHaveBeenCalled();
  });
});
