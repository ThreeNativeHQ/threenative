// Generated user source: opt-in full-resolution temporal AA using pinned Three.js TRAANode.
// This is not an upscaler. Colour, depth and velocity must share the same raster dimensions.
import { Matrix4, type OrthographicCamera, type PerspectiveCamera } from "three";
import { traa } from "three/addons/tsl/display/TRAANode.js";
import type { Node, RenderTarget, TextureNode } from "three/webgpu";

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
 * pass context.velocityNode and the scene pass's depth. Keep the scene pass single-sampled.
 * Call resetHistory("camera-cut") on teleports and dispose with the owning stage/scene.
 */
export function createTemporalAA(
  colour: Node,
  depth: TextureNode,
  velocity: TextureNode,
  camera: PerspectiveCamera | OrthographicCamera,
) {
  const node = traa(colour, depth, velocity, camera);
  // Three 0.185.1 exposes no reset API. Isolate its pinned target seams here: its own resize
  // restart seeds the history from current colour, which also prevents stale colour after cuts.
  const internals = node as unknown as {
    beautyNode: TextureNode & {
      isRTTNode?: boolean;
      renderTarget?: RenderTarget;
      passNode?: { renderTarget: RenderTarget };
    };
    _historyRenderTarget: RenderTarget;
    _resolveRenderTarget: RenderTarget;
    setViewOffset(width: number, height: number): void;
  };
  const projection = new Matrix4().copy(camera.projectionMatrix);
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
  const updateBefore = node.updateBefore.bind(node);
  const setViewOffset = internals.setViewOffset.bind(node);
  internals.setViewOffset = (width, height) => {
    camera.updateProjectionMatrix();
    if (!camera.projectionMatrix.equals(projection)) pending ??= "projection-change";
    projection.copy(camera.projectionMatrix);
    setViewOffset(width, height);
  };
  node.updateBefore = (frame) => {
    if (disposed) throw new Error("Temporal AA is disposed.");
    if (frame.renderer === null) throw new Error("Temporal AA requires a renderer.");
    const source = internals.beautyNode.isRTTNode
      ? internals.beautyNode.renderTarget
      : internals.beautyNode.passNode?.renderTarget;
    if (source === undefined) throw new Error("Temporal AA requires a materialized colour input.");
    const { width, height } = source;
    for (const texture of [depth.value, velocity.value]) {
      if (texture.width !== width || texture.height !== height)
        throw new Error("Temporal AA colour, depth and velocity must share the same raster size.");
    }
    if (report.frame > 0 && (width !== report.inputWidth || height !== report.inputHeight))
      pending = "resize";
    const reason = pending;
    try {
      updateBefore(frame);
      if (reason !== null) {
        // Seeding history before resolve is insufficient: motion would still sample that seed
        // at shifted UVs. Publish this frame verbatim, then seed next frame, after upstream has
        // updated dimensions, depth and camera bookkeeping. A reset intentionally skips AA once.
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
      outputWidth: internals._resolveRenderTarget.width,
      outputHeight: internals._resolveRenderTarget.height,
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
