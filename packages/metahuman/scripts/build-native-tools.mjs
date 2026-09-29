// Builds the two native OpenRigLogic tools into the cache, never into the repo:
//   tn_rl_reference  standalone upstream evaluator, produces reference vectors
//   tn_dna_synth     writes the redistributable synthetic fixture
//
//   node packages/metahuman/scripts/build-native-tools.mjs
//
// Requires a linux-x64 RigLogic static library at <cache>/build-linux. Build it with:
//   cmake -S <cache>/src -B <cache>/build-linux -G Ninja -DCMAKE_BUILD_TYPE=Release \
//     -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ \
//     -DRL_BUILD_WITH_AVX=OFF -DRL_AUTODETECT_AVX=OFF -DRL_BUILD_TESTS=OFF \
//     -DRL_BUILD_BENCHMARKS=OFF
//   cmake --build <cache>/build-linux --target riglogic4

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  openRigLogicBuildDir,
  openRigLogicSourceDir,
  openRigLogicToolsDir,
  verifyPinnedOpenRigLogic,
} from "./openriglogic.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cppDir = join(packageRoot, "cpp");

/** Every tool target, so a new one is not forgotten by a caller. */
export const NATIVE_TOOLS = [
  { name: "tn_rl_reference", source: "tn_rl_reference.cpp" },
  { name: "tn_dna_synth", source: "tn_dna_synth.cpp" },
];

function staticLibrary(buildDir) {
  if (!existsSync(buildDir)) {
    throw new Error(`no linux RigLogic build at ${buildDir}. See the header comment in this file.`);
  }
  const found = readdirSync(buildDir).filter((name) => name.endsWith(".a"));
  if (found.length === 0) {
    throw new Error(`no static library in ${buildDir}. Build the riglogic4 target first.`);
  }
  // Prefer the canonical name so a stray libfoo.a cannot win.
  const preferred = found.find((name) => name.startsWith("libriglogic")) ?? found[0];
  return join(buildDir, preferred);
}

export function buildNativeTools({ cxx = process.env.CXX ?? "clang++" } = {}) {
  const source = verifyPinnedOpenRigLogic();
  const buildDir = openRigLogicBuildDir("linux");
  const library = staticLibrary(buildDir);
  const toolsDir = openRigLogicToolsDir();
  mkdirSync(toolsDir, { recursive: true });

  for (const tool of NATIVE_TOOLS) {
    const output = join(toolsDir, tool.name);
    execFileSync(
      cxx,
      [
        "-std=c++17",
        "-O2",
        "-Wall",
        "-Wextra",
        `-I${openRigLogicSourceDir()}/include`,
        join(cppDir, tool.source),
        library,
        "-lpthread",
        "-ldl",
        "-o",
        output,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    console.log(`built ${output} from ${tool.source}`);
  }
  console.log(`openriglogic ${source}`);
  return toolsDir;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildNativeTools();
}
