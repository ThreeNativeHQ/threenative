import assert from "node:assert/strict";
import { test } from "vitest";

import {
  AdbCommandError,
  buildAdbInvocation,
  createAdbClient,
  runAdb,
} from "../scripts/lib/adb.mjs";
import { assertDeviceReady, assertDeviceReadySync } from "../scripts/device-preflight.mjs";

const healthyBattery = [
  "AC powered: false",
  "USB powered: false",
  "Wireless powered: false",
  "status: 3",
  "level: 82",
].join("\n");

function preflightSpawn(battery) {
  return (_executable, args) => {
    const command = args.slice(2).join(" ");
    const outputs = {
      "get-state": "device\n",
      "shell dumpsys battery": battery,
      "shell dumpsys thermalservice": "Thermal Status: 0\n",
      "shell dumpsys power": "mScreenOn=true\n",
      "shell dumpsys display": [
        "mSupportedRefreshRates=[120.0, 60.0]",
        "mActiveSfDisplayMode=DisplayMode{id=0, peakRefreshRate=60.0}",
      ].join("\n"),
      "shell settings get system peak_refresh_rate": "60.0\n",
      "shell settings get system min_refresh_rate": "60.0\n",
      "shell settings get global low_power": "0\n",
    };
    assert.ok(Object.hasOwn(outputs, command), `unexpected adb command: ${command}`);
    return { status: 0, stdout: outputs[command], stderr: "" };
  };
}

test("uses the configured wireless transport", () => {
  assert.deepEqual(
    buildAdbInvocation(undefined, ["get-state"], {
      THREENATIVE_ADB: "/opt/android/adb",
      THREENATIVE_ADB_SERIAL: "192.0.2.42:5555",
    }),
    {
      args: ["-s", "192.0.2.42:5555", "get-state"],
      executable: "/opt/android/adb",
      serial: "192.0.2.42:5555",
    },
  );
});

test("fails closed on a non-zero adb exit", () => {
  assert.throws(
    () =>
      runAdb("device-1", ["shell", "false"], {
        environment: { THREENATIVE_ADB: "/fake/adb" },
        spawnSyncImpl: () => ({ status: 17, stderr: "controlled failure", stdout: "" }),
      }),
    (error) => {
      assert(error instanceof AdbCommandError);
      assert.equal(error.exitCode, 17);
      assert.equal(error.serial, "device-1");
      assert.deepEqual(error.args, ["shell", "false"]);
      assert.match(error.message, /controlled failure/u);
      return true;
    },
  );
});

test("preserves raw sync spawn failure status", () => {
  const device = createAdbClient("device-1", {
    environment: { THREENATIVE_ADB: "/fake/adb" },
    spawnSyncImpl: () => ({ error: new Error("spawn sentinel"), status: null }),
  });
  const result = device.result(["get-state"]);
  assert.equal(result.rawStatus, null);
  assert.equal(result.status, 1);
  assert.throws(() => device.run(["get-state"]), (error) => {
    assert.equal(error.exitCode, 2);
    assert.equal(error.spawnFailed, true);
    return true;
  });
});

test("keeps timeout and output limits on the shared command", () => {
  let observed;
  const output = runAdb("device-1", ["get-state"], {
    environment: { THREENATIVE_ADB: "/fake/adb" },
    spawnSyncImpl: (executable, args, options) => {
      observed = { executable, args, options };
      return { status: 0, stdout: "device\n", stderr: "" };
    },
  });
  assert.equal(output, "device\n");
  assert.equal(observed.executable, "/fake/adb");
  assert.deepEqual(observed.args, ["-s", "device-1", "get-state"]);
  assert.equal(observed.options.timeout, 120_000);
  assert.equal(observed.options.maxBuffer, 8 * 1024 * 1024);
});

test("preserves a command-runner result for qualification callers", () => {
  let observed;
  const device = createAdbClient("device-1", {
    commandImpl: (executable, args, options) => {
      observed = { executable, args, options };
      return { status: 17, stdout: "", stderr: "controlled failure\n" };
    },
    environment: { THREENATIVE_ADB: "/fake/adb" },
    maxBuffer: 16 * 1024 * 1024,
    timeoutMs: 30_000,
  });
  assert.deepEqual(device.result(["install", "candidate.apk"], { timeoutMs: 120_000 }), {
    error: undefined,
    invocation: {
      args: ["-s", "device-1", "install", "candidate.apk"],
      executable: "/fake/adb",
      serial: "device-1",
    },
    rawStatus: 17,
    status: 17,
    stderr: "controlled failure\n",
    stdout: "",
  });
  assert.equal(observed.options.timeout, 120_000);
  assert.equal(observed.options.maxBuffer, 16 * 1024 * 1024);
});

test("preserves non-UTF-8 bytes in sync and async binary results", async () => {
  const bytes = Buffer.from([0xff, 0x00, 0x80]);
  const encodings = [];
  const syncDevice = createAdbClient("device-1", {
    environment: { THREENATIVE_ADB: "/fake/adb" },
    spawnSyncImpl: (_executable, _args, options) => {
      encodings.push(options.encoding);
      return { status: 0, stdout: bytes, stderr: Buffer.alloc(0) };
    },
  });
  const asyncDevice = createAdbClient("device-1", {
    commandImpl: async (_executable, _args, options) => {
      encodings.push(options.encoding);
      return { status: 0, stdout: bytes, stderr: Buffer.alloc(0) };
    },
    environment: { THREENATIVE_ADB: "/fake/adb" },
  });
  assert.deepEqual(syncDevice.result(["exec-out"], { binary: true }).stdout, bytes);
  assert.deepEqual((await asyncDevice.asyncResult(["exec-out"], { binary: true })).stdout, bytes);
  const rejectingDevice = createAdbClient("device-1", {
    commandImpl: async () => {
      throw Object.assign(new Error("controlled binary failure"), {
        code: 7,
        stderr: Buffer.alloc(0),
        stdout: bytes,
      });
    },
    environment: { THREENATIVE_ADB: "/fake/adb" },
  });
  const rejected = await rejectingDevice.asyncResult(["exec-out"], { binary: true });
  assert.equal(rejected.status, 7);
  assert.deepEqual(rejected.stdout, bytes);
  assert.deepEqual(encodings, [null, null]);
});

test("preflight accepts discharging output and refuses charging output through the shared command", async () => {
  const options = {
    allowOverride: false,
    maxThermalStatus: "NONE",
    minBatteryPercent: 50,
    requireDischarging: true,
  };
  const dependencies = {
    environment: { THREENATIVE_ADB: "/fake/adb" },
    spawnSyncImpl: preflightSpawn(healthyBattery),
  };
  const ready = await assertDeviceReady("device-1", options, dependencies);
  assert.equal(ready.charging, false);

  const charging = healthyBattery
    .replace("AC powered: false", "AC powered: true")
    .replace("status: 3", "status: 2");
  await assert.rejects(
    () =>
      assertDeviceReady("device-1", options, {
        ...dependencies,
        spawnSyncImpl: preflightSpawn(charging),
      }),
    /TN_DEVICE_PREFLIGHT_CONDITION_FAILED: charging: expected discharging, observed AC/u,
  );
  assert.throws(
    () =>
      assertDeviceReadySync("device-1", options, {
        ...dependencies,
        spawnSyncImpl: preflightSpawn(charging),
      }),
    /TN_DEVICE_PREFLIGHT_CONDITION_FAILED: charging: expected discharging, observed AC/u,
  );
});
