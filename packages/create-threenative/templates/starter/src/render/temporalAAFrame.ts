// Generated user source: the per-frame GPU work behind `createTemporalAA` — display-sized history and
// resolve targets, an input-sized depth history, the jitter lattice, and the measured rejection count.
// Upstream's `_quadMesh` is module private, so the quad is ours too.
import { type OrthographicCamera, type PerspectiveCamera, Vector2 } from "three";
import {
  DepthTexture,
  QuadMesh,
  type RenderTarget,
  type Renderer,
  RendererUtils,
  type TextureNode,
} from "three/webgpu";
import {
  type ITemporalRejectionCounter,
  type ITemporalRejectionMeasurement,
  createTemporalRejectionCounter,
} from "./temporalRejectionCounter.js";

export type {
  ITemporalAANode,
  TemporalDepthRejection,
} from "./temporalResolveDepth.js";
import {
  type ITemporalAANode,
  type TemporalDepthRejection,
  guardTemporalAASeams,
} from "./temporalResolveDepth.js";

/** Owns everything that survives between frames: the quad, the rasters, the depth history and the
 * saved renderer state. */
export function createTemporalAAFrame(
  internals: ITemporalAANode,
  camera: PerspectiveCamera | OrthographicCamera,
  depth: TextureNode,
  historyValid: { value: number },
  rejection: () => TemporalDepthRejection | undefined,
) {
  const quadMesh = new QuadMesh();
  quadMesh.name = "Temporal AA";
  const input = new Vector2();
  const display = new Vector2();
  let previousDepth: DepthTexture | null = null;
  let depthReady = false;
  let disposed = false;
  let frame = 0;
  let counter: ITemporalRejectionCounter | undefined;
  let rendererState: Parameters<typeof RendererUtils.resetRendererState>[1] | undefined;

  /** The scene pass raster, from its real GPU target and never from a canvas label. */
  function measureInput(): RenderTarget | undefined {
    const target = internals.beautyNode.isRTTNode
      ? internals.beautyNode.renderTarget
      : internals.beautyNode.passNode?.renderTarget;
    if (target === undefined) return undefined;
    if (!Number.isFinite(target.width) || target.width < 1) return undefined;
    if (!Number.isFinite(target.height) || target.height < 1) return undefined;
    input.set(target.width, target.height);
    return target;
  }

  /**
   * Establishes the jitter before the scene pass draws. Upstream's own pipeline callback asks for the
   * drawing buffer, which is a canvas-sized step and not the smaller raster the scene pass is about to
   * render; the pass sizes its own target from that buffer in its `updateBefore`, which runs after
   * this callback, so the lattice is the buffer scaled by the pass's own resolution scale.
   */
  function jitterInput(renderer: Renderer): void {
    if (disposed) return;
    const colour = internals.beautyNode;
    // A fixed RTT owns its raster; an automatic RTT and a pass size themselves from the buffer.
    if (colour.isRTTNode && colour.autoResize === false) {
      if (measureInput() !== undefined) internals.setViewOffset(input.x, input.y);
      return;
    }
    const scale = (colour.isRTTNode ? colour : colour.passNode)?.getResolutionScale?.() ?? 1;
    renderer.getDrawingBufferSize(input);
    if (scale !== 1) input.set(Math.floor(input.x * scale), Math.floor(input.y * scale));
    internals.setViewOffset(input.x, input.y);
  }

  /**
   * Publishes this frame and updates history. `reset` marks a frame whose history cannot be reused:
   * seeding history before the resolve is not enough, because motion would still sample that seed at
   * shifted UVs, so the resolve kernel reads `historyValid` and weights current colour only.
   */
  function draw(renderer: Renderer, reset: boolean, currentFrame: number): void {
    frame = currentFrame;
    if (measure(renderer) === undefined)
      throw new Error("Temporal AA requires a materialized colour input.");
    guardTemporalAASeams(internals);
    if (display.x < input.x || display.y < input.y)
      throw new Error("Temporal AA cannot resolve to a display raster below its input raster.");
    // Store previous frame matrices before updating current ones.
    internals._previousCameraWorldMatrix.value.copy(internals._cameraWorldMatrix.value);
    internals._previousCameraProjectionMatrixInverse.value.copy(
      internals._cameraProjectionMatrixInverse.value,
    );
    internals._cameraNearFar.value.set(camera.near, camera.far);
    internals._cameraWorldMatrix.value.copy(camera.matrixWorld);
    internals._cameraWorldMatrixInverse.value.copy(camera.matrixWorldInverse);
    internals._cameraProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
    if (internals._needsPostProcessingSync === true) {
      internals.setViewOffset(input.x, input.y);
      internals._needsPostProcessingSync = false;
    }
    historyValid.value = reset ? 0 : 1;
    // History depth is an input-raster texture of its own: history is display sized, so a copy into its
    // depth attachment would read one raster and write another. A missing or resized one is seeded with
    // this frame's depth. Both axes count: a height-only resize keeps the width.
    if (previousDepth?.image.width !== input.x || previousDepth?.image.height !== input.y) {
      previousDepth?.dispose();
      previousDepth = new DepthTexture(input.x, input.y, depth.value.type);
      depthReady = false;
    }
    const seeded = depthReady === false;
    const depthHistory = previousDepth;
    let state: typeof rendererState;
    try {
      rendererState ??= RendererUtils.saveRendererState(renderer);
      state = RendererUtils.resetRendererState(renderer, rendererState);
      internals._previousDepthNode.value = depthHistory;
      if (seeded) {
        renderer.copyTextureToTexture(depth.value, depthHistory);
        depthReady = true;
      }
      // Resolve and history hold the display raster whatever the input raster is.
      const restarted =
        internals._historyRenderTarget.width !== display.x ||
        internals._historyRenderTarget.height !== display.y;
      internals.setSize(display.x, display.y);
      if (restarted) {
        // A resize disposes the targets, so they need fresh GPU storage before the draw.
        renderer.initRenderTarget(internals._historyRenderTarget);
        renderer.initRenderTarget(internals._resolveRenderTarget);
      }
      if (
        internals._historyRenderTarget.width !== display.x ||
        internals._historyRenderTarget.height !== display.y
      )
        throw new Error("Temporal AA history and resolve must share the display raster.");
      renderer.setRenderTarget(internals._resolveRenderTarget);
      quadMesh.material = internals._resolveMaterial;
      quadMesh.render(renderer);
      // Between the resolve and the depth copy, so it reads the depth and matrices just drawn with.
      const equations = rejection();
      if (equations !== undefined) {
        counter ??= createTemporalRejectionCounter(equations);
        counter.sample(renderer, frame, display.x, display.y);
      }
      // History is the resolve this frame produced, at the same size, so the copy never crosses rasters.
      if (seeded === false) renderer.copyTextureToTexture(depth.value, depthHistory);
      renderer.copyTextureToTexture(
        internals._resolveRenderTarget.texture,
        internals._historyRenderTarget.texture,
      );
    } finally {
      if (state !== undefined) RendererUtils.restoreRendererState(renderer, state);
    }
  }

  /** Both rasters, from the real targets: the scene pass one, then the drawing buffer. */
  function measure(renderer: Renderer): RenderTarget | undefined {
    const target = measureInput();
    if (target === undefined) return undefined;
    renderer.getDrawingBufferSize(display);
    return target;
  }

  return {
    input,
    display,
    measure,
    jitterInput,
    draw,
    // The measured measurement, the one handed to the chain once, and the settle a diagnostic
    // frame awaits. All three are the counter's own contract; this layer only forwards it.
    rejection: (): ITemporalRejectionMeasurement | undefined => counter?.report(frame),
    drainRejection: (): { frame: number; rejectionFraction: number } | undefined => {
      const drained = counter?.drain();
      return drained && { frame: drained.frame, rejectionFraction: drained.fraction };
    },
    settledRejection: (): Promise<void> => counter?.settled() ?? Promise.resolve(),
    dispose: (): void => {
      disposed = true;
      counter?.dispose();
      counter = undefined;
      previousDepth?.dispose();
      previousDepth = null;
      depthReady = false;
    },
  };
}
