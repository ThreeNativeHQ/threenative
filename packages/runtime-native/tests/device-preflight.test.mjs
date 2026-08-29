import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "vitest";
import {
  assertDeviceReady,
  DevicePreflightError,
  parseBatteryState,
  parseActiveDisplayMode,
  parseRefreshRateSettings,
  parseScreenState,
  parseThermalState,
  suppressPlayProtectOnAdbInstalls,
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

/**
 * Verbatim shape from the Pixel 8 on 2026-08-28, in the state that silently invalidated an fps arm:
 * Smooth Display off, so the panel sat at mode 0 / 60 Hz while `supportedModes` still advertised
 * 120 and the app's own `Surface.setFrameRate(120)` was clamped away rather than declined.
 */
const displayAt60 = [
  "    mSupportedRefreshRates=[120.00001, 60.0, 40.0, 30.0, 24.000002, 20.0]",
  "      DisplayMode{id=0, width=1080, height=2400, peakRefreshRate=60.0, vsyncRate=60.0, group=0}",
  "      DisplayMode{id=1, width=1080, height=2400, peakRefreshRate=120.00001, vsyncRate=120.00001, group=0}",
  "    mActiveSfDisplayMode=DisplayMode{id=0, width=1080, height=2400, xDpi=428.625, peakRefreshRate=60.0, vsyncRate=60.0, group=0}",
  "    mActiveRenderFrameRate=60.0",
].join("\n");

const displayAt120 = displayAt60.replace(
  "mActiveSfDisplayMode=DisplayMode{id=0, width=1080, height=2400, xDpi=428.625, peakRefreshRate=60.0",
  "mActiveSfDisplayMode=DisplayMode{id=1, width=1080, height=2400, xDpi=428.625, peakRefreshRate=120.00001",
);

function fixtureAdb(overrides = {}) {
  const calls = [];
  const values = {
    battery: healthyBattery,
    power: "mScreenOn=true\nmWakefulness=Awake",
    state: "device\n",
    thermal: "Thermal Status: 0\n",
    display: displayAt60,
    peakRefreshRate: "60.0",
    minRefreshRate: "60.0",
    lowPower: "0",
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
      if (command === "shell dumpsys display") return values.display;
      if (command === "shell settings get system peak_refresh_rate") return values.peakRefreshRate;
      if (command === "shell settings get system min_refresh_rate") return values.minRefreshRate;
      if (command === "shell settings get global low_power") return values.lowPower;
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

  test("rejects non-canonical battery status tokens", () => {
    for (const status of ["3e0", "0x3", "3.0", "+3"]) {
      assert.throws(
        () => parseBatteryState(healthyBattery.replace("status: 3", `status: ${status}`)),
        (error) => {
          assert(error instanceof DevicePreflightError);
          assert.equal(error.code, "TN_DEVICE_PREFLIGHT_CHARGING_PARSE");
          assert.equal(error.details.observed, status);
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
      activeRefreshHz: 60,
      batteryPercent: 82,
      charging: false,
      chargingSource: "NONE",
      lowPower: false,
      minRefreshRateSetting: 60,
      peakRefreshRateSetting: 60,
      provisional: [],
      screenOn: true,
      serial: "37251FDJH0037Z",
      supportedRefreshHz: [120, 60, 40, 30, 24, 20],
      thermalStatus: "NONE",
      thermalStatusCode: 0,
    });
    // The display reads are unconditional: a run that does not gate on the panel still records it,
    // so no later reader has to guess which machine a number came from.
    assert.deepEqual(fixture.calls.map((args) => args.join(" ")).sort(), [
      "get-state",
      "shell dumpsys battery",
      "shell dumpsys display",
      "shell dumpsys power",
      "shell dumpsys thermalservice",
      "shell settings get global low_power",
      "shell settings get system min_refresh_rate",
      "shell settings get system peak_refresh_rate",
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

describe("suppressPlayProtectOnAdbInstalls", () => {
  function verifierFixture(overrides = {}) {
    const calls = [];
    const values = new Map();
    return {
      calls,
      adb: (args) => {
        if (overrides.throwOn === args.join(" ")) {
          throw new Error("adb: device offline");
        }
        calls.push([...args]);
        const command = args.join(" ");
        const put = /^shell settings put global (\S+) 0$/u.exec(command);
        if (put) {
          values.set(put[1], overrides.failPut === put[1] ? "1" : "0");
          return "";
        }
        const get = /^shell settings get global (\S+)$/u.exec(command);
        if (get) return `${values.get(get[1]) ?? "null"}\n`;
        throw new Error(`unexpected adb fixture command: ${command}`);
      },
    };
  }

  test("puts the three adb-install verifier settings and reads each back", () => {
    const fixture = verifierFixture();
    const suppressed = suppressPlayProtectOnAdbInstalls("37251FDJH0037Z", fixture);
    assert.deepEqual(suppressed, [
      "package_verifier_enable",
      "upload_apk_enable",
      "verifier_verify_adb_installs",
    ]);
    assert.deepEqual(fixture.calls.map((args) => args.join(" ")), [
      "shell settings put global package_verifier_enable 0",
      "shell settings get global package_verifier_enable",
      "shell settings put global upload_apk_enable 0",
      "shell settings get global upload_apk_enable",
      "shell settings put global verifier_verify_adb_installs 0",
      "shell settings get global verifier_verify_adb_installs",
    ]);
  });

  test("fails closed when a setting does not take", () => {
    const fixture = verifierFixture({ failPut: "verifier_verify_adb_installs" });
    assert.throws(
      () => suppressPlayProtectOnAdbInstalls("37251FDJH0037Z", fixture),
      (error) => {
        assert(error instanceof DevicePreflightError);
        assert.equal(error.code, "TN_DEVICE_PREFLIGHT_PLAY_PROTECT");
        assert.match(error.message, /verifier_verify_adb_installs/u);
        assert.match(error.message, /observed '1'/u);
        return true;
      },
    );
  });

  test("fails closed when adb itself fails on a put", () => {
    const fixture = verifierFixture({ throwOn: "shell settings put global package_verifier_enable 0" });
    assert.throws(
      () => suppressPlayProtectOnAdbInstalls("37251FDJH0037Z", fixture),
      (error) => {
        assert(error instanceof DevicePreflightError);
        assert.equal(error.code, "TN_DEVICE_PREFLIGHT_PLAY_PROTECT");
        assert.match(error.message, /package_verifier_enable/u);
        assert.match(error.message, /device offline/u);
        return true;
      },
    );
  });

  test("requires a serial", () => {
    assert.throws(
      () => suppressPlayProtectOnAdbInstalls("", verifierFixture()),
      /TN_DEVICE_PREFLIGHT_NO_DEVICE/u,
    );
  });

  test("wired before the install in every lane that installs an APK", () => {
    const installers = [
      ["device-physics-stability.mjs", /adb\(\['install'/u],
      ["measure-android-js-engine.mjs", /"install", "-r", "-t"/u],
      ["profile-production.mjs", /'install', '-r'/u],
      ["qualify-physical-mobile.mjs", /"install", "--no-streaming"/u],
      ["verify-android-first-proof.mjs", /common\('install'/u],
      ["verify-android-physics-parity.mjs", /"install", "-r"/u],
    ];
    for (const [script, installPattern] of installers) {
      const source = readFileSync(new URL(`../scripts/${script}`, import.meta.url), "utf8");
      const suppression = /suppressPlayProtectOnAdbInstalls\(/u.exec(source);
      const install = installPattern.exec(source);
      assert(
        suppression !== null && install !== null && suppression.index < install.index,
        `${script} installs an APK without calling suppressPlayProtectOnAdbInstalls first`,
      );
    }
  });
});

describe("display state", () => {
  test("reads the active mode, not the advertised modes", () => {
    assert.equal(parseActiveDisplayMode(displayAt60).activeRefreshHz, 60);
    assert.equal(parseActiveDisplayMode(displayAt120).activeRefreshHz, 120);
    // 120 stays advertised while the panel sits at 60 — which is exactly why the active mode, and
    // not the supported list, is the thing an arm must declare against.
    assert.deepEqual(parseActiveDisplayMode(displayAt60).supportedRefreshHz, [
      120, 60, 40, 30, 24, 20,
    ]);
  });

  test("fails closed on an unreadable dump or an unrecognised low_power value", () => {
    assert.throws(
      () => parseActiveDisplayMode("nothing here"),
      /TN_DEVICE_PREFLIGHT_DISPLAY_PARSE/u,
    );
    assert.throws(
      () => parseRefreshRateSettings({ peak: "60.0", min: "60.0", lowPower: "maybe" }),
      /TN_DEVICE_PREFLIGHT_DISPLAY_PARSE/u,
    );
  });

  test("treats an unwritten refresh-rate setting as unset rather than zero", () => {
    const state = parseRefreshRateSettings({ peak: "null", min: "null", lowPower: "null" });
    assert.equal(state.peakRefreshRateSetting, undefined);
    assert.equal(state.minRefreshRateSetting, undefined);
    assert.equal(state.lowPower, false);
  });

  test("captures the panel even when no refresh rate is declared", async () => {
    const { adb } = fixtureAdb();
    const condition = await assertDeviceReady("device-1", baseOptions, { adb });
    assert.equal(condition.activeRefreshHz, 60);
    assert.equal(condition.peakRefreshRateSetting, 60);
    assert.equal(condition.lowPower, false);
    assert.deepEqual(condition.provisional, []);
  });

  test("refuses a panel that is not in the declared mode", async () => {
    const { adb } = fixtureAdb();
    await assertDeviceReady("device-1", { ...baseOptions, requireRefreshHz: 60 }, { adb });
    await assert.rejects(
      assertDeviceReady("device-1", { ...baseOptions, requireRefreshHz: 120 }, { adb }),
      /refreshRate: expected 120 Hz active, observed 60 Hz/u,
    );
  });

  test("refuses Battery Saver, which clamps the mode range independently", async () => {
    const { adb } = fixtureAdb({ lowPower: "1" });
    await assert.rejects(
      assertDeviceReady("device-1", { ...baseOptions, requireRefreshHz: 60 }, { adb }),
      /lowPower: expected off, observed on/u,
    );
  });

  test("rejects a declared rate that is not a whole number of hertz", async () => {
    const { adb } = fixtureAdb();
    await assert.rejects(
      assertDeviceReady("device-1", { ...baseOptions, requireRefreshHz: 59.94 }, { adb }),
      /requireRefreshHz/u,
    );
  });
});
