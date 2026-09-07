// The executable proof of this contract is `tests/audio_decode_promise_test.cpp`. Phase 5 deleted
// the source-shape duplicate: the native lane executes Promise chaining, settlement and callbacks.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("the decodeAudioData Promise proof is built and run by a lane that needs no display", () => {
  assert.match(
    read("CMakeLists.txt"),
    /add_executable\(threenative-audio-decode-promise-test EXCLUDE_FROM_ALL\s*tests\/audio_decode_promise_test\.cpp\)/u,
  );
  const verify = read("scripts/verify-desktop-audio.mjs");
  assert.match(verify, /target: "threenative-audio-decode-promise-test",/u);
  assert.match(verify, /native decodeAudioData Promise contract passed/u);
  assert.match(
    JSON.parse(read("package.json")).scripts["native:verify:desktop"],
    /verify-desktop-audio\.mjs/u,
  );
});

test("the proof covers every engine the build carries and fails closed on none", () => {
  const proof = read("tests/audio_decode_promise_test.cpp");
  for (const engine of ["EngineType::V8", "EngineType::QuickJS", "EngineType::JavaScriptCore"])
    assert.match(proof, new RegExp(engine.replace(/[:]/gu, "[:]"), "u"));
  assert.match(
    proof,
    /if \(executed == 0\)/u,
    "a build carrying no engine must fail, not report a pass",
  );
  assert.match(
    read("scripts/verify-desktop-audio.mjs"),
    /-DMYSTRAL_USE_V8=ON"[\s\S]*?"-DMYSTRAL_USE_QUICKJS=ON/u,
    "--dual must build the engine pair the QuickJS result came from",
  );
});

test("QuickJS implements the per-frame microtask pump the runtime calls", () => {
  // `Engine::processMicrotasks` has an empty default body, so an engine that does not override it
  // makes the runtime's frame pump a silent no-op — and a binding that hands back a settled
  // Promise depends on that pump. QuickJS is the documented Android rollback engine.
  assert.match(
    read("src/js/quickjs_engine.cpp"),
    /void processMicrotasks\(\) override \{ executePendingJobs\(\); \}/u,
  );
  assert.match(read("src/runtime.cpp"), /processMicrotasks\(\);/u);
});
