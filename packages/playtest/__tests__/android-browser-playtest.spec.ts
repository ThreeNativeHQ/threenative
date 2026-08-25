import { expect, test, vi } from "vitest";

import { AndroidChromeBrowserSession, androidBrowserUrl } from "../src/runner/androidBrowserRunner.js";
import { classifyRunnerError, runConfiguredPlaytest } from "../src/runner/cli.js";
import { parseStandalonePlaytestArgs } from "../src/runner/config.js";
import { teardownBrowserSession } from "../src/runner/runner.js";

test("browser plus device selects the serial-bound Android Chrome lane, never local Chromium", async () => {
  const config = parseStandalonePlaytestArgs([
    "scenario.json",
    "--target", "browser",
    "--device", "pixel-8",
  ], "/project");
  const localBrowser = vi.fn();
  const androidBrowser = vi.fn().mockResolvedValue({ pass: true });

  await runConfiguredPlaytest(config, {
    android: vi.fn(),
    androidBrowser,
    browser: localBrowser,
    desktop: vi.fn(),
    ios: vi.fn(),
  });

  expect(androidBrowser).toHaveBeenCalledWith(config);
  expect(localBrowser).not.toHaveBeenCalled();
});

test("browser plus device rejects desktop-only Chromium launch controls", () => {
  expect(() => parseStandalonePlaytestArgs([
    "scenario.json",
    "--target", "browser",
    "--device", "pixel-8",
    "--browser-recipe", "webgpu",
  ], "/project")).toThrow(/Android Chrome.*browser-recipe/u);

  expect(() => parseStandalonePlaytestArgs([
    "scenario.json",
    "--target", "browser",
    "--device", "pixel-8",
    "--headed",
  ], "/project")).toThrow(/Android Chrome.*headed/u);
});

test("device URL preserves scheme, explicit port, path and query on loopback", () => {
  expect(androidBrowserUrl("https://devbox.example:8443/game/level?seed=7#spawn")).toEqual({
    port: 8443,
    url: "https://127.0.0.1:8443/game/level?seed=7#spawn",
  });
  expect(androidBrowserUrl("http://devbox.example/game?seed=7")).toEqual({
    port: 80,
    url: "http://127.0.0.1:80/game?seed=7",
  });
});

test("Android Chrome session owns exact adb mappings, Chrome component and default CDP context", async () => {
  const calls: string[][] = [];
  const defaultContext = { marker: "default" };
  const browser = { contexts: () => [defaultContext] };
  const session = new AndroidChromeBrowserSession({
    adbPath: "/sdk/adb",
    artifactDirectory: "/artifacts",
    device: "pixel-8",
    headless: true,
    projectPath: "/project",
    scenarioPath: "scenario.json",
    timeoutMs: 1000,
    trace: false,
    url: "http://localhost:5173/game?seed=7",
  }, {
    connectOverCDP: vi.fn().mockResolvedValue(browser),
    execAdb: async (_adb, serial, args) => {
      calls.push([serial, ...args]);
      if (args[0] === "get-state") return "device\n";
      if (args.includes("battery")) return "AC powered: false\nUSB powered: false\nWireless powered: false\nstatus: 3\nlevel: 80\ntemperature: 320\n";
      if (args.includes("thermalservice")) return "Thermal Status: 0\n";
      if (args.includes("current_now")) return "-1000\n";
      if (args[0] === "logcat") return "";
      return "";
    },
    findFreePort: async () => 39221,
  });

  await session.prepare({ url: "http://localhost:5173/game?seed=7" } as never);
  const connected = await session.connect();
  expect(await session.context(connected)).toBe(defaultContext);
  const metrics = await session.finish();
  await session.close();

  expect(calls).toContainEqual(["pixel-8", "reverse", "--no-rebind", "tcp:5173", "tcp:5173"]);
  expect(calls).toContainEqual(["pixel-8", "forward", "--no-rebind", "tcp:39221", "localabstract:chrome_devtools_remote"]);
  expect(calls).toContainEqual([
    "pixel-8", "shell", "am", "start", "-W", "-a", "android.intent.action.VIEW",
    "-n", "com.android.chrome/com.google.android.apps.chrome.Main",
    "-d", "http://127.0.0.1:5173/game?seed=7",
  ]);
  expect(calls).toContainEqual(["pixel-8", "forward", "--remove", "tcp:39221"]);
  expect(calls).toContainEqual(["pixel-8", "reverse", "--remove", "tcp:5173"]);
  expect(calls.flat().join(" ")).not.toContain("--remove-all");
  expect(metrics?.serial).toBe("pixel-8");
  expect(metrics?.samples.map(({ phase }) => phase)).toEqual(["before", "after"]);
});

test("unreachable device and dead app port retain distinct named exit-2 diagnostics", () => {
  expect(classifyRunnerError(new Error("TN_PLAYTEST_DEVICE_FAILED: adb get-state failed"))).toMatchObject({
    code: "TN_PLAYTEST_DEVICE_FAILED",
  });
  expect(classifyRunnerError(new Error("page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5173"))).toMatchObject({
    code: "TN_PLAYTEST_PAGE_UNREACHABLE",
  });
});

test("a pre-existing reverse is rejected and never removed or rebound", async () => {
  const calls: string[][] = [];
  const session = ownershipSession(calls, {
    reverseList: "pixel-8 tcp:5173 tcp:6000\n",
    chromePid: "",
  });

  await expect(session.prepare({ url: "http://localhost:5173/game" } as never))
    .rejects.toThrow(/TN_PLAYTEST_DEVICE_FAILED.*reverse.*5173.*already exists/u);

  expect(calls).not.toContainEqual(["pixel-8", "reverse", "--remove", "tcp:5173"]);
  expect(calls.some((call) => call.includes("--no-rebind"))).toBe(false);
  expect(calls.some((call) => call.includes("am") && call.includes("start"))).toBe(false);
});

test("a pre-existing Chrome process and default context survive remote cleanup", async () => {
  const calls: string[][] = [];
  const session = ownershipSession(calls, { reverseList: "", chromePid: "4412\n" });
  await session.prepare({ url: "http://localhost:5173/game" } as never);
  await session.close();

  expect(calls.some((call) => call.includes("force-stop"))).toBe(false);
  expect(calls).toContainEqual(["pixel-8", "forward", "--remove", "tcp:39221"]);
  expect(calls).toContainEqual(["pixel-8", "reverse", "--remove", "tcp:5173"]);

  const page = { close: vi.fn() };
  const context = { close: vi.fn() };
  const browser = { close: vi.fn() };
  const remote = { close: vi.fn() };
  await teardownBrowserSession(page as never, context as never, browser as never, undefined, remote);
  expect(page.close).toHaveBeenCalledOnce();
  expect(context.close).not.toHaveBeenCalled();
  expect(browser.close).not.toHaveBeenCalled();
  expect(remote.close).toHaveBeenCalledOnce();
});

function ownershipSession(
  calls: string[][],
  state: { chromePid: string; reverseList: string },
): AndroidChromeBrowserSession {
  return new AndroidChromeBrowserSession({
    adbPath: "/sdk/adb",
    artifactDirectory: "/artifacts",
    device: "pixel-8",
    headless: true,
    projectPath: "/project",
    scenarioPath: "scenario.json",
    timeoutMs: 1000,
    trace: false,
    url: "http://localhost:5173/game",
  }, {
    connectOverCDP: vi.fn(),
    execAdb: async (_adb, serial, args) => {
      calls.push([serial, ...args]);
      if (args[0] === "get-state") return "device\n";
      if (args[0] === "reverse" && args[1] === "--list") return state.reverseList;
      if (args.includes("pidof")) return state.chromePid;
      if (args.includes("battery")) return "AC powered: false\nUSB powered: false\nWireless powered: false\nstatus: 3\nlevel: 80\ntemperature: 320\n";
      if (args.includes("thermalservice")) return "Thermal Status: 0\n";
      if (args.includes("current_now")) return "-1000\n";
      return "";
    },
    findFreePort: async () => 39221,
  });
}
