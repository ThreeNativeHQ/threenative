import assert from "node:assert/strict";
import { test } from "vitest";
import { NeuralSnapshotDriver } from "../agent-docs/examples/neural-rendering/snapshot-driver.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const completed = deferred();
  const retired = deferred();
  const log: string[] = [];
  const device = {};
  const bridge = { device, submit(encode: (encoder: unknown) => void) {
    encode({}); log.push("submit"); return { completed: completed.promise, retired: retired.promise };
  }, retire() { log.push("final fence"); return Promise.resolve(); } };
  const provider = { device, width: 32, height: 16, kind: "fixture" as const,
    id: "fixture", estimatedBytes: 0, encode() { log.push("provider"); }, dispose() {} };
  const driver = new NeuralSnapshotDriver(bridge as never, provider as never, 8192);
  const capture = () => { log.push("capture"); return { original: {}, enhanced: {} }; };
  return { log, device, bridge, provider, driver, capture, completed, retired };
}

test("an ordinary disabled draw does not capture, allocate, or dispatch", () => {
  const f = fixture();
  f.driver.afterWorld(1, f.capture as never);
  assert.deepEqual(f.log, [] as string[]);
  assert.equal(f.driver.state.status, "disabled");
});

test("queues GPU capture before provider work and only publishes a completed matched frame", async () => {
  const f = fixture();
  f.driver.enable(); f.driver.request();
  f.log.push("world");
  f.driver.afterWorld(8, f.capture as never);
  assert.deepEqual(f.log, ["world", "capture", "provider", "submit"]);
  assert.equal(f.driver.state.frameId, undefined);
  f.completed.resolve();
  await Promise.resolve();
  assert.equal(f.driver.state.frameId, undefined);
  f.retired.resolve();
  await f.driver.settled;
  assert.equal(f.driver.state.frameId, 8);
  assert.equal(f.driver.state.frozen, true);
  assert.equal(f.driver.state.kind, "fixture");
});

test("one in-flight capture is retained intact; newer requests coalesce", async () => {
  const f = fixture();
  f.driver.enable(); f.driver.request();
  f.driver.afterWorld(1, f.capture as never);
  f.driver.request(); f.driver.request();
  f.driver.afterWorld(2, f.capture as never);
  assert.equal(f.log.filter((v) => v === "capture").length, 1);
  f.completed.resolve(); f.retired.resolve(); await f.driver.settled;
  assert.equal(f.driver.state.frameId, undefined);
  f.driver.afterWorld(3, f.capture as never);
  await f.driver.settled;
  assert.equal(f.driver.state.frameId, 3);
  assert.equal(f.log.filter((v) => v === "capture").length, 2);
});

test("resize invalidates an in-flight generation and cannot publish an old result", async () => {
  const f = fixture();
  f.driver.enable(); f.driver.request();
  f.driver.afterWorld(1, f.capture as never);
  f.driver.reset("resize");
  f.completed.resolve(); f.retired.resolve(); await f.driver.settled;
  assert.equal(f.driver.state.frameId, undefined);
  assert.equal(f.driver.state.frozen, false);
});

test("provider errors become visible original-path fallback, never a successful capture", async () => {
  const f = fixture();
  f.driver.enable(); f.driver.request();
  f.driver.afterWorld(1, f.capture as never);
  f.completed.reject(new Error("WGSL rejected"));
  await Promise.resolve(); await Promise.resolve();
  assert.match(f.driver.state.error ?? "", /WGSL rejected/);
  f.retired.resolve(); await f.driver.settled;
  assert.equal(f.driver.state.status, "error");
  assert.equal(f.driver.state.frameId, undefined);
  f.driver.afterWorld(2, f.capture as never);
  assert.equal(f.log.filter((v) => v === "capture").length, 1);
});

test("stop invalidates publication but waits for compute and subsequent display work", async () => {
  const f = fixture();
  f.driver.enable(); f.driver.request();
  f.driver.afterWorld(1, f.capture as never);
  let stopped = false;
  const stop = f.driver.stop().then(() => { stopped = true; });
  assert.equal(f.driver.state.status, "disabled");
  assert.equal(stopped, false);
  f.completed.resolve(); f.retired.resolve(); await stop;
  assert.equal(stopped, true);
  assert.equal(f.driver.state.frameId, undefined);
  assert.equal(f.log.at(-1), "final fence");
  assert.throws(() => f.driver.enable(), /CLOSED/);
});

test("rejects foreign providers and total memory above the explicit cap before capture", () => {
  const f = fixture();
  assert.throws(() => new NeuralSnapshotDriver(f.bridge as never,
    { ...f.provider, device: {} } as never, 8192), /DEVICE/);
  assert.throws(() => new NeuralSnapshotDriver(f.bridge as never, f.provider as never, 8191), /BUDGET/);
  for (const width of [0, 1.5, 513, Number.NaN]) {
    assert.throws(() => new NeuralSnapshotDriver(f.bridge as never,
      { ...f.provider, width } as never, 1_000_000), /DIMENSION/);
  }
});

test("an asynchronous provider cannot publish before it has encoded its graph", async () => {
  const f = fixture();
  f.provider.encode = async () => {};
  f.driver.enable(); f.driver.request();
  f.driver.afterWorld(1, f.capture as never);
  // A rejected encoding uses the bridge's safe graphics fence, not the abandoned mock job.
  f.completed.resolve(); f.retired.resolve();
  await f.driver.settled;
  assert.match(f.driver.state.error ?? "", /SYNCHRONOUS/);
  assert.equal(f.driver.state.frameId, undefined);
});
