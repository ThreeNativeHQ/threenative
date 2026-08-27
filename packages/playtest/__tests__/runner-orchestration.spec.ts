import { describe, expect, test } from "vitest";

import { boundedTeardownStep, settledTeardownValue } from "../src/runner/server.js";
import {
  buildReport,
  failedDiagnosticsAssertion,
  handlePlaytestSignal,
  playtestStepDrivesMovement,
  preflightDisplay,
} from "../src/runner/runner.js";
import type { IPlaytestScenario } from "../src/scenario.js";

// PRD-182 Phase 1 characterization net for runner.ts's pure orchestration surface: signal
// handling, the not-evaluated diagnostics assertion, report assembly on an empty scenario,
// preflight verdicts and step-input classification. Pinning current behavior - fixing
// behavior is explicitly NOT this PRD.

const SCENARIO = {
  assert: {},
  name: "orchestrated",
  schemaVersion: 1,
  steps: [{ release: true, waitTicks: 2 }],
} as unknown as IPlaytestScenario;

describe("runner orchestration (characterization)", () => {
  test("the diagnostics assertion fails closed with a not-evaluated reason", () => {
    const policy = { noConsoleErrors: true, noNetworkErrors: false, noRuntimeDiagnostics: false };
    expect(failedDiagnosticsAssertion(policy)).toEqual({
      details: {
        consoleErrors: 0,
        networkErrors: 0,
        policy,
        reason: "not-evaluated",
        runtimeDiagnostics: 0,
      },
      id: "diagnostics",
      pass: false,
    });
  });

  test("a signal tears down with the managed server, sets exit 2 and exits 2", async () => {
    const calls: Array<string | number> = [];
    await handlePlaytestSignal(
      async (stopManagedServer) => {
        calls.push(`teardown:${stopManagedServer}`);
      },
      (code) => calls.push(`exitCode:${code}`),
      (code) => calls.push(`exit:${code}`),
      "browser",
      () => undefined,
    );
    expect(calls).toEqual(["teardown:true", "exitCode:2", "exit:2"]);
  });

  test("a throwing teardown is swallowed by the signal path, which still exits 2", async () => {
    const calls: number[] = [];
    await handlePlaytestSignal(
      async () => {
        throw new Error("boom");
      },
      (code) => calls.push(code),
      (code) => calls.push(code),
      "browser",
      () => undefined,
    );
    expect(calls).toEqual([2, 2]);
  });

  test("buildReport on an empty scenario pins the assembled field set", () => {
    const report = buildReport(
      { url: "http://127.0.0.1:5173" } as never,
      SCENARIO,
      undefined,
      undefined,
      [],
      [],
    );
    // Captured verbatim from the unsplit module: buildReport evaluates inline, so an empty
    // scenario already carries assertionResults and the no-assertions diagnostic.
    expect(report).toEqual({
      artifactDirectory: undefined,
      assertionResults: [
        {
          details: {
            consoleErrors: 0,
            networkErrors: 0,
            policy: { noConsoleErrors: true, noNetworkErrors: true, noRuntimeDiagnostics: true },
            runtimeDiagnostics: 0,
          },
          id: "diagnostics",
          pass: true,
        },
        { details: { reason: "no-evaluated-assertions" }, id: "scenario.assertions", pass: false },
      ],
      diagnostics: [
        {
          code: "TN_PLAYTEST_SCENARIO_NO_ASSERTIONS",
          message: "Scenario 'orchestrated' completed without evaluating any assertions.",
          severity: "error",
          suggestion:
            "Declare a supported assertion and ensure its evaluator observes a result before treating the scenario as proof.",
        },
      ],
      diagnosticsPolicy: { noConsoleErrors: true, noNetworkErrors: true, noRuntimeDiagnostics: true },
      distance: 0,
      entity: "",
      expectMoved: false,
      frames: 2,
      observations: {
        console: [],
        hud: {},
        network: [],
        resources: {},
        runtimeDiagnostics: { recentRuntimeErrors: [], runtimeReadouts: [], scene: { renderedEntities: [] } },
      },
      pass: false,
      runtime: "web",
      scenario: "orchestrated",
      trivialityOptOutCount: 0,
      trivialityOptOuts: [],
      url: "http://127.0.0.1:5173",
    });
  });

  test("preflightDisplay stays silent for headed runs and non-linux platforms", () => {
    const noDisplay = {};
    expect(preflightDisplay({ headless: false }, SCENARIO, noDisplay, "linux")).toBeUndefined();
    expect(preflightDisplay({ headless: true }, SCENARIO, noDisplay, "darwin")).toBeUndefined();
  });

  test("playtestStepDrivesMovement classifies held versus new input", () => {
    // Captured truth table; note press:"" counts as no new input AND suppresses held input.
    const step = (fields: object) => ({ release: true, ...fields }) as never;
    expect(playtestStepDrivesMovement(step({}), false)).toBe(false);
    expect(playtestStepDrivesMovement(step({}), true)).toBe(true);
    expect(playtestStepDrivesMovement(step({ press: "KeyW" }), false)).toBe(true);
    expect(playtestStepDrivesMovement(step({ press: "" }), true)).toBe(false);
    expect(playtestStepDrivesMovement(step({ press: [] }), false)).toBe(false);
    expect(playtestStepDrivesMovement(step({ pointerPosition: [1, 2, 0] }), false)).toBe(true);
    expect(playtestStepDrivesMovement(step({ pointers: [{ id: 1, x: 0, y: 0 }] }), false)).toBe(true);
  });
});

// A signal that lands while chromium.launch() is still in flight used to strand the browser: the
// runner's `browser` variable was only assigned after the await, so teardown closed nothing and
// process.exit() went out over a live Chromium. The suite's orphan gate caught the wreckage as
// leftover processes and profile directories. These lock the teardown shape that reaches it.
describe("teardown reaches a browser that is still launching", () => {
  const fakeBrowser = () => {
    let closed = false;
    return { close: async () => { closed = true; }, wasClosed: () => closed };
  };

  // The exact expression runStandalonePlaytest's teardown uses.
  const teardownBrowser = async (
    browser: { close: () => Promise<void> } | undefined,
    launch: Promise<{ close: () => Promise<void> }> | undefined,
  ): Promise<void> => {
    const launched = browser ?? (await settledTeardownValue(launch, 1_000));
    await boundedTeardownStep(launched?.close(), 1_000);
  };

  test("closes the in-flight browser when the handle is not yet assigned", async () => {
    const browser = fakeBrowser();
    const launch = new Promise<typeof browser>((resolve) => setTimeout(() => resolve(browser), 10));
    await teardownBrowser(undefined, launch);
    expect(browser.wasClosed()).toBe(true);
  });

  test("closes the assigned browser without waiting on the launch promise", async () => {
    const browser = fakeBrowser();
    await teardownBrowser(browser, undefined);
    expect(browser.wasClosed()).toBe(true);
  });

  test("gives up rather than hanging when the launch never settles", async () => {
    const start = Date.now();
    await teardownBrowser(undefined, new Promise(() => undefined));
    expect(Date.now() - start).toBeLessThan(5_000);
  });

  test("survives a launch that rejects", async () => {
    await expect(teardownBrowser(undefined, Promise.reject(new Error("launch failed")))).resolves
      .toBeUndefined();
  });
});
