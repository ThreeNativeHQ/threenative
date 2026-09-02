import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

const runtimePath = join(import.meta.dirname, "..", "src", "runtime.cpp");
const runtime = readFileSync(runtimePath, "utf8");

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const open = source.indexOf("{", start);
  assert.ok(open > start, `missing body for ${signature}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  assert.fail(`unterminated body for ${signature}`);
}

function pausedBranch(source) {
  const start = source.indexOf("if (!config_.noSdl && platform::isPaused())");
  const end = source.indexOf("// Coming back from the background", start);
  assert.ok(start >= 0, "runtime must retain the paused branch");
  assert.ok(end > start, "runtime must retain the resume boundary after the paused branch");
  return source.slice(start, end);
}

function startupExitBranch(source) {
  const marker = source.indexOf("// Check if script already called process.exit() during loading");
  const start = source.indexOf("if (!running_)", marker);
  const end = source.indexOf('std::cout << "[Mystral] Starting main loop...', start);
  assert.ok(marker >= 0, "runtime must retain the startup process.exit check");
  assert.ok(start > marker, "startup process.exit check must follow its marker");
  assert.ok(end > start, "startup process.exit check must end before the main loop starts");
  return source.slice(start, end);
}

function assertStartupExitFlush(source) {
  const branch = startupExitBranch(source);
  const flush = branch.indexOf("localStorage_.flushIfDirty()");
  const returnPoint = branch.indexOf("return;");

  assert.ok(flush >= 0, "startup process.exit must flush dirty localStorage");
  assert.ok(returnPoint > flush, "startup process.exit must flush before run() returns");
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

function assertFrameStorageFlush(source) {
  const body = functionBody(source, "bool pollEvents() override");
  const storageBegin = body.lastIndexOf("hostGapMeter_.begin(HostGapMeter::kStorage)");
  const flush = body.indexOf("localStorage_.flushIfDirty()", storageBegin);
  const storageEnd = body.indexOf("hostGapMeter_.end(HostGapMeter::kStorage)", flush);
  const closeFrame = body.lastIndexOf("hostGapMeter_.closeFrame()");

  assert.ok(storageBegin >= 0, "frame storage flush must begin a host-gap storage segment");
  assert.ok(flush > storageBegin, "the storage flush must run inside its host-gap segment");
  assert.ok(storageEnd > flush, "the storage segment must end after the flush");
  assert.ok(closeFrame > storageEnd, "storage must be recorded before closeFrame()");
}

test("top-level localStorage writes survive process.exit before the main loop returns", () => {
  assertStartupExitFlush(runtime);

  const branch = startupExitBranch(runtime);
  const withoutStartupFlush = runtime.replace(
    branch,
    branch.replace(/localStorage_\.flushIfDirty\(\)\s*;/u, ""),
  );
  assert.notEqual(withoutStartupFlush, runtime, "negative control must remove the startup flush");
  assert.throws(
    () => assertStartupExitFlush(withoutStartupFlush),
    /startup process\.exit must flush dirty localStorage/u,
    "the regression test must fail when the startup flush is removed",
  );
});

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

test("frame storage flush is included before host-gap sample closure", () => {
  assertFrameStorageFlush(runtime);

  const withoutStorageSegment = runtime.replace(
    /\s*hostGapMeter_\.begin\(HostGapMeter::kStorage\);[\s\S]*?hostGapMeter_\.end\(HostGapMeter::kStorage\);/u,
    "\n        localStorage_.flushIfDirty();",
  );
  assert.notEqual(withoutStorageSegment, runtime, "negative control must remove the storage segment");
  assert.throws(
    () => assertFrameStorageFlush(withoutStorageSegment),
    /frame storage flush must begin a host-gap storage segment/u,
    "the regression test must fail when storage is moved outside its segment",
  );
});
