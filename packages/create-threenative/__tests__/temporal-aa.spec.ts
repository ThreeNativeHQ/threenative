import { PerspectiveCamera, Scene } from "three";
import TRAANode from "three/addons/tsl/display/TRAANode.js";
import { pass, velocity } from "three/tsl";
import type { NodeBuilder, NodeFrame, RenderTarget, Texture } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTemporalAA } from "../templates/starter/src/render/temporalAA.js";

afterEach(() => vi.restoreAllMocks());
function fixture() {
  // GPU execution belongs to the runtime fixture. Unit tests isolate reset/lifetime ownership.
  const events: string[] = [];
  vi.spyOn(TRAANode.prototype, "updateBefore").mockImplementation(() => {
    events.push("resolve");
    return undefined;
  });
  const camera = new PerspectiveCamera(50, 1280 / 720);
  const scenePass = pass(new Scene(), camera);
  scenePass.setSize(1280, 720);
  // Render-target initialization normally sizes depth on the GPU renderer.
  scenePass.getTextureNode("depth").value.image = { width: 1280, height: 720 };
  const temporal = createTemporalAA(
    scenePass.getTextureNode(),
    scenePass.getTextureNode("depth"),
    scenePass.getTextureNode("velocity"),
    camera,
  );
  const copies: { from: Texture; to: Texture }[] = [];
  const frame = {
    renderer: {
      initRenderTarget: () => {},
      copyTextureToTexture: (from: Texture, to: Texture) => {
        events.push("copy");
        copies.push({ from, to });
      },
    },
  } as unknown as NodeFrame;
  const node = temporal.node as unknown as {
    setSize(width: number, height: number): void;
    setViewOffset(width: number, height: number): void;
    clearViewOffset(): void;
    _historyRenderTarget: RenderTarget;
    _resolveRenderTarget: RenderTarget;
  };
  node.setSize(1280, 720);
  temporal.node.setup({ context: { velocity }, renderer: {} } as unknown as NodeBuilder);
  return { camera, copies, events, frame, node, scenePass, temporal };
}

describe("opt-in full-resolution temporal AA", () => {
  it("seeds current colour on first use and a camera cut, not ordinary frames", () => {
    const { temporal, frame, copies, events, scenePass, node } = fixture();
    temporal.node.updateBefore(frame);
    expect(temporal.report()).toMatchObject({
      frame: 1,
      historyValid: false,
      resetReason: "initial",
      inputWidth: 1280,
      outputWidth: 1280,
    });
    expect(copies[0]).toEqual({
      from: scenePass.renderTarget.texture,
      to: node._resolveRenderTarget.texture,
    });
    expect(copies[1]).toEqual({
      from: scenePass.renderTarget.texture,
      to: node._historyRenderTarget.texture,
    });
    expect(events).toEqual(["resolve", "copy", "copy"]);
    temporal.node.updateBefore(frame);
    expect(temporal.report()).toMatchObject({ frame: 2, historyValid: true, resetReason: null });
    expect(copies).toHaveLength(2);
    temporal.resetHistory("camera-cut");
    temporal.node.updateBefore(frame);
    expect(temporal.report()).toMatchObject({
      frame: 3,
      historyValid: false,
      resetReason: "camera-cut",
    });
    expect(copies).toHaveLength(4);
    temporal.dispose();
    scenePass.dispose();
  });
  it("invalidates projection changes before jitter, not ordinary camera motion", () => {
    const { temporal, camera, frame, node, scenePass } = fixture();
    node.setViewOffset(1280, 720);
    node.clearViewOffset();
    temporal.node.updateBefore(frame);
    camera.position.x = 1;
    node.setViewOffset(1280, 720);
    node.clearViewOffset();
    temporal.node.updateBefore(frame);
    expect(temporal.report().historyValid).toBe(true);
    camera.fov = 70;
    node.setViewOffset(1280, 720);
    node.clearViewOffset();
    temporal.node.updateBefore(frame);
    expect(temporal.report()).toMatchObject({
      historyValid: false,
      resetReason: "projection-change",
    });
    temporal.dispose();
    scenePass.dispose();
  });
  it("reports changed raster size without claiming reconstruction", () => {
    const { temporal, frame, scenePass, node } = fixture();
    temporal.node.updateBefore(frame);
    scenePass.setSize(640, 360);
    scenePass.getTextureNode("depth").value.image = { width: 640, height: 360 };
    node.setSize(640, 360);
    temporal.node.updateBefore(frame);
    expect(temporal.report()).toMatchObject({
      historyValid: false,
      resetReason: "resize",
      inputWidth: 640,
      inputHeight: 360,
      outputWidth: 640,
      outputHeight: 360,
    });
    temporal.dispose();
    scenePass.dispose();
  });
  it("refuses mismatched velocity dimensions instead of sampling an unrelated raster", () => {
    const { temporal, frame, scenePass } = fixture();
    temporal.node.velocityNode.value.image = { width: 8, height: 8 };
    expect(() => temporal.node.updateBefore(frame)).toThrow(/same raster/);
    temporal.dispose();
    scenePass.dispose();
  });
  it("releases temporal targets once and rejects use after disposal", () => {
    const { temporal, frame, node, scenePass } = fixture();
    const release = vi.spyOn(node._historyRenderTarget, "dispose");
    temporal.dispose();
    temporal.dispose();
    expect(release).toHaveBeenCalledTimes(1);
    expect(() => temporal.node.updateBefore(frame)).toThrow(/disposed/);
    expect(() => temporal.resetHistory()).toThrow(/disposed/);
    scenePass.dispose();
  });
});
