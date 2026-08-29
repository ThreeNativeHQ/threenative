import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveAdbExecutable } from "../scripts/device-preflight.mjs";

const NEVER = () => false;
const ALWAYS = () => true;

test("an explicit THREENATIVE_ADB wins over every SDK root", () => {
  assert.equal(
    resolveAdbExecutable(
      { ANDROID_HOME: "/sdk-home", THREENATIVE_ADB: "/explicit/adb" },
      { existsSyncImpl: NEVER },
    ),
    "/explicit/adb",
  );
});

// The three measurement scripts each grew their own copy of this resolver that read only
// THREENATIVE_ANDROID_SDK, so a machine whose adb is off PATH and named by ANDROID_HOME - the
// documented Android layout - failed to resolve at all. All four keys are honoured, in order.
test("every documented SDK root key resolves, in precedence order", () => {
  for (const key of ["THREENATIVE_ANDROID_SDK", "ANDROID_SDK_ROOT", "ANDROID_HOME"]) {
    assert.equal(
      resolveAdbExecutable({ [key]: "/sdk" }, { existsSyncImpl: ALWAYS }),
      `/sdk/platform-tools/${process.platform === "win32" ? "adb.exe" : "adb"}`,
      `${key} must resolve`,
    );
  }
  assert.equal(
    resolveAdbExecutable(
      { ANDROID_HOME: "/last", ANDROID_SDK_ROOT: "/second", THREENATIVE_ANDROID_SDK: "/first" },
      { existsSyncImpl: ALWAYS },
    ),
    `/first/platform-tools/${process.platform === "win32" ? "adb.exe" : "adb"}`,
  );
});

test("the default resolution falls back to adb on PATH", () => {
  assert.equal(resolveAdbExecutable({}, { existsSyncImpl: NEVER }), "adb");
});

// Fail closed everywhere: a lane that wants a missing adb to be a typed exit-2 failure passes
// onMissing, and the resolver must not silently hand it the PATH fallback instead.
test("onMissing replaces the PATH fallback for fail-closed lanes", () => {
  class Sentinel extends Error {}
  assert.throws(
    () => resolveAdbExecutable({}, { existsSyncImpl: NEVER, onMissing: () => new Sentinel("gone") }),
    Sentinel,
  );
  assert.equal(
    resolveAdbExecutable(
      { THREENATIVE_ANDROID_SDK: "/sdk" },
      { existsSyncImpl: ALWAYS, onMissing: () => new Error("must not fire") },
    ),
    `/sdk/platform-tools/${process.platform === "win32" ? "adb.exe" : "adb"}`,
  );
});

// Each measurement lane keeps its own typed exit-2 contract on a missing adb - the shared
// resolution must not flatten three distinct failure codes into one.
test("each adopting lane keeps its own missing-adb code and exit 2", async () => {
  const lanes = [
    ["../scripts/measure-cold-start.mjs", "TN_COLD_START_ADB_MISSING"],
    ["../scripts/inspect-launch.mjs", "TN_INSPECT_ADB_MISSING"],
    ["../scripts/measure-android-js-engine.mjs", "TN_ANDROID_JS_ADB_MISSING"],
  ];
  for (const [specifier, code] of lanes) {
    const { adbPath } = await import(specifier);
    assert.throws(
      () => adbPath({}, { existsSyncImpl: NEVER }),
      (error) => error.message === code && (error.exitCode ?? error.details?.exitCode) === 2,
      `${specifier} must fail closed as ${code}`,
    );
  }
});

// The regression this closes: all three lanes read only THREENATIVE_ANDROID_SDK, so a machine
// that names its SDK with the documented ANDROID_HOME resolved nothing and the lane died as if
// adb were absent.
test("every adopting lane now honours ANDROID_HOME", async () => {
  const expected = `/from-home/platform-tools/${process.platform === "win32" ? "adb.exe" : "adb"}`;
  for (const specifier of [
    "../scripts/measure-cold-start.mjs",
    "../scripts/inspect-launch.mjs",
    "../scripts/measure-android-js-engine.mjs",
  ]) {
    const { adbPath } = await import(specifier);
    assert.equal(adbPath({ ANDROID_HOME: "/from-home" }, { existsSyncImpl: ALWAYS }), expected);
  }
});
