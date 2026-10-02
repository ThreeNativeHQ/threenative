import { Color, Texture } from "three";
import { texture } from "three/tsl";
import { NodeFrame, QuadMesh, type Renderer, RendererUtils } from "three/webgpu";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exposureSettings } from "../template-assets/exposure.js";
import {
  ObservedExposureNode,
  exposureFrameSnapshot,
} from "./fixtures/auto-exposure/observedExposure.js";

describe("exposure deterministic render clock", () => {
  beforeEach(() => {
    vi.spyOn(QuadMesh.prototype, "render").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  function harness() {
    const node = new ObservedExposureNode(
      texture(new Texture()),
      { ...exposureSettings, enabled: true, reportInterval: 1e-6 },
      1,
    );
    node.deterministic = true;
    const frame = new NodeFrame();
    frame.deltaTime = 0.07;
    frame.time = 1;
    frame.frameId = 1;
    const read = vi.fn().mockResolvedValue(new Float32Array([0, 0.18, 0, 1]));
    frame.renderer = {
      getDrawingBufferSize: (size: { set(x: number, y: number): void }) => size.set(4, 4),
      setRenderTarget: vi.fn(),
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

      readRenderTargetPixelsAsync: read,
    } as unknown as Renderer;
    return { node, frame, read };
  }

  it("holds startup until the 180th accepted readback, then reports real readiness", async () => {
    const { node, frame, read } = harness();
    let held: Promise<unknown> = Promise.resolve();
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    const hold = (label: string, work: Promise<unknown>, budgetMs?: number) => {
      expect(label).toBe("exposure-warmup");
      expect(budgetMs).toBe(60_000);
      held = work;
    };
    node.holdStartup({ hold, whenReady: () => ready });
    const settled = vi.fn();
    void held.then(settled);
    for (let i = 0; i < 179; i++) {
      node.updateBefore(frame);
      await new Promise<void>((resolve) => setImmediate(resolve));
      frame.time += 0.07;
      frame.frameId++;
    }
    expect(settled).not.toHaveBeenCalled();
    let resolveLast!: (value: Float32Array) => void;
    read.mockReturnValueOnce(
      new Promise<Float32Array>((resolve) => {
        resolveLast = resolve;
      }),
    );
    node.updateBefore(frame);
    expect(settled).not.toHaveBeenCalled();
    resolveLast(new Float32Array([0, 0.18, 0, 1]));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toHaveBeenCalledOnce();
    releaseReady();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const messages = vi.mocked(console.info).mock.calls.map(([text]) => String(text));
    const warmup = JSON.parse(
      messages.find((text) => text.startsWith("TN_EXPOSURE_WARMUP:"))?.slice(19) ?? "{}",
    );
    expect(warmup).toMatchObject({ updates: 180, measurement: node.getObservation() });
    expect(
      messages.some(
        (text) =>
          text.startsWith("TN_EXPOSURE_READY:") &&
          JSON.parse(text.slice(18)).warmupComplete === true,
      ),
    ).toBe(true);
    node.dispose();
  });
  it.each(["resolve", "reject"])(
    "invalidates a delayed readback after disposal: %s",
    async (outcome) => {
      const { node, frame, read } = harness();
      let resolveRead!: (value: Float32Array) => void;
      let rejectRead!: (error: Error) => void;
      read.mockReturnValueOnce(
        new Promise<Float32Array>((resolve, reject) => {
          resolveRead = resolve;
          rejectRead = reject;
        }),
      );
      node.holdStartup({ hold: () => {}, whenReady: () => Promise.resolve() });
      const progress = vi.fn();
      node.onProgress = progress;
      node.updateBefore(frame);
      node.dispose();
      progress.mockClear();
      vi.mocked(console.info).mockClear();
      if (outcome === "resolve") resolveRead(new Float32Array([0, 0.18, 0, 1]));
      else rejectRead(new Error("late readback failure"));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(node.getProgress().sampleFrames).toBe(0);
      expect(progress).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();
      expect(frame.renderer?.readRenderTargetPixelsAsync).toBe(read);
    },
  );
  it("stamps each sample only after production accepts that exact readback", async () => {
    const { node, frame } = harness();
    node.updateBefore(frame);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const messages = vi.mocked(console.info).mock.calls.map(([text]) => String(text));
    const accepted = messages.findIndex((text) => text.startsWith("TN_AUTO_EXPOSURE:"));
    const sampled = messages.findIndex((text) => text.startsWith("TN_EXPOSURE_SAMPLE:"));
    expect(accepted).toBeGreaterThanOrEqual(0);
    expect(sampled).toBeGreaterThan(accepted);
    expect(JSON.parse(messages[sampled]?.slice(19) ?? "{}").measurement).toEqual(
      node.getObservation(),
    );
    node.dispose();
  });
  it("holds each pose at exactly 180 completed GPU samples and preserves the public read method", async () => {
    const { node, frame, read } = harness();
    for (let pose = 0; pose < 2; pose++) {
      if (pose === 1) node.beginCut();
      for (let i = 0; i < 185; i++) {
        node.updateBefore(frame);
        expect(frame.renderer?.readRenderTargetPixelsAsync).toBe(read);
        await new Promise<void>((resolve) => setImmediate(resolve));
        frame.time += 0.07;
        frame.frameId++;
      }
      expect(node.timing.updates).toBe((pose + 1) * 180);
      expect(node.getProgress().sampleFrames).toBe((pose + 1) * 180);
    }
    expect(node.getProgress().cutSampleFrames).toBe(180);
    expect(node.timing.consumedSeconds).toBeCloseTo(6, 8);
    expect(node.timing.realConsumedSeconds).toBeCloseTo(25.2, 8);
    expect(frame.deltaTime).toBe(0.07);
    node.dispose();
  });

  it("restores readback instrumentation even if the actual graph draw throws", () => {
    const { node, frame, read } = harness();
    vi.mocked(QuadMesh.prototype.render).mockImplementationOnce(() => {
      throw new Error("draw failed");
    });
    expect(() => node.updateBefore(frame)).toThrow("draw failed");
    expect(frame.renderer?.readRenderTargetPixelsAsync).toBe(read);
    expect(node.getProgress().sampleFrames).toBe(0);
    node.dispose();
  });
  it("passes a separate public NodeFrame snapshot and preserves the shared real clock", () => {
    const frame = new NodeFrame();
    frame.deltaTime = 0.07;
    frame.time = 12;
    frame.frameId = 9;
    const snapshot = exposureFrameSnapshot(frame);
    expect(snapshot).toBeInstanceOf(NodeFrame);
    expect(snapshot).not.toBe(frame);
    expect(snapshot.deltaTime).toBe(1 / 60);
    expect(snapshot.time).toBe(12);
    expect(snapshot.frameId).toBe(9);
    expect(snapshot.renderer).toBe(frame.renderer);
    expect(frame.deltaTime).toBe(0.07);
  });
});
