// Generated user source: the temporal resolve kernel. It allocates no target, applies no jitter and
// owns no loop. The default arm is what `temporalAA.ts` installs, so every published frame comes
// from this kernel; `temporalResolveMath.ts` and `temporalResolveDepth.ts` hold its equations.
// Derived resolve source: three/examples/jsm/tsl/display/TRAANode.js (pinned 0.185.1).
import type TRAANode from "three/addons/tsl/display/TRAANode.js";
import { Fn, add, float, int, luminance, max, mix, texture, uv } from "three/tsl";
import type { Node } from "three/webgpu";
import {
  type TemporalDepthRejection,
  type TemporalResolveNode,
  createTemporalDepthRejection,
} from "./temporalResolveDepth.js";
import { createTemporalResolveMath, sampleCatmullRom } from "./temporalResolveMath.js";

export { CATMULL_ROM_BASIS } from "./temporalResolveMath.js";

/** Returns the amount of subpixel (expressed within [0, 1]) in the velocity. */
const subpixelCorrection = Fn(([velocityUV, textureSize]: [Node<"vec2">, Node<"uvec2">]) => {
  const velocityTexel = velocityUV.mul(textureSize);
  const phase = velocityTexel.fract().abs();
  const weight = max(phase, phase.oneMinus());
  return weight.x.mul(weight.y).oneMinus().div(0.75);
}).setLayout({
  name: "subpixelCorrection",
  type: "float",
  inputs: [
    { name: "velocityUV", type: "vec2" },
    { name: "textureSize", type: "ivec2" },
  ],
});

/** Flicker reduction based on luminance weighing. */
const flickerReduction = Fn(
  ([currentColor, historyColor, currentWeight]: [Node<"vec4">, Node<"vec4">, Node<"float">]) => {
    const historyWeight = currentWeight.oneMinus();
    const compressedCurrent = currentColor.mul(
      float(1).div(max(currentColor.r, currentColor.g, currentColor.b).add(1)),
    );
    const compressedHistory = historyColor.mul(
      float(1).div(max(historyColor.r, historyColor.g, historyColor.b).add(1)),
    );
    const luminanceCurrent = luminance(compressedCurrent.rgb);
    const luminanceHistory = luminance(compressedHistory.rgb);
    currentWeight.mulAssign(float(1).div(luminanceCurrent.add(1)));
    historyWeight.mulAssign(float(1).div(luminanceHistory.add(1)));
    return add(currentColor.mul(currentWeight), historyColor.mul(historyWeight))
      .div(max(currentWeight.add(historyWeight), 0.00001))
      .toVar();
  },
);

/**
 * Build the resolve node. Reuse the installed node's depth/history uniforms and lifetime; replace
 * only its resolve.
 *
 * `interpolation` and `blend` are the comparison arms: linear against Catmull–Rom history sampling,
 * and luminance reweighting against an ordinary blend at the same weight. The default here keeps
 * upstream's luminance comparison; the provider selects an ordinary blend for linear coverage.
 */
export function createExperimentalTemporalResolve(
  source: TRAANode,
  renderer: { reversedDepthBuffer: boolean; logarithmicDepthBuffer: boolean },
  interpolation: "linear" | "catmull-rom",
  blend: "luminance" | "ordinary" = "luminance",
  rejection: TemporalDepthRejection = createTemporalDepthRejection(
    source as TemporalResolveNode,
    renderer,
  ),
) {
  const node = source as TemporalResolveNode;
  const { historyValidity } = rejection;
  const { varianceClipping } = createTemporalResolveMath(node);
  const historyNode = texture(node._historyRenderTarget.texture);

  const resolve = Fn(() => {
    const uvNode = uv();
    // Two rasters: colour, depth and velocity share the input one, resolve and history are display
    // sized. Every gather below reads the input lattice; the history sample stays a normalized UV,
    // and the motion weight and subpixel correction count display pixels.
    const inputSize = node.beautyNode.size(int(0)) as Node<"uvec2">;
    const positionTexel = uvNode.mul(inputSize);
    const displaySize = historyNode.size(int(0)) as Node<"uvec2">;
    const validity = historyValidity(uvNode);
    const hasValidHistory = validity.get("hasValidHistory") as Node<"float">;
    const historyUV = validity.get("historyUV") as Node<"vec2">;
    const offsetUV = validity.get("offsetUV") as Node<"vec2">;
    const currentColor = node.beautyNode.sample(uvNode);
    const historyColor =
      interpolation === "linear"
        ? historyNode.sample(historyUV)
        : sampleCatmullRom(historyNode, historyUV).max(0);
    const motionFactor = uvNode
      .sub(historyUV)
      .mul(displaySize)
      .length()
      .div(node.maxVelocityLength)
      .saturate();
    const currentWeight = float(0.05).toVar(); // A minimum weight
    if (node.useSubpixelCorrection) {
      // Increase the minimum weight towards the current frame when the velocity is more subpixel.
      currentWeight.addAssign(subpixelCorrection(offsetUV, displaySize).mul(0.25));
    }
    currentWeight.assign(hasValidHistory.select(currentWeight.add(motionFactor).saturate(), 1));
    // Reasonable gamma range is [0.75, 2]
    const varianceGamma = mix(0.5, 1, motionFactor.oneMinus().pow2());
    const clippedHistoryColor = varianceClipping(positionTexel, historyColor, varianceGamma);
    // Keep the computed weight in production; luminance reweighting remains a comparison arm.
    return blend === "ordinary"
      ? mix(clippedHistoryColor, currentColor, currentWeight)
      : flickerReduction(currentColor, clippedHistoryColor, currentWeight);
  });
  return resolve();
}
