import assert from "node:assert/strict";
import { test } from "vitest";
import { NeuralFrameGate } from "../agent-docs/examples/neural-rendering/frame-gate.js";
import { NeuralResourceScope } from "../agent-docs/examples/neural-rendering/resource-scope.js";

function deferred() {
  let resolve = () => {};
  let reject = (_error: Error) => {};
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function trackedResource() {
  let destroyed = 0;
  return { destroy() { destroyed += 1; }, get destroyed() { return destroyed; } };
}

function begin(gate: NeuralFrameGate, frameId: number) {
  assert.equal(gate.request(frameId), true);
  const ticket = gate.begin(frameId);
  assert.ok(ticket);
  return ticket;
}

test("disabled gate dispatches nothing and allocates no ticket", () => {
  const gate = new NeuralFrameGate();
  assert.equal(gate.request(0), false);
  assert.equal(gate.begin(0), undefined);
  assert.equal(gate.state.inFlight, false);
  assert.equal(gate.state.reason, "disabled");
});

test("coalesces requests without retaining textures; begin requires this rendered frame", () => {
  const gate = new NeuralFrameGate();
  gate.setEnabled(true);
  const first = begin(gate, 1);
  gate.request(2);
  gate.request(3);
  assert.equal(gate.begin(3), undefined);
  assert.equal(gate.state.pendingFrameId, 3);
  assert.equal(gate.complete(first, true), true);
  assert.equal(gate.begin(2), undefined);
  const newest = gate.begin(3);
  assert.ok(newest);
  assert.equal(newest.frameId, 3);
  assert.equal(newest.resetHistory, true);
});

test("uses history only when the completed source frame is exactly the predecessor", () => {
  const gate = new NeuralFrameGate();
  gate.setEnabled(true);
  const first = begin(gate, 20);
  assert.equal(first.resetHistory, true);
  assert.equal(first.historyFrameId, undefined);
  assert.equal(gate.complete(first, true), true);
  const next = begin(gate, 21);
  assert.equal(next.resetHistory, false);
  assert.equal(next.historyFrameId, 20);
  gate.complete(next, true);
  const skipped = begin(gate, 24);
  assert.equal(skipped.resetHistory, true);
  assert.equal(skipped.historyFrameId, undefined);
});

for (const reason of ["camera-cut", "scene-change", "projection-change", "resize", "scale-change", "provider-change", "model-change", "conditioning-change", "device-recovered"] as const) {
  test(`${reason} rejects late results and preserves the new generation's pending request`, () => {
    const gate = new NeuralFrameGate();
    gate.setEnabled(true);
    const stale = begin(gate, 4);
    gate.reset(reason);
    assert.equal(gate.state.inFlight, true);
    assert.equal(gate.state.reason, reason);
    gate.request(5);
    assert.equal(gate.begin(5), undefined);
    assert.equal(gate.complete(stale, true), false);
    assert.equal(gate.state.publishedFrameId, undefined);
    const current = gate.begin(5);
    assert.ok(current);
    assert.ok(current.generation > stale.generation);
    assert.equal(current.resetHistory, true);
    assert.equal(gate.complete(current, true), true);
    assert.equal(gate.state.publishedFrameId, 5);
  });
}

test("disabling and re-enabling does not pretend submitted GPU work was cancelled", () => {
  const gate = new NeuralFrameGate();
  gate.setEnabled(true);
  const stale = begin(gate, 1);
  gate.setEnabled(false);
  assert.equal(gate.state.inFlight, true);
  assert.equal(gate.request(2), false);
  gate.setEnabled(true);
  gate.request(3);
  assert.equal(gate.begin(3), undefined);
  assert.equal(gate.complete(stale, true), false);
  assert.ok(gate.begin(3));
});

test("device loss disables scheduling; only the renderer may recover its device", () => {
  const gate = new NeuralFrameGate();
  gate.setEnabled(true);
  const stale = begin(gate, 1);
  gate.deviceLost();
  assert.equal(gate.state.enabled, false);
  assert.equal(gate.state.reason, "device-lost");
  assert.equal(gate.state.inFlight, true);
  assert.equal(gate.complete(stale, true), false);
  assert.equal(gate.request(2), false);
});

test("provider failure clears history and pending work instead of retrying forever", () => {
  const gate = new NeuralFrameGate();
  gate.setEnabled(true);
  const first = begin(gate, 1);
  gate.complete(first, true);
  const failed = begin(gate, 2);
  gate.request(3);
  assert.equal(gate.complete(failed, false), false);
  assert.equal(gate.state.enabled, false);
  assert.equal(gate.state.reason, "provider-error");
  assert.equal(gate.state.publishedFrameId, undefined);
  assert.equal(gate.state.pendingFrameId, undefined);
});

test("a forged or duplicate completion cannot unlock another in-flight ticket", () => {
  const gate = new NeuralFrameGate();
  gate.setEnabled(true);
  const first = begin(gate, 1);
  assert.equal(gate.complete({ ...first }, true), false);
  assert.equal(gate.state.inFlight, true);
  assert.equal(gate.complete(first, true), true);
  const second = begin(gate, 2);
  assert.equal(gate.complete(first, true), false);
  assert.equal(gate.state.inFlight, true);
  assert.equal(gate.complete(second, true), true);
});

test("ignores repeated/backward requests and makes tickets immutable", () => {
  const gate = new NeuralFrameGate();
  gate.setEnabled(true);
  const ticket = begin(gate, 5);
  assert.equal(gate.request(5), false);
  assert.equal(gate.request(4), false);
  assert.ok(Object.isFrozen(ticket));
  assert.throws(() => Object.assign(ticket, { frameId: 9 }));
  gate.complete(ticket, true);
  gate.reset("scene-change");
  assert.ok(begin(gate, 0));
});

for (const id of [-1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test(`rejects invalid frame identity ${id}`, () => {
    const gate = new NeuralFrameGate();
    gate.setEnabled(true);
    assert.throws(() => gate.request(id), /FRAME/);
    assert.throws(() => gate.begin(id), /FRAME/);
  });
}

test("cleanup preserves supplied device, queue, input, and shared model independently", async () => {
  const device = trackedResource();
  const queue = trackedResource();
  const input = trackedResource();
  const sharedModel = trackedResource();
  const ownedModel = trackedResource();
  const output = trackedResource();
  const scope = new NeuralResourceScope([device, queue, sharedModel]);
  scope.borrow(input);
  scope.own(ownedModel);
  scope.own(output);
  const fence = deferred();
  const retirement = scope.retireAfter(fence.promise);
  assert.equal(ownedModel.destroyed, 0);
  assert.equal(output.destroyed, 0);
  assert.throws(() => scope.own(trackedResource()), /CLOSED/);
  fence.resolve();
  await retirement;
  assert.equal(ownedModel.destroyed, 1);
  assert.equal(output.destroyed, 1);
  for (const borrowed of [device, queue, input, sharedModel]) assert.equal(borrowed.destroyed, 0);
});

test("owned-model/borrowed-device combination cannot take ownership of renderer resources", async () => {
  const device = trackedResource();
  const model = trackedResource();
  const scope = new NeuralResourceScope([device]);
  assert.throws(() => scope.own(device), /OWNERSHIP/);
  scope.own(model);
  assert.throws(() => scope.borrow(model), /OWNERSHIP/);
  await scope.retireAfter(Promise.resolve());
  assert.equal(device.destroyed, 0);
  assert.equal(model.destroyed, 1);
});

test("duplicate registration and repeated retirement never double-destroy an allocation", async () => {
  const owned = trackedResource();
  const scope = new NeuralResourceScope([]);
  assert.equal(scope.own(owned), owned);
  scope.own(owned);
  const fence = deferred();
  const first = scope.retireAfter(fence.promise);
  assert.equal(scope.retireAfter(Promise.resolve()), first);
  fence.resolve();
  await first;
  await scope.retireAfter(Promise.resolve());
  assert.equal(owned.destroyed, 1);
});

test("a rejected fence is not GPU retirement; preserve allocations until a safe fence resolves", async () => {
  const owned = trackedResource();
  const scope = new NeuralResourceScope([]);
  scope.own(owned);
  const fence = deferred();
  const retirement = scope.retireAfter(fence.promise);
  const rejected = assert.rejects(retirement, /queue not retired/);
  fence.reject(new Error("queue not retired"));
  await rejected;
  assert.equal(owned.destroyed, 0);
  assert.throws(() => scope.own(trackedResource()), /CLOSED/);
  await scope.retireAfter(Promise.resolve());
  assert.equal(owned.destroyed, 1);
});

test("one failing cleanup does not leak other allocations or repeat a destructive call", async () => {
  let attempts = 0;
  const broken = { destroy() { attempts += 1; throw new Error("cleanup failed"); } };
  const other = trackedResource();
  const scope = new NeuralResourceScope([]);
  scope.own(broken);
  scope.own(other);
  await assert.rejects(scope.retireAfter(Promise.resolve()), AggregateError);
  assert.equal(attempts, 1);
  assert.equal(other.destroyed, 1);
  await assert.rejects(scope.retireAfter(Promise.resolve()), AggregateError);
  assert.equal(attempts, 1);
});

test("invalid frame identity invalidates published history without freeing an active job", () => {
  const gate = new NeuralFrameGate();
  gate.setEnabled(true);
  const first = begin(gate, 1);
  gate.complete(first, true);
  const active = begin(gate, 2);
  assert.throws(() => gate.request(Number.NaN), /FRAME/);
  assert.equal(gate.state.publishedFrameId, undefined);
  assert.equal(gate.state.reason, "invalid-frame");
  assert.equal(gate.state.inFlight, true);
  assert.equal(gate.complete(active, true), false);
  assert.equal(begin(gate, 3).resetHistory, true);
});

test("setting the already-active mode does not discard its pending request or history", () => {
  const gate = new NeuralFrameGate();
  gate.setEnabled(true);
  gate.request(1);
  const generation = gate.state.generation;
  gate.setEnabled(true);
  assert.equal(gate.state.generation, generation);
  assert.ok(gate.begin(1));
});
