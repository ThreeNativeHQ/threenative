import assert from "node:assert/strict";
import { test } from "vitest";
import { afterRenderedPass } from "../agent-docs/examples/neural-rendering/render-hook.js";

test("runs the observer only after the original pass and preserves its receiver and return", () => {
  const log: string[] = [];
  const frame = {};
  const pass = { updateBefore(value: object) { assert.equal(this, pass); assert.equal(value, frame); log.push("world"); return 7; } };
  const original = pass.updateBefore;
  const detach = afterRenderedPass(pass, (value) => { assert.equal(value, frame); log.push("capture"); });
  assert.equal(pass.updateBefore(frame), 7);
  assert.deepEqual(log, ["world", "capture"]);
  detach(); assert.equal(pass.updateBefore, original);
  pass.updateBefore(frame); assert.deepEqual(log, ["world", "capture", "world"]);
});

test("does not capture a failed or skipped world render", () => {
  let observed = 0;
  const pass = { updateBefore(_frame: object): unknown { throw new Error("world failed"); } };
  afterRenderedPass(pass, () => { observed += 1; });
  assert.throws(() => pass.updateBefore({}), /world failed/);
  const skipped = { updateBefore(_frame: object) { return false; } };
  afterRenderedPass(skipped, () => { observed += 1; });
  skipped.updateBefore({}); assert.equal(observed, 0);
});

test("detachment does not clobber a later wrapper but deactivates the retained observer", () => {
  let observed = 0;
  const pass = { updateBefore(_frame: object) {} };
  const detach = afterRenderedPass(pass, () => { observed += 1; });
  const ours = pass.updateBefore;
  const later = (frame: object) => ours.call(pass, frame);
  pass.updateBefore = later;
  detach(); detach();
  assert.equal(pass.updateBefore, later);
  pass.updateBefore({}); assert.equal(observed, 0);
});

test("refuses asynchronous world hooks instead of capturing before their rendering", async () => {
  let observed = 0;
  const pass = { async updateBefore(_frame: object) { await Promise.resolve(); } };
  afterRenderedPass(pass, () => { observed += 1; });
  assert.throws(() => pass.updateBefore({}), /SYNCHRONOUS/);
  await Promise.resolve(); assert.equal(observed, 0);
});
