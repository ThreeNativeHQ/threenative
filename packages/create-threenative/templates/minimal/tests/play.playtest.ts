export const playScenario = {
  name: "move to the pickup and score",
  target: "web",
  schemaVersion: 1,
  viewport: { width: 1280, height: 720 },
  steps: [{ kind: "input", press: "ArrowRight", holdFrames: 120, release: true }],
  assert: { diagnostics: { noConsoleErrors: true, runtimeReady: true } },
} as const;
