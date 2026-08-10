import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface IAndroidDriverOptions {
  activity: string;
  adbPath?: string;
  packageName: string;
  serial?: string;
}

export interface IAndroidDriver {
  captureConsole(): Promise<Array<{ text: string; type: string }>>;
  isAlive(): Promise<boolean>;
  prepare(endpoint: string, mailboxRoot?: string): Promise<void>;
  readFile?(path: string): Promise<string | undefined>;
  removeFile?(path: string): Promise<void>;
  screenshot(path: string): Promise<void>;
  setPointers?(pointers: readonly IAndroidPointer[]): Promise<IAndroidPointerInjection>;
  stop(): Promise<void>;
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
  private readonly adbPath: string;
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
    const events: string[] = [];
    const append = (type: string, code: string, value: number) => {
      events.push(`${type}:${code}:${value}`);
    };
    for (const [id, held] of [...this.touchSlots]) {
      if (next.has(id)) continue;
      append("EV_ABS", "ABS_MT_SLOT", held.slot);
      append("EV_ABS", "ABS_MT_TRACKING_ID", -1);
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
        append("EV_ABS", "ABS_MT_SLOT", slot);
        append("EV_ABS", "ABS_MT_TRACKING_ID", held.trackingId);
        append("EV_ABS", "ABS_MT_POSITION_X", x);
        append("EV_ABS", "ABS_MT_POSITION_Y", y);
        // The emulator's virtio touchscreen advertises pressure and touch-major axes.
        append("EV_ABS", "ABS_MT_TOUCH_MAJOR", 1);
        append("EV_ABS", "ABS_MT_PRESSURE", 512);
      } else if (held.x !== x || held.y !== y) {
        append("EV_ABS", "ABS_MT_SLOT", held.slot);
        append("EV_ABS", "ABS_MT_POSITION_X", x);
        append("EV_ABS", "ABS_MT_POSITION_Y", y);
        held.x = x;
        held.y = y;
      }
    }
    if (events.length > 0) {
      // The emulator console has no symbolic EV_SYN code aliases. Linux SYN_REPORT is 0.
      append("EV_SYN", "0", 0);
      await this.adb(["emu", "event", "send", ...events]);
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

  private serialArgs(): string[] {
    return this.options.serial === undefined ? [] : ["-s", this.options.serial];
  }
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
