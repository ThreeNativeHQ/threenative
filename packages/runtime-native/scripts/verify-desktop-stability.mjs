#!/usr/bin/env node

// Three stability contracts that a phone is not needed to observe (PRD-210):
//
//   1. the crash-signal policy — Android must leave the dispositions debuggerd owns alone,
//   2. NULL wgpu handles — a NULL from a create/begin/finish must throw to JS naming the
//      operation, instead of being handed to wgpu-native's FFI as a raw memory fault,
//   3. the lifecycle policy — which SDL event pauses the loop, which resumes it, and which is
//      terminal, decided as data so it can be proven without backgrounding an app.
//
// Each is an executable that links the real runtime and asserts on the real mechanism. None of
// them opens a window, touches a GPU, or raises a signal, so this lane runs ahead of every
// display-dependent gate. The device-only halves of PRD-210 (a symbolized tombstone in dropbox,
// screen-off tick traces, the relaunch-cycle table) are named in
// `docs/verification/prd-210-2026-08-23.md` and are not claimed here.

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildNativeTarget,
  desktopBuildDirectory,
  nativeTestExecutable,
  resolveCmake,
  run,
} from "./native-test-lane.mjs";

const runtimeRoot = join(fileURLToPath(new URL("..", import.meta.url)));

const proofs = [
  {
    target: "threenative-crash-handler-policy-test",
    passLine: "native crash-handler policy contract passed",
    what: "Android leaves crash signals to debuggerd",
  },
  {
    target: "threenative-wgpu-null-handle-test",
    passLine: "native wgpu NULL-handle contract passed",
    what: "a NULL wgpu handle throws to JS instead of reaching the FFI",
  },
  {
    target: "threenative-lifecycle-policy-test",
    passLine: "native lifecycle policy contract passed",
    what: "backgrounding pauses the loop and foregrounding resumes it",
  },
];

export function verifyDesktopStability() {
  const cmake = resolveCmake();
  const buildDir = desktopBuildDirectory();
  if (!existsSync(buildDir)) throw new Error(`${buildDir} does not exist; run pnpm native:build`);
  mkdirSync(join(runtimeRoot, "artifacts"), { recursive: true });
  const logs = [];
  for (const proof of proofs) {
    buildNativeTarget(cmake, buildDir, proof.target);
    const executable = nativeTestExecutable(buildDir, proof.target);
    const log = run(executable, [], { timeout: 120_000 });
    // Fail closed: an executable that ran but printed no pass line is a failure, not a skip.
    if (!log.includes(proof.passLine))
      throw new Error(`${proof.target} did not report a pass:\n${log}`);
    logs.push({ ...proof, log });
  }
  return logs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const { what, log } of verifyDesktopStability()) {
    process.stdout.write(log);
    console.info(`desktop stability proof passed: ${what}`);
  }
}
