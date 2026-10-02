// Experimental game-owned resolve. It allocates no target, applies no jitter and owns no loop.
// The linear arm intentionally preserves Three.js 0.185.1 TRAANode's resolve for pixel comparison.
// Derived resolve source: three/examples/jsm/tsl/display/TRAANode.js (pinned 0.185.1).
/*
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
import type { OrthographicCamera } from "three";
import type TRAANode from "three/addons/tsl/display/TRAANode.js";
import {
  Fn,
  If,
  add,
  float,
  getViewPosition,
  int,
  ivec2,
  logarithmicDepthToViewZ,
  luminance,
  max,
  mix,
  struct,
  texture,
  uv,
  vec2,
  vec4,
  viewZToOrthographicDepth,
  viewZToPerspectiveDepth,
} from "three/tsl";
import type { Node, RenderTarget, TextureNode } from "three/webgpu";

// Polynomial coefficients, ascending power, for samples at -1, 0, 1 and 2.
export const CATMULL_ROM_BASIS = [
  [0, -0.5, 1, -0.5],
  [1, 0, -2.5, 1.5],
  [0, 0.5, 2, -1.5],
  [0, 0, -0.5, 0.5],
] as const;

/** Nine bilinear taps reproduce the separable sixteen-tap Catmull–Rom kernel. */
function sampleCatmullRom(source: TextureNode, coordinate: Node<"vec2">) {
  return Fn(() => {
    const size = vec2(source.size(int(0)) as Node<"uvec2">);
    const position = coordinate.mul(size).sub(0.5);
    const centre = position.floor().add(0.5);
    const phase = position.fract();
    const polynomial = (row: readonly [number, number, number, number]) =>
      phase.mul(row[3]).add(row[2]).mul(phase).add(row[1]).mul(phase).add(row[0]);
    const w0 = polynomial(CATMULL_ROM_BASIS[0]);
    const w1 = polynomial(CATMULL_ROM_BASIS[1]);
    const w2 = polynomial(CATMULL_ROM_BASIS[2]);
    const w3 = polynomial(CATMULL_ROM_BASIS[3]);
    const middle = w1.add(w2);
    const p0 = centre.sub(1).div(size);
    const p12 = centre.add(w2.div(middle)).div(size);
    const p3 = centre.add(2).div(size);
    const result = vec4(0).toVar();
    const xs = [
      [p0.x, w0.x],
      [p12.x, middle.x],
      [p3.x, w3.x],
    ] as const;
    const ys = [
      [p0.y, w0.y],
      [p12.y, middle.y],
      [p3.y, w3.y],
    ] as const;
    for (const [x, wx] of xs)
      for (const [y, wy] of ys) result.addAssign(source.sample(vec2(x, y)).mul(wx).mul(wy));
    return result;
  })();
}

interface IPinnedResolveState {
  _historyRenderTarget: RenderTarget;
  _previousDepthNode: TextureNode;
  _cameraNearFar: Node<"vec2">;
  _previousCameraProjectionMatrixInverse: Node<"mat4">;
  _previousCameraWorldMatrix: Node<"mat4">;
  _cameraWorldMatrixInverse: Node<"mat4">;
}

/** Reuse the installed node's depth/history uniforms and lifetime; replace only its resolve. */
export function createExperimentalTemporalResolve(
  source: TRAANode,
  renderer: { reversedDepthBuffer: boolean; logarithmicDepthBuffer: boolean },
  interpolation: "linear" | "catmull-rom",
  blend: "luminance" | "ordinary" = "luminance",
) {
  const node = source as TRAANode & IPinnedResolveState;
  const logarithmicToPerspectiveDepth = (depth: Node<"float">) => {
    const { x: near, y: far } = node._cameraNearFar;
    const viewZ = logarithmicDepthToViewZ(depth, near, far);
    return viewZToPerspectiveDepth(viewZ, near, far);
  };

  const currentDepthStruct = struct({
    closestDepth: "float",
    closestPositionTexel: "vec2",
    farthestDepth: "float",
  });

  // Samples 3×3 neighborhood pixels and returns the closest and farthest depths.
  const sampleCurrentDepth = Fn(([positionTexel]: [Node<"vec2">]) => {
    const closestDepth = float(2).toVar();
    const closestPositionTexel = vec2(0).toVar();
    const farthestDepth = float(-1).toVar();

    for (let x = -1; x <= 1; ++x) {
      for (let y = -1; y <= 1; ++y) {
        const neighbor = positionTexel.add(vec2(x, y)).toVar();
        let depth = node.depthNode.load(neighbor).r;
        if (renderer.reversedDepthBuffer) depth = depth.oneMinus();
        if (renderer.logarithmicDepthBuffer) depth = logarithmicToPerspectiveDepth(depth);
        depth = depth.toVar();

        If(depth.lessThan(closestDepth), () => {
          closestDepth.assign(depth);
          closestPositionTexel.assign(neighbor);
        });

        If(depth.greaterThan(farthestDepth), () => {
          farthestDepth.assign(depth);
        });
      }
    }

    return currentDepthStruct(closestDepth, closestPositionTexel, farthestDepth);
  });

  // Samples a previous depth and reproject it using the current camera matrices.
  const samplePreviousDepth = (uv: Node<"vec2">) => {
    let depth = node._previousDepthNode.sample(uv).r;
    if (renderer.logarithmicDepthBuffer) depth = logarithmicToPerspectiveDepth(depth);
    const positionView = getViewPosition(uv, depth, node._previousCameraProjectionMatrixInverse);
    const positionWorld = node._previousCameraWorldMatrix.mul(vec4(positionView, 1)).xyz;
    const viewZ = node._cameraWorldMatrixInverse.mul(vec4(positionWorld, 1)).z;
    return (node.camera as OrthographicCamera).isOrthographicCamera
      ? viewZToOrthographicDepth(viewZ, node._cameraNearFar.x, node._cameraNearFar.y)
      : viewZToPerspectiveDepth(viewZ, node._cameraNearFar.x, node._cameraNearFar.y);
  };

  // Optimized version of AABB clipping.
  // Reference: https://github.com/playdeadgames/temporal
  const clipAABB = Fn(
    ([currentColor, historyColor, minColor, maxColor]: [
      Node<"vec4">,
      Node<"vec4">,
      Node<"vec4">,
      Node<"vec4">,
    ]) => {
      const pClip = maxColor.rgb.add(minColor.rgb).mul(0.5);
      const eClip = maxColor.rgb.sub(minColor.rgb).mul(0.5).add(1e-7);
      const vClip = historyColor.sub(vec4(pClip, currentColor.a));
      const vUnit = vClip.xyz.div(eClip);
      const absUnit = vUnit.abs();
      const maxUnit = max(absUnit.x, absUnit.y, absUnit.z);
      return maxUnit
        .greaterThan(1)
        .select(vec4(pClip, currentColor.a).add(vClip.div(maxUnit)), historyColor);
    },
  ).setLayout({
    name: "clipAABB",
    type: "vec4",
    inputs: [
      { name: "currentColor", type: "vec4" },
      { name: "historyColor", type: "vec4" },
      { name: "minColor", type: "vec4" },
      { name: "maxColor", type: "vec4" },
    ],
  });

  // Performs variance clipping.
  // See: https://developer.download.nvidia.com/gameworks/events/GDC2016/msalvi_temporal_supersampling.pdf
  const varianceClipping = Fn(
    ([positionTexel, currentColor, historyColor, gamma]: [
      Node<"vec2">,
      Node<"vec4">,
      Node<"vec4">,
      Node<"float">,
    ]) => {
      const offsets = [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, 0],
      ];

      const moment1 = currentColor.toVar();
      const moment2 = currentColor.pow2().toVar();

      for (const [x, y] of offsets) {
        // Use max() to prevent NaN values from propagating.
        const neighbor = node.beautyNode.offset(ivec2(x, y)).load(positionTexel).max(0);
        moment1.addAssign(neighbor);
        moment2.addAssign(neighbor.pow2());
      }

      const N = float(offsets.length + 1);
      const mean = moment1.div(N);
      const variance = moment2.div(N).sub(mean.pow2()).max(0).sqrt().mul(gamma);
      const minColor = mean.sub(variance);
      const maxColor = mean.add(variance);

      return clipAABB(mean.clamp(minColor, maxColor), historyColor, minColor, maxColor);
    },
  );

  // Returns the amount of subpixel (expressed within [0, 1]) in the velocity.
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

  // Flicker reduction based on luminance weighing.
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

  const historyNode = texture(node._historyRenderTarget.texture);

  const resolve = Fn(() => {
    const uvNode = uv();
    const textureSize = node.beautyNode.size(int(0)) as Node<"uvec2">; // Assumes all the buffers share the same size.
    const positionTexel = uvNode.mul(textureSize);

    // sample the closest and farthest depths in the current buffer

    const currentDepth = sampleCurrentDepth(positionTexel);
    const closestDepth = currentDepth.get("closestDepth") as Node<"float">;
    const closestPositionTexel = currentDepth.get("closestPositionTexel") as Node<"vec2">;
    const farthestDepth = currentDepth.get("farthestDepth") as Node<"float">;

    // convert the NDC offset to UV offset

    const offsetUV = node.velocityNode.load(closestPositionTexel).xy.mul(vec2(0.5, -0.5));

    // sample the previous depth

    const historyUV = uvNode.sub(offsetUV);
    const previousDepth = samplePreviousDepth(historyUV);

    // history is considered valid when the UV is in range and there's no disocclusion except on edges

    const isValidUV = historyUV.greaterThanEqual(0).all().and(historyUV.lessThanEqual(1).all());
    const isEdge = farthestDepth.sub(closestDepth).greaterThan(node.edgeDepthDiff);
    const isDisocclusion = closestDepth.sub(previousDepth).greaterThan(node.depthThreshold);
    const hasValidHistory = isValidUV.and(isEdge.or(isDisocclusion.not()));

    // sample the current and previous colors

    const currentColor = node.beautyNode.sample(uvNode);
    const historyColor =
      interpolation === "linear"
        ? historyNode.sample(uvNode.sub(offsetUV))
        : sampleCatmullRom(historyNode, uvNode.sub(offsetUV)).max(0);

    // increase the weight towards the current frame under motion

    const motionFactor = uvNode
      .sub(historyUV)
      .mul(textureSize)
      .length()
      .div(node.maxVelocityLength)
      .saturate();
    const currentWeight = float(0.05).toVar(); // A minimum weight

    if (node.useSubpixelCorrection) {
      // Increase the minimum weight towards the current frame when the velocity is more subpixel.
      currentWeight.addAssign(subpixelCorrection(offsetUV, textureSize).mul(0.25));
    }

    currentWeight.assign(hasValidHistory.select(currentWeight.add(motionFactor).saturate(), 1));

    // Perform neighborhood clipping/clamping. We use variance clipping here.

    const varianceGamma = mix(0.5, 1, motionFactor.oneMinus().pow2()); // Reasonable gamma range is [0.75, 2]
    const clippedHistoryColor = varianceClipping(
      positionTexel,
      currentColor,
      historyColor,
      varianceGamma,
    );

    // flicker reduction based on luminance weighing

    // Diagnostic only: ordinary blending isolates luminance reweighting at the same weight.
    const output =
      blend === "ordinary"
        ? mix(clippedHistoryColor, currentColor, currentWeight)
        : flickerReduction(currentColor, clippedHistoryColor, currentWeight);

    return output;
  });

  return resolve();
}
