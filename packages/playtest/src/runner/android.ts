import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface IAndroidDriverOptions {
  activity: string;
  adbPath?: string;
  packageName: string;
  serial?: string;
  /**
   * The rotation between the touchscreen's raw axes and the frame the app draws in, when the
   * device cannot be asked.
   *
   * Normally this is read from the display — `dumpsys input`'s `SurfaceOrientation`, then the
   * `user_rotation` setting — and that is right whenever the app's window and the display agree.
   * It is wrong for an orientation-locked app on a device whose display never rotated: an
   * emulator sitting at rotation 0 running a `landscape` game gives the app a window turned 90°
   * from the panel, so an injected touch lands somewhere else entirely and every input assertion
   * fails for a reason that has nothing to do with the game.
   *
   * Set explicitly to make such a run reproducible, and say so in the evidence. Fails closed on
   * anything but 0, 1, 2 or 3.
   */
  touchRotation?: number;
}

export interface IAndroidDriver {
  captureConsole(): Promise<Array<{ text: string; type: string }>>;
  /** The device this driver is bound to, when it knows; reported next to its metric samples. */
  deviceSerial?(): string | undefined;
  isAlive(): Promise<boolean>;
  prepare(endpoint: string, mailboxRoot?: string): Promise<void>;
  readFile?(path: string): Promise<string | undefined>;
  removeFile?(path: string): Promise<void>;
  /** Raw adb passthrough, so the host can measure the device itself. Read-only probes only. */
  runAdb?(args: readonly string[]): Promise<string>;
  screenshot(path: string): Promise<void>;
  setPointers?(pointers: readonly IAndroidPointer[]): Promise<IAndroidPointerInjection>;
  startScreenRecording?(): Promise<void>;
  stop(): Promise<void>;
  stopScreenRecording?(path: string): Promise<void>;
  writeFile?(path: string, contents: string): Promise<void>;
}

export interface IAndroidPointer {
  buttons?: number;
  id: number;
  x: number;
  y: number;
}

export interface IAndroidPointerInjection {
  activeIds: number[];
  injection: "adb-emu-event-protocol-b";
  rotation: number;
  trackingIds: number[];
}

export class AdbAndroidDriver implements IAndroidDriver {
  private static readonly COVERAGE_VIDEO_PATH = "/sdcard/tn-playtest-framebuffer-coverage.mp4";
  private readonly adbPath: string;
  private screenrecord?: ChildProcess;
  private screenrecordError?: Error;
  private readonly touchSlots = new Map<number, {
    slot: number;
    trackingId: number;
    x: number;
    y: number;
  }>();
  private nextTrackingId = 100;
  private rotation?: number;

  constructor(private readonly options: IAndroidDriverOptions) {
    this.adbPath = options.adbPath ?? discoverAdb();
    if (options.touchRotation !== undefined) {
      if (![0, 1, 2, 3].includes(options.touchRotation)) {
        throw new Error(
          `TN_PLAYTEST_ANDROID_ROTATION_INVALID: touch rotation must be 0, 1, 2 or 3, got '${String(options.touchRotation)}'.`,
        );
      }
      this.rotation = options.touchRotation;
    }
  }

  async prepare(endpoint: string, mailboxRoot?: string): Promise<void> {
    const url = new URL(endpoint);
    const port = url.port;
    await this.adb(["reverse", `tcp:${port}`, `tcp:${port}`]);
    await this.adb(["logcat", "-c"]);
    await this.adb(["shell", "am", "force-stop", this.options.packageName]);
    await this.adb([
      "shell",
      "am",
      "start",
      "-W",
      "-n",
      `${this.options.packageName}/${this.options.activity}`,
      "--es",
      "TN_PLAYTEST_ENDPOINT",
      endpoint,
      ...(mailboxRoot === undefined ? [] : ["--es", "TN_PLAYTEST_MAILBOX_ROOT", mailboxRoot]),
    ]);
  }

  async captureConsole(): Promise<Array<{ text: string; type: string }>> {
    const output = await this.adb(["logcat", "-d", "-v", "brief"]);
    return parseAndroidConsole(output);
  }

  async screenshot(path: string): Promise<void> {
    const { stdout } = await execFileAsync(this.adbPath, [
      ...this.serialArgs(),
      "exec-out",
      "screencap",
      "-p",
    ], { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
    await writeFile(path, stdout);
  }

  async startScreenRecording(): Promise<void> {
    if (this.screenrecord !== undefined) {
      throw new Error("TN_PLAYTEST_FRAMEBUFFER_COVERAGE_RECORDING_ACTIVE");
    }
    if ((await this.adb(["shell", "pidof", "screenrecord"]).catch(() => "")).trim().length > 0) {
      throw new Error("TN_PLAYTEST_FRAMEBUFFER_COVERAGE_OTHER_RECORDING_ACTIVE");
    }
    try {
      await this.adb(["shell", "rm", "-f", AdbAndroidDriver.COVERAGE_VIDEO_PATH]);
      this.screenrecordError = undefined;
      this.screenrecord = spawn(this.adbPath, [
        ...this.serialArgs(),
        "shell",
        "screenrecord",
        "--time-limit",
        "180",
        "--bit-rate",
        "20000000",
        AdbAndroidDriver.COVERAGE_VIDEO_PATH,
      ], { stdio: "ignore" });
      this.screenrecord.once("error", (error) => {
        this.screenrecordError = error;
      });
      await this.waitForScreenRecorder();
    } catch (error) {
      await this.abortScreenRecording();
      throw error;
    }
  }

  async stopScreenRecording(path: string): Promise<void> {
    const recorder = this.screenrecord;
    if (recorder === undefined) {
      throw new Error("TN_PLAYTEST_FRAMEBUFFER_COVERAGE_RECORDING_NOT_ACTIVE");
    }
    this.screenrecord = undefined;
    this.screenrecordError = undefined;
    try {
      const pids = (await this.adb(["shell", "pidof", "screenrecord"]).catch(() => ""))
        .trim()
        .split(/\s+/u)
        .filter((pid) => /^\d+$/u.test(pid));
      for (const pid of pids) await this.adb(["shell", "kill", "-2", pid]);
      await waitForProcessExit(recorder, 5_000);
      await this.adb(["pull", AdbAndroidDriver.COVERAGE_VIDEO_PATH, path]);
      if ((await stat(path)).size === 0) {
        throw new Error("TN_PLAYTEST_FRAMEBUFFER_COVERAGE_RECORDING_EMPTY");
      }
    } finally {
      recorder.kill();
      await this.adb(["shell", "rm", "-f", AdbAndroidDriver.COVERAGE_VIDEO_PATH]).catch(() => undefined);
    }
  }

  async isAlive(): Promise<boolean> {
    return (await this.adb(["shell", "pidof", this.options.packageName])).trim().length > 0;
  }

  async setPointers(pointers: readonly IAndroidPointer[]): Promise<IAndroidPointerInjection> {
    const serial = (await this.adb(["get-serialno"])).trim();
    if (!serial.startsWith("emulator-")) {
      throw new Error("TN_PLAYTEST_ANDROID_MULTITOUCH_EMULATOR_REQUIRED: multi-pointer injection uses rootless adb emu event send.");
    }
    if (new Set(pointers.map(({ id }) => id)).size !== pointers.length) {
      throw new Error("Android complete held-pointer sets require unique pointer ids.");
    }
    if (pointers.some(({ buttons }) => buttons !== undefined && buttons !== 1)) {
      throw new Error("Android touch injection supports buttons=1 only.");
    }
    this.rotation ??= await this.readRotation();
    const next = new Map(pointers.map((pointer) => [pointer.id, pointer]));
    const identity: string[] = [];
    const positions: string[] = [];
    const append = (batch: string[], type: string, code: string, value: number) => {
      batch.push(`${type}:${code}:${value}`);
    };
    for (const [id, held] of [...this.touchSlots]) {
      if (next.has(id)) continue;
      append(identity, "EV_ABS", "ABS_MT_SLOT", held.slot);
      append(identity, "EV_ABS", "ABS_MT_TRACKING_ID", -1);
      this.touchSlots.delete(id);
    }
    for (const pointer of pointers) {
      const [x, y] = rotatedTouchPosition(pointer.x, pointer.y, this.rotation);
      let held = this.touchSlots.get(pointer.id);
      if (held === undefined) {
        const usedSlots = new Set([...this.touchSlots.values()].map(({ slot }) => slot));
        let slot = 0;
        while (usedSlots.has(slot)) slot += 1;
        held = { slot, trackingId: this.nextTrackingId++, x, y };
        this.touchSlots.set(pointer.id, held);
        append(identity, "EV_ABS", "ABS_MT_SLOT", slot);
        append(identity, "EV_ABS", "ABS_MT_TRACKING_ID", held.trackingId);
        append(positions, "EV_ABS", "ABS_MT_SLOT", slot);
        append(positions, "EV_ABS", "ABS_MT_POSITION_X", x);
        append(positions, "EV_ABS", "ABS_MT_POSITION_Y", y);
        // The emulator's virtio touchscreen advertises pressure and touch-major axes.
        append(positions, "EV_ABS", "ABS_MT_TOUCH_MAJOR", 1);
        append(positions, "EV_ABS", "ABS_MT_PRESSURE", 512);
      } else if (held.x !== x || held.y !== y) {
        append(positions, "EV_ABS", "ABS_MT_SLOT", held.slot);
        append(positions, "EV_ABS", "ABS_MT_POSITION_X", x);
        append(positions, "EV_ABS", "ABS_MT_POSITION_Y", y);
        held.x = x;
        held.y = y;
      }
    }
    // Coordinates first, identity second, and the order is the whole point.
    //
    // A tracking id and a coordinate cannot share one emulator batch — the emulator answers OK
    // and drops the coordinate — so they are two batches, and which one goes first decides where
    // Android thinks the finger landed. Sending the tracking id first activates the slot at
    // whatever position it still held from the previous gesture, so every press was reported at
    // the *previous* step's coordinates and then moved: a tap on a HUD button arrived as a press
    // somewhere else followed by a drag onto the button. Positioning the inactive slot first and
    // activating it second reports the press where the scenario asked for it.
    for (const batch of androidTouchBatches(positions, identity)) {
      await this.adb(["emu", "event", "send", ...batch]);
    }
    return {
      activeIds: [...this.touchSlots.keys()],
      injection: "adb-emu-event-protocol-b",
      rotation: this.rotation,
      trackingIds: [...this.touchSlots.values()].map(({ trackingId }) => trackingId),
    };
  }

  async readFile(path: string): Promise<string | undefined> {
    try {
      const contents = await this.adb(["exec-out", "cat", path]);
      return isMissingRemoteFileOutput(contents) ? undefined : contents;
    } catch (error) {
      if (isMissingRemoteFile(error)) return undefined;
      throw error;
    }
  }

  async removeFile(path: string): Promise<void> {
    await this.adb(["shell", "rm", "-f", path]);
  }

  async stop(): Promise<void> {
    await this.abortScreenRecording();
    await this.setPointers([]).catch(() => undefined);
    await this.adb(["shell", "am", "force-stop", this.options.packageName]).catch(() => undefined);
    await this.adb(["reverse", "--remove-all"]).catch(() => undefined);
  }

  private async readRotation(): Promise<number> {
    const input = await this.adb(["shell", "dumpsys", "input"]);
    const surface = /SurfaceOrientation:\s*([0-3])/u.exec(input)?.[1];
    if (surface !== undefined) return Number(surface);
    const setting = (await this.adb(["shell", "settings", "get", "system", "user_rotation"])).trim();
    if (/^[0-3]$/u.test(setting)) return Number(setting);
    throw new Error("TN_PLAYTEST_ANDROID_ROTATION_UNKNOWN: dumpsys input and user_rotation did not report 0 through 3.");
  }

  async writeFile(path: string, contents: string): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), "threenative-adb-mailbox-"));
    const localPath = join(directory, "payload.json");
    const remotePath = `${path}.incoming-${process.pid}-${Date.now()}`;
    try {
      await writeFile(localPath, contents, "utf8");
      await this.adb(["push", localPath, remotePath]);
      await this.adb(["shell", "mv", remotePath, path]);
    } finally {
      await rm(directory, { force: true, recursive: true });
      await this.adb(["shell", "rm", "-f", remotePath]).catch(() => undefined);
    }
  }

  deviceSerial(): string | undefined {
    return this.options.serial;
  }

  /**
   * The device-metrics probes read `dumpsys`, `logcat` and sysfs through here. Deliberately a
   * thin passthrough rather than a metrics API: the parsing belongs to deviceMetrics.ts, which
   * is unit-tested against real captured device output.
   */
  async runAdb(args: readonly string[]): Promise<string> {
    return this.adb(args);
  }

  private async adb(args: readonly string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        this.adbPath,
        [...this.serialArgs(), ...args],
        { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      );
      if (/^KO:/mu.test(stdout)) {
        throw new Error(`adb ${args.join(" ")} failed: ${stdout.trim()}`);
      }
      return stdout;
    } catch (error) {
      const detail = error as Error & { stderr?: string; stdout?: string };
      throw new Error(
        `adb ${args.join(" ")} failed: ${detail.stderr || detail.stdout || detail.message}`,
      );
    }
  }

  private async waitForScreenRecorder(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (this.screenrecordError !== undefined) {
        throw new Error(`TN_PLAYTEST_FRAMEBUFFER_COVERAGE_RECORDING_FAILED:${this.screenrecordError.message}`);
      }
      if (this.screenrecord?.exitCode !== null) {
        throw new Error("TN_PLAYTEST_FRAMEBUFFER_COVERAGE_RECORDING_EXITED");
      }
      const pid = await this.adb(["shell", "pidof", "screenrecord"]).catch(() => "");
      if (pid.trim().length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("TN_PLAYTEST_FRAMEBUFFER_COVERAGE_RECORDING_NOT_READY");
  }

  private async abortScreenRecording(): Promise<void> {
    const recorder = this.screenrecord;
    this.screenrecord = undefined;
    this.screenrecordError = undefined;
    if (recorder !== undefined) {
      const pids = (await this.adb(["shell", "pidof", "screenrecord"]).catch(() => ""))
        .trim()
        .split(/\s+/u)
        .filter((pid) => /^\d+$/u.test(pid));
      for (const pid of pids) await this.adb(["shell", "kill", "-2", pid]).catch(() => undefined);
      await waitForProcessExit(recorder, 5_000).catch(() => recorder.kill());
      await this.adb(["shell", "rm", "-f", AdbAndroidDriver.COVERAGE_VIDEO_PATH]).catch(() => undefined);
    }
  }

  private serialArgs(): string[] {
    return this.options.serial === undefined ? [] : ["-s", this.options.serial];
  }
}

async function waitForProcessExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("TN_PLAYTEST_FRAMEBUFFER_COVERAGE_RECORDING_STOP_TIMEOUT"));
    }, timeoutMs);
    const onExit = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("exit", onExit);
    };
    child.once("exit", onExit);
    if (child.exitCode !== null) onExit();
  });
}

export function parseAndroidConsole(output: string): Array<{ text: string; type: string }> {
  return output
    .split(/\r?\n/u)
    .filter((line) => !/^[VDIWEF]\/SurfaceSyncGroup\(/u.test(line))
    .filter((line) => /Mystral|THREENATIVE|chromium/u.test(line))
    .map((text) => ({
      text,
      type: /^(?:E|F)\//u.test(text) || /\b(?:Error|FATAL|FAILED)\b/u.test(text)
        ? "error"
        : "log",
    }));
}

const TOUCH_AXIS_MAX = 32767;

/**
 * Splits slot identity from coordinates into separate synced `adb emu event send` batches.
 *
 * The emulator console drops ABS_MT_POSITION_X/Y from any batch that also carries an
 * ABS_MT_TRACKING_ID: the command reports `OK` and the coordinates never reach the device, so
 * every contact lands at (0, 0) and a two-finger gesture reads as two touches in the same
 * screen half — the exact failure that made the simultaneous-touch proof unprovable.
 * Confirmed against `getevent -lt /dev/input/event2` on emulator 36.6.11 with the android-35
 * google_apis image. Identity goes first so a slot exists before it is positioned.
 */
export function androidTouchBatches(
  identity: readonly string[],
  positions: readonly string[],
): string[][] {
  const batches: string[][] = [];
  for (const batch of [identity, positions]) {
    if (batch.length === 0) continue;
    if (
      batch.some((event) => event.includes("ABS_MT_TRACKING_ID")) &&
      batch.some((event) => event.includes("ABS_MT_POSITION_"))
    ) {
      throw new Error(
        "TN_PLAYTEST_ANDROID_TOUCH_BATCH_MIXED: a tracking id and a coordinate cannot share one emulator event batch; the emulator silently drops the coordinate.",
      );
    }
    // The emulator console has no symbolic EV_SYN code aliases. Linux SYN_REPORT is 0.
    batches.push([...batch, "EV_SYN:0:0"]);
  }
  return batches;
}

export function rotatedTouchPosition(x: number, y: number, rotation: number): [number, number] {
  const normalized = rotation === 0
    ? [x, y]
    : rotation === 1
      ? [y, 1 - x]
      : rotation === 2
        ? [1 - x, 1 - y]
        : rotation === 3
          ? [1 - y, x]
          : undefined;
  if (normalized === undefined) throw new Error(`Android display rotation ${rotation} is invalid.`);
  return normalized.map((value) => Math.round(value * TOUCH_AXIS_MAX)) as [number, number];
}

function isMissingRemoteFile(error: unknown): boolean {
  const detail = error as Error & { stderr?: string; stdout?: string };
  return isMissingRemoteFileOutput(`${detail.stderr ?? ""}\n${detail.stdout ?? ""}`);
}

function isMissingRemoteFileOutput(output: string): boolean {
  return /No such file|not found/u.test(output);
}

export function discoverAdb(environment: NodeJS.ProcessEnv = process.env): string {
  const executable = process.platform === "win32" ? "adb.exe" : "adb";
  const candidates = [
    environment.THREENATIVE_ADB,
    environment.ANDROID_SDK_ROOT === undefined
      ? undefined
      : join(environment.ANDROID_SDK_ROOT, "platform-tools", executable),
    environment.ANDROID_HOME === undefined
      ? undefined
      : join(environment.ANDROID_HOME, "platform-tools", executable),
    join(homedir(), "Android", "Sdk", "platform-tools", executable),
    join(homedir(), "Library", "Android", "sdk", "platform-tools", executable),
  ];
  const found = candidates.find((candidate): candidate is string =>
    candidate !== undefined && existsSync(candidate));
  if (found !== undefined) return found;
  if (environment.PATH?.split(process.platform === "win32" ? ";" : ":").some((directory) =>
    existsSync(join(directory, executable))) === true) return executable;
  throw new Error(
    "adb was not found. Install Android SDK Platform Tools, set ANDROID_HOME, or pass --adb /absolute/path/to/adb.",
  );
}
