import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

import {
  PLAYTEST_PROTOCOL_LIMITS,
  PLAYTEST_PROTOCOL_VERSION,
  type IPlaytestBridgeV1,
} from "../src/index.js";
import type { IDevicePlaytestDriver } from "../src/runner/androidRunner.js";
import { exitCodeForReport } from "../src/runner/cli.js";
import type { IStandalonePlaytestConfig } from "../src/runner/config.js";
import { DeviceBridgeTransport } from "../src/runner/deviceTransport.js";
import { runIosPlaytest } from "../src/runner/iosRunner.js";
import { connectDevicePlaytestBridge, type IDeviceBridgeInstallation } from "../src/three/device.js";

class FakeIosDriver implements IDevicePlaytestDriver {
  installation?: IDeviceBridgeInstallation;
  prepared = false;

  constructor(
    private readonly bridge?: IPlaytestBridgeV1,
    private readonly consoleEntries: Array<{ text: string; type: string }> = [],
  ) {}
  async captureConsole() { return this.consoleEntries; }
  async isAlive() { return true; }
  async prepare(endpoint: string) {
    this.prepared = true;
    if (this.bridge !== undefined) this.installation = connectDevicePlaytestBridge(this.bridge, endpoint);
  }
  async screenshot() {}
  async stop() { this.installation?.close(); }
}

test("the existing device-smoke scenario reaches its visibility assertion on iOS", async () => {
  const driver = new FakeIosDriver(bridge());
  const result = await runIosScenario("device-smoke.playtest.json", driver);
  expect(driver.prepared).toBe(true);
  expect(result.pass).toBe(true);
  expect(result.target).toBe("ios");
  expect(result.assertionResults).toContainEqual(expect.objectContaining({ id: "visibility.cube", pass: true }));
  expect(exitCodeForReport(result)).toBe(0);
});

test("a deliberately wrong iOS value exits 1", async () => {
  const result = await runIos({
    diagnostics: deviceDiagnosticsOptOut,
    movement: { entity: "player", minDistance: 2 },
  }, new FakeIosDriver(bridge()));
  expect(result.pass).toBe(false);
  expect(result.assertionResults).toContainEqual(expect.objectContaining({ pass: false }));
  expect(exitCodeForReport(result)).toBe(1);
});

test("an iOS runtime error reaches the diagnostics assertion with exit code 1", async () => {
  const result = await runIos(
    {
      diagnostics: {
        noConsoleErrors: false,
        consoleErrorsOptOutReason: "This device test isolates runtime diagnostics from the console policy.",
        noNetworkErrors: false,
        networkErrorsOptOutReason: "The iOS transport has no network observer in this runtime test.",
        noRuntimeDiagnostics: true,
      },
    },
    new FakeIosDriver(bridge(), [{ text: "ios boom", type: "error" }]),
  );

  expect(result.assertionResults).toContainEqual({
    details: {
      consoleErrors: 1,
      networkErrors: 0,
      policy: {
        consoleErrorsOptOutReason: "This device test isolates runtime diagnostics from the console policy.",
        networkErrorsOptOutReason: "The iOS transport has no network observer in this runtime test.",
        noConsoleErrors: false,
        noNetworkErrors: false,
        noRuntimeDiagnostics: true,
      },
      runtimeDiagnostics: 1,
    },
    id: "diagnostics",
    pass: false,
  });
  expect(result.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_RUNTIME_DIAGNOSTIC");
  expect(exitCodeForReport(result)).toBe(1);
});

test("a missing iOS bridge exits 2", async () => {
  const result = await runIos({
    diagnostics: deviceDiagnosticsOptOut,
    movement: { entity: "player", minDistance: 1 },
  }, new FakeIosDriver(), 30);
  expect(result.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_BRIDGE_MISSING");
  expect(exitCodeForReport(result)).toBe(2);
});

test("a misspelled assertion is rejected before the iOS app launches", async () => {
  const driver = new FakeIosDriver();
  await expect(runIos({ visiblity: [{ entity: "cube", present: true }] }, driver)).rejects.toMatchObject({
    diagnostic: expect.objectContaining({ code: "TN_PLAYTEST_SCENARIO_INVALID" }),
  });
  expect(driver.prepared).toBe(false);
});

test("network assertions fail explicitly unsupported on iOS", async () => {
  const driver = new FakeIosDriver();
  const result = await runIosScenario("device-smoke-network.playtest.json", driver);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({
    code: "TN_PLAYTEST_UNSUPPORTED_ON_TARGET",
    message: expect.stringContaining("network assertions"),
  }));
  expect(exitCodeForReport(result)).toBe(2);
  expect(driver.prepared).toBe(false);
});

test("iOS multi-pointer scenarios block explicitly before launch", async () => {
  const driver = new FakeIosDriver(bridge());
  const result = await runIos(
    { diagnostics: { ...deviceDiagnosticsOptOut, runtimeReady: true } },
    driver,
    1_000,
    [{ holdFrames: 2, pointers: [{ id: 1, x: 0.2, y: 0.8 }], release: true }],
  );

  expect(result.diagnostics).toContainEqual(expect.objectContaining({
    code: "TN_PLAYTEST_UNSUPPORTED_ON_TARGET",
    message: expect.stringContaining("complete held-pointer input"),
  }));
  expect(driver.prepared).toBe(false);
});

async function runIos(
  assert: unknown,
  driver: FakeIosDriver,
  timeoutMs = 1_000,
  steps: unknown[] = [{ waitFrames: 1 }],
) {
  const projectPath = await mkdtemp(join(tmpdir(), "playtest-ios-"));
  await writeFile(join(projectPath, "scenario.json"), JSON.stringify({
    artifacts: { screenshots: false },
    assert,
    name: "ios-cross-target-scenario",
    schemaVersion: 1,
    steps,
    subject: "player",
    target: "web",
    viewport: { height: 360, width: 640 },
    warmupFrames: 0,
  }));
  const endpoint = `http://127.0.0.1:${await availablePort()}/playtest`;
  const config: IStandalonePlaytestConfig = {
    artifactDirectory: join(projectPath, "artifacts"),
    endpoint,
    headless: true,
    ios: { appPath: "/fake/ThreeNative.app", bundleId: "dev.threenative.runtime", transport: "simulator" },
    projectPath,
    scenarioPath: "scenario.json",
    target: "ios",
    timeoutMs,
    trace: false,
    url: "http://127.0.0.1:5173",
  };
  return runIosPlaytest(config, { driver, transport: new DeviceBridgeTransport(endpoint) });
}

async function runIosScenario(
  scenarioFile: string,
  driver: FakeIosDriver,
  timeoutMs = 1_000,
) {
  const projectPath = await mkdtemp(join(tmpdir(), "playtest-ios-fixture-"));
  const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/native-smoke/playtests", scenarioFile);
  await writeFile(join(projectPath, "scenario.json"), await readFile(fixturePath));
  const endpoint = `http://127.0.0.1:${await availablePort()}/playtest`;
  const config: IStandalonePlaytestConfig = {
    artifactDirectory: join(projectPath, "artifacts"),
    endpoint,
    headless: true,
    ios: { appPath: "/fake/ThreeNative.app", bundleId: "dev.threenative.runtime", transport: "simulator" },
    projectPath,
    scenarioPath: "scenario.json",
    target: "ios",
    timeoutMs,
    trace: false,
    url: "http://127.0.0.1:5173",
  };
  return runIosPlaytest(config, { driver, transport: new DeviceBridgeTransport(endpoint) });
}

const deviceDiagnosticsOptOut = {
  noNetworkErrors: false,
  networkErrorsOptOutReason: "The iOS transport has no network observer in this scenario.",
};

function bridge(): IPlaytestBridgeV1 {
  let tick = 0;
  let x = 0;
  return {
    advance: async (ticks) => {
      tick += ticks;
      x += ticks;
      return { clock: { mode: "fixed-step", tick }, ticks };
    },
    describe: () => ({
      capabilities: ["entity.bounds", "entity.observe", "runtime.fixedStep", "runtime.diagnostics"],
      limits: PLAYTEST_PROTOCOL_LIMITS,
      name: "ios-device-test",
      protocolVersion: PLAYTEST_PROTOCOL_VERSION,
    }),
    ready: () => ({ ready: true }),
    sample: () => ({
      clock: { mode: "fixed-step", tick },
      diagnostics: [],
      entities: [
        { id: "player", transform: { position: [x, 0, 0] }, visible: true },
        { bounds: { height: 40, width: 40, x: 300, y: 160 }, id: "cube", visible: true },
      ],
      resources: {},
    }),
  };
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No test port available.");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
