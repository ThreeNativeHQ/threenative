#pragma once

#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>
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

struct BufferInfo {
    WGPUBuffer buffer = nullptr;
    uint64_t size = 0;
    WGPUBufferUsage usage = {};
    bool isMapped = false;
    void* mappedData = nullptr;
    uint64_t mappedSize = 0;
    WGPUMapMode mapMode = {};
    bool accounted = false;
};

struct BufferMapData {
    bool completed = false;
    WGPUBufferMapAsyncStatus_Compat status = WGPUBufferMapAsyncStatus_Unknown_Compat;
    std::string errorMessage;
    std::mutex waitMutex;
    std::condition_variable waitCondition;
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
    Count
};

struct AndroidJsNativeProfile {
    uint64_t counts[static_cast<size_t>(ProfiledRenderCommand::Count)] = {};
    uint64_t commandNs[static_cast<size_t>(ProfiledRenderCommand::Count)] = {};
    uint64_t bindingNs = 0;
    uint64_t bundlesExecuted = 0;
    uint64_t writeBufferBytes = 0;
    uint64_t writeBufferSmallCalls = 0;
    uint64_t writeBufferMediumCalls = 0;
    uint64_t writeBufferLargeCalls = 0;
    std::unordered_set<WGPUBuffer> writeBufferTargets;
};
#endif

struct BindingsState {
    bool verboseLogging = false;

    WGPUDevice device = nullptr;
    WGPUAdapter adapter = nullptr;
    WGPUQueue queue = nullptr;
    WGPUSurface surface = nullptr;
    WGPUPresentMode presentMode = WGPUPresentMode_Fifo;
    WGPUInstance instance = nullptr;
    js::Engine* engine = nullptr;
    std::vector<js::JSValueHandle> protectedHandles;
    std::vector<std::unique_ptr<canvas::Canvas2DContext>> canvas2DContexts;

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
    uint64_t frameEndCount = 0;

#if TN_ANDROID_JS_PROFILE
    AndroidJsNativeProfile androidJsNativeProfile;
    bool presentReportedSinceLastPresent = false;
#endif

    WGPUTexture currentTexture = nullptr;
    WGPUTextureView currentTextureView = nullptr;
    uint64_t currentSurfaceTextureId = 0;
    WGPUTexture currentViewSourceTexture = nullptr;
    WGPUBuffer screenshotBuffer = nullptr;
    size_t screenshotBufferSize = 0;
    uint32_t screenshotBytesPerRow = 0;
    WGPURenderPassEncoder jsRenderPass = nullptr;
    WGPUComputePassEncoder jsComputePass = nullptr;
    WGPUCommandEncoder jsCommandEncoder = nullptr;
    std::unordered_set<WGPUCommandEncoder> commandEncoderRegistry;
    std::unordered_map<WGPUCommandEncoder, WGPURenderPassEncoder> encoderRenderPassMap;
    std::unordered_map<WGPUCommandEncoder, WGPUComputePassEncoder> encoderComputePassMap;
    bool surfaceRenderPassEnded = false;
    bool framePresentPending = false;
    uint64_t lastPresentNs = 0;
    uint64_t presentCount = 0;
    uint64_t textureBytesLive = 0;
    uint64_t textureBytesCreated = 0;
    uint64_t textureCountLive = 0;
    std::unordered_map<std::string, std::pair<uint64_t, uint64_t>> textureBuckets;
    uint64_t bufferBytesLive = 0;
    uint64_t bufferCountLive = 0;
    std::unordered_map<std::string, std::pair<uint64_t, uint64_t>> bufferBuckets;
    WGPUCommandEncoder surfaceRenderEncoder = nullptr;
    bool screenshotRequested = false;
    bool screenshotReady = false;
    bool screenshotCapturedThisFrame = false;
    std::vector<uint8_t> screenshotData;
    canvas::Canvas2DContext* mainCanvas2DContext = nullptr;
    std::unordered_map<uint64_t, TextureInfo> textureRegistry;
    uint64_t nextTextureId = 1;
    std::unordered_map<uint64_t, BufferInfo> bufferRegistry;
    uint64_t nextBufferId = 1;
    std::unordered_map<uint64_t, WGPUComputePipeline> computePipelineRegistry;
    uint64_t nextComputePipelineId = 1;
    std::unordered_map<uint64_t, WGPURenderPipeline> renderPipelineRegistry;
    uint64_t nextRenderPipelineId = 1;
    std::vector<std::unique_ptr<WGPUBlendState>> blendStates;
    BufferMapData bufferMapData;
    std::unordered_map<int, std::unique_ptr<OffscreenCanvas>> offscreenCanvases;
    int nextOffscreenCanvasId = 0;
    int frameCount = 0;
    int submitCount = 0;
    bool firstPresentReported = false;
    uint32_t reportTickIndex = 0;
    std::chrono::steady_clock::time_point reportLastTick{};
    WGPUTexture canvas2DTexture = nullptr;
    WGPURenderPipeline canvas2DPipeline = nullptr;
    WGPUBindGroup canvas2DBindGroup = nullptr;
    WGPUSampler canvas2DSampler = nullptr;
    uint32_t canvas2DTextureWidth = 0;
    uint32_t canvas2DTextureHeight = 0;
    void (*videoCaptureCallback)(void*, uint32_t, uint32_t, void*) = nullptr;
    void* videoCaptureUserData = nullptr;
};

#else

struct BindingsState {
    bool verboseLogging = false;
    js::Engine* engine = nullptr;
    std::vector<js::JSValueHandle> protectedHandles;
    std::vector<std::unique_ptr<canvas::Canvas2DContext>> canvas2DContexts;
};

#endif

}  // namespace mystral::webgpu
