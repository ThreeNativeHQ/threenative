import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  androidHostFiles,
  parseBatteryTemperature,
  readyDevice,
  waitUntilCool,
} from "../engine-load-test/cp1-android.js";
import { runCp1 } from "../engine-load-test/cp1.js";

/**
 * A stand-in adb that answers `dumpsys` the way a Pixel does, with the battery, charger and
 * thermal state taken from the environment, so the lane's gates can be exercised without a phone.
 */
function fakeAdb(state: { ac: "true" | "false"; temperature: number; thermal: number }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tn-cp1-adb-"));
  const adb = path.join(dir, "adb");
  writeFileSync(
    adb,
    `#!/bin/sh
shift 2
case "$*" in
  get-state) echo device ;;
  "shell dumpsys battery") printf '  AC powered: ${state.ac}\\n  USB powered: false\\n  Wireless powered: false\\n  status: ${state.ac === "true" ? 2 : 3}\\n  level: 80\\n  temperature: ${state.temperature}\\n' ;;
  "shell dumpsys thermalservice") echo "Thermal Status: ${state.thermal}" ;;
  "shell dumpsys power") echo "mWakefulness=Awake" ;;
  "shell dumpsys display") echo "mActiveSfDisplayMode=DisplayMode{id=1, peakRefreshRate=120.0}"; echo "mSupportedRefreshRates=[60.0, 120.0]" ;;
  "shell settings get"*) echo null ;;
esac
`,
  );
  chmodSync(adb, 0o755);
  return adb;
}

afterEach(() => {
  Reflect.deleteProperty(process.env, "ADB_BIN");
});

describe("the Android CP1 lane's device gates", () => {
  it("reads the battery temperature in degrees, from tenths", () => {
    expect(parseBatteryTemperature("  level: 80\n  temperature: 315\n")).toBe(31.5);
    expect(() => parseBatteryTemperature("  level: 80\n")).toThrow("TN_BENCH_DEVICE_TEMPERATURE");
  });

  it("starts an arm on a cool, unthrottled device that is on battery", async () => {
    process.env.ADB_BIN = fakeAdb({ ac: "false", temperature: 305, thermal: 0 });
    const state = await readyDevice("PIXEL", "native-cpp");
    expect(state).toMatchObject({ charging: false, thermalStatus: "NONE", activeRefreshHz: 120 });
    expect(state.provisional).toEqual([]);
  });

  it("refuses a phone on a charger, with no override", async () => {
    process.env.ADB_BIN = fakeAdb({ ac: "true", temperature: 305, thermal: 0 });
    await expect(readyDevice("PIXEL", "native-cpp")).rejects.toThrow(
      /TN_DEVICE_PREFLIGHT_CONDITION_FAILED.*charging: expected discharging, observed AC/u,
    );
  });

  it("waits for the cool-down instead of waiving it, and gives up by name", async () => {
    process.env.ADB_BIN = fakeAdb({ ac: "false", temperature: 340, thermal: 0 });
    await expect(
      waitUntilCool("PIXEL", 31.5, { pollMs: 1, timeoutMs: 20, log: () => {} }),
    ).rejects.toThrow(/TN_BENCH_DEVICE_HOT.*34 C/u);
    process.env.ADB_BIN = fakeAdb({ ac: "false", temperature: 300, thermal: 1 });
    await expect(
      waitUntilCool("PIXEL", 31.5, { pollMs: 1, timeoutMs: 20, log: () => {} }),
    ).rejects.toThrow(/TN_BENCH_DEVICE_HOT.*thermal LIGHT/u);
  });

  it("lists the host and every library it loads", () => {
    const { files } = androidHostFiles("/repo");
    expect(files.map(([, remote]) => remote)).toEqual([
      "tn-native-engine-host",
      "libv8android.so",
      "snapshot_blob.bin",
      "libSDL3.so",
      "libc++_shared.so",
    ]);
  });
});

describe("runCp1 on Android", () => {
  const unreachable = () => Promise.reject(new Error("the current arm must not run"));
  const base = { objects: 4, frames: 4, warmup: 1, width: 64, height: 64, runCurrent: unreachable };

  it("has no native-aot arm there and says why", async () => {
    await expect(
      runCp1("/repo", mkdtempSync(path.join(os.tmpdir(), "tn-cp1-")), {
        ...base,
        arms: ["native-aot"],
        target: "android",
        device: "PIXEL",
      }),
    ).rejects.toThrow(/TN_BENCH_CP1_ARM_UNSUPPORTED: native-aot has no Android lane/u);
  });

  it("needs a named device before it touches one", async () => {
    await expect(
      runCp1("/repo", mkdtempSync(path.join(os.tmpdir(), "tn-cp1-")), {
        ...base,
        arms: ["native-cpp"],
        target: "android",
      }),
    ).rejects.toThrow("TN_BENCH_BAD_FLAG");
  });
});
