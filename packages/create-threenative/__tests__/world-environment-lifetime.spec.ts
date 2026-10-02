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

it("owns the direct base-colour graph without requiring an unrelated post stage", () => {
  const releases: ReturnType<typeof vi.fn>[] = [];
  const worldPasses: unknown[] = [];
  const outputs: unknown[] = [];
  const clearOutputNode = vi.fn();
  const renderer = {
    kind: "webgpu",
    raw: {},
    clearOutputNode,
    setOutputNode(node: Node, worldPass?: unknown) {
      outputs.push(node);
      worldPasses.push(worldPass);
      node.traverse((candidate) => {
        if (Reflect.get(candidate, "isRTTNode") !== true) return;
        const scratch = candidate as unknown as {
          renderTarget: { dispose(): void };
          _quadMesh: { material: { dispose(): void } };
        };
        releases.push(vi.spyOn(scratch.renderTarget, "dispose"));
        releases.push(vi.spyOn(scratch._quadMesh.material, "dispose"));
      });
    },
  };
  let suppliedPass: unknown;
  const applied = new WorldEnvironment({ bloomEnabled: false, screenSpaceAA: "disabled" }).apply(
    renderer,
    new Scene(),
    new PerspectiveCamera(),
    {
      baseColour(scenePass) {
        suppliedPass = scenePass;
        releases.push(vi.spyOn(scenePass, "dispose"));
        return scenePass.getTextureNode("output").mul(0.5);
      },
    },
  );
  expect(applied.stages).toEqual([]);
  expect(applied.dispose).toBeTypeOf("function");
  expect(worldPasses).toEqual([suppliedPass]);
  expect(releases).toHaveLength(3);
  applied.dispose?.();
  applied.dispose?.();
  expect(clearOutputNode).toHaveBeenCalledExactlyOnceWith(outputs[0]);
  for (const release of releases) expect(release).toHaveBeenCalledTimes(1);
});

it("refuses a direct graph on an unsupported renderer without invoking its allocation factory", () => {
  const baseColour = vi.fn();
  const applied = new WorldEnvironment({ bloomEnabled: false, screenSpaceAA: "disabled" }).apply(
    { kind: "webgl2", raw: {} },
    new Scene(),
    new PerspectiveCamera(),
    { baseColour },
  );
  expect(baseColour).not.toHaveBeenCalled();
  expect(applied.dropped).toEqual([{ name: "baseColour", reason: "renderer:webgl2" }]);
});
