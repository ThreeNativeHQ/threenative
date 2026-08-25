import { makeTempDir } from "../../../test-support/temp-dir.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { Page } from "playwright";

import { PLAYTEST_PROTOCOL_LIMITS, PLAYTEST_PROTOCOL_VERSION } from "../src/index.js";
import { runDevicePlaytest, type IDevicePlaytestDriver } from "../src/runner/androidRunner.js";
import type { IStandalonePlaytestConfig } from "../src/runner/config.js";
import type { IDevicePlaytestTransport } from "../src/runner/deviceTransport.js";
import { runStep } from "../src/runner/steps.js";

test("click drives a browser pointer down and up at viewport pixels", async () => {
  const calls: Array<[string, number?, number?]> = [];
  const page = {
    context: () => ({ newCDPSession: async () => ({ send: async () => undefined }) }),
    evaluate: async () => undefined,
    keyboard: { down: async () => undefined, up: async () => undefined },
    mouse: {
      down: async () => calls.push(["down"]),
      move: async (x: number, y: number) => calls.push(["move", x, y]),
      up: async () => calls.push(["up"]),
    },
  } as unknown as Page;

  await runStep(
    page,
    undefined,
    { at: { x: 320, y: 180 }, kind: "click", release: true } as never,
    { height: 360, width: 640 },
    undefined,
    [],
    { heldKeys: new Set(), pointerButtons: 0, pointers: new Map() },
    undefined,
    true,
  );

  expect(calls).toEqual([["move", 320, 180], ["down"], ["up"]]);
});

test("entity click without a bridge fails with a named pointer diagnostic", async () => {
  const page = {
    context: () => ({ newCDPSession: async () => ({ send: async () => undefined }) }),
    evaluate: async () => undefined,
    keyboard: { down: async () => undefined, up: async () => undefined },
    mouse: { down: async () => undefined, move: async () => undefined, up: async () => undefined },
  } as unknown as Page;

  await expect(runStep(
    page,
    undefined,
    { at: { entity: "settings" }, kind: "click", release: true } as never,
    { height: 360, width: 640 },
    undefined,
    [],
    { heldKeys: new Set(), pointerButtons: 0, pointers: new Map() },
    undefined,
    true,
  )).rejects.toMatchObject({ diagnostic: { code: "TN_PLAYTEST_UNSUPPORTED_ON_TARGET" } });
});

test.each(["android", "desktop", "ios"] as const)(
  "native %s click without a pointer transport fails closed before advancing",
  async (target) => {
    const projectPath = await makeTempDir(`playtest-${target}-click-`);
    await writeFile(join(projectPath, "scenario.json"), JSON.stringify({
      name: "native-click",
      schemaVersion: 1,
      steps: [{ at: { x: 10, y: 10 }, kind: "click" }],
      viewport: { height: 100, width: 100 },
    }));
    let prepared = false;
    let started = false;
    const driver: IDevicePlaytestDriver = {
      captureConsole: async () => [],
      isAlive: async () => true,
      prepare: async () => { prepared = true; },
      screenshot: async () => undefined,
      stop: async () => undefined,
    };
    const transport: IDevicePlaytestTransport = {
      capabilities: [],
      call: async <T>() => undefined as T,
      close: async () => undefined,
      start: async () => { started = true; },
      waitForBridge: async () => false,
    };
    const config: IStandalonePlaytestConfig = {
      artifactDirectory: join(projectPath, "artifacts"),
      endpoint: "http://127.0.0.1:41777/playtest",
      headless: true,
      projectPath,
      scenarioPath: "scenario.json",
      target,
      timeoutMs: 100,
      trace: false,
      url: "http://127.0.0.1:5173",
    };

    const report = await runDevicePlaytest(config, {
      driver,
      mailboxPaths: { request: "request", response: "response" },
      name: target,
      processName: "native-click-test",
      transport,
    });

    expect(report.pass).toBe(false);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "TN_PLAYTEST_UNSUPPORTED_ON_TARGET",
      fix: { instruction: expect.stringContaining("OS pointer injection") },
    }));
    expect(prepared).toBe(false);
    expect(started).toBe(false);
  },
);

test("Android click injects a viewport-pixel touch through the device transport", async () => {
  const projectPath = await makeTempDir("playtest-android-click-");
  await writeFile(join(projectPath, "scenario.json"), JSON.stringify({
    artifacts: { screenshots: false },
    assert: {
      diagnostics: {
        networkErrorsOptOutReason: "The Android transport has no network observer in this focused input test.",
        noNetworkErrors: false,
      },
    },
    name: "android-click",
    schemaVersion: 1,
    steps: [
      { at: { x: 320, y: 180 }, kind: "click" },
      { kind: "input", label: "type-a", press: "a", holdTicks: 1, release: true },
    ],
    target: "web",
    viewport: { height: 360, width: 640 },
    warmupFrames: 0,
  }));
  const pointerSets: Array<readonly { buttons?: number; id: number; x: number; y: number }[]> = [];
  const adbCalls: string[][] = [];
  let tick = 0;
  const driver: IDevicePlaytestDriver = {
    captureConsole: async () => [],
    isAlive: async () => true,
    prepare: async () => undefined,
    screenshot: async () => undefined,
    setPointers: async (pointers) => {
      pointerSets.push(pointers);
      return {
        activeIds: pointers.map(({ id }) => id),
        injection: "adb-emu-event-protocol-b",
        rotation: 0,
        trackingIds: pointers.map(({ id }) => id),
      };
    },
    runAdb: async (args) => {
      adbCalls.push([...args]);
      return "";
    },
    stop: async () => undefined,
  };
  const transport: IDevicePlaytestTransport = {
    capabilities: ["browser.console", "browser.input", "runtime.diagnostics"],
    call: async <T>(method: string, argument?: unknown) => {
      if (method === "describe") {
        return {
          capabilities: ["runtime.diagnostics", "runtime.fixedStep"],
          limits: PLAYTEST_PROTOCOL_LIMITS,
          name: "android-click-test",
          protocolVersion: PLAYTEST_PROTOCOL_VERSION,
        } as T;
      }
      if (method === "ready") return { ready: true } as T;
      if (method === "advance") {
        const ticks = typeof argument === "number" ? argument : 0;
        tick += ticks;
        return { clock: { mode: "fixed-step", tick }, ticks } as T;
      }
      if (method === "sample") return { clock: { mode: "fixed-step", tick }, diagnostics: [] } as T;
      if (method === "drainEvents") return [] as T;
      return undefined as T;
    },
    close: async () => undefined,
    start: async () => undefined,
    waitForBridge: async () => true,
  };

  const report = await runDevicePlaytest({
    artifactDirectory: join(projectPath, "artifacts"),
    endpoint: "http://127.0.0.1:41777/playtest",
    headless: true,
    projectPath,
    scenarioPath: "scenario.json",
    target: "android",
    timeoutMs: 100,
    trace: false,
    url: "http://127.0.0.1:5173",
  }, {
    driver,
    mailboxPaths: { request: "request", response: "response" },
    name: "android",
    processName: "android-click-test",
    transport,
  });

  expect(report.pass).toBe(true);
  expect(pointerSets).toEqual([
    [{ buttons: 1, id: 1, x: 0.5, y: 0.5 }],
    [],
  ]);
  expect(adbCalls.filter((args) => args.includes("input"))).toEqual([
    ["shell", "input", "keyevent", "KEYCODE_A"],
  ]);
});

test("native pointer transport remains an explicit pointerPosition step", async () => {
  const projectPath = await makeTempDir("playtest-native-pointer-");
  await writeFile(join(projectPath, "scenario.json"), JSON.stringify({
    artifacts: { screenshots: false },
    assert: {
      diagnostics: {
        networkErrorsOptOutReason: "The native transport has no network observer in this focused input test.",
        noNetworkErrors: false,
      },
    },
    name: "native-pointer",
    schemaVersion: 1,
    steps: [{ holdTicks: 1, kind: "input", pointerPosition: { buttons: 1, x: 0.5, y: 0.5 }, release: true }],
    target: "web",
    viewport: { height: 100, width: 100 },
    warmupFrames: 0,
  }));
  const pointerCalls: unknown[] = [];
  let tick = 0;
  const driver: IDevicePlaytestDriver = {
    captureConsole: async () => [],
    isAlive: async () => true,
    prepare: async () => undefined,
    screenshot: async () => undefined,
    stop: async () => undefined,
  };
  const transport: IDevicePlaytestTransport = {
    capabilities: ["browser.console", "browser.input", "runtime.diagnostics"],
    call: async <T>(method: string, argument?: unknown) => {
      if (method === "input.pointer") pointerCalls.push(argument);
      if (method === "describe") {
        return {
          capabilities: ["runtime.diagnostics", "runtime.fixedStep"],
          limits: PLAYTEST_PROTOCOL_LIMITS,
          name: "native-pointer-test",
          protocolVersion: PLAYTEST_PROTOCOL_VERSION,
        } as T;
      }
      if (method === "ready") return { ready: true } as T;
      if (method === "advance") {
        const ticks = typeof argument === "number" ? argument : 0;
        tick += ticks;
        return { clock: { mode: "fixed-step", tick }, ticks } as T;
      }
      if (method === "sample") return { clock: { mode: "fixed-step", tick }, diagnostics: [] } as T;
      if (method === "drainEvents") return [] as T;
      return undefined as T;
    },
    close: async () => undefined,
    start: async () => undefined,
    waitForBridge: async () => true,
  };

  const report = await runDevicePlaytest({
    artifactDirectory: join(projectPath, "artifacts"),
    endpoint: "http://127.0.0.1:41777/playtest",
    headless: true,
    projectPath,
    scenarioPath: "scenario.json",
    target: "android",
    timeoutMs: 100,
    trace: false,
    url: "http://127.0.0.1:5173",
  }, {
    driver,
    mailboxPaths: { request: "request", response: "response" },
    name: "android",
    processName: "native-pointer-test",
    transport,
  });

  expect(report.pass).toBe(true);
  expect(pointerCalls).toEqual([
    { buttons: 1, type: "down", x: 50, y: 50 },
    { buttons: 0, type: "up", x: 0, y: 0 },
  ]);
});
