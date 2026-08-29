import assert from "node:assert/strict";
import { test } from "vitest";

import {
  AdbCommandError,
  buildAdbInvocation,
  runAdb,
} from "../scripts/lib/adb.mjs";
import { assertDeviceReady } from "../scripts/device-preflight.mjs";

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
});
