import {
  playtestDiagnostic,
  type IPlaytestScenario,
  type IPlaytestSetupApplication,
} from "../index.js";

import { PlaytestBridgeError, type IPlaytestBridgeClient } from "./bridgeClient.js";
import { setupApplication } from "./setup-confirmation.js";
import { composeScenarioSetupRequest } from "./setup-request.js";
import { requestedSetupRecords } from "./shared.js";

/**
 * Apply every declared placement through the bridge's setup channel and report what
 * applied. Any entry that cannot apply fails the run with the reason named — a partial
 * or skipped placement is never reported green.
 */
export async function applyScenarioSetup(
  bridge: Pick<IPlaytestBridgeClient, "applySetup" | "sample">,
  scenario: IPlaytestScenario,
): Promise<IPlaytestSetupApplication> {
  const requested = requestedSetupRecords(scenario);
  try {
    return setupApplication(
      requested,
      await bridge.applySetup(await composeScenarioSetupRequest(bridge, scenario)),
    );
  } catch (error) {
    if ((error as object) instanceof PlaytestBridgeError) throw error;
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_SETUP_UNAPPLIED",
      `Scenario setup could not apply: ${error instanceof Error ? error.message : String(error)}`,
      "Register every placed entity with the playtest bridge before the run, or correct the placement.",
    ));
  }
}
