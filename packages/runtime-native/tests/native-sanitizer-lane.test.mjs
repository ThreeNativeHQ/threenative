import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { discoverNativeTestTargets } from "../scripts/verify-native-contracts.mjs";

const root = join(new URL("..", import.meta.url).pathname);
const cmake = readFileSync(join(root, "CMakeLists.txt"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const runner = readFileSync(join(root, "scripts", "measure-native-coverage.mjs"), "utf8");

const requiredTargets = [
  "threenative-bindings-creation-test",
  "threenative-dom-dispatch-lifetime-test",
  "threenative-frame-op-stream-replay-test",
  "threenative-handle-lifetime-test",
  "threenative-shutdown-lifetime-test",
  "threenative-webgpu-bindings-reentrancy-test",
];

test("configures the sanitizer lane over every required lifetime executable", () => {
  assert.match(cmake, /option\(TN_ENABLE_SANITIZERS/u);
  assert.match(cmake, /-fsanitize=address,undefined/u);
  assert.match(cmake, /-fno-omit-frame-pointer/u);
  assert.match(cmake, /-fno-sanitize=vptr/u);
  assert.doesNotMatch(runner, /detect_leaks=0/u);
  assert.match(runner, /native-lsan-2026-08-28\.supp/u);
  assert.equal(
    packageJson.scripts["native:test:asan"],
    "node scripts/measure-native-coverage.mjs --sanitizers",
  );
  for (const target of requiredTargets) {
    assert.match(cmake, new RegExp(`tn_mark_sanitizer_contract_test\\(${target}\\)`, "u"));
  }
});

test("names every native executable outside the sanitizer lane", async () => {
  const { summarizeSanitizerLane } = await import("../scripts/measure-native-coverage.mjs");
  const allTargets = discoverNativeTestTargets(cmake);
  const report = summarizeSanitizerLane({ allTargets, selectedTargets: requiredTargets });

  assert.deepEqual(report.ran, requiredTargets);
  assert.deepEqual([...report.ran, ...report.notRun].sort(), allTargets);
  assert.equal(report.notRun.length, allTargets.length - requiredTargets.length);
  assert.throws(
    () => summarizeSanitizerLane({ allTargets, selectedTargets: requiredTargets.slice(1) }),
    /sanitizer lane omitted required targets/u,
  );
});
