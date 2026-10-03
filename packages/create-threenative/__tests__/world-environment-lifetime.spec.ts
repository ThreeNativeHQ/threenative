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

it("keeps default exposure direct and installs the authored opt-in on its existing world pass", () => {
  const output = vi.fn();
  const renderer: OutputRenderer = { kind: "webgpu", raw: {}, setOutputNode: output };
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const direct = new WorldEnvironment({ exposure: 0.62, bloomEnabled: false }).apply(
    renderer,
    scene,
    camera,
  );
  expect(output).not.toHaveBeenCalled();
  expect(direct.exposure).toBeUndefined();
  expect(renderer.raw).toMatchObject({ toneMappingExposure: 0.62 });

  const installed = new WorldEnvironment({ autoExposureEnabled: true, bloomEnabled: false }).apply(
    renderer,
    scene,
    camera,
  );
  expect(output).toHaveBeenCalledTimes(1);
  const worldPass = output.mock.calls[0]?.[1] as { dispose(): void };
  expect(worldPass).toBeDefined();
  const exposure = installed.exposure;
  expect(exposure).toBeDefined();
  expect(exposure?.settings.enabled).toBe(false);
  expect(exposure?.getObservation()).toEqual({ measured: false, applied: false });
  if (exposure === undefined) throw new Error("Actual consumer exposure missing.");
  const releaseExposure = vi.spyOn(exposure, "dispose");
  const releasePass = vi.spyOn(worldPass, "dispose");
  installed.dispose?.();
  expect(releaseExposure).toHaveBeenCalledTimes(1);
  expect(releasePass).toHaveBeenCalledTimes(1);
  expect(() => exposure?.reset()).toThrow(/disposed/);
});

it("rejects authored auto-exposure on an unsupported renderer rather than silently omitting it", () => {
  expect(() =>
    new WorldEnvironment({ autoExposureEnabled: true }).apply(
      { kind: "webgl", raw: {}, setOutputNode: vi.fn() },
      new Scene(),
      new PerspectiveCamera(),
    ),
  ).toThrow(/requires WebGPU/);
});

it("requires actual consumer installation evidence, rejecting missing wiring", async () => {
  const { assertExposureConsumer } = await import("./fixtures/auto-exposure/proof.js");
  const report = (text: string) => ({ observations: { console: [{ text }] } });
  expect(() =>
    assertExposureConsumer(report('TN_EXPOSURE_CONSUMER:{"installed":true,"owned":true}')),
  ).not.toThrow();
  expect(() => assertExposureConsumer(report("unrelated"))).toThrow(/one actual installation/);
  expect(() =>
    assertExposureConsumer(report('TN_EXPOSURE_CONSUMER:{"installed":true,"owned":false}')),
  ).toThrow(/actual graph/);
});
