import { expect, test } from "vitest";

import { AdbAndroidDriver, parseAndroidConsole } from "../src/runner/android.js";

test("Android console starts after stopping the previous process and keeps new launch errors", async () => {
  let log = "";
  const launchError = "E/Mystral ( 8001): Error: current launch failed";
  const driver = new AdbAndroidDriver({
    activity: "com.threenative.runtime.MystralActivity",
    adbPath: "/nonexistent/adb",
    packageName: "com.example.game",
    user: "0",
  });
  (driver as unknown as { adb: (args: readonly string[]) => Promise<string> }).adb = async (args) => {
    if (args.includes("force-stop")) {
      log += "E/InputDispatcher( 658): channel 'com.example.game/MystralActivity' ~ Channel is unrecoverably broken and will be disposed!\n";
    }
    if (args[0] === "logcat" && args[1] === "-c") log = "";
    if (args[0] === "logcat" && args[1] === "-d") return log;
    if (args.includes("start")) log += launchError;
    return "";
  };

  await driver.prepare("http://127.0.0.1:41777/playtest");
  expect(await driver.captureConsole()).toEqual([{ text: launchError, type: "error" }]);
});

/**
 * One dropped adb transport is not a game failure.
 *
 * A hosted SwiftShader emulator drops the adb transport mid-dump: `adb logcat -d` prints part of
 * the buffer, exits non-zero on the truncated line, and the run failed TN_PLAYTEST_RUNNER_FAILED on
 * a game whose assertions had all passed (CI `clean-consumer`, 5th of 6 sequential runs). The same
 * class was already fixed twice on the native side — #310 and b12becde6 — by re-reading after
 * `wait-for-device`; mirroring that shape here keeps the two harnesses answering a dropped transport
 * the same way.
 */
test("Android console capture retries a dropped logcat transport instead of failing the run", async () => {
  const calls: Array<readonly string[]> = [];
  let logcatAttempts = 0;
  const driver = new AdbAndroidDriver({
    activity: "com.threenative.runtime.MystralActivity",
    adbPath: "/nonexistent/adb",
    packageName: "com.example.game",
    user: "0",
  });
  (driver as unknown as { adb: (args: readonly string[]) => Promise<string> }).adb = async (args) => {
    calls.push(args);
    if (args[0] === "logcat" && args[1] === "-d") {
      logcatAttempts += 1;
      if (logcatAttempts === 1) throw new Error("adb logcat -d -v brief failed: I/SDL     ( 8001): [Mystral] Runtime ini");
      return "I/SDL     ( 8001): [Mystral] Runtime initialized\nE/SDL     ( 8001): [Mystral] authored script failed\n";
    }
    return "";
  };

  expect(await driver.captureConsole()).toEqual([
    { text: "I/SDL     ( 8001): [Mystral] Runtime initialized", type: "log" },
    { text: "E/SDL     ( 8001): [Mystral] authored script failed", type: "error" },
  ]);
  expect(logcatAttempts).toBe(2);
  expect(calls.filter((args) => args[0] === "wait-for-device")).toHaveLength(1);
});

test("Android console capture fails with a bounded excerpt once the transport is gone", async () => {
  let logcatAttempts = 0;
  const driver = new AdbAndroidDriver({
    activity: "com.threenative.runtime.MystralActivity",
    adbPath: "/nonexistent/adb",
    packageName: "com.example.game",
    user: "0",
  });
  (driver as unknown as { adb: (args: readonly string[]) => Promise<string> }).adb = async (args) => {
    if (args[0] === "logcat" && args[1] === "-d") {
      logcatAttempts += 1;
      throw new Error(`adb logcat -d -v brief failed: ${"E/SDL     ( 8001): noise\n".repeat(4_000)}`);
    }
    return "";
  };

  // The failing report embedded an 82 KB logcat in the message; the excerpt keeps the complaint
  // (the tail, where the truncation is visible) and drops the rest.
  const failure = await driver.captureConsole().then(() => undefined, (error: Error) => error);
  expect(failure?.message).toMatch(/^adb logcat -d -v brief failed: /u);
  expect(failure?.message.length ?? 0).toBeLessThanOrEqual(2_200);
  expect(failure?.message).toMatch(/noise/u);
  expect(logcatAttempts).toBe(2);
});

test("Android console capture does not retry a device that refuses the command", async () => {
  let logcatAttempts = 0;
  const driver = new AdbAndroidDriver({
    activity: "com.threenative.runtime.MystralActivity",
    adbPath: "/nonexistent/adb",
    packageName: "com.example.game",
    user: "0",
  });
  (driver as unknown as { adb: (args: readonly string[]) => Promise<string> }).adb = async (args) => {
    if (args[0] === "logcat" && args[1] === "-d") {
      logcatAttempts += 1;
      throw new Error("adb logcat -d -v brief failed: KO: unknown command");
    }
    return "";
  };

  await expect(driver.captureConsole()).rejects.toThrow(/unknown command/u);
  expect(logcatAttempts).toBe(1);
});

test("Android console ignores SurfaceSyncGroup framework noise that names MystralActivity", () => {
  const entries = parseAndroidConsole([
    "E/SurfaceSyncGroup( 4270): Failed to receive transaction ready for VRI[MystralActivity]",
    "I/SDL     ( 4270): [Mystral] Runtime initialized",
    "E/SDL     ( 4270): [Mystral] Error: authored script failed",
    "E/chromium( 4270): THREENATIVE bridge failed",
  ].join("\n"));

  expect(entries).toEqual([
    { text: "I/SDL     ( 4270): [Mystral] Runtime initialized", type: "log" },
    { text: "E/SDL     ( 4270): [Mystral] Error: authored script failed", type: "error" },
    { text: "E/chromium( 4270): THREENATIVE bridge failed", type: "error" },
  ]);
});

test("Android console ignores system_server TransitionController lines that name MystralActivity", () => {
  const entries = parseAndroidConsole([
    "E/TransitionController(  575): Set visible without transition ActivityRecord{2cc98de u0 com.threenative.nativecsshud/com.threenative.runtime.MystralActivity t405} playing=false",
    "I/SDL     ( 4270): [Mystral] Runtime initialized",
  ].join("\n"));

  expect(entries).toEqual([
    { text: "I/SDL     ( 4270): [Mystral] Runtime initialized", type: "log" },
  ]);
});

/**
 * The WebView's own C++ diagnostics are not the game's console.
 *
 * Measured on emulator-5554, 2026-08-25: a first launch after `adb install -r` writes five
 * `E/chromium` lines — a missing variations-seed signature and an empty HTTP cache directory —
 * and every one of them failed the starter's `noConsoleErrors`. On browser that assertion means
 * the page's console; scraping logcat made it mean "no process on this device logged at error
 * level", which is a different assertion wearing the same name.
 *
 * The lines stay in the observation. Only their severity changes, because an observation that
 * disappears is how a harness learns to lie.
 */
test("Android console classifies WebView internals as log and page console as error", () => {
  const parsed = parseAndroidConsole([
    "E/chromium( 6585): [0825/065120.946206:ERROR:variations_seed_loader.cc(37)] Seed missing signature.",
    "E/chromium( 6585): [ERROR:simple_index_file.cc(614)] Could not reconstruct index from disk",
    'E/chromium( 6585): [ERROR:CONSOLE(12)] "Uncaught TypeError: game.begin is not a function", source: https://appassets.androidplatform.net/ui/main.js (12)',
    "E/Mystral ( 6585): TN_UI_OVERLAY_UNSUPPORTED: this device's WebView has no WEB_MESSAGE_LISTENER",
  ].join("\n"));
  expect(parsed.map(({ type }) => type)).toEqual(["log", "log", "error", "error"]);
  expect(parsed).toHaveLength(4);
});
