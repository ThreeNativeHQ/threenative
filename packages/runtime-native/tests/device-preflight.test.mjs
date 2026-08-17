import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "vitest";
import {
  assertDeviceReady,
  DevicePreflightError,
  parseBatteryState,
  parseScreenState,
  parseThermalState,
} from "../scripts/device-preflight.mjs";

const baseOptions = {
  allowOverride: false,
  maxThermalStatus: "NONE",
  minBatteryPercent: 50,
  requireDischarging: true,
};

const healthyBattery = [
  "AC powered: false",
  "USB powered: false",
  "Wireless powered: false",
  "status: 3",
  "level: 82",
].join("\n");
const chargingBattery = [
  "AC powered: true",
  "USB powered: false",
  "Wireless powered: false",
  "status: 2",
  "level: 82",
].join("\n");

function fixtureAdb(overrides = {}) {
  const calls = [];
  const values = {
    battery: healthyBattery,
    power: "mScreenOn=true\nmWakefulness=Awake",
    state: "device\n",
    thermal: "Thermal Status: 0\n",
    ...overrides,
  };
  return {
    calls,
    adb: async (args) => {
      calls.push([...args]);
      const command = args.join(" ");
      if (command === "get-state") return values.state;
      if (command === "shell dumpsys battery") return values.battery;
      if (command === "shell dumpsys thermalservice") return values.thermal;
      if (command === "shell dumpsys power") return values.power;
      throw new Error(`unexpected adb fixture command: ${command}`);
    },
  };
}

describe("device preflight parsers", () => {
  test("parses Android battery source and level variants", () => {
    assert.deepEqual(parseBatteryState(healthyBattery), {
      batteryPercent: 82,
      charging: false,
      chargingSource: "NONE",
    });
    assert.deepEqual(parseBatteryState(chargingBattery), {
      batteryPercent: 82,
      charging: true,
      chargingSource: "AC",
    });
    assert.equal(
      parseBatteryState("status: 2\nlevel: 70").chargingSource,
      "STATUS",
    );
  });

  test("rejects incomplete battery source output without status", () => {
    assert.throws(
      () => parseBatteryState("AC powered: false\nlevel: 82"),
      (error) => {
        assert(error instanceof DevicePreflightError);
        assert.equal(error.code, "TN_DEVICE_PREFLIGHT_CHARGING_PARSE");
        return true;
      },
    );
  });

  test("rejects unrecognised and unknown battery statuses", () => {
    for (const status of [999, 1]) {
      assert.throws(
        () => parseBatteryState(healthyBattery.replace("status: 3", `status: ${status}`)),
        (error) => {
          assert(error instanceof DevicePreflightError);
          assert.equal(error.code, "TN_DEVICE_PREFLIGHT_CHARGING_PARSE");
          return true;
        },
      );
    }
  });

  test("treats a full battery status as charging", async () => {
    const fullBattery = healthyBattery.replace("status: 3", "status: 5");
    assert.deepEqual(parseBatteryState(fullBattery), {
      batteryPercent: 82,
      charging: true,
      chargingSource: "STATUS",
    });
    await assert.rejects(
      () => assertDeviceReady("37251FDJH0037Z", baseOptions, fixtureAdb({ battery: fullBattery })),
      /charging: expected discharging, observed STATUS/u,
    );
  });

  test("parses numeric, named, and display-power thermal/screen variants", () => {
    assert.deepEqual(parseThermalState("Current thermal status: MODERATE"), {
      thermalStatus: "MODERATE",
      thermalStatusCode: 2,
    });
    assert.deepEqual(parseThermalState("mThermalStatus=1"), {
      thermalStatus: "LIGHT",
      thermalStatusCode: 1,
    });
    assert.deepEqual(parseScreenState("Display Power: state=ON"), { screenOn: true });
    assert.deepEqual(parseScreenState("mWakefulness=Asleep"), { screenOn: false });
  });
});

describe("assertDeviceReady", () => {
  test("keeps the shared gate reachable from every device caller", () => {
    const callers = [
      ["measure-android-js-engine.mjs", /await\s+assertDeviceReady\s*\(/u],
      ["measure-cold-start.mjs", /await\s+assertDeviceReady\s*\(/u],
      ["verify-android-physics-parity.mjs", /await\s+assertDeviceReady\s*\(/u],
    ];
    for (const [caller, invocation] of callers) {
      const source = readFileSync(new URL(`../scripts/${caller}`, import.meta.url), "utf8");
      assert.match(source, invocation);
    }
    const engineLoadSource = readFileSync(
      new URL("../../../scripts/engine-load-test/run-android.ts", import.meta.url),
      "utf8",
    );
    assert.match(engineLoadSource, /await\s+assertSharedDeviceReady\s*\(/u);
  });

  test("stores the final preflight observation after build preparation", () => {
    const measurementSource = readFileSync(
      new URL("../scripts/measure-android-js-engine.mjs", import.meta.url),
      "utf8",
    );
    const measurementBuild = measurementSource.indexOf("const builtApkPath");
    const measurementExecution = measurementSource.indexOf("if (options.foxSubject)");
    const measurementPreflight = measurementSource.lastIndexOf("await assertDeviceReady(");
    assert(measurementPreflight > measurementBuild);
    assert(measurementPreflight < measurementExecution);
    assert(measurementSource.indexOf("deviceCondition,", measurementPreflight) > measurementPreflight);

    const physicsSource = readFileSync(
      new URL("../scripts/verify-android-physics-parity.mjs", import.meta.url),
      "utf8",
    );
    const physicsApk = physicsSource.indexOf("const apk =");
    const physicsExecution = physicsSource.indexOf("if (!options.skipInstall) run");
    const physicsPreflight = physicsSource.lastIndexOf("await assertDeviceReady(");
    assert(physicsPreflight > physicsApk);
    assert(physicsPreflight < physicsExecution);
    assert(physicsSource.indexOf("deviceCondition,", physicsPreflight) > physicsPreflight);
  });

  test("returns the complete condition block for a healthy physical device", async () => {
    const fixture = fixtureAdb();
    const state = await assertDeviceReady("37251FDJH0037Z", baseOptions, fixture);
    assert.deepEqual(state, {
      batteryPercent: 82,
      charging: false,
      chargingSource: "NONE",
      provisional: [],
      screenOn: true,
      serial: "37251FDJH0037Z",
      thermalStatus: "NONE",
      thermalStatusCode: 0,
    });
    assert.deepEqual(fixture.calls.map((args) => args.join(" ")), [
      "get-state",
      "shell dumpsys battery",
      "shell dumpsys thermalservice",
      "shell dumpsys power",
    ]);
  });

  test("refuses low battery with the threshold and observed value", async () => {
    const fixture = fixtureAdb({ battery: healthyBattery.replace("level: 82", "level: 21") });
    await assert.rejects(
      () => assertDeviceReady("37251FDJH0037Z", baseOptions, fixture),
      (error) => {
        assert(error instanceof DevicePreflightError);
        assert.equal(error.exitCode, 2);
        assert.match(error.message, /battery: expected >= 50%, observed 21%/u);
        return true;
      },
    );
  });

  test("refuses charging and thermal throttling", async () => {
    const charging = fixtureAdb({ battery: chargingBattery });
    await assert.rejects(
      () => assertDeviceReady("37251FDJH0037Z", baseOptions, charging),
      /charging: expected discharging, observed AC/u,
    );

    const thermal = fixtureAdb({ thermal: "Thermal Status: 3\n" });
    await assert.rejects(
      () => assertDeviceReady("37251FDJH0037Z", baseOptions, thermal),
      /thermal: expected <= NONE, observed SEVERE/u,
    );
  });

  test("refuses screen-off, no-device, emulator, and unparseable fixtures", async () => {
    await assert.rejects(
      () => assertDeviceReady("37251FDJH0037Z", baseOptions, fixtureAdb({ power: "mScreenOn=false" })),
      /screen: expected on, observed off/u,
    );
    await assert.rejects(
      () => assertDeviceReady("37251FDJH0037Z", baseOptions, fixtureAdb({ state: "unknown\n" })),
      /TN_DEVICE_PREFLIGHT_NO_DEVICE/u,
    );
    await assert.rejects(
      () => assertDeviceReady("emulator-5554", baseOptions, fixtureAdb()),
      /TN_DEVICE_PREFLIGHT_EMULATOR_BLOCKED/u,
    );
    await assert.rejects(
      () => assertDeviceReady("37251FDJH0037Z", baseOptions, fixtureAdb({ battery: "level: ???\n" })),
      /TN_DEVICE_PREFLIGHT_BATTERY_PARSE/u,
    );
  });

  test("records every overridden failure as provisional data", async () => {
    const fixture = fixtureAdb({
      battery: chargingBattery.replace("level: 82", "level: 21"),
      power: "mScreenOn=false",
      thermal: "Thermal Status: 3\n",
    });
    const state = await assertDeviceReady(
      "37251FDJH0037Z",
      { ...baseOptions, allowOverride: true },
      fixture,
    );
    assert.deepEqual(state.provisional, ["battery", "charging", "thermal", "screen"]);
  });
});
