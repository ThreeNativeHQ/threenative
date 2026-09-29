#!/usr/bin/env node

// PRD-465 Phase 2: build and run the MetaHuman facial-rig bindings contract on Linux desktop.
//
// The contract crosses JS -> binding -> C ABI -> OpenRigLogic in one process and compares every
// committed reference vector, so this is the same proof the browser WASM lane gives for the other
// backend. It needs no window, no scene and no specimen: the DNA is the committed synthetic rig.
//
//   node scripts/verify-desktop-metahuman.mjs              the contract, plain toolchain
//   node scripts/verify-desktop-metahuman.mjs --sanitize   the same contract under ASan and UBSan,
//                                                         in a build directory of its own, for the
//                                                         lane that parses untrusted DNA bytes

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildNativeTarget,
  configureMetaHumanSanitizerVerificationBuild,
  configureMetaHumanVerificationBuild,
  nativeTestExecutable,
  resolveCmake,
  run,
  runtimeRoot,
} from "./native-test-lane.mjs";

const target = "threenative-metahuman-bindings-test";
const passLine = "native metahuman bindings passed";
const sanitize = process.argv.slice(2).includes("--sanitize");

/**
 * The one known retention this lane suppresses, and why it is not the rig.
 *
 * The V8 engine's pooled JS value handles are freed in `~V8Engine`, but one 8-byte
 * `v8::Persistent` from `acquirePersistent` is still reachable-but-unreleased at exit. It
 * reproduces on the unmodified Phase 1 binding, so it is not this package's, and a rig leak would
 * name `tn_rl_create` or `tn_rl_destroy` in its stack instead — neither of which is suppressed, so
 * a leak in the DNA reader, the ABI or the binding still fails this lane.
 */
const SUPPRESSIONS = `# 2026-09-28: the V8 engine retains one pooled JS value handle past engine
# teardown. Pre-existing, 8 bytes, reproduced on the unmodified Phase 1 metahuman binding.
leak:mystral::js::V8Engine::acquirePersistent
`;

function sanitizerEnvironment(buildDirectory) {
  const suppressionPath = join(buildDirectory, "native-lsan-metahuman.supp");
  writeFileSync(suppressionPath, SUPPRESSIONS);
  return {
    ASAN_OPTIONS: "abort_on_error=1:fast_unwind_on_malloc=0:halt_on_error=1",
    LSAN_OPTIONS: `suppressions=${suppressionPath}`,
    UBSAN_OPTIONS: "halt_on_error=1:print_stacktrace=1",
  };
}

function runMetaHumanBindings() {
  const cmake = resolveCmake();
  const buildDirectory = sanitize
    ? configureMetaHumanSanitizerVerificationBuild(cmake)
    : configureMetaHumanVerificationBuild(cmake);
  buildNativeTarget(cmake, buildDirectory, target, 1_800_000);
  // A sanitizer report exits zero on some findings, so a pass line alone is not the proof: the log
  // must also be free of the tool's own output.
  const log = run(nativeTestExecutable(buildDirectory, target), [], {
    timeout: 600_000,
    env: sanitize ? { ...process.env, ...sanitizerEnvironment(buildDirectory) } : process.env,
  });
  if (!log.includes(passLine))
    throw new Error(`metahuman bindings proof did not report a pass:\n${log}`);
  for (const report of [
    "ERROR: AddressSanitizer",
    "ERROR: LeakSanitizer",
    "runtime error:",
    "SUMMARY: UndefinedBehaviorSanitizer",
  ])
    if (log.includes(report)) throw new Error(`metahuman bindings proof reported ${report}:\n${log}`);
  return log;
}

const log = runMetaHumanBindings();
for (const line of log.split("\n")) {
  if (line.startsWith("native metahuman ")) console.info(line);
}
console.info(`desktop metahuman bindings proof passed${sanitize ? " under ASan and UBSan" : ""}`);
