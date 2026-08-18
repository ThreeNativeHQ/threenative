// PRD-117 Phase 4: the device arms. Both engines build an APK, install it on one named device, run
// the ladder and print a §5.1 run report; this collects it out of logcat, which is the only channel
// a native Android process has.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  MINIMUM_BATTERY_PERCENT,
  assertDeviceReady as assertSharedDeviceReady,
} from "../../packages/runtime-native/scripts/device-preflight.mjs";

export { MINIMUM_BATTERY_PERCENT } from "../../packages/runtime-native/scripts/device-preflight.mjs";

const BEGIN = "ENGINE_LOAD_TEST_JSON_BEGIN";
const END = "ENGINE_LOAD_TEST_JSON_END";
const FAILED = "ENGINE_LOAD_TEST_FAILED";
export interface IAndroidLadder {
  frames: number;
  ladder: string;
  modes: string;
  repeats: number;
  warmup: number;
}

export interface IAndroidArm {
  /** Gradle's engine selector. Only the ThreeNative arm has one. */
  jsEngine?: "quickjs" | "v8";
  launchActivity?: string;
  packageName: string;
}

export const ANDROID_ARMS: Record<string, IAndroidArm> = {
  "godot-android": {
    launchActivity: "org.threenative.loadtest/com.godot.game.GodotAppLauncher",
    packageName: "org.threenative.loadtest",
  },
  "tn-android": { jsEngine: "v8", packageName: "com.threenative.game" },
};

// `adb` is not on PATH on this machine; the SDK's copy is.
export function adbPath(): string {
  const override = process.env.ADB_BIN;
  if (override !== undefined && override.length > 0) return override;
  const sdk = `${process.env.HOME ?? ""}/Android/Sdk/platform-tools/adb`;
  return existsSync(sdk) ? sdk : "adb";
}

async function adb(args: readonly string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(adbPath(), [...args], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: string[] = [];
    child.stdout?.on("data", (chunk) => chunks.push(String(chunk)));
    child.stderr?.on("data", (chunk) => chunks.push(String(chunk)));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`TN_BENCH_ADB_TIMEOUT: adb ${args[0]} did not finish`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`TN_BENCH_ADB_MISSING: ${error.message}`));
    });
    child.once("close", () => {
      clearTimeout(timer);
      resolve(chunks.join(""));
    });
  });
}

async function readDeviceSerial(): Promise<string> {
  const devices = (await adb(["devices"]))
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.endsWith("device"));
  if (devices.length === 0) throw new Error("TN_BENCH_NO_DEVICE: no Android device is attached.");
  if (devices.length > 1)
    throw new Error(`TN_BENCH_MANY_DEVICES: ${devices.length} attached; set ANDROID_SERIAL.`);
  const serial = (devices[0] as string).split(/\s+/)[0] as string;
  return serial;
}

/**
 * The report as the device wrote it to storage, or `undefined` if it is not there yet.
 *
 * The log is not a reliable transport for a report this size: at 600 frames across a full ladder it
 * is over a megabyte emitted in one burst, and logd rate-limits a single uid and discards most of
 * it — including the terminating marker `parseReport` scans for. A bigger ring buffer does not fix
 * it, because the loss happens at write time rather than through eviction.
 *
 * The runtime therefore also writes the report to `localStorage`, which is a plain JSON file inside
 * the app's private data directory. `run-as` reads it whole, and works because these are debuggable
 * builds. The host prints the file's path once at startup, in a single short line that is never the
 * thing logd drops.
 */
async function readStoredReport(packageName: string, log: string): Promise<unknown | undefined> {
  // Gated on this run having reached its report, and that gate is load-bearing. The stored value
  // outlives the run that wrote it, so reading it unconditionally would hand back the *previous*
  // run's numbers under this run's label — the exact shape of failure this benchmark exists to
  // refuse. The runtime writes storage immediately before emitting BEGIN, and the collector clears
  // logcat before launching, so BEGIN in this log means this run wrote what is on disk now.
  if (!log.includes(BEGIN)) return undefined;
  const located = /\[Mystral\] localStorage initialized: (.+)$/m.exec(log);
  if (located === null) return undefined;
  const storagePath = (located[1] as string).trim();
  let raw: string;
  try {
    raw = await adb(["shell", "run-as", packageName, "cat", storagePath]);
  } catch {
    return undefined;
  }
  let stored: unknown;
  try {
    stored = JSON.parse(raw.trim());
  } catch {
    return undefined;
  }
  const entry = (stored as Record<string, unknown> | null)?.TN_BENCH_REPORT;
  if (typeof entry !== "string" || entry.length === 0) return undefined;
  try {
    return JSON.parse(entry);
  } catch {
    return undefined;
  }
}

function parseReport(log: string): unknown {
  const failure = /ENGINE_LOAD_TEST_FAILED (.*)$/m.exec(log);
  const start = log.indexOf(BEGIN);
  const stop = log.indexOf(END);
  if (start === -1 || stop === -1) {
    if (failure !== null) throw new Error(`TN_BENCH_ARM_FAILED: ${failure[1]}`);
    throw new Error("TN_BENCH_NO_REPORT: the arm never emitted a run report.");
  }
  // Chunked because Android's logcat truncates a line at ~1 KB and silently cut every early run.
  const body = log.slice(start + BEGIN.length, stop);
  const chunks = body
    .split("\n")
    .map((line) => {
      const marker = line.indexOf("TNJSON:");
      return marker === -1 ? "" : line.slice(marker + "TNJSON:".length).replace(/\r$/, "");
    })
    .join("");
  return JSON.parse((chunks.trim().length > 0 ? chunks : body).trim());
}

export async function runAndroidArm(
  repoRoot: string,
  arm: string,
  options: IAndroidLadder & {
    allowEmulator?: boolean;
    allowLowBattery: boolean;
    timeoutMs: number;
  },
): Promise<unknown> {
  const definition = ANDROID_ARMS[arm];
  if (definition === undefined) throw new Error(`TN_BENCH_BAD_ARM: ${arm}`);
  const serial = await readDeviceSerial();
  const state = await assertSharedDeviceReady(
    serial,
    {
      // A benchmark may opt into the emulator as a regression canary; a qualification lane may not.
      // The emulator reports a synthetic battery and no thermal state, so those bars are relaxed
      // with it rather than pretended to be met.
      allowEmulator: options.allowEmulator === true,
      allowOverride: options.allowLowBattery || options.allowEmulator === true,
      maxThermalStatus: "NONE",
      minBatteryPercent: options.allowEmulator === true ? 0 : MINIMUM_BATTERY_PERCENT,
      requireDischarging: options.allowEmulator !== true,
    },
    { adb },
  );
  process.stderr.write(
    `[${arm}] device ${state.serial}, battery ${state.batteryPercent}%${state.provisional.length > 0 ? " (PROVISIONAL)" : ""}\n`,
  );
  await mkdir(path.join(repoRoot, "artifacts/engine-load-test"), { recursive: true });

  await adb(["shell", "am", "force-stop", definition.packageName]);
  await adb(["logcat", "-c"]);
  if (definition.launchActivity === undefined) {
    await adb([
      "shell",
      "monkey",
      "-p",
      definition.packageName,
      "-c",
      "android.intent.category.LAUNCHER",
      "1",
    ]);
  } else {
    await adb(["shell", "am", "start", "-n", definition.launchActivity]);
  }

  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const log = await adb(["logcat", "-d"]);
    // Storage first: it carries the whole report, where the log may have lost most of it. The log
    // is still the trigger for "the run is over" and still the only path when storage is absent.
    const stored = await readStoredReport(definition.packageName, log);
    if (stored !== undefined || log.includes(END) || log.includes(FAILED)) {
      await adb(["shell", "am", "force-stop", definition.packageName]);
      const report = stored ?? parseReport(log);
      if (typeof report !== "object" || report === null || Array.isArray(report)) {
        throw new Error("TN_BENCH_BAD_REPORT: the Android arm report must be an object.");
      }
      return {
        ...report,
        deviceCondition: state,
        provisional: state.provisional,
      };
    }
  }
  await adb(["shell", "am", "force-stop", definition.packageName]);
  throw new Error(`TN_BENCH_TIMEOUT: ${arm} produced no report within ${options.timeoutMs} ms.`);
}
