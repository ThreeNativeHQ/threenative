import assert from "node:assert/strict";
import { test } from "vitest";

import { createColdStartDevice } from "../scripts/measure-cold-start.mjs";

test("cold-start measurement uses shared adb transport without changing command behavior", () => {
  const calls = [];
  const device = createColdStartDevice(
    "device-1",
    { THREENATIVE_ADB: "/sdk/adb" },
    {
      spawnSyncImpl(executable, args, options) {
        calls.push({ executable, args, options });
        return { status: 17, stdout: "legacy stdout\n", stderr: "legacy stderr\n" };
      },
    },
  );
  assert.equal(device.command(["get-state"]), "legacy stdout\n");
  assert.deepEqual(calls[0].args, ["-s", "device-1", "get-state"]);
  assert.equal(calls[0].options.timeout, 120_000);
  assert.equal(calls[0].options.maxBuffer, 64 * 1024 * 1024);
});

test("cold-start measurement preserves missing-adb exit 2", () => {
  assert.throws(
    () =>
      createColdStartDevice(
        "device-1",
        { ANDROID_HOME: "/ignored-sdk" },
        { defaultSdkRoot: "/missing-home-sdk", existsSyncImpl: () => false },
      ),
    (error) => error?.message === "TN_COLD_START_ADB_MISSING" && error.exitCode === 2,
  );
});
