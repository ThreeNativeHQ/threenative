// Generated user source: the per-frame GPU work behind `createTemporalAA` — display-sized history and
// resolve targets, an input-sized depth history of our own, and the jitter lattice the scene pass
// draws on. Upstream's `_quadMesh` is module private, so the quad is ours too.
import { type Matrix4, type OrthographicCamera, type PerspectiveCamera, Vector2 } from "three";
import {
  DepthTexture,
  type NodeMaterial,
  QuadMesh,
  type RenderTarget,
  type Renderer,
  RendererUtils,
  type TextureNode,
} from "three/webgpu";
import type { ITemporalResolvePinned } from "./temporalResolveDepth.js";

/** The pinned TRAANode seams this provider drives. */
export interface ITemporalAANode extends ITemporalResolvePinned {
  _resolveMaterial: NodeMaterial;
  _needsPostProcessingSync: boolean;
  _historyValidUniform: { value: number };
  _originalProjectionMatrix: Matrix4;
  _velocityNode: {
    projectionMatrix: Matrix4 | null;
    setProjectionMatrix(matrix: Matrix4 | null): void;
  } | null;
  beautyNode: TextureNode & {
    isRTTNode?: boolean;
    renderTarget?: RenderTarget;
    passNode?: { renderTarget: RenderTarget; getResolutionScale?: () => number };
  };
  setSize(width: number, height: number): void;
  setViewOffset(width: number, height: number): void;
  clearViewOffset(): void;
}

/**
 * Fail closed rather than half-drive a pinned seam whose shape this version does not have. A missing
 * uniform reads as `undefined` inside a shader and comes back as a black frame.
 */
export function guardTemporalAASeams(node: ITemporalAANode): void {
  if (
    typeof node.setSize !== "function" ||
    typeof node.setViewOffset !== "function" ||
    typeof node.clearViewOffset !== "function" ||
    node._resolveMaterial === undefined ||
    node._previousDepthNode === undefined ||
    node._cameraNearFar?.value === undefined ||
    node._cameraWorldMatrix?.value === undefined ||
    !Number.isFinite(node._resolveRenderTarget?.width) ||
    !Number.isFinite(node._historyRenderTarget?.height)
  )
    throw new Error("Temporal AA requires the pinned TRAANode resolve seams of Three 0.185.1.");
}

/**
 * Owns everything that must survive between frames: the resolve quad, the measured rasters, the
 * depth history and its validity, and the saved renderer state.
 */
export function createTemporalAAFrame(
  internals: ITemporalAANode,
  camera: PerspectiveCamera | OrthographicCamera,
  depth: TextureNode,
  historyValid: { value: number },
) {
  const quadMesh = new QuadMesh();
  quadMesh.name = "Temporal AA";
  /** The raster the scene pass rendered. Every gather and the jitter lattice read this one. */
  const input = new Vector2();
  const display = new Vector2();
  let previousDepth: DepthTexture | null = null;
  let depthReady = false;
  let rendererState: Parameters<typeof RendererUtils.resetRendererState>[1] | undefined;

  /** Measures the scene pass raster from its real GPU target, never from a canvas label. */
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
   * drawing buffer, which is one sub-pixel step on the canvas and not on the smaller raster the scene
   * pass is about to render. The pass sizes its own target from that buffer in its `updateBefore`,
   * which runs after this callback, so its target still carries the previous raster at the first draw
   * and at the first resize draw: the lattice is the buffer scaled by the pass's own scale.
   */
  function jitterInput(renderer: Renderer): void {
    const scale = internals.beautyNode.passNode?.getResolutionScale?.() ?? 1;
    renderer.getDrawingBufferSize(input);
    if (scale !== 1) input.set(Math.floor(input.x * scale), Math.floor(input.y * scale));
    internals.setViewOffset(input.x, input.y);
  }

  /**
   * Publishes this frame and updates history. `reset` marks a frame whose history cannot be reused:
   * seeding history before the resolve is not enough, because motion would still sample that seed at
   * shifted UVs, so the resolve kernel reads `historyValid` and weights current colour only — the one
   * reset behaviour a cross-raster colour copy cannot express.
   */
  function draw(renderer: Renderer, reset: boolean): void {
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
    // History depth is an input-raster texture of its own: history is display sized, so a copy into
    // its depth attachment would read one raster and write another. A missing or resized one is seeded
    // with this frame's depth instead; an unwritten texture is not one a shader may sample. Both input
    // axes count: a height-only resize keeps the width, so a width-only guard keeps a wrong-height sink.
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
      // History is the resolve this frame produced, at the same size, so the copy never crosses
      // rasters. On a seeded frame the depth history already holds this frame's depth.
      if (seeded === false) renderer.copyTextureToTexture(depth.value, depthHistory);
      renderer.copyTextureToTexture(
        internals._resolveRenderTarget.texture,
        internals._historyRenderTarget.texture,
      );
    } finally {
      if (state !== undefined) RendererUtils.restoreRendererState(renderer, state);
    }
  }

  /** Measures both rasters from the real targets: the scene pass one, then the drawing buffer. */
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
    /** Releases the depth history. Upstream disposes the two display targets and the material. */
    dispose: (): void => {
      previousDepth?.dispose();
      previousDepth = null;
      depthReady = false;
    },
  };
}
