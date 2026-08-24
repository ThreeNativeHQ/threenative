// Android's zygote chains debuggerd into SIGSEGV/SIGABRT/SIGBUS/SIGTRAP/SIGILL before the process
// runs a line of game code. The host used to call `signal()` for all five right after
// initialization, on every platform, which replaces that disposition — so every crash after
// startup exits `SIGNALED status=11` and writes no tombstone. That is the exact signature of the
// six `com.threenative.bayview` crashes recorded on a physical Pixel 8 on 2026-08-23, and the one
// tombstone that device produced came from a crash that landed *before* the install.
//
// The executable proof is `tests/crash_handler_policy_test.cpp`, which observes the real signal
// disposition. These assertions keep the shape it proves from being undone in the default gate.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("the crash-handler decision is one pure function, not a scattered ifdef", () => {
  const policy = read("include/mystral/platform/crash_policy.h");
  assert.match(
    policy,
    /constexpr CrashHandlerPolicy crashHandlerPolicy\(bool androidPlatform,\s*const char\* showCrashDialogEnv\)/u,
    "the decision must be a pure function so it can be proven without crashing a process",
  );
  assert.match(
    policy,
    /androidPlatform \? CrashHandlerPolicy::LeaveToPlatform/u,
    "Android must never reach an install branch",
  );
});

test("Android installs no crash handler, so debuggerd keeps writing tombstones", () => {
  const handlers = read("src/platform/crash_handlers.cpp");
  assert.match(
    handlers,
    /if \(policy == CrashHandlerPolicy::LeaveToPlatform\) \{[\s\S]*?return false;/u,
    "LeaveToPlatform must return before any signal() call",
  );
  const installBody = handlers.slice(handlers.indexOf("bool applyCrashHandlerPolicy"));
  const guard = installBody.indexOf("signal(SIGABRT");
  assert.ok(guard > installBody.indexOf("LeaveToPlatform"), "the guard must precede the installs");
});

test("the runtime no longer installs signal handlers itself", () => {
  const runtime = read("src/runtime.cpp");
  // The bug was here: five bare `signal()` calls in `runtime.cpp`, reached on every platform.
  for (const sig of ["SIGABRT", "SIGSEGV", "SIGBUS", "SIGTRAP", "SIGILL"])
    assert.doesNotMatch(
      runtime,
      new RegExp(`signal\\(${sig},`, "u"),
      `runtime.cpp must not install a handler for ${sig}; the policy owns that decision`,
    );
  assert.match(
    runtime,
    /platform::installCrashHandlers\(\);/u,
    "the runtime must delegate to the policy",
  );
});

test("the crash-policy proof is built and run by a lane that needs no display", () => {
  assert.match(
    read("CMakeLists.txt"),
    /add_executable\(threenative-crash-handler-policy-test EXCLUDE_FROM_ALL\s*tests\/crash_handler_policy_test\.cpp\)/u,
  );
  const verify = read("scripts/verify-desktop-stability.mjs");
  assert.match(verify, /"threenative-crash-handler-policy-test"/u);
  assert.match(
    JSON.parse(read("package.json")).scripts["native:verify:desktop"],
    /verify-desktop-stability\.mjs/u,
  );
});
