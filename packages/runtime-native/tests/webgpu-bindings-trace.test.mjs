import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

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

function assertRequiredTraceFamilies(trace) {
  const calls = new Set(trace.map((entry) => `${entry.surface}.${entry.name}`));
  const requiredFamilies = {
    dom: [
      "Document.querySelector",
      "Document.createElement",
      "HTMLElement.appendChild",
      "HTMLElement.addEventListener",
      "HTMLCanvasElement.getContext",
      "HTMLCanvasElement.addEventListener",
    ],
    canvas: [
      "GPUCanvasContext.configure",
      "GPUCanvasContext.unconfigure",
      "GPUCanvasContext.getCurrentTexture",
    ],
    gpu: ["GPU.getPreferredCanvasFormat"],
    "adapter/features": ["GPUAdapter.features.has"],
    device: ["GPUDevice.createBuffer", "GPUDevice.createShaderModule"],
    queue: ["GPUQueue.submit", "GPUQueue.writeBuffer"],
    buffer: ["GPUBuffer.getMappedRange", "GPUBuffer.destroy"],
    texture: ["GPUTexture.createView", "GPUTexture.destroy"],
    "command-encoder": [
      "GPUCommandEncoder.beginRenderPass",
      "GPUCommandEncoder.beginComputePass",
      "GPUCommandEncoder.finish",
    ],
    pipelines: ["GPURenderPipeline.getBindGroupLayout", "GPUComputePipeline.getBindGroupLayout"],
    "render-pass": ["setPipeline", "setBindGroup", "draw", "end"],
    "compute-pass": ["setPipeline", "setBindGroup", "dispatchWorkgroups", "end"],
    "render-bundle": ["setPipeline", "setVertexBuffer", "setBindGroup", "draw", "finish"],
    globals: ["WebGPU.__decodeImageData", "WebGPU.createOffscreenCanvas2D"],
  };
  for (const [family, methods] of Object.entries(requiredFamilies)) {
    for (const method of methods) {
      const key = method.includes(".")
        ? method
        : `${
            family === "render-pass"
              ? "GPURenderPassEncoder"
              : family === "compute-pass"
                ? "GPUComputePassEncoder"
                : "GPURenderBundleEncoder"
          }.${method}`;
      assert.ok(calls.has(key), `trace must include ${family}.${key}`);
    }
  }

  for (const key of ["Document.createElement", "HTMLElement.addEventListener"]) {
    assert.ok(
      trace.some(
        (entry) => `${entry.surface}.${entry.name}` === key && Object.hasOwn(entry, "result"),
      ),
      `trace must include a successful ${key} call`,
    );
  }
}

function assertDynamicCanvasTraceControls(trace) {
  const creates = trace.filter(
    (entry) => entry.surface === "Document" && entry.name === "createElement",
  );
  assert.ok(creates.length >= 2, "trace must execute two dynamic canvas creations");

  const contexts = trace.filter(
    (entry) => entry.surface === "HTMLCanvasElement" && entry.name === "getContext",
  );
  assert.ok(contexts.length >= 5, "trace must execute the dynamic context identity controls");
  assert.ok(
    contexts.every((entry) => Object.hasOwn(entry, "result")),
    "dynamic canvas context controls must not be missing-method errors",
  );
}

test("pre-refactor and post-refactor JS call traces are identical", () => {
  const pre = JSON.parse(read("tests/fixtures/webgpu-bindings-call-trace-pre.json"));
  const post = JSON.parse(read("tests/fixtures/webgpu-bindings-call-trace-post.json"));
  assertCallTrace(pre, "pre-refactor");
  assertCallTrace(post, "post-refactor");
  assert.deepEqual(post, pre);

  assertRequiredTraceFamilies(pre);
  assertDynamicCanvasTraceControls(pre);
  const withoutPipelineRow = pre.filter(
    (entry) => entry.surface !== "GPURenderPipeline" || entry.name !== "getBindGroupLayout",
  );
  assert.throws(
    () => assertRequiredTraceFamilies(withoutPipelineRow),
    /GPURenderPipeline\.getBindGroupLayout/u,
  );
  assert.throws(
    () =>
      assertDynamicCanvasTraceControls(
        pre.filter((entry) => !(entry.surface === "Document" && entry.name === "createElement")),
      ),
    /dynamic canvas creations/u,
  );
  assert.match(read("tests/fixtures/webgpu-bindings-call-trace.js"), /function record\(/u);
  assert.match(read("tests/fixtures/webgpu-bindings-call-trace.js"), /TN_WEBGPU_CALL_TRACE:/u);
});
