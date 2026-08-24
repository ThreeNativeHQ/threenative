import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

function collectJsVisibleRegistrations(source) {
  return new Set([
    ...[...source.matchAll(/\{"(?:WebGPU|GPUCanvasContext)",\s*"([^"]+)"/gu)].map(
      (match) => match[1],
    ),
    ...[...source.matchAll(/newFunction\(\s*"([^"]+)"/gu)].map((match) => match[1]),
  ]);
}

function assertCallTrace(trace, side) {
  assert.ok(Array.isArray(trace), `${side} trace must be an array`);
  assert.ok(trace.length >= 30, `${side} trace must cover representative migrated calls`);
  for (const [index, entry] of trace.entries()) {
    assert.equal(typeof entry.surface, "string", `${side}[${index}] surface`);
    assert.equal(typeof entry.name, "string", `${side}[${index}] name`);
    assert.ok(Array.isArray(entry.args), `${side}[${index}] argument shape`);
    assert.equal(
      Object.hasOwn(entry, "result") !== Object.hasOwn(entry, "error"),
      true,
      `${side}[${index}] must have exactly one result or error`,
    );
    if (Object.hasOwn(entry, "result")) assert.equal(typeof entry.result, "string");
    if (Object.hasOwn(entry, "error")) assert.equal(typeof entry.error, "string");
  }
}

test("pre-refactor and post-refactor JS call traces are identical", () => {
  const pre = JSON.parse(read("tests/fixtures/webgpu-bindings-call-trace-pre.json"));
  const post = JSON.parse(read("tests/fixtures/webgpu-bindings-call-trace-post.json"));
  assertCallTrace(pre, "pre-refactor");
  assertCallTrace(post, "post-refactor");
  assert.deepEqual(post, pre);

  const families = new Set(pre.map((entry) => entry.surface));
  for (const family of [
    "Document",
    "HTMLCanvasElement",
    "GPUCanvasContext",
    "GPU",
    "GPUAdapter",
    "GPUDevice",
    "GPUQueue",
    "GPUBuffer",
    "GPUCommandEncoder",
    "WebGPU",
  ]) {
    assert.ok(families.has(family), `trace must include ${family}`);
  }
  assert.match(read("tests/fixtures/webgpu-bindings-call-trace.js"), /function record\(/u);
  assert.match(read("tests/fixtures/webgpu-bindings-call-trace.js"), /TN_WEBGPU_CALL_TRACE:/u);
});

test("the supplementary 71/71 registration and 43/43 error census stays green", () => {
  const trace = JSON.parse(read("tests/fixtures/webgpu-bindings-trace.json"));
  const source = [
    read("src/webgpu/bindings.cpp"),
    read("src/webgpu/registration_table.cpp"),
    read("src/webgpu/wrapper_factories.cpp"),
  ].join("\n");
  const registrations = [...collectJsVisibleRegistrations(source)].sort();

  assert.deepEqual(registrations, trace.registrations);
  for (const error of trace.errors) {
    assert.ok(source.includes(error), `missing JS-visible error trace: ${error}`);
  }
  assert.equal(registrations.length, 71);
  assert.equal(trace.errors.length, 43);
});
