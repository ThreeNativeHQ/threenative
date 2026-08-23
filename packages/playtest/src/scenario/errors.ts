// Extracted verbatim from scenario.ts (PRD-182 Phase 3); do not edit semantics here.
import type { IPlaytestScenarioDiagnostic } from "./schema-base.js";

export class PlaytestScenarioError extends Error {
  constructor(readonly diagnostic: IPlaytestScenarioDiagnostic) {
    super(diagnostic.message);
  }
}

export function invalidScenario(scenarioPath: string, message: string): PlaytestScenarioError {
  return new PlaytestScenarioError({
    code: "TN_PLAYTEST_SCENARIO_INVALID",
    fix: {
      docs: "docs/workflows/playtest-proof.md",
      instruction: "Use playtest schemaVersion 1 with a file-safe name, target, viewport, warmupFrames, and non-empty steps.",
      snippet: '{ "schemaVersion": 1, "name": "forward-smoke", "target": "web", "viewport": { "width": 1280, "height": 720 }, "warmupFrames": 10, "steps": [{ "kind": "input", "press": "KeyW", "holdTicks": 30, "release": true }] }',
    },
    message: `Playtest scenario '${scenarioPath}' is invalid: ${message}`,
    severity: "error",
    suggestion: "Use schemaVersion 1 with a file-safe name, a supported target, and non-empty steps.",
  });
}

export function invalidStep(scenarioPath: string, message: string): PlaytestScenarioError {
  return new PlaytestScenarioError({
    code: "TN_PLAYTEST_SCENARIO_STEP_INVALID",
    fix: {
      docs: "docs/workflows/playtest-proof.md",
      instruction: "Give each step either a press with positive holdTicks or a positive waitTicks value; holdFrames and waitFrames are deprecated aliases; use kind: wait for an explicit no-input interval.",
      snippet: '{ "kind": "input", "press": "KeyW", "holdTicks": 30, "release": true }',
    },
    message: `Playtest scenario '${scenarioPath}' has an invalid step: ${message}`,
    severity: "error",
    suggestion: "Each step must define press or waitTicks; holdTicks is canonical, and holdFrames/waitFrames are deprecated aliases.",
  });
}

export function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  scenarioPath: string,
  objectPath: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown !== undefined) {
    throw invalidScenario(
      scenarioPath,
      `Unknown key '${unknown}' at ${objectPath}.${unknown}. Supported keys: ${[...allowed].sort().join(", ")}.`,
    );
  }
}
