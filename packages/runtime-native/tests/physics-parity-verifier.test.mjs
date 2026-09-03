import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  artifactPaths,
  browserDisplayArgs,
  clearOutputs,
  compareObservations,
  generateOperatorScenario,
  normalizeReport,
  parseArgs,
  parsePlaytestStdout,
  readFreshObservation,
} from "../scripts/verify-android-physics-parity.mjs";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(runtimeRoot, "..", "..");
const fixtureBytes = readFileSync(
  join(workspaceRoot, "packages/physics/__tests__/fixtures/physics-parity.scenario.json"),
);
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
const templatePath = join(
  workspaceRoot,
  "examples/native-smoke/playtests/physics-parity.playtest.json",
);
const templateBytes = readFileSync(templatePath);
const template = JSON.parse(templateBytes.toString("utf8"));
const sha = createHash("sha256").update(fixtureBytes).digest("hex");
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
  groundBody: "floor",
  groundCollider: "floor",
  groundNormal: [0, 1, 0],
  grounded: true,
  rapierVersion: "0.19.3",
  restingPosition: [0.698946, 0.398779, 0.005188],
  runtime: "web",
  scenarioSha256: sha,
  slopeAngle: 0,
  scenarioCoverage: {
    areaExcludedCharacter: true,
    oneWayPassedUpward: true,
    platformGroundedObserved: true,
  },
  steps: fixture.steps,
};
const device = {
  ...web,
  deviceCondition: {
    batteryPercent: 78,
    charging: false,
    chargingSource: "NONE",
    provisional: [],
    screenOn: true,
    serial: "37251FDJH0037Z",
    thermalStatus: "NONE",
    thermalStatusCode: 0,
  },
  provisional: [],
  rapierVersion: "0.30.0",
  runtime: "native",
};

describe("Android physics parity verifier negative controls", () => {
  it("fails when native floor contact is perturbed while identity stays unchanged", () => {
    expect(() =>
      compareObservations(web, {
        ...device,
        groundNormal: [0, 0.8, 0.6],
        slopeAngle: Math.acos(0.8),
      }),
    ).toThrow(/device final flat-floor normal\/slope outcome|ground normal delta/u);
  });

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

  it("rejects a device observation with a stripped condition block", () => {
    expect(() => compareObservations(web, { ...device, deviceCondition: undefined })).toThrow(
      /device\.deviceCondition/u,
    );
  });

  it("requires matching nested and top-level provisional arrays before comparison", () => {
    expect(() => compareObservations(web, device)).not.toThrow();
    expect(() =>
      compareObservations(web, {
        ...device,
        provisional: undefined,
      }),
    ).toThrow(/device condition block is malformed/u);
    expect(() =>
      compareObservations(web, {
        ...device,
        deviceCondition: { ...device.deviceCondition, provisional: undefined },
      }),
    ).toThrow(/device condition block is malformed/u);
    expect(() =>
      compareObservations(web, {
        ...device,
        provisional: [""],
        deviceCondition: { ...device.deviceCondition, provisional: [""] },
      }),
    ).toThrow(/device condition block is malformed/u);
    expect(() =>
      compareObservations(web, {
        ...device,
        provisional: ["battery"],
        deviceCondition: { ...device.deviceCondition, provisional: ["battery"] },
      }),
    ).toThrow(/provisional device condition/u);
    expect(() =>
      compareObservations(web, {
        ...device,
        deviceCondition: { ...device.deviceCondition, provisional: ["battery"] },
      }),
    ).toThrow(/device condition block is malformed/u);
  });

  it("fails when one-way, platform, or area coverage is absent", () => {
    expect(() =>
      compareObservations(web, {
        ...device,
        scenarioCoverage: { ...device.scenarioCoverage, platformGroundedObserved: false },
      }),
    ).toThrow(/scenario coverage platformGroundedObserved/);
  });

  it("deletes stale observations and fails when fresh device stdout is missing", () => {
    const directory = makeTempDirSync("tn-physics-parity-");
    const path = join(directory, "device-observation.json");
    writeFileSync(path, "stale");
    clearOutputs([path]);
    expect(() => readFreshObservation(path, "device")).toThrow(/stale observations/);
    expect(() => parsePlaytestStdout("", "device")).toThrow(/stdout is missing/);
  });

  it("accepts every executable full-lane control and isolates its raw artifacts", () => {
    for (const control of [
      "missing-device",
      "normal",
      "same-web",
      "wrong-gravity",
      "zero-tolerance",
    ]) {
      expect(parseArgs(["--control", control]).control).toBe(control);
      expect(artifactPaths(control, "/tmp/parity").rawDevice).toContain(`/${control}/`);
    }
  });
});

describe("native physics parity registry wiring", () => {
  it("binds the feet-on-floor subject to the collected web and Rust command", () => {
    const registry = JSON.parse(readFileSync(join(runtimeRoot, "conformance/registry.json"), "utf8"));
    const packageManifest = JSON.parse(
      readFileSync(join(runtimeRoot, "package.json"), "utf8"),
    );
    expect(packageManifest.scripts["native:physics:parity"]).toMatch(
      /vitest run packages\/physics\/__tests__\/parity\.spec\.ts/u,
    );
    expect(packageManifest.scripts["native:physics:parity"]).toMatch(
      /cargo test --manifest-path native\/physics\/Cargo\.toml --lib --test parity/u,
    );
    const proof = registry.generatedPlaytestProofs.find(
      ({ id }) => id === "native-physics-feet-on-floor",
    );
    expect(proof).toMatchObject({
      proof: "packages/runtime-native/native/physics/tests/parity.rs",
      runner: expect.stringContaining("native:physics:parity"),
      scenario: "packages/physics/__tests__/parity.spec.ts",
      status: "implemented",
    });
    const scenario = readFileSync(join(workspaceRoot, proof.scenario), "utf8");
    expect(scenario).toContain("new CharacterBody3D");
    expect(scenario).toContain("new RigidBody3D");
    expect(scenario).toContain("CollisionShape3D.capsule");
    expect(scenario).toContain("character.moveAndSlide");
    expect(scenario).toContain("plugin.update");
    expect(readFileSync(join(workspaceRoot, proof.proof), "utf8")).toContain(
      "feet_on_floor_subject",
    );
  });
});

describe("Android physics parity verifier report parsing", () => {
  it("uses headed WebGPU when a display server is available", () => {
    expect(browserDisplayArgs({ DISPLAY: ":99" })).toEqual(["--headed"]);
    expect(browserDisplayArgs({ WAYLAND_DISPLAY: "wayland-0" })).toEqual(["--headed"]);
    expect(browserDisplayArgs({})).toEqual([]);
  });

  it("normalizes the JSON-safe GameState parity resource", () => {
    const report = {
      observations: { resources: { GameState: { after: { parity: web } } } },
      pass: true,
    };
    expect(normalizeReport(parsePlaytestStdout(JSON.stringify(report), "web"), "web")).toEqual(
      web,
    );
  });

  it("generates wait and SHA assertions only from the current fixture bytes", () => {
    const generated = generateOperatorScenario(template, fixtureBytes);
    expect(generated.steps).toEqual([{ label: "complete", waitTicks: fixture.steps }]);
    expect(generated.assert.resources).toContainEqual({
      allowTrivial: expect.any(String),
      equals: sha,
      id: "GameState",
      path: "parity.scenarioSha256",
    });
    expect(templateBytes.toString("utf8")).not.toContain(sha);
    expect(templateBytes.toString("utf8")).not.toContain(`"waitTicks": ${fixture.steps}`);

    const changedBytes = Buffer.from(JSON.stringify({ ...fixture, steps: fixture.steps + 7 }));
    const changed = generateOperatorScenario(template, changedBytes);
    const changedSha = createHash("sha256").update(changedBytes).digest("hex");
    expect(changed.steps[0].waitTicks).toBe(fixture.steps + 7);
    expect(changed.assert.resources).toContainEqual({
      allowTrivial: expect.any(String),
      equals: changedSha,
      id: "GameState",
      path: "parity.scenarioSha256",
    });
  });
});
