// PRD-444: a user names a hot native function without installing a system profiler. The V8
// `CpuProfiler` compiles into desktop builds behind `TN_JS_PROFILE`, `--cpu-prof <path>` writes a
// loadable Chrome DevTools `.cpuprofile`, and a shipping mobile build carries none of it.
//
// These are source-contract checks in the style of this package's other native tests: the real
// proof is AC-1's run on a built host, which this file's shape keeps honest.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const cmake = source("../CMakeLists.txt");
const v8Engine = source("../src/js/v8_engine.cpp");
const main = source("../src/cli/main.cpp");
const bindings = source("../src/webgpu/bindings.cpp");
const engineHeader = source("../include/mystral/js/engine.h");

test("desktop builds compile the V8 CPU profiler and mobile builds do not", () => {
  // On by default for a desktop build, off for Android and iOS. The option default is computed
  // from the target, so a shipping mobile build carries no profiler code at all.
  assert.match(cmake, /set\(TN_JS_PROFILE_DEFAULT OFF\)/u);
  assert.match(cmake, /set\(TN_JS_PROFILE_DEFAULT ON\)/u);
  assert.match(cmake, /option\(TN_JS_PROFILE[^\n]+ \$\{TN_JS_PROFILE_DEFAULT\}\)/u);
  assert.match(cmake, /TN_JS_PROFILE=\$<BOOL:\$\{TN_JS_PROFILE\}>/u);
  // The profiler blocks stay reachable for the existing Android profiling build.
  assert.match(v8Engine, /#if TN_JS_PROFILE \|\| TN_ANDROID_JS_PROFILE/u);
  assert.doesNotMatch(v8Engine, /#if TN_ANDROID_JS_PROFILE\n#include "v8-profiler\.h"/u);
});

test("--cpu-prof writes a DevTools .cpuprofile through V8's own serializer", () => {
  // V8 serializes the profile; the embedder supplies the sink. Hand-rolling the node walk would
  // be a second implementation of a format V8 already owns.
  assert.match(v8Engine, /v8::OutputStream/u);
  assert.match(v8Engine, /profile->Serialize\(&stream, v8::CpuProfile::kJSON\)/u);
  assert.match(engineHeader, /inline std::string g_cpuProfilePath;/u);
  assert.match(engineHeader, /inline bool g_cpuProfileFailed = false;/u);
});

test("the host CLI parses --cpu-prof, forwards the path and fails closed without the profiler", () => {
  assert.match(main, /arg == "--cpu-prof" && i \+ 1 < argc/u);
  assert.match(main, /arg\.rfind\("--cpu-prof=", 0\) == 0/u);
  assert.match(main, /mystral::js::g_cpuProfilePath = opts\.cpuProfilePath;/u);
  // A build without the profiler refuses the flag rather than running and writing nothing.
  assert.match(main, /--cpu-prof requires a build compiled with TN_JS_PROFILE=ON/u);
  // The profiler starts at the steady-state frame for the env var, and at once for --cpu-prof.
  assert.match(bindings, /frameEndCount == 226 && js::g_startCpuProfile/u);
  assert.match(v8Engine, /if \(!g_cpuProfilePath\.empty\(\)\) g_startCpuProfile\(\);/u);
});
