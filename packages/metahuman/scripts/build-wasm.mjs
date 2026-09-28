// Builds the browser WASM module: OpenRigLogic for wasm32 (scalar, no SIMD, no threads,
// no filesystem) linked with the same cpp/tn_riglogic.cpp the native host uses.
//
//   source ~/.cache/emsdk/emsdk_env.sh        # provides emcmake / em++
//   node packages/metahuman/scripts/build-wasm.mjs
//
// Emits packages/metahuman/wasm/{riglogic.mjs,riglogic.wasm} and the checksum manifest
// that records both file hashes plus the pinned OpenRigLogic commit and the emcc version.
// Nothing is fetched from a CDN and no build artefact outside wasm/ is committed.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { OPENRIGLOGIC_COMMIT, openRigLogicBuildDir, openRigLogicSourceDir, verifyPinnedOpenRigLogic } from "./openriglogic.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cppDir = join(packageRoot, "cpp");
const wasmDir = join(packageRoot, "wasm");

/**
 * No SIMD anywhere: an unnamed adapter may be a software rasteriser.
 *
 * RL_DISABLE_RUNTIME_FEATURE_DETECTION is required, not an optimisation. With it off,
 * upstream compiles trimd's cpuid based getCPUFeatures, which only exists for x86 and
 * ARM, so any other target fails to build. The scalar configuration in tn_riglogic.h
 * never consults those features anyway.
 */
const CONFIGURE = [
  "-DCMAKE_BUILD_TYPE=Release",
  "-DCMAKE_CXX_STANDARD=17",
  "-DRL_BUILD_WITH_SSE=OFF",
  "-DRL_AUTODETECT_SSE=OFF",
  "-DRL_BUILD_WITH_AVX=OFF",
  "-DRL_AUTODETECT_AVX=OFF",
  "-DRL_BUILD_WITH_NEON=OFF",
  "-DRL_AUTODETECT_NEON=OFF",
  "-DRL_BUILD_WITH_HALF_FLOATS=OFF",
  "-DRL_AUTODETECT_HALF_FLOATS=OFF",
  "-DRL_DISABLE_RUNTIME_FEATURE_DETECTION=ON",
  "-DRL_BUILD_TESTS=OFF",
  "-DRL_BUILD_BENCHMARKS=OFF",
  "-DRL_BUILD_EXAMPLES=OFF",
];

/** The whole ABI surface, plus the allocator and heap views a JS adapter needs. */
const LINK = [
  "-O3",
  "-std=c++17",
  "--closure=0",
  "-sMODULARIZE=1",
  "-sEXPORT_ES6=1",
  "-sEXPORT_NAME=createRigLogicModule",
  "-sENVIRONMENT=web,node",
  "-sALLOW_MEMORY_GROWTH=1",
  "-sMAXIMUM_MEMORY=536870912",
  "-sFILESYSTEM=0",
  "-sEXPORTED_FUNCTIONS=_tn_rl_create,_tn_rl_destroy,_tn_rl_count,_tn_rl_name,_tn_rl_set_lod,_tn_rl_set_gui,_tn_rl_set_raw,_tn_rl_evaluate,_tn_rl_joint_outputs,_tn_rl_blendshape_outputs,_tn_rl_animated_map_outputs,_tn_rl_neutral_joints,_tn_rl_last_error,_malloc,_free",
  "-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPF32,UTF8ToString",
];

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: ["ignore", "inherit", "inherit"], ...options });
}

function emccVersion() {
  return run("emcc", ["--version"], { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" })
    .split("\n")[0]
    .trim();
}

function staticLibrary(buildDir) {
  const found = readdirSync(buildDir).filter((name) => name.endsWith(".a"));
  if (found.length === 0) {
    throw new Error(`no static library in ${buildDir}`);
  }
  return join(buildDir, found.find((name) => name.startsWith("libriglogic")) ?? found[0]);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function buildWasm() {
  const revision = verifyPinnedOpenRigLogic();
  const sourceDir = openRigLogicSourceDir();
  const buildDir = openRigLogicBuildDir("wasm");
  mkdirSync(wasmDir, { recursive: true });

  if (!existsSync(buildDir)) {
    mkdirSync(buildDir, { recursive: true });
  }
  // Always configure: the flag list is the contract, so a stale cache cannot hide a
  // changed option.
  run("emcmake", ["cmake", "-S", sourceDir, "-B", buildDir, "-G", "Ninja", ...CONFIGURE]);
  run("cmake", ["--build", buildDir, "--target", "riglogic4"]);

  const library = staticLibrary(buildDir);
  const output = join(wasmDir, "riglogic.mjs");
  run("em++", [join(cppDir, "tn_riglogic.cpp"), library, `-I${join(sourceDir, "include")}`, "-o", output, ...LINK]);

  const manifest = {
    openRigLogicCommit: OPENRIGLOGIC_COMMIT,
    emcc: emccVersion(),
    files: {
      "riglogic.mjs": sha256(output),
      "riglogic.wasm": sha256(join(wasmDir, "riglogic.wasm")),
    },
  };
  writeFileSync(join(wasmDir, "checksums.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`openriglogic ${revision}`);
  console.log(`emcc ${manifest.emcc}`);
  console.log(`wrote ${output}`);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildWasm();
}
