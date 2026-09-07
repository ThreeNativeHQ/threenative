// The executable proof of this contract is `tests/audio_decode_promise_test.cpp`. Phase 5 deleted
// the source-shape duplicate: the native lane executes Promise chaining, settlement and callbacks.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

const nativeHost = join(root, "build/tn-linux/mystral");

test.skipIf(!existsSync(nativeHost))(
  "a handled decode rejection is reported, but not on stderr [requires a built native host]",
  () => {
  // The failure already reaches the caller three ways: a rejected Promise, the legacy
  // onError callback, and the AudioError it settles with. Writing it to stderr as well
  // makes a game that tests its own error path fail every playtest with noConsoleErrors —
  // examples/native-smoke/src/game.ts:185 does exactly that on purpose, and it failed the
  // PRD-359 desktop networking lane. A browser rejects decodeAudioData without printing.
  const dir = mkdtempSync(join(tmpdir(), "tn-audio-stderr-"));
  const script = join(dir, "handled-decode.js");
  writeFileSync(
    script,
    'const c = new AudioContext();\n'
      + 'c.decodeAudioData(new ArrayBuffer(0)).then(\n'
      + '  () => console.log("UNEXPECTED_RESOLVE"),\n'
      + '  (error) => console.log("HANDLED:" + (error instanceof Error)),\n'
      + ');\n',
  );
  // The host is a game runtime: it keeps its frame loop running, so this bounds the run
  // and reads the streams the kill leaves behind rather than waiting for an exit.
  const run = spawnSync(nativeHost, ["run", script, "--headless"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.match(run.stdout, /HANDLED:true/u, "the caller must receive the rejection as an Error");
  assert.doesNotMatch(
    run.stderr,
    /decodeAudioData received an empty or non-ArrayBuffer argument/u,
    "a rejection the caller handles must not also be reported as a console error",
  );
  // Still reported, just not as an error: deleting it would leave a game that ignores the
  // promise with no diagnostic at all, and this host has no unhandled-rejection reporter.
  assert.match(
    run.stdout,
    /decodeAudioData received an empty or non-ArrayBuffer argument/u,
    "the diagnostic must survive on stdout",
  );
  },
  60_000,
);
