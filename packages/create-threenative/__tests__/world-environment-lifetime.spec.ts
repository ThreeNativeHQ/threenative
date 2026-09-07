import { PerspectiveCamera, Scene } from "three";
import BloomNode from "three/addons/tsl/display/BloomNode.js";
import type { Node } from "three/webgpu";
import { expect, it, vi } from "vitest";
import { type OutputRenderer, WorldEnvironment } from "../template-assets/worldEnvironment.js";

it("releases the bloom effect and its materialized input when its chain is replaced", () => {
  const releases: ReturnType<typeof vi.fn>[] = [];
  const renderer: OutputRenderer = {
    kind: "webgpu",
    raw: {},
    createRenderChain(options) {
      const bloomStage = options.stages?.find((stage) => stage.name === "bloom");
      if (bloomStage === undefined) throw new Error("bloom stage missing");
      const graph = bloomStage.build(options.input, { tier: "low" }) as Node;
      graph.traverse((node) => {
        if (!(node instanceof BloomNode)) return;
        releases.push(vi.spyOn(node, "dispose"));
        const scratch = node.inputNode as unknown as {
          renderTarget: { dispose(): void };
          _quadMesh: { material: { dispose(): void } };
        };
        releases.push(vi.spyOn(scratch.renderTarget, "dispose"));
        releases.push(vi.spyOn(scratch._quadMesh.material, "dispose"));
      });
      return {
        applied: { stages: ["bloom"], dropped: [] },
        dispose: () => bloomStage.dispose?.(),
      };
    },
  };
  const applied = new WorldEnvironment({ bloomEnabled: true }).apply(
    renderer,
    new Scene(),
    new PerspectiveCamera(),
  );
  expect(releases).toHaveLength(3);
  applied.dispose?.();
  for (const release of releases) expect(release).toHaveBeenCalledTimes(1);
});
