import { expect, test } from "vitest";

import { preflightDisplay } from "../src/runner/runner.js";

const noDisplay = { DISPLAY: undefined, WAYLAND_DISPLAY: undefined };

test("warns before a headless Linux visual run without a display", () => {
  const diagnostic = preflightDisplay(
    { headless: true },
    { artifacts: { screenshots: false }, steps: [], assert: { visual: [{}] } },
    noDisplay,
    "linux",
  );

  expect(diagnostic?.severity).toBe("warning");
  expect(diagnostic?.message).toContain("WebGPU");
  expect(diagnostic?.message).toContain("use sh scripts/xvfb.sh <cmd>.");
  expect(diagnostic?.suggestion).toContain("Prefix the command with sh scripts/xvfb.sh.");
});

test("stays silent when the run has no screenshot or visual assertion", () => {
  expect(
    preflightDisplay(
      { headless: true },
      { artifacts: { screenshots: false }, steps: [] },
      noDisplay,
      "linux",
    ),
  ).toBeUndefined();
});

test("stays silent when a display is available or the browser is headed", () => {
  const scenario = { artifacts: { screenshots: "after" as const }, steps: [] };

  expect(preflightDisplay({ headless: true }, scenario, { DISPLAY: ":99" }, "linux")).toBeUndefined();
  expect(preflightDisplay({ headless: false }, scenario, noDisplay, "linux")).toBeUndefined();
});

test("fails loudly before framebuffer readback on headless Linux without a display", () => {
  const diagnostic = preflightDisplay(
    { headless: true },
    {
      artifacts: { screenshots: false },
      assert: {
        framebufferCoverage: {
          backdrop: [0, 0, 0],
          tolerance: 0,
          window: { endStep: "loading", startStep: "loading" },
        },
      },
      steps: [{ label: "loading", release: true, waitFrames: 1 }],
    },
    noDisplay,
    "linux",
  );

  expect(diagnostic).toMatchObject({
    code: "TN_PLAYTEST_FRAMEBUFFER_PIXELS_UNREADABLE",
    severity: "error",
  });
  expect(diagnostic?.message).toContain("use sh scripts/xvfb.sh <cmd>.");
});
