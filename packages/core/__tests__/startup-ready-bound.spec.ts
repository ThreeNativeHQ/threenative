import { PLAYTEST_STARTUP_READY_TIMEOUT_MS } from "@threenative/playtest";
import { expect, test } from "vitest";

import { STARTUP_COMPILE_BUDGET_MS, STARTUP_STABLE_WINDOW_MS } from "../src/startup-readiness.js";

// The runner now waits for `ctx.startup` to reach "ready" before it observes anything, so a
// scenario stops racing the launch. That wait has to outlast the launch's own worst case, or it
// fails exactly the slow, GPU-less lanes it exists to make honest: golden-path runs on a CPU
// rasteriser that can miss the frame budget forever, and `StartupReadiness` resolves anyway only
// after the compile budget plus the sustained-frame window. Pinned here rather than in
// packages/playtest, which must not depend on @threenative/core.
test("the runner's startup wait outlasts core's own bounded launch", () => {
  expect(PLAYTEST_STARTUP_READY_TIMEOUT_MS).toBeGreaterThan(
    STARTUP_COMPILE_BUDGET_MS + STARTUP_STABLE_WINDOW_MS,
  );
});
