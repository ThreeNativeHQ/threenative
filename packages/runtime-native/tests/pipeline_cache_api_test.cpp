// The patched wgpu-native C API must expose a real pipeline cache, not only a handle that can be
// created. This contract requests the optional feature, attaches one cache to render and compute
// pipelines, owns the serialized bytes, rejects a corrupt import, and renders after strict reload.
//
// PRD-368 Phase 1B adds the half that matters to a player: the *host* must compile through one
// cache of its own. The API round trip below proves the patch works when a test drives it by hand;
// it says nothing about whether `device.createRenderPipeline` in a game reaches a cache at all. So
// the second half drives the host's own JavaScript bindings — synchronous and worker compiles,
// render and compute — and requires the device cache to grow past the bytes an empty one holds.
//
// Its negative control is executable rather than a one-off edit: `TN_PIPELINE_CACHE=0` leaves every
// other line of the host identical and only skips the attachment, and this contract then requires
// the opposite result — nothing attached, nothing serialized. Run both arms; a build that populates
// the cache in both is attaching something other than what it claims.

#include "../src/webgpu/bindings_pipelines.h"
#include "../src/webgpu/bindings_state.h"
#include "mystral/runtime.h"

#include <cstdint>
#include <cstdlib>
#include <chrono>
#include <cstring>
#include <iostream>
#include <thread>
#include <string>
#include <vector>

#if defined(MYSTRAL_WGPU_PIPELINE_CACHE)
// `wgpuDevicePoll` is wgpu-native's own extension, not part of the shared `webgpu.h` surface, and
// the two distributions place it differently. `bindings_resources.cpp` probes the same two paths.
#if __has_include(<webgpu/wgpu.h>)
#include <webgpu/wgpu.h>
#else
#include <wgpu/wgpu.h>
#endif
#endif

namespace {

#if defined(MYSTRAL_WGPU_PIPELINE_CACHE)

void require(bool condition, const char* label) {
    if (!condition) {
        std::cerr << "FAIL " << label << '\n';
        std::exit(1);
    }
}

std::string stringViewText(WGPUStringView value) {
    if (value.data == nullptr) return {};
    if (value.length == WGPU_STRLEN) return value.data;
    return {value.data, value.length};
}

struct AdapterRequest {
    WGPUAdapter adapter = nullptr;
    WGPURequestAdapterStatus status = WGPURequestAdapterStatus_Unknown;
    bool completed = false;
    std::string message;
};

void onAdapterRequest(WGPURequestAdapterStatus status, WGPUAdapter adapter, WGPUStringView message,
                      void* userdata1, void*) {
    auto* result = static_cast<AdapterRequest*>(userdata1);
    result->status = status;
    result->adapter = adapter;
    result->message = stringViewText(message);
    result->completed = true;
}

struct DeviceRequest {
    WGPUDevice device = nullptr;
    WGPURequestDeviceStatus status = WGPURequestDeviceStatus_Unknown;
    bool completed = false;
    std::string message;
};

void onDeviceRequest(WGPURequestDeviceStatus status, WGPUDevice device, WGPUStringView message,
                     void* userdata1, void*) {
    auto* result = static_cast<DeviceRequest*>(userdata1);
    result->status = status;
    result->device = device;
    result->message = stringViewText(message);
    result->completed = true;
}

WGPUAdapter requestVulkanAdapter(WGPUInstance instance) {
    WGPURequestAdapterOptions options = {};
    options.featureLevel = WGPUFeatureLevel_Core;
    options.powerPreference = WGPUPowerPreference_HighPerformance;
    options.backendType = WGPUBackendType_Vulkan;

    AdapterRequest result;
    WGPURequestAdapterCallbackInfo callback = {};
    callback.mode = WGPUCallbackMode_AllowProcessEvents;
    callback.callback = onAdapterRequest;
    callback.userdata1 = &result;
    wgpuInstanceRequestAdapter(instance, &options, callback);
    while (!result.completed) wgpuInstanceProcessEvents(instance);
    if (result.adapter == nullptr) {
        std::cout << "TN_PIPELINE_CACHE_UNAVAILABLE:{\"backend\":\"wgpu-native\",\"reason\":\""
                  << (result.message.empty() ? "Vulkan adapter unavailable" : result.message)
                  << "\"}\n";
    }
    return result.adapter;
}

WGPUDevice requestCacheDevice(WGPUInstance instance, WGPUAdapter adapter) {
    const WGPUFeatureName feature = static_cast<WGPUFeatureName>(WGPUNativeFeature_PipelineCache);
    WGPUDeviceDescriptor descriptor = {};
    descriptor.requiredFeatureCount = 1;
    descriptor.requiredFeatures = &feature;

    DeviceRequest result;
    WGPURequestDeviceCallbackInfo callback = {};
    callback.mode = WGPUCallbackMode_AllowProcessEvents;
    callback.callback = onDeviceRequest;
    callback.userdata1 = &result;
    wgpuAdapterRequestDevice(adapter, &descriptor, callback);
    while (!result.completed) wgpuInstanceProcessEvents(instance);
    require(result.device != nullptr, result.message.empty() ? "request cache device" : result.message.c_str());
    require(wgpuDeviceHasFeature(result.device, feature) != 0, "requested pipeline-cache feature was not granted");
    return result.device;
}

WGPUStringView text(const char* value) {
    return {value, std::strlen(value)};
}

WGPUShaderModule makeShader(WGPUDevice device, const char* code) {
    WGPUShaderSourceWGSL source = {};
    source.chain.sType = WGPUSType_ShaderSourceWGSL;
    source.code = {code, WGPU_STRLEN};
    WGPUShaderModuleDescriptor descriptor = {};
    descriptor.nextInChain = &source.chain;
    return wgpuDeviceCreateShaderModule(device, &descriptor);
}

WGPUPipelineCacheExtras cacheExtension(WGPUPipelineCache cache) {
    WGPUPipelineCacheExtras extension = {};
    extension.chain.sType = static_cast<WGPUSType>(WGPUSType_PipelineCacheExtras);
    extension.cache = cache;
    return extension;
}

WGPURenderPipeline makeRenderPipeline(WGPUDevice device, WGPUShaderModule module,
                                       WGPUPipelineCache cache) {
    WGPUPipelineCacheExtras extension = cacheExtension(cache);
    WGPUColorTargetState target = {};
    target.format = WGPUTextureFormat_RGBA8Unorm;
    target.writeMask = WGPUColorWriteMask_All;
    WGPUFragmentState fragment = {};
    fragment.module = module;
    fragment.entryPoint = text("fs");
    fragment.targetCount = 1;
    fragment.targets = &target;

    WGPURenderPipelineDescriptor descriptor = {};
    descriptor.nextInChain = &extension.chain;
    descriptor.label = text("pipeline-cache-render");
    descriptor.vertex.module = module;
    descriptor.vertex.entryPoint = text("vs");
    descriptor.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    descriptor.multisample.count = 1;
    descriptor.multisample.mask = 0xFFFFFFFF;
    descriptor.fragment = &fragment;
    return wgpuDeviceCreateRenderPipeline(device, &descriptor);
}

WGPUComputePipeline makeComputePipeline(WGPUDevice device, WGPUShaderModule module,
                                        WGPUPipelineCache cache) {
    WGPUPipelineCacheExtras extension = cacheExtension(cache);
    WGPUComputePipelineDescriptor descriptor = {};
    descriptor.nextInChain = &extension.chain;
    descriptor.label = text("pipeline-cache-compute");
    descriptor.compute.module = module;
    descriptor.compute.entryPoint = text("main");
    return wgpuDeviceCreateComputePipeline(device, &descriptor);
}

struct MapResult {
    WGPUMapAsyncStatus status = WGPUMapAsyncStatus_Unknown;
    bool completed = false;
    std::string message;
};

void onMap(WGPUMapAsyncStatus status, WGPUStringView message, void* userdata1, void*) {
    auto* result = static_cast<MapResult*>(userdata1);
    result->status = status;
    result->message = stringViewText(message);
    result->completed = true;
}

void renderAndReadback(WGPUDevice device, WGPUQueue queue, WGPURenderPipeline renderPipeline,
                       WGPUComputePipeline computePipeline) {
    constexpr uint32_t kSize = 64;
    constexpr size_t kBytesPerRow = 256;
    constexpr size_t kReadbackBytes = kBytesPerRow * kSize;

    WGPUTextureDescriptor textureDescriptor = {};
    textureDescriptor.label = text("pipeline-cache-target");
    textureDescriptor.usage = WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc;
    textureDescriptor.dimension = WGPUTextureDimension_2D;
    textureDescriptor.size = {kSize, kSize, 1};
    textureDescriptor.format = WGPUTextureFormat_RGBA8Unorm;
    textureDescriptor.mipLevelCount = 1;
    textureDescriptor.sampleCount = 1;
    WGPUTexture texture = wgpuDeviceCreateTexture(device, &textureDescriptor);
    require(texture != nullptr, "create render target");
    WGPUTextureView view = wgpuTextureCreateView(texture, nullptr);
    require(view != nullptr, "create render target view");

    WGPUBufferDescriptor bufferDescriptor = {};
    bufferDescriptor.label = text("pipeline-cache-readback");
    bufferDescriptor.size = kReadbackBytes;
    bufferDescriptor.usage = WGPUBufferUsage_CopyDst | WGPUBufferUsage_MapRead;
    WGPUBuffer buffer = wgpuDeviceCreateBuffer(device, &bufferDescriptor);
    require(buffer != nullptr, "create readback buffer");

    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(device, nullptr);
    require(encoder != nullptr, "create command encoder");

    WGPURenderPassColorAttachment color = {};
    color.view = view;
    color.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
    color.loadOp = WGPULoadOp_Clear;
    color.storeOp = WGPUStoreOp_Store;
    color.clearValue = {0, 0, 0, 1};
    WGPURenderPassDescriptor renderPassDescriptor = {};
    renderPassDescriptor.colorAttachmentCount = 1;
    renderPassDescriptor.colorAttachments = &color;
    WGPURenderPassEncoder renderPass =
        wgpuCommandEncoderBeginRenderPass(encoder, &renderPassDescriptor);
    require(renderPass != nullptr, "begin render pass");
    wgpuRenderPassEncoderSetPipeline(renderPass, renderPipeline);
    wgpuRenderPassEncoderDraw(renderPass, 3, 1, 0, 0);
    wgpuRenderPassEncoderEnd(renderPass);
    wgpuRenderPassEncoderRelease(renderPass);

    WGPUComputePassDescriptor computePassDescriptor = {};
    WGPUComputePassEncoder computePass =
        wgpuCommandEncoderBeginComputePass(encoder, &computePassDescriptor);
    require(computePass != nullptr, "begin compute pass");
    wgpuComputePassEncoderSetPipeline(computePass, computePipeline);
    wgpuComputePassEncoderDispatchWorkgroups(computePass, 1, 1, 1);
    wgpuComputePassEncoderEnd(computePass);
    wgpuComputePassEncoderRelease(computePass);

    WGPUTexelCopyTextureInfo source = {};
    source.texture = texture;
    source.aspect = WGPUTextureAspect_All;
    WGPUTexelCopyBufferInfo destination = {};
    destination.buffer = buffer;
    destination.layout.bytesPerRow = kBytesPerRow;
    destination.layout.rowsPerImage = kSize;
    WGPUExtent3D copySize = {kSize, kSize, 1};
    wgpuCommandEncoderCopyTextureToBuffer(encoder, &source, &destination, &copySize);

    WGPUCommandBuffer command = wgpuCommandEncoderFinish(encoder, nullptr);
    require(command != nullptr, "finish cache command buffer");
    wgpuQueueSubmit(queue, 1, &command);
    wgpuCommandBufferRelease(command);

    MapResult map;
    WGPUBufferMapCallbackInfo callback = {};
    callback.mode = WGPUCallbackMode_AllowProcessEvents;
    callback.callback = onMap;
    callback.userdata1 = &map;
    wgpuBufferMapAsync(buffer, WGPUMapMode_Read, 0, kReadbackBytes, callback);
    wgpuDevicePoll(device, true, nullptr);
    require(map.completed && map.status == WGPUMapAsyncStatus_Success,
            map.message.empty() ? "readback map" : map.message.c_str());
    const auto* bytes = static_cast<const uint8_t*>(
        wgpuBufferGetConstMappedRange(buffer, 0, kReadbackBytes));
    require(bytes != nullptr, "readback mapped range");
    std::cerr << "observed RGBA=" << static_cast<unsigned>(bytes[0]) << ','
              << static_cast<unsigned>(bytes[1]) << ',' << static_cast<unsigned>(bytes[2]) << ','
              << static_cast<unsigned>(bytes[3]) << '\n';
    require(bytes[0] == 64 && (bytes[1] == 127 || bytes[1] == 128) && bytes[2] == 191 &&
                bytes[3] == 255,
            "rendered RGBA after cache reload");

    wgpuBufferUnmap(buffer);
    wgpuBufferRelease(buffer);
    wgpuTextureViewRelease(view);
    wgpuTextureRelease(texture);
    wgpuCommandEncoderRelease(encoder);
}


// ============================================================================
// PRD-368 Phase 1B — the host's own creation paths compile through one cache
// ============================================================================

/**
 * Four pipelines through the host's public bindings: sync render, sync compute, and both workers.
 *
 * Every shader is salted so no two compiles are the same program. That is not decoration: a
 * backend that deduplicates an identical pipeline would let this pass while attaching nothing,
 * because the second creation never reaches the compiler at all.
 */
constexpr const char* kHostPipelineScript = R"JS((() => {
  const renderShader = (salt) => `
@vertex
fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(positions[index] * ${salt}.0, 0.0, 1.0);
}
@fragment
fn fs() -> @location(0) vec4f { return vec4f(0.25, 0.5, 0.75, ${salt}.0 / ${salt}.0); }
`;
  const computeShader = (salt) => `
var<private> seed: f32 = ${salt}.0;
@compute @workgroup_size(1)
fn main() { seed = seed * 2.0; }
`;
  const layout = __device.createPipelineLayout({ bindGroupLayouts: [] });
  const renderDescriptor = (salt) => ({
    layout,
    vertex: { module: __device.createShaderModule({ code: renderShader(salt) }), entryPoint: "vs" },
    fragment: {
      module: __device.createShaderModule({ code: renderShader(salt) }),
      entryPoint: "fs",
      targets: [{ format: "rgba8unorm" }],
    },
    primitive: { topology: "triangle-list" },
  });
  const computeDescriptor = (salt) => ({
    layout,
    compute: { module: __device.createShaderModule({ code: computeShader(salt) }), entryPoint: "main" },
  });
  globalThis.__hostCacheSyncRender = __device.createRenderPipeline(renderDescriptor(11));
  globalThis.__hostCacheSyncCompute = __device.createComputePipeline(computeDescriptor(12));
  globalThis.__hostCacheAsyncRender = __device.createRenderPipelineAsync(renderDescriptor(13));
  globalThis.__hostCacheAsyncCompute = __device.createComputePipelineAsync(computeDescriptor(14));
  return true;
})())JS";

/** Settles the worker compiles the script above started, on the thread that owns the engine. */
void drainHostCompiles(mystral::webgpu::BindingsState* state) {
    for (int attempt = 0; attempt < 2000; attempt += 1) {
        mystral::webgpu::drainAsyncPipelineCompiles(state);
        if (state->asyncPipelines.settled >= state->asyncPipelines.started) return;
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    require(false, "host worker compiles never settled");
}

/**
 * The host populates its device cache — or, under `TN_PIPELINE_CACHE=0`, provably does not.
 *
 * The floor is the empty cache's own serialization, not zero: wgpu writes a header into a cache
 * holding nothing, and "bytes > 0" would pass on a cache no pipeline ever reached.
 */
void checkHostPipelineCache(mystral::Runtime& runtime) {
    auto* state = static_cast<mystral::webgpu::BindingsState*>(runtime.getWebGPUBindingsState());
    require(state != nullptr, "host bindings state");
    const auto& cache = state->pipelineCache;
    const char* disabled = std::getenv("TN_PIPELINE_CACHE");
    const bool controlArm = disabled != nullptr && std::string(disabled) == "0";

    if (controlArm) {
        require(cache.mode == "disabled", "TN_PIPELINE_CACHE=0 must report the disabled mode");
    } else if (cache.mode != "attached") {
        std::cout << "TN_PIPELINE_CACHE_UNAVAILABLE:{\"backend\":\"wgpu-native\",\"reason\":\""
                  << "host device cache mode " << cache.mode << "\"}\n";
        return;
    }

    const size_t before = mystral::webgpu::pipelineCacheSerializedBytes(state);
    require(runtime.evalScript(kHostPipelineScript, "pipeline_cache_host_pipelines.js"),
            "create pipelines through the host bindings");
    drainHostCompiles(state);
    const size_t after = mystral::webgpu::pipelineCacheSerializedBytes(state);
    const uint64_t renderAttached = cache.renderAttached.load();
    const uint64_t computeAttached = cache.computeAttached.load();
    std::cerr << "host cache mode=" << cache.mode << " renderAttached=" << renderAttached
              << " computeAttached=" << computeAttached << " emptyBytes=" << cache.emptyBytes
              << " before=" << before << " after=" << after << '\n';

    if (controlArm) {
        require(renderAttached == 0 && computeAttached == 0,
                "the disabled control attached a cache to a creation call");
        require(after == 0, "the disabled control serialized cache bytes");
        return;
    }
    require(renderAttached >= 2, "both host render paths must attach the device cache");
    require(computeAttached >= 2, "both host compute paths must attach the device cache");
    require(before == cache.emptyBytes, "the pre-compile cache was not the empty one");
    require(after > before, "the host compiled four pipelines and the device cache did not grow");
}

size_t serializedData(WGPUPipelineCache cache, std::vector<uint8_t>& bytes) {
    WGPUPipelineCacheData data = wgpuPipelineCacheGetData(cache);
    if (data.size > 0) require(data.data != nullptr, "serialized cache pointer");
    if (data.data != nullptr) bytes.assign(data.data, data.data + data.size);
    const size_t size = data.size;
    wgpuPipelineCacheDataFreeMembers(data);
    return size;
}

#endif

}  // namespace

int main() {
#if !defined(MYSTRAL_WGPU_PIPELINE_CACHE)
    // Either a backend that is not wgpu-native, or a stock wgpu-native prebuilt: the maintained
    // patch is what declares the cache API, and CMake defines this only when the installed header
    // actually carries it. Reporting unavailable is the contract, not a skipped test.
    std::cout << "TN_PIPELINE_CACHE_UNAVAILABLE:{\"backend\":\"other\",\"reason\":\""
              << "this build's WebGPU headers declare no pipeline cache API\"}\n";
    return 0;
#else
    mystral::RuntimeConfig config;
    config.width = 1;
    config.height = 1;
    config.noSdl = true;
    auto runtime = mystral::Runtime::create(config);
    require(runtime != nullptr, "create headless runtime");

    // Creating the ordinary JS device first initializes the host's real WebGPU instance and proc
    // table. The cache device is requested directly afterward so this contract can require the
    // patched feature without changing the production device descriptor before Phase 1B.
    constexpr const char* kHostSetup = R"JS((() => {
  const adapter = navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("host adapter unavailable");
  const device = adapter.requestDevice();
  if (!device) throw new Error("host device unavailable");
  globalThis.__device = device;
})())JS";
    require(runtime->evalScript(kHostSetup, "pipeline_cache_host_setup.js"),
            "initialize host WebGPU instance");
    auto instance = static_cast<WGPUInstance>(runtime->getWGPUInstance());
    require(instance != nullptr, "get host WebGPU instance");

    // PRD-368 Phase 1B first: it reads the host's own cache, and the raw-API probe below creates a
    // second device whose pipelines must not be mistaken for the host's.
    checkHostPipelineCache(*runtime);

    WGPUAdapter adapter = requestVulkanAdapter(instance);
    if (adapter == nullptr) return 0;
    const WGPUFeatureName feature = static_cast<WGPUFeatureName>(WGPUNativeFeature_PipelineCache);
    if (wgpuAdapterHasFeature(adapter, feature) == 0) {
        std::cout << "TN_PIPELINE_CACHE_UNAVAILABLE:{\"backend\":\"wgpu-native\",\"reason\":\""
                  << "Vulkan adapter does not advertise WGPUNativeFeature_PipelineCache\"}\n";
        wgpuAdapterRelease(adapter);
        return 0;
    }
    WGPUDevice device = requestCacheDevice(instance, adapter);
    WGPUQueue queue = wgpuDeviceGetQueue(device);
    require(queue != nullptr, "get cache device queue");

    const char* renderShader = R"WGSL(
@vertex
fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(positions[index], 0.0, 1.0);
}
@fragment
fn fs() -> @location(0) vec4f { return vec4f(0.25, 0.5, 0.75, 1.0); }
)WGSL";
    const char* computeShader = R"WGSL(
@compute @workgroup_size(1)
fn main() {}
)WGSL";
    WGPUShaderModule renderModule = makeShader(device, renderShader);
    WGPUShaderModule computeModule = makeShader(device, computeShader);
    require(renderModule != nullptr, "create render shader");
    require(computeModule != nullptr, "create compute shader");

    WGPUPipelineCacheDescriptor emptyDescriptor = {};
    emptyDescriptor.label = text("pipeline-cache-empty");
    WGPUPipelineCache emptyCache = wgpuDeviceCreatePipelineCache(device, &emptyDescriptor);
    require(emptyCache != nullptr, "create empty pipeline cache");
    std::vector<uint8_t> emptyBytes;
    serializedData(emptyCache, emptyBytes);

    WGPURenderPipeline initialRender = makeRenderPipeline(device, renderModule, emptyCache);
    WGPUComputePipeline initialCompute = makeComputePipeline(device, computeModule, emptyCache);
    require(initialRender != nullptr, "create cache-attached render pipeline");
    require(initialCompute != nullptr, "create cache-attached compute pipeline");

    std::vector<uint8_t> serialized;
    serializedData(emptyCache, serialized);
    require(!serialized.empty(), "serialize populated pipeline cache");

    std::vector<uint8_t> corrupt = serialized;
    corrupt[0] ^= 0xFF;
    WGPUPipelineCacheDescriptor corruptDescriptor = {};
    corruptDescriptor.label = text("pipeline-cache-corrupt");
    corruptDescriptor.data = corrupt.data();
    corruptDescriptor.size = corrupt.size();
    require(wgpuDeviceCreatePipelineCache(device, &corruptDescriptor) == nullptr,
            "reject corrupt pipeline cache import");

    WGPUPipelineCacheDescriptor reloadDescriptor = {};
    reloadDescriptor.label = text("pipeline-cache-reload");
    reloadDescriptor.data = serialized.data();
    reloadDescriptor.size = serialized.size();
    WGPUPipelineCache reloadedCache = wgpuDeviceCreatePipelineCache(device, &reloadDescriptor);
    require(reloadedCache != nullptr, "strict pipeline cache reload");

    wgpuRenderPipelineRelease(initialRender);
    wgpuComputePipelineRelease(initialCompute);
    wgpuPipelineCacheRelease(emptyCache);

    WGPURenderPipeline reloadedRender = makeRenderPipeline(device, renderModule, reloadedCache);
    WGPUComputePipeline reloadedCompute = makeComputePipeline(device, computeModule, reloadedCache);
    require(reloadedRender != nullptr, "create reloaded cache render pipeline");
    require(reloadedCompute != nullptr, "create reloaded cache compute pipeline");
    renderAndReadback(device, queue, reloadedRender, reloadedCompute);

    std::vector<uint8_t> reloadedBytes;
    serializedData(reloadedCache, reloadedBytes);
    require(!reloadedBytes.empty(), "serialize reloaded pipeline cache");
    std::cout << "TN_PIPELINE_CACHE:{\"version\":1,\"phase\":\"api-probe\","
              << "\"backend\":\"wgpu-native\",\"featureDiscovered\":true,"
              << "\"featureGranted\":true,\"emptyBytes\":" << emptyBytes.size()
              << ",\"serializedBytes\":" << serialized.size() << ",\"strictReloadAccepted\":true,"
              << "\"corruptImportRejected\":true,\"renderAttached\":true,\"computeAttached\":true}\n";

    wgpuComputePipelineRelease(reloadedCompute);
    wgpuRenderPipelineRelease(reloadedRender);
    wgpuPipelineCacheRelease(reloadedCache);
    wgpuShaderModuleRelease(computeModule);
    wgpuShaderModuleRelease(renderModule);
    wgpuQueueRelease(queue);
    wgpuDeviceRelease(device);
    wgpuAdapterRelease(adapter);
    return 0;
#endif
}
