// Facade for the scenario schema/validation modules (PRD-182 Phase 3). Import paths are
// unchanged: every consumer keeps importing from @threenative/playtest and scenario.js.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PlaytestScenarioError, invalidScenario } from "./scenario/errors.js";
import { validatePlaytestScenario } from "./scenario/schema-validate.js";
import { isRecord } from "./scenario/schema-accessors.js";
import type { IPlaytestReachabilityAssertion, IPlaytestScenario } from "./scenario/schema-base.js";

export * from "./scenario/schema-base.js";
export * from "./scenario/schema-validate.js";
export * from "./scenario/schema-accessors.js";
export * from "./scenario/errors.js";

export async function loadPlaytestScenario(projectPath: string, scenarioPath: string): Promise<IPlaytestScenario> {
  const absolutePath = resolve(projectPath, scenarioPath);
  let raw: string;
  try {
    raw = await readFile(absolutePath, "utf8");
  } catch {
    throw new PlaytestScenarioError({
      code: "TN_PLAYTEST_SCENARIO_NOT_FOUND",
      message: `Playtest scenario '${scenarioPath}' could not be read.`,
      severity: "error",
      suggestion: "Check the --scenario path. Committed playtest scenarios normally live under playtests/*.playtest.json.",
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PlaytestScenarioError({
      code: "TN_PLAYTEST_SCENARIO_INVALID",
      message: `Playtest scenario '${scenarioPath}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
      severity: "error",
      suggestion: "Fix the scenario JSON syntax and rerun tn playtest.",
    });
  }
  const scenario = validatePlaytestScenario(parsed, scenarioPath, absolutePath);
  return hydrateReachabilityArtifact(projectPath, scenario, scenarioPath);
}

async function hydrateReachabilityArtifact(projectPath: string, scenario: IPlaytestScenario, scenarioPath: string): Promise<IPlaytestScenario> {
  const assertion = scenario.assert?.reachability;
  if (assertion === undefined) return scenario;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolve(projectPath, assertion.artifact), "utf8"));
  } catch {
    throw invalidScenario(scenarioPath, `Reachability artifact '${assertion.artifact}' could not be read as JSON.`);
  }
  const envelope = reachabilityEnvelope(parsed);
  if (envelope === undefined) {
    throw invalidScenario(scenarioPath, `Reachability artifact '${assertion.artifact}' must contain finite non-negative maxRise, forwardReach, and fallDistanceToGround measurements.`);
  }
  return {
    ...scenario,
    assert: { ...scenario.assert, reachability: { ...assertion, envelope } },
  };
}

function reachabilityEnvelope(value: unknown): IPlaytestReachabilityAssertion["envelope"] | undefined {
  if (!isRecord(value)) return undefined;
  const measurement = isRecord(value.jump) ? value.jump : value;
  return typeof measurement.maxRise === "number" && Number.isFinite(measurement.maxRise) && measurement.maxRise >= 0
    && typeof measurement.forwardReach === "number" && Number.isFinite(measurement.forwardReach) && measurement.forwardReach >= 0
    && typeof measurement.fallDistanceToGround === "number" && Number.isFinite(measurement.fallDistanceToGround) && measurement.fallDistanceToGround >= measurement.maxRise
    ? { fallDistanceToGround: measurement.fallDistanceToGround, forwardReach: measurement.forwardReach, maxRise: measurement.maxRise }
    : undefined;
}
