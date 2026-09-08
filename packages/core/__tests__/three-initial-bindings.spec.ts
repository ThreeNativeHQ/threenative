import { DepthTexture } from "three";
// @ts-expect-error Three's private binding manager has no public declarations.
import Bindings from "three/src/renderers/common/Bindings.js";
// @ts-expect-error Exercise Three's real node-based texture reference binding.
import { NodeSampledTexture } from "three/src/renderers/common/nodes/NodeSampledTexture.js";
// @ts-expect-error Exercise Three's real node-based sampler reference binding.
import NodeSampler from "three/src/renderers/common/nodes/NodeSampler.js";
import { describe, expect, it } from "vitest";

describe("initial GPU bindings after asynchronous node compilation", () => {
  it.each(["texture", "sampler"])(
    "uses the node's current %s reference before creating the first bind group",
    (kind) => {
      const previousDepth = new DepthTexture(1280, 720);
      const currentDepth = new DepthTexture(1, 1);
      const node = { value: previousDepth };
      const binding =
        kind === "texture"
          ? new NodeSampledTexture("depth", node, {})
          : new NodeSampler("depthSampler", node);
      const uploaded: DepthTexture[] = [];
      const bound: DepthTexture[] = [];
      const group = { bindings: [binding] };
      const manager = new Bindings(
        { createBindings: () => bound.push(binding.texture) },
        {},
        {
          updateTexture: (texture: DepthTexture) => uploaded.push(texture),
          updateSampler: (sampler: { texture: DepthTexture }) => uploaded.push(sampler.texture),
        },
        {},
        {},
        {},
      );

      // A viewport node can switch from the scene's MSAA depth copy to the output target
      // while compileAsync yields. Its binding still holds the previous reference.
      node.value = currentDepth;
      manager.getForRender({ getBindings: () => [group] });

      expect(uploaded).toEqual([currentDepth]);
      expect(bound).toEqual([currentDepth]);
      expect(binding.texture).toBe(currentDepth);
    },
  );
});
