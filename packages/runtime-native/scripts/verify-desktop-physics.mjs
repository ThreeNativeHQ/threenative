#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildNativeTarget,
  configurePhysicsVerificationBuild,
  nativeTestExecutable,
  resolveCmake,
  run,
} from "./native-test-lane.mjs";
import { inspectScreenshot } from "./verify-desktop-core.mjs";

const runtimeRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const workspaceRoot = join(runtimeRoot, "..", "..");
const exampleRoot = join(workspaceRoot, "examples", "native-smoke");
const bundle = join(exampleRoot, "dist", "native-smoke.js");
const webPhysicsPlaytest = join(exampleRoot, "playtests", "physics.playtest.json");
const desktopPhysicsPlaytest = join(exampleRoot, "playtests", "physics-desktop.playtest.json");

function buildPhysicsBundle() {
  return run(
    "pnpm",
    ["--dir", exampleRoot, "exec", "vite", "build", "--config", "vite.config.ts"],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        THREENATIVE_NATIVE_BACKEND: "enabled",
        THREENATIVE_PHYSICS_PROOF: "enabled",
        THREENATIVE_PLAYTEST_BRIDGE: "disabled",
      },
    },
  );
}

function buildSmokeBundle() {
  return run("pnpm", ["--filter", "threenative-native-smoke", "build"], {
    cwd: workspaceRoot,
  });
}

function parseQuery(log) {
  const match = /TN_NATIVE_PHYSICS_QUERY:(\{[^\n]+\})/u.exec(log);
  if (match === null) throw new Error("desktop physics proof missed TN_NATIVE_PHYSICS_QUERY");
  let value;
  try {
    value = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`desktop physics query marker was not JSON: ${error}`);
  }
  return value;
}

function parsePlaytestObservation(log) {
  const match = /TN_NATIVE_PHYSICS_PLAYTEST:(\{[^\n]+\})/u.exec(log);
  if (match === null) throw new Error("desktop physics proof missed TN_NATIVE_PHYSICS_PLAYTEST");
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`desktop physics playtest marker was not JSON: ${error}`);
  }
}

function readPlaytest(path, label) {
  if (!existsSync(path)) throw new Error(`${label} playtest scenario is missing: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} playtest scenario is invalid: ${error}`);
  }
}

function readPhysicsPlaytestPair() {
  const web = readPlaytest(webPhysicsPlaytest, "web physics");
  const desktop = readPlaytest(desktopPhysicsPlaytest, "desktop physics");
  if (web.target !== "web" || desktop.target !== "desktop")
    throw new Error("physics playtest pair must target web and desktop respectively");
  if (JSON.stringify(web.assert) !== JSON.stringify(desktop.assert))
    throw new Error("web and desktop physics playtests must carry identical assertions");
  return { desktop, web };
}

function valueAtPath(value, path) {
  let current = value;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, part))
      return undefined;
    current = current[part];
  }
  return current;
}

function vectorDistance(left, right) {
  if (!Array.isArray(left) || left.length !== 3 || !Array.isArray(right) || right.length !== 3)
    throw new Error("desktop physics playtest movement marker must contain two 3D positions");
  return Math.hypot(...left.map((value, index) => value - right[index]));
}

function requireDesktopPlaytestAssertions(scenario, observation) {
  const resources = scenario.assert?.resources;
  if (!Array.isArray(resources) || resources.length === 0)
    throw new Error("desktop physics playtest must declare resource assertions");
  for (const [index, assertion] of resources.entries()) {
    if (
      assertion?.id !== "GameState" ||
      typeof assertion.path !== "string" ||
      !Object.hasOwn(assertion, "equals")
    )
      throw new Error(
        `desktop physics playtest resource assertion ${index} is not an equality check`,
      );
    const actual = valueAtPath(observation, assertion.path);
    if (actual === undefined || JSON.stringify(actual) !== JSON.stringify(assertion.equals))
      throw new Error(
        `desktop physics playtest assertion ${assertion.path} failed: expected ${JSON.stringify(assertion.equals)}, received ${JSON.stringify(actual)}`,
      );
  }

  const movement = scenario.assert?.movement;
  if (movement === undefined) return resources.length;
  const before = observation.movement?.before;
  const after = observation.movement?.after;
  if (movement.minDistance !== undefined && vectorDistance(before, after) < movement.minDistance)
    throw new Error(`desktop physics playtest movement distance was below ${movement.minDistance}`);
  const reach = movement.reachesPositionWithin;
  if (reach !== undefined) {
    const finalStep = scenario.steps.at(-1)?.label;
    if (reach.atStep !== finalStep)
      throw new Error(
        `desktop physics playtest movement step '${reach.atStep}' was not the final observed step`,
      );
    if (vectorDistance(after, reach.position) > reach.maxDistance)
      throw new Error(`desktop physics playtest final position exceeded ${reach.maxDistance}`);
  }
  return resources.length + 1;
}

function requireQuery(value) {
  const expected = {
    clearHitCount: 0,
    maskedHitCount: 0,
    pointCount: 1,
    pointMaskedHitCount: 0,
    pointMissCount: 0,
    rayDistance: 2,
    rayNormal: [0, 1, 0],
    rayPosition: [0, 0, 1],
    shapeCount: 1,
    shapeMaskedHitCount: 0,
    shapeMissCount: 0,
  };
  if (JSON.stringify(value) !== JSON.stringify(expected))
    throw new Error(
      `desktop physics query differed from the fixed web contract:\nexpected ${JSON.stringify(expected)}\nreceived ${JSON.stringify(value)}`,
    );
}

function runDesktopPhysics(scenario, buildDirectory) {
  const binary = nativeTestExecutable(buildDirectory, "mystral");
  if (!existsSync(binary)) throw new Error(`native runtime binary is missing: ${binary}`);
  const screenshot = join(runtimeRoot, "artifacts", "desktop-physics-query.png");
  mkdirSync(join(runtimeRoot, "artifacts"), { recursive: true });
  const runtimeArgs = ["run", bundle, "--screenshot", screenshot, "--frames", "180"];
  // See verify-desktop-core.mjs: `xvfb-run` returns its own failing cleanup kill's status here,
  // which turns a passing gate red.
  const command = process.platform === "linux" ? "sh" : binary;
  const args =
    process.platform === "linux"
      ? [join(workspaceRoot, "scripts", "xvfb.sh"), binary, ...runtimeArgs]
      : runtimeArgs;
  const log = run(command, args, {
    env: process.platform === "linux" ? { ...process.env, SDL_VIDEODRIVER: "x11" } : process.env,
    timeout: 120_000,
  });
  if (!log.includes("TN_NATIVE_PHYSICS_PARITY:native:"))
    throw new Error("desktop physics proof missed the completed parity marker");
  if (!log.includes("TN_NATIVE_PHYSICS_INVALID_RAY_THROW"))
    throw new Error("desktop physics proof missed the invalid-ray throw marker");
  if (!log.includes("Rendered 180 frames in "))
    throw new Error("desktop physics proof missed the exact 180-frame completion");
  const query = parseQuery(log);
  const playtestObservation = parsePlaytestObservation(log);
  const assertionCount = requireDesktopPlaytestAssertions(scenario, playtestObservation);
  requireQuery(query);
  inspectScreenshot(screenshot);
  return { assertionCount, query };
}

// The regular desktop scene does not call the actuation methods. Execute the runtime's own JS
// engine against the binding target so the proof crosses JS -> C++ -> C ABI -> Rapier.
function runActuationBindingsProof() {
  const cmake = resolveCmake();
  const buildDir = configurePhysicsVerificationBuild(cmake);
  const target = "threenative-physics-actuation-bindings-test";
  buildNativeTarget(cmake, buildDir, target, 900_000);
  buildNativeTarget(cmake, buildDir, "mystral", 900_000);
  const executable = nativeTestExecutable(buildDir, target);
  const log = run(executable, [], { timeout: 120_000 });
  if (!log.includes("native physics actuation bindings passed"))
    throw new Error(`actuation bindings proof did not report a pass:\n${log}`);
  return buildDir;
}

function main() {
  const { desktop } = readPhysicsPlaytestPair();
  buildPhysicsBundle();
  let proofError;
  let bundleImportError;
  try {
    try {
      const buildDirectory = runActuationBindingsProof();
      console.info("desktop physics actuation bindings proof passed");
      const result = runDesktopPhysics(desktop, buildDirectory);
      console.info(`desktop physics playtest proof passed: ${result.assertionCount} assertions`);
      console.info(`desktop physics query proof passed: ${JSON.stringify(result.query)}`);
    } catch (error) {
      proofError = error;
    }
  } finally {
    buildSmokeBundle();
    const bundleSource = readFileSync(bundle, "utf8");
    if (/^\s*import\s+/mu.test(bundleSource) || /\bimport\s*\(/u.test(bundleSource))
      bundleImportError = new Error("restored native smoke bundle contains a runtime import");
  }
  if (bundleImportError) throw bundleImportError;
  if (proofError) throw proofError;
}

main();
