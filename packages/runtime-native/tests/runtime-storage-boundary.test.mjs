import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

const runtimePath = join(import.meta.dirname, "..", "src", "runtime.cpp");
const runtime = readFileSync(runtimePath, "utf8");

function pausedBranch(source) {
  const start = source.indexOf("if (!config_.noSdl && platform::isPaused())");
  const end = source.indexOf("// Coming back from the background", start);
  assert.ok(start >= 0, "runtime must retain the paused branch");
  assert.ok(end > start, "runtime must retain the resume boundary after the paused branch");
  return source.slice(start, end);
}

function assertPausedStorageFlush(source) {
  const branch = pausedBranch(source);
  const flush = branch.indexOf("localStorage_.flushIfDirty()");
  const timerDrop = branch.indexOf("countAndDropDueTimers()");
  const partialFrameDrop = branch.indexOf("hostGapMeter_.dropPartialFrame()");
  const returnPoint = branch.indexOf("return running_");

  assert.ok(flush >= 0, "the paused path must flush dirty localStorage");
  assert.ok(timerDrop >= 0 && flush > timerDrop, "flush must follow paused event/lifecycle work");
  assert.ok(partialFrameDrop >= 0 && flush < partialFrameDrop,
            "flush must happen before the paused sample is discarded");
  assert.ok(returnPoint > flush, "flush must happen before the paused return");
}

test("paused event boundary flushes storage mutated by input callbacks", () => {
  assertPausedStorageFlush(runtime);

  const branch = pausedBranch(runtime);
  const withoutPausedFlush = runtime.replace(
    branch,
    branch.replace(/localStorage_\.flushIfDirty\(\)\s*;/u, ""),
  );
  assert.notEqual(withoutPausedFlush, runtime, "negative control must remove the paused flush");
  assert.throws(
    () => assertPausedStorageFlush(withoutPausedFlush),
    /paused path must flush dirty localStorage/u,
    "the regression test must fail when the paused flush is removed",
  );
});
