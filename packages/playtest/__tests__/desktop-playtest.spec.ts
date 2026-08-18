import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { PNG } from "pngjs";
import { expect, test } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";

import {
  PLAYTEST_PROTOCOL_LIMITS,
  PLAYTEST_PROTOCOL_VERSION,
  type IPlaytestBridgeV1,
} from "../src/index.js";
import { assertCaptureNotBlank } from "../src/capture.js";
import { exitCodeForReport, runConfiguredPlaytest } from "../src/runner/cli.js";
import { parseStandalonePlaytestArgs, type IStandalonePlaytestConfig } from "../src/runner/config.js";
import { DesktopPlaytestDriver, LocalDeviceMailbox } from "../src/runner/desktop.js";
import { runDesktopPlaytest } from "../src/runner/desktopRunner.js";
import { DeviceBridgeTransport } from "../src/runner/deviceTransport.js";
import type { IDevicePlaytestDriver } from "../src/runner/androidRunner.js";
import { connectDevicePlaytestBridge, type IDeviceBridgeInstallation } from "../src/three/device.js";

test("desktop CLI parsing requires and resolves the native executable", () => {
  const config = parseStandalonePlaytestArgs([
    "scenario.json",
    "--project",
    "/project",
    "--target",
    "desktop",
    "--executable",
    ".threenative/build/game",
  ]);

  expect(config.target).toBe("desktop");
  expect(config.desktop).toEqual({ executable: "/project/.threenative/build/game" });
  expect(() => parseStandalonePlaytestArgs(["scenario.json", "--target", "desktop"], "/project"))
    .toThrow("Desktop playtest requires --executable");
});

test("desktop CLI routing selects the shared desktop runner", async () => {
  const calls: string[] = [];
  const report = { pass: true } as never;
  const config = minimalConfig("desktop");
  await expect(runConfiguredPlaytest(config, {
    android: async () => { calls.push("android"); return report; },
    browser: async () => { calls.push("browser"); return report; },
    desktop: async (received) => { calls.push(received.desktop?.executable ?? "missing"); return report; },
    ios: async () => { calls.push("ios"); return report; },
  })).resolves.toBe(report);
  expect(calls).toEqual(["/native/game"]);
});

test.skipIf(process.platform === "win32")("desktop process and mailbox lifecycle leaves no child behind", async () => {
  const root = await makeTempDir("playtest-desktop-driver-");
  const executable = join(root, "native-test.mjs");
  const response = join(root, "tn-playtest-response.json");
  await writeFile(executable, `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(process.env.TN_PLAYTEST_MAILBOX_ROOT, "tn-playtest-response.json"), JSON.stringify({ id: "ready", result: null }));
setInterval(() => {}, 1000);
`);
  await chmod(executable, 0o755);
  const driver = new DesktopPlaytestDriver({ executable, mailboxRoot: root });
  const mailbox = new LocalDeviceMailbox();
  try {
    await mailbox.write(join(root, "probe.txt"), "atomic");
    expect(await mailbox.read(join(root, "probe.txt"))).toBe("atomic");
    await driver.prepare("unused");
    await waitForFile(response);
    expect(JSON.parse(await readFile(response, "utf8"))).toEqual({ id: "ready", result: null });
    expect(await driver.isAlive()).toBe(true);
  } finally {
    await driver.stop();
    expect(await driver.isAlive()).toBe(false);
    await rm(root, { force: true, recursive: true });
  }
});

test.skipIf(process.platform === "win32")("desktop runner drives a real local mailbox process through shared evaluation", async () => {
  const projectPath = await makeTempDir("playtest-desktop-mailbox-");
  const mailboxRoot = join(projectPath, "mailbox");
  const artifactDirectory = join(projectPath, "artifacts");
  const executable = join(projectPath, "native-mailbox.mjs");
  const scenarioPath = join(projectPath, "scenario.json");
  await writeFile(scenarioPath, JSON.stringify({
    artifacts: { screenshots: "after" },
    assert: { movement: { entity: "player", minDistance: 2 } },
    name: "desktop-local-mailbox",
    schemaVersion: 1,
    steps: [{ holdFrames: 3, press: "KeyW", release: true }],
    subject: "player",
    target: "desktop",
    viewport: { height: 360, width: 640 },
    warmupFrames: 0,
  }));
  await writeDesktopMailboxExecutable(executable);
  try {
    const report = await runDesktopPlaytest({
      artifactDirectory,
      desktop: { executable },
      endpoint: "http://127.0.0.1:41777/playtest",
      headless: true,
      projectPath,
      scenarioPath,
      target: "desktop",
      timeoutMs: 1_000,
      trace: false,
      url: "http://127.0.0.1:5173",
    }, { mailboxRoot });

    expect(report.pass).toBe(true);
    expect(report.runtime).toBe("native");
    expect(report.target).toBe("desktop");
    expect(report.assertionResults).toContainEqual(expect.objectContaining({ id: "movement.distance", pass: true }));
    expect(await readFile(join(mailboxRoot, "desktop-fixture-input.txt"), "utf8")).toBe("KeyW");
    const afterPath = join(artifactDirectory, "after.png");
    const after = assertCaptureNotBlank(await readFile(afterPath), afterPath);
    expect(after.distinctColors).toBeGreaterThanOrEqual(8);
    await expect(readFile(join(mailboxRoot, "tn-playtest-screenshot-request.txt"))).rejects.toThrow();
    await expect(readFile(join(mailboxRoot, "tn-playtest-screenshot-request.txt.tmp"))).rejects.toThrow();
    await expect(readFile(join(mailboxRoot, "tn-playtest-request.json"))).rejects.toThrow();
    await expect(readFile(join(mailboxRoot, "tn-playtest-response.json"))).rejects.toThrow();
  } finally {
    await rm(projectPath, { force: true, recursive: true });
  }
});

test.skipIf(process.platform === "win32")("desktop screenshot clears stale and served mailbox requests", async () => {
  const root = await makeTempDir("playtest-desktop-screenshot-");
  const executable = join(root, "native-screenshot.mjs");
  const screenshotPath = join(root, "capture.png");
  const requestPath = join(root, "tn-playtest-screenshot-request.txt");
  await writeFile(requestPath, join(root, "stale-capture.png"));
  await writeFile(`${requestPath}.tmp`, "stale temporary request");
  await writeDesktopMailboxExecutable(executable);
  const driver = new DesktopPlaytestDriver({ executable, mailboxRoot: root });
  try {
    await driver.prepare("unused");
    await waitForFile(join(root, "desktop-fixture-startup.json"));
    const startup = JSON.parse(await readFile(join(root, "desktop-fixture-startup.json"), "utf8"));
    expect(startup).toEqual({ screenshotRequest: false, screenshotRequestTemp: false });

    await driver.screenshot(screenshotPath);
    const stats = assertCaptureNotBlank(await readFile(screenshotPath), screenshotPath);
    expect(stats.distinctColors).toBeGreaterThanOrEqual(8);
    await expect(readFile(requestPath)).rejects.toThrow();
    await expect(readFile(`${requestPath}.tmp`)).rejects.toThrow();
  } finally {
    await driver.stop();
    await rm(root, { force: true, recursive: true });
  }
});

test.skipIf(process.platform === "win32")("desktop prepare surfaces stale screenshot cleanup failures", async () => {
  const root = await makeTempDir("playtest-desktop-cleanup-");
  await mkdir(join(root, "tn-playtest-screenshot-request.txt"));
  const driver = new DesktopPlaytestDriver({ executable: process.execPath, mailboxRoot: root });
  try {
    await expect(driver.prepare("unused")).rejects.toThrow(/EISDIR|is a directory/u);
    expect(await driver.isAlive()).toBe(false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("desktop playtest reuses the device evaluator for positive and negative assertions", async () => {
  const passingRun = await runDesktopScenario(2);
  expect(passingRun.driver.stopped).toBe(true);
  const passing = passingRun.report;
  expect(passing.pass).toBe(true);
  expect(passing.runtime).toBe("native");
  expect(passing.target).toBe("desktop");
  expect(exitCodeForReport(passing)).toBe(0);

  const failingRun = await runDesktopScenario(4);
  expect(failingRun.driver.stopped).toBe(true);
  const failing = failingRun.report;
  expect(failing.pass).toBe(false);
  expect(failing.assertionResults).toContainEqual(expect.objectContaining({ id: "movement.distance", pass: false }));
  expect(exitCodeForReport(failing)).toBe(1);
});

test("desktop playtest surfaces a driver cleanup failure", async () => {
  await expect(runDesktopScenario(2, { stopError: new Error("desktop stop failed") }))
    .rejects.toThrow("desktop stop failed");
});

test.skipIf(process.platform === "win32")("desktop runner surfaces mailbox cleanup failures", async () => {
  await expect(runDesktopScenario(2, { mailboxFile: true })).rejects.toThrow(/ENOTDIR|not a directory/u);
});

test("desktop signal before startup prevents driver preparation", async () => {
  let driver: FakeDesktopDriver | undefined;
  const run = runDesktopScenario(2, {
    onDriver: (created) => { driver = created; },
    signalBeforeStart: true,
  });
  await expect(run).rejects.toThrow("Desktop playtest interrupted by signal.");
  expect(driver?.prepareCalls).toBe(0);
  expect(driver?.stopped).toBe(true);
});

test("desktop signal during preparation stops before bridge evaluation continues", async () => {
  let driver: FakeDesktopDriver | undefined;
  const run = runDesktopScenario(2, {
    onDriver: (created) => { driver = created; },
    onPrepare: () => { process.emit("SIGTERM"); },
  });
  await expect(run).rejects.toThrow("Desktop playtest interrupted by signal.");
  expect(driver?.prepareCalls).toBe(1);
  expect(driver?.stopped).toBe(true);
});

test.skipIf(process.platform === "win32")("desktop screenshot timeout fails closed", async () => {
  const root = await makeTempDir("playtest-desktop-screenshot-");
  const executable = join(root, "native-test.mjs");
  await writeFile(executable, "#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n");
  await chmod(executable, 0o755);
  const driver = new DesktopPlaytestDriver({ executable, mailboxRoot: root, screenshotTimeoutMs: 20 });
  try {
    await driver.prepare("unused");
    await expect(driver.screenshot(join(root, "capture.png")))
      .rejects.toThrow("TN_PLAYTEST_NATIVE_SCREENSHOT_UNAVAILABLE");
  } finally {
    await driver.stop();
    await rm(root, { force: true, recursive: true });
  }
});

interface IDesktopScenarioOptions {
  mailboxFile?: boolean;
  onDriver?: (driver: FakeDesktopDriver) => void;
  onPrepare?: () => void;
  signalBeforeStart?: boolean;
  stopError?: Error;
}

async function runDesktopScenario(minDistance: number, options: IDesktopScenarioOptions = {}) {
  const projectPath = await makeTempDir("playtest-desktop-scenario-");
  const scenarioPath = join(projectPath, "scenario.json");
  await writeFile(scenarioPath, JSON.stringify({
    artifacts: { screenshots: false },
    assert: { movement: { entity: "player", minDistance } },
    name: "desktop-cross-target-scenario",
    schemaVersion: 1,
    steps: [{ holdFrames: 3, press: "KeyW", release: true }],
    subject: "player",
    target: "desktop",
    viewport: { height: 360, width: 640 },
    warmupFrames: 0,
  }));
  const endpoint = `http://127.0.0.1:${await availablePort()}/playtest`;
  const moving = movingBridge();
  const driver = new FakeDesktopDriver(moving.bridge, options.stopError, options.onPrepare);
  options.onDriver?.(driver);
  const mailboxRoot = options.mailboxFile ? join(projectPath, "mailbox-root-file") : undefined;
  if (mailboxRoot !== undefined) await writeFile(mailboxRoot, "not a directory");
  const host = globalThis as typeof globalThis & {
    __THREENATIVE_NATIVE__?: { playtestInput: { keyboard(type: string): void; pointer(): void } };
  };
  const previous = host.__THREENATIVE_NATIVE__;
  host.__THREENATIVE_NATIVE__ = {
    playtestInput: {
      keyboard: (type) => moving.setHeld(type === "keydown"),
      pointer: () => undefined,
    },
  };
  try {
    if (options.signalBeforeStart) queueMicrotask(() => process.emit("SIGINT"));
    const report = await runDesktopPlaytest({
      artifactDirectory: join(projectPath, "artifacts"),
      desktop: { executable: "/fake/native-game" },
      endpoint,
      headless: true,
      projectPath,
      scenarioPath,
      target: "desktop",
      timeoutMs: 1_000,
      trace: false,
      url: "http://127.0.0.1:5173",
    }, {
      driver,
      transport: new DeviceBridgeTransport(endpoint),
      ...(mailboxRoot === undefined ? {} : { mailboxRoot }),
    });
    return { driver, report };
  } finally {
    if (previous === undefined) delete host.__THREENATIVE_NATIVE__;
    else host.__THREENATIVE_NATIVE__ = previous;
    await rm(projectPath, { force: true, recursive: true });
  }
}

class FakeDesktopDriver implements IDevicePlaytestDriver {
  private installation?: IDeviceBridgeInstallation;
  prepareCalls = 0;
  stopped = false;

  constructor(
    private readonly bridge: IPlaytestBridgeV1,
    private readonly stopError?: Error,
    private readonly onPrepare?: () => void,
  ) {}

  async captureConsole() { return []; }
  async isAlive() { return !this.stopped; }
  async prepare(endpoint: string) {
    this.prepareCalls += 1;
    this.installation = connectDevicePlaytestBridge(this.bridge, endpoint);
    this.onPrepare?.();
  }
  async screenshot() {}
  async stop() {
    this.stopped = true;
    try {
      if (this.stopError !== undefined) throw this.stopError;
    } finally {
      this.installation?.close();
    }
  }
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
        capabilities: ["entity.observe", "runtime.diagnostics", "runtime.fixedStep"],
        limits: PLAYTEST_PROTOCOL_LIMITS,
        name: "desktop-test",
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
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await readFile(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function writeDesktopMailboxExecutable(path: string): Promise<void> {
  const screenshot = nonBlankPngBase64();
  await writeFile(path, `#!/usr/bin/env node
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.TN_PLAYTEST_MAILBOX_ROOT;
if (typeof root !== "string") process.exit(2);
const requestPath = join(root, "tn-playtest-request.json");
const responsePath = join(root, "tn-playtest-response.json");
const screenshotRequestPath = join(root, "tn-playtest-screenshot-request.txt");
const screenshotBytes = Buffer.from(${JSON.stringify(screenshot)}, "base64");
let held = false;
let x = 0;
let tick = 0;

function writeAtomic(path, contents) {
  const temporary = path + ".tmp";
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}

function respond(response) {
  writeAtomic(responsePath, JSON.stringify(response));
}

writeFileSync(join(root, "desktop-fixture-startup.json"), JSON.stringify({
  screenshotRequest: existsSync(screenshotRequestPath),
  screenshotRequestTemp: existsSync(screenshotRequestPath + ".tmp"),
}));
respond({ id: "ready", result: null });

function poll() {
  if (existsSync(screenshotRequestPath)) {
    const target = readFileSync(screenshotRequestPath, "utf8");
    unlinkSync(screenshotRequestPath);
    writeFileSync(target, screenshotBytes);
  }
  if (!existsSync(requestPath)) return;
  const request = JSON.parse(readFileSync(requestPath, "utf8"));
  unlinkSync(requestPath);
  let result = null;
  if (request.method === "describe") {
    result = {
      capabilities: ["entity.observe", "runtime.diagnostics", "runtime.fixedStep"],
      limits: { maxEntitiesPerSample: 100, maxEventsPerDrain: 1000, maxPayloadBytes: 1000000, operationTimeoutMs: 5000 },
      name: "desktop-mailbox-fixture",
      protocolVersion: 1,
    };
  } else if (request.method === "ready") {
    result = { ready: true };
  } else if (request.method === "advance") {
    tick += request.argument;
    if (held) x += request.argument;
    result = { clock: { mode: "fixed-step", tick }, ticks: request.argument };
  } else if (request.method === "sample") {
    result = {
      clock: { mode: "fixed-step", tick },
      diagnostics: [],
      entities: [{ id: "player", transform: { position: [x, 0, 0] }, visible: true }],
      resources: {},
    };
  } else if (request.method === "input.keyDown") {
    held = true;
    writeFileSync(join(root, "desktop-fixture-input.txt"), request.argument.key);
  } else if (request.method === "input.keyUp") {
    held = false;
  }
  respond({ id: request.id, result });
}

setInterval(poll, 5);
`);
  await chmod(path, 0o755);
}

function nonBlankPngBase64(): string {
  const png = new PNG({ height: 4, width: 4 });
  const colors = [
    [255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255],
    [255, 0, 255, 255], [0, 255, 255, 255], [255, 255, 255, 255], [128, 64, 32, 255],
    [32, 64, 128, 255], [64, 128, 32, 255], [192, 32, 64, 255], [32, 192, 64, 255],
    [64, 32, 192, 255], [192, 128, 32, 255], [32, 192, 128, 255], [128, 32, 192, 255],
  ] as const;
  colors.forEach(([red, green, blue, alpha], index) => {
    const offset = index * 4;
    png.data[offset] = red;
    png.data[offset + 1] = green;
    png.data[offset + 2] = blue;
    png.data[offset + 3] = alpha;
  });
  return PNG.sync.write(png).toString("base64");
}

function minimalConfig(target: "android" | "browser" | "desktop" | "ios"): IStandalonePlaytestConfig {
  return {
    artifactDirectory: "/artifacts",
    desktop: target === "desktop" ? { executable: "/native/game" } : undefined,
    headless: true,
    projectPath: "/project",
    scenarioPath: "scenario.json",
    target,
    timeoutMs: 1_000,
    trace: false,
    url: "http://127.0.0.1:5173",
  };
}
