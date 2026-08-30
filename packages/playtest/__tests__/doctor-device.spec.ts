import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseDoctorArgs } from "../src/runner/cli.js";
import {
  COOL_ENOUGH_BATTERY_PERCENT,
  diagnoseDevice,
  formatDoctorReport,
  type IDoctorReport,
} from "../src/runner/doctor.js";

/**
 * `doctor --device` answers the question `deviceMetrics` can only answer after the fact: is the
 * phone cool enough to start? The fixtures are the same captured device output the metric
 * parsers are tested against — see `fixtures/device-metrics/` and `device-metrics.spec.ts` for
 * their provenance.
 */
const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/device-metrics");

async function fixture(name: string): Promise<string> {
  return readFile(path.join(fixtureRoot, name), "utf8");
}

function adbAnswering(files: Record<string, string>): (args: readonly string[]) => Promise<string> {
  return async (args) => {
    const key = args.join(" ");
    const match = Object.entries(files).find(([prefix]) => key.startsWith(prefix));
    if (match === undefined) throw new Error(`unexpected adb call: ${key}`);
    return match[1];
  };
}

function check(report: IDoctorReport, name: string) {
  return report.checks.find((entry) => entry.name === name);
}

describe("doctor --device", () => {
  it("clears a cool, discharging, charged device", async () => {
    const report = await diagnoseDevice("192.168.1.192:5555", adbAnswering({
      "get-state": "device\n",
      "shell dumpsys battery": await fixture("pixel8-battery.txt"),
      "shell dumpsys thermalservice": await fixture("pixel8-thermalservice.txt"),
    }));

    expect(report.pass).toBe(true);
    expect(check(report, "device.thermal")?.status).toBe("ok");
    expect(check(report, "device.thermal")?.detail).toContain("34.7 °C");
    expect(check(report, "device.thermal")?.detail).toContain("NONE");
    expect(check(report, "device.battery")?.status).toBe("ok");
    expect(check(report, "device.battery")?.detail).toContain("68%");
    expect(check(report, "device.charging")?.status).toBe("ok");
  });

  it("warns rather than failing on a hot, already-throttled device, and names the wait", async () => {
    const report = await diagnoseDevice("192.168.1.192:5555", adbAnswering({
      "get-state": "device\n",
      "shell dumpsys battery": await fixture("pixel8-battery-hot.txt"),
      "shell dumpsys thermalservice": await fixture("pixel8-thermalservice-hot.txt"),
    }));

    // A hot phone is not a broken machine — the run would just not be comparable, so this is a
    // warning an operator can override, and `pass` stays true.
    expect(report.pass).toBe(true);
    expect(check(report, "device.thermal")?.status).toBe("warn");
    expect(check(report, "device.thermal")?.detail).toContain("43.2 °C");
    expect(check(report, "device.thermal")?.detail).toContain("MODERATE");
    expect(check(report, "device.thermal")?.fix).toMatch(/cool/iu);
  });

  it("warns on a charging device, whose power figures are not a benchmark's", async () => {
    const report = await diagnoseDevice("emulator-5554", adbAnswering({
      "get-state": "device\n",
      "shell dumpsys battery": await fixture("emulator-battery.txt"),
      "shell dumpsys thermalservice": await fixture("emulator-thermalservice.txt"),
    }));

    expect(check(report, "device.charging")?.status).toBe("warn");
    expect(check(report, "device.charging")?.fix).toMatch(/wi-?fi/iu);
  });

  it("warns when the battery is below the level a measurement lane needs", async () => {
    const drained = (await fixture("pixel8-battery.txt")).replace("level: 68", "level: 12");
    const report = await diagnoseDevice("192.168.1.192:5555", adbAnswering({
      "get-state": "device\n",
      "shell dumpsys battery": drained,
      "shell dumpsys thermalservice": await fixture("pixel8-thermalservice.txt"),
    }));

    expect(COOL_ENOUGH_BATTERY_PERCENT).toBe(50);
    expect(check(report, "device.battery")?.status).toBe("warn");
    expect(check(report, "device.battery")?.detail).toContain("12%");
  });

  it("fails when the device is not online, and does not probe further", async () => {
    const calls: string[] = [];
    const report = await diagnoseDevice("192.168.1.192:5555", async (args) => {
      calls.push(args.join(" "));
      return "offline\n";
    });

    expect(report.pass).toBe(false);
    expect(check(report, "device")?.status).toBe("fail");
    expect(check(report, "device")?.detail).toContain("offline");
    expect(calls).toEqual(["get-state"]);
  });

  it("fails, never silently reports zero, when a probe cannot be parsed", async () => {
    const report = await diagnoseDevice("192.168.1.192:5555", adbAnswering({
      "get-state": "device\n",
      "shell dumpsys battery": "Current Battery Service state:\n",
      "shell dumpsys thermalservice": await fixture("pixel8-thermalservice.txt"),
    }));

    expect(report.pass).toBe(false);
    expect(check(report, "device.battery")?.status).toBe("fail");
    expect(check(report, "device.battery")?.detail).toContain("TN_PLAYTEST_DEVICE_METRICS_BATTERY_PARSE");
  });

  it("prints its checks through the same report formatter as the machine checks", async () => {
    const report = await diagnoseDevice("192.168.1.192:5555", adbAnswering({
      "get-state": "device\n",
      "shell dumpsys battery": await fixture("pixel8-battery.txt"),
      "shell dumpsys thermalservice": await fixture("pixel8-thermalservice.txt"),
    }));

    expect(formatDoctorReport(report)).toContain("✓ device.thermal:");
  });
});

describe("doctor argument parsing", () => {
  it("reads a device serial", () => {
    expect(parseDoctorArgs(["--device", "192.168.1.192:5555", "--text"])).toEqual({
      browserArgs: [],
      device: "192.168.1.192:5555",
      text: true,
      url: undefined,
    });
  });

  it("leaves the device undefined when the flag is absent", () => {
    expect(parseDoctorArgs(["--text"]).device).toBeUndefined();
  });

  it("fails closed on unknown options and dangling value flags", () => {
    expect(() => parseDoctorArgs(["--devce", "X"])).toThrow(/unknown option '--devce'/u);
    expect(() => parseDoctorArgs(["--device"])).toThrow(/'--device' requires a value/u);
    expect(() => parseDoctorArgs(["--url", "--text"])).toThrow(/'--url' requires a value/u);
  });
});
