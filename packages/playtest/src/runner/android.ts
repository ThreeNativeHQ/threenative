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
   * Normally this is read from the window — `dumpsys window`'s `mRotation`, inverted, and then
   * `dumpsys input`'s `SurfaceOrientation` and the `user_rotation` setting behind it. Those two
   * older sources are why this option exists: an orientation-locked game on a device whose
   * display never rotated reads 0 from both while its window is turned 90° from the panel, so an
   * injected touch lands somewhere else entirely and every input assertion fails for a reason
   * that has nothing to do with the game.
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
  prepare(
    endpoint: string,
    mailboxRoot?: string,
    viewport?: { height: number; width: number },
  ): Promise<void>;
  readFile?(path: string): Promise<string | undefined>;
  removeFile?(path: string): Promise<void>;
  /** Raw adb passthrough, so the host can measure the device itself. Read-only probes only. */
  runAdb?(args: readonly string[]): Promise<string>;
  screenshot(path: string): Promise<void>;
  setPointers?(pointers: readonly IAndroidPointer[]): Promise<IAndroidPointerInjection>;
  startScreenRecording?(): Promise<void>;
  /** One OS tap in viewport pixels. Works on emulators and physical devices alike. */
  tap?(x: number, y: number): Promise<void>;
  /** Put the soft keyboard away, and report whether one was up. */
  hideKeyboard?(): Promise<boolean>;
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
  private viewportPresented = false;

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

  async prepare(
    endpoint: string,
    mailboxRoot?: string,
    viewport?: { height: number; width: number },
  ): Promise<void> {
    const url = new URL(endpoint);
    const port = url.port;
    await this.adb(["reverse", `tcp:${port}`, `tcp:${port}`]);
    await this.adb(["logcat", "-c"]);
    await this.adb(["shell", "am", "force-stop", this.options.packageName]);
    if (viewport !== undefined) await this.presentViewport(viewport);
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

  /**
   * Put the device into the scenario's viewport, and fail closed if it did not take.
   *
   * A silent failure here is the expensive one: the run continues, the touches arrive, the
   * assertions go red, and the report blames the game for a device that was never showing the
   * viewport the scenario asked for.
   */
  private async presentViewport(viewport: { height: number; width: number }): Promise<void> {
    const physical = parsePhysicalSize(await this.adb(["shell", "wm", "size"]));
    if (physical === undefined) {
      throw new Error("TN_PLAYTEST_ANDROID_VIEWPORT_UNKNOWN: `wm size` did not report a physical size, so the scenario viewport cannot be presented.");
    }
    for (const command of viewportPresentationCommands(viewport, physical)) await this.adb(command);
    this.viewportPresented = true;
    // The touch rotation is a property of the window, and the window has just been resized.
    this.rotation = this.options.touchRotation;
    const override = parseOverrideSize(await this.adb(["shell", "wm", "size"]));
    const expected = viewportPresentationCommands(viewport, physical)[0]?.[3];
    if (override !== expected) {
      throw new Error(
        `TN_PLAYTEST_ANDROID_VIEWPORT_NOT_PRESENTED: asked for ${String(expected)} and the device reports ${String(override)}.`,
      );
    }
  }

  async tap(x: number, y: number): Promise<void> {
    await this.adb(tapCommand(x, y));
  }

  /**
   * Dismiss the soft keyboard and wait for it to actually be gone.
   *
   * Measured on the physical Pixel 8: focusing a text field opens the IME, the WebView reflows
   * into the space left above it, and the page's centred menu rides up — so a coordinate computed
   * against the scenario's viewport now points at the keyboard. A tap there does not merely miss
   * the control; it types a character into the field it meant to submit.
   *
   * BACK is the dismissal the platform guarantees. The wait is the point: the reflow happens on
   * the next layout pass, and a click sent into the middle of it lands wherever the menu was
   * halfway through moving.
   */
  async hideKeyboard(): Promise<boolean> {
    if (!keyboardIsShown(await this.adb(["shell", "dumpsys", "input_method"]))) return false;
    await this.adb(["shell", "input", "keyevent", "4"]);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!keyboardIsShown(await this.adb(["shell", "dumpsys", "input_method"]))) return true;
    }
    throw new Error(
      "TN_PLAYTEST_ANDROID_KEYBOARD_STUCK: the soft keyboard did not close, so a click step would land on it instead of the UI.",
    );
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
    if (this.viewportPresented) {
      this.viewportPresented = false;
      // Before the force-stop below, and unconditional: a device left at a test viewport is a
      // device whose next measurement is silently against the wrong screen.
      for (const command of viewportRestoreCommands()) {
        await this.adb(command).catch(() => undefined);
      }
    }
    await this.adb(["shell", "am", "force-stop", this.options.packageName]).catch(() => undefined);
    await this.adb(["reverse", "--remove-all"]).catch(() => undefined);
  }

  private async readRotation(): Promise<number> {
    // The window first, and the two older sources only behind it. See
    // touchRotationFromWindowDump: an orientation-locked game reads 0 from user_rotation while
    // its window is turned 90 degrees off the panel, and dumpsys input prints no
    // SurfaceOrientation at all on the emulator — so both agreed on a value that was wrong, and
    // every injected touch landed transposed.
    const window = touchRotationFromWindowDump(await this.adb(["shell", "dumpsys", "window"]));
    if (window !== undefined) return window;
    const input = await this.adb(["shell", "dumpsys", "input"]);
    const surface = /SurfaceOrientation:\s*([0-3])/u.exec(input)?.[1];
    if (surface !== undefined) return Number(surface);
    const setting = (await this.adb(["shell", "settings", "get", "system", "user_rotation"])).trim();
    if (/^[0-3]$/u.test(setting)) return Number(setting);
    throw new Error("TN_PLAYTEST_ANDROID_ROTATION_UNKNOWN: dumpsys window, dumpsys input and user_rotation did not report 0 through 3.");
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
      type: isPlatformWebViewNoise(text)
        ? "log"
        : /^(?:E|F)\//u.test(text) || /\b(?:Error|FATAL|FAILED)\b/u.test(text)
          ? "error"
          : "log",
    }));
}

/**
 * A `chromium` line the WebView wrote about itself, rather than the page's console.
 *
 * The tag carries both. The page's `console.error` arrives as `[ERROR:CONSOLE(line)]`; the
 * WebView's own C++ diagnostics name their source file — `variations_seed_loader.cc`,
 * `simple_index_file.cc` — and describe the platform, not the game. A first launch after
 * `adb install -r` writes five of them because the HTTP cache directory does not exist yet, and
 * counting those as the game's console errors makes `noConsoleErrors` mean something different
 * on Android than it means in a browser, which is the one thing a cross-target assertion may
 * never do.
 *
 * The line is kept either way. Only its severity is decided here.
 */
function isPlatformWebViewNoise(text: string): boolean {
  if (!/\bchromium\(/u.test(text)) return false;
  // The page's console, or anything carrying the framework's own marker, is the game talking
  // whatever tag it arrived under.
  return !/:CONSOLE\(|Mystral|THREENATIVE/u.test(text);
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

/** `wm size`'s physical line: the panel's own frame, which the override is written in. */
function parsePhysicalSize(output: string): { height: number; width: number } | undefined {
  const size = /Physical size:\s*(\d+)x(\d+)/u.exec(output);
  return size == null ? undefined : { height: Number(size[2]), width: Number(size[1]) };
}

/** `wm size`'s override line, as written — absent until something overrides it. */
function parseOverrideSize(output: string): string | undefined {
  return /Override size:\s*(\d+x\d+)/u.exec(output)?.[1];
}

/**
 * The touch rotation for the window `dumpsys window` just described, or `undefined`.
 *
 * `mRotation` says how far the window's content is turned from the panel's natural frame.
 * {@link rotatedTouchPosition} converts the other way — a point in that content back to the
 * panel's raw axes — so the value it needs is the inverse, and handing it `mRotation` directly
 * is a 180-degree error on either odd rotation.
 *
 * This is the source of truth because it describes the *window*. `dumpsys input`'s
 * `SurfaceOrientation` is absent on the emulator, and `user_rotation` is the user's preference:
 * an orientation-locked game on a device the user never turned reads 0 there while its window
 * is turned 90 degrees off the panel, so every injected touch lands somewhere else.
 */
export function touchRotationFromWindowDump(dump: string): number | undefined {
  const rotation = /\bmRotation=([0-3])\b/u.exec(dump)?.[1];
  return rotation === undefined ? undefined : (4 - Number(rotation)) % 4;
}

/**
 * Make the device present a scenario's declared viewport, one device pixel per CSS pixel.
 *
 * A scenario's `viewport` is a declared test condition, and the browser target honours it by
 * sizing the window. Without the same courtesy here, a UI page lays out at whatever CSS viewport
 * the device's density happens to give — 914x411 on a 2400x1080 panel at 420dpi — and a step
 * that names a point in viewport pixels lands on whatever the device's own layout put there.
 * Nothing about that failure looks like a coordinate problem: the touch arrives, the host
 * hit-tests it honestly, and the control simply is not where the scenario said.
 *
 * Density 160 is the whole mechanism: it makes `devicePixelRatio` 1, so a viewport pixel, a CSS
 * pixel and a device pixel are the same pixel and the page lays out exactly as it does on web.
 * The size is written in the panel's natural frame, which is why it is transposed for the
 * portrait-natural devices every phone and emulator here happens to be.
 */
export function viewportPresentationCommands(
  viewport: { height: number; width: number },
  physical: { height: number; width: number },
): string[][] {
  if (!(viewport.width > 0) || !(viewport.height > 0)) {
    throw new Error(
      `TN_PLAYTEST_ANDROID_VIEWPORT_INVALID: a scenario viewport of ${viewport.width}x${viewport.height} cannot be presented on a device.`,
    );
  }
  const short = Math.min(viewport.width, viewport.height);
  const long = Math.max(viewport.width, viewport.height);
  const naturallyPortrait = physical.height >= physical.width;
  const natural = naturallyPortrait ? `${short}x${long}` : `${long}x${short}`;
  // Orientation is the other half of presenting a viewport. The runtime's activity declares no
  // `screenOrientation`, so it takes whatever the device gives: the emulator gave landscape and
  // the Pixel 8, lying flat, gave portrait — the same build and the same size override, but a
  // 720x405 letterbox inside a portrait window. A 1280x720 viewport is a landscape viewport, and
  // a device showing it portrait is not presenting it.
  const quarterTurn = naturallyPortrait === viewport.width > viewport.height;
  return [
    ["shell", "wm", "size", natural],
    ["shell", "wm", "density", "160"],
    ["shell", "wm", "user-rotation", "lock", quarterTurn ? "1" : "0"],
  ];
}

/**
 * One OS-level tap, in the display's current orientation.
 *
 * With the viewport presented, that orientation *is* the scenario's viewport and the coordinate
 * needs no rotation — which is the second reason to prefer this over the emulator's pointer
 * protocol. The first is that `adb emu event send` exists only on emulators, and a click step
 * that only works on an emulator is a click step that does not work.
 */
export function tapCommand(x: number, y: number): string[] {
  return ["shell", "input", "tap", String(Math.round(x)), String(Math.round(y))];
}

/** Whether an input method window is on screen, from `dumpsys input_method`. */
export function keyboardIsShown(dump: string): boolean {
  return /\bmInputShown=true\b/u.test(dump);
}

/**
 * Undo the presentation.
 *
 * `reset` and never the numbers read beforehand: a run that crashed between reading and writing
 * would restore a size it had already replaced, and leave the device quietly wrong for whoever
 * measures on it next.
 */
export function viewportRestoreCommands(): string[][] {
  return [
    // Orientation first: freeing it while the display is still the test size lets the window
    // manager settle once, rather than once per reset.
    ["shell", "wm", "user-rotation", "free"],
    ["shell", "wm", "size", "reset"],
    ["shell", "wm", "density", "reset"],
  ];
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
