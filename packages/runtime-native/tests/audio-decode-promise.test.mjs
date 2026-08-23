// The executable proof of this contract is `tests/audio_decode_promise_test.cpp`, which only
// runs in the native lane. These assertions keep the shape it proves from being undone in the
// default gate, and keep the proof itself wired into a lane that can run without a display.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("native decodeAudioData settles a real Promise instead of a hand-rolled thenable", () => {
  const bindings = read("src/audio/audio_bindings.cpp");

  assert.match(
    bindings,
    /static js::JSValueHandle settledPromise\(js::Engine\* engine, const char\* method,\s*js::JSValueHandle value\)/u,
    "the Promise helper must exist",
  );
  assert.match(
    bindings,
    /engine->getGlobalProperty\("Promise"\)/u,
    "the Promise must come from the engine's own constructor",
  );
  assert.match(
    bindings,
    /return settledPromise\(engine, ok \? "resolve" : "reject", settled\);/u,
    "decodeAudioData must return that Promise",
  );
  assert.match(
    bindings,
    /: newAudioError\(engine, failure\);/u,
    "a decode failure must settle with an Error, the way a browser rejects it",
  );
  assert.doesNotMatch(
    bindings,
    /setProperty\(thenable, "then"/u,
    "the ad-hoc thenable returned undefined from then() and broke every chain of two",
  );
});

test("the decodeAudioData Promise proof is built and run by a lane that needs no display", () => {
  assert.match(
    read("CMakeLists.txt"),
    /add_executable\(threenative-audio-decode-promise-test EXCLUDE_FROM_ALL\s*tests\/audio_decode_promise_test\.cpp\)/u,
  );
  const verify = read("scripts/verify-desktop-audio.mjs");
  assert.match(verify, /const target = "threenative-audio-decode-promise-test";/u);
  assert.match(verify, /native decodeAudioData Promise contract passed/u);
  assert.match(
    JSON.parse(read("package.json")).scripts["native:verify:desktop"],
    /verify-desktop-audio\.mjs/u,
  );
});
