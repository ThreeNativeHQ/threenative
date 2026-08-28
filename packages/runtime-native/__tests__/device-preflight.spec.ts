import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import {
  assertDeviceReady,
  parseActiveDisplayMode,
  parseRefreshRateSettings,
} from "../scripts/device-preflight.mjs";

/**
 * Verbatim shapes from the Pixel 8 on 2026-08-28. The 60 Hz sample is the state that silently
 * invalidated an fps arm: Smooth Display off, so the panel sat at mode 0 while `supportedModes`
 * still advertised 120 and the app's own frame-rate vote was clamped away.
 */
const DUMPSYS_60 = `
    mSupportedRefreshRates=[120.00001, 60.0, 40.0, 30.0, 24.000002, 20.0]
      DisplayMode{id=0, width=1080, height=2400, peakRefreshRate=60.0, vsyncRate=60.0, group=0}
      DisplayMode{id=1, width=1080, height=2400, peakRefreshRate=120.00001, vsyncRate=120.00001, group=0}
    mActiveSfDisplayMode=DisplayMode{id=0, width=1080, height=2400, xDpi=428.625, peakRefreshRate=60.0, vsyncRate=60.0, group=0}
    mActiveRenderFrameRate=60.0
`;

const DUMPSYS_120 = DUMPSYS_60.replace(
  "mActiveSfDisplayMode=DisplayMode{id=0, width=1080, height=2400, xDpi=428.625, peakRefreshRate=60.0",
  "mActiveSfDisplayMode=DisplayMode{id=1, width=1080, height=2400, xDpi=428.625, peakRefreshRate=120.00001",
);

const BATTERY = "  level: 73\n  scale: 100\n  status: 3\n  AC powered: false\n  USB powered: false\n  Wireless powered: false\n";
const THERMAL = "Current thermal status: 0\n";
const POWER = "  Display Power: state=ON\n";

function deviceStub(overrides: Record<string, string> = {}) {
  const responses: Record<string, string> = {
    "get-state": "device",
    "shell dumpsys battery": BATTERY,
    "shell dumpsys thermalservice": THERMAL,
    "shell dumpsys power": POWER,
    "shell dumpsys display": DUMPSYS_60,
    "shell settings get system peak_refresh_rate": "60.0",
    "shell settings get system min_refresh_rate": "60.0",
    "shell settings get global low_power": "0",
    ...overrides,
  };
  return (args: readonly string[]) => {
    const key = args.join(" ");
    if (!(key in responses)) throw new Error(`unexpected adb call: ${key}`);
    return responses[key];
  };
}

const BASE_OPTIONS = {
  minBatteryPercent: 50,
  requireDischarging: true,
  maxThermalStatus: "NONE",
  allowOverride: false,
};

describe("parseActiveDisplayMode", () => {
  it("reads the active mode, not the advertised modes", () => {
    assert.equal(parseActiveDisplayMode(DUMPSYS_60).activeRefreshHz, 60);
    assert.equal(parseActiveDisplayMode(DUMPSYS_120).activeRefreshHz, 120);
  });

  it("still reports 120 as supported while the panel sits at 60", () => {
    const state = parseActiveDisplayMode(DUMPSYS_60);
    assert.deepEqual(state.supportedRefreshHz, [120, 60, 40, 30, 24, 20]);
    assert.equal(state.activeRefreshHz, 60);
  });

  it("fails closed when dumpsys has no active mode", () => {
    assert.throws(() => parseActiveDisplayMode("nothing here"), /TN_DEVICE_PREFLIGHT_DISPLAY_PARSE/u);
  });
});

describe("parseRefreshRateSettings", () => {
  it("treats an unwritten setting as unset rather than zero", () => {
    const state = parseRefreshRateSettings({ peak: "null", min: "null", lowPower: "null" });
    assert.equal(state.peakRefreshRateSetting, undefined);
    assert.equal(state.minRefreshRateSetting, undefined);
    assert.equal(state.lowPower, false);
  });

  it("reads Smooth Display off and Battery Saver on", () => {
    const state = parseRefreshRateSettings({ peak: "60.0", min: "60.0", lowPower: "1" });
    assert.equal(state.peakRefreshRateSetting, 60);
    assert.equal(state.lowPower, true);
  });

  it("fails closed on an unrecognised low_power value", () => {
    assert.throws(
      () => parseRefreshRateSettings({ peak: "60.0", min: "60.0", lowPower: "maybe" }),
      /TN_DEVICE_PREFLIGHT_DISPLAY_PARSE/u,
    );
  });
});

describe("assertDeviceReady display gate", () => {
  it("captures panel state even when no refresh rate is declared", async () => {
    const condition = await assertDeviceReady("device-1", BASE_OPTIONS, { adb: deviceStub() });
    assert.equal(condition.activeRefreshHz, 60);
    assert.equal(condition.peakRefreshRateSetting, 60);
    assert.equal(condition.lowPower, false);
    assert.deepEqual(condition.provisional, []);
  });

  it("passes when the declared rate is the active rate", async () => {
    const condition = await assertDeviceReady(
      "device-1",
      { ...BASE_OPTIONS, requireRefreshHz: 60 },
      { adb: deviceStub() },
    );
    assert.equal(condition.activeRefreshHz, 60);
  });

  it("fails closed when the panel is not in the declared mode", async () => {
    await expect(
      assertDeviceReady(
        "device-1",
        { ...BASE_OPTIONS, requireRefreshHz: 120 },
        { adb: deviceStub() },
      ),
    ).rejects.toThrow(/refreshRate: expected 120 Hz active, observed 60 Hz/u);
  });

  it("fails closed on Battery Saver, which clamps the mode range independently", async () => {
    await expect(
      assertDeviceReady("device-1", { ...BASE_OPTIONS, requireRefreshHz: 60 }, {
        adb: deviceStub({ "shell settings get global low_power": "1" }),
      }),
    ).rejects.toThrow(/lowPower: expected off, observed on/u);
  });

  it("rejects a non-integer declared rate", async () => {
    await expect(
      assertDeviceReady("device-1", { ...BASE_OPTIONS, requireRefreshHz: 59.94 }, {
        adb: deviceStub(),
      }),
    ).rejects.toThrow(/requireRefreshHz/u);
  });
});
