import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

function collectJsVisibleRegistrations(source) {
  const surfaces =
    "Document|HTMLElement|HTMLCanvasElement|GPUCanvasContext|GPU|GPUAdapter|GPUSupportedFeatures|GPUDevice|GPUQueue|GPUBuffer|GPUCommandEncoder|GPURenderPassEncoder|GPUComputePassEncoder|GPURenderBundleEncoder|GPUTexture|GPURenderPipeline|GPUComputePipeline|WebGPU";
  const registrations = new Set([
    ...[
      ...source.matchAll(
        new RegExp(`\\{"(${surfaces})",\\s*"([^"]+)"`, "gu"),
      ),
    ].map((match) => `${match[1]}.${match[2]}`),
  ]);
  if (source.includes('const char* pipelineSurface = renderPipeline ? "GPURenderPipeline" : "GPUComputePipeline"')) {
    registrations.add("GPURenderPipeline.getBindGroupLayout");
    registrations.add("GPUComputePipeline.getBindGroupLayout");
  }
  return registrations;
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

  const calls = new Set(pre.map((entry) => `${entry.surface}.${entry.name}`));
  const requiredFamilies = {
    "render-pass": ["setPipeline", "setBindGroup", "draw", "end"],
    "compute-pass": ["setPipeline", "setBindGroup", "dispatchWorkgroups", "end"],
    "render-bundle": ["setPipeline", "setVertexBuffer", "setBindGroup", "draw", "finish"],
  };
  for (const [family, methods] of Object.entries(requiredFamilies)) {
    for (const method of methods) {
      assert.ok(
        calls.has(
          `${
            family === "render-pass"
              ? "GPURenderPassEncoder"
              : family === "compute-pass"
                ? "GPUComputePassEncoder"
                : "GPURenderBundleEncoder"
          }.${method}`,
        ),
        `trace must include ${family}.${method}`,
      );
    }
  }
  assert.match(read("tests/fixtures/webgpu-bindings-call-trace.js"), /function record\(/u);
  assert.match(read("tests/fixtures/webgpu-bindings-call-trace.js"), /TN_WEBGPU_CALL_TRACE:/u);
});

test("the supplementary surface/name registration and 43/43 error census stays green", () => {
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
  assert.equal(registrations.length, trace.registrations.length);
  assert.equal(trace.errors.length, 43);
});
