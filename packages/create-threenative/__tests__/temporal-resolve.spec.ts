import { Mesh, PerspectiveCamera, PlaneGeometry, Scene } from "three";
import { traa } from "three/addons/tsl/display/TRAANode.js";
import { pass } from "three/tsl";
import { MeshBasicNodeMaterial, WGSLNodeBuilder, WebGPURenderer } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import {
  CATMULL_ROM_BASIS,
  createExperimentalTemporalResolve,
} from "../templates/starter/src/render/temporalResolve.js";

// Evaluate the authored polynomial independently in the monomial basis. A smoothing B-spline
// would fail the endpoint/interpolation checks even though its weights also sum to one.
const weights = (phase: number) =>
  CATMULL_ROM_BASIS.map((row) =>
    row.reduce<number>((sum, value, power) => sum + value * phase ** power, 0),
  );

describe("authored temporal reconstruction kernel", () => {
  it("ordinary blending retains the existing current weight without luminance reweighting", () => {
    // Real WGSL generation without a GPU device; only device-capability probes are stubbed.
    const renderer = new WebGPURenderer({ canvas: new EventTarget() as HTMLCanvasElement });
    Reflect.set(renderer.backend, "renderer", renderer);
    vi.spyOn(
      Reflect.get(renderer.backend, "capabilities"),
      "getUniformBufferLimit",
    ).mockReturnValue(65_536);
    vi.spyOn(renderer, "hasFeature").mockReturnValue(false);
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
      const graph = createExperimentalTemporalResolve(source, renderer, "catmull-rom", blend);
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
      expect(weighted.code).toContain("0.2126");
      expect(ordinary.code).not.toContain("0.2126");
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
