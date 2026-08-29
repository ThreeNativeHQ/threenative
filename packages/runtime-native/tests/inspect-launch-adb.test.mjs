import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";

import { createInspectDevice, record } from "../scripts/inspect-launch.mjs";

test("launch inspector uses the shared transport with its legacy limits", () => {
  const calls = [];
  const device = createInspectDevice(
    "device-1",
    { THREENATIVE_ADB: "/sdk/adb" },
    {
      spawnSyncImpl(executable, args, options) {
        calls.push({ executable, args, options });
        return { status: 9, stdout: "legacy output\n", stderr: "failure\n" };
      },
    },
  );
  assert.equal(device.command(["get-state"]), "legacy output\n");
  assert.deepEqual(calls[0].args, ["-s", "device-1", "get-state"]);
  assert.equal(calls[0].options.timeout, 180_000);
  assert.equal(calls[0].options.maxBuffer, 256 * 1024 * 1024);
});

test("launch inspector preserves missing-adb exit 2", () => {
  assert.throws(
    () =>
      createInspectDevice(
        "device-1",
        { ANDROID_HOME: "/ignored" },
        { defaultSdkRoot: "/missing", existsSyncImpl: () => false },
      ),
    (error) => error?.message === "TN_INSPECT_ADB_MISSING" && error.exitCode === 2,
  );
});

test("launch recorder preserves its shell command, timeout, and error mapping", () => {
  const directory = makeTempDirSync("tn-launch-record-");
  const calls = [];
  const device = {
    command(args) {
      calls.push({ args, kind: "command" });
      if (args[0] === "pull") writeFileSync(args[2], "recording bytes");
      return "";
    },
    result(args, timeoutMs) {
      calls.push({ args, kind: "record", timeoutMs });
      return { status: 17, stdout: "legacy nonzero", stderr: "", error: undefined };
    },
  };
  try {
    assert.deepEqual(
      record("device-1", "dev.example.game/Activity", directory, 7, {
        device,
        execFileSync: (_command, args) => {
          writeFileSync(args.at(-1).replace("%04d", "0001"), "frame bytes");
        },
      }),
      ["frame-0001.png"],
    );
    const recorder = calls.find((call) => call.kind === "record");
    assert.deepEqual(recorder, {
      args: [
        "shell",
        "screenrecord --time-limit 7 --bit-rate 20000000 /sdcard/tn-launch.mp4 & sleep 1; am start -n dev.example.game/Activity >/dev/null; wait",
      ],
      kind: "record",
      timeoutMs: 37_000,
    });
    assert.throws(
      () =>
        record("device-1", "dev.example.game/Activity", directory, 7, {
          device: {
            ...device,
            result: () => ({ error: new Error("recorder spawn failed"), status: 1 }),
          },
        }),
      /TN_INSPECT_RECORD_FAILED:recorder spawn failed/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
