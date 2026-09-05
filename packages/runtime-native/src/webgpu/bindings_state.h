#pragma once

#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <deque>
#include <functional>
#include <thread>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include "mystral/canvas/canvas2d.h"
#include "mystral/js/engine.h"

#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)
#include <webgpu/webgpu.h>
#include "mystral/webgpu_compat.h"
#endif

namespace mystral::webgpu {

#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)

struct OffscreenCanvas {
    int width = 300;
    int height = 150;
    js::JSValueHandle context2d;
    bool hasContext2d = false;
};

struct TextureInfo {
    WGPUTexture texture = nullptr;
    WGPUTextureFormat format = static_cast<WGPUTextureFormat>(0);
    uint32_t width = 0;
    uint32_t height = 0;
    uint32_t depthOrArrayLayers = 1;
    uint32_t mipLevelCount = 1;
    WGPUTextureDimension dimension = WGPUTextureDimension_2D;
    uint32_t sampleCount = 1;
    bool ownsTexture = true;
    bool accounted = false;
};

struct ShaderModuleMetadata {
    std::string vertexEntryPoint;
    std::string fragmentEntryPoint;
};

struct ShaderModuleMetadataStore {
    using NativeRelease = void (*)(WGPUShaderModule);

    std::unordered_map<WGPUShaderModule, ShaderModuleMetadata> entries;

    bool release(WGPUShaderModule module, NativeRelease releaseNative) {
        const auto entry = entries.find(module);
        if (entry == entries.end()) return false;
        entries.erase(entry);
        releaseNative(module);
        return true;
    }

    void releaseAll(NativeRelease releaseNative) {
        while (!entries.empty()) release(entries.begin()->first, releaseNative);
    }
};

struct BufferInfo {
    WGPUBuffer buffer = nullptr;
    uint64_t size = 0;
    WGPUBufferUsage usage = {};
    bool isMapped = false;
    bool mapPending = false;
    void* mappedData = nullptr;
    uint64_t mappedSize = 0;
    WGPUMapMode mapMode = {};
    bool accounted = false;
};

struct BufferMapRequest {
    uint64_t requestId = 0;
    uint64_t bufferId = 0;
    WGPUBuffer buffer = nullptr;
    WGPUMapMode mode = WGPUMapMode_None;
    uint64_t offset = 0;
    uint64_t size = 0;
    bool completed = false;
    WGPUBufferMapAsyncStatus_Compat status = WGPUBufferMapAsyncStatus_Unknown_Compat;
    std::string errorMessage;
    std::mutex waitMutex;
};

struct AsyncBufferMaps {
    std::mutex mutex;
    std::unordered_map<uint64_t, std::shared_ptr<BufferMapRequest>> pending;
    uint64_t nextRequestId = 1;
    bool stopping = false;
};

#if TN_ANDROID_JS_PROFILE
enum class ProfiledRenderCommand : size_t {
    SetPipeline,
    SetBindGroup,
    Draw,
    DrawIndexed,
    BundleDrawIndexed,
    ExecuteBundles,
    SetVertexBuffer,
    SetIndexBuffer,
    WriteBuffer,
    EndRenderPass,
    // The replay's own boundary work, split out so `frameOpReplayNs` has no unexplained
    // remainder: wgpu concentrates a pass's real encoding cost in begin/end, not in the
    // per-draw calls between them, and a submit drags a device poll behind it.
    BeginRenderPass,
    Submit,
    DevicePoll,
    Count
};

enum class ProfiledBufferUsage : size_t {
    Uniform,
    Storage,
    Vertex,
    Index,
    Other,
    Count
};

struct AndroidJsNativeProfile {
    uint64_t counts[static_cast<size_t>(ProfiledRenderCommand::Count)] = {};
    uint64_t commandNs[static_cast<size_t>(ProfiledRenderCommand::Count)] = {};
    uint64_t bindingNs = 0;
    uint64_t frameOpDrainNs = 0;
    uint64_t frameOpReplayNs = 0;
    uint64_t submits = 0;
    uint64_t bundlesExecuted = 0;
    uint64_t writeBufferBytes = 0;
    uint64_t writeBufferSmallCalls = 0;
    uint64_t writeBufferSmallNs = 0;
    uint64_t writeBufferMediumCalls = 0;
    uint64_t writeBufferMediumNs = 0;
    uint64_t writeBufferLargeCalls = 0;
    uint64_t writeBufferLargeNs = 0;
    uint64_t writeBufferUsageCalls[static_cast<size_t>(ProfiledBufferUsage::Count)] = {};
    uint64_t writeBufferUsageBytes[static_cast<size_t>(ProfiledBufferUsage::Count)] = {};
    uint64_t writeBufferUsageNs[static_cast<size_t>(ProfiledBufferUsage::Count)] = {};
    uint64_t writeBufferFullCalls = 0;
    uint64_t writeBufferPartialCalls = 0;
    std::unordered_set<WGPUBuffer> writeBufferTargets;
};
#endif

#if defined(MYSTRAL_WEBGPU_WGPU) && TN_WEBGPU_UPLOAD_STAGING
struct UploadStagingCopy {
    WGPUBuffer destination;
    uint64_t destinationOffset;
    uint64_t stagingOffset;
    uint64_t size;
};

// Semantics-preserving upload staging for wgpu-native builds (PRD-222). Each queue.writeBuffer
// memcpy's its bytes into a CPU scratch arena instead of driving wgpu-native's per-write
// staging map/unmap cycle — the Pixel 8's largest measured seam cost at 538 writes/frame. A
// boundary operation (queue.submit, writeTexture, mapAsync, onSubmittedWorkDone, the internal
// presentation blit) performs ONE async map of a COPY_SRC block, one bulk copy of the arena,
// one unmap, then records the batch as copies in a single command buffer and submits it once,
// so queue-order semantics are unchanged. The block is never mapped while the GPU can observe
// it: a mapped buffer may appear in no submitted command.
//
// Blocks retire through work-done callbacks because staged bytes stay in flight until their
// flush's submit completes; a retired block is recycled only after its callback fires. When no
// block is available and one cannot be created, the batch falls back to direct queue writes.
struct UploadStagingBlock {
    WGPUBuffer buffer = nullptr;
    uint8_t* mapped = nullptr;                   // non-null only while host-mapped
};

struct UploadStaging {
    static constexpr uint64_t kBlockBytes = 1u << 20;
    // Payloads land here at writeBuffer() time (spec copies eagerly); a flush moves the whole
    // window through one mapped block. Offsets in `pendingCopies.stagingOffset` index this
    // arena, and the same offsets index the block after the flush's single bulk copy.
    std::vector<uint8_t> scratch;
    UploadStagingBlock current;                  // reserved by the active flush
    std::vector<UploadStagingBlock> retired;     // submitted; work-done has not fired yet
    std::vector<UploadStagingBlock> ready;       // completed, reusable, always unmapped
    std::vector<UploadStagingCopy> pendingCopies; // batched, not yet submitted
    bool disabled = false;                       // set when staging cannot allocate; go direct
};
#endif

struct ResourceRegistries {
    std::vector<js::JSValueHandle> protectedHandles;
#if defined(MYSTRAL_WEBGPU_WGPU) && TN_WEBGPU_UPLOAD_STAGING
    UploadStaging uploadStaging;
#endif
    WGPURenderPassEncoder jsRenderPass = nullptr;
    WGPUComputePassEncoder jsComputePass = nullptr;
    WGPUCommandEncoder jsCommandEncoder = nullptr;
    // Shared GPUCommandEncoder prototype carrying the once-installed binding table (PRD-222).
    // Empty until the first encoder wrapper exists; frozen methods hold no native handles.
    js::JSValueHandle commandEncoderPrototype = {};
    // Same mechanism, widened to GPURenderPassEncoder (PRD-224 phase 2). The shared `end` resolves
    // its command encoder from the receiver through `encoderRenderPassMap` at call time — never
    // captured — so one prototype serves every legacy native pass. Production frames use the
    // packed recorder instead.
    js::JSValueHandle renderPassPrototype = {};
    std::unordered_set<WGPUCommandEncoder> commandEncoderRegistry;
    std::unordered_map<WGPUCommandEncoder, WGPURenderPassEncoder> encoderRenderPassMap;
    std::unordered_map<WGPUCommandEncoder, WGPUComputePassEncoder> encoderComputePassMap;
    std::unordered_map<uint64_t, TextureInfo> textureRegistry;
    uint64_t nextTextureId = 1;
    std::shared_ptr<ShaderModuleMetadataStore> shaderModuleMetadata = std::make_shared<ShaderModuleMetadataStore>();
    std::unordered_map<uint64_t, BufferInfo> bufferRegistry;
#if TN_ANDROID_JS_PROFILE
    std::unordered_map<WGPUBuffer, BufferInfo> androidJsProfileBufferRegistry;
#endif
    uint64_t nextBufferId = 1;
    std::unordered_map<uint64_t, WGPUComputePipeline> computePipelineRegistry;
    uint64_t nextComputePipelineId = 1;
    std::unordered_map<uint64_t, WGPURenderPipeline> renderPipelineRegistry;
    uint64_t nextRenderPipelineId = 1;
    // Resources referenced by the packed frame stream have stable numeric registry ids.
    std::unordered_map<uint64_t, WGPUBindGroup> bindGroupRegistry;
    uint64_t nextBindGroupId = 1;
    std::unordered_map<uint64_t, WGPUTextureView> textureViewRegistry;
    uint64_t nextTextureViewId = 1;
    std::unordered_map<uint64_t, WGPURenderBundle> renderBundleRegistry;
    uint64_t nextRenderBundleId = 1;
    // Timestamp query sets. Registered by id like every other resource the packed frame stream
    // references, because `timestampWrites` names a query set from inside a pass descriptor and
    // the stream carries ids, never handles.
    std::unordered_map<uint64_t, WGPUQuerySet> querySetRegistry;
    uint64_t nextQuerySetId = 1;
    std::vector<std::unique_ptr<WGPUBlendState>> blendStates;
};

struct PresentationState {
    WGPUPresentMode presentMode = WGPUPresentMode_Fifo;
    WGPUTexture offscreenTexture = nullptr;
    WGPUTextureView offscreenTextureView = nullptr;
    WGPUTextureFormat surfaceFormat = WGPUTextureFormat_BGRA8UnormSrgb;
    WGPUTextureFormat nativeSurfaceFormat = WGPUTextureFormat_BGRA8UnormSrgb;
    bool requiresSrgbPresentationBridge = false;
    WGPURenderPipeline srgbPresentationPipeline = nullptr;
    WGPUBindGroupLayout srgbPresentationBindGroupLayout = nullptr;
    uint32_t canvasWidth = 800;
    uint32_t canvasHeight = 600;
    bool contextConfigured = false;
    WGPUTexture currentTexture = nullptr;
    WGPUTextureView currentTextureView = nullptr;
    // A renderer may create multiple views of one canvas texture in a frame (for example an
    // MSAA resolve target plus a later overlay). They all retain the acquired surface output.
    std::unordered_map<uint64_t, WGPUTextureView> currentSurfaceTextureViews;
    uint64_t currentSurfaceTextureId = 0;
    WGPUTexture currentViewSourceTexture = nullptr;
    bool surfaceRenderPassEnded = false;
    bool framePresentPending = false;
    WGPUCommandEncoder surfaceRenderEncoder = nullptr;
};

// Scratch owned by the bindings state so a packed frame does not rebuild its registries and
// temporary argument vectors on every replay. The maps are cleared at the replay boundary, while
// their buckets and vector capacities stay warm for the next frame.
struct FrameReplayState {
    std::unordered_map<uint32_t, WGPUCommandEncoder> encoders;
    std::unordered_map<uint32_t, WGPURenderPassEncoder> renderPasses;
    std::unordered_map<uint32_t, WGPUCommandEncoder> renderOwners;
    std::unordered_map<uint32_t, WGPUComputePassEncoder> computePasses;
    std::unordered_map<uint32_t, WGPUCommandEncoder> computeOwners;
    std::unordered_map<uint32_t, WGPUCommandBuffer> commandBuffers;
    std::vector<WGPURenderPassColorAttachment> renderPassColors;
    std::vector<uint32_t> dynamicOffsets;
    std::vector<WGPURenderBundle> renderBundles;
    std::vector<std::pair<uint32_t, WGPUCommandBuffer>> submittedCommandBuffers;
    std::vector<WGPUCommandBuffer> rawCommandBuffers;
    std::vector<uint8_t> externalImageCrop;
};

struct FrameProfiling {
    uint64_t frameEndCount = 0;
#if TN_ANDROID_JS_PROFILE
    AndroidJsNativeProfile androidJsNativeProfile;
    bool presentReportedSinceLastPresent = false;
#endif
    uint64_t lastPresentNs = 0;
    uint64_t lastPresentThreadCpuNs = 0;
    // Wall-clock split of one endDawnFrame() call for the host-gap decomposition (TN_HOST_GAP,
    // PRD-227 task 1). `otherNs` is the call's remainder after drain, replay, present and poll —
    // profiling emission, canvas 2D compositing and the present-pacing bookkeeping. Zeroed at
    // every endDawnFrame() entry; the runtime reads them right after the call returns.
    uint64_t framePhaseDrainNs = 0;
    uint64_t framePhaseReplayNs = 0;
    uint64_t framePhasePresentNs = 0;
    // Diagnostic-only blocking wait after present. It adds to the callback period and is observed
    // in the following callback's residual hostGap, because that meter spans host work between rAFs.
    uint64_t framePhaseGpuDrainNs = 0;
    uint64_t framePhasePollNs = 0;
    uint64_t framePhaseOtherNs = 0;
    // Render-thread CPU clock at the previous profile emission. Wall-clock phase timings on a
    // FIFO-presented surface are mostly vblank wait; the delta of this clock is the work.
    uint64_t lastRenderThreadCpuNs = 0;
    uint64_t presentCount = 0;
    uint64_t textureBytesLive = 0;
    uint64_t textureBytesCreated = 0;
    uint64_t textureCountLive = 0;
    std::unordered_map<std::string, std::pair<uint64_t, uint64_t>> textureBuckets;
    uint64_t bufferBytesLive = 0;
    uint64_t bufferCountLive = 0;
    std::unordered_map<std::string, std::pair<uint64_t, uint64_t>> bufferBuckets;
    // Production frame recorder drain, installed when requestDevice creates the device wrapper.
    // The host invokes it once after all rAF callbacks and replays the returned operations here.
    js::JSValueHandle frameOpStreamDrain{};
    // Set while a mid-frame flush is replaying, so a nested flush cannot re-enter the drain.
    bool frameOpStreamFlushing = false;
    uint64_t frameOpStreamReplayCrossings = 0;
    uint64_t frameOpStreamDirectCommandCalls = 0;
    uint64_t frameOpStreamLastOpCount = 0;
    bool captureFrameOpStreamTrace = false;
    std::vector<std::string> frameOpStreamLastOrder;
    // Test-only observer. Production leaves it null; malformed replay tests use it to prove a
    // failed native handle lookup never reaches the corresponding wgpu-native entry point.
    void (*frameOpStreamNativeCallObserver)(const char*) = nullptr;
    int frameCount = 0;
    int submitCount = 0;
    bool firstPresentReported = false;
    uint32_t reportTickIndex = 0;
    std::chrono::steady_clock::time_point reportLastTick{};
};

struct ScreenshotCapture {
    WGPUBuffer screenshotBuffer = nullptr;
    size_t screenshotBufferSize = 0;
    uint32_t screenshotBytesPerRow = 0;
    bool screenshotRequested = false;
    bool screenshotReady = false;
    bool screenshotCapturedThisFrame = false;
    std::vector<uint8_t> screenshotData;
    void (*videoCaptureCallback)(void*, uint32_t, uint32_t, void*) = nullptr;
    void* videoCaptureUserData = nullptr;
};

struct Canvas2DComposite {
    std::vector<std::unique_ptr<canvas::Canvas2DContext>> canvas2DContexts;
    canvas::Canvas2DContext* mainCanvas2DContext = nullptr;
    std::unordered_map<int, std::unique_ptr<OffscreenCanvas>> offscreenCanvases;
    int nextOffscreenCanvasId = 0;
    WGPUTexture canvas2DTexture = nullptr;
    WGPURenderPipeline canvas2DPipeline = nullptr;
    WGPUBindGroup canvas2DBindGroup = nullptr;
    WGPUSampler canvas2DSampler = nullptr;
    uint32_t canvas2DTextureWidth = 0;
    uint32_t canvas2DTextureHeight = 0;
};

/**
 * One finished off-thread pipeline compile, waiting for the game thread to hand it to JavaScript.
 *
 * PRD-327. Compiles run on a small host pool because the entry that would let the backend do it —
 * `wgpuDeviceCreateRenderPipelineAsync` — is `unimplemented!()` on wgpu-native and aborts the
 * process, and wgpu-native is what Android ships. Only the game thread may enter the JS engine, so
 * a worker never touches the promise: it pushes one of these and `pollEvents()` settles it in the
 * same `kIo` segment that already delivers worker messages.
 */
struct PipelineCompileCompletion {
    uint64_t requestId = 0;
    bool render = true;
    WGPURenderPipeline renderPipeline = nullptr;
    WGPUComputePipeline computePipeline = nullptr;
    std::string error;
};

/** The compile pool's shared state. Owned by `BindingsState`, drained on the game thread. */
struct AsyncPipelineCompiles {
    std::mutex mutex;
    std::condition_variable wake;
    std::deque<std::function<void()>> queue;
    std::vector<std::thread> workers;
    std::mutex completedMutex;
    std::vector<PipelineCompileCompletion> completed;
    uint64_t nextRequestId = 1;
    bool stopping = false;
    /** Requests started and not yet settled. `TN_WARMUP` reads the difference. */
    uint64_t started = 0;
    uint64_t settled = 0;
};

struct BindingsState {
    bool verboseLogging = false;

    WGPUDevice device = nullptr;
    WGPUAdapter adapter = nullptr;
    WGPUQueue queue = nullptr;
    WGPUSurface surface = nullptr;
    WGPUInstance instance = nullptr;
    js::Engine* engine = nullptr;

    ResourceRegistries registries;
    PresentationState presentation;
    FrameReplayState frameReplay;
    FrameProfiling profiling;
    ScreenshotCapture screenshot;
    Canvas2DComposite canvas2D;
    AsyncBufferMaps asyncBufferMaps;
    AsyncPipelineCompiles asyncPipelines;
};

void flushUploadStaging(BindingsState* state);
uint64_t readRenderThreadCpuNs();

#else

struct BindingsState {
    bool verboseLogging = false;
    js::Engine* engine = nullptr;
    std::vector<js::JSValueHandle> protectedHandles;
    std::vector<std::unique_ptr<canvas::Canvas2DContext>> canvas2DContexts;
};

#endif

void captureFrameScreenshot(BindingsState* state);

}  // namespace mystral::webgpu
