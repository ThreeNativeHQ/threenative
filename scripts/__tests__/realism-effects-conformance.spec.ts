import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkRealismEffectsConformance,
  validateRealismEffectsBrowserObservation,
  validateRealismEffectsConformance,
  validateRealismEffectsDeviceObservation,
  validateRealismEffectsPlatformResults,
  validateRealismEffectsTemporalObservation,
} from "../realism-effects-conformance.js";

const root = join(import.meta.dirname, "..", "..");

function registry(): unknown {
  return JSON.parse(
    readFileSync(join(root, "packages/runtime-native/conformance/registry.json"), "utf8"),
  );
}

describe("realism-effects conformance", () => {
  it("checks the checked-in registry through the gate entry point", () => {
    expect(checkRealismEffectsConformance(root)).toEqual([]);
  });

  it("registers every covered export with a scene, baseline, and all native lanes", () => {
    const errors = validateRealismEffectsConformance({ registry: registry(), root });
    expect(errors).toEqual([]);
  });

  it("fails when a covered row loses its registration", () => {
    const value = structuredClone(registry()) as { tests: Array<Record<string, unknown>> };
    value.tests = value.tests.filter((row) => row.realismEffect !== "SparkleEffect");
    expect(validateRealismEffectsConformance({ registry: value, root }).join("\n")).toMatch(
      /SparkleEffect.*registration/u,
    );
  });

  it("requires a result for every row and platform", () => {
    const errors = validateRealismEffectsPlatformResults([
      { exportName: "SSGIEffect", platform: "desktop", result: "pass" },
    ]);
    expect(errors.join("\n")).toMatch(/SSGIEffect.*android.*unobservable/u);
  });

  it("requires named reasons for failed or skipped platform results", () => {
    const errors = validateRealismEffectsPlatformResults([
      { exportName: "SSGIEffect", platform: "desktop", result: "fail" },
      { exportName: "SSGIEffect", platform: "android", result: "skipped-with-reason" },
    ]);
    expect(errors.join("\n")).toMatch(/SSGIEffect:desktop.*fail requires a reason/u);
    expect(errors.join("\n")).toMatch(/SSGIEffect:android.*skipped-with-reason requires a reason/u);
  });

  it("requires each native lane to name its target and proof assertion", () => {
    const value = structuredClone(registry()) as { tests: Array<Record<string, unknown>> };
    const row = value.tests.find((test) => test.realismEffect === "SparkleEffect");
    if (row === undefined) throw new Error("SparkleEffect registration fixture is missing");
    const lanes = row?.laneRegistrations as Record<string, Record<string, unknown>>;
    const browser = lanes.browser;
    const android = lanes.android;
    if (browser === undefined || android === undefined)
      throw new Error("SparkleEffect lane fixture is incomplete");
    browser.target = "desktop";
    android.assertsThermal = false;
    const errors = validateRealismEffectsConformance({ registry: value, root });
    expect(errors.join("\n")).toMatch(/SparkleEffect: browser lane target/u);
    expect(errors.join("\n")).toMatch(/SparkleEffect: Android lane must assert thermal/u);
  });

  it("rejects a frozen history even when frame zero matched", () => {
    expect(
      validateRealismEffectsTemporalObservation({
        frameZeroHash: "same",
        settledHash: "same",
        nextHash: "same",
        restoredFrameRendered: true,
        restoredToFrameZero: true,
      }),
    ).toMatch(/frozen temporal history/u);
  });

  it("requires the scene to be restored before the next-frame capture", () => {
    expect(
      validateRealismEffectsTemporalObservation({
        frameZeroHash: "zero",
        settledHash: "settled",
        nextHash: "next",
      }),
    ).toMatch(/restore the scene/u);
  });

  it("rejects a software browser adapter", () => {
    expect(
      validateRealismEffectsBrowserObservation({
        adapter: "SwiftShader",
        completed: true,
      }),
    ).toMatch(/hardware adapter/u);
  });

  it("rejects thermally confounded Android evidence", () => {
    expect(
      validateRealismEffectsDeviceObservation({
        notThermallyConfounded: false,
        platform: "android",
      }),
    ).toMatch(/thermally confounded/u);
  });
});
