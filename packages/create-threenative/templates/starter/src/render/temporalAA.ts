// Generated user source: opt-in temporal AA using pinned Three.js TRAANode. Colour, depth and velocity
// share the scene pass raster, which may sit below the display raster; resolve and history hold the
// display raster, so presented pixels come from a display-sized resolve, not an upscaled copy.
import { Matrix4, type OrthographicCamera, type PerspectiveCamera } from "three";
import { traa } from "three/addons/tsl/display/TRAANode.js";
import { uniform } from "three/tsl";
import type { Node, TextureNode } from "three/webgpu";
import { type ITemporalAANode, createTemporalAAFrame } from "./temporalAAFrame.js";
import { type PipelineContext, createTemporalAAHooks } from "./temporalAAHooks.js";
import type { ITemporalRejectionMeasurement } from "./temporalRejectionCounter.js";
import { createExperimentalTemporalResolve } from "./temporalResolve.js";
import {
  type TemporalDepthRejection,
  type TemporalResolveNode,
  createTemporalDepthRejection,
} from "./temporalResolveDepth.js";

export type TemporalResetReason =
  | "initial"
  | "camera-cut"
  | "projection-change"
  | "resize"
  | "scene-reset"
  | "device-loss";
export interface ITemporalAAReport {
  readonly frame: number;
  readonly historyValid: boolean;
  readonly resetReason: TemporalResetReason | null;
  readonly inputWidth: number;
  readonly inputHeight: number;
  readonly outputWidth: number;
  readonly outputHeight: number;
  /** Absent until a counted copy lands, never a number the provider did not measure. */
  readonly rejection?: ITemporalRejectionMeasurement;
}

/** Reuse TRAANode's jitter, depth rejection and variance clipping. In a RenderChain `traa` factory
 * pass context.velocityNode and the scene pass's depth, keep the scene pass single-sampled, reset
 * history on teleports, and dispose with the owning stage. */
export function createTemporalAA(
  colour: Node,
  depth: TextureNode,
  velocity: TextureNode,
  camera: PerspectiveCamera | OrthographicCamera,
) {
  const node = traa(colour, depth, velocity, camera);
  // Three 0.185.1 exposes no reset API, so its pinned seams are isolated here instead.
  const historyValid = uniform(1);
  const internals = node as unknown as ITemporalAANode;
  internals._historyValidUniform = historyValid;
  // One instance of the depth-rejection equations, shared by the resolve, the counter and every
  // recompile, so a measured fraction cannot describe a different decision than the one drawn.
  let rejection: TemporalDepthRejection | undefined;
  const frames = createTemporalAAFrame(internals, camera, depth, historyValid, () => rejection);
  const hooks = createTemporalAAHooks(frames.jitterInput);
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
  internals.setViewOffset = (width: number, height: number) => {
    if (ownedViewOffset?.width === width && ownedViewOffset?.height === height) return;
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
    // NodeBuilder schedules child passes only when setup declares them; upstream finds them too late.
    const properties = (
      builder as unknown as { getNodeProperties(node: Node): Record<string, Node> }
    ).getNodeProperties(node);
    properties.temporalColour = node.beautyNode;
    properties.temporalDepth = depth;
    properties.temporalVelocity = velocity;
    const pipeline = (builder.context as { renderPipeline?: { context: PipelineContext } })
      .renderPipeline;
    // The originals are read before upstream's setup writes the node's own pair over them.
    if (pipeline !== undefined) hooks.captureBeforeSetup(pipeline.context);
    const output = setup(builder);
    rejection ??= createTemporalDepthRejection(node as TemporalResolveNode, builder.renderer);
    // Upstream's resolve is what this replaces, so the reset kernel runs by default.
    internals._resolveMaterial.colorNode = createExperimentalTemporalResolve(
      node,
      builder.renderer,
      "linear",
      "luminance",
      rejection,
    );
    if (pipeline !== undefined) hooks.installAfterSetup(pipeline.context, builder.renderer);
    // VelocityNode keeps whichever projection source that input pass first compiles: prime ours.
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
    try {
      if (frame.renderer === null) throw new Error("Temporal AA requires a renderer.");
      const source = frames.measure(frame.renderer);
      if (source === undefined)
        throw new Error("Temporal AA requires a materialized colour input.");
      const { x: width, y: height } = frames.input;
      for (const texture of [depth.value, velocity.value]) {
        if (texture.width !== width || texture.height !== height)
          throw new Error(
            "Temporal AA colour, depth and velocity must share the same raster size.",
          );
      }
      // Either raster moving invalidates history: UVs and depth no longer name the same samples.
      if (
        report.frame > 0 &&
        (width !== report.inputWidth ||
          height !== report.inputHeight ||
          frames.display.x !== report.outputWidth ||
          frames.display.y !== report.outputHeight)
      )
        pending = "resize";
      const reason = pending;
      frames.draw(frame.renderer, reason !== null, report.frame + 1);
      if (reason !== null && width === frames.display.x && height === frames.display.y) {
        frame.renderer.copyTextureToTexture(source.texture, internals._resolveRenderTarget.texture);
        frame.renderer.copyTextureToTexture(source.texture, internals._historyRenderTarget.texture);
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
    } catch (error) {
      pending = "scene-reset";
      throw error;
    }
  };
  return {
    node,
    // Omitted rather than undefined, so a report carrying none stays JSON-safe for a bridge.
    report: (): ITemporalAAReport => {
      const measured = frames.rejection();
      return { ...report, ...(measured === undefined ? {} : { rejection: measured }) };
    },
    rejectionMeasurement: frames.drainRejection,
    settledRejection: frames.settledRejection,
    resetHistory: (reason: TemporalResetReason = "scene-reset"): void => {
      if (disposed) throw new Error("Temporal AA is disposed.");
      pending = reason;
    },
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      hooks.dispose();
      frames.dispose();
      if (internals._velocityNode?.projectionMatrix === internals._originalProjectionMatrix) {
        if (ownedViewOffset !== null) internals.clearViewOffset();
        else internals._velocityNode.setProjectionMatrix(null);
      }
      node.dispose();
      if (internals.beautyNode !== colour && internals.beautyNode.isRTTNode) {
        internals.beautyNode.renderTarget?.dispose();
        (
          internals.beautyNode as unknown as { _quadMesh: { material: { dispose(): void } } }
        )._quadMesh.material.dispose();
      }
    },
  };
}
