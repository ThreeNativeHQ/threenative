import { PerspectiveCamera, Scene } from "three";
import { pass } from "three/tsl";
import { type NodeBuilder, VelocityNode } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { createTemporalAA } from "../templates/starter/src/render/temporalAA.js";

describe("temporal AA first world-material compile", () => {
  it("selects the explicit unjittered velocity uniform before the input pass compiles", () => {
    const camera = new PerspectiveCamera(50, 16 / 9);
    const scenePass = pass(new Scene(), camera);
    const accessor = new VelocityNode();
    const temporal = createTemporalAA(
      scenePass.getTextureNode(),
      scenePass.getTextureNode("depth"),
      scenePass.getTextureNode("velocity"),
      camera,
    );
    temporal.node.setup({
      context: { velocity: accessor, renderPipeline: { context: {} } },
      renderer: {},
      getNodeProperties: () => ({}),
    } as unknown as NodeBuilder);
    // The input-pass dependency executes before temporal.updateBefore. VelocityNode.setup
    // permanently selects the current-projection source while that first material compiles.
    const motion = accessor.setup({} as NodeBuilder);
    if (motion === null || motion === undefined)
      throw new Error("Velocity accessor returned no graph");
    const explicitMatrices: unknown[] = [];
    motion.traverse((node) => {
      if ("value" in node) explicitMatrices.push(node.value);
    });
    expect(accessor.projectionMatrix).not.toBeNull();
    expect(explicitMatrices).toContain(accessor.projectionMatrix);
    expect(accessor.projectionMatrix?.equals(camera.projectionMatrix)).toBe(true);
    expect(camera.view?.enabled ?? false).toBe(false);
    temporal.dispose();
    expect(accessor.projectionMatrix).toBeNull();
    scenePass.dispose();
  });
});
