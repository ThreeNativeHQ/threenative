import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearOutputs,
  compareObservations,
  normalizeReport,
  parsePlaytestStdout,
} from "../scripts/verify-android-physics-parity.mjs";

const sha = "c5f9c14ec977ee05e00c4662208fb5d8f1707ff5b64cb41b86bfbc6875330b4d";
const web = {
  areaMembership: ["dynamicBox"],
  areaMembershipSnapshots: [
    "dynamicBox,overlapRemovalTarget",
    "dynamicBox,overlapRemovalTarget",
    "dynamicBox",
    "dynamicBox",
    "dynamicBox",
    "dynamicBox",
  ],
  characterDisplacement: [5.185502, 0.059996, -0.000384],
  collisionEventSet: [
    "boxOnlyArea-dynamicBox-1",
    "dynamicBox-floor-1",
    "dynamicBox-movingPlatform-1",
  ],
  control: "normal",
  groundCollider: "floor",
  grounded: true,
  rapierVersion: "0.19.3",
  restingPosition: [0.698946, 0.398779, 0.005188],
  runtime: "web",
  scenarioSha256: sha,
  steps: 180,
};
const device = { ...web, rapierVersion: "0.30.0", runtime: "native" };

describe("Android physics parity verifier negative controls", () => {
  it("fails when a non-zero resting delta is checked with zero tolerance", () => {
    expect(() =>
      compareObservations(
        web,
        { ...device, restingPosition: [device.restingPosition[0] + 0.001, 0.398779, 0.005188] },
        { restingTolerance: 0 },
      ),
    ).toThrow(/resting position delta/);
  });

  it("fails a device-only gravity flip outcome", () => {
    expect(() =>
      compareObservations(web, {
        ...device,
        areaMembership: [],
        restingPosition: [0.698946, 47, 0.005188],
      }),
    ).toThrow(/resting position delta|area membership/);
  });

  it("fails when both arms point at the web runtime identity", () => {
    expect(() =>
      compareObservations(web, { ...device, rapierVersion: web.rapierVersion, runtime: "web" }),
    ).toThrow(/device runtime identity|same Rapier identity/);
  });

  it("deletes stale observations and fails when fresh device stdout is missing", () => {
    const directory = mkdtempSync(join(tmpdir(), "tn-physics-parity-"));
    const path = join(directory, "device-observation.json");
    writeFileSync(path, "stale");
    clearOutputs([path]);
    expect(() => readFileSync(path)).toThrow();
    expect(() => parsePlaytestStdout("", "device")).toThrow(/stdout is missing/);
  });
});

describe("Android physics parity verifier report parsing", () => {
  it("normalizes the JSON-safe GameState parity resource", () => {
    const report = {
      observations: { resources: { GameState: { after: { parity: web } } } },
      pass: true,
    };
    expect(normalizeReport(parsePlaytestStdout(JSON.stringify(report), "web"), "web")).toEqual(
      web,
    );
  });
});
