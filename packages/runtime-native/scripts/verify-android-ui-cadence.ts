import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import {
  AdbAndroidDriver,
  discoverAdb,
  viewportPresentationCommands,
  viewportRestoreCommands,
} from "../../playtest/src/runner/android.js";
import { stopManagedServer } from "../../playtest/src/runner/server.js";
import { verifyAndroidReleaseArtifact } from "./package-android.mjs";
import { analyzeUiCadence, decodeAndroidUiTimestamps, decodeUiSequence } from "./ui-cadence.mjs";

const exec = promisify(execFile);
const run = async (command: string, args: string[]) =>
  (await exec(command, args, { encoding: "buffer", timeout: 30_000, maxBuffer: 64 * 1024 * 1024 }))
    .stdout;

export async function captureAndroidUiCadence(apk: string, root: string, serial?: string) {
  const adbPath = discoverAdb();
  const device = (await run(adbPath, [...(serial ? ["-s", serial] : []), "get-serialno"]))
    .toString()
    .trim();
  const adb = async (...args: string[]) => (await run(adbPath, ["-s", device, ...args])).toString();
  if (!device || (await adb("get-state")).trim() !== "device")
    throw new Error("TN_UI_CADENCE_DEVICE: select one online Android device with --device.");
  const packageName = "com.threenative.uicadence";
  const activity = "com.threenative.runtime.MystralActivity";
  const apkSha256 = createHash("sha256").update(readFileSync(apk)).digest("hex");
  writeFileSync(
    join(root, "release.json"),
    JSON.stringify(verifyAndroidReleaseArtifact(apk, { format: "apk" })),
  );
  const driver = new AdbAndroidDriver({ adbPath, serial: device, packageName, activity });
  const video = join(root, "visible.mp4");
  const states: { sequence: number; at: number }[] = [];
  let logger: ChildProcess | undefined;
  let log = "";
  let recording = false;
  let presented = false;
  let failure: unknown;
  let consoleFailure: Error | undefined;
  let displayInfo = "";
  const checkConsole = () => {
    if (consoleFailure) throw consoleFailure;
    if (logger && (logger.exitCode !== null || logger.signalCode !== null))
      throw new Error("TN_UI_CADENCE_CONSOLE: Android log capture exited.");
  };
  // Resolve the device and install before changing its display; installation verifies the APK signature.
  writeFileSync(join(root, "install.log"), await adb("install", "-r", apk));
  const installed = (await adb("shell", "pm", "path", packageName)).trim();
  const installedPath = /^package:(\/data\/app\/[\w/=.+~-]+\/base\.apk)$/u.exec(installed)?.[1];
  if (
    !installedPath ||
    !(await adb("shell", "sha256sum", installedPath)).startsWith(`${apkSha256} `)
  )
    throw new Error(
      "TN_UI_CADENCE_APK: installed com.threenative.uicadence differs from the requested APK; use the packaged cadence fixture.",
    );
  const interrupted = () => {
    consoleFailure = new Error("TN_UI_CADENCE_INTERRUPTED: capture cancelled.");
  };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  try {
    await adb("shell", "am", "force-stop", packageName);
    const size = /Physical size: (\d+)x(\d+)/u.exec(await adb("shell", "wm", "size"));
    if (!size)
      throw new Error("TN_UI_CADENCE_DEVICE: Android did not report its physical display size.");
    presented = true;
    for (const command of viewportPresentationCommands(
      { width: 640, height: 360 },
      { width: Number(size[1]), height: Number(size[2]) },
    ))
      await adb(...command);
    await adb("logcat", "-c");
    logger = spawn(adbPath, ["-s", device, "logcat", "-v", "brief"], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    logger.once("error", (error) => {
      consoleFailure = error;
    });
    if (!logger.stdout || !logger.stderr)
      throw new Error("TN_UI_CADENCE_CONSOLE: missing log pipes.");
    for (const stream of [logger.stdout, logger.stderr]) {
      createInterface({ input: stream }).on("line", (line) => {
        log += `${line}\n`;
        // Native stdout is also mirrored to MystralStdio; consume each actual JS publication once.
        const sample = /^I\/MystralJS\([^\n]*?TN_UI_SAMPLE:(.*)$/u.exec(line);
        if (!sample) return;
        try {
          states.push(JSON.parse(sample[1] ?? ""));
        } catch {
          consoleFailure = new Error(`TN_UI_CADENCE_STATE: malformed sample ${line}`);
        }
      });
    }
    await adb("shell", "am", "start", "-W", "-n", `${packageName}/${activity}`);
    const deadline = Date.now() + 30_000;
    while (states.length < 120) {
      checkConsole();
      if (Date.now() > deadline)
        throw new Error("TN_UI_CADENCE_STARTUP: no live cadence fixture in 30 seconds.");
      await delay(100);
    }
    await driver.screenshot(join(root, "before.png"));
    await driver.startScreenRecording();
    recording = true;
    const until = Date.now() + 27_000;
    while (Date.now() < until) {
      checkConsole();
      await delay(100);
    }
    if (!(await driver.isAlive()))
      throw new Error("TN_UI_CADENCE_HOST_EXITED: Android fixture exited.");
    recording = false;
    await driver.stopScreenRecording(video);
    await driver.screenshot(join(root, "visible.png"));
    displayInfo = await adb("shell", "dumpsys", "display");
    writeFileSync(join(root, "display.txt"), displayInfo);
    writeFileSync(join(root, "device.txt"), await adb("shell", "getprop", "ro.build.fingerprint"));
    checkConsole();
  } catch (error) {
    failure = error;
  } finally {
    const cleanupErrors: unknown[] = [];
    const clean = async (work: Promise<unknown>) => {
      try {
        await work;
      } catch (error) {
        cleanupErrors.push(error);
      }
    };
    if (recording) await clean(driver.stopScreenRecording(video));
    await clean(adb("shell", "am", "force-stop", packageName));
    if (presented) for (const command of viewportRestoreCommands()) await clean(adb(...command));
    await clean(stopManagedServer(logger));
    process.removeListener("SIGINT", interrupted);
    process.removeListener("SIGTERM", interrupted);
    writeFileSync(join(root, "console.log"), log);
    writeFileSync(join(root, "states.json"), JSON.stringify(states));
    if (cleanupErrors.length)
      writeFileSync(join(root, "cleanup.log"), cleanupErrors.map(String).join("\n"));
    failure ??=
      consoleFailure ??
      (cleanupErrors.length
        ? new AggregateError(cleanupErrors, "Android cleanup failed")
        : undefined);
  }
  if (failure) throw failure;

  const probe = JSON.parse(
    (
      await run("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "stream=index,codec_type,width,height:frame=media_type,best_effort_timestamp_time",
        "-of",
        "json",
        video,
      ])
    ).toString(),
  );
  const videos = probe.streams?.filter(
    (stream: { codec_type: string }) => stream.codec_type === "video",
  );
  if (videos?.length !== 1 || videos[0].width !== 640 || videos[0].height !== 360)
    throw new Error("TN_UI_CADENCE_PIXELS: recording must present the fixture at exactly 640×360.");
  const metadata: Buffer[] = [];
  for (const stream of probe.streams) {
    if (stream.codec_type !== "data" || !Number.isInteger(stream.index)) continue;
    const data = await run("ffmpeg", [
      "-v",
      "error",
      "-i",
      video,
      "-map",
      `0:${stream.index}`,
      "-c",
      "copy",
      "-f",
      "data",
      "pipe:1",
    ]);
    if (data.subarray(0, 16).toString() === "#VV1NSC0PET1ME2#") metadata.push(data);
  }
  if (metadata.length !== 1 || metadata[0] === undefined)
    throw new Error(
      "TN_UI_CADENCE_TIMESTAMPS: recording must contain one Winscope v2 timestamp track.",
    );
  const framePts = probe.frames
    ?.filter((frame: { media_type: string }) => frame.media_type === "video")
    .map((frame: { best_effort_timestamp_time: string }) =>
      Number(frame.best_effort_timestamp_time),
    );
  const { times, alignmentMaxErrorMs } = decodeAndroidUiTimestamps(metadata[0], framePts);
  writeFileSync(join(root, "timestamps.bin"), metadata[0]);
  writeFileSync(join(root, "frame-pts.json"), JSON.stringify(framePts));
  const raw = await run("ffmpeg", [
    "-v",
    "error",
    "-i",
    video,
    "-vf",
    "crop=160:24:16:16,format=rgb24",
    "-fps_mode",
    "passthrough",
    "-enc_time_base",
    "1:1000000",
    "-threads",
    "1",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
  const frameSize = 160 * 24 * 3;
  if (raw.length !== times.length * frameSize)
    throw new Error("TN_UI_CADENCE_TIMESTAMPS: pixel frames and metadata counts differ.");
  const captures = times.map((at: number, index: number) => ({
    at,
    ...decodeUiSequence(raw.subarray(index * frameSize, (index + 1) * frameSize), {
      tolerance: 32,
    }),
  }));
  writeFileSync(join(root, "samples.json"), JSON.stringify({ states, captures }));
  return {
    apk,
    apkSha256,
    installedPath,
    device,
    adapter: log.match(/\[WebGPU\] Adapter: (.+)/u)?.[1] ?? "unreported",
    refreshHz: Number(displayInfo.match(/renderFrameRate ([\d.]+)/u)?.[1]) || null,
    backend: "Android screenrecord / Winscope v2",
    measurement:
      "State-to-captured SurfaceFlinger composition; physical scanout unmeasured; assumes no realtime clock step during capture",
    lossAttribution:
      "Unobserved IDs may be capture sampling misses; UI dropped-update count is unknown",
    alignmentMaxErrorMs,
    ...analyzeUiCadence({ states, captures }, { sampling: "android" }),
  };
}
