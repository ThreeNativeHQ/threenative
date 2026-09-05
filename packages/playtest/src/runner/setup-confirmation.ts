import {
  playtestDiagnostic,
  type IPlaytestSetupConfirmation,
  type IPlaytestSetupRecord,
  type IPlaytestSetupApplication,
} from "../index.js";

import { PlaytestBridgeError } from "./bridgeClient.js";

/** Setup records the bridge's confirmation does not account for. */
function unconfirmed(
  requested: readonly IPlaytestSetupRecord[],
  confirmation: IPlaytestSetupConfirmation,
): IPlaytestSetupRecord[] {
  const entities = new Set(confirmation.entities ?? []);
  const resources = new Set(confirmation.resources ?? []);
  return requested.filter((record) => {
    const named = record.kind === "resources" ? resources : entities;
    // A record with no id cannot be matched against a list of ids. It is unconfirmed by
    // definition, which is the answer that fails rather than the one that passes.
    return record.entity === undefined || !named.has(record.entity);
  });
}

/**
 * Turns what the bridge returned into the report's setup evidence, failing on a request nobody
 * confirmed.
 *
 * The contract this replaces was `{ applied: requested, requested }` — the runner's own request
 * echoed back as though it were an observation. Its single enforcer was each bridge implementation
 * throwing from `applySetup`, so a bridge that partially applied and resolved reported full
 * application and nothing in the report could show otherwise.
 *
 * A bridge that returns no confirmation is still accepted, because the throw contract is real and
 * this repository's own bridge honours it. What is not accepted is calling that a read-back:
 * `confirmedBy` records which evidence the row rests on.
 */
export function setupApplication(
  requested: IPlaytestSetupRecord[],
  confirmation: IPlaytestSetupConfirmation | void,
): IPlaytestSetupApplication {
  if (confirmation === undefined || confirmation === null) {
    return { applied: requested, confirmedBy: "throw-contract", requested };
  }
  const missing = unconfirmed(requested, confirmation);
  if (missing.length > 0) {
    throw new PlaytestBridgeError(
      playtestDiagnostic(
        "TN_PLAYTEST_SETUP_UNAPPLIED",
        `Bridge confirmed setup for ${String(requested.length - missing.length)} of ${String(requested.length)} requests; it did not confirm ${missing.map((record) => `${record.kind} '${record.entity ?? "(unnamed)"}'`).join(", ")}.`,
        "Apply every requested placement, or throw from applySetup naming the one that could not apply. Resolving without naming an entry reports it as applied.",
      ),
    );
  }
  return { applied: requested, confirmedBy: "read-back", requested };
}
