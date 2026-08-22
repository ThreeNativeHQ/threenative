import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "vitest";

import {
  PLAYTEST_PROTOCOL_LIMITS,
  PLAYTEST_PROTOCOL_VERSION,
} from "../../playtest/src/index.js";
import { exitCodeForReport } from "../../playtest/src/runner/cli.js";
import { runDesktopPlaytest } from "../../playtest/src/runner/desktopRunner.js";
import { DeviceBridgeTransport } from "../../playtest/src/runner/deviceTransport.js";
import { connectDevicePlaytestBridge } from "../../playtest/src/three/device.js";

// P2-7 native arm. The committed generated-shooter scenario is registered in the versioned
// conformance registry and executed on the desktop target through the real runner: real mailbox
// transport, real device bridge dispatch, real step engine — the game itself is stubbed at the
// bridge seam because this file proves delivery and registration, not rendering. The full-stack
// desktop execution (C++ host, WebGPU, scaffolded project) is recorded in the verification doc.
//
// Fail closed: remove the registry row and the registration check below rejects with
// "RED observed: native scenario missing"; drop the right-button event from delivery and the
// ordering check rejects with "RED observed: native aim transition missing".

const runtimeRoot = fileURLToPath(new URL("../", import.meta.url));
const registryPath = join(runtimeRoot, "conformance/registry.json");
const PROOF_ID = "generated-shooter-input-control";

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * The registration contract for the generated shooter input proof. Throws with the named red so
 * a deleted or renamed row fails this suite instead of silently unproving the native arm.
 */
export function assertScenarioRegistered(registry = readJson(registryPath)) {
  const proofs = registry.generatedPlaytestProofs;
  if (!Array.isArray(proofs)) {
    throw new Error("RED observed: native scenario missing (no generatedPlaytestProofs section)");
  }
  const entry = proofs.find((candidate) => candidate.id === PROOF_ID);
  if (entry === undefined) {
    throw new Error(`RED observed: native scenario missing (${PROOF_ID} is not registered)`);
  }
  assert.equal(entry.status, "implemented");
  assert.equal(entry.category, "input");
  assert.match(entry.reason ?? "", /a playtest scenario cannot live there/u);
  const scenarioPath = join(runtimeRoot, entry.scenario);
  if (!existsSync(scenarioPath)) {
    throw new Error(`RED observed: native scenario missing (${entry.scenario} does not exist)`);
  }
  const proofPath = join(runtimeRoot, "../..", entry.proof);
  assert.ok(existsSync(proofPath), `proof file must exist: ${entry.proof}`);
  assert.equal(entry.owner, "PRD-P2-7");

  // One scenario for every target: the committed file carries the whole mouse contract and
  // declares web plus desktop, so there is no platform fork to drift.
  const scenario = readJson(scenarioPath);
  assert.equal(scenario.name, "input-control");
  assert.deepEqual(scenario.parity?.targets, ["web", "desktop"]);
  const labeled = new Map(scenario.steps.map((step) => [step.label ?? "", step]));
  assert.equal(scenario.steps[0]?.label, "no-input-control");
  assert.deepEqual(labeled.get("aim-down")?.pointerPosition, { buttons: 2, x: 0.5, y: 0.5 });
  assert.deepEqual(labeled.get("look-right")?.pointerPosition, { x: 0.75, y: 0.5 });
  assert.deepEqual(labeled.get("fire-while-aiming")?.pointerPosition, {
    buttons: 3,
    x: 0.5,
    y: 0.5,
  });
  assert.deepEqual(labeled.get("release-buttons")?.pointerPosition, {
    buttons: 0,
    x: 0.5,
    y: 0.5,
  });
  return { entry, scenario, scenarioPath };
}

test("the conformance registry registers the committed generated shooter input scenario", () => {
  const registered = assertScenarioRegistered();
  assert.ok(registered.scenarioPath.includes("templates/shooter/playtests"));
});

test("negative control: removing the registry row rejects the native proof", () => {
  const registry = readJson(registryPath);
  const mutated = structuredClone(registry);
  mutated.generatedPlaytestProofs = mutated.generatedPlaytestProofs.filter(
    (entry) => entry.id !== PROOF_ID,
  );
  assert.throws(() => assertScenarioRegistered(mutated), /RED observed: native scenario missing/u);
});

/** Minimal fixed-step bridge: enough for the runner to execute every step of the scenario. */
function stubBridge() {
  let tick = 0;
  return {
    advance: async (ticks) => {
      tick += ticks;
      return { clock: { mode: "fixed-step", tick }, ticks };
    },
    describe: () => ({
      capabilities: ["entity.observe", "runtime.diagnostics", "runtime.fixedStep"],
      limits: PLAYTEST_PROTOCOL_LIMITS,
      name: "generated-shooter-input-stub",
      protocolVersion: PLAYTEST_PROTOCOL_VERSION,
    }),
    ready: () => ({ ready: true }),
    sample: () => ({
      clock: { mode: "fixed-step", tick },
      diagnostics: [],
      entities: [],
      resources: {},
    }),
  };
}

class StubNativeDriver {
  constructor(bridge) {
    this.bridge = bridge;
    this.installation = undefined;
    this.stopped = false;
    this.screenshots = [];
  }

  async captureConsole() {
    return [];
  }

  async isAlive() {
    return !this.stopped;
  }

  async prepare(endpoint) {
    this.installation = connectDevicePlaytestBridge(this.bridge, endpoint);
  }

  async screenshot(path) {
    this.screenshots.push(path);
  }

  async stop() {
    this.stopped = true;
    this.installation?.close();
  }
}

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

/**
 * Drives the COMMITTED scenario through the real desktop runner over the real mailbox transport,
 * recording every pointer/keyboard delivery the runner emits toward the native host seam.
 */
async function runCommittedScenarioOnDesktop() {
  const { scenarioPath } = assertScenarioRegistered();
  const projectPath = await mkdtemp(join(tmpdir(), "tn-generated-shooter-"));
  roots.push(projectPath);
  await mkdir(join(projectPath, "artifacts"), { recursive: true });
  const endpoint = `http://127.0.0.1:${await availablePort()}/playtest`;
  const deliveries = [];
  const host = globalThis;
  const previousHost = host.__THREENATIVE_NATIVE__;
  host.__THREENATIVE_NATIVE__ = {
    playtestInput: {
      keyboard: (type, key) => deliveries.push({ kind: "key", key, type }),
      pointer: (type, x, y, buttons) => deliveries.push({ buttons, kind: "pointer", type, x, y }),
    },
  };
  const driver = new StubNativeDriver(stubBridge());
  try {
    const report = await runDesktopPlaytest(
      {
        artifactDirectory: join(projectPath, "artifacts"),
        desktop: { executable: "/stub/generated-shooter-host" },
        endpoint,
        headless: true,
        projectPath,
        scenarioPath,
        target: "desktop",
        timeoutMs: 15_000,
        trace: false,
        url: "http://127.0.0.1:5173",
      },
      { driver, transport: new DeviceBridgeTransport(endpoint) },
    );
    return { deliveries, driver, report };
  } finally {
    if (previousHost === undefined) delete host.__THREENATIVE_NATIVE__;
    else host.__THREENATIVE_NATIVE__ = previousHost;
    driver.stopped = true;
    driver.installation?.close();
  }
}

test("should preserve button order on the native target", async () => {
  const { deliveries, report } = await runCommittedScenarioOnDesktop();
  console.info("DEBUG report:", JSON.stringify({ diagnostics: report.diagnostics, pass: report.pass, assertionResults: report.assertionResults }));

  // The runner owns the down/move/up state machine; these are the exact deliveries its steps
  // must produce for this scenario's mouse contract, in arrival order.
  const pointers = deliveries.filter((delivery) => delivery.kind === "pointer");
  assert.deepEqual(
    pointers.map(({ buttons, type, x }) => ({ buttons, type, x })),
    [
      { buttons: 2, type: "down", x: 640 },   // aim-down: right button press
      { buttons: 2, type: "move", x: 960 },   // look-right: relative move while aiming
      { buttons: 2, type: "move", x: 640 },   // look-back: equal and opposite
      { buttons: 3, type: "move", x: 640 },   // fire-while-aiming: left joins the held right
      { buttons: 0, type: "up", x: 640 },     // release-buttons
      { buttons: 0, type: "up", x: 0 },       // end-of-step release re-send
    ],
    "native delivery must preserve the right-hold -> left-while-held -> release order",
  );
  assert.deepEqual(deliveries.filter(({ kind }) => kind === "key"), []);

  // Negative control: drop the right-button event from delivery and the same proof must reject.
  const withoutAimPress = pointers.filter(
    ({ buttons, type }) => !(type === "down" && buttons === 2),
  );
  const expectedOrder = [
    { buttons: 2, type: "down", x: 640 },
    { buttons: 2, type: "move", x: 960 },
    { buttons: 2, type: "move", x: 640 },
    { buttons: 3, type: "move", x: 640 },
    { buttons: 0, type: "up", x: 640 },
    { buttons: 0, type: "up", x: 0 },
  ];
  const matches = (sequence) =>
    JSON.stringify(sequence.map(({ buttons, type }) => [type, buttons])) ===
    JSON.stringify(expectedOrder.map(({ buttons, type }) => [type, buttons]));
  assert.ok(matches(pointers));
  if (matches(withoutAimPress)) {
    throw new Error("RED observed: native aim transition missing");
  }
});

test("a dead desktop process reports TN_PLAYTEST_DEVICE_FAILED instead of passing", async () => {
  assertScenarioRegistered();
  const projectPath = await mkdtemp(join(tmpdir(), "tn-generated-shooter-dead-"));
  roots.push(projectPath);
  const endpoint = `http://127.0.0.1:${await availablePort()}/playtest`;
  class DeadDriver extends StubNativeDriver {
    async isAlive() {
      return false;
    }
  }
  const driver = new DeadDriver(stubBridge());
  const report = await runDesktopPlaytest(
    {
      artifactDirectory: join(projectPath, "artifacts"),
      desktop: { executable: "/stub/generated-shooter-host" },
      endpoint,
      headless: true,
      projectPath,
      scenarioPath: assertScenarioRegistered().scenarioPath,
      target: "desktop",
      timeoutMs: 15_000,
      trace: false,
      url: "http://127.0.0.1:5173",
    },
    { driver, transport: new DeviceBridgeTransport(endpoint) },
  );
  assert.equal(report.pass, false);
  // Exit 2: the process died before assertions were ever evaluated.
  assert.equal(exitCodeForReport(report), 2);
  const failed = report.diagnostics.find(({ code }) => code === "TN_PLAYTEST_DEVICE_FAILED");
  assert.ok(failed, "an exited device process must be reported, never degraded or skipped");
  assert.match(failed.message, /exited before assertions were evaluated/u);
});
