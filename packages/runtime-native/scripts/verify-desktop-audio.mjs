#!/usr/bin/env node

// The native Web Audio surface is a contract with Three.js, and the part of it that breaks
// silently is `decodeAudioData`'s return value: a non-Promise satisfies `await` and one
// `.catch`, which is every shape Three itself uses, and fails every other chain a game writes.
//
// This proof needs no window and no GPU, so it runs ahead of the display-dependent desktop
// gates rather than behind them — the audio contract stayed unverified once already because
// the only lane that could observe it also needed X11.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
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

// The shipping desktop preset compiles V8 alone, so a run against it proves V8 and reports the
// other engines skipped. `--dual` configures a second build directory that carries V8 *and*
// QuickJS — the documented Android rollback engine — so one run proves both. It is opt-in because
// it builds a second copy of the runtime; the binary itself needs no flag, it runs whichever
// engines the build it came from carries and fails closed if that is none.
function configureDualBuild(cmake) {
  const buildDir = join(runtimeRoot, "build", `${buildPreset()}-dual`);
  const cache = join(runtimeRoot, "build", buildPreset(), "CMakeCache.txt");
  if (!existsSync(cache))
    throw new Error(`${cache} does not exist; run pnpm native:build before --dual`);
  const cached = (name) => {
    const match = readFileSync(cache, "utf8").match(new RegExp(`^${name}:[^=]*=(.*)$`, "mu"));
    if (match?.[1] === undefined || match[1] === "")
      throw new Error(`${name} is not set in ${cache}; run pnpm native:build`);
    return match[1];
  };
  run(
    cmake,
    [
      "-S", ".", "-B", buildDir, "-G", "Ninja",
      `-DCMAKE_MAKE_PROGRAM=${cached("CMAKE_MAKE_PROGRAM")}`,
      `-DCMAKE_C_COMPILER=${cached("CMAKE_C_COMPILER")}`,
      `-DCMAKE_CXX_COMPILER=${cached("CMAKE_CXX_COMPILER")}`,
      "-DCMAKE_BUILD_TYPE=Release",
      "-DMYSTRAL_USE_V8=ON", "-DMYSTRAL_USE_QUICKJS=ON",
      "-DMYSTRAL_USE_DAWN=ON", "-DMYSTRAL_USE_WGPU=OFF",
      "-DTN_ENABLE_CANVAS2D=ON", "-DTN_ENABLE_VIDEO=OFF", "-DTN_ENABLE_RAYTRACING=OFF",
      "-DTN_ENABLE_WEBTRANSPORT=ON", "-DTN_ENABLE_NATIVE_GLTF=OFF", "-DTN_ENABLE_DRACO=OFF",
      "-DTN_ENABLE_DEBUG_SERVER=OFF", "-DTN_ENABLE_NATIVE_PHYSICS=OFF",
    ],
    900_000,
  );
  return buildDir;
}

export function verifyDesktopAudio({ dual = false } = {}) {
  const cmake = resolveCmake();
  const buildDir = dual
    ? configureDualBuild(cmake)
    : join(runtimeRoot, "build", buildPreset());
  if (!existsSync(buildDir))
    throw new Error(`${buildDir} does not exist; run pnpm native:build`);
  mkdirSync(join(runtimeRoot, "artifacts"), { recursive: true });
  run(cmake, ["--build", buildDir, "--target", target, "--parallel"], 1_800_000);
  const executable = join(buildDir, windows ? `${target}.exe` : target);
  const log = run(executable, [], 120_000);
  if (!log.includes(passLine))
    throw new Error(`the decodeAudioData Promise proof did not report a pass:\n${log}`);
  return log;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dual = process.argv.includes("--dual");
  const log = verifyDesktopAudio({ dual });
  // Name the engines that actually ran; a skipped engine is not a result.
  const proven = log.match(new RegExp(`${passLine} on (.*)`, "u"))?.[1] ?? "an unnamed engine";
  console.info(`desktop audio decodeAudioData Promise proof passed on ${proven}`);
}
