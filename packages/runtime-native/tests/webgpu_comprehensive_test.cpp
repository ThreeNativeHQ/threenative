#include "../src/webgpu/bindings_commands.h"
#include "../src/webgpu/bindings_presentation.h"
#include "mystral/webgpu/bindings.h"
#include "../src/webgpu/bindings_state.h"
#include "mystral/webgpu/context.h"
#include "mystral/runtime.h"

#include <chrono>
#include <cstdint>
#include <iostream>
#include <thread>

namespace {

constexpr const char* kScript = R"JS((async () => {
 try {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("no adapter");

  // Check adapter properties
  const info = adapter.info || {};
  const isFallback = adapter.isFallbackAdapter;
  const adapterFeatures = adapter.features;
  const adapterLimits = adapter.limits;

  for (const f of [
    "depth-clip-control", "depth32float-stencil8", "texture-compression-bc",
    "texture-compression-etc2", "texture-compression-astc", "float32-filterable",
    "timestamp-query", "rg11b10ufloat-renderable", "shader-f16", "bgra8unorm-storage",
    "indirect-first-instance"
  ]) {
    adapter.features.has(f);
  }

  const device = await adapter.requestDevice();
  if (!device) throw new Error("no device");
  globalThis.__device = device;

  for (const f of [
    "depth-clip-control", "depth32float-stencil8", "texture-compression-bc",
    "texture-compression-etc2", "texture-compression-astc", "float32-filterable",
    "timestamp-query", "rg11b10ufloat-renderable", "shader-f16", "bgra8unorm-storage",
    "indirect-first-instance"
  ]) {
    device.features.has(f);
  }

  // Error scopes
  device.pushErrorScope('validation');
  device.pushErrorScope('out-of-memory');
  device.pushErrorScope('internal');
  const internalErr = await device.popErrorScope();
  const oomErr = await device.popErrorScope();
  const valErr = await device.popErrorScope();

  // Create Buffers (various usages and sizes)
  const vtxBuf = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    label: "vtx"
  });
  globalThis.__vtxBuf = vtxBuf;
  const idxBuf = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    label: "idx"
  });
  globalThis.__idxBuf = idxBuf;
  const uboBuf = device.createBuffer({
    size: 1024,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    label: "ubo"
  });
  globalThis.__uboBuf = uboBuf;
  const storageBuf = device.createBuffer({
    size: 1024,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | 0x0200,
    label: "storage"
  });
  globalThis.__storageBuf = storageBuf;
  const indirectBuf = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    label: "indirect"
  });
  globalThis.__indirectBuf = indirectBuf;
  const mapWriteBuf = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
    mappedAtCreation: true,
    label: "mapWrite"
  });
  const mappedRange = mapWriteBuf.getMappedRange();
  new Uint8Array(mappedRange).fill(42);
  mapWriteBuf.unmap();

  const mapReadBuf = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    label: "mapRead"
  });

  // Queue writeBuffer
  const writeData = new Float32Array([1.0, 2.0, 3.0, 4.0]);
  device.queue.writeBuffer(uboBuf, 0, writeData.buffer, 0, writeData.byteLength);
  device.queue.writeBuffer(vtxBuf, 0, new Float32Array([0,0,0, 1,0,0, 0,1,0]));
  device.queue.writeBuffer(idxBuf, 0, new Uint16Array([0, 1, 2, 0]));
  // Write with offset and size
  device.queue.writeBuffer(uboBuf, 16, writeData, 1, 2);

  // Create Textures (1D, 2D, 3D, formats, usages)
  const tex2D = device.createTexture({
    size: [16, 16, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    mipLevelCount: 2,
    sampleCount: 1,
    label: "tex2D"
  });
  const texView2D = tex2D.createView({
    format: "rgba8unorm",
    dimension: "2d",
    aspect: "all",
    baseMipLevel: 0,
    mipLevelCount: 1,
    baseArrayLayer: 0,
    arrayLayerCount: 1
  });

  const colorTex = device.createTexture({
    size: [16, 16, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    label: "colorTex"
  });
  const colorView = colorTex.createView();
  globalThis.__colorView = colorView;
  globalThis.__tex2D = tex2D;

  const depthTex = device.createTexture({
    size: [16, 16, 1],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
    label: "depthTex"
  });
  const depthView = depthTex.createView();
  globalThis.__depthView = depthView;

  const tex3D = device.createTexture({
    size: [8, 8, 8],
    dimension: "3d",
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    label: "tex3D"
  });
  const texView3D = tex3D.createView({ dimension: "3d" });

  // device.createTextureView non-standard binding
  if (device.createTextureView) {
    device.createTextureView(tex2D, { dimension: "2d", aspect: "all" });
    device.createTextureView(depthTex, { aspect: "depth-only" });
  }

  // Queue writeTexture
  const texPixels = new Uint8Array(16 * 16 * 4).fill(255);
  device.queue.writeTexture(
    { texture: tex2D },
    texPixels,
    { bytesPerRow: 64, rowsPerImage: 16 },
    [16, 16, 1]
  );

  // Create Samplers
  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "clamp-to-edge",
    addressModeW: "mirror-repeat",
    lodMinClamp: 0,
    lodMaxClamp: 4,
    maxAnisotropy: 2
  });

  const cmpSampler = device.createSampler({
    compare: "less"
  });

  // Shader Modules
  const wgslRender = `
    struct Uniforms { scale: vec4f };
    @group(0) @binding(0) var<uniform> u: Uniforms;
    @group(0) @binding(1) var s: sampler;
    @group(0) @binding(2) var t: texture_2d<f32>;

    struct VertexInput {
      @location(0) pos: vec3f,
    };
    struct VertexOutput {
      @builtin(position) pos: vec4f,
      @location(0) uv: vec2f,
    };

    @vertex
    fn vs_main(in: VertexInput) -> VertexOutput {
      var out: VertexOutput;
      out.pos = vec4f(in.pos * u.scale.xyz, 1.0);
      out.uv = in.pos.xy;
      return out;
    }

    @fragment
    fn fs_main(in: VertexOutput) -> @location(0) vec4f {
      return textureSample(t, s, in.uv);
    }
  `;
  const renderModule = device.createShaderModule({ code: wgslRender, label: "renderModule" });
  if (renderModule.getCompilationInfo) {
    await renderModule.getCompilationInfo();
  }

  const wgslCompute = `
    @group(0) @binding(0) var<storage, read_write> data: array<u32>;
    @compute @workgroup_size(1)
    fn cs_main(@builtin(global_invocation_id) id: vec3u) {
      data[id.x] = data[id.x] + 1u;
    }
  `;
  const computeModule = device.createShaderModule({ code: wgslCompute, label: "computeModule" });

  // Bind Group Layout & Bind Group
  const bgl = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float", viewDimension: "2d" } },
    ]
  });

  const bindGroup = device.createBindGroup({
    layout: bgl,
    entries: [
      { binding: 0, resource: { buffer: uboBuf, offset: 0, size: 256 } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: texView2D },
    ]
  });
  globalThis.__bindGroup = bindGroup;

  const computeBgl = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
    ]
  });

  // Storage texture layout entries
  device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "r32float", viewDimension: "2d" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "read-only", format: "rgba8unorm", viewDimension: "2d" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "read-write", format: "r32float", viewDimension: "3d" } }
    ]
  });

  const computeBindGroup = device.createBindGroup({
    layout: computeBgl,
    entries: [
      { binding: 0, resource: { buffer: storageBuf } }
    ]
  });
  globalThis.__computeBindGroup = computeBindGroup;

  // Pipeline Layout
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bgl]
  });
  const computePipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [computeBgl]
  });

  // Render Pipeline Descriptor
  const renderPipelineDesc = {
    layout: pipelineLayout,
    vertex: {
      module: renderModule,
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: 12,
          stepMode: "vertex",
          attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }]
        }
      ]
    },
    fragment: {
      module: renderModule,
      entryPoint: "fs_main",
      targets: [
        {
          format: "rgba8unorm",
          writeMask: 0xf,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "zero", operation: "add" }
          }
        }
      ]
    },
    primitive: {
      topology: "triangle-list",
      stripIndexFormat: undefined,
      frontFace: "ccw",
      cullMode: "back"
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less-equal",
    },
    multisample: {
      count: 1,
      mask: 0xffffffff,
      alphaToCoverageEnabled: false
    }
  };

  const renderPipeline = device.createRenderPipeline(renderPipelineDesc);
  globalThis.__renderPipeline = renderPipeline;
  const asyncRenderPipeline = await device.createRenderPipelineAsync(renderPipelineDesc);

  // Additional vertex formats pipeline test
  const allFormats = [
    "float32x2", "float32x4", "uint8x2", "uint8x4", "sint8x2", "sint8x4",
    "unorm8x2", "unorm8x4", "snorm8x2", "snorm8x4", "uint16x2", "uint16x4",
    "sint16x2", "sint16x4", "unorm16x2", "unorm16x4", "snorm16x2", "snorm16x4",
    "float16x2", "float16x4", "uint32", "uint32x2", "uint32x3", "uint32x4",
    "sint32", "sint32x2", "sint32x3", "sint32x4"
  ];
  const attrs = allFormats.map((fmt, i) => ({ format: fmt, offset: 0, shaderLocation: i + 1 }));
  try {
    const multiBufDesc = {
      layout: "auto",
      vertex: {
        module: device.createShaderModule({ code: "@vertex fn vs() -> @builtin(position) vec4f { return vec4f(0); }" }),
        entryPoint: "vs",
        buffers: [{ arrayStride: 128, attributes: attrs }]
      },
      fragment: {
        module: device.createShaderModule({ code: "@fragment fn fs() -> @location(0) vec4f { return vec4f(1); }" }),
        entryPoint: "fs",
        targets: [{ format: "rgba8unorm" }]
      }
    };
    device.createRenderPipeline(multiBufDesc);
  } catch (e) {}

  // Compute Pipeline
  const computePipelineDesc = {
    layout: computePipelineLayout,
    compute: { module: computeModule, entryPoint: "cs_main" }
  };
  const computePipeline = device.createComputePipeline(computePipelineDesc);
  globalThis.__computePipeline = computePipeline;
  const asyncComputePipeline = await device.createComputePipelineAsync(computePipelineDesc);

  // Query Set
  const occlusionQuerySet = device.createQuerySet({ type: "occlusion", count: 4 });
  const tsQuerySet = device.features.has("timestamp-query")
    ? device.createQuerySet({ type: "timestamp", count: 4 })
    : null;
  globalThis.__tsQuerySet = tsQuerySet;

  // Command Encoder
  const encoder = device.createCommandEncoder({ label: "mainEncoder" });

  // Clear & copies
  encoder.clearBuffer(vtxBuf, 0, 64);
  encoder.copyBufferToBuffer(mapWriteBuf, 0, mapReadBuf, 0, 64);
  encoder.copyBufferToTexture(
    { buffer: uboBuf, bytesPerRow: 256, rowsPerImage: 16 },
    { texture: tex2D, mipLevel: 0 },
    [4, 4, 1]
  );
  encoder.copyTextureToBuffer(
    { texture: tex2D, mipLevel: 0 },
    { buffer: storageBuf, bytesPerRow: 256, rowsPerImage: 16 },
    [4, 4, 1]
  );
  encoder.copyTextureToTexture(
    { texture: tex2D, mipLevel: 0 },
    { texture: tex2D, mipLevel: 1 },
    [4, 4, 1]
  );

  // Compute Pass
  const computePass = encoder.beginComputePass({ label: "computePass" });
  computePass.setPipeline(computePipeline);
  computePass.setBindGroup(0, computeBindGroup);
  computePass.dispatchWorkgroups(1, 1, 1);
  computePass.end();

  // Render Bundle Encoder
  const bundleEncoder = device.createRenderBundleEncoder({
    colorFormats: ["rgba8unorm"],
    depthStencilFormat: "depth24plus"
  });
  bundleEncoder.setPipeline(renderPipeline);
  bundleEncoder.setBindGroup(0, bindGroup);
  bundleEncoder.setVertexBuffer(0, vtxBuf);
  bundleEncoder.setIndexBuffer(idxBuf, "uint16");
  bundleEncoder.draw(3, 1, 0, 0);
  bundleEncoder.drawIndexed(3, 1, 0, 0, 0);
  const renderBundle = bundleEncoder.finish();
  globalThis.__renderBundle = renderBundle;

  // Render Pass
  const renderPass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: colorView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0.1, g: 0.2, b: 0.3, a: 1.0 }
      }
    ],
    depthStencilAttachment: {
      view: depthView,
      depthClearValue: 1.0,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
    occlusionQuerySet
  });

  renderPass.setPipeline(renderPipeline);
  renderPass.setBindGroup(0, bindGroup);
  renderPass.setVertexBuffer(0, vtxBuf, 0, 256);
  renderPass.setIndexBuffer(idxBuf, "uint16", 0, 256);
  renderPass.setViewport(0, 0, 16, 16, 0.0, 1.0);
  renderPass.setScissorRect(0, 0, 16, 16);
  renderPass.setBlendConstant([0.5, 0.5, 0.5, 1.0]);
  renderPass.setStencilReference(1);

  renderPass.draw(3, 1, 0, 0);

  renderPass.drawIndexed(3, 1, 0, 0, 0);

  // indirect buffer setup
  device.queue.writeBuffer(indirectBuf, 0, new Uint32Array([3, 1, 0, 0, 0, 0, 0, 0]));
  renderPass.drawIndirect(indirectBuf, 0);
  renderPass.drawIndexedIndirect(indirectBuf, 0);

  renderPass.executeBundles([renderBundle]);
  renderPass.end();

  const cmdBuf = encoder.finish();
  device.queue.submit([cmdBuf]);
  await device.queue.onSubmittedWorkDone();

  // copyExternalImageToTexture
  try {
    const cvs = document.createElement("canvas");
    cvs.width = 16;
    cvs.height = 16;
    const cvsCtx = cvs.getContext("2d");
    cvsCtx.fillRect(0, 0, 16, 16);
    device.queue.copyExternalImageToTexture(
      { source: cvs, flipY: true, premultipliedAlpha: true },
      { texture: tex2D, origin: [0, 0, 0], mipLevel: 0 },
      [16, 16, 1]
    );
  } catch (e) {}

  // mapAsync read test
  try {
    await mapReadBuf.mapAsync(1, 0, 64);
    const r = mapReadBuf.getMappedRange(0, 64);
    mapReadBuf.unmap();
  } catch (e) {}

  // Canvas HTML element methods
  try {
    const mainC = document.getElementById("canvas") || cvs;
    if (mainC) {
      mainC.getBoundingClientRect();
      mainC.toDataURL("image/png");
      mainC.toDataURL("image/webp");
      mainC.toDataURL("image/jpeg");
      if (mainC.requestPointerLock) mainC.requestPointerLock();
      const dummyL = () => {};
      mainC.addEventListener("click", dummyL);
      mainC.dispatchEvent(new Event("click"));
      mainC.removeEventListener("click", dummyL);
    }
  } catch (e) {}

  // Canvas WebGPU context configuration
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("webgpu");
  if (ctx) {
    ctx.configure({
      device,
      format: "bgra8unorm",
      alphaMode: "opaque"
    });
  }

  globalThis.__tnWebgpuDone = true;
 } catch (err) {
   globalThis.__tnWebgpuError = String(err?.stack || err);
   console.error("WEBGPU_TEST_ERROR:", err, err?.stack);
 }
})();
)JS";

constexpr const char* kDirectScript = R"JS((() => {
  try {
    const enc = globalThis.__nativeEncoder;
    if (!enc) throw new Error('native encoder is missing');
    enc.clearBuffer(globalThis.__vtxBuf, 0, 64);
    enc.copyBufferToBuffer(globalThis.__storageBuf, 0, globalThis.__vtxBuf, 0, 64);
    enc.copyBufferToTexture(
      { buffer: globalThis.__uboBuf, offset: 0, bytesPerRow: 256, rowsPerImage: 16 },
      { texture: globalThis.__tex2D, mipLevel: 0 },
      [4, 1, 1]
    );
    enc.copyTextureToBuffer(
      { texture: globalThis.__tex2D, mipLevel: 0 },
      { buffer: globalThis.__storageBuf, offset: 0, bytesPerRow: 256, rowsPerImage: 16 },
      [4, 1, 1]
    );
    enc.copyTextureToTexture(
      { texture: globalThis.__tex2D, mipLevel: 0 },
      { texture: globalThis.__tex2D, mipLevel: 1 },
      [4, 1, 1]
    );

    const cpDesc = globalThis.__tsQuerySet
      ? { timestampWrites: { querySet: globalThis.__tsQuerySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } }
      : {};
    const cp = enc.beginComputePass(cpDesc);
    cp.setPipeline(globalThis.__computePipeline);
    cp.setBindGroup(0, globalThis.__computeBindGroup);
    cp.dispatchWorkgroups(1, 1, 1);
    cp.end();

    if (globalThis.__tsQuerySet) {
      try {
        enc.resolveQuerySet(globalThis.__tsQuerySet, 0, 2, globalThis.__storageBuf, 0);
      } catch(e) {}
    }

    const rp = enc.beginRenderPass({
      colorAttachments: [{
        view: globalThis.__colorView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: [0.1, 0.2, 0.3, 1.0]
      }],
      depthStencilAttachment: {
        view: globalThis.__depthView,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store"
      }
    });
    rp.setPipeline(globalThis.__renderPipeline);
    rp.setBindGroup(0, globalThis.__bindGroup);
    rp.setVertexBuffer(0, globalThis.__vtxBuf);
    rp.setIndexBuffer(globalThis.__idxBuf, "uint16");
    rp.setViewport(0, 0, 16, 16, 0.0, 1.0);
    rp.setScissorRect(0, 0, 16, 16);
    rp.setBlendConstant([0.5, 0.5, 0.5, 1.0]);
    rp.setStencilReference(1);
    rp.draw(3, 1, 0, 0);
    rp.drawIndexed(3, 1, 0, 0, 0);
    rp.drawIndirect(globalThis.__indirectBuf, 0);
    rp.drawIndexedIndirect(globalThis.__indirectBuf, 0);
    rp.executeBundles([globalThis.__renderBundle]);
    rp.end();

    enc.finish();
    globalThis.__tnDirectEncoderDone = true;
  } catch (err) {
    console.error("DIRECT_ENCODER_ERROR:", err, err?.stack);
    throw err;
  }
})())JS";

}  // namespace

int main() {
    mystral::RuntimeConfig config;
    config.width = 128;
    config.height = 128;
    config.noSdl = true;

    auto runtime = mystral::Runtime::create(config);
    if (!runtime) {
        std::cerr << "could not create headless native runtime\n";
        return 1;
    }

    if (!runtime->evalScript(kScript, "webgpu_comprehensive_test.js")) {
        std::cerr << "webgpu comprehensive test script evaluation failed\n";
        return 1;
    }

    auto* state = static_cast<mystral::webgpu::BindingsState*>(runtime->getWebGPUBindingsState());
    if (!state || !state->engine) {
        std::cerr << "headless runtime did not expose WebGPU binding state\n";
        return 1;
    }

    auto* engine = state->engine;
    // GPU callbacks advance on wall clock. A fixed number of tight polls can finish before Metal
    // or D3D12 settles the submitted-work and map promises this script awaits.
    const auto scriptDeadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    while (std::chrono::steady_clock::now() < scriptDeadline) {
        if (!runtime->pollEvents()) break;
        engine->processMicrotasks();
        mystral::js::JSValueGuard done(*engine, engine->getGlobalProperty("__tnWebgpuDone"));
        if (engine->toBoolean(done.get())) break;
        mystral::js::JSValueGuard error(*engine, engine->getGlobalProperty("__tnWebgpuError"));
        if (!engine->isUndefined(error.get())) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    if (!runtime->evalScript(
            "if (globalThis.__tnWebgpuError) throw new Error(globalThis.__tnWebgpuError);"
            "if (globalThis.__tnWebgpuDone !== true) throw new Error('webgpu script timed out');",
            "webgpu_comprehensive_assert.js")) {
        std::cerr << "webgpu comprehensive test script did not complete\n";
        return 1;
    }

    {
        auto* engine = state->engine;
        auto deviceHandle = engine->getGlobalProperty("__device");
        if (!deviceHandle.ptr || engine->isUndefined(deviceHandle)) {
            std::cerr << "webgpu comprehensive script did not expose its device\n";
            return 1;
        }
        auto nativeEncoder = mystral::webgpu::handleGpuDeviceCreateCommandEncoder(state, deviceHandle, {});
        if (!nativeEncoder.ptr || engine->isUndefined(nativeEncoder) ||
            !engine->setGlobalProperty("__nativeEncoder", nativeEncoder)) {
            std::cerr << "could not expose the native command encoder\n";
            return 1;
        }
        if (!runtime->evalScript(kDirectScript, "direct_encoder.js")) return 1;

        // Exercise screenshot & getters
        mystral::webgpu::getCurrentRenderedTexture(state);
        mystral::webgpu::getCurrentTextureWidth(state);
        mystral::webgpu::getCurrentTextureHeight(state);
        mystral::webgpu::getCurrentSurfaceTexture(state);
        mystral::webgpu::getScreenshotBuffer(state);
        mystral::webgpu::getScreenshotBufferSize(state);
        mystral::webgpu::getScreenshotBytesPerRow(state);
        mystral::webgpu::getScreenshotFormat(state);
        mystral::webgpu::isScreenshotReady(state);
        mystral::webgpu::clearScreenshotReady(state);
        mystral::webgpu::requestFrameScreenshot(state);
        mystral::webgpu::compositeCanvas2DToWebGPU(state);
        mystral::webgpu::presentCount(state);
        mystral::webgpu::setPresentationCapHz(60);
        mystral::webgpu::setVideoCaptureCallback(state, nullptr, nullptr);
        mystral::webgpu::clearVideoCaptureCallback(state);

        // Presentation functions
        mystral::webgpu::isSrgbSurfaceFormat(WGPUTextureFormat_BGRA8UnormSrgb);
        mystral::webgpu::linearSurfaceFormat(WGPUTextureFormat_BGRA8UnormSrgb);
        mystral::webgpu::paceToPresentationCap();
        mystral::webgpu::reportPresentTick(state, 60);
        mystral::webgpu::reportSurfaceFormatMarker(WGPUTextureFormat_BGRA8Unorm, WGPUTextureFormat_BGRA8Unorm, false, WGPUPresentMode_Fifo);
        const auto sentinelView = reinterpret_cast<WGPUTextureView>(static_cast<uintptr_t>(1));
        mystral::webgpu::trackCurrentSurfaceTextureView(state, 999, sentinelView);
        if (!mystral::webgpu::isCurrentSurfaceTextureView(state, sentinelView)) return 1;
        mystral::webgpu::untrackCurrentSurfaceTextureView(state, 999);
        mystral::webgpu::releaseCurrentSurfaceTextureViews(state);
        mystral::webgpu::presentPendingSurface(state);
        auto capNum = engine->newNumber(60);
        mystral::webgpu::handleWebGpuPresentationCap(state, {}, {capNum});
    }

    // Direct Context methods
    {
        mystral::webgpu::Context standaloneCtx;
        standaloneCtx.initializeHeadless();
        standaloneCtx.createOffscreenTarget(64, 64);
        standaloneCtx.getOffscreenTexture();
        standaloneCtx.getOffscreenTextureView();
        standaloneCtx.isHeadless();
        standaloneCtx.getCurrentTextureView();
        standaloneCtx.getSurfaceWidth();
        standaloneCtx.getSurfaceHeight();
        standaloneCtx.hasIndirectFirstInstance();
        standaloneCtx.hasTimestampQuery();
    }

    bool ok = runtime->evalScript("if (globalThis.__tnWebgpuDone !== true || globalThis.__tnDirectEncoderDone !== true) throw new Error('not done');", "check.js");
    if (!ok) {
        std::cerr << "webgpu comprehensive test did not complete successfully\n";
        return 1;
    }

    std::cout << "native WebGPU comprehensive contract passed\n";
    return 0;
}
