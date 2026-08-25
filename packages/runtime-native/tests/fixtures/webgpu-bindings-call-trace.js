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
  let value;
  try {
    value = call();
    entry.result = resultShape(value);
  } catch (error) {
    entry.error = String(error?.message ? error.message : error);
  }
  trace.push(entry);
  return value;
}

const canvas = document.getElementById("canvas");
const parent = canvas.parentElement;
const resizeListener = () => {};
const pointerListener = () => {};
record("HTMLElement", "appendChild", [canvas], () => parent.appendChild(canvas));
record("Document", "querySelector", ["canvas"], () => document.querySelector("canvas"));
record("HTMLCanvasElement", "getContext", ["webgpu"], () => canvas.getContext("webgpu"));
record("HTMLCanvasElement", "addEventListener", ["pointerdown", pointerListener], () =>
  canvas.addEventListener("pointerdown", pointerListener),
);
const dynamicCanvas = record("Document", "createElement", ["canvas"], () =>
  document.createElement("canvas"),
);
const secondDynamicCanvas = record("Document", "createElement", ["canvas"], () =>
  document.createElement("canvas"),
);
dynamicCanvas.id = "dynamic-first";
secondDynamicCanvas.id = "dynamic-second";
const dynamicListener = () => {};
record("HTMLElement", "addEventListener", ["resize", dynamicListener], () =>
  dynamicCanvas.addEventListener("resize", dynamicListener),
);
const dynamicContext = record("HTMLCanvasElement", "getContext", ["2d"], () =>
  dynamicCanvas.getContext("2d"),
);
const secondDynamicContext = record("HTMLCanvasElement", "getContext", ["2d"], () =>
  secondDynamicCanvas.getContext("2d"),
);
if (!dynamicContext || !secondDynamicContext || dynamicContext === secondDynamicContext) {
  throw new Error("dynamic canvas contexts were not distinct");
}
dynamicCanvas.id = secondDynamicCanvas.id;
dynamicCanvas._offscreenCanvasId = secondDynamicCanvas._offscreenCanvasId;
const dynamicContextAfterMutation = record("HTMLCanvasElement", "getContext", ["2d"], () =>
  dynamicCanvas.getContext("2d"),
);
const secondDynamicContextAfterMutation = record(
  "HTMLCanvasElement",
  "getContext",
  ["2d"],
  () => secondDynamicCanvas.getContext("2d"),
);
if (
  dynamicContextAfterMutation !== dynamicContext ||
  secondDynamicContextAfterMutation !== secondDynamicContext ||
  dynamicContextAfterMutation === secondDynamicContextAfterMutation
) {
  throw new Error("dynamic canvas getContext followed a mutable public id");
}
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
const renderShader = record(
  "GPUDevice",
  "createShaderModule",
  [{
    code:
      "@vertex fn main() -> @builtin(position) vec4f { return vec4f(0.0); } " +
      "@fragment fn fragmentMain() -> @location(0) vec4f { return vec4f(0.0); }",
  }],
  () =>
    device.createShaderModule({
      code:
        "@vertex fn main() -> @builtin(position) vec4f { return vec4f(0.0); } " +
        "@fragment fn fragmentMain() -> @location(0) vec4f { return vec4f(0.0); }",
    }),
);
const renderPipeline = record(
  "GPUDevice",
  "createRenderPipeline",
  [{ layout: "auto", vertex: {}, fragment: {} }],
  () =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module: renderShader, entryPoint: "main" },
      fragment: {
        module: renderShader,
        entryPoint: "fragmentMain",
        targets: [{ format }],
      },
    }),
);
if (renderPipeline) {
  record("GPURenderPipeline", "getBindGroupLayout", [0], () =>
    renderPipeline.getBindGroupLayout(0),
  );
}
const computeShader = device.createShaderModule({
  code: "@compute @workgroup_size(1) fn computeMain() {}",
});
const computePipeline = record(
  "GPUDevice",
  "createComputePipeline",
  [{ layout: "auto", compute: {} }],
  () =>
    device.createComputePipeline({
      layout: "auto",
      compute: { module: computeShader, entryPoint: "computeMain" },
    }),
);
if (computePipeline) {
  record("GPUComputePipeline", "getBindGroupLayout", [0], () =>
    computePipeline.getBindGroupLayout(0),
  );
}
record("GPUDevice", "createRenderPipeline", [], () => device.createRenderPipeline());
record("GPUDevice", "createComputePipeline", [], () => device.createComputePipeline());
const encoder = device.createCommandEncoder();
record("GPUDevice", "createCommandEncoder", [], () => encoder);
record("GPUCanvasContext", "configure", [{ format }], () => context.configure({ format }));
const currentTexture = record("GPUCanvasContext", "getCurrentTexture", [], () =>
  context.getCurrentTexture(),
);
const currentView = currentTexture
  ? record("GPUTexture", "createView", [], () => currentTexture.createView())
  : undefined;
const renderPass = currentView
  ? record(
      "GPUCommandEncoder",
      "beginRenderPass",
      [{ colorAttachments: [{ view: currentView }] }],
      () =>
        encoder.beginRenderPass({
          colorAttachments: [
            {
              view: currentView,
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        }),
    )
  : undefined;
if (renderPass) {
  record("GPURenderPassEncoder", "setPipeline", [], () => renderPass.setPipeline());
  record("GPURenderPassEncoder", "setBindGroup", [], () => renderPass.setBindGroup());
  record("GPURenderPassEncoder", "draw", [], () => renderPass.draw());
  record("GPURenderPassEncoder", "setVertexBuffer", [], () => renderPass.setVertexBuffer());
  record("GPURenderPassEncoder", "setIndexBuffer", [], () => renderPass.setIndexBuffer());
  record("GPURenderPassEncoder", "drawIndexed", [], () => renderPass.drawIndexed());
  record("GPURenderPassEncoder", "drawIndirect", [], () => renderPass.drawIndirect());
  record("GPURenderPassEncoder", "drawIndexedIndirect", [], () => renderPass.drawIndexedIndirect());
  record("GPURenderPassEncoder", "setViewport", [], () => renderPass.setViewport());
  record("GPURenderPassEncoder", "setScissorRect", [], () => renderPass.setScissorRect());
  record("GPURenderPassEncoder", "setBlendConstant", [{}], () =>
    renderPass.setBlendConstant({}),
  );
  record("GPURenderPassEncoder", "setStencilReference", [0], () =>
    renderPass.setStencilReference(0),
  );
  record("GPURenderPassEncoder", "executeBundles", [[]], () => renderPass.executeBundles([]));
  record("GPURenderPassEncoder", "end", [], () => renderPass.end());
}
const computePass = record("GPUCommandEncoder", "beginComputePass", [], () =>
  encoder.beginComputePass(),
);
if (computePass) {
  record("GPUComputePassEncoder", "setPipeline", [], () => computePass.setPipeline());
  record("GPUComputePassEncoder", "setBindGroup", [], () => computePass.setBindGroup());
  record("GPUComputePassEncoder", "dispatchWorkgroups", [1, 1, 1], () =>
    computePass.dispatchWorkgroups(1, 1, 1),
  );
  record("GPUComputePassEncoder", "end", [], () => computePass.end());
}
const bundleEncoder = record(
  "GPUDevice",
  "createRenderBundleEncoder",
  [{ colorFormats: [format] }],
  () => device.createRenderBundleEncoder({ colorFormats: [format] }),
);
if (bundleEncoder) {
  record("GPURenderBundleEncoder", "setPipeline", [], () => bundleEncoder.setPipeline());
  record("GPURenderBundleEncoder", "setVertexBuffer", [], () => bundleEncoder.setVertexBuffer());
  record("GPURenderBundleEncoder", "setIndexBuffer", [], () => bundleEncoder.setIndexBuffer());
  record("GPURenderBundleEncoder", "setBindGroup", [], () => bundleEncoder.setBindGroup());
  record("GPURenderBundleEncoder", "draw", [], () => bundleEncoder.draw());
  record("GPURenderBundleEncoder", "drawIndexed", [], () => bundleEncoder.drawIndexed());
  record("GPURenderBundleEncoder", "finish", [], () => bundleEncoder.finish());
}
record("GPUCommandEncoder", "finish", [], () => encoder.finish());
if (currentTexture) record("GPUTexture", "destroy", [], () => currentTexture.destroy());
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
