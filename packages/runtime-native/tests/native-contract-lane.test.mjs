import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "vitest";

import {
  discoverNativeTestTargets,
  executionContracts,
  runNativeContractLane,
  validateExecutionContracts,
} from "../scripts/verify-native-contracts.mjs";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const cmake = readFileSync(join(root, "CMakeLists.txt"), "utf8");
const helper = readFileSync(join(root, "scripts", "native-test-lane.mjs"), "utf8");
const coverageRunner = readFileSync(join(root, "scripts", "measure-native-coverage.mjs"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const physicsVerifier = readFileSync(join(root, "scripts", "verify-desktop-physics.mjs"), "utf8");

function selectedDesktopBuildDirectory(platform) {
  const lane = pathToFileURL(join(root, "scripts", "native-test-lane.mjs")).href;
  const program = `Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} }); const lane = await import(${JSON.stringify(lane)}); console.log(lane.desktopBuildDirectory());`;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", program], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function declaredTargets(source) {
  return [...source.matchAll(/add_executable\(\s*(threenative-[a-z0-9-]+-test)\b/gu)]
    .map((match) => match[1])
    .sort();
}

function registeredTargets(source) {
  return [...source.matchAll(/tn_register_contract_test\(\s*(threenative-[a-z0-9-]+-test)\b/gu)]
    .map((match) => match[1])
    .sort();
}

test("should register every native executable with CTest", () => {
  const declared = declaredTargets(cmake);
  assert.match(cmake, /enable_testing\(\)/u);
  assert.match(cmake, /function\(tn_register_contract_test target\)[\s\S]*add_test\(/u);
  assert.deepEqual(registeredTargets(cmake), declared);
  assert.equal(
    packageJson.scripts["native:test:cpp"],
    "node scripts/measure-native-coverage.mjs --ctest",
  );
  assert.match(cmake, /add_custom_target\(threenative-native-tests DEPENDS/u);
  assert.match(cmake, /tn_register_contract_test\(threenative-handle-lifetime-test v8\)/u);
  assert.match(cmake, /tn_register_contract_test\(threenative-shutdown-lifetime-test http\)/u);
  assert.match(cmake, /threenative-shutdown-lifetime-test-timer-watch[\s\S]*timer-watch/u);
  assert.match(selectedDesktopBuildDirectory("linux"), /build\/tn-linux$/u);
  assert.match(selectedDesktopBuildDirectory("darwin"), /build\/tn-macos$/u);
  assert.match(selectedDesktopBuildDirectory("win32"), /build\/tn-windows$/u);

  const withUnregisteredTarget = `${cmake}\nadd_executable(threenative-unregistered-test tests/unregistered.cpp)`;
  assert.notDeepEqual(
    registeredTargets(withUnregisteredTarget),
    declaredTargets(withUnregisteredTarget),
  );
});

test("regenerates an existing native build before reading CTest registrations", () => {
  const runner = coverageRunner.slice(
    coverageRunner.indexOf("export function runNativeCtest()"),
    coverageRunner.indexOf("function registrationsForTarget"),
  );
  assert.ok(
    runner.indexOf('buildNativeTarget(cmake, buildDirectory, "threenative-native-tests"') <
      runner.indexOf("ctestRegistrations(buildDirectory, ctest)"),
  );
});

test("should fail when a declared test target is not executed", () => {
  const discovered = discoverNativeTestTargets(cmake);
  // 22 through PRD-224 step 1; +1 for the render-pass class table; +1 for PRD-227's executable
  // packed frame-stream replay contract; +1 for the canvas 2D dirty-tracking contract; +1 for
  // PRD-228's timestamp-query bindings; +1 for its device-pixel-ratio contract. Bump alongside any new add_executable contract target.
  assert.equal(discovered.length, 27);
  assert.deepEqual(discovered, declaredTargets(cmake));
  assert.doesNotThrow(() => validateExecutionContracts(discovered, executionContracts));

  const withUnexecutedTarget = discoverNativeTestTargets(
    `${cmake}\nadd_executable(threenative-unexecuted-test EXCLUDE_FROM_ALL tests/unexecuted.cpp)`,
  );
  assert.throws(
    () => validateExecutionContracts(withUnexecutedTarget, executionContracts),
    /missing execution contracts: threenative-unexecuted-test/u,
  );
});

test("should fail when discovery finds zero targets", () => {
  assert.throws(() => discoverNativeTestTargets("# no native tests here"), /discovered zero/u);
});

test("uses the required exceptional invocations and opt-in verification builds", () => {
  assert.deepEqual(executionContracts["threenative-handle-lifetime-test"].invocations[0].args, [
    "v8",
  ]);
  assert.deepEqual(
    executionContracts["threenative-shutdown-lifetime-test"].invocations.map(({ args }) => args),
    [["http"], ["timer-watch", "$THREENATIVE_TEMPORARY_DIRECTORY"]],
  );
  assert.match(helper, /contracts-video[\s\S]*"TN_ENABLE_VIDEO", "ON"/u);
  assert.match(
    helper,
    /build-native-physics\.mjs[\s\S]*--desktop[\s\S]*contracts-physics[\s\S]*"TN_ENABLE_NATIVE_PHYSICS", "ON"/u,
  );
  assert.match(physicsVerifier, /configurePhysicsVerificationBuild\(cmake\)/u);
  assert.doesNotMatch(physicsVerifier, /build-native-physics\.mjs/u);
  assert.match(readFileSync(join(root, "CMakePresets.json"), "utf8"), /"TN_ENABLE_VIDEO": "OFF"/u);
});

test("reports every target after aggregating build, execution, and pass-line failures", () => {
  const targets = ["threenative-alpha-test", "threenative-beta-test", "threenative-gamma-test"];
  const contracts = Object.fromEntries(
    targets.map((target) => [
      target,
      { invocations: [{ args: [], passLine: `${target} passed` }] },
    ]),
  );
  const reported = [];

  assert.throws(
    () =>
      runNativeContractLane({
        buildTarget(target) {
          if (target === targets[0]) throw new Error("compile failed");
        },
        contracts,
        discoveredTargets: targets,
        report(result) {
          reported.push(result);
        },
        runTarget(target) {
          if (target === targets[1]) return "wrong output";
          return `${target} passed`;
        },
      }),
    /2 native contract target\(s\) failed/u,
  );

  assert.deepEqual(
    reported.map(({ status, target }) => `${status} ${target}`),
    ["FAIL threenative-alpha-test", "FAIL threenative-beta-test", "PASS threenative-gamma-test"],
  );
});

test("desktop physics runs the scene with the physics-enabled verification binary", () => {
  const verifier = readFileSync(join(root, "scripts/verify-desktop-physics.mjs"), "utf8");
  assert.match(verifier, /buildNativeTarget\(cmake, buildDir, "mystral", 900_000\)/u);
  assert.match(
    verifier,
    /const buildDirectory = runActuationBindingsProof\(\);[\s\S]*runDesktopPhysics\(desktop, buildDirectory\)/u,
  );
});
