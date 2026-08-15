// PRD-117 Phase 4: the device arms. Both engines build an APK, install it on one named device, run
// the ladder and print a §5.1 run report; this collects it out of logcat, which is the only channel
// a native Android process has.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BEGIN = "ENGINE_LOAD_TEST_JSON_BEGIN";
const END = "ENGINE_LOAD_TEST_JSON_END";
const FAILED = "ENGINE_LOAD_TEST_FAILED";
/** PRD-117 §4.3. Below this Android throttles and the number describes the battery, not the engine. */
export const MINIMUM_BATTERY_PERCENT = 50;

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

export interface IDeviceState {
  batteryPercent: number;
  serial: string;
}

export async function readDeviceState(): Promise<IDeviceState> {
  const devices = (await adb(["devices"]))
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.endsWith("device"));
  if (devices.length === 0) throw new Error("TN_BENCH_NO_DEVICE: no Android device is attached.");
  if (devices.length > 1)
    throw new Error(`TN_BENCH_MANY_DEVICES: ${devices.length} attached; set ANDROID_SERIAL.`);
  const serial = (devices[0] as string).split(/\s+/)[0] as string;
  const battery = await adb(["shell", "dumpsys", "battery"]);
  const level = /^\s*level:\s*(\d+)/m.exec(battery);
  if (level === null) throw new Error("TN_BENCH_NO_BATTERY: could not read the battery level.");
  return { batteryPercent: Number(level[1]), serial };
}

/**
 * Refuses a run the PRD would not accept. `--allow-low-battery` exists because a provisional
 * comparison between two arms at the same charge is still useful, but it has to be asked for: a
 * throttled number that reads as a measurement is how this benchmark lies.
 */
export async function assertDeviceReady(allowLowBattery: boolean): Promise<IDeviceState> {
  const state = await readDeviceState();
  if (state.batteryPercent < MINIMUM_BATTERY_PERCENT && !allowLowBattery) {
    throw new Error(
      `TN_BENCH_LOW_BATTERY: ${state.batteryPercent}% is below the ${MINIMUM_BATTERY_PERCENT}% PRD-117 requires. Charge the device, or pass --allow-low-battery and mark the result provisional.`,
    );
  }
  return state;
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
  options: IAndroidLadder & { allowLowBattery: boolean; timeoutMs: number },
): Promise<unknown> {
  const definition = ANDROID_ARMS[arm];
  if (definition === undefined) throw new Error(`TN_BENCH_BAD_ARM: ${arm}`);
  const state = await assertDeviceReady(options.allowLowBattery);
  process.stderr.write(
    `[${arm}] device ${state.serial}, battery ${state.batteryPercent}%${state.batteryPercent < MINIMUM_BATTERY_PERCENT ? " (PROVISIONAL)" : ""}\n`,
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
    if (log.includes(END) || log.includes(FAILED)) {
      await adb(["shell", "am", "force-stop", definition.packageName]);
      return parseReport(log);
    }
  }
  await adb(["shell", "am", "force-stop", definition.packageName]);
  throw new Error(`TN_BENCH_TIMEOUT: ${arm} produced no report within ${options.timeoutMs} ms.`);
}
