import { Color, type RenderTarget, Texture } from "three";
import { texture } from "three/tsl";
import { NodeFrame, QuadMesh, type Renderer } from "three/webgpu";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoExposureNode } from "../template-assets/autoExposure.js";
import { exposureSettings } from "../template-assets/exposure.js";

function harness(enabled = true) {
  const node = new AutoExposureNode(texture(new Texture()), { ...exposureSettings, enabled }, 2);
  const frame = new NodeFrame();
  let size: [number, number] = [17, 5];
  const targets: RenderTarget[] = [];
  frame.renderer = {
    getDrawingBufferSize: (target: { set(x: number, y: number): unknown }) =>
      target.set(size[0], size[1]),
    setRenderTarget: vi.fn((target: RenderTarget | null) => {
      if (target !== null) targets.push(target);
    }),
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getRenderObjectFunction: () => null,
    setRenderObjectFunction: vi.fn(),
    getPixelRatio: () => 1,
    setPixelRatio: vi.fn(),
    getMRT: () => null,
    setMRT: vi.fn(),
    getClearColor: () => new Color(),
    getClearAlpha: () => 1,
    setClearColor: vi.fn(),
    getScissorTest: () => false,
    setScissorTest: vi.fn(),
    readRenderTargetPixelsAsync: vi.fn().mockResolvedValue(new Float32Array([2, 0.045, 2, 1])),
  } as unknown as Renderer;
  frame.deltaTime = 1 / 60;
  frame.time = 1;
  return {
    node,
    frame,
    targets,
    renderer: frame.renderer,
    resize: (width: number, height: number) => {
      size = [width, height];
    },
  };
}

describe("GPU exposure lifecycle", () => {
  beforeEach(() => {
    vi.spyOn(QuadMesh.prototype, "render").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("reduces the existing colour and retains its 1x1 ping-pong history across resize", () => {
    const { node, frame, targets, resize } = harness();
    node.updateBefore(frame);
    expect(targets.map(({ width, height }) => [width, height])).toEqual([
      [5, 2],
      [2, 1],
      [1, 1],
      [1, 1],
    ]);
    const firstHistory = targets.at(-1);
    if (firstHistory === undefined) throw new Error("missing history draw");
    const release = vi.spyOn(firstHistory, "dispose");
    targets.length = 0;
    resize(8, 4);
    node.updateBefore(frame);
    expect(targets.map(({ width, height }) => [width, height])).toEqual([
      [2, 1],
      [1, 1],
      [1, 1],
    ]);
    expect(targets.at(-1)).not.toBe(firstHistory);
    expect(release).not.toHaveBeenCalled();
    node.updateBefore(frame);
    expect(targets.at(-1)).toBe(firstHistory);
    node.dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("continues measuring while disabled and reports the game's fixed exposure", async () => {
    const { node, frame, targets } = harness(false);
    expect(node.getObservation()).toEqual({ measured: false, applied: false });
    node.updateBefore(frame);
    await Promise.resolve();
    expect(targets).toHaveLength(4);
    expect(node.getObservation()).toMatchObject({
      measured: true,
      applied: false,
      luminance: expect.closeTo(0.045),
      exposureStops: 1,
    });
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"applied":false'));
    node.dispose();
  });

  it("reports GPU history rather than a CPU adaptation estimate", async () => {
    const { node, frame } = harness();
    node.updateBefore(frame);
    await Promise.resolve();
    expect(node.getObservation()).toMatchObject({
      luminance: expect.closeTo(0.045),
      exposureStops: 2,
      settled: true,
    });
    node.dispose();
  });

  it("restores renderer state after draw failure and disposes each target once", () => {
    const { node, frame, targets, renderer } = harness();
    vi.mocked(QuadMesh.prototype.render).mockImplementationOnce(() => {
      throw new Error("draw failed");
    });
    expect(() => node.updateBefore(frame)).toThrow("draw failed");
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(null, 0, 0);
    const first = targets[0];
    if (first === undefined) throw new Error("missing meter target");
    const release = vi.spyOn(first, "dispose");
    node.dispose();
    node.dispose();
    expect(release).toHaveBeenCalledTimes(1);
    expect(() => node.updateBefore(frame)).toThrow(/disposed/i);
  });

  it("invalidates pending observations after reset or disposal", async () => {
    const { node, frame } = harness();
    expect(() => node.reset(0)).toThrow(/exposure/i);
    node.updateBefore(frame);
    node.reset(4);
    await Promise.resolve();
    expect(node.getObservation()).toEqual({ measured: false, applied: true });
    node.reset();
    node.dispose();
  });

  it("refuses invalid readback rather than reporting a made-up luminance", async () => {
    const { node, frame, renderer } = harness();
    vi.mocked(renderer.readRenderTargetPixelsAsync).mockResolvedValueOnce(
      new Float32Array([0, Number.NaN, 0, 1]),
    );
    node.updateBefore(frame);
    await Promise.resolve();
    await Promise.resolve();
    expect(node.getObservation()).toMatchObject({
      measured: false,
      reason: expect.stringContaining("invalid"),
    });
    node.dispose();
  });
});
