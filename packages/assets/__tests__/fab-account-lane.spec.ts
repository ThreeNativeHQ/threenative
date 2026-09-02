import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * PRD-320 Phase 3: the account-gated lane, deliberately separate from the offline replay.
 *
 * Downloading from Fab needs the owner's entitlements; decoding does not. This lane is the only
 * place in this repository where a live Fab account is exercised, it never runs by default, and
 * its skip must be visible in the runner's output (see the `skipped` count) with its reason —
 * a quiet pass here would be exactly the manufactured evidence PRD-320 exists to prevent.
 *
 * Enable it by setting THREENATIVE_FAB_E2E_LISTING to a listing UID the signed-in account owns.
 * The flow under proof lives in the published `threenative-asset-mcp` package; this lane drives
 * it as an external process, the same way an authoring agent would.
 */

const LISTING = process.env.THREENATIVE_FAB_E2E_LISTING;

describe.skipIf(LISTING === undefined)("the Fab account lane", () => {
  it("imports an owned listing end to end without authenticating, claiming, or purchasing", () => {
    if (LISTING === undefined || LISTING.trim().length === 0) {
      throw new Error(
        "THREENATIVE_FAB_E2E_LISTING is set but empty; name a listing UID to import.",
      );
    }
    // The external CLI reuses the same handlers as the fab_import_asset MCP tool. It must find
    // the session the user already established; this lane never logs in.
    const result = spawnSync("npx", ["threenative-asset-mcp", "import", LISTING, "--out", "."], {
      encoding: "utf8",
      timeout: 600_000,
    });
    // The import report names every export; a licence refusal or missing session surfaces here
    // as a nonzero exit with the named reason, never as a quiet partial import.
    expect(result.status, result.stderr).toBe(0);
  });
});
