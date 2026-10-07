import { makeTempDir } from "../../../test-support/temp-dir.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { PLAYTEST_PROTOCOL_LIMITS } from "../src/protocol.js";
import { runAndroidPlaytest } from "../src/runner/androidRunner.js";
import { AdbAndroidDriver } from "../src/runner/android.js";
import { parseStandalonePlaytestArgs } from "../src/runner/config.js";

test("--native-engine explicitly selects Android and leaves the legacy default unchanged", () => {
  expect(parseStandalonePlaytestArgs(["scenario.json", "--target", "android", "--native-engine"]).android?.nativeEngine).toBe(true);
  expect(parseStandalonePlaytestArgs(["scenario.json", "--target", "android"]).android?.nativeEngine).toBeUndefined();
  for (const target of ["browser", "ios", "desktop"]) {
    expect(() => parseStandalonePlaytestArgs(["scenario.json", "--target", target, "--native-engine"]))
      .toThrow("--native-engine requires --target android");
  }
});

// A raw mailbox peer, without installing any JavaScript playtest bridge.
async function runNative(profile: unknown = { engine: "native", gameRuntime: "cpp" }, ready = true, changedPid = false, surfaces = 2, devices = 1) {
  const scenario = JSON.parse(await readFile(new URL("../../runtime-native/tests/native-engine/playtests/native-engine-surface-recreate.playtest.json", import.meta.url), "utf8"));
  const projectPath = await makeTempDir("android-native-engine-");
  await writeFile(join(projectPath, "scenario.json"), JSON.stringify({
    ...scenario,
    viewport: { width: 640, height: 360 }, artifacts: { screenshots: "after" }, subject: "player",
    steps: [
      ...scenario.steps.slice(0, -1),
      { ...scenario.steps.at(-1), pointers: [{ id: 1, x: 0.5, y: 0.5 }] },
    ],
  }));
  const config = parseStandalonePlaytestArgs(["scenario.json", "--target", "android", "--native-engine", "--timeout", "30"], projectPath);
  const files = new Map<string, string>();
  const methods: string[] = [];
  const operations: string[] = [];
  let focused = true;
  let pid = 42;
  let tick = 0;
  let held = false;
  let z = 0;
  let root = "";
  let surfaceCreations = 1;
  let deviceCreations = 1;
  const driver = {
    async prepare(_endpoint: string, mailboxRoot?: string) {
      root = mailboxRoot!;
      if (ready) files.set(`${root}/tn-playtest-response.json`, JSON.stringify({ id: "ready", result: null }));
    },
    async readFile(path: string) { return files.get(path); },
    async removeFile(path: string) { files.delete(path); },
    async writeFile(path: string, contents: string) {
      const { id, method, argument } = JSON.parse(contents);
      if (!focused) throw new Error(`Mailbox ${method} attempted while backgrounded`);
      methods.push(method);
      let result: unknown = null;
      if (method === "describe") result = { capabilities: ["runtime.fixedStep", "entity.observe", "runtime.resources"], limits: PLAYTEST_PROTOCOL_LIMITS, protocolVersion: 1, name: "native", profile };
      if (method === "ready") result = { ready: true };
      if (method === "advance") { tick += argument; if (held) z -= argument * 0.1; }
      if (method === "input.keyDown") held = true;
      if (method === "input.keyUp") held = false;
      if (method === "sample") result = { clock: { mode: "fixed-step", tick }, entities: [{ id: "player", transform: { position: [0, 0, z] }, visible: true }], resources: { surface: { surfaceCreations, deviceCreations } } };
      files.set(`${root}/tn-playtest-response.json`, JSON.stringify({ id, result }));
    },
    async background() { operations.push("background"); focused = false; },
    async foreground() { operations.push("foreground"); focused = true; surfaceCreations = surfaces; deviceCreations = devices; if (changedPid) pid++; },
    async rotate() {},
    async lifecycleState() { return { focused, pid }; }, // SDL has no gfxinfo frame counter.
    async captureConsole() { return []; },
    async screenshot(path: string) {
      operations.push("capture");
      const { PNG } = await import("pngjs");
      const png = new PNG({ width: 16, height: 16 });
      for (let i = 0; i < png.data.length; i += 4) {
        png.data[i] = (i / 4) % 256;
        png.data[i + 1] = 180;
        png.data[i + 2] = 40;
        png.data[i + 3] = 255;
      }
      await writeFile(path, PNG.sync.write(png));
    },
    async isAlive() { return true; },
    async stop() {},
  };
  return { report: await runAndroidPlaytest(config, { driver }), methods, operations };
}

test("Android native engine uses the mailbox for semantic input and adb lifecycle/capture", async () => {
  const { report, methods, operations } = await runNative();
  expect(report.pass).toBe(true);
  expect(methods).toEqual(expect.arrayContaining(["describe", "ready", "sample", "input.keyDown", "advance", "input.keyUp"]));
  expect(methods.filter((method) => method === "input.pointers")).toHaveLength(3); // held, release, cleanup
  expect(operations).toEqual(["background", "foreground", "capture"]);
});

test("Android native selection rejects legacy profiles, missing readiness and process recreation", async () => {
  const legacy = await runNative({ engine: "legacy" });
  expect(legacy.report.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_BRIDGE_INCOMPATIBLE");
  expect(legacy.methods).not.toContain("input.keyDown");
  expect((await runNative(null)).report.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_BRIDGE_INCOMPATIBLE");
  const missing = await runNative(undefined, false);
  expect(missing.report.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_BRIDGE_MISSING");
  expect(missing.report.diagnostics[0]?.message).toContain("inspect mailbox");
  expect(missing.methods).toEqual([]);
  const changed = await runNative(undefined, true, true);
  expect(changed.report.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_ANDROID_LIFECYCLE_SESSION_CHANGED");
});

test("native surface scenario rejects missing/extra surface creation and a recreated device", async () => {
  for (const [surfaces, devices] of [[1, 1], [3, 1], [2, 2]]) {
    const { report } = await runNative(undefined, true, false, surfaces, devices);
    expect(report.pass).toBe(false);
    expect(report.assertionResults?.some((assertion) => assertion.id.startsWith("resource") && !assertion.pass)).toBe(true);
  }
});

test("native HOME waits for a fresh player surface-release acknowledgement before returning", async () => {
  const driver = new AdbAndroidDriver({ activity: ".NativeEngineActivity", packageName: "com.threenative.nativeengine", adbPath: "/unused/adb", nativeEngine: true, user: "0" });
  const calls: string[][] = [];
  let away = false;
  let polls = 0;
  (driver as unknown as { adb(args: readonly string[]): Promise<string> }).adb = async (args) => {
    calls.push([...args]);
    if (args.includes("pidof")) return "42";
    if (args.includes("keyevent")) away = true;
    if (args.includes("start")) away = false;
    if (args.includes("window")) return away ? "mCurrentFocus=Window{a u0 launcher/.Home}" : "mCurrentFocus=Window{b u0 com.threenative.nativeengine/.NativeEngineActivity}";
    if (args[0] === "logcat") {
      if (away) polls++;
      const stale = "I/TN_Player: TN_PLAYER_STAGE: surface-released\n";
      return polls >= 2 ? stale + stale : stale;
    }
    return "";
  };
  await driver.background();
  expect(polls).toBe(2);
  expect(calls).toContainEqual(["shell", "input", "keyevent", "3"]);
  expect(calls.filter((args) => args[0] === "logcat")).toHaveLength(3);
  expect(calls.filter((args) => args[0] === "logcat").every((args) => args.includes("--pid=42"))).toBe(true);
  await driver.foreground();
  expect(calls.find((args) => args.includes("start"))).toEqual(["shell", "am", "start", "--user", "0", "-n", "com.threenative.nativeengine/.NativeEngineActivity"]);
});

test("native HOME fails closed when only a stale surface-release acknowledgement exists", async () => {
  vi.useFakeTimers();
  try {
    const driver = new AdbAndroidDriver({ activity: ".NativeEngineActivity", packageName: "com.threenative.nativeengine", adbPath: "/unused/adb", nativeEngine: true });
    (driver as unknown as { adb(args: readonly string[]): Promise<string> }).adb = async (args) => {
      if (args.includes("pidof")) return "42";
      if (args[0] === "logcat") return "I/TN_Player: TN_PLAYER_STAGE: surface-released\n";
      return "";
    };
    const rejected = expect(driver.background()).rejects.toThrow("native player did not acknowledge surface release after HOME");
    await vi.runAllTimersAsync();
    await rejected;
  } finally {
    vi.useRealTimers();
  }
});

test("native Android launch uses the mailbox without a JS endpoint or adb reverse", async () => {
  const driver = new AdbAndroidDriver({ activity: ".NativeEngineActivity", packageName: "com.threenative.nativeengine", adbPath: "/unused/adb", nativeEngine: true, user: "0" });
  const calls: string[][] = [];
  (driver as unknown as { adb(args: readonly string[]): Promise<string> }).adb = async (args) => {
    calls.push([...args]); return "";
  };
  await driver.prepare("http://127.0.0.1:41777/playtest", "/mailbox");
  expect(calls.some(([command]) => command === "reverse")).toBe(false);
  const launch = calls.find((args) => args.includes("start"));
  expect(launch).toEqual(expect.arrayContaining(["TN_PLAYTEST_MAILBOX_ROOT", "/mailbox"]));
  expect(launch).not.toContain("TN_PLAYTEST_ENDPOINT");
});
