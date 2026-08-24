/*
 * Deterministic JS-side call trace for the PRD-205 pre/post comparison.
 * The native executable prints the JSON emitted at the end of this file.
 */
const trace = [];

function argumentShape(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (value instanceof ArrayBuffer) return "ArrayBuffer";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object") return `object(${Object.keys(value).sort().join(",")})`;
  return typeof value;
}

function resultShape(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return `string(${value})`;
  if (typeof value === "object") {
    if (value instanceof Promise) return "promise";
    if (Array.isArray(value)) return `array(${value.length})`;
    return "object";
  }
  return typeof value;
}

function record(surface, name, args, call) {
  const entry = { surface, name, args: args.map(argumentShape) };
  console.log(`TN_WEBGPU_CALL:${surface}.${name}`);
  try {
    entry.result = resultShape(call());
  } catch (error) {
    entry.error = String(error?.message ? error.message : error);
  }
  trace.push(entry);
}

const canvas = document.getElementById("canvas");
record("Document", "querySelector", ["canvas"], () => document.querySelector("canvas"));
record("HTMLCanvasElement", "getContext", ["webgpu"], () => canvas.getContext("webgpu"));
const context = canvas.getContext("webgpu");
const format = navigator.gpu.getPreferredCanvasFormat();
record("GPU", "getPreferredCanvasFormat", [], () => format);
record("GPUCanvasContext", "configure", [{ format }], () => context.configure({ format }));
record("GPUCanvasContext", "unconfigure", [], () => context.unconfigure());
record("GPU", "requestAdapter", [], () => navigator.gpu.requestAdapter());
const adapter = navigator.gpu.requestAdapter();
record("GPUAdapter", "features.has", ["timestamp-query"], () =>
  adapter.features.has("timestamp-query"),
);
record("GPUAdapter", "requestDevice", [], () => adapter.requestDevice());
const device = adapter.requestDevice();
record("GPUDevice", "createBuffer", [{ size: 4, usage: GPUBufferUsage.COPY_DST }], () =>
  device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST }),
);
const buffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST });
record("GPUQueue", "submit", [[]], () => device.queue.submit([]));
record("GPUQueue", "writeBuffer", [buffer, 0, new ArrayBuffer(4)], () =>
  device.queue.writeBuffer(buffer, 0, new ArrayBuffer(4)),
);
record("GPUQueue", "onSubmittedWorkDone", [], () => device.queue.onSubmittedWorkDone());
record("GPUBuffer", "getMappedRange", [], () => buffer.getMappedRange());
record("GPUBuffer", "destroy", [], () => buffer.destroy());
record(
  "GPUDevice",
  "createShaderModule",
  [{ code: "@vertex fn main() -> @builtin(position) vec4f { return vec4f(0.0); }" }],
  () =>
    device.createShaderModule({
      code: "@vertex fn main() -> @builtin(position) vec4f { return vec4f(0.0); }",
    }),
);
record("GPUDevice", "createRenderPipeline", [], () => device.createRenderPipeline());
record("GPUDevice", "createComputePipeline", [], () => device.createComputePipeline());
const encoder = device.createCommandEncoder();
record("GPUDevice", "createCommandEncoder", [], () => encoder);
record("GPUCommandEncoder", "beginRenderPass", [], () => encoder.beginRenderPass());
record("GPUCommandEncoder", "beginComputePass", [], () => {
  const pass = encoder.beginComputePass();
  pass.end();
  return pass;
});
record("GPUCommandEncoder", "finish", [], () => encoder.finish());
record("GPUDevice", "createTextureView", [], () => device.createTextureView());
record("GPUDevice", "createBindGroup", [], () => device.createBindGroup());
record("GPUDevice", "createSampler", [{}], () => device.createSampler({}));
record("GPUDevice", "createBindGroupLayout", [], () => device.createBindGroupLayout());
record("GPUDevice", "createPipelineLayout", [], () => device.createPipelineLayout());
record("GPUDevice", "createRenderBundleEncoder", [], () => device.createRenderBundleEncoder());
record("GPUDevice", "pushErrorScope", ["not-a-filter"], () =>
  device.pushErrorScope("not-a-filter"),
);
record("GPUDevice", "popErrorScope", [], () => device.popErrorScope());
record("GPUDevice", "destroy", [], () => device.destroy());
record("WebGPU", "__decodeImageData", [new ArrayBuffer(0)], () =>
  __decodeImageData(new ArrayBuffer(0)),
);
record("WebGPU", "createOffscreenCanvas2D", ["number", "number"], () =>
  createOffscreenCanvas2D(2, 2),
);

console.log(`TN_WEBGPU_CALL_TRACE:${JSON.stringify(trace)}`);
process.exit(0);
