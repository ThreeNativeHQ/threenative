import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { evaluateRichPlaytestAssertions, loadPlaytestScenario } from "../src/index.js";
import type { IPlaytestRenderChainObservation } from "../src/protocol.js";
import type { IPlaytestCaptureProvenance, IPlaytestReport } from "../src/report.js";

/** The two chains the starter's own quality policy ships, as CI observed them. */
const HIGH: IPlaytestRenderChainObservation = {
  contributions: [
    { graphOutputChanged: true, name: "ambientOcclusion" },
    { graphOutputChanged: true, name: "bloom" },
    { graphOutputChanged: true, name: "vignette" },
  ],
  dropped: [],
  requested: ["ambientOcclusion", "bloom", "vignette"],
  source: "pinned",
  stages: ["ambientOcclusion", "bloom", "vignette"],
  tier: "high",
  velocity: { measurementFrame: 4, provisioned: false, required: false, source: null },
};
const LOW: IPlaytestRenderChainObservation = {
  contributions: [
    { graphOutputChanged: true, name: "bloom" },
    { graphOutputChanged: true, name: "vignette" },
    { graphOutputChanged: true, name: "antialias" },
  ],
  dropped: [],
  requested: ["bloom", "vignette", "antialias"],
  source: "pinned",
  stages: ["bloom", "vignette", "antialias"],
  tier: "low",
  velocity: { measurementFrame: 4, provisioned: false, required: false, source: null },
};

const SWIFTSHADER: IPlaytestCaptureProvenance["adapter"] = {
  architecture: "swiftshader",
  vendor: "google",
};
const TURING: IPlaytestCaptureProvenance["adapter"] = {
  architecture: "turing",
  vendor: "nvidia",
};

function report(
  renderChain: IPlaytestRenderChainObservation | undefined,
  capture?: IPlaytestCaptureProvenance,
): IPlaytestReport {
  return {
    ...(capture === undefined ? {} : { capture }),
    diagnostics: [],
    distance: 0,
    entity: "proof",
    expectMoved: false,
    frames: 2,
    observations: {
      console: [],
      hud: {},
      network: [],
      resources: {},
      renderChain,
    },
    trivialityOptOuts: [],
  };
}

function capture(adapter: IPlaytestCaptureProvenance["adapter"]): IPlaytestCaptureProvenance {
  return {
    adapter,
    browserArgs: [],
    captureMethod: "page.screenshot",
    rendererKind: "webgpu",
    target: "browser",
    viewport: { height: 720, width: 1280 },
  };
}

async function load(value: unknown) {
  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const directory = await makeTempDir("tn-render-chain-adapter-");
  const file = join(directory, "scenario.json");
  await writeFile(file, JSON.stringify(value));
  return loadPlaytestScenario(directory, "scenario.json");
}

const SCENARIO = (renderChain: unknown) => ({
  assert: { renderChain },
  name: "starter-look",
  schemaVersion: 1,
  steps: [{ kind: "wait", label: "settles", release: true, waitTicks: 1 }],
  subject: "player",
  target: "web",
  viewport: { height: 720, width: 1280 },
  warmupFrames: 0,
});

/** The starter `look` shape: flat high for hardware, the existing low policy for software. */
const ASSERTION = {
  contributions: { graphOutputChanged: ["ambientOcclusion", "bloom", "vignette"] },
  perAdapter: {
    software: {
      contributions: { graphOutputChanged: ["bloom", "vignette", "antialias"] },
      stages: {
        includes: ["bloom", "vignette", "antialias"],
        order: ["bloom", "vignette", "antialias"],
      },
      tier: "low",
    },
  },
  stages: { includes: ["ambientOcclusion", "bloom", "vignette"], order: ["ambientOcclusion", "bloom", "vignette"] },
  tier: "high",
};

describe("renderChain perAdapter selection", () => {
  it("holds a hardware run to the flat high policy", async () => {
    const scenario = await load(SCENARIO(ASSERTION));
    const result = evaluateRichPlaytestAssertions({ report: report(HIGH, capture(TURING)), scenario });

    expect(result.assertions.filter((row) => row.pass === false)).toEqual([]);
    expect(result.assertions).toContainEqual(
      expect.objectContaining({
        details: expect.objectContaining({ adapterClass: "hardware" }),
        id: "renderChain.tier",
        pass: true,
      }),
    );
  });

  it("holds a software browser run to the software low policy, with its own provenance", async () => {
    const scenario = await load(SCENARIO(ASSERTION));
    const result = evaluateRichPlaytestAssertions({ report: report(LOW, capture(SWIFTSHADER)), scenario });

    expect(result.assertions.filter((row) => row.pass === false)).toEqual([]);
    // Every render row carries the harness's own reading, so a low tier on a software adapter is
    // distinguishable from a low tier a game chose for itself on a real GPU.
    for (const id of ["renderChain.tier", "renderChain.stages.order", "renderChain.contributions.graphOutputChanged"]) {
      expect(result.assertions).toContainEqual(
        expect.objectContaining({
          details: expect.objectContaining({ adapterClass: "software", softwareAdapter: "swiftshader" }),
          id,
          pass: true,
        }),
      );
    }
  });

  it("classifies a native run's software adapter the same way, from its own provenance", async () => {
    const scenario = await load({
      ...SCENARIO(ASSERTION),
      target: "desktop",
    });
    // The native host reports the same four adapter.info fields, so the classification is the
    // harness's and does not depend on which target produced the run.
    const native = { ...capture(SWIFTSHADER), target: "desktop" };
    const result = evaluateRichPlaytestAssertions({ report: report(LOW, native), scenario });

    expect(result.assertions.filter((row) => row.pass === false)).toEqual([]);
    expect(result.assertions).toContainEqual(
      expect.objectContaining({
        details: expect.objectContaining({ adapterClass: "software" }),
        id: "renderChain.tier",
        pass: true,
      }),
    );
  });

  it("fails a software run that ran the hardware policy, rather than accepting either", async () => {
    const scenario = await load(SCENARIO(ASSERTION));
    const result = evaluateRichPlaytestAssertions({ report: report(HIGH, capture(SWIFTSHADER)), scenario });

    expect(result.assertions).toContainEqual(expect.objectContaining({ id: "renderChain.tier", pass: false }));
    expect(result.diagnostics.map((entry) => entry.code)).toContain("TN_PLAYTEST_RENDER_CHAIN_TIER_FAILED");
  });

  it("fails a hardware run whose chain dropped the asserted stages and their contributions", async () => {
    const scenario = await load(SCENARIO(ASSERTION));
    const partial = {
      ...HIGH,
      contributions: (HIGH.contributions ?? []).filter((entry) => entry.name !== "ambientOcclusion"),
      dropped: [{ name: "ambientOcclusion", reason: "budget" }],
      stages: ["bloom", "vignette"],
    };
    const result = evaluateRichPlaytestAssertions({ report: report(partial, capture(TURING)), scenario });

    expect(result.assertions).toContainEqual(
      expect.objectContaining({ id: "renderChain.stages.includes", pass: false }),
    );
    expect(result.diagnostics.map((entry) => entry.code)).toContain("TN_PLAYTEST_RENDER_CHAIN_STAGES_FAILED");
  });

  it("fails a software run whose chain dropped a software-branch stage", async () => {
    const scenario = await load(SCENARIO(ASSERTION));
    const partial = {
      ...LOW,
      contributions: (LOW.contributions ?? []).filter((entry) => entry.name !== "antialias"),
      dropped: [{ name: "antialias", reason: "budget" }],
      stages: ["bloom", "vignette"],
    };
    const result = evaluateRichPlaytestAssertions({ report: report(partial, capture(SWIFTSHADER)), scenario });

    expect(result.assertions).toContainEqual(
      expect.objectContaining({ id: "renderChain.stages.order", pass: false }),
    );
    expect(result.assertions).toContainEqual(
      expect.objectContaining({ id: "renderChain.contributions.graphOutputChanged", pass: false }),
    );
  });

  // `capture.rendererKind` is a fact about the canvas. Four provenance shapes carry that marker
  // without naming an adapter, and all four used to classify `hardware`. The last one is the shape
  // a real capture actually has: `readCaptureProvenance` adds `features` and `limit.*` beside the
  // four identity fields, so an object full of non-identity text is the common case, not a corner.
  it.each([
    ["no adapter object", undefined],
    ["an empty adapter object", {}],
    ["an adapter that named nothing", { architecture: "", description: "", device: "", vendor: "" }],
    [
      "only the metadata a real capture adds beside its identity fields",
      {
        architecture: "",
        description: "",
        device: "",
        features: "timestamp-query",
        "limit.maxBindGroups": "4",
        "limit.maxTextureDimension2D": "8192",
        vendor: "",
      },
    ],
  ])("refuses to call hardware a run whose capture reports %s", async (_name, adapter) => {
    const scenario = await load(SCENARIO(ASSERTION));
    const result = evaluateRichPlaytestAssertions({
      report: report(HIGH, {
        ...capture(TURING),
        adapter: adapter as IPlaytestCaptureProvenance["adapter"],
      }),
      scenario,
    });

    expect(result.assertions).toContainEqual(
      expect.objectContaining({ id: "renderChain.adapterClass", pass: false }),
    );
    // No row may carry a hardware verdict from a provenance that observed nothing.
    expect(
      result.assertions.flatMap((row) => [row.details?.adapterClass]),
    ).not.toContain("hardware");
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      "TN_PLAYTEST_RENDER_CHAIN_ADAPTER_UNCLASSIFIED",
    );
  });

  it("does not let an unclassified adapter satisfy the software branch", async () => {
    const scenario = await load(SCENARIO(ASSERTION));
    const result = evaluateRichPlaytestAssertions({ report: report(LOW, capture(TURING)), scenario });

    expect(result.assertions).toContainEqual(
      expect.objectContaining({ id: "renderChain.tier", pass: false }),
    );
  });

  it("fails once, by name, when the run reported no adapter at all", async () => {
    const scenario = await load(SCENARIO(ASSERTION));
    const result = evaluateRichPlaytestAssertions({ report: report(LOW), scenario });

    expect(result.assertions).toContainEqual(
      expect.objectContaining({ id: "renderChain.adapterClass", pass: false }),
    );
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      "TN_PLAYTEST_RENDER_CHAIN_ADAPTER_UNCLASSIFIED",
    );
  });

  it("leaves a flat-only scenario alone when the run reported no adapter", async () => {
    const scenario = await load(SCENARIO({ tier: "high" }));
    const result = evaluateRichPlaytestAssertions({ report: report(HIGH), scenario });

    // No perAdapter means no adapter question was asked, so no adapterClass row is invented.
    expect(result.assertions.map((row) => row.id)).not.toContain("renderChain.adapterClass");
    expect(result.assertions).toContainEqual(expect.objectContaining({ id: "renderChain.tier", pass: true }));
  });

  // A typo one level down is the same defect as a typo at the top: it names no stage, no
  // contribution and no ceiling, while reading as an assertion that did. Every nested type is
  // checked on both the flat form and the branch, through the one shared check.
  it.each([
    ["stages", { includes: ["bloom"] }, "includess"],
    ["contributions", { graphOutputChanged: ["bloom"] }, "graphOutputchange"],
    ["velocity", { maxRejectionFraction: 0.5 }, "maxRejectionfraction"],
  ])("rejects a typo in nested %s on both the flat form and a branch", async (_name, nested, typo) => {
    await expect(load(SCENARIO({ stages: { [typo]: ["bloom"] } }))).rejects.toThrow(
      new RegExp(`stages\\.${typo}`, "u"),
    );
    await expect(load(SCENARIO({ contributions: { [typo]: ["bloom"] } }))).rejects.toThrow(
      new RegExp(`contributions\\.${typo}`, "u"),
    );
    await expect(load(SCENARIO({ velocity: { [typo]: 0.5 } }))).rejects.toThrow(
      new RegExp(`velocity\\.${typo}`, "u"),
    );
    await expect(
      load(SCENARIO({ perAdapter: { software: { stages: { [typo]: ["bloom"] } } } })),
    ).rejects.toThrow(new RegExp(`perAdapter\\.software\\.stages\\.${typo}`, "u"));
    await expect(
      load(SCENARIO({ perAdapter: { hardware: { contributions: { [typo]: ["bloom"] } } } })),
    ).rejects.toThrow(new RegExp(`perAdapter\\.hardware\\.contributions\\.${typo}`, "u"));
    await expect(
      load(SCENARIO({ perAdapter: { software: { velocity: { [typo]: 0.5 } } } })),
    ).rejects.toThrow(new RegExp(`perAdapter\\.software\\.velocity\\.${typo}`, "u"));
    expect(nested).toBeTruthy();
  });

  it("rejects an empty, unknown, nested, or mistyped per-adapter branch at load", async () => {
    const cases: [string, unknown, RegExp][] = [
      ["empty", {}, /must assert tier, stages, contributions, or velocity/u],
      ["empty perAdapter", { perAdapter: {} }, /must name at least one adapter class/u],
      ["unknown class", { perAdapter: { imaginary: { tier: "low" } } }, /perAdapter\.imaginary/u],
      ["unknown branch key", { perAdapter: { software: { tiers: "low" } } }, /perAdapter\.software\.tiers/u],
      [
        "nested",
        { perAdapter: { software: { perAdapter: { software: { tier: "low" } } } } },
        /perAdapter\.software\.perAdapter/u,
      ],
      ["wrong-typed branch", { perAdapter: { software: "low" } }, /perAdapter\.software' must be an object/u],
    ];
    for (const [name, renderChain, message] of cases) {
      await expect(load(SCENARIO(renderChain))).rejects.toThrow(message);
      expect(name).not.toBe("");
    }
  });

  it("rejects a perAdapter-only assertion that asserts nothing on any branch", async () => {
    await expect(load(SCENARIO({ perAdapter: { software: { tier: "low" } } }))).rejects.toThrow(
      /must assert tier, stages, contributions, or velocity/u,
    );
  });
});
