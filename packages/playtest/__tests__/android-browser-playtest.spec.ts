import { expect, test, vi } from "vitest";

import { AndroidChromeBrowserSession, androidBrowserUrl } from "../src/runner/androidBrowserRunner.js";
import { classifyRunnerError, runConfiguredPlaytest } from "../src/runner/cli.js";
import { parseStandalonePlaytestArgs, type IStandalonePlaytestConfig } from "../src/runner/config.js";
import { openRunnerPage, teardownBrowserSession } from "../src/runner/runner.js";

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
  const defaultContext = { marker: "default", pages: () => [] };
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
    "pixel-8", "shell", "am", "start", "-W",
    "-n", "com.android.chrome/com.google.android.apps.chrome.Main",
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

test("the remote runner navigates the scenario page to device loopback while retaining operator config", async () => {
  const navigated: string[] = [];
  const page = {
    goto: async (url: string) => { navigated.push(url); },
    waitForFunction: async () => { throw new Error("bridge absent"); },
    waitForLoadState: async () => undefined,
  };
  const config = {
    timeoutMs: 1000,
    url: "https://devbox.example:8443/game/level?seed=7#spawn",
  };

  await openRunnerPage(page as never, config as never, {
    assert: { diagnostics: { noConsoleErrors: true } },
    name: "remote-url",
    schemaVersion: 1,
    steps: [],
  } as never, {
    navigationUrl: (active: IStandalonePlaytestConfig) => androidBrowserUrl(active.url).url,
  } as never);

  expect(navigated).toEqual(["https://127.0.0.1:8443/game/level?seed=7#spawn"]);
  expect(config.url).toBe("https://devbox.example:8443/game/level?seed=7#spawn");
});

test("pre-existing CDP tabs survive while every page created by the run is closed", async () => {
  const calls: string[][] = [];
  const pages: FakeOwnedPage[] = [ownedPage("https://user.example/important")];
  const original = pages[0]!;
  const context = {
    newPage: async () => {
      const page = ownedPage("about:blank");
      pages.push(page);
      return page;
    },
    pages: () => pages.filter(({ closed }) => !closed),
  };
  const browser = { contexts: () => [context] };
  const session = new AndroidChromeBrowserSession(baseBrowserConfig(), {
    connectOverCDP: vi.fn().mockResolvedValue(browser),
    execAdb: async (_adb, serial, args) => {
      calls.push([serial, ...args]);
      if (args[0] === "get-state") return "device\n";
      if (args[0] === "reverse" && args[1] === "--list") return "";
      if (args.includes("pidof")) return "4412\n";
      if (args.includes("battery")) return batteryFixture();
      if (args.includes("thermalservice")) return "Thermal Status: 0\n";
      if (args.includes("current_now")) return "-1000\n";
      if (args.includes("am") && args.includes("start")) {
        if (args.includes("android.intent.action.VIEW")) {
          original.currentUrl = args[args.indexOf("-d") + 1] ?? original.currentUrl;
        } else {
          pages.push(ownedPage("chrome://newtab"));
        }
      }
      return "";
    },
    findFreePort: async () => 39221,
  });

  await session.prepare(baseBrowserConfig());
  const connected = await session.connect();
  const defaultContext = await session.context(connected);
  const scenarioPage = await defaultContext.newPage();
  await teardownBrowserSession(scenarioPage, defaultContext, connected, undefined, session);

  expect(original.currentUrl).toBe("https://user.example/important");
  expect(original.closed).toBe(false);
  expect(pages.filter((page) => page !== original).every(({ closed }) => closed)).toBe(true);
  expect(calls).toContainEqual([
    "pixel-8", "shell", "am", "start", "-W",
    "-n", "com.android.chrome/com.google.android.apps.chrome.Main",
  ]);
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
    connectOverCDP: vi.fn().mockResolvedValue({
      contexts: () => [{ pages: () => [] }],
    }),
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

interface FakeOwnedPage {
  closed: boolean;
  close(): Promise<void>;
  currentUrl: string;
  url(): string;
}

function ownedPage(url: string): FakeOwnedPage {
  return {
    closed: false,
    async close() { this.closed = true; },
    currentUrl: url,
    url() { return this.currentUrl; },
  };
}

function baseBrowserConfig(): IStandalonePlaytestConfig {
  return {
    adbPath: "/sdk/adb",
    artifactDirectory: "/artifacts",
    device: "pixel-8",
    headless: true,
    projectPath: "/project",
    scenarioPath: "scenario.json",
    timeoutMs: 1000,
    trace: false,
    url: "http://localhost:5173/game",
  };
}

function batteryFixture(): string {
  return "AC powered: false\nUSB powered: false\nWireless powered: false\nstatus: 3\nlevel: 80\ntemperature: 320\n";
}
