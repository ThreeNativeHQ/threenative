import { makeTempDir } from "../../../test-support/temp-dir.js";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

import {
  PLAYTEST_PROTOCOL_LIMITS,
  PLAYTEST_PROTOCOL_VERSION,
  type IPlaytestBridgeV1,
  type IPlaytestSampleRequest,
} from "../src/index.js";
import type { IAndroidDriver } from "../src/runner/android.js";
import { androidTouchBatches } from "../src/runner/android.js";
import { runAndroidPlaytest } from "../src/runner/androidRunner.js";
import { exitCodeForReport } from "../src/runner/cli.js";
import type { IStandalonePlaytestConfig } from "../src/runner/config.js";
import { DeviceBridgeTransport } from "../src/runner/deviceTransport.js";
import {
  connectDevicePlaytestBridge,
  type IDeviceBridgeInstallation,
} from "../src/three/device.js";

interface INativeHost {
  __THREENATIVE_NATIVE__?: {
    playtestInput: {
      keyboard(type: string, key: string, code: string): void;
      pointer(type: string, x: number, y: number, buttons: number): void;
    };
  };
}

class FakeAndroidDriver implements IAndroidDriver {
  installation?: IDeviceBridgeInstallation;
  pointerSets: number[][] = [];
  prepared = false;
  preparedMailboxRoot?: string;

  constructor(
    private readonly bridge?: IPlaytestBridgeV1,
    private readonly consoleEntries: Array<{ text: string; type: string }> = [],
    private readonly onPointers: (ids: readonly number[]) => void = () => undefined,
  ) {}

  async captureConsole() {
    return this.consoleEntries;
  }

  async prepare(endpoint: string, mailboxRoot?: string) {
    this.prepared = true;
    this.preparedMailboxRoot = mailboxRoot;
    if (this.bridge !== undefined) this.installation = connectDevicePlaytestBridge(this.bridge, endpoint);
  }

  async isAlive() {
    return true;
  }

  async screenshot() {}

  async setPointers(pointers: readonly { id: number }[]) {
    const ids = pointers.map(({ id }) => id);
    this.pointerSets.push(ids);
    this.onPointers(ids);
    return { activeIds: ids, injection: "adb-emu-event-protocol-b" as const, rotation: 0, trackingIds: ids };
  }

  async stop() {
    this.installation?.close();
  }
}

class FakeRecordingAndroidDriver extends FakeAndroidDriver {
  recordingStarted = false;
  recordingStopped = false;

  async startScreenRecording() {
    this.recordingStarted = true;
  }

  async stopScreenRecording(path: string) {
    this.recordingStopped = true;
    await writeFile(path, "not an mp4");
  }
}

test("the existing device-smoke scenario reaches its visibility assertion on Android", async () => {
  const driver = new FakeAndroidDriver(movingBridge().bridge);
  const result = await runDeviceScenario("device-smoke.playtest.json", driver);

  expect(driver.prepared).toBe(true);
  expect(result.pass).toBe(true);
  expect(result.runtime).toBe("native");
  expect(result.target).toBe("android");
  expect(result.assertionResults).toContainEqual(expect.objectContaining({ id: "visibility.cube", pass: true }));
  expect(exitCodeForReport(result)).toBe(0);
});

test("buttonless native pointer movement drives anonymous evidence", async () => {
  const moving = movingBridge({ clearHeldAfterAdvance: true });
  const pointerEvents: string[] = [];
  const host = globalThis as typeof globalThis & INativeHost;
  const previous = host.__THREENATIVE_NATIVE__;
  host.__THREENATIVE_NATIVE__ = {
    playtestInput: {
      keyboard: () => undefined,
      pointer: (type) => {
        pointerEvents.push(type);
        moving.setHeld(type === "pointermove");
      },
    },
  };
  try {
    const result = await runDevice(
      { movement: { minDistance: 2 } },
      new FakeAndroidDriver(moving.bridge),
      1_000,
      [
        { waitFrames: 1, release: true },
        { holdFrames: 3, pointerPosition: { x: 0.5, y: 0.5 }, release: true },
        { waitFrames: 1, release: true },
      ],
      null,
    );

    expect(result.pass).toBe(true);
    expect(result.entity).toBe("player");
    expect(pointerEvents).toEqual(["pointermove"]);
  } finally {
    if (previous === undefined) delete host.__THREENATIVE_NATIVE__;
    else host.__THREENATIVE_NATIVE__ = previous;
  }
});

test("buttoned native pointer movement presses before moving and releases", async () => {
  const moving = movingBridge({ clearHeldAfterAdvance: true });
  const pointerEvents: string[] = [];
  const host = globalThis as typeof globalThis & INativeHost;
  const previous = host.__THREENATIVE_NATIVE__;
  host.__THREENATIVE_NATIVE__ = {
    playtestInput: {
      keyboard: () => undefined,
      pointer: (type) => {
        pointerEvents.push(type);
        moving.setHeld(type === "pointermove");
      },
    },
  };
  try {
    const result = await runDevice(
      { diagnostics: deviceDiagnosticsOptOut },
      new FakeAndroidDriver(moving.bridge),
      1_000,
      [
        { holdFrames: 1, pointerPosition: { buttons: 1, x: 0.25, y: 0.5 }, release: false },
        { holdFrames: 3, pointerPosition: { buttons: 1, x: 0.75, y: 0.5 }, release: true },
      ],
      null,
    );

    expect(result.pass).toBe(true);
    expect(pointerEvents).toEqual(["pointerdown", "pointermove", "pointerup"]);
  } finally {
    if (previous === undefined) delete host.__THREENATIVE_NATIVE__;
    else host.__THREENATIVE_NATIVE__ = previous;
  }
});

test("one device scenario reaches the same semantic evaluator and passes", async () => {
  const { bridge, setHeld } = movingBridge();
  const host = globalThis as typeof globalThis & INativeHost;
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

test("anonymous device movement omits the entity selector from bridge samples", async () => {
  const moving = movingBridge();
  const host = globalThis as typeof globalThis & INativeHost;
  const previous = host.__THREENATIVE_NATIVE__;
  host.__THREENATIVE_NATIVE__ = {
    playtestInput: {
      keyboard: (type) => moving.setHeld(type === "keydown"),
      pointer: () => undefined,
    },
  };
  try {
    const result = await runDevice(
      { movement: { minDistance: 2 } },
      new FakeAndroidDriver(moving.bridge),
      1_000,
      [
        { waitFrames: 1, release: true },
        { holdFrames: 3, press: "KeyW", release: true },
        { waitFrames: 1, release: true },
      ],
      null,
    );

    expect(result.pass).toBe(true);
    expect(moving.sampleRequests.length).toBeGreaterThan(0);
    expect(moving.sampleRequests.every(({ entities }) => entities === undefined)).toBe(true);
  } finally {
    if (previous === undefined) delete host.__THREENATIVE_NATIVE__;
    else host.__THREENATIVE_NATIVE__ = previous;
  }
});

test("device wait preserves held input classification", async () => {
  const moving = movingBridge();
  const keyEvents: string[] = [];
  const host = globalThis as typeof globalThis & INativeHost;
  const previous = host.__THREENATIVE_NATIVE__;
  host.__THREENATIVE_NATIVE__ = {
    playtestInput: {
      keyboard: (type, _key, code) => {
        keyEvents.push(`${type}:${code}`);
        moving.setHeld(type === "keydown");
      },
      pointer: () => undefined,
    },
  };
  try {
    const result = await runDevice(
      { movement: { minDistance: 2 } },
      new FakeAndroidDriver(moving.bridge),
      1_000,
      [
        { holdFrames: 1, press: "KeyW", release: false },
        { waitFrames: 2, release: true },
        { holdFrames: 1, press: "KeyW", release: true },
        { waitFrames: 1, release: true },
      ],
      null,
    );

    expect(result.pass).toBe(true);
    expect(result.assertionResults).toContainEqual(expect.objectContaining({ id: "movement.distance", pass: true }));
    expect(keyEvents).toEqual(["keydown:KeyW", "keyup:KeyW"]);
  } finally {
    if (previous === undefined) delete host.__THREENATIVE_NATIVE__;
    else host.__THREENATIVE_NATIVE__ = previous;
  }
});

test("a deliberately wrong value fails on the device path with exit code 1", async () => {
  const { bridge, setHeld } = movingBridge();
  const host = globalThis as typeof globalThis & INativeHost;
  const previous = host.__THREENATIVE_NATIVE__;
  host.__THREENATIVE_NATIVE__ = {
    playtestInput: {
      keyboard: (type) => setHeld(type === "keydown"),
      pointer: () => undefined,
    },
  };
  try {
    const result = await runDevice({
      diagnostics: deviceDiagnosticsOptOut,
      movement: { entity: "player", minDistance: 4 },
    }, new FakeAndroidDriver(bridge));

    expect(result.pass).toBe(false);
    expect(result.assertionResults).toContainEqual(expect.objectContaining({ id: "movement.distance", pass: false }));
    expect(exitCodeForReport(result)).toBe(1);
  } finally {
    if (previous === undefined) delete host.__THREENATIVE_NATIVE__;
    else host.__THREENATIVE_NATIVE__ = previous;
  }
});

test("an Android runtime error reaches the diagnostics assertion with exit code 1", async () => {
  const host = globalThis as typeof globalThis & INativeHost;
  const previous = host.__THREENATIVE_NATIVE__;
  host.__THREENATIVE_NATIVE__ = {
    playtestInput: { keyboard: () => undefined, pointer: () => undefined },
  };
  try {
    const result = await runDevice(
      {
        diagnostics: {
          noConsoleErrors: false,
          consoleErrorsOptOutReason: "This device test isolates runtime diagnostics from the console policy.",
          noNetworkErrors: false,
          networkErrorsOptOutReason: "The Android transport has no network observer in this runtime test.",
          noRuntimeDiagnostics: true,
        },
      },
      new FakeAndroidDriver(movingBridge().bridge, [{ text: "android boom", type: "error" }]),
    );

    expect(result.assertionResults).toContainEqual({
      details: {
        consoleErrors: 1,
        networkErrors: 0,
        policy: {
          consoleErrorsOptOutReason: "This device test isolates runtime diagnostics from the console policy.",
          networkErrorsOptOutReason: "The Android transport has no network observer in this runtime test.",
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
  } finally {
    if (previous === undefined) delete host.__THREENATIVE_NATIVE__;
    else host.__THREENATIVE_NATIVE__ = previous;
  }
});

test("a missing device bridge fails closed with exit code 2", async () => {
  const driver = new FakeAndroidDriver();
  const result = await runDevice(
    { diagnostics: deviceDiagnosticsOptOut, movement: { entity: "player", minDistance: 1 } },
    driver,
    30,
  );

  expect(driver.preparedMailboxRoot).toBe("/sdcard/Android/data/com.mystral.engine/files");
  expect(result.pass).toBe(false);
  expect(result.assertionResults).toContainEqual(expect.objectContaining({ id: "diagnostics", pass: false }));
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
  const result = await runDeviceScenario("device-smoke-network.playtest.json", driver);

  expect(result.pass).toBe(false);
  expect(result.assertionResults).toContainEqual(expect.objectContaining({ id: "diagnostics", pass: false }));
  expect(result.diagnostics).toContainEqual(expect.objectContaining({
    code: "TN_PLAYTEST_UNSUPPORTED_ON_TARGET",
    message: expect.stringContaining("network assertions"),
  }));
  expect(exitCodeForReport(result)).toBe(2);
  expect(driver.prepared).toBe(false);
});

test("Android framebuffer coverage requires the recorder observer before launching", async () => {
  const driver = new FakeAndroidDriver(movingBridge().bridge);
  const result = await runDevice(
    framebufferCoverageAssertion(),
    driver,
    1_000,
    [{ label: "loading", waitFrames: 1 }],
  );

  expect(result.pass).toBe(false);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({
    code: "TN_PLAYTEST_UNSUPPORTED_ON_TARGET",
    message: expect.stringContaining("framebuffer coverage recording"),
  }));
  expect(exitCodeForReport(result)).toBe(2);
  expect(driver.prepared).toBe(false);
});

test("Android framebuffer coverage brackets its declared steps and fails closed on unreadable video", async () => {
  const moving = movingBridge();
  const driver = new FakeRecordingAndroidDriver(moving.bridge);
  const result = await runDevice(
    framebufferCoverageAssertion(),
    driver,
    1_000,
    [{ label: "loading", waitFrames: 1 }],
  );

  expect(driver.recordingStarted).toBe(true);
  expect(driver.recordingStopped).toBe(true);
  expect(moving.tick()).toBe(1);
  expect(result.assertionResults).toContainEqual(expect.objectContaining({
    id: "framebufferCoverage",
    pass: false,
  }));
  expect(result.observations?.framebufferCoverage).toMatchObject({
    boundarySource: "scenario-steps",
    frameCount: 0,
    unreadableReason: expect.stringContaining("TN_PLAYTEST_FRAMEBUFFER_COVERAGE_VIDEO_UNREADABLE"),
    windowCompleted: false,
    windowStarted: false,
  });
  expect(result.diagnostics).toContainEqual(expect.objectContaining({
    code: "TN_PLAYTEST_FRAMEBUFFER_PIXELS_UNREADABLE",
  }));
  expect(exitCodeForReport(result)).toBe(1);
});

test("Android multi-pointer steps deliver complete held sets and release in finally", async () => {
  const moving = movingBridge();
  const driver = new FakeAndroidDriver(moving.bridge, [], (ids) => moving.setHeld(ids.length === 2));
  const result = await runDevice(
    { diagnostics: deviceDiagnosticsOptOut, movement: { entity: "player", minDistance: 2 } },
    driver,
    1_000,
    [
      { holdFrames: 2, pointers: [{ id: 7, x: 0.2, y: 0.8 }], release: false },
      {
        holdFrames: 3,
        pointers: [{ id: 7, x: 0.25, y: 0.8 }, { id: 3, x: 0.8, y: 0.8 }],
        release: true,
      },
    ],
  );

  expect(result.pass).toBe(true);
  expect(driver.pointerSets.slice(0, 3)).toEqual([[7], [7, 3], []]);
  expect(driver.pointerSets.at(-1)).toEqual([]);
});

async function runDevice(
  assert: unknown,
  driver: FakeAndroidDriver,
  timeoutMs = 1_000,
  steps: unknown[] = [{ holdFrames: 3, press: "KeyW", release: true }],
  subject: string | null = "player",
) {
  const projectPath = await makeTempDir("playtest-device-");
  await writeFile(join(projectPath, "scenario.json"), JSON.stringify({
    artifacts: { screenshots: false },
    assert,
    name: "same-cross-target-scenario",
    schemaVersion: 1,
    steps,
    ...(subject === null ? {} : { subject }),
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

async function runDeviceScenario(
  scenarioFile: string,
  driver: FakeAndroidDriver,
  timeoutMs = 1_000,
) {
  const projectPath = await makeTempDir("playtest-device-fixture-");
  const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/native-smoke/playtests", scenarioFile);
  await writeFile(join(projectPath, "scenario.json"), await readFile(fixturePath));
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

function framebufferCoverageAssertion() {
  return {
    diagnostics: {
      noNetworkErrors: false,
      networkErrorsOptOutReason: "The Android transport has no network observer in this scenario.",
    },
    framebufferCoverage: {
      backdrop: [13, 27, 42],
      tolerance: 0,
      window: { endStep: "loading", startStep: "loading" },
    },
  };
}

const deviceDiagnosticsOptOut = {
  noNetworkErrors: false,
  networkErrorsOptOutReason: "The Android transport has no network observer in this scenario.",
};

function movingBridge(options: { clearHeldAfterAdvance?: boolean } = {}): {
  bridge: IPlaytestBridgeV1;
  sampleRequests: IPlaytestSampleRequest[];
  setHeld(value: boolean): void;
  tick(): number;
} {
  let held = false;
  let tick = 0;
  let x = 0;
  const sampleRequests: IPlaytestSampleRequest[] = [];
  return {
    bridge: {
      advance: async (ticks) => {
        tick += ticks;
        if (held) x += ticks;
        if (options.clearHeldAfterAdvance === true) held = false;
        return { clock: { mode: "fixed-step", tick }, ticks };
      },
      describe: () => ({
        capabilities: ["entity.bounds", "entity.observe", "runtime.fixedStep", "runtime.diagnostics"],
        limits: PLAYTEST_PROTOCOL_LIMITS,
        name: "device-test",
        protocolVersion: PLAYTEST_PROTOCOL_VERSION,
      }),
      ready: () => ({ ready: true }),
      sample: (request) => {
        sampleRequests.push(request);
        return {
          clock: { mode: "fixed-step", tick },
          diagnostics: [],
          entities: [
            { id: "player", transform: { position: [x, 0, 0] }, visible: true },
            { bounds: { height: 40, width: 40, x: 300, y: 160 }, id: "cube", visible: true },
          ],
          resources: {},
        };
      },
    },
    sampleRequests,
    setHeld: (value) => { held = value; },
    tick: () => tick,
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

test("emulator touch batches never mix a tracking id with a coordinate", () => {
  const identity = ["EV_ABS:ABS_MT_SLOT:0", "EV_ABS:ABS_MT_TRACKING_ID:100"];
  const positions = [
    "EV_ABS:ABS_MT_SLOT:0",
    "EV_ABS:ABS_MT_POSITION_X:6553",
    "EV_ABS:ABS_MT_POSITION_Y:26214",
  ];

  expect(androidTouchBatches(identity, positions)).toEqual([
    [...identity, "EV_SYN:0:0"],
    [...positions, "EV_SYN:0:0"],
  ]);
  expect(androidTouchBatches([], [])).toEqual([]);
  expect(androidTouchBatches(identity, [])).toEqual([[...identity, "EV_SYN:0:0"]]);

  // The emulator answers OK and silently discards the coordinate, so this has to throw rather
  // than inject a contact that lands at (0, 0).
  expect(() => androidTouchBatches([...identity, ...positions], [])).toThrow(
    /TN_PLAYTEST_ANDROID_TOUCH_BATCH_MIXED/u,
  );
});
