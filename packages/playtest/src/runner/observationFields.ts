export const STANDALONE_PLAYTEST_OBSERVATION_FIELDS = [
  "components",
  "componentSeries",
  "console",
  "effectLogBefore",
  "framebufferCoverage",
  "hud",
  "network",
  "physicsDebugSeries",
  "performanceSeries",
  "physicsDebugBefore",
  "resources",
  "resourceSeries",
  "runtimeDiagnostics",
  "runtimeDiagnosticsBefore",
  "runtimeObservations",
  "signals",
  "signalSeries",
  "visual",
] as const;

/**
 * Observations the *host* measures about the device rather than the game measuring about itself.
 * The bridge is not their producer, so the standalone-runner availability check must not judge
 * them; the evaluator fails closed and names the target that supplies them instead.
 */
export const HOST_PLAYTEST_OBSERVATION_FIELDS = ["deviceMetrics"] as const;
