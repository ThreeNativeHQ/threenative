import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  assertGpuEvidenceAllowed,
  assertPresentationPreconditions,
  buildScenarioMatrix,
  classifyAdapter,
  classifyEvidence,
  parseProfileArgs,
  queryOf,
  validatePresentationFrame,
} from "../profile-native-cpu.js";

function rgbaImage(
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => readonly [number, number, number, number],
): Buffer {
  const png = new PNG({ height, width });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue, alpha] = pixelAt(x, y);
      const offset = (y * width + x) * 4;
      png.data[offset] = red;
      png.data[offset + 1] = green;
      png.data[offset + 2] = blue;
      png.data[offset + 3] = alpha;
    }
  }
  return PNG.sync.write(png);
}

describe("native CPU profile collector logic", () => {
  it("builds the requested Cartesian matrix deterministically", () => {
    const scenarios = buildScenarioMatrix({
      dirtyRatios: [0, 1],
      hierarchies: ["flat", "deep"],
      objectCounts: [500, 1_000],
      passes: [1],
      renderModes: ["independent"],
      scenarioPresets: [],
      seed: 7,
      visibilities: ["all-visible"],
    });

    expect(scenarios).toHaveLength(8);
    expect(scenarios[0]).toEqual({
      dirtyRatio: 0,
      hierarchy: "flat",
      objectCount: 500,
      passes: 1,
      renderMode: "independent",
      seed: 7,
      visibility: "all-visible",
    });
    expect(scenarios.at(-1)).toEqual({
      dirtyRatio: 1,
      hierarchy: "deep",
      objectCount: 1_000,
      passes: 1,
      renderMode: "independent",
      seed: 7,
      visibility: "all-visible",
    });
  });

  it("parses a bounded short diagnostic configuration through pnpm's separator", () => {
    expect(
      parseProfileArgs(["--", "--diagnostic", "--allow-software", "--seed", "42"]),
    ).toMatchObject({
      allowSoftware: true,
      diagnostic: true,
      dirtyRatios: [0.1],
      evidenceClass: "timing-only",
      headed: false,
      hierarchies: ["flat"],
      objectCounts: [500],
      passes: [1],
      renderModes: ["independent"],
      repeats: 1,
      rendererStages: false,
      samples: 12,
      seed: 42,
      scenarioPresets: [],
      verifyPresentation: false,
      visibilities: ["mostly-culled"],
      warmupFrames: 2,
      warmupMs: 0,
    });
  });

  it("parses canonical fox visual evidence mode as headed presentation verification", () => {
    const args = parseProfileArgs(["--visual-evidence", "fox-scale"]);

    expect(args).toMatchObject({
      dirtyRatios: [0.1],
      evidenceClass: "visual-verified",
      headed: true,
      hierarchies: ["flat"],
      objectCounts: [1_850],
      passes: [1],
      renderModes: ["independent"],
      repeats: 3,
      rendererStages: false,
      samples: 120,
      scenarioPresets: ["fox-scale"],
      verifyPresentation: true,
      visibilities: ["all-visible"],
      warmupFrames: 60,
      warmupMs: 0,
    });
  });

  it("parses renderer stage instrumentation as opt-in only", () => {
    expect(parseProfileArgs(["--diagnostic"]).rendererStages).toBe(false);
    expect(parseProfileArgs(["--diagnostic", "--renderer-stages"]).rendererStages).toBe(true);
  });

  it("parses render advisor opt-in and emits the workload query switch", () => {
    const disabled = parseProfileArgs(["--diagnostic"]);
    const enabled = parseProfileArgs(["--diagnostic", "--render-advisor"]);
    const scenario = buildScenarioMatrix(enabled)[0];
    if (scenario === undefined) throw new Error("diagnostic matrix should contain one scenario");

    expect(disabled.renderAdvisor).toBe(false);
    expect(enabled.renderAdvisor).toBe(true);
    expect(new URLSearchParams(queryOf(scenario, disabled)).get("renderAdvisor")).toBe("0");
    expect(new URLSearchParams(queryOf(scenario, enabled)).get("renderAdvisor")).toBe("1");
    expect(() => parseProfileArgs(["--render-advisor=1"])).toThrow(/does not accept a value/);
  });

  it("runs only the fox-scale preset for canonical visual evidence mode", () => {
    const args = parseProfileArgs(["--visual-evidence", "fox-scale"]);
    const scenarios = buildScenarioMatrix(args);

    expect(scenarios).toHaveLength(1);
    expect(scenarios).toEqual([
      expect.objectContaining({
        objectCount: 1_850,
        renderMode: "independent",
        scenario: "fox-scale",
      }),
    ]);
  });

  it("adds the named fox-scale preset without removing controlled synthetic matrix rows", () => {
    const args = parseProfileArgs([
      "--objects",
      "1000",
      "--render-mode",
      "instanced",
      "--scenario",
      "fox-scale",
    ]);
    const scenarios = buildScenarioMatrix(args);

    expect(args.scenarioPresets).toEqual(["fox-scale"]);
    expect(scenarios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ objectCount: 1_000, renderMode: "instanced" }),
        expect.objectContaining({
          objectCount: expect.any(Number),
          renderMode: "instanced",
          scenario: "fox-scale",
        }),
      ]),
    );
  });

  it("keeps manual presentation verification from changing ordinary scenario expansion", () => {
    const args = parseProfileArgs([
      "--headed",
      "--verify-presentation",
      "--objects",
      "1000",
      "--scenario",
      "fox-scale",
    ]);
    const scenarios = buildScenarioMatrix(args);

    expect(args.verifyPresentation).toBe(true);
    expect(args.visualEvidenceScenario).toBeUndefined();
    expect(
      scenarios.some(
        (scenario) => scenario.objectCount === 1_000 && scenario.scenario === undefined,
      ),
    ).toBe(true);
    expect(scenarios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ objectCount: 1_850, scenario: "fox-scale" }),
      ]),
    );
  });

  it("rejects malformed and unsupported arguments", () => {
    expect(() => parseProfileArgs(["--objects", "0"])).toThrow(/objects/);
    expect(() => parseProfileArgs(["--dirty", "1"])).toThrow(/dirty/);
    expect(() => parseProfileArgs(["--wat"])).toThrow(/Unknown argument/);
  });

  it("rejects visual presentation verification before a headless launch", () => {
    expect(() =>
      assertPresentationPreconditions({
        display: ":99",
        headed: false,
        verifyPresentation: true,
      }),
    ).toThrow(/xvfb-run .*--headed --verify-presentation/);
  });

  it("rejects visual presentation verification without a display", () => {
    expect(() =>
      assertPresentationPreconditions({
        display: undefined,
        headed: true,
        verifyPresentation: true,
      }),
    ).toThrow(/DISPLAY/);
  });

  it("rejects blank or uniform RGBA presentation despite nonzero dimensions", () => {
    const blank = rgbaImage(64, 64, () => [0, 0, 0, 255]);

    expect(() => validatePresentationFrame(blank, "before")).toThrow(/uniform|blank/i);
  });

  it("accepts a representative varied presentation frame", () => {
    const varied = rgbaImage(64, 64, (x, y) => [
      (x * 17 + y * 3) % 256,
      (x * 5 + y * 23) % 256,
      (x * 11 + y * 7) % 256,
      255,
    ]);

    const stats = validatePresentationFrame(varied, "after");

    expect(stats.status).toBe("pass");
    expect(stats.width).toBe(64);
    expect(stats.height).toBe(64);
    expect(stats.uniqueColorBuckets).toBeGreaterThan(32);
    expect(stats.foregroundRatio).toBeGreaterThan(0.1);
  });

  it("cannot classify evidence as visually verified unless before and after presentation passed", () => {
    expect(
      classifyEvidence({
        adapterClass: "hardware",
        presentation: { after: { status: "pass" }, before: { status: "pass" } },
        verifyPresentation: true,
      }),
    ).toBe("visual-verified");
    expect(
      classifyEvidence({
        adapterClass: "hardware",
        presentation: { after: { status: "pass" }, before: { status: "fail" } },
        verifyPresentation: true,
      }),
    ).not.toBe("visual-verified");
    expect(
      classifyEvidence({
        adapterClass: "hardware",
        presentation: undefined,
        verifyPresentation: false,
      }),
    ).toBe("timing-only-browser-hardware");
  });

  it("classifies software adapters and fails closed unless explicitly allowed", () => {
    const software = classifyAdapter({
      architecture: "SwiftShader",
      description: "Vulkan 1.3",
      device: "CPU",
      vendor: "Google",
    });

    expect(software).toBe("software");
    expect(classifyAdapter({ architecture: "Ada", vendor: "NVIDIA" })).toBe("hardware");
    expect(classifyAdapter(null)).toBe("unknown");
    expect(() => assertGpuEvidenceAllowed(software, false)).toThrow(/--allow-software/);
    expect(() => assertGpuEvidenceAllowed("unknown", false)).toThrow(/--allow-software/);
    expect(() => assertGpuEvidenceAllowed(software, true)).not.toThrow();
  });
});
