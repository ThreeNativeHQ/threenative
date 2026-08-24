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
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const windows = process.platform === "win32";

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

function buildPreset() {
  return process.platform === "darwin" ? "tn-macos" : windows ? "tn-windows" : "tn-linux";
}

function resolveCmake() {
  const venvCmake = join(
    runtimeRoot,
    ".runtime",
    "tools-venv",
    windows ? "Scripts" : "bin",
    windows ? "cmake.exe" : "cmake",
  );
  const cmake =
    spawnSync("cmake", ["--version"], { stdio: "ignore" }).status === 0 ? "cmake" : venvCmake;
  if (cmake === venvCmake && !existsSync(venvCmake))
    throw new Error("cmake was not found on PATH or in .runtime/tools-venv; run pnpm native:build");
  return cmake;
}

function run(command, args, timeout) {
  const result = spawnSync(command, args, {
    cwd: runtimeRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout,
  });
  if (result.error) throw result.error;
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}:\n${log}`);
  return log;
}

export function verifyDesktopStability() {
  const cmake = resolveCmake();
  const buildDir = join(runtimeRoot, "build", buildPreset());
  if (!existsSync(buildDir))
    throw new Error(`${buildDir} does not exist; run pnpm native:build`);
  mkdirSync(join(runtimeRoot, "artifacts"), { recursive: true });
  const logs = [];
  for (const proof of proofs) {
    run(cmake, ["--build", buildDir, "--target", proof.target, "--parallel"], 1_800_000);
    const executable = join(buildDir, windows ? `${proof.target}.exe` : proof.target);
    const log = run(executable, [], 120_000);
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
