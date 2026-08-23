#!/usr/bin/env node

// The native Web Audio surface is a contract with Three.js, and the part of it that breaks
// silently is `decodeAudioData`'s return value: a non-Promise satisfies `await` and one
// `.catch`, which is every shape Three itself uses, and fails every other chain a game writes.
//
// This proof needs no window and no GPU, so it runs ahead of the display-dependent desktop
// gates rather than behind them — the audio contract stayed unverified once already because
// the only lane that could observe it also needed X11.

import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const windows = process.platform === "win32";
const target = "threenative-audio-decode-promise-test";
const passLine = "native decodeAudioData Promise contract passed";

function buildPreset() {
  return process.platform === "darwin"
    ? "tn-macos"
    : windows
      ? "tn-windows"
      : "tn-linux";
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

export function verifyDesktopAudio() {
  const buildDir = join(runtimeRoot, "build", buildPreset());
  if (!existsSync(buildDir))
    throw new Error(`${buildDir} does not exist; run pnpm native:build`);
  mkdirSync(join(runtimeRoot, "artifacts"), { recursive: true });
  run(resolveCmake(), ["--build", buildDir, "--target", target, "--parallel"], 900_000);
  const executable = join(buildDir, windows ? `${target}.exe` : target);
  const log = run(executable, [], 120_000);
  if (!log.includes(passLine))
    throw new Error(`the decodeAudioData Promise proof did not report a pass:\n${log}`);
  return log;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  verifyDesktopAudio();
  console.info("desktop audio decodeAudioData Promise proof passed");
}
