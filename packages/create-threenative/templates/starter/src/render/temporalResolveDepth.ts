// Generated user source: the temporal kernel's depth rejection. Split out of `temporalResolve.ts`
// so each file stays readable; the equations are unchanged.
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
import type { Matrix4, OrthographicCamera, Vector2 } from "three";
import type TRAANode from "three/addons/tsl/display/TRAANode.js";
import {
  Fn,
  If,
  float,
  getViewPosition,
  logarithmicDepthToViewZ,
  struct,
  vec2,
  vec4,
  viewZToOrthographicDepth,
  viewZToPerspectiveDepth,
} from "three/tsl";
import type { Node, RenderTarget, TextureNode } from "three/webgpu";

/** A TSL uniform node: the shader reads it as a node, this reconstruction writes its value. */
export interface ITemporalUniform<T> {
  value: T;
}

/**
 * The pinned TRAANode seams this reconstruction reads.
 *
 * Declared here, beside its first reader, so `temporalAA.ts` and `temporalAAFrame.ts` name the
 * same shape — and so a three.js version that drops one of them fails the seam guard in
 * `temporalAA.ts` rather than reading `undefined` on a GPU.
 */
export interface ITemporalResolvePinned {
  _historyRenderTarget: RenderTarget;
  _resolveRenderTarget: RenderTarget;
  _previousDepthNode: TextureNode;
  _cameraNearFar: Node<"vec2"> & ITemporalUniform<Vector2>;
  _cameraWorldMatrix: Node<"mat4"> & ITemporalUniform<Matrix4>;
  _cameraWorldMatrixInverse: Node<"mat4"> & ITemporalUniform<Matrix4>;
  _cameraProjectionMatrixInverse: Node<"mat4"> & ITemporalUniform<Matrix4>;
  _previousCameraWorldMatrix: Node<"mat4"> & ITemporalUniform<Matrix4>;
  _previousCameraProjectionMatrixInverse: Node<"mat4"> & ITemporalUniform<Matrix4>;
  /** Installed by `createTemporalAA`. 0 on a reset frame, which then weights current colour only. */
  _historyValidUniform?: ITemporalUniform<number>;
}

export type TemporalResolveNode = TRAANode & ITemporalResolvePinned;

/** The 3×3 neighbourhood depth test that decides whether last frame's colour is still legal. */
export function createTemporalDepthRejection(
  node: TemporalResolveNode,
  renderer: { reversedDepthBuffer: boolean; logarithmicDepthBuffer: boolean },
) {
  const toPerspectiveDepth = (depth: Node<"float">) => {
    const { x: near, y: far } = node._cameraNearFar;
    return viewZToPerspectiveDepth(logarithmicDepthToViewZ(depth, near, far), near, far);
  };
  const currentDepthStruct = struct({
    closestDepth: "float",
    closestPositionTexel: "vec2",
    farthestDepth: "float",
  });
  // Samples 3×3 neighborhood pixels and returns the closest and farthest depths.
  const currentDepth = Fn(([positionTexel]: [Node<"vec2">]) => {
    const closestDepth = float(2).toVar();
    const closestPositionTexel = vec2(0).toVar();
    const farthestDepth = float(-1).toVar();
    for (let x = -1; x <= 1; ++x)
      for (let y = -1; y <= 1; ++y) {
        const neighbor = positionTexel.add(vec2(x, y)).toVar();
        let depth = node.depthNode.load(neighbor).r;
        if (renderer.reversedDepthBuffer) depth = depth.oneMinus();
        if (renderer.logarithmicDepthBuffer) depth = toPerspectiveDepth(depth);
        depth = depth.toVar();
        If(depth.lessThan(closestDepth), () => {
          closestDepth.assign(depth);
          closestPositionTexel.assign(neighbor);
        });
        If(depth.greaterThan(farthestDepth), () => {
          farthestDepth.assign(depth);
        });
      }
    return currentDepthStruct(closestDepth, closestPositionTexel, farthestDepth);
  });
  // Samples a previous depth and reprojects it using the current camera matrices.
  const previousDepth = (historyUV: Node<"vec2">) => {
    let depth = node._previousDepthNode.sample(historyUV).r;
    if (renderer.logarithmicDepthBuffer) depth = toPerspectiveDepth(depth);
    const positionView = getViewPosition(
      historyUV,
      depth,
      node._previousCameraProjectionMatrixInverse,
    );
    const positionWorld = node._previousCameraWorldMatrix.mul(vec4(positionView, 1)).xyz;
    const viewZ = node._cameraWorldMatrixInverse.mul(vec4(positionWorld, 1)).z;
    const { x: near, y: far } = node._cameraNearFar;
    return (node.camera as OrthographicCamera).isOrthographicCamera
      ? viewZToOrthographicDepth(viewZ, near, far)
      : viewZToPerspectiveDepth(viewZ, near, far);
  };
  return { currentDepth, previousDepth };
}
