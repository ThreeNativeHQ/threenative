import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import {
  PLAYTEST_PROTOCOL_LIMITS,
  PLAYTEST_PROTOCOL_VERSION,
  type IPlaytestBridgeV1,
} from "../src/index.js";
import type { IAndroidDriver } from "../src/runner/android.js";
import { runAndroidPlaytest } from "../src/runner/androidRunner.js";
import { exitCodeForReport } from "../src/runner/cli.js";
import type { IStandalonePlaytestConfig } from "../src/runner/config.js";
import { DeviceBridgeTransport } from "../src/runner/deviceTransport.js";
import {
  connectDevicePlaytestBridge,
  type IDeviceBridgeInstallation,
} from "../src/three/device.js";

interface NativeHost {
  __THREENATIVE_NATIVE__?: {
    playtestInput: {
      keyboard(type: string, key: string, code: string): void;
      pointer(): void;
    };
  };
}

class FakeAndroidDriver implements IAndroidDriver {
  installation?: IDeviceBridgeInstallation;
  prepared = false;

  constructor(
    private readonly bridge?: IPlaytestBridgeV1,
    private readonly consoleEntries: Array<{ text: string; type: string }> = [],
  ) {}

  async captureConsole() {
    return this.consoleEntries;
  }

  async prepare(endpoint: string) {
    this.prepared = true;
    if (this.bridge !== undefined) this.installation = connectDevicePlaytestBridge(this.bridge, endpoint);
  }

  async isAlive() {
    return true;
  }

  async screenshot() {}

  async stop() {
    this.installation?.close();
  }
}

test("one device scenario reaches the same semantic evaluator and passes", async () => {
  const { bridge, setHeld } = movingBridge();
  const host = globalThis as typeof globalThis & NativeHost;
  const previous = host.__THREENATIVE_NATIVE__;
  host.__THREENATIVE_NATIVE__ = {
    playtestInput: {
      keyboard: (type) => setHeld(type === "keydown"),
      pointer: () => undefined,
    },
  };
  try {
    const result = await runDevice({ movement: { entity: "player", minDistance: 2 } }, new FakeAndroidDriver(bridge));

    expect(result.pass).toBe(true);
    expect(result.runtime).toBe("native");
    expect(result.target).toBe("android");
    expect(result.assertionResults).toContainEqual(expect.objectContaining({ id: "movement.distance", pass: true }));
    expect(exitCodeForReport(result)).toBe(0);
  } finally {
    if (previous === undefined) delete host.__THREENATIVE_NATIVE__;
    else host.__THREENATIVE_NATIVE__ = previous;
  }
});

test("a deliberately wrong value fails on the device path with exit code 1", async () => {
  const { bridge, setHeld } = movingBridge();
  const host = globalThis as typeof globalThis & NativeHost;
  const previous = host.__THREENATIVE_NATIVE__;
  host.__THREENATIVE_NATIVE__ = {
    playtestInput: {
      keyboard: (type) => setHeld(type === "keydown"),
      pointer: () => undefined,
    },
  };
  try {
    const result = await runDevice({ movement: { entity: "player", minDistance: 4 } }, new FakeAndroidDriver(bridge));

    expect(result.pass).toBe(false);
    expect(result.assertionResults).toContainEqual(expect.objectContaining({ id: "movement.distance", pass: false }));
    expect(exitCodeForReport(result)).toBe(1);
  } finally {
    if (previous === undefined) delete host.__THREENATIVE_NATIVE__;
    else host.__THREENATIVE_NATIVE__ = previous;
  }
});

test("an Android runtime error reaches the diagnostics assertion with exit code 1", async () => {
  const host = globalThis as typeof globalThis & NativeHost;
  const previous = host.__THREENATIVE_NATIVE__;
  host.__THREENATIVE_NATIVE__ = {
    playtestInput: { keyboard: () => undefined, pointer: () => undefined },
  };
  try {
    const result = await runDevice(
      { diagnostics: { noConsoleErrors: false, noRuntimeDiagnostics: true } },
      new FakeAndroidDriver(movingBridge().bridge, [{ text: "android boom", type: "error" }]),
    );

    expect(result.assertionResults).toContainEqual({
      details: { consoleErrors: 1, networkErrors: 0, runtimeDiagnostics: 1 },
      id: "diagnostics",
      pass: false,
    });
    expect(result.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_RUNTIME_DIAGNOSTIC");
    expect(exitCodeForReport(result)).toBe(1);
  } finally {
    if (previous === undefined) delete host.__THREENATIVE_NATIVE__;
    else host.__THREENATIVE_NATIVE__ = previous;
  }
});

test("a missing device bridge fails closed with exit code 2", async () => {
  const result = await runDevice(
    { movement: { entity: "player", minDistance: 1 } },
    new FakeAndroidDriver(),
    30,
  );

  expect(result.pass).toBe(false);
  expect(result.assertionResults).toBeUndefined();
  expect(result.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_BRIDGE_MISSING");
  expect(exitCodeForReport(result)).toBe(2);
});

test("a misspelled assertion is rejected before the Android app launches", async () => {
  const driver = new FakeAndroidDriver();

  await expect(runDevice({ movment: { entity: "player", minDistance: 1 } }, driver))
    .rejects.toMatchObject({
      diagnostic: expect.objectContaining({ code: "TN_PLAYTEST_SCENARIO_INVALID" }),
    });
  expect(driver.prepared).toBe(false);
});

test("network assertions fail explicitly unsupported instead of being skipped", async () => {
  const driver = new FakeAndroidDriver();
  const result = await runDevice({ diagnostics: { noNetworkErrors: true } }, driver);

  expect(result.pass).toBe(false);
  expect(result.assertionResults).toBeUndefined();
  expect(result.diagnostics).toContainEqual(expect.objectContaining({
    code: "TN_PLAYTEST_UNSUPPORTED_ON_TARGET",
    message: expect.stringContaining("network assertions"),
  }));
  expect(exitCodeForReport(result)).toBe(2);
  expect(driver.prepared).toBe(false);
});

async function runDevice(
  assert: unknown,
  driver: FakeAndroidDriver,
  timeoutMs = 1_000,
) {
  const projectPath = await mkdtemp(join(tmpdir(), "playtest-device-"));
  await writeFile(join(projectPath, "scenario.json"), JSON.stringify({
    artifacts: { screenshots: false },
    assert,
    name: "same-cross-target-scenario",
    schemaVersion: 1,
    steps: [{ holdFrames: 3, press: "KeyW", release: true }],
    subject: "player",
    target: "web",
    viewport: { height: 360, width: 640 },
    warmupFrames: 0,
  }));
  const port = await availablePort();
  const endpoint = `http://127.0.0.1:${port}/playtest`;
  const config: IStandalonePlaytestConfig = {
    android: { activity: ".MystralActivity", packageName: "com.mystral.engine" },
    artifactDirectory: join(projectPath, "artifacts"),
    endpoint,
    headless: true,
    projectPath,
    scenarioPath: "scenario.json",
    target: "android",
    timeoutMs,
    trace: false,
    url: "http://127.0.0.1:5173",
  };
  return runAndroidPlaytest(config, { driver, transport: new DeviceBridgeTransport(endpoint) });
}

function movingBridge(): { bridge: IPlaytestBridgeV1; setHeld(value: boolean): void } {
  let held = false;
  let tick = 0;
  let x = 0;
  return {
    bridge: {
      advance: async (ticks) => {
        tick += ticks;
        if (held) x += ticks;
        return { clock: { mode: "fixed-step", tick }, ticks };
      },
      describe: () => ({
        capabilities: ["entity.observe", "runtime.fixedStep", "runtime.diagnostics"],
        limits: PLAYTEST_PROTOCOL_LIMITS,
        name: "device-test",
        protocolVersion: PLAYTEST_PROTOCOL_VERSION,
      }),
      ready: () => ({ ready: true }),
      sample: () => ({
        clock: { mode: "fixed-step", tick },
        diagnostics: [],
        entities: [{ id: "player", transform: { position: [x, 0, 0] }, visible: true }],
        resources: {},
      }),
    },
    setHeld: (value) => { held = value; },
  };
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No test port available.");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
