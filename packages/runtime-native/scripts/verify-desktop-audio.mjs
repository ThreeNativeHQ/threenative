#!/usr/bin/env node

// The native Web Audio surface is a contract with Three.js, and the part of it that breaks
// silently is `decodeAudioData`'s return value: a non-Promise satisfies `await` and one
// `.catch`, which is every shape Three itself uses, and fails every other chain a game writes.
//
// This proof needs no window and no GPU, so it runs ahead of the display-dependent desktop
// gates rather than behind them — the audio contract stayed unverified once already because
// the only lane that could observe it also needed X11.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
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

// Both audio contracts a game depends on before its first frame, in one display-free lane.
//
// The Promise proof came first, for a `decodeAudioData` that returned a non-Promise. The Ogg
// proof came second, for a `decodeAudioData` that could not decode the container the templates
// and the default asset pipeline emit — a WAV-only decoder that made every native target reject
// the `.ogg` files the browser half of the same source plays.
const proofs = [
  {
    target: "threenative-audio-decode-promise-test",
    passLine: "native decodeAudioData Promise contract passed",
    label: "decodeAudioData Promise",
  },
  {
    target: "threenative-audio-decode-ogg-test",
    passLine: "native Ogg Vorbis decode contract passed",
    label: "Ogg Vorbis decode",
  },
];

// The shipping desktop preset compiles V8 alone, so a run against it proves V8 and reports the
// other engines skipped. `--dual` configures a second build directory that carries V8 *and*
// QuickJS — the documented Android rollback engine — so one run proves both. It is opt-in because
// it builds a second copy of the runtime; the binary itself needs no flag, it runs whichever
// engines the build it came from carries and fails closed if that is none.
function configureDualBuild(cmake) {
  const buildDir = desktopBuildDirectory("dual");
  const cache = join(desktopBuildDirectory(), "CMakeCache.txt");
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
      "-S",
      ".",
      "-B",
      buildDir,
      "-G",
      "Ninja",
      `-DCMAKE_MAKE_PROGRAM=${cached("CMAKE_MAKE_PROGRAM")}`,
      `-DCMAKE_C_COMPILER=${cached("CMAKE_C_COMPILER")}`,
      `-DCMAKE_CXX_COMPILER=${cached("CMAKE_CXX_COMPILER")}`,
      "-DCMAKE_BUILD_TYPE=Release",
      "-DMYSTRAL_USE_V8=ON",
      "-DMYSTRAL_USE_QUICKJS=ON",
      "-DMYSTRAL_USE_DAWN=ON",
      "-DMYSTRAL_USE_WGPU=OFF",
      "-DTN_ENABLE_CANVAS2D=ON",
      "-DTN_ENABLE_VIDEO=OFF",
      "-DTN_ENABLE_RAYTRACING=OFF",
      "-DTN_ENABLE_WEBTRANSPORT=ON",
      "-DTN_ENABLE_NATIVE_GLTF=OFF",
      "-DTN_ENABLE_DRACO=OFF",
      "-DTN_ENABLE_DEBUG_SERVER=OFF",
      "-DTN_ENABLE_NATIVE_PHYSICS=OFF",
    ],
    { timeout: 900_000 },
  );
  return buildDir;
}

export function verifyDesktopAudio({ dual = false } = {}) {
  const cmake = resolveCmake();
  const buildDir = dual ? configureDualBuild(cmake) : desktopBuildDirectory();
  if (!existsSync(buildDir)) throw new Error(`${buildDir} does not exist; run pnpm native:build`);
  mkdirSync(join(runtimeRoot, "artifacts"), { recursive: true });
  // Every proof runs, and every proof's output is returned. Stopping at the first failure would
  // hide the second contract behind the first one's repair.
  const logs = [];
  const failures = [];
  for (const proof of proofs) {
    buildNativeTarget(cmake, buildDir, proof.target);
    const executable = nativeTestExecutable(buildDir, proof.target);
    let log;
    try {
      log = run(executable, [], { timeout: 120_000 });
    } catch (error) {
      failures.push(`the ${proof.label} proof failed:\n${error.message}`);
      continue;
    }
    logs.push(log);
    if (!log.includes(proof.passLine))
      failures.push(`the ${proof.label} proof did not report a pass:\n${log}`);
  }
  if (failures.length > 0) throw new Error(failures.join("\n\n"));
  return logs.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dual = process.argv.includes("--dual");
  const log = verifyDesktopAudio({ dual });
  for (const proof of proofs) {
    // Name the engines that actually ran; a skipped engine is not a result.
    const proven =
      log.match(new RegExp(`${proof.passLine} on (.*)`, "u"))?.[1] ?? "an unnamed engine";
    console.info(`desktop audio ${proof.label} proof passed on ${proven}`);
  }
}
