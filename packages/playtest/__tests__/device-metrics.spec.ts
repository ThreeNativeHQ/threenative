import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { evaluateRichPlaytestAssertions } from "../src/assertion-evaluators.js";
import {
  DeviceMetricsError,
  DeviceMetricsRecorder,
  HOT_START_TEMPERATURE_C,
  parseDeviceBattery,
  parseDeviceCurrent,
  parseDevicePowerRails,
  parseDeviceThermal,
  summarizeDeviceMetrics,
  type IPlaytestDeviceMetricsSample,
} from "../src/runner/deviceMetrics.js";
import { validatePlaytestScenario } from "../src/scenario.js";

/**
 * Every fixture in `fixtures/device-metrics/` is real captured output, taken on 2026-08-24
 * from the physical Pixel 8 at 192.168.1.192:5555 and from the attached Android emulator.
 * The two `-hot` fixtures are the same real Pixel dumps with only the fields João measured
 * during the confounded PRD-218 runs substituted — battery `temperature: 432` and
 * `Thermal Status: 2` — because reproducing that state would mean heating the device again.
 * No format here is invented.
 */
const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/device-metrics");

async function fixture(name: string): Promise<string> {
  return readFile(path.join(fixtureRoot, name), "utf8");
}

function sample(overrides: Partial<IPlaytestDeviceMetricsSample> = {}): IPlaytestDeviceMetricsSample {
  return {
    at: 0,
    batteryLevelPercent: 68,
    batteryStatus: 3,
    batteryTemperatureC: 34.7,
    charging: false,
    currentMa: { available: true, value: -229.375 },
    phase: "before",
    powerRails: { available: false, reason: "no pixel-thermal power rail window in the captured log" },
    skinTemperatureC: { available: true, value: 33.61866 },
    thermalStatus: 0,
    thermalStatusName: "NONE",
    ...overrides,
  };
}

describe("device battery metrics", () => {
  it("reads level, temperature and discharge state from a real Pixel 8 dumpsys battery", async () => {
    const battery = parseDeviceBattery(await fixture("pixel8-battery.txt"));
    expect(battery).toEqual({
      chargeCounterUah: 2726000,
      charging: false,
      levelPercent: 68,
      status: 3,
      temperatureC: 34.7,
      voltageMv: 3975,
    });
  });

  it("reports the emulator as charging rather than as a benchmark-clean device", async () => {
    const battery = parseDeviceBattery(await fixture("emulator-battery.txt"));
    expect(battery.charging).toBe(true);
    expect(battery.levelPercent).toBe(100);
    expect(battery.temperatureC).toBe(25);
  });

  it("throws instead of reporting zero when dumpsys battery has no temperature", async () => {
    const withoutTemperature = (await fixture("pixel8-battery.txt"))
      .split("\n")
      .filter((line) => !line.includes("temperature:"))
      .join("\n");
    expect(() => parseDeviceBattery(withoutTemperature)).toThrow(DeviceMetricsError);
    expect(() => parseDeviceBattery(withoutTemperature)).toThrow(
      /TN_PLAYTEST_DEVICE_METRICS_BATTERY_PARSE/u,
    );
  });
});

describe("device thermal metrics", () => {
  it("reads the thermal status and skin sensor from a real Pixel 8 dumpsys thermalservice", async () => {
    const thermal = parseDeviceThermal(await fixture("pixel8-thermalservice.txt"));
    expect(thermal.status).toBe(0);
    expect(thermal.statusName).toBe("NONE");
    expect(thermal.skinTemperatureC).toEqual({ available: true, value: 33.61866 });
    expect(thermal.sensors.G3D).toBe(37);
  });

  it("names a rising thermal status by its Android constant", async () => {
    const thermal = parseDeviceThermal(await fixture("pixel8-thermalservice-hot.txt"));
    expect(thermal.status).toBe(2);
    expect(thermal.statusName).toBe("MODERATE");
  });

  it("falls back to the platform mType=3 sensor and names it, so a stub reading is visible", async () => {
    const thermal = parseDeviceThermal(await fixture("emulator-thermalservice.txt"));
    expect(thermal.status).toBe(0);
    expect(thermal.skinTemperatureC).toEqual({ available: true, value: 30.8 });
    expect(thermal.skinSensorName).toBe("test temperature sensor");
  });

  it("degrades to 'not available on this device' when no skin sensor is exposed at all", async () => {
    const withoutSensors = (await fixture("pixel8-thermalservice.txt"))
      .split("\n")
      .filter((line) => !line.includes("Temperature{"))
      .join("\n");
    const thermal = parseDeviceThermal(withoutSensors);
    expect(thermal.skinTemperatureC.available).toBe(false);
    expect(thermal.skinTemperatureC).not.toHaveProperty("value");
    expect(thermal.skinTemperatureC.available === false && thermal.skinTemperatureC.reason).toMatch(
      /skin/iu,
    );
  });

  it("throws instead of defaulting to NONE when no thermal status is printed", () => {
    expect(() => parseDeviceThermal("HAL Ready: true\n")).toThrow(
      /TN_PLAYTEST_DEVICE_METRICS_THERMAL_PARSE/u,
    );
  });
});

describe("device current draw", () => {
  it("converts the real Pixel 8 current_now microamps into a negative discharge in mA", async () => {
    expect(parseDeviceCurrent(await fixture("pixel8-current-now.txt"))).toEqual({
      available: true,
      value: -229.375,
    });
  });

  it("reports unavailable, never zero, when the sysfs node does not exist", async () => {
    const current = parseDeviceCurrent(await fixture("missing-current-now.txt"));
    expect(current.available).toBe(false);
    expect(current).not.toHaveProperty("value");
  });
});

describe("device power rails", () => {
  it("reads the last complete rail window from a real pixel-thermal logcat", async () => {
    const rails = parseDevicePowerRails(await fixture("pixel8-power-rails.logcat.txt"));
    expect(rails.available).toBe(true);
    if (!rails.available) throw new Error("expected rails");
    expect(rails.totalMw).toBe(551.06);
    expect(rails.windowMs).toBe(60014);
    expect(rails.at).toBe("08-24 21:51:45.735");
    expect(rails.rails.S2S_VDD_G3D).toBe(0.83);
    expect(rails.rails.S4M_VDD_CPUCL0).toBe(52.61);
    expect(rails.rails.S1M_VDD_MIF).toBe(26.73);
    expect(Object.keys(rails.rails)).toHaveLength(24);
  });

  it("degrades gracefully on a device that logs no power rails at all", async () => {
    const rails = parseDevicePowerRails(await fixture("emulator-logcat.txt"));
    expect(rails.available).toBe(false);
    expect(rails).not.toHaveProperty("rails");
    expect(rails.available === false && rails.reason).toMatch(/pixel-thermal/u);
  });
});

describe("thermal verdict", () => {
  it("clears a cool run that never changed thermal status", () => {
    const verdict = summarizeDeviceMetrics([
      sample({ at: 0, phase: "before" }),
      sample({ at: 12_000, batteryTemperatureC: 35.1, phase: "after" }),
    ]);
    expect(verdict.thermallyConfounded).toBe(false);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.startTemperatureC).toBe(34.7);
    expect(verdict.endTemperatureC).toBe(35.1);
    expect(verdict.temperatureRiseC).toBeCloseTo(0.4, 5);
  });

  it("flags the PRD-218 confound: a run that started hot and already throttled", () => {
    const verdict = summarizeDeviceMetrics([
      sample({ batteryTemperatureC: 43.2, thermalStatus: 2, thermalStatusName: "MODERATE" }),
      sample({
        at: 44_000,
        batteryTemperatureC: 43.6,
        phase: "after",
        thermalStatus: 2,
        thermalStatusName: "MODERATE",
      }),
    ]);
    expect(verdict.thermallyConfounded).toBe(true);
    expect(verdict.reasons).toContain("hot-start");
    expect(verdict.reasons).toContain("throttled-start");
    expect(verdict.startTemperatureC).toBe(43.2);
  });

  it("flags a run whose thermal status rose part-way through", () => {
    const verdict = summarizeDeviceMetrics([
      sample({ batteryTemperatureC: 38.2 }),
      sample({ at: 20_000, batteryTemperatureC: 41, phase: "during", thermalStatus: 1, thermalStatusName: "LIGHT" }),
      sample({ at: 44_000, batteryTemperatureC: 43.2, phase: "after", thermalStatus: 2, thermalStatusName: "MODERATE" }),
    ]);
    expect(verdict.thermallyConfounded).toBe(true);
    expect(verdict.reasons).toContain("thermal-status-rose");
    expect(verdict.maxThermalStatus).toBe(2);
    expect(verdict.temperatureRiseC).toBeCloseTo(5, 5);
  });

  it("flags a charging device, whose current draw is not comparable to a discharging run", () => {
    const verdict = summarizeDeviceMetrics([
      sample({ charging: true, batteryStatus: 2 }),
      sample({ at: 8000, charging: true, batteryStatus: 2, phase: "after" }),
    ]);
    expect(verdict.thermallyConfounded).toBe(true);
    expect(verdict.reasons).toContain("charging");
  });

  it("fails closed on an empty sample set instead of declaring the run clean", () => {
    const verdict = summarizeDeviceMetrics([]);
    expect(verdict.thermallyConfounded).toBe(true);
    expect(verdict.reasons).toContain("incomplete");
    expect(verdict.startTemperatureC).toBeNull();
  });

  it("keeps the documented hot-start threshold honest", () => {
    expect(HOT_START_TEMPERATURE_C).toBe(40);
    const verdict = summarizeDeviceMetrics(
      [sample({ batteryTemperatureC: HOT_START_TEMPERATURE_C + 0.1 }), sample({ at: 1, phase: "after" })],
    );
    expect(verdict.reasons).toContain("hot-start");
  });
});

describe("device metrics recorder", () => {
  async function recorderWith(files: Record<string, string>): Promise<DeviceMetricsRecorder> {
    return new DeviceMetricsRecorder({
      adb: async (args) => {
        const key = args.join(" ");
        const match = Object.entries(files).find(([prefix]) => key.startsWith(prefix));
        if (match === undefined) throw new Error(`unexpected adb call: ${key}`);
        return match[1];
      },
      serial: "192.168.1.192:5555",
    });
  }

  it("assembles one sample from the four real probes", async () => {
    const recorder = await recorderWith({
      "logcat": await fixture("pixel8-power-rails.logcat.txt"),
      "shell cat /sys/class/power_supply/battery/current_now": await fixture("pixel8-current-now.txt"),
      "shell dumpsys battery": await fixture("pixel8-battery.txt"),
      "shell dumpsys thermalservice": await fixture("pixel8-thermalservice.txt"),
    });
    const captured = await recorder.sampleNow("before");
    expect(captured.batteryTemperatureC).toBe(34.7);
    expect(captured.thermalStatus).toBe(0);
    expect(captured.currentMa).toEqual({ available: true, value: -229.375 });
    expect(captured.powerRails.available).toBe(true);
    expect(captured.phase).toBe("before");
  });

  it("records a probe failure as an observation error rather than dropping the sample", async () => {
    const recorder = await recorderWith({
      "logcat": await fixture("emulator-logcat.txt"),
      "shell cat": await fixture("missing-current-now.txt"),
      "shell dumpsys battery": "device offline",
      "shell dumpsys thermalservice": await fixture("emulator-thermalservice.txt"),
    });
    await expect(recorder.sampleNow("before")).rejects.toThrow(DeviceMetricsError);
    const observation = recorder.observation();
    expect(observation.available).toBe(false);
    expect(observation.errors).toHaveLength(1);
    expect(observation.verdict.thermallyConfounded).toBe(true);
    expect(observation.verdict.reasons).toContain("incomplete");
  });

  it("reports the emulator's degraded probes without pretending they read zero", async () => {
    const recorder = await recorderWith({
      "logcat": await fixture("emulator-logcat.txt"),
      "shell cat": await fixture("missing-current-now.txt"),
      "shell dumpsys battery": await fixture("emulator-battery.txt"),
      "shell dumpsys thermalservice": await fixture("emulator-thermalservice.txt"),
    });
    await recorder.sampleNow("before");
    await recorder.sampleNow("after");
    const observation = recorder.observation();
    expect(observation.available).toBe(true);
    expect(observation.samples).toHaveLength(2);
    expect(observation.samples[0]?.currentMa.available).toBe(false);
    expect(observation.samples[0]?.powerRails.available).toBe(false);
    expect(observation.verdict.powerRailWindowAdvanced).toBeNull();
    expect(observation.verdict.reasons).toContain("charging");
    expect(observation.serial).toBe("192.168.1.192:5555");
  });
});

describe("deviceMetrics scenario assertion", () => {
  function scenarioWith(deviceMetrics: unknown): unknown {
    return {
      assert: { deviceMetrics },
      name: "thermal",
      schemaVersion: 1,
      steps: [{ waitTicks: 4 }],
      target: "web",
    };
  }

  it("rejects an empty deviceMetrics assertion at load", () => {
    expect(() => validatePlaytestScenario(scenarioWith({}), "s.playtest.json", "/tmp/s.playtest.json")).toThrow(
      /TN_PLAYTEST_SCENARIO_INVALID|deviceMetrics/u,
    );
  });

  it("rejects a deviceMetrics value that is not an object, instead of dropping the check", () => {
    expect(() =>
      validatePlaytestScenario(scenarioWith("cool"), "s.playtest.json", "/tmp/s.playtest.json"),
    ).toThrow(/deviceMetrics/u);
  });

  it("rejects notThermallyConfounded: false, which would assert nothing", () => {
    expect(() =>
      validatePlaytestScenario(
        scenarioWith({ notThermallyConfounded: false }),
        "s.playtest.json",
        "/tmp/s.playtest.json",
      ),
    ).toThrow(/notThermallyConfounded/u);
  });

  it("rejects a wrong-typed maxTemperatureRiseC", () => {
    expect(() =>
      validatePlaytestScenario(
        scenarioWith({ maxTemperatureRiseC: "warm" }),
        "s.playtest.json",
        "/tmp/s.playtest.json",
      ),
    ).toThrow(/deviceMetrics/u);
  });

  it("accepts the documented shape", () => {
    const scenario = validatePlaytestScenario(
      scenarioWith({ maxTemperatureRiseC: 5, maxThermalStatus: 1, notThermallyConfounded: true }),
      "s.playtest.json",
      "/tmp/s.playtest.json",
    );
    expect(scenario.assert?.deviceMetrics).toEqual({
      maxTemperatureRiseC: 5,
      maxThermalStatus: 1,
      notThermallyConfounded: true,
    });
  });
});

describe("deviceMetrics assertion evaluation", () => {
  const scenario = {
    artifacts: {},
    assert: { deviceMetrics: { maxTemperatureRiseC: 2, notThermallyConfounded: true } },
    name: "thermal",
    sourcePath: "/tmp/thermal.playtest.json",
    steps: [{ waitTicks: 4 }],
    subject: undefined,
    target: "web" as const,
    viewport: { height: 720, width: 1280 },
    warmupFrames: 0,
  };

  function evaluate(deviceMetrics: unknown) {
    return evaluateRichPlaytestAssertions({
      // biome-ignore lint/suspicious/noExplicitAny: the evaluator only reads the observation slice under test.
      report: { diagnostics: [], distance: 0, entity: "", expectMoved: false, frames: 1, trivialityOptOuts: [], observations: { console: [], hud: {}, network: [], resources: {}, ...(deviceMetrics === undefined ? {} : { deviceMetrics }) } } as any,
      // biome-ignore lint/suspicious/noExplicitAny: partial scenario is enough for this evaluator.
      scenario: scenario as any,
    });
  }

  it("fails and names --target android when no device metrics observation arrived", () => {
    const { assertions, diagnostics } = evaluate(undefined);
    const result = assertions.find(({ id }) => id === "deviceMetrics.observed");
    expect(result?.pass).toBe(false);
    expect(diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_DEVICE_METRICS_UNAVAILABLE");
    expect(diagnostics.find(({ code }) => code === "TN_PLAYTEST_DEVICE_METRICS_UNAVAILABLE")?.suggestion).toMatch(
      /--target android/u,
    );
  });

  it("fails a confounded run while still reporting its measured numbers", () => {
    const samples = [
      sample({ batteryTemperatureC: 43.2, thermalStatus: 2, thermalStatusName: "MODERATE" }),
      sample({ at: 44_000, batteryTemperatureC: 43.6, phase: "after", thermalStatus: 2, thermalStatusName: "MODERATE" }),
    ];
    const { assertions, diagnostics } = evaluate({
      available: true,
      errors: [],
      samples,
      source: "adb",
      verdict: summarizeDeviceMetrics(samples),
    });
    const confound = assertions.find(({ id }) => id === "deviceMetrics.notThermallyConfounded");
    expect(confound?.pass).toBe(false);
    expect(confound?.details?.reasons).toContain("hot-start");
    expect(confound?.details?.startTemperatureC).toBe(43.2);
    expect(diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_DEVICE_THERMALLY_CONFOUNDED");
  });

  it("fails a temperature rise past the declared ceiling", () => {
    const samples = [
      sample({ batteryTemperatureC: 34.7 }),
      sample({ at: 30_000, batteryTemperatureC: 39.9, phase: "after" }),
    ];
    const { assertions } = evaluate({
      available: true,
      errors: [],
      samples,
      source: "adb",
      verdict: summarizeDeviceMetrics(samples),
    });
    const rise = assertions.find(({ id }) => id === "deviceMetrics.maxTemperatureRiseC");
    expect(rise?.pass).toBe(false);
    expect(rise?.details?.observed).toBeCloseTo(5.2, 5);
  });

  it("passes a cool run inside the declared ceiling", () => {
    const samples = [
      sample({ batteryTemperatureC: 34.7 }),
      sample({ at: 30_000, batteryTemperatureC: 35.9, phase: "after" }),
    ];
    const { assertions } = evaluate({
      available: true,
      errors: [],
      samples,
      source: "adb",
      verdict: summarizeDeviceMetrics(samples),
    });
    expect(assertions.filter(({ id }) => id.startsWith("deviceMetrics.")).every(({ pass }) => pass)).toBe(true);
  });
});
