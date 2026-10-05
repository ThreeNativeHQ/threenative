// Generated user source: opt-in temporal AA and upscaling using pinned Three.js TRAANode. Colour,
// depth and velocity share the scene pass raster, which may sit below the display raster; resolve and
// history hold the display raster, so presented pixels come from a display-sized resolve and not from
// an upscaled copy of a low-resolution history.
import { Matrix4, type OrthographicCamera, type PerspectiveCamera } from "three";
import { traa } from "three/addons/tsl/display/TRAANode.js";
import { uniform } from "three/tsl";
import type { Node, TextureNode } from "three/webgpu";
import { type ITemporalAANode, createTemporalAAFrame } from "./temporalAAFrame.js";
import { createExperimentalTemporalResolve } from "./temporalResolve.js";

export type TemporalResetReason =
  | "initial"
  | "camera-cut"
  | "projection-change"
  | "resize"
  | "scene-reset"
  | "device-loss";
export interface ITemporalAAReport {
  readonly frame: number;
  /** Global history availability; per-pixel disocclusion rejection is not measured here. */
  readonly historyValid: boolean;
  readonly resetReason: TemporalResetReason | null;
  readonly inputWidth: number;
  readonly inputHeight: number;
  readonly outputWidth: number;
  readonly outputHeight: number;
}

/**
 * Reuse TRAANode's jitter, depth rejection and variance clipping. In a RenderChain `traa` factory,
 * pass context.velocityNode and the scene pass's depth, and keep the scene pass single-sampled. Reset
 * history on teleports and dispose with the owning stage/scene.
 */
export function createTemporalAA(
  colour: Node,
  depth: TextureNode,
  velocity: TextureNode,
  camera: PerspectiveCamera | OrthographicCamera,
) {
  const node = traa(colour, depth, velocity, camera);
  // Three 0.185.1 exposes no reset API. Isolate its pinned seams here: its resolve assumes one
  // raster, and its restart seed cannot express "publish this frame verbatim" across two rasters.
  const historyValid = uniform(1);
  const internals = node as unknown as ITemporalAANode;
  internals._historyValidUniform = historyValid;
  const frames = createTemporalAAFrame(internals, camera, depth, historyValid);
  let ownedViewOffset: { width: number; height: number } | null = null;
  const projection = new Matrix4().copy(camera.projectionMatrix);
  const setViewOffset = internals.setViewOffset.bind(node);
  const clearViewOffset = internals.clearViewOffset.bind(node);
  let pending: TemporalResetReason | null = "initial";
  let disposed = false;
  let report: ITemporalAAReport = {
    frame: 0,
    historyValid: false,
    resetReason: "initial",
    inputWidth: 0,
    inputHeight: 0,
    outputWidth: 0,
    outputHeight: 0,
  };

  internals.clearViewOffset = () => {
    try {
      clearViewOffset();
    } finally {
      ownedViewOffset = null;
    }
  };
  internals.setViewOffset = (width, height) => {
    // A node rebuild can request the initial sync after the pipeline already applied jitter.
    if (ownedViewOffset?.width === width && ownedViewOffset.height === height) return;
    // Upstream overwrites the camera aspect with the lattice's; the caller keeps its own framing.
    const aspect = (camera as PerspectiveCamera).aspect;
    if (ownedViewOffset !== null) camera.clearViewOffset();
    camera.updateProjectionMatrix();
    if (!camera.projectionMatrix.equals(projection)) pending ??= "projection-change";
    projection.copy(camera.projectionMatrix);
    setViewOffset(width, height);
    if ((camera as PerspectiveCamera).aspect !== aspect) {
      (camera as PerspectiveCamera).aspect = aspect;
      camera.updateProjectionMatrix();
    }
    ownedViewOffset = { width, height };
  };

  const setup = node.setup.bind(node);
  node.setup = (builder) => {
    // NodeBuilder schedules child passes before this update only when setup declares them. Upstream
    // TRAANode otherwise discovers these while drawing its resolve material, too late for same-frame
    // dimensions/depth. Follow Three's GaussianBlur/FSR1 pattern; runtime API, untyped here.
    const properties = (
      builder as unknown as { getNodeProperties(node: Node): Record<string, Node> }
    ).getNodeProperties(node);
    properties.temporalColour = node.beautyNode;
    properties.temporalDepth = depth;
    properties.temporalVelocity = velocity;
    const output = setup(builder);
    // Upstream's resolve is what this provider replaces, so the kernel that publishes a reset frame
    // runs by default instead of only in the experimental arm.
    internals._resolveMaterial.colorNode = createExperimentalTemporalResolve(
      node,
      builder.renderer,
      "linear",
    );
    const pipeline = (builder.context as { renderPipeline?: unknown }).renderPipeline as
      | { context: { onBeforeRenderPipeline?: () => void } }
      | undefined;
    if (pipeline !== undefined)
      pipeline.context.onBeforeRenderPipeline = () => frames.jitterInput(builder.renderer);
    // The declared input pass runs before TRAA.updateBefore on the first frame. VelocityNode
    // permanently selects its projection source when that pass's material first compiles, so prime
    // the unjittered matrix TRAA owns and it never compiles the jittered-camera route.
    if (ownedViewOffset === null) {
      camera.updateProjectionMatrix();
      internals._originalProjectionMatrix.copy(camera.projectionMatrix);
    }
    if (internals._velocityNode === null)
      throw new Error("Temporal AA requires a velocity accessor.");
    internals._velocityNode.setProjectionMatrix(internals._originalProjectionMatrix);
    return output;
  };

  node.updateBefore = (frame) => {
    if (disposed) throw new Error("Temporal AA is disposed.");
    if (frame.renderer === null) throw new Error("Temporal AA requires a renderer.");
    // Measured from the real GPU target, so a canvas label can never stand in for the raster.
    const source = frames.measure(frame.renderer);
    if (source === undefined) throw new Error("Temporal AA requires a materialized colour input.");
    const { x: width, y: height } = frames.input;
    for (const texture of [depth.value, velocity.value]) {
      if (texture.width !== width || texture.height !== height)
        throw new Error("Temporal AA colour, depth and velocity must share the same raster size.");
    }
    // Either raster moving invalidates history: the reprojected UVs and the stored depth no longer
    // describe the same sample positions.
    if (
      report.frame > 0 &&
      (width !== report.inputWidth ||
        height !== report.inputHeight ||
        frames.display.x !== report.outputWidth ||
        frames.display.y !== report.outputHeight)
    )
      pending = "resize";
    const reason = pending;
    try {
      frames.draw(frame.renderer, reason !== null);
      // Upstream's restart seed copies current colour over both targets. It only holds when the
      // rasters match; otherwise the verbatim resolve above already seeded history this frame.
      if (reason !== null && width === frames.display.x && height === frames.display.y) {
        frame.renderer.copyTextureToTexture(source.texture, internals._resolveRenderTarget.texture);
        frame.renderer.copyTextureToTexture(source.texture, internals._historyRenderTarget.texture);
      }
    } catch (error) {
      pending = "scene-reset";
      throw error;
    }
    report = {
      frame: report.frame + 1,
      historyValid: reason === null,
      resetReason: reason,
      inputWidth: width,
      inputHeight: height,
      outputWidth: frames.display.x,
      outputHeight: frames.display.y,
    };
    pending = null;
    return undefined;
  };

  return {
    node,
    report: (): ITemporalAAReport => report,
    resetHistory: (reason: TemporalResetReason = "scene-reset"): void => {
      if (disposed) throw new Error("Temporal AA is disposed.");
      pending = reason;
    },
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      frames.dispose();
      // A graph can be disposed after setup but before its first pipeline draw clears context.
      if (internals._velocityNode?.projectionMatrix === internals._originalProjectionMatrix) {
        if (ownedViewOffset !== null) internals.clearViewOffset();
        else internals._velocityNode.setProjectionMatrix(null);
      }
      node.dispose();
      // convertToTexture allocates an RTT only when the caller did not already supply a texture.
      if (internals.beautyNode !== colour && internals.beautyNode.isRTTNode) {
        internals.beautyNode.renderTarget?.dispose();
        (
          internals.beautyNode as unknown as { _quadMesh: { material: { dispose(): void } } }
        )._quadMesh.material.dispose();
      }
    },
  };
}
