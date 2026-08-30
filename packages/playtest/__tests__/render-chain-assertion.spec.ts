import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { evaluateRichPlaytestAssertions, loadPlaytestScenario } from "../src/index.js";
import type { IPlaytestRenderChainObservation } from "../src/protocol.js";
import type { IPlaytestReport } from "../src/report.js";

function report(renderChain: IPlaytestRenderChainObservation | undefined): IPlaytestReport {
  return {
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

function chainObservation(
  overrides: Partial<IPlaytestRenderChainObservation> = {},
  velocity: Partial<IPlaytestRenderChainObservation["velocity"]> = {},
): IPlaytestRenderChainObservation {
  return {
    dropped: [],
    requested: [],
    source: "pinned",
    stages: [],
    tier: "high",
    velocity: { measurementFrame: 4, provisioned: true, required: true, source: "mrt", ...velocity },
    ...overrides,
  };
}

describe("renderChain playtest assertion", () => {
  it("passes a reported tier and velocity rejection bound", async () => {
    const scenario = await loadPlaytestScenarioFromValue({
      assert: { renderChain: { tier: "high", velocity: { maxRejectionFraction: 0.2 } } },
      name: "render-chain",
      schemaVersion: 1,
      steps: [{ release: true, waitFrames: 1 }],
      target: "web",
      viewport: { height: 720, width: 1280 },
      warmupFrames: 0,
    });
    const result = evaluateRichPlaytestAssertions({
      report: report(chainObservation({ tier: "high" }, { rejectionFraction: 0.1 })),
      scenario,
    });

    expect(result.assertions).toContainEqual(expect.objectContaining({ id: "renderChain.tier", pass: true }));
    expect(result.assertions).toContainEqual(expect.objectContaining({ id: "renderChain.velocity.rejectionFraction", pass: true }));
    expect(result.diagnostics).toEqual([]);
  });

  it("fails closed when the marker is absent or the tier is lower", async () => {
    const scenario = await loadPlaytestScenarioFromValue({
      assert: { renderChain: { tier: "high" } },
      name: "render-chain",
      schemaVersion: 1,
      steps: [{ release: true, waitFrames: 1 }],
      target: "web",
      viewport: { height: 720, width: 1280 },
      warmupFrames: 0,
    });
    const absent = evaluateRichPlaytestAssertions({ report: report(undefined), scenario });
    const lower = evaluateRichPlaytestAssertions({ report: report(chainObservation({ tier: "low" })), scenario });

    expect(absent.assertions).toContainEqual(expect.objectContaining({ id: "renderChain.tier", pass: false }));
    expect(absent.diagnostics[0]?.code).toBe("TN_PLAYTEST_RENDER_CHAIN_UNOBSERVABLE");
    expect(lower.assertions).toContainEqual(expect.objectContaining({ id: "renderChain.tier", pass: false }));
  });

  it("fails closed when velocity has no completed-frame measurement", async () => {
    const scenario = await loadPlaytestScenarioFromValue({
      assert: { renderChain: { velocity: { maxRejectionFraction: 0.2 } } },
      name: "render-chain",
      schemaVersion: 1,
      steps: [{ release: true, waitFrames: 1 }],
      target: "web",
      viewport: { height: 720, width: 1280 },
      warmupFrames: 0,
    });
    const result = evaluateRichPlaytestAssertions({
      report: report(chainObservation()),
      scenario,
    });

    expect(result.assertions).toContainEqual(
      expect.objectContaining({ id: "renderChain.velocity.rejectionFraction", pass: false }),
    );
    expect(result.diagnostics[0]?.code).toBe("TN_PLAYTEST_RENDER_CHAIN_UNOBSERVABLE");
  });
});

async function loadPlaytestScenarioFromValue(value: unknown) {
  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const directory = await makeTempDir("tn-render-chain-");
  const file = join(directory, "scenario.json");
  await writeFile(file, JSON.stringify(value));
  return loadPlaytestScenario(directory, "scenario.json");
}
