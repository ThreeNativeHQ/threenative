// PRD-534 CP1 on a physical Android device. The native arms are the same executable the desktop lane
// runs (tn-native-engine-host, built for arm64 by packages/runtime-native/scripts/
// build-native-engine-host-android.mjs): it draws offscreen through the native engine's Vulkan
// device, so it needs no window and runs from `adb shell`. The `current` arm is today's legacy host
// as an APK (`com.threenative.game`), built from the same bundle the desktop arm runs and driven by
// run-android.ts. Every arm answers to the device preflight (discharging, battery floor, thermal
// NONE, screen on) and to a cool-down between arms: the preflight cannot be waived, only waited for.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  MINIMUM_BATTERY_PERCENT,
  assertDeviceReady,
  parseThermalState,
} from "../../packages/runtime-native/scripts/device-preflight.mjs";
import { BenchError } from "./report.js";
import { adbOn } from "./run-android.js";

/** Where the host and its libraries live on the device. */
export const DEVICE_DIR = "/data/local/tmp/tn-cp1";
/** The battery temperature, in degrees Celsius, the device must be at or below before an arm starts. */
export const COOL_C = 31.5;
/** The battery temperature, in degrees Celsius, above which a finished run no longer counts: the Pixel throttles near 38. */
export const RUN_MAX_C = 36;
/** Seconds a host run may take on the device before `timeout` ends it (exit 124). */
export const HOST_TIMEOUT_S = 1500;
const COOL_POLL_MS = 30_000;
const COOL_TIMEOUT_MS = 30 * 60_000;

export interface IAndroidHostBuild {
  directory: string;
  /** Local file to remote file name, in the order pushed. */
  files: readonly (readonly [string, string])[];
}

/** The executable plus what it loads: V8 and its startup snapshot, SDL's shared library, libc++. */
export function androidHostFiles(repoRoot: string): IAndroidHostBuild {
  const runtime = path.join(repoRoot, "packages/runtime-native");
  const ndk = process.env.ANDROID_NDK_HOME ?? "";
  const sdk = process.env.ANDROID_HOME ?? path.join(process.env.HOME ?? "", "Android/Sdk");
  const ndkRoot = ndk.length > 0 ? ndk : path.join(sdk, "ndk/28.2.13676358");
  const directory = path.join(runtime, "build/tn-android-host");
  return {
    directory,
    files: [
      [path.join(directory, "tn-native-engine-host"), "tn-native-engine-host"],
      [
        path.join(runtime, "third_party/v8-android/lib/arm64-v8a/libv8android.so"),
        "libv8android.so",
      ],
      [
        path.join(runtime, "third_party/v8-android/snapshot_blob/arm64-v8a/snapshot_blob.bin"),
        "snapshot_blob.bin",
      ],
      [
        path.join(
          runtime,
          "third_party/sdl3-android/extracted/prefab/modules/SDL3-shared/libs/android.arm64-v8a/libSDL3.so",
        ),
        "libSDL3.so",
      ],
      [
        path.join(
          ndkRoot,
          "toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib/aarch64-linux-android/libc++_shared.so",
        ),
        "libc++_shared.so",
      ],
    ],
  };
}

/** The battery temperature in degrees Celsius: `dumpsys battery` reports tenths of a degree. */
export function parseBatteryTemperature(dumpsys: string): number {
  const match = /^\s*temperature:\s*(-?\d+)\s*$/mu.exec(dumpsys);
  if (match === null)
    throw new BenchError("TN_BENCH_DEVICE_TEMPERATURE", "dumpsys battery has no temperature");
  return Number(match[1]) / 10;
}

/**
 * Waits, never overrides: an arm starts on a device whose battery is at or below `maxC` and whose
 * thermal status is NONE, or not at all. Installing a 250 MB APK pushes the skin past the LIGHT
 * threshold, and the aggregate status returns to NONE only after the device has rested a while.
 */
export async function waitUntilCool(
  serial: string,
  maxC = COOL_C,
  options: { pollMs?: number; timeoutMs?: number; log?: (line: string) => void } = {},
): Promise<number> {
  const adb = adbOn(serial);
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const deadline = Date.now() + (options.timeoutMs ?? COOL_TIMEOUT_MS);
  for (;;) {
    const temperature = parseBatteryTemperature(await adb(["shell", "dumpsys", "battery"]));
    const thermal = parseThermalState(await adb(["shell", "dumpsys", "thermalservice"]));
    if (temperature <= maxC && thermal.thermalStatusCode === 0) return temperature;
    if (Date.now() >= deadline)
      throw new BenchError(
        "TN_BENCH_DEVICE_HOT",
        `${serial} stayed at ${temperature} C, thermal ${thermal.thermalStatus}, for the whole cool-down (wanted <= ${maxC} C, NONE); the arm did not start`,
      );
    log(
      `[cp1-android] ${serial} at ${temperature} C, thermal ${thermal.thermalStatus}; waiting for ${maxC} C and NONE`,
    );
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? COOL_POLL_MS));
  }
}

/**
 * The strict device preflight for one arm: the same one run-android.ts applies to the legacy arm,
 * with no override. A phone on a charger, under the battery floor, in a thermal state or with its
 * screen off stops the run.
 */
export async function readyDevice(serial: string, label: string) {
  const adb = adbOn(serial);
  // A TCP emulator has an `emulator-*` serial only when started by the SDK; the property is the truth.
  if ((await adb(["shell", "getprop", "ro.kernel.qemu"])).trim() === "1")
    throw new BenchError(
      "TN_BENCH_DEVICE_EMULATOR",
      `${serial} is an emulator; a physical device is required`,
    );
  const temperatureC = await waitUntilCool(serial);
  const state = await assertDeviceReady(
    serial,
    {
      allowEmulator: false,
      allowOverride: false,
      maxThermalStatus: "NONE",
      minBatteryPercent: MINIMUM_BATTERY_PERCENT,
      requireDischarging: true,
    },
    { adb },
  );
  process.stderr.write(
    `[${label}] device ${state.serial}, battery ${state.batteryPercent}%, ${temperatureC} C, ${state.activeRefreshHz} Hz\n`,
  );
  return { ...state, temperatureC };
}

/**
 * The device after a timed run, read again: a phone that was plugged in, throttled or heated past
 * RUN_MAX_C during the run measured something other than what the preflight cleared, so the arm
 * fails instead of reporting.
 */
export async function assertStillReady(serial: string, before: { batteryPercent: number }) {
  const adb = adbOn(serial);
  const battery = await adb(["shell", "dumpsys", "battery"]);
  const thermal = parseThermalState(await adb(["shell", "dumpsys", "thermalservice"]));
  const temperatureC = parseBatteryTemperature(battery);
  const charging = /^\s*(AC|USB|Wireless) powered:\s*true\s*$/mu.test(battery);
  const problems = [
    ...(charging ? ["the device was charging"] : []),
    ...(thermal.thermalStatusCode !== 0 ? [`thermal status ${thermal.thermalStatus}`] : []),
    ...(temperatureC > RUN_MAX_C ? [`${temperatureC} C is above ${RUN_MAX_C} C`] : []),
  ];
  if (problems.length > 0)
    throw new BenchError(
      "TN_BENCH_DEVICE_CHANGED",
      `${serial} changed during the run (battery ${before.batteryPercent}% at the start): ${problems.join("; ")}; the arm is not reported`,
    );
  return { temperatureC, thermalStatus: thermal.thermalStatus };
}

async function md5(file: string): Promise<string> {
  return createHash("md5")
    .update(await readFile(file))
    .digest("hex");
}

/** Pushes only what the device does not already hold with the same checksum. */
export async function pushHost(repoRoot: string, serial: string): Promise<void> {
  const adb = adbOn(serial);
  const { directory, files } = androidHostFiles(repoRoot);
  const missing = files.filter(([local]) => !existsSync(local));
  if (missing.length > 0)
    throw new BenchError(
      "TN_BENCH_CP1_HOST_MISSING",
      `${missing.map(([local]) => path.relative(repoRoot, local)).join(", ")} not built or provisioned: node packages/runtime-native/scripts/build-native-engine-host-android.mjs (${path.relative(repoRoot, directory)})`,
    );
  await adb(["shell", "mkdir", "-p", DEVICE_DIR]);
  for (const [local, remote] of files) {
    const here = await md5(local);
    const there = (await adb(["shell", `md5sum ${DEVICE_DIR}/${remote} 2>/dev/null`])).split(
      " ",
    )[0];
    if (here !== there) {
      const pushed = await adb(["push", local, `${DEVICE_DIR}/${remote}`], 300_000);
      if (!/pushed/u.test(pushed))
        throw new BenchError("TN_BENCH_CP1_PUSH", `adb push ${remote} failed: ${pushed.trim()}`);
    }
  }
  await adb(["shell", "chmod", "755", `${DEVICE_DIR}/tn-native-engine-host`]);
}

export interface IRemoteRun {
  report: string;
  exit: number;
  log: string;
}

/**
 * Runs the host once on the device and reads back its report file. The exit code travels through
 * the shell line because `adb shell` output is the only channel; a missing report is a failure, not
 * a zero.
 */
export async function runHostOnDevice(
  serial: string,
  args: readonly string[],
  scriptLocal?: string,
): Promise<IRemoteRun> {
  const adb = adbOn(serial);
  const report = `${DEVICE_DIR}/report.json`;
  if (scriptLocal !== undefined) await adb(["push", scriptLocal, `${DEVICE_DIR}/l4-workload.js`]);
  const quoted = args.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" ");
  const script = scriptLocal === undefined ? "" : "./l4-workload.js ";
  const command = [
    `cd ${DEVICE_DIR} && rm -f report.json host.log`,
    `LD_LIBRARY_PATH=. timeout ${HOST_TIMEOUT_S} ./tn-native-engine-host ${script}--v8-snapshot snapshot_blob.bin ${quoted} --report report.json > host.log 2>&1`,
    "echo TN_EXIT=$?",
    "tail -n 12 host.log",
  ].join("; ");
  const log = await adb(["shell", command], (HOST_TIMEOUT_S + 60) * 1000);
  const exit = /TN_EXIT=(\d+)/u.exec(log)?.[1];
  const body = await adb(["shell", `cat ${report} 2>/dev/null`]);
  if (body.trim().length === 0)
    throw new BenchError(
      "TN_BENCH_CP1_NO_REPORT",
      `the host wrote no report on ${serial} (exit ${exit ?? "?"}): ${log.trim().split("\n").slice(-6).join(" | ")}`,
    );
  return { report: body, exit: exit === undefined ? -1 : Number(exit), log };
}

export async function ensureScratch(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
}

export interface ICurrentApkOptions {
  frames: number;
  warmup: number;
  width: number;
  height: number;
  objects: number;
  refreshHz: number;
  /** Stamped into the bundle so the report names its build. */
  sourceSha?: string;
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  label: string,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, env, stdio: ["ignore", "inherit", "inherit"] });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new BenchError("TN_BENCH_CP1_BUILD_FAILED", `${label} exited ${code}`)),
    );
  });
}

/** JDK 17: the system JDK here is newer, and the Kotlin compiler AGP ships dies on its version string. */
export function javaHome17(env: NodeJS.ProcessEnv = process.env): string {
  for (const candidate of [
    env.THREENATIVE_JAVA_HOME,
    env.JAVA_HOME,
    "/usr/lib/jvm/java-17-openjdk",
  ]) {
    if (
      candidate !== undefined &&
      /17/u.test(candidate) &&
      existsSync(path.join(candidate, "bin/java"))
    )
      return candidate;
  }
  throw new BenchError(
    "TN_BENCH_CP1_JDK",
    "JDK 17 was not found; set THREENATIVE_JAVA_HOME (Gradle and Kotlin refuse newer JDKs)",
  );
}

/**
 * The legacy host's APK carrying the CP1 bundle: the same `examples/engine-load-test` bundle the
 * desktop `current` arm runs (L4, a unique material per cube, one rung of `objects`, three's GPU
 * timestamp queries), packaged by the host's own Gradle path for arm64 only. The runtime is built
 * from source at -O2 (the debug variant's cppFlags), so the APK contains this checkout's engine.
 */
export async function buildCurrentApk(
  repoRoot: string,
  options: ICurrentApkOptions,
): Promise<string> {
  const example = path.join(repoRoot, "examples/engine-load-test");
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    TN_BENCH_FRAMES: String(options.frames),
    TN_BENCH_GEOMETRY: "shared",
    TN_BENCH_GPU_TIMESTAMPS: "1",
    TN_BENCH_HEIGHT: String(options.height),
    TN_BENCH_LADDER: String(options.objects),
    TN_BENCH_MATERIAL: "unique",
    TN_BENCH_MODES: "L4",
    TN_BENCH_PLATFORM: "android",
    TN_BENCH_REFRESH_HZ: String(options.refreshHz),
    TN_BENCH_REPEATS: "1",
    TN_BENCH_SOURCE_SHA: options.sourceSha,
    TN_BENCH_TARGET: "native",
    TN_BENCH_WARMUP: String(options.warmup),
    TN_BENCH_WIDTH: String(options.width),
  };
  await run("npx", ["vite", "build"], example, environment, "vite build (android bundle)");
  const apk = path.join(repoRoot, "artifacts/engine-load-test/tn-android-cp1.apk");
  await mkdir(path.dirname(apk), { recursive: true });
  await run(
    "node",
    [
      path.join(repoRoot, "packages/runtime-native/scripts/package-android.mjs"),
      "--bundle",
      path.join(example, "dist/engine-load-test-android.js"),
      "--output",
      apk,
      "--orientation",
      "landscape",
      "--allow-source-build",
    ],
    repoRoot,
    {
      ...process.env,
      JAVA_HOME: javaHome17(),
      THREENATIVE_GRADLE_ARGS: "-PthreenativeAbis=arm64-v8a",
    },
    "package-android",
  );
  return apk;
}
