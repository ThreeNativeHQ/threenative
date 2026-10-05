import { type Color, PerspectiveCamera, Scene, Vector2 } from "three";
import { pass, velocity } from "three/tsl";
import type { NodeBuilder, NodeFrame, RenderTarget, Texture } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTemporalAA } from "../templates/starter/src/render/temporalAA.js";

afterEach(() => vi.restoreAllMocks());

const DISPLAY = { width: 1920, height: 1080 };
/** Two thirds, the deliberate fraction the scaled fixture uses; not a divisor of the display. */
const SCALED = 2 / 3;
const INPUT = {
  width: Math.floor(DISPLAY.width * SCALED),
  height: Math.floor(DISPLAY.height * SCALED),
};

type Copy = { from: Texture; to: Texture };

/** The renderer surface the overridden updateBefore drives, and the order it drives it in. */
function stubRenderer(display = DISPLAY) {
  const order: string[] = [];
  const copies: Copy[] = [];
  const size = new Vector2(display.width, display.height);
  let target: RenderTarget | null = null;
  const renderer = {
    autoClear: true,
    logarithmicDepthBuffer: false,
    reversedDepthBuffer: false,
    toneMapping: 0,
    toneMappingExposure: 1,
    outputColorSpace: "",
    getRenderTarget: () => target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getRenderObjectFunction: () => null,
    getPixelRatio: () => 1,
    getMRT: () => null,
    getClearColor: (into: Color) => into,
    getClearAlpha: () => 1,
    getScissorTest: () => false,
    setMRT: () => {},
    setRenderObjectFunction: () => {},
    setClearColor: () => {},
    setPixelRatio: () => {},
    setScissorTest: () => {},
    setRenderTarget: (next: RenderTarget | null) => {
      target = next;
    },
    getDrawingBufferSize: (into: Vector2) => into.copy(size),
    initRenderTarget: () => {
      order.push("init");
    },
    render: () => {
      order.push("resolve");
    },
    copyTextureToTexture: (from: Texture, to: Texture) => {
      order.push("copy");
      copies.push({ from, to });
    },
  };
  return {
    copies,
    order,
    renderer,
    setDisplay(width: number, height: number) {
      size.set(width, height);
    },
  };
}

function fixture(
  options: {
    display?: { width: number; height: number };
    resolutionScale?: number;
    renderPipeline?: boolean;
  } = {},
) {
  // GPU execution belongs to the runtime fixture. Unit tests isolate sizing, reset and lifetime.
  const display = options.display ?? DISPLAY;
  // The scene pass sizes its own target from the drawing buffer, so the input raster is that buffer
  // scaled and floored. Reading the scale from the pass keeps one sizing rule.
  const scale = options.resolutionScale ?? SCALED;
  const input = {
    width: Math.floor(display.width * scale),
    height: Math.floor(display.height * scale),
  };
  const camera = new PerspectiveCamera(50, display.width / display.height);
  const scenePass = pass(new Scene(), camera);
  if (scale !== 1) scenePass.setResolutionScale(scale);
  scenePass.setSize(display.width, display.height);
  // Render-target initialization normally sizes depth on the GPU renderer.
  scenePass.getTextureNode("depth").value.image = { width: input.width, height: input.height };
  const temporal = createTemporalAA(
    scenePass.getTextureNode(),
    scenePass.getTextureNode("depth"),
    scenePass.getTextureNode("velocity"),
    camera,
  );
  const stub = stubRenderer(display);
  const frame = { renderer: stub.renderer } as unknown as NodeFrame;
  const node = temporal.node as unknown as {
    _historyRenderTarget: RenderTarget;
    _resolveRenderTarget: RenderTarget;
    _historyValidUniform: { value: number };
  };
  const dependencies: Record<string, unknown> = {};
  // A render pipeline is what asks the node for its first jitter, once before the scene pass draws
  // and once after the chain, in that order.
  const pipeline = {
    context: {} as {
      onBeforeRenderPipeline?: () => void;
      onAfterRenderPipeline?: () => void;
    },
  };
  temporal.node.setup({
    context: {
      velocity,
      ...(options.renderPipeline === true ? { renderPipeline: pipeline } : {}),
    },
    // The pipeline callback reads the drawing buffer through the builder's renderer.
    renderer: stub.renderer,
    getNodeProperties: () => dependencies,
  } as unknown as NodeBuilder);
  return {
    camera,
    copies: stub.copies,
    dependencies,
    frame,
    node,
    order: stub.order,
    pipeline,
    scenePass,
    stub,
    temporal,
  };
}

describe("opt-in temporal AA", () => {
  it("registers input-pass dependencies before temporal update and sizing", () => {
    const { dependencies, temporal, scenePass } = fixture();
    expect(Object.values(dependencies)).toContain(temporal.node.beautyNode);
    expect(Object.values(dependencies)).toContain(temporal.node.depthNode);
    expect(Object.values(dependencies)).toContain(temporal.node.velocityNode);
    temporal.dispose();
    scenePass.dispose();
  });

  it("resolves a smaller input raster into display-sized targets", () => {
    const { temporal, frame, copies, node, scenePass } = fixture();
    temporal.node.updateBefore(frame);
    expect(temporal.report()).toMatchObject({
      frame: 1,
      historyValid: false,
      resetReason: "initial",
      inputWidth: INPUT.width,
      inputHeight: INPUT.height,
      outputWidth: DISPLAY.width,
      outputHeight: DISPLAY.height,
    });
    // Both targets hold the display raster, which a resolve without this override would not.
    expect(node._resolveRenderTarget.width).toBe(DISPLAY.width);
    expect(node._resolveRenderTarget.height).toBe(DISPLAY.height);
    expect(node._historyRenderTarget.width).toBe(DISPLAY.width);
    expect(node._historyRenderTarget.height).toBe(DISPLAY.height);
    // No copy crosses the rasters: input colour can only seed a display target at full resolution.
    expect(copies.some((copy) => copy.from === scenePass.renderTarget.texture)).toBe(false);
    // The kernel reads this flag to publish a reset frame verbatim instead of seeding colour.
    expect(node._historyValidUniform.value).toBe(0);
    temporal.node.updateBefore(frame);
    expect(temporal.report()).toMatchObject({ frame: 2, historyValid: true, resetReason: null });
    expect(node._historyValidUniform.value).toBe(1);
    temporal.node.updateBefore(frame);
    expect(temporal.report()).toMatchObject({
      frame: 3,
      historyValid: true,
      outputWidth: DISPLAY.width,
      outputHeight: DISPLAY.height,
    });
    // One input-sized depth texture serves every frame, and only the draw writes resolve.
    const depthTexture = scenePass.getTextureNode("depth").value;
    const depthTargets = copies.filter((copy) => copy.from === depthTexture).map((copy) => copy.to);
    expect(depthTargets).toHaveLength(3);
    expect(depthTargets[1]).toBe(depthTargets[0]);
    expect(depthTargets[2]).toBe(depthTargets[0]);
    expect((depthTargets[0] as { image: { width: number } }).image.width).toBe(INPUT.width);
    expect(depthTargets[0]).not.toBe(node._historyRenderTarget.depthTexture);
    expect(copies.filter((copy) => copy.to === node._resolveRenderTarget.texture)).toHaveLength(0);
    expect(copies.filter((copy) => copy.to === node._historyRenderTarget.texture)).toHaveLength(3);
    temporal.dispose();
    scenePass.dispose();
  });

  it("seeds the depth history before the resolve, so no frame samples an unwritten texture", () => {
    const { temporal, frame, copies, order, scenePass } = fixture();
    temporal.node.updateBefore(frame);
    const depthTexture = scenePass.getTextureNode("depth").value;
    const seed = copies.findIndex((copy) => copy.from === depthTexture);
    // A fresh depth history is written before the draw that reads it; a later frame leaves it alone.
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(order.indexOf("resolve"));
    const beforeSecondFrame = copies.length;
    temporal.node.updateBefore(frame);
    const carried = copies.slice(beforeSecondFrame).find((copy) => copy.from === depthTexture);
    expect(carried).toBeDefined();
    temporal.dispose();
    scenePass.dispose();
  });

  it("jitters the input lattice when the scene pass draws, not the canvas", () => {
    const { camera, temporal, frame, node, pipeline, scenePass } = fixture({
      renderPipeline: true,
    });
    // The pipeline callback runs before the scene pass draws, so the lattice it sets is the one the
    // scene pass renders on. Upstream asks for the drawing buffer here instead.
    expect(pipeline.context.onBeforeRenderPipeline).toBeTypeOf("function");
    pipeline.context.onBeforeRenderPipeline?.();
    expect(camera.view?.enabled).toBe(true);
    expect(camera.view?.fullWidth).toBe(INPUT.width);
    expect(camera.view?.fullHeight).toBe(INPUT.height);
    temporal.node.updateBefore(frame);
    expect(camera.view?.fullWidth).toBe(INPUT.width);
    expect(node._resolveRenderTarget.width).toBe(DISPLAY.width);
    expect(node._historyRenderTarget.height).toBe(DISPLAY.height);
    temporal.dispose();
    scenePass.dispose();
  });

  it("jitters the raster the scene pass is about to render, not the one it last used", () => {
    const { camera, temporal, frame, pipeline, scenePass, stub } = fixture({
      renderPipeline: true,
    });
    temporal.node.updateBefore(frame);
    // A height-only display resize. The scene pass sizes its own target in its `updateBefore`, which
    // runs after this callback, so the target still carries the raster it last rendered into.
    stub.setDisplay(1280, 480);
    pipeline.context.onBeforeRenderPipeline?.();
    expect(camera.view?.enabled).toBe(true);
    expect(camera.view?.fullWidth).toBe(853);
    expect(camera.view?.fullHeight).toBe(320);
    // The target still holds the raster the pass last rendered into, which is not this frame's.
    expect(scenePass.renderTarget.height).not.toBe(camera.view?.fullHeight);
    temporal.dispose();
    scenePass.dispose();
  });

  it("keeps the caller's projection while the jitter lattice is the input raster", () => {
    const { camera, temporal, frame, pipeline, scenePass } = fixture({
      // A raster whose floored two-thirds is not the display's aspect, so a lattice that overwrites
      // the caller's framing cannot pass for the caller's framing.
      display: { width: 1280, height: 720 },
      renderPipeline: true,
    });
    const authored = camera.aspect;
    const authoredProjection = camera.projectionMatrix.clone();
    const draw = (): void => {
      pipeline.context.onBeforeRenderPipeline?.();
      temporal.node.updateBefore(frame);
      pipeline.context.onAfterRenderPipeline?.();
    };
    pipeline.context.onBeforeRenderPipeline?.();
    // The lattice is the raster the scene pass is about to render, one input texel wide.
    expect(camera.view?.enabled).toBe(true);
    expect(camera.view?.fullWidth).toBe(scenePass.renderTarget.width);
    expect(camera.view?.fullHeight).toBe(scenePass.renderTarget.height);
    expect(camera.aspect).toBe(authored);
    temporal.node.updateBefore(frame);
    pipeline.context.onAfterRenderPipeline?.();
    // Unjittered, the projection is the caller's own again, which is what history reprojects against.
    expect(camera.projectionMatrix.equals(authoredProjection)).toBe(true);
    // The opening frame is the initial reset; applying the lattice is not another one.
    expect(temporal.report()).toMatchObject({ historyValid: false, resetReason: "initial" });
    draw();
    expect(temporal.report()).toMatchObject({ historyValid: true, resetReason: null });
    camera.position.x = 1;
    draw();
    expect(temporal.report()).toMatchObject({ historyValid: true, resetReason: null });
    // Only a projection change the caller made invalidates history.
    camera.fov = 70;
    draw();
    expect(temporal.report()).toMatchObject({
      historyValid: false,
      resetReason: "projection-change",
    });
    temporal.dispose();
    scenePass.dispose();
  });

  it("seeds current colour on restart only while both rasters match", () => {
    const matched = fixture({ display: INPUT, resolutionScale: 1 });
    matched.temporal.node.updateBefore(matched.frame);
    expect(matched.temporal.report()).toMatchObject({
      historyValid: false,
      resetReason: "initial",
      inputWidth: INPUT.width,
      outputWidth: INPUT.width,
    });
    expect(
      matched.copies.some((copy) => copy.from === matched.scenePass.renderTarget.texture),
    ).toBe(true);
    expect(matched.node._historyRenderTarget.width).toBe(INPUT.width);
    expect(matched.node._resolveRenderTarget.height).toBe(INPUT.height);
    matched.temporal.node.updateBefore(matched.frame);
    const seeded = matched.copies.length;
    expect(matched.order.filter((event) => event === "init")).toHaveLength(2);
    matched.temporal.resetHistory("camera-cut");
    matched.temporal.node.updateBefore(matched.frame);
    expect(matched.temporal.report()).toMatchObject({
      frame: 3,
      historyValid: false,
      resetReason: "camera-cut",
    });
    expect(matched.node._historyValidUniform.value).toBe(0);
    // A camera cut publishes this frame and seeds both targets, so only a reset adds copies.
    expect(matched.copies.length).toBe(seeded + 4);
    matched.temporal.dispose();
    matched.scenePass.dispose();
  });

  it("invalidates projection changes before jitter, not ordinary camera motion", () => {
    const { temporal, camera, frame, pipeline, scenePass } = fixture({ renderPipeline: true });
    // One frame as the pipeline drives it: jitter on the input lattice, then the chain, then the
    // clear that advances the jitter index.
    const draw = (): void => {
      pipeline.context.onBeforeRenderPipeline?.();
      temporal.node.updateBefore(frame);
      pipeline.context.onAfterRenderPipeline?.();
    };
    draw();
    camera.position.x = 1;
    draw();
    expect(temporal.report().historyValid).toBe(true);
    camera.fov = 70;
    draw();
    expect(temporal.report()).toMatchObject({
      historyValid: false,
      resetReason: "projection-change",
    });
    temporal.dispose();
    scenePass.dispose();
  });

  it("invalidates an input raster change and keeps resolving at display size", () => {
    const { temporal, frame, node, scenePass } = fixture({ resolutionScale: 1 });
    temporal.node.updateBefore(frame);
    scenePass.setSize(640, 360);
    scenePass.getTextureNode("depth").value.image = { width: 640, height: 360 };
    temporal.node.updateBefore(frame);
    expect(temporal.report()).toMatchObject({
      historyValid: false,
      resetReason: "resize",
      inputWidth: 640,
      inputHeight: 360,
      outputWidth: DISPLAY.width,
      outputHeight: DISPLAY.height,
    });
    expect(node._resolveRenderTarget.width).toBe(DISPLAY.width);
    // A changed input raster is a fresh depth history, not a stretched one.
    const depthTexture = scenePass.getTextureNode("depth").value;
    const last = temporal.node as unknown as { _previousDepthNode: { value: Texture } };
    expect((last._previousDepthNode.value.image as { width: number }).width).toBe(640);
    expect(depthTexture.width).toBe(640);
    temporal.dispose();
    scenePass.dispose();
  });

  it("reallocates the depth history on a height-only input resize at constant width", () => {
    const { temporal, frame, copies, order, scenePass } = fixture({ resolutionScale: 1 });
    temporal.node.updateBefore(frame);
    const seams = temporal.node as unknown as { _previousDepthNode: { value: Texture } };
    const carried = seams._previousDepthNode.value;
    const release = vi.spyOn(carried, "dispose");
    // A height-only raster change is the case a width-only guard cannot see: the sink is the right
    // width and the wrong height, so every later frame reprojects against a mismatched texture.
    scenePass.setSize(INPUT.width, 360);
    scenePass.getTextureNode("depth").value.image = { width: INPUT.width, height: 360 };
    // Both traces are indexed from this frame's boundary: an earlier frame's resolve would satisfy
    // the seed-before-resolve comparison without saying anything about the frame that reseeds.
    const copiesBefore = copies.length;
    const orderBefore = order.length;
    temporal.node.updateBefore(frame);
    const fresh = seams._previousDepthNode.value;
    expect(temporal.report()).toMatchObject({
      historyValid: false,
      resetReason: "resize",
      inputWidth: INPUT.width,
      inputHeight: 360,
      outputWidth: DISPLAY.width,
      outputHeight: DISPLAY.height,
    });
    expect(fresh).not.toBe(carried);
    expect(release).toHaveBeenCalledTimes(1);
    expect(fresh.image).toMatchObject({ width: INPUT.width, height: 360 });
    // The node samples the fresh sink, and it is seeded before that frame's resolve reads it.
    const seed = copies.findIndex((copy) => copy.to === fresh) - copiesBefore;
    const resolve = order.indexOf("resolve", orderBefore) - orderBefore;
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(resolve);
    temporal.dispose();
    scenePass.dispose();
  });

  it("invalidates a display raster change", () => {
    const { temporal, frame, node, scenePass, stub } = fixture();
    temporal.node.updateBefore(frame);
    stub.setDisplay(2560, 1440);
    temporal.node.updateBefore(frame);
    expect(temporal.report()).toMatchObject({
      historyValid: false,
      resetReason: "resize",
      inputWidth: INPUT.width,
      outputWidth: 2560,
      outputHeight: 1440,
    });
    expect(node._resolveRenderTarget.width).toBe(2560);
    expect(node._historyRenderTarget.height).toBe(1440);
    temporal.dispose();
    scenePass.dispose();
  });

  it("refuses a display raster below its input raster", () => {
    const { temporal, frame, scenePass, stub } = fixture();
    stub.setDisplay(640, 360);
    expect(() => temporal.node.updateBefore(frame)).toThrow(/below its input raster/);
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

  it("fails closed when the pinned resolve seams are missing", () => {
    const { temporal, frame, scenePass } = fixture();
    const seams = temporal.node as unknown as { _resolveMaterial?: unknown };
    const resolveMaterial = seams._resolveMaterial;
    Reflect.deleteProperty(seams, "_resolveMaterial");
    expect(() => temporal.node.updateBefore(frame)).toThrow(/pinned TRAANode resolve seams/);
    seams._resolveMaterial = resolveMaterial;
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
