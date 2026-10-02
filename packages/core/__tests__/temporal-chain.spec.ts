import { PerspectiveCamera, Scene } from "three";
import TRAANode from "three/addons/tsl/display/TRAANode.js";
import { pass, velocity } from "three/tsl";
import type { Node, NodeBuilder, TextureNode } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { RenderChain } from "../src/render/chain.js";

describe("the pinned TRAANode render-chain contract", () => {
  it("keeps the sampled velocity texture separate from the jitter accessor", () => {
    const camera = new PerspectiveCamera(50, 1280 / 720);
    const scenePass = pass(new Scene(), camera);
    let graph: unknown;
    let temporal: TRAANode | undefined;
    let sampledVelocity: Node | undefined;
    const chain = new RenderChain({
      renderer: {
        kind: "webgpu",
        raw: {},
        setOutputNode: (node) => {
          graph = node;
        },
      },
      input: scenePass.getTextureNode(),
      request: { stages: ["traa"], velocity: { pass: scenePass } },
      report: () => {},
      stages: [
        {
          name: "traa",
          build: (input, context) => {
            sampledVelocity = context.velocityNode;
            temporal = new TRAANode(
              input as TextureNode,
              scenePass.getTextureNode("depth"),
              context.velocityNode as TextureNode,
              camera,
            );
            return temporal;
          },
        },
      ],
    });
    expect(chain.applied.stages).toEqual(["traa"]);
    expect(sampledVelocity).toBe(scenePass.getTextureNode("velocity"));
    const wrapped = graph as { value: { velocity: unknown } };
    temporal?.setup({
      context: { ...wrapped.value, renderPipeline: { context: {} } },
      renderer: {},
    } as unknown as NodeBuilder);
    const jitter = temporal as unknown as {
      setViewOffset(width: number, height: number): void;
      clearViewOffset(): void;
    };
    try {
      expect(() => jitter.setViewOffset(1280, 720)).not.toThrow();
      expect(wrapped.value.velocity).toBe(velocity);
      expect(camera.view?.enabled).toBe(true);
    } finally {
      // A failed assertion must not leave Three's singleton velocity accessor jittered.
      if (wrapped.value.velocity === velocity) jitter.clearViewOffset();
      temporal?.dispose();
      chain.dispose();
      scenePass.dispose();
    }
    expect(camera.view?.enabled).toBe(false);
  });
});
