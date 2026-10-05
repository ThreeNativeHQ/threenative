import { Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector2 } from "three";
import { traa } from "three/addons/tsl/display/TRAANode.js";
import { pass, uniform, velocity } from "three/tsl";
import type { NodeBuilder } from "three/webgpu";
import { MeshBasicNodeMaterial, WGSLNodeBuilder, WebGPURenderer } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { createTemporalAA } from "../templates/starter/src/render/temporalAA.js";
import {
  CATMULL_ROM_BASIS,
  createExperimentalTemporalResolve,
} from "../templates/starter/src/render/temporalResolve.js";

/** Real WGSL generation without a GPU device; only device-capability probes are stubbed. */
function offlineRenderer() {
  const renderer = new WebGPURenderer({ canvas: new EventTarget() as HTMLCanvasElement });
  Reflect.set(renderer.backend, "renderer", renderer);
  vi.spyOn(Reflect.get(renderer.backend, "capabilities"), "getUniformBufferLimit").mockReturnValue(
    65_536,
  );
  vi.spyOn(renderer, "hasFeature").mockReturnValue(false);
  return renderer;
}

/** Compile a graph through the real WGSL node builder and hand back its fragment source. */
function fragment(renderer: WebGPURenderer, mesh: Mesh, graph: unknown): string {
  const builder = new WGSLNodeBuilder(mesh, renderer) as WGSLNodeBuilder & {
    setShaderStage(stage: string): void;
    flowStagesNode(node: unknown, output: string): { code: string };
  };
  builder.setShaderStage("fragment");
  return builder.flowStagesNode(graph, "vec4").code;
}

// Evaluate the authored polynomial independently in the monomial basis. A smoothing B-spline
// would fail the endpoint/interpolation checks even though its weights also sum to one.
const weights = (phase: number) =>
  CATMULL_ROM_BASIS.map((row) =>
    row.reduce<number>((sum, value, power) => sum + value * phase ** power, 0),
  );

describe("authored temporal reconstruction kernel", () => {
  it("ordinary blending retains the existing current weight without luminance reweighting", () => {
    const renderer = offlineRenderer();
    const camera = new PerspectiveCamera();
    const scenePass = pass(new Scene(), camera);
    const source = traa(
      scenePass.getTextureNode(),
      scenePass.getTextureNode("depth"),
      scenePass.getTextureNode("velocity"),
      camera,
    );
    source.edgeDepthDiff = 1;
    const mesh = new Mesh(new PlaneGeometry(2, 2), new MeshBasicNodeMaterial());
    const compile = (blend?: "luminance" | "ordinary") => {
      const graph = createExperimentalTemporalResolve(
        source,
        renderer,
        uniform(new Vector2()),
        "catmull-rom",
        blend,
      );
      const builder = new WGSLNodeBuilder(mesh, renderer) as WGSLNodeBuilder & {
        setShaderStage(stage: string): void;
        flowStagesNode(node: unknown, output: string): { code: string; result: string };
      };
      builder.setShaderStage("fragment");
      return builder.flowStagesNode(graph, "vec4");
    };
    try {
      const weighted = compile("luminance");
      const ordinary = compile("ordinary");
      expect(compile()).toEqual(weighted);
      // The thin-feature lock reads luminance in both arms, so the isolation is the flicker
      // reduction itself: only the luminance-weighted blend normalises by its compressed sum.
      expect(weighted.code).toContain("0.2126");
      expect(weighted.code).toContain("0.00001");
      expect(ordinary.code).not.toContain("0.00001");
      const weight = ordinary.code.match(/(?:^|\n)\t(\w+) = 0\.05;/)?.[1];
      expect(weight).toBeDefined();
      expect(ordinary.result).toMatch(new RegExp(`^mix\\( .*?, .*?, ${weight} \\)$`));
    } finally {
      source.dispose();
      scenePass.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  });
  it("installs a default provider kernel that reads the reset flag", () => {
    // The provider, not the experimental arm, is what publishes a frame. A CPU flag assignment is
    // not the proof: this compiles the kernel the provider actually installed.
    const renderer = offlineRenderer();
    const camera = new PerspectiveCamera();
    const scenePass = pass(new Scene(), camera);
    scenePass.setSize(1280, 720);
    const temporal = createTemporalAA(
      scenePass.getTextureNode(),
      scenePass.getTextureNode("depth"),
      scenePass.getTextureNode("velocity"),
      camera,
    );
    temporal.node.setup({
      context: { velocity },
      renderer,
      getNodeProperties: () => ({}),
    } as unknown as NodeBuilder);
    const installed = (temporal.node as unknown as { _resolveMaterial: { colorNode: unknown } })
      ._resolveMaterial.colorNode;
    const bare = traa(
      scenePass.getTextureNode(),
      scenePass.getTextureNode("depth"),
      scenePass.getTextureNode("velocity"),
      camera,
    );
    const mesh = new Mesh(new PlaneGeometry(2, 2), new MeshBasicNodeMaterial());
    try {
      const withFlag = fragment(renderer, mesh, installed);
      // A node with no reset flag installed keeps upstream's own history reuse unchanged.
      const withoutFlag = fragment(
        renderer,
        mesh,
        createExperimentalTemporalResolve(bare, renderer, uniform(new Vector2()), "linear"),
      );
      // The installed kernel compares a uniform against the threshold; a kernel with no flag
      // installed folds the same comparison to a constant.
      expect(withFlag).toMatch(/\bobject\.nodeUniform\d+ > 0\.5\b/u);
      expect(withoutFlag).toContain("( 1.0 > 0.5 )");
      expect(withFlag).not.toContain("( 1.0 > 0.5 )");
      // The default arm is upstream's, so a full-resolution frame resolves exactly as it did.
      expect(withFlag).toContain("0.2126");
    } finally {
      temporal.dispose();
      bare.dispose();
      scenePass.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  });
  it("interpolates sample centres and preserves constants, ramps and quadratics", () => {
    expect(weights(0)).toEqual([0, 1, 0, 0]);
    expect(weights(1)).toEqual([0, 0, 1, 0]);
    for (const phase of [0.05, 0.2, 0.5, 0.75, 0.95]) {
      const w = weights(phase);
      expect(w.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
      expect(w.reduce((sum, value, i) => sum + value * (i - 1), 0)).toBeCloseTo(phase, 12);
      expect(w.reduce((sum, value, i) => sum + value * (i - 1) ** 2, 0)).toBeCloseTo(
        phase ** 2,
        12,
      );
    }
  });
  it("retains the known negative lobes that require downstream history clipping", () => {
    expect(weights(0.5)).toEqual([-1 / 16, 9 / 16, 9 / 16, -1 / 16]);
  });
});
