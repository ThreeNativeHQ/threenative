#!/usr/bin/env node

// PRD-465 Phase 2: build and run the MetaHuman facial-rig bindings contract on Linux desktop.
//
// The contract crosses JS -> binding -> C ABI -> OpenRigLogic in one process and compares every
// committed reference vector, so this is the same proof the browser WASM lane gives for the other
// backend. It needs no window, no scene and no specimen: the DNA is the committed synthetic rig.

import {
  buildNativeTarget,
  configureMetaHumanVerificationBuild,
  nativeTestExecutable,
  resolveCmake,
  run,
} from "./native-test-lane.mjs";

const target = "threenative-metahuman-bindings-test";
const passLine = "native metahuman bindings passed";

function runMetaHumanBindings() {
  const cmake = resolveCmake();
  const buildDirectory = configureMetaHumanVerificationBuild(cmake);
  buildNativeTarget(cmake, buildDirectory, target, 1_800_000);
  const log = run(nativeTestExecutable(buildDirectory, target), [], { timeout: 120_000 });
  if (!log.includes(passLine))
    throw new Error(`metahuman bindings proof did not report a pass:\n${log}`);
  return log;
}

const log = runMetaHumanBindings();
for (const line of log.split("\n")) {
  if (line.startsWith("native metahuman ")) console.info(line);
}
console.info("desktop metahuman bindings proof passed");
