/**
 * WebGPU JavaScript Bindings
 *
 * This file exposes the WebGPU API to JavaScript via the JS engine abstraction.
 * Both Dawn and wgpu-native implement the same webgpu.h C API, so the bindings
 * work with either backend.
 *
 * Key APIs exposed:
 * - canvas (global) - represents the window
 * - canvas.getContext('webgpu') -> GPUCanvasContext
 * - navigator.gpu
 * - navigator.gpu.requestAdapter() -> GPUAdapter
 * - GPUAdapter.requestDevice() -> GPUDevice
 * - GPUDevice.createBuffer()
 * - GPUDevice.createShaderModule()
 * - GPUDevice.createRenderPipeline()
 * - GPUDevice.createCommandEncoder()
 * - GPUQueue.submit()
 */

#include "mystral/js/engine.h"
#include "mystral/webgpu/bindings.h"
#include "mystral/webgpu/registration_table.h"
#include "mystral/webgpu/wrapper_factories.h"
#include "mystral/cold_start.h"
#include "mystral/stall_budget.h"
#include "runtime_scripts.h"
#include "mystral/webgpu/checked_handle.h"
#include <iostream>
#include <vector>
#include <unordered_map>
#include <string>
#include <fstream>
#include <thread>
#include <chrono>
#include <atomic>
#include <cstring>
#include <cmath>
#include <limits>
#include <sstream>
#include <algorithm>
#include <string_view>

#if defined(__APPLE__)
#include <os/log.h>
#endif

#if defined(__ANDROID__)
#include <android/log.h>
#endif

// stb_image for image loading (implementation in stb_impl.cpp)
#include "stb_image.h"

// libwebp for WebP image decoding (optional - for GLTF EXT_texture_webp extension)
#ifdef MYSTRAL_HAS_WEBP
#include <webp/decode.h>
#endif

// Canvas 2D context (Skia-backed)
#include "mystral/canvas/canvas2d.h"
#include "bindings_state.h"
#include "surface_texture_transaction.h"

// Forward declaration for Canvas2D bindings
namespace mystral {
namespace canvas {
    js::JSValueHandle createCanvas2DContext(
        js::Engine* engine,
        int width,
        int height,
        std::vector<std::unique_ptr<Canvas2DContext>>& ownedContexts);
}
}

#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)
#include <webgpu/webgpu.h>
#if defined(MYSTRAL_WEBGPU_WGPU)
#if __has_include(<webgpu/wgpu.h>)
#include <webgpu/wgpu.h>
#else
#include <wgpu/wgpu.h>
#endif
#endif
#include "mystral/webgpu_compat.h"
#endif

// wgpu-native specific extension functions (not in standard webgpu.h)
#if defined(MYSTRAL_WEBGPU_WGPU) && !defined(MYSTRAL_WEBGPU_WGPU_MODERN)
extern "C" {
// Device poll - blocks until GPU work is done
// From wgpu/wgpu.h but declared here to avoid include path issues
typedef struct WGPUWrappedSubmissionIndex WGPUWrappedSubmissionIndex;
WGPUBool wgpuDevicePoll(WGPUDevice device, WGPUBool wait, WGPUWrappedSubmissionIndex const* wrappedSubmissionIndex);
}
#endif

namespace mystral {
namespace webgpu {


// ---------------------------------------------------------------------------
// Presentation ceiling (PRD-218)
// ---------------------------------------------------------------------------
//
// A convention that ships on: a game presents at most `g_presentationCapHz` frames a second, and
// runs uncapped only when it asks to.
//
// The measurement that bought this: on a Pixel 8, a build whose whole scene was a static dark
// screen with three textures held **119.8 presents per second, indefinitely**. `fifo` vsync was
// the only ceiling in the runtime, so on a 120 Hz panel a loading screen, a pause menu or a game
// that has finished drawing burns the SoC at the panel's rate for no visible benefit -- the phone
// warms and the battery drains to present the same pixels twice. Nothing in the frame was
// expensive; that was exactly the problem.
//
// 60 Hz is the default because it is the rate every game in this repository was authored against
// and half of the common high-refresh panel, so a frame is presented on every second vsync
// interval rather than at an unrelated period that would judder against it.
//
// Honesty when overridden is part of the convention, not a nicety: the effective cap rides along
// in every `TN_PRESENTS_TICK`, so a probe that reads 120 presents a second can tell "the game
// opted out" from "the cap is broken" without reading the game's source.
static uint32_t g_presentationCapHz = 60;

/** The pacing deadline for the next present. Zero until the first paced frame. */
static std::chrono::steady_clock::time_point g_nextPresentDeadline{};

/**
 * Holds the loop back to the presentation ceiling, after a frame that actually presented.
 *
 * Only after a present, and never during startup: the launch stall this same PRD measures has no
 * presents in it at all, and pacing an unpresented loop would add sleep to the twelve seconds a
 * player already waits. A frame that misses its deadline resets the schedule instead of trying to
 * catch up, because a game running below the cap must not then be asked to present a burst.
 */
static void paceToPresentationCap() {
    if (g_presentationCapHz == 0) return;
    using clock = std::chrono::steady_clock;
    const auto interval = std::chrono::nanoseconds(1000000000ull / g_presentationCapHz);
    const auto now = clock::now();
    if (g_nextPresentDeadline == clock::time_point{} || now > g_nextPresentDeadline + interval) {
        // First paced frame, or the loop fell far enough behind that the old schedule is stale.
        g_nextPresentDeadline = now + interval;
        return;
    }
    if (now < g_nextPresentDeadline) std::this_thread::sleep_until(g_nextPresentDeadline);
    g_nextPresentDeadline += interval;
}

static js::JSValueHandle evalEmbeddedRuntimeScriptWithResult(
    js::Engine& engine, std::string_view name, const char* filename) {
    const auto script = runtime_scripts::find(name);
    if (!script.data) {
        std::cerr << "[WebGPU] missing embedded runtime script: " << name << std::endl;
        return {};
    }
    const std::string source(script.data, script.size);
    return engine.evalScriptWithResult(source.c_str(), filename);
}

static bool evalEmbeddedRuntimeScript(
    js::Engine& engine, std::string_view name, const char* filename) {
    const auto script = runtime_scripts::find(name);
    if (!script.data) {
        std::cerr << "[WebGPU] missing embedded runtime script: " << name << std::endl;
        return false;
    }
    const std::string source(script.data, script.size);
    return engine.eval(source.c_str(), filename);
}

BindingsState* createBindingsState() {
    return new BindingsState();
}

void destroyBindingsState(BindingsState*& state) {
    if (!state) return;
    BindingsState* ownedState = state;
    state = nullptr;
    {
        BindingsState* state = ownedState;
        if (state->engine) {
            js::Engine* engine = state->engine;
            state->engine = nullptr;
            for (auto it = state->protectedHandles.rbegin();
                 it != state->protectedHandles.rend();
                 ++it) {
                engine->freeHandle(*it);
            }
            state->protectedHandles.clear();
        }
        state->canvas2DContexts.clear();
#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)
        while (!state->textureRegistry.empty()) {
            releaseTextureRegistryEntry(state, state->textureRegistry.begin()->first);
        }
        while (!state->bufferRegistry.empty()) {
            releaseBufferRegistryEntry(state, state->bufferRegistry.begin()->first);
        }
        while (!state->computePipelineRegistry.empty()) {
            releaseComputePipelineRegistryEntry(
                state, state->computePipelineRegistry.begin()->first);
        }
        while (!state->renderPipelineRegistry.empty()) {
            releaseRenderPipelineRegistryEntry(
                state, state->renderPipelineRegistry.begin()->first);
        }
        for (const auto& entry : state->encoderRenderPassMap) {
            if (entry.second) {
                wgpuRenderPassEncoderEnd(entry.second);
                wgpuRenderPassEncoderRelease(entry.second);
            }
        }
        state->encoderRenderPassMap.clear();
        for (const auto& entry : state->encoderComputePassMap) {
            if (entry.second) {
                wgpuComputePassEncoderEnd(entry.second);
                wgpuComputePassEncoderRelease(entry.second);
            }
        }
        state->encoderComputePassMap.clear();
        state->jsRenderPass = nullptr;
        state->jsComputePass = nullptr;
        if (state->jsCommandEncoder &&
            state->commandEncoderRegistry.find(state->jsCommandEncoder) ==
                state->commandEncoderRegistry.end()) {
            wgpuCommandEncoderRelease(state->jsCommandEncoder);
        }
        for (const auto encoder : state->commandEncoderRegistry) {
            if (encoder) wgpuCommandEncoderRelease(encoder);
        }
        state->commandEncoderRegistry.clear();
        state->jsCommandEncoder = nullptr;
        state->mainCanvas2DContext = nullptr;
        if (state->canvas2DBindGroup) wgpuBindGroupRelease(state->canvas2DBindGroup);
        if (state->canvas2DPipeline) wgpuRenderPipelineRelease(state->canvas2DPipeline);
        if (state->canvas2DSampler) wgpuSamplerRelease(state->canvas2DSampler);
        if (state->canvas2DTexture) {
            wgpuTextureDestroy(state->canvas2DTexture);
            wgpuTextureRelease(state->canvas2DTexture);
        }
        if (state->screenshotBuffer) {
            wgpuBufferDestroy(state->screenshotBuffer);
            wgpuBufferRelease(state->screenshotBuffer);
        }
        if (state->currentTextureView) wgpuTextureViewRelease(state->currentTextureView);
        if (state->currentTexture && state->surface) {
            wgpuTextureRelease(state->currentTexture);
        }
        if (state->srgbPresentationPipeline) {
            wgpuRenderPipelineRelease(state->srgbPresentationPipeline);
        }
        if (state->srgbPresentationBindGroupLayout) {
            wgpuBindGroupLayoutRelease(state->srgbPresentationBindGroupLayout);
        }
#endif
        delete state;
    }
}

static void protectBindingHandle(BindingsState* state, js::JSValueHandle value) {
    if (!state || !state->engine || !value.ptr) return;
    for (const auto& protectedHandle : state->protectedHandles) {
        if (protectedHandle.ptr == value.ptr) return;
    }
    state->engine->freezeHandle(value);
    state->protectedHandles.push_back(value);
}

static void unprotectBindingHandle(BindingsState* state, js::JSValueHandle value) {
    if (!state || !state->engine || !value.ptr) return;
    for (auto it = state->protectedHandles.begin(); it != state->protectedHandles.end(); ++it) {
        if (it->ptr == value.ptr) {
            state->engine->freeHandle(*it);
            state->protectedHandles.erase(it);
            return;
        }
    }
}

static void rollbackOwnedCanvas2DContext(BindingsState* state, js::JSValueHandle context) {
    if (!state || !state->engine || !context.ptr) return;
    auto* nativeContext = static_cast<canvas::Canvas2DContext*>(state->engine->getPrivateData(context));
    if (nativeContext) {
        for (auto it = state->canvas2DContexts.begin(); it != state->canvas2DContexts.end(); ++it) {
            if (it->get() == nativeContext) {
                state->canvas2DContexts.erase(it);
                break;
            }
        }
    }
    unprotectBindingHandle(state, context);
}

static void rollbackOffscreenCanvas(BindingsState* state, int canvasId, js::JSValueHandle element) {
    if (!state || !state->engine) return;
    state->offscreenCanvases.erase(canvasId);
    if (state->nextOffscreenCanvasId == canvasId + 1) state->nextOffscreenCanvasId = canvasId;
    const std::string globalName = "__offscreenCanvas_" + std::to_string(canvasId);
    state->engine->deleteProperty(state->engine->getGlobal(), globalName.c_str());
    unprotectBindingHandle(state, element);
}

static js::JSValueHandle createOwnedCanvas2DContext(
    BindingsState* state,
    int width,
    int height) {
    auto context = canvas::createCanvas2DContext(
        state->engine, width, height, state->canvas2DContexts);
    protectBindingHandle(state, context);
    return context;
}

static std::string singleWgslEntryPoint(const std::string& code, const char* stage) {
    const std::string marker = std::string("@") + stage;
    std::string result;
    size_t searchFrom = 0;
    while (true) {
        const size_t markerAt = code.find(marker, searchFrom);
        if (markerAt == std::string::npos) break;
        const size_t functionAt = code.find("fn", markerAt + marker.size());
        if (functionAt == std::string::npos) break;
        size_t nameStart = functionAt + 2;
        while (nameStart < code.size() &&
               (code[nameStart] == ' ' || code[nameStart] == '\t' ||
                code[nameStart] == '\r' || code[nameStart] == '\n')) {
            ++nameStart;
        }
        size_t nameEnd = nameStart;
        while (nameEnd < code.size()) {
            const char character = code[nameEnd];
            const bool identifier =
                (character >= 'a' && character <= 'z') ||
                (character >= 'A' && character <= 'Z') ||
                (character >= '0' && character <= '9') || character == '_';
            if (!identifier) break;
            ++nameEnd;
        }
        if (nameEnd == nameStart || !result.empty()) return {};
        result = code.substr(nameStart, nameEnd - nameStart);
        searchFrom = nameEnd;
    }
    return result;
}

// Canvas context state
// The format exposed to JavaScript may differ from the native presentation format. Some
// Android surfaces expose only an sRGB attachment. Three.js already writes display-encoded
// output, so rendering it directly into that attachment applies the transfer twice. In that
// case JavaScript renders into the matching linear format and a native fullscreen pass
// linearizes once before the sRGB surface stores it.
#if TN_ANDROID_JS_PROFILE
static void profilingBusyLoop() {
#if TN_ANDROID_JS_PROFILE_BUSY_LOOP
    volatile uint32_t control = 0;
    for (uint32_t i = 0; i < 10000; i++) control = control * 33u + i;
    (void)control;
#endif
}

static std::chrono::steady_clock::time_point beginProfiledBinding() {
    const auto start = std::chrono::steady_clock::now();
    profilingBusyLoop();
    return start;
}

static void endProfiledBinding(
    BindingsState* state,
    ProfiledRenderCommand command,
    std::chrono::steady_clock::time_point start,
    uint64_t count = 1
) {
    const auto elapsed = std::chrono::steady_clock::now() - start;
    const auto elapsedNs =
        static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(elapsed).count());
    const auto index = static_cast<size_t>(command);
    state->androidJsNativeProfile.counts[index] += count;
    state->androidJsNativeProfile.commandNs[index] += elapsedNs;
    state->androidJsNativeProfile.bindingNs += elapsedNs;
}

static void emitAndroidJsNativeProfile(BindingsState* state, uint64_t submitPollNs, uint64_t presentNs) {
    const auto& counts = state->androidJsNativeProfile.counts;
    const auto& commandNs = state->androidJsNativeProfile.commandNs;
    uint64_t calls = 0;
    for (size_t i = 0; i < static_cast<size_t>(ProfiledRenderCommand::Count); i++) {
        calls += counts[i];
    }
    std::ostringstream output;
    output << "TN_ANDROID_JS_NATIVE:{\"engine\":\"" << state->engine->getName()
           << "\",\"calls\":" << calls
           << ",\"bindingNs\":" << state->androidJsNativeProfile.bindingNs
           << ",\"bundlesExecuted\":" << state->androidJsNativeProfile.bundlesExecuted
           << ",\"writeBufferBytes\":" << state->androidJsNativeProfile.writeBufferBytes
           << ",\"writeBufferDistinctTargets\":" << state->androidJsNativeProfile.writeBufferTargets.size()
           << ",\"writeBufferSmallCalls\":" << state->androidJsNativeProfile.writeBufferSmallCalls
           << ",\"writeBufferMediumCalls\":" << state->androidJsNativeProfile.writeBufferMediumCalls
           << ",\"writeBufferLargeCalls\":" << state->androidJsNativeProfile.writeBufferLargeCalls
           << ",\"submitPollNs\":" << submitPollNs
           << ",\"presentNs\":" << presentNs
           << ",\"frame\":" << state->frameEndCount
           << ",\"commands\":{\"setPipeline\":" << counts[static_cast<size_t>(ProfiledRenderCommand::SetPipeline)]
           << ",\"setBindGroup\":" << counts[static_cast<size_t>(ProfiledRenderCommand::SetBindGroup)]
           << ",\"draw\":" << counts[static_cast<size_t>(ProfiledRenderCommand::Draw)]
           << ",\"drawIndexed\":" << counts[static_cast<size_t>(ProfiledRenderCommand::DrawIndexed)]
           << ",\"bundleDrawIndexed\":" << counts[static_cast<size_t>(ProfiledRenderCommand::BundleDrawIndexed)]
           << ",\"executeBundles\":" << counts[static_cast<size_t>(ProfiledRenderCommand::ExecuteBundles)]
           << ",\"setVertexBuffer\":" << counts[static_cast<size_t>(ProfiledRenderCommand::SetVertexBuffer)]
           << ",\"setIndexBuffer\":" << counts[static_cast<size_t>(ProfiledRenderCommand::SetIndexBuffer)]
           << ",\"writeBuffer\":" << counts[static_cast<size_t>(ProfiledRenderCommand::WriteBuffer)]
           << ",\"endRenderPass\":" << counts[static_cast<size_t>(ProfiledRenderCommand::EndRenderPass)]
           << "},\"commandNs\":{\"setPipeline\":" << commandNs[static_cast<size_t>(ProfiledRenderCommand::SetPipeline)]
           << ",\"setBindGroup\":" << commandNs[static_cast<size_t>(ProfiledRenderCommand::SetBindGroup)]
           << ",\"draw\":" << commandNs[static_cast<size_t>(ProfiledRenderCommand::Draw)]
           << ",\"drawIndexed\":" << commandNs[static_cast<size_t>(ProfiledRenderCommand::DrawIndexed)]
           << ",\"bundleDrawIndexed\":" << commandNs[static_cast<size_t>(ProfiledRenderCommand::BundleDrawIndexed)]
           << ",\"executeBundles\":" << commandNs[static_cast<size_t>(ProfiledRenderCommand::ExecuteBundles)]
           << ",\"setVertexBuffer\":" << commandNs[static_cast<size_t>(ProfiledRenderCommand::SetVertexBuffer)]
           << ",\"setIndexBuffer\":" << commandNs[static_cast<size_t>(ProfiledRenderCommand::SetIndexBuffer)]
           << ",\"writeBuffer\":" << commandNs[static_cast<size_t>(ProfiledRenderCommand::WriteBuffer)]
           << ",\"endRenderPass\":" << commandNs[static_cast<size_t>(ProfiledRenderCommand::EndRenderPass)]
           << "}}";
    const std::string marker = output.str();
    std::cout << marker << std::endl;
#if defined(__ANDROID__)
    __android_log_print(ANDROID_LOG_INFO, "MystralRuntime", "%s", marker.c_str());
#endif
    state->androidJsNativeProfile = {};
}
#endif

// Set when a submit has put surface-targeted commands in flight; consumed once per frame by
// presentPendingSurface(). Presenting inside submit meant a frame that submits twice — three.js
// renders the world and then an overlay pass — presented twice, and only the first reached the
// display. See presentPendingSurface().
#if TN_ANDROID_JS_PROFILE
// Present happens once per frame but submits happen several times; without this flag every
// submit marker carried the same previous-frame presentNs and the profile summed it once per
// submit — on the Pixel 8 that read as a phantom ~2.6 ms/frame of native cost at 4.3
// submits/frame. Cleared by each present so the next frame's first submit reports it.
#endif
// One present per frame is the invariant the overlay pass depends on; the desktop gate asserts it.

// GPU texture accounting. Nothing in this runtime has ever reported how much texture memory a
// game holds, so "the process is using 1.6 GB" has never had an answer inside the engine — it had
// to be inferred from `dumpsys meminfo` and guesswork. Every texture this binding creates is
// measured here and reported beside the present tick, keyed by dimensions and format so a
// full-screen render target is distinguishable from an author's 1024x1024 albedo map.
/**
 * Bytes per texel for the formats this runtime actually creates.
 *
 * Deliberately keyed on the WebGPU format *string* rather than the enum: `createTexture` already
 * holds the string, the set is small, and an unknown format reports 4 rather than inventing a
 * number that would make the total silently wrong. Compressed formats are block-based and report
 * their per-texel average.
 */
static double textureBytesPerTexel(const std::string& format) {
    if (format.rfind("bc", 0) == 0 || format.rfind("etc2", 0) == 0 || format.rfind("astc", 0) == 0 ||
        format.rfind("eac", 0) == 0) {
        // ETC2/BC1-class formats are 0.5 bytes/texel; BC3/BC7/ASTC-4x4-class are 1.0. The suffix
        // that distinguishes them is the block size, so read it rather than assume.
        if (format.find("rgba8unorm") != std::string::npos || format.find("bc3") != std::string::npos ||
            format.find("bc7") != std::string::npos || format.find("astc-4x4") != std::string::npos)
            return 1.0;
        return 0.5;
    }
    if (format.find("32float") != std::string::npos || format.find("32uint") != std::string::npos ||
        format.find("32sint") != std::string::npos) {
        if (format.rfind("rgba", 0) == 0) return 16.0;
        if (format.rfind("rg", 0) == 0) return 8.0;
        return 4.0;
    }
    if (format.find("16float") != std::string::npos || format.find("16uint") != std::string::npos ||
        format.find("16sint") != std::string::npos || format.find("16unorm") != std::string::npos) {
        if (format.rfind("rgba", 0) == 0) return 8.0;
        if (format.rfind("rg", 0) == 0) return 4.0;
        return 2.0;
    }
    if (format.rfind("depth32float", 0) == 0) return format.find("stencil") != std::string::npos ? 5.0 : 4.0;
    if (format.rfind("depth24", 0) == 0) return 4.0;
    if (format.rfind("depth16", 0) == 0) return 2.0;
    if (format.rfind("r8", 0) == 0) return 1.0;
    if (format.rfind("rg8", 0) == 0) return 2.0;
    if (format.rfind("rgb10a2", 0) != std::string::npos && format.rfind("rgb10a2", 0) == 0) return 4.0;
    if (format.rfind("rg11b10", 0) == 0) return 4.0;
    return 4.0;
}

/** Records one created texture. `mips` is the declared level count, never a guess. */
static void recordTextureCreated(BindingsState* state, uint32_t width, uint32_t height, uint32_t layers, uint32_t mips,
                                 uint32_t sampleCount, const std::string& format) {
    const double perTexel = textureBytesPerTexel(format);
    double texels = 0.0;
    for (uint32_t level = 0; level < (mips == 0 ? 1u : mips); level += 1) {
        const double w = std::max(1.0, std::floor(static_cast<double>(width) / std::pow(2.0, level)));
        const double h = std::max(1.0, std::floor(static_cast<double>(height) / std::pow(2.0, level)));
        texels += w * h;
    }
    const uint64_t bytes = static_cast<uint64_t>(
        texels * static_cast<double>(layers == 0 ? 1u : layers) *
        static_cast<double>(sampleCount == 0 ? 1u : sampleCount) * perTexel);
    state->textureBytesLive += bytes;
    state->textureBytesCreated += bytes;
    state->textureCountLive += 1;
    std::ostringstream key;
    key << width << "x" << height;
    if (layers > 1) key << "x" << layers;
    key << " " << format;
    if (mips > 1) key << " mips" << mips;
    if (sampleCount > 1) key << " msaa" << sampleCount;
    auto& bucket = state->textureBuckets[key.str()];
    bucket.first += 1;
    bucket.second += bytes;
}

// Buffer accounting, for the same reason as textures: a game's GPU footprint is textures plus
// buffers, and reporting only one half turns "the rest" into guesswork. Bucketed by usage bits so
// vertex/index geometry is distinguishable from per-object uniform churn.
/** Names the usage bits that matter for attribution; anything else reports its raw mask. */
static std::string bufferUsageLabel(uint32_t usage) {
    std::string label;
    if (usage & WGPUBufferUsage_Vertex) label += "vertex|";
    if (usage & WGPUBufferUsage_Index) label += "index|";
    if (usage & WGPUBufferUsage_Uniform) label += "uniform|";
    if (usage & WGPUBufferUsage_Storage) label += "storage|";
    if (usage & WGPUBufferUsage_Indirect) label += "indirect|";
    if (usage & WGPUBufferUsage_CopySrc) label += "copysrc|";
    if (usage & WGPUBufferUsage_CopyDst) label += "copydst|";
    if (usage & WGPUBufferUsage_MapRead) label += "mapread|";
    if (usage & WGPUBufferUsage_MapWrite) label += "mapwrite|";
    if (label.empty()) return "other";
    label.pop_back();
    return label;
}

static void recordBufferCreated(BindingsState* state, uint64_t size, uint32_t usage) {
    state->bufferBytesLive += size;
    state->bufferCountLive += 1;
    auto& bucket = state->bufferBuckets[bufferUsageLabel(usage)];
    bucket.first += 1;
    bucket.second += size;
}
// Set only by a consumer about to read a capture (requestFrameScreenshot). The frame copy and its
// wait are paid on requested frames only — every unrequested presented frame skips both.
// Prevent capturing multiple screenshots per frame (Three.js does multiple queue.submit() per frame)
// Main canvas 2D context and all registries are owned by BindingsState.

// Dawn resource cleanup is handled via Engine::registerRelease(), which sets up
// V8 weak callbacks. When the JS wrapper object is garbage collected (no more
// JS references), the callback fires and releases the Dawn resource.
// This is the same pattern Chrome uses for WebGPU resource lifecycle.

struct ErrorScopeData {
    std::atomic<int> callbackReferences{2};
    std::atomic<bool> completed{false};
    std::mutex waitMutex;
    std::condition_variable waitCondition;
#if WGPU_USES_CALLBACK_INFO_PATTERN
    WGPUPopErrorScopeStatus status = WGPUPopErrorScopeStatus_Force32;
#endif
    WGPUErrorType type = WGPUErrorType_Unknown;
    std::string message;
};

struct QueueWorkDoneData {
    std::atomic<int> callbackReferences{2};
    std::atomic<bool> completed{false};
    std::mutex waitMutex;
    std::condition_variable waitCondition;
    WGPUQueueWorkDoneStatus status = WGPUQueueWorkDoneStatus_Error;
    std::string message;
};

template <typename CallbackData>
static void releaseCallbackData(CallbackData* data) {
    if (data->callbackReferences.fetch_sub(1, std::memory_order_acq_rel) == 1) delete data;
}

#if WGPU_USES_CALLBACK_INFO_PATTERN
static void onErrorScopePopped(WGPUPopErrorScopeStatus status,
                               WGPUErrorType type,
                               WGPUStringView message,
                               void* userdata1,
                               void*) {
    auto* data = static_cast<ErrorScopeData*>(userdata1);
    {
        std::lock_guard<std::mutex> lock(data->waitMutex);
        data->status = status;
        data->type = type;
        data->message = WGPU_PRINT_STRING_VIEW(message);
    }
    data->completed.store(true, std::memory_order_release);
    data->waitCondition.notify_all();
    releaseCallbackData(data);
}
#else
static void onErrorScopePopped(WGPUErrorType type, const char* message, void* userdata) {
    auto* data = static_cast<ErrorScopeData*>(userdata);
    {
        std::lock_guard<std::mutex> lock(data->waitMutex);
        data->type = type;
        data->message = message ? message : "";
    }
    data->completed.store(true, std::memory_order_release);
    data->waitCondition.notify_all();
    releaseCallbackData(data);
}
#endif

#if defined(MYSTRAL_WEBGPU_DAWN)
static void onQueueWorkDone(WGPUQueueWorkDoneStatus status,
                            WGPUStringView message,
                            void* userdata1,
                            void*) {
    auto* data = static_cast<QueueWorkDoneData*>(userdata1);
    {
        std::lock_guard<std::mutex> lock(data->waitMutex);
        data->status = status;
        data->message = WGPU_PRINT_STRING_VIEW(message);
    }
    data->completed.store(true, std::memory_order_release);
    data->waitCondition.notify_all();
    releaseCallbackData(data);
}
#elif defined(MYSTRAL_WEBGPU_WGPU_MODERN)
static void onQueueWorkDone(WGPUQueueWorkDoneStatus status, void* userdata1, void*) {
    auto* data = static_cast<QueueWorkDoneData*>(userdata1);
    {
        std::lock_guard<std::mutex> lock(data->waitMutex);
        data->status = status;
    }
    data->completed.store(true, std::memory_order_release);
    data->waitCondition.notify_all();
    releaseCallbackData(data);
}
#else
static void onQueueWorkDone(WGPUQueueWorkDoneStatus status, void* userdata) {
    auto* data = static_cast<QueueWorkDoneData*>(userdata);
    {
        std::lock_guard<std::mutex> lock(data->waitMutex);
        data->status = status;
    }
    data->completed.store(true, std::memory_order_release);
    data->waitCondition.notify_all();
    releaseCallbackData(data);
}
#endif

template <typename CallbackData>
static bool waitForWebGpuCallback(BindingsState* state, CallbackData* data) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
    while (!data->completed.load(std::memory_order_acquire)) {
#if defined(MYSTRAL_WEBGPU_WGPU)
        if (state->device) wgpuDevicePoll(state->device, false, nullptr);
#else
        if (state->instance) wgpuInstanceProcessEvents(state->instance);
        if (state->device) wgpuDeviceTick(state->device);
#endif
        if (std::chrono::steady_clock::now() >= deadline) return false;
        std::unique_lock<std::mutex> lock(data->waitMutex);
        data->waitCondition.wait_for(lock, std::chrono::milliseconds(1), [data]() {
            return data->completed.load(std::memory_order_acquire);
        });
    }
    return true;
}

static std::string jsStringLiteral(const std::string& value) {
    static constexpr char hex[] = "0123456789abcdef";
    std::string result = "\"";
    for (const unsigned char character : value) {
        switch (character) {
            case '\\': result += "\\\\"; break;
            case '"': result += "\\\""; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default:
                if (character < 0x20) {
                    result += "\\u00";
                    result += hex[(character >> 4) & 0x0f];
                    result += hex[character & 0x0f];
                } else {
                    result += static_cast<char>(character);
                }
        }
    }
    result += '"';
    return result;
}

static js::JSValueHandle resolvedPromise(BindingsState* state, const std::string& expression, const char* filename) {
    const std::string source = "Promise.resolve(" + expression + ")";
    return state->engine->evalScriptWithResult(source.c_str(), filename);
}

static js::JSValueHandle rejectedPromise(BindingsState* state, const std::string& message, const char* filename) {
    const std::string source = "Promise.reject(new Error(" + jsStringLiteral(message) + "))";
    return state->engine->evalScriptWithResult(source.c_str(), filename);
}

static const char* gpuErrorName(WGPUErrorType type) {
    switch (type) {
        case WGPUErrorType_Validation: return "GPUValidationError";
        case WGPUErrorType_OutOfMemory: return "GPUOutOfMemoryError";
        case WGPUErrorType_Internal: return "GPUInternalError";
        default: return "GPUError";
    }
}

#if WGPU_BUFFER_MAP_USES_CALLBACK_INFO
// Dawn buffer map callback (4 params)
static void onBufferMapped(WGPUMapAsyncStatus status, WGPUStringView message, void* userdata1, void* userdata2) {
    auto* data = (BufferMapData*)userdata1;
    {
        std::lock_guard<std::mutex> lock(data->waitMutex);
        data->status = status;
        data->completed = true;
        if (message.data && message.length > 0) {
            data->errorMessage = std::string(message.data, message.length);
        }
    }
    data->waitCondition.notify_all();
}
#else
// wgpu-native buffer map callback (2 params)
static void onBufferMapped(WGPUBufferMapAsyncStatus status, void* userdata) {
    auto* data = (BufferMapData*)userdata;
    {
        std::lock_guard<std::mutex> lock(data->waitMutex);
        data->status = status;
        data->completed = true;
    }
    data->waitCondition.notify_all();
}
#endif

static bool bufferMapCompleted(BufferMapData& data) {
    std::lock_guard<std::mutex> lock(data.waitMutex);
    return data.completed;
}

static WGPUBufferMapAsyncStatus_Compat bufferMapStatus(BufferMapData& data) {
    std::lock_guard<std::mutex> lock(data.waitMutex);
    return data.status;
}

static std::string bufferMapError(BufferMapData& data) {
    std::lock_guard<std::mutex> lock(data.waitMutex);
    return data.errorMessage;
}

/**
 * Convert texture format enum to string
 */
static const char* formatToString(WGPUTextureFormat format) {
    switch (format) {
        case WGPUTextureFormat_BGRA8Unorm: return "bgra8unorm";
        case WGPUTextureFormat_BGRA8UnormSrgb: return "bgra8unorm-srgb";
        case WGPUTextureFormat_RGBA8Unorm: return "rgba8unorm";
        case WGPUTextureFormat_RGBA8UnormSrgb: return "rgba8unorm-srgb";
        case WGPUTextureFormat_R8Unorm: return "r8unorm";
        case WGPUTextureFormat_RG8Unorm: return "rg8unorm";
        case WGPUTextureFormat_R16Float: return "r16float";
        case WGPUTextureFormat_RG16Float: return "rg16float";
        case WGPUTextureFormat_R32Float: return "r32float";
        case WGPUTextureFormat_RG32Float: return "rg32float";
        case WGPUTextureFormat_RGBA16Float: return "rgba16float";
        case WGPUTextureFormat_RGBA32Float: return "rgba32float";
        // Integer formats. three.js reaches for these whenever it stores indices rather than
        // colour in a texture — `BatchedMesh` keeps its per-draw indirection in an `r32uint`
        // texture — and a renderer that cannot name them cannot render a batch.
        case WGPUTextureFormat_R8Uint: return "r8uint";
        case WGPUTextureFormat_R8Sint: return "r8sint";
        case WGPUTextureFormat_RG8Uint: return "rg8uint";
        case WGPUTextureFormat_RG8Sint: return "rg8sint";
        case WGPUTextureFormat_RGBA8Uint: return "rgba8uint";
        case WGPUTextureFormat_RGBA8Sint: return "rgba8sint";
        case WGPUTextureFormat_R16Uint: return "r16uint";
        case WGPUTextureFormat_R16Sint: return "r16sint";
        case WGPUTextureFormat_RG16Uint: return "rg16uint";
        case WGPUTextureFormat_RG16Sint: return "rg16sint";
        case WGPUTextureFormat_RGBA16Uint: return "rgba16uint";
        case WGPUTextureFormat_RGBA16Sint: return "rgba16sint";
        case WGPUTextureFormat_R32Uint: return "r32uint";
        case WGPUTextureFormat_R32Sint: return "r32sint";
        case WGPUTextureFormat_RG32Uint: return "rg32uint";
        case WGPUTextureFormat_RG32Sint: return "rg32sint";
        case WGPUTextureFormat_RGBA32Uint: return "rgba32uint";
        case WGPUTextureFormat_RGBA32Sint: return "rgba32sint";
        case WGPUTextureFormat_R8Snorm: return "r8snorm";
        case WGPUTextureFormat_RG8Snorm: return "rg8snorm";
        case WGPUTextureFormat_RGBA8Snorm: return "rgba8snorm";
        case WGPUTextureFormat_RGB10A2Unorm: return "rgb10a2unorm";
        case WGPUTextureFormat_RG11B10Ufloat: return "rg11b10ufloat";
        case WGPUTextureFormat_Depth24Plus: return "depth24plus";
        case WGPUTextureFormat_Depth24PlusStencil8: return "depth24plus-stencil8";
        case WGPUTextureFormat_Depth32Float: return "depth32float";
        default: return "bgra8unorm";  // Default
    }
}

static uint64_t textureMetricBytes(const TextureInfo& info) {
    const double perTexel = textureBytesPerTexel(formatToString(info.format));
    double texels = 0.0;
    for (uint32_t level = 0; level < (info.mipLevelCount == 0 ? 1u : info.mipLevelCount);
         level += 1) {
        const double width = std::max(
            1.0, std::floor(static_cast<double>(info.width) / std::pow(2.0, level)));
        const double height = std::max(
            1.0, std::floor(static_cast<double>(info.height) / std::pow(2.0, level)));
        texels += width * height;
    }
    return static_cast<uint64_t>(
        texels * static_cast<double>(info.depthOrArrayLayers == 0 ? 1u : info.depthOrArrayLayers) *
        static_cast<double>(info.sampleCount == 0 ? 1u : info.sampleCount) * perTexel);
}

static std::string textureMetricBucket(const TextureInfo& info) {
    std::ostringstream key;
    key << info.width << "x" << info.height;
    if (info.depthOrArrayLayers > 1) key << "x" << info.depthOrArrayLayers;
    key << " " << formatToString(info.format);
    if (info.mipLevelCount > 1) key << " mips" << info.mipLevelCount;
    if (info.sampleCount > 1) key << " msaa" << info.sampleCount;
    return key.str();
}

static void recordTextureDestroyed(BindingsState* state, const TextureInfo& info) {
    if (!info.accounted) return;
    const uint64_t bytes = textureMetricBytes(info);
    state->textureBytesLive = state->textureBytesLive >= bytes
        ? state->textureBytesLive - bytes
        : 0;
    if (state->textureCountLive > 0) state->textureCountLive -= 1;
    const std::string bucketKey = textureMetricBucket(info);
    auto bucket = state->textureBuckets.find(bucketKey);
    if (bucket != state->textureBuckets.end()) {
        if (bucket->second.first > 0) bucket->second.first -= 1;
        bucket->second.second = bucket->second.second >= bytes
            ? bucket->second.second - bytes
            : 0;
        if (bucket->second.first == 0) state->textureBuckets.erase(bucket);
    }
}

static void recordBufferDestroyed(BindingsState* state, const BufferInfo& info) {
    if (!info.accounted) return;
    state->bufferBytesLive = state->bufferBytesLive >= info.size
        ? state->bufferBytesLive - info.size
        : 0;
    if (state->bufferCountLive > 0) state->bufferCountLive -= 1;
    const std::string bucketKey = bufferUsageLabel(static_cast<uint32_t>(info.usage));
    auto bucket = state->bufferBuckets.find(bucketKey);
    if (bucket != state->bufferBuckets.end()) {
        if (bucket->second.first > 0) bucket->second.first -= 1;
        bucket->second.second = bucket->second.second >= info.size
            ? bucket->second.second - info.size
            : 0;
        if (bucket->second.first == 0) state->bufferBuckets.erase(bucket);
    }
}

void releaseTextureRegistryEntry(BindingsState* state, uint64_t textureId) {
    if (!state) return;
    const auto it = state->textureRegistry.find(textureId);
    if (it == state->textureRegistry.end()) return;
    const TextureInfo info = it->second;
    state->textureRegistry.erase(it);
    recordTextureDestroyed(state, info);
    if (state->currentSurfaceTextureId == textureId) state->currentSurfaceTextureId = 0;
    if (info.ownsTexture && info.texture) {
        wgpuTextureDestroy(info.texture);
        wgpuTextureRelease(info.texture);
    }
    if (state->nextTextureId == textureId + 1) state->nextTextureId = textureId;
}

js::JSValueHandle acquireSurfaceTexture(
    BindingsState* state,
    const SurfaceTextureAcquire& acquire,
    const SurfaceTextureWrapper& wrap,
    const SurfaceTextureRelease& release) {
    const WGPUTexture previousCurrentTexture = state->currentTexture;
    const uint64_t previousSurfaceTextureId = state->currentSurfaceTextureId;
    const uint64_t previousNextTextureId = state->nextTextureId;
    const int previousFrameCount = state->frameCount;
    WGPUTexture texture = state->currentTexture;
    uint64_t textureId = state->currentSurfaceTextureId;
    bool createdSurfaceTexture = false;
    if (!texture || textureId == 0) {
        texture = acquire(state);
        if (!texture) {
            state->engine->throwException("Failed to get current texture");
            return state->engine->newUndefined();
        }
        state->currentTexture = texture;
        if (state->frameCount++ < 3 && state->verboseLogging) {
            std::cout << "[Canvas] Got texture: " << texture << std::endl;
        }
        textureId = state->nextTextureId++;
        TextureInfo textureInfo;
        textureInfo.texture = texture;
        textureInfo.format = state->surfaceFormat;
        textureInfo.width = state->canvasWidth;
        textureInfo.height = state->canvasHeight;
        textureInfo.ownsTexture = false;
        state->textureRegistry[textureId] = textureInfo;
        state->currentSurfaceTextureId = textureId;
        createdSurfaceTexture = true;
    }

    const auto jsTexture = wrap(
        state,
        texture,
        textureId,
        state->canvasWidth,
        state->canvasHeight,
        formatToString(state->surfaceFormat),
        createdSurfaceTexture);
    if (createdSurfaceTexture && state->engine->isUndefined(jsTexture) &&
        state->engine->hasException()) {
        if (state->textureRegistry.find(textureId) != state->textureRegistry.end()) {
            releaseTextureRegistryEntry(state, textureId);
        }
        state->currentTexture = previousCurrentTexture;
        state->currentSurfaceTextureId = previousSurfaceTextureId;
        state->nextTextureId = previousNextTextureId;
        state->frameCount = previousFrameCount;
        release(state, texture, previousCurrentTexture);
    }
    return jsTexture;
}

void releaseBufferRegistryEntry(BindingsState* state, uint64_t bufferId) {
    if (!state) return;
    const auto it = state->bufferRegistry.find(bufferId);
    if (it == state->bufferRegistry.end()) return;
    const BufferInfo info = it->second;
    state->bufferRegistry.erase(it);
    recordBufferDestroyed(state, info);
    if (info.buffer) {
        if (info.isMapped) wgpuBufferUnmap(info.buffer);
        wgpuBufferDestroy(info.buffer);
        wgpuBufferRelease(info.buffer);
    }
    if (state->nextBufferId == bufferId + 1) state->nextBufferId = bufferId;
}

void releaseComputePipelineRegistryEntry(BindingsState* state, uint64_t pipelineId) {
    if (!state) return;
    const auto it = state->computePipelineRegistry.find(pipelineId);
    if (it == state->computePipelineRegistry.end()) return;
    if (it->second) wgpuComputePipelineRelease(it->second);
    state->computePipelineRegistry.erase(it);
    if (state->nextComputePipelineId == pipelineId + 1) state->nextComputePipelineId = pipelineId;
}

void releaseRenderPipelineRegistryEntry(BindingsState* state, uint64_t pipelineId) {
    if (!state) return;
    const auto it = state->renderPipelineRegistry.find(pipelineId);
    if (it == state->renderPipelineRegistry.end()) return;
    if (it->second) wgpuRenderPipelineRelease(it->second);
    state->renderPipelineRegistry.erase(it);
    if (state->nextRenderPipelineId == pipelineId + 1) state->nextRenderPipelineId = pipelineId;
}

/**
 * Parse texture format string to enum
 */
static WGPUTextureFormat stringToFormat(const std::string& format) {
    if (format == "bgra8unorm") return WGPUTextureFormat_BGRA8Unorm;
    if (format == "bgra8unorm-srgb") return WGPUTextureFormat_BGRA8UnormSrgb;
    if (format == "rgba8unorm") return WGPUTextureFormat_RGBA8Unorm;
    if (format == "rgba8unorm-srgb") return WGPUTextureFormat_RGBA8UnormSrgb;
    if (format == "r8unorm") return WGPUTextureFormat_R8Unorm;
    if (format == "rg8unorm") return WGPUTextureFormat_RG8Unorm;
    if (format == "r16float") return WGPUTextureFormat_R16Float;
    if (format == "rg16float") return WGPUTextureFormat_RG16Float;
    if (format == "r32float") return WGPUTextureFormat_R32Float;
    if (format == "rg32float") return WGPUTextureFormat_RG32Float;
    if (format == "rgba16float") return WGPUTextureFormat_RGBA16Float;
    if (format == "rgba32float") return WGPUTextureFormat_RGBA32Float;
    // Integer formats, the absence of which is not a missing feature but a wrong picture. An
    // unrecognized name fell through to the BGRA8Unorm default below, so a texture three.js asked
    // to sample as `uint` came back as a float colour format, every bind group built against it
    // failed validation, and the draw using it silently did not happen. `BatchedMesh` allocates an
    // `r32uint` indirection texture, so on this host every batched draw was invalid.
    if (format == "r8uint") return WGPUTextureFormat_R8Uint;
    if (format == "r8sint") return WGPUTextureFormat_R8Sint;
    if (format == "rg8uint") return WGPUTextureFormat_RG8Uint;
    if (format == "rg8sint") return WGPUTextureFormat_RG8Sint;
    if (format == "rgba8uint") return WGPUTextureFormat_RGBA8Uint;
    if (format == "rgba8sint") return WGPUTextureFormat_RGBA8Sint;
    if (format == "r16uint") return WGPUTextureFormat_R16Uint;
    if (format == "r16sint") return WGPUTextureFormat_R16Sint;
    if (format == "rg16uint") return WGPUTextureFormat_RG16Uint;
    if (format == "rg16sint") return WGPUTextureFormat_RG16Sint;
    if (format == "rgba16uint") return WGPUTextureFormat_RGBA16Uint;
    if (format == "rgba16sint") return WGPUTextureFormat_RGBA16Sint;
    if (format == "r32uint") return WGPUTextureFormat_R32Uint;
    if (format == "r32sint") return WGPUTextureFormat_R32Sint;
    if (format == "rg32uint") return WGPUTextureFormat_RG32Uint;
    if (format == "rg32sint") return WGPUTextureFormat_RG32Sint;
    if (format == "rgba32uint") return WGPUTextureFormat_RGBA32Uint;
    if (format == "rgba32sint") return WGPUTextureFormat_RGBA32Sint;
    if (format == "r8snorm") return WGPUTextureFormat_R8Snorm;
    if (format == "rg8snorm") return WGPUTextureFormat_RG8Snorm;
    if (format == "rgba8snorm") return WGPUTextureFormat_RGBA8Snorm;
    if (format == "rgb10a2unorm") return WGPUTextureFormat_RGB10A2Unorm;
    if (format == "rg11b10ufloat") return WGPUTextureFormat_RG11B10Ufloat;
    if (format == "depth24plus") return WGPUTextureFormat_Depth24Plus;
    if (format == "depth24plus-stencil8") return WGPUTextureFormat_Depth24PlusStencil8;
    if (format == "depth32float") return WGPUTextureFormat_Depth32Float;
    // Log unrecognized formats for debugging
    if (!format.empty()) {
        std::cerr << "[WebGPU] Warning: Unrecognized format '" << format << "', defaulting to BGRA8Unorm" << std::endl;
    }
    return WGPUTextureFormat_BGRA8Unorm;  // Default to non-sRGB
}

/**
 * Parse texture dimension string to enum
 */
static WGPUTextureDimension stringToTextureDimension(const std::string& dim) {
    if (dim == "1d") return WGPUTextureDimension_1D;
    if (dim == "2d") return WGPUTextureDimension_2D;
    if (dim == "3d") return WGPUTextureDimension_3D;
    return WGPUTextureDimension_2D;  // Default
}

/**
 * Parse texture view dimension string to enum
 */
static WGPUTextureViewDimension stringToTextureViewDimension(const std::string& dim) {
    if (dim == "1d") return WGPUTextureViewDimension_1D;
    if (dim == "2d") return WGPUTextureViewDimension_2D;
    if (dim == "2d-array") return WGPUTextureViewDimension_2DArray;
    if (dim == "cube") return WGPUTextureViewDimension_Cube;
    if (dim == "cube-array") return WGPUTextureViewDimension_CubeArray;
    if (dim == "3d") return WGPUTextureViewDimension_3D;
    return WGPUTextureViewDimension_2D;  // Default
}

/**
 * Parse address mode string to enum
 */
static WGPUAddressMode stringToAddressMode(const std::string& mode) {
    if (mode == "clamp-to-edge") return WGPUAddressMode_ClampToEdge;
    if (mode == "repeat") return WGPUAddressMode_Repeat;
    if (mode == "mirror-repeat") return WGPUAddressMode_MirrorRepeat;
    return WGPUAddressMode_ClampToEdge;  // Default
}

/**
 * Parse filter mode string to enum
 */
static WGPUFilterMode stringToFilterMode(const std::string& mode) {
    if (mode == "nearest") return WGPUFilterMode_Nearest;
    if (mode == "linear") return WGPUFilterMode_Linear;
    return WGPUFilterMode_Nearest;  // Default
}

/**
 * Parse mipmap filter mode string to enum
 */
static WGPUMipmapFilterMode stringToMipmapFilterMode(const std::string& mode) {
    if (mode == "nearest") return WGPUMipmapFilterMode_Nearest;
    if (mode == "linear") return WGPUMipmapFilterMode_Linear;
    return WGPUMipmapFilterMode_Nearest;  // Default
}

/**
 * Parse compare function string to enum
 */
static WGPUCompareFunction stringToCompareFunction(const std::string& func) {
    if (func == "never") return WGPUCompareFunction_Never;
    if (func == "less") return WGPUCompareFunction_Less;
    if (func == "equal") return WGPUCompareFunction_Equal;
    if (func == "less-equal") return WGPUCompareFunction_LessEqual;
    if (func == "greater") return WGPUCompareFunction_Greater;
    if (func == "not-equal") return WGPUCompareFunction_NotEqual;
    if (func == "greater-equal") return WGPUCompareFunction_GreaterEqual;
    if (func == "always") return WGPUCompareFunction_Always;
    return WGPUCompareFunction_Undefined;  // Default (no comparison)
}

static bool isSrgbSurfaceFormat(WGPUTextureFormat format) {
    return format == WGPUTextureFormat_RGBA8UnormSrgb ||
           format == WGPUTextureFormat_BGRA8UnormSrgb;
}

static WGPUTextureFormat linearSurfaceFormat(WGPUTextureFormat format) {
    if (format == WGPUTextureFormat_RGBA8UnormSrgb) return WGPUTextureFormat_RGBA8Unorm;
    if (format == WGPUTextureFormat_BGRA8UnormSrgb) return WGPUTextureFormat_BGRA8Unorm;
    return format;
}

static bool readCanvasDimension(
    BindingsState* state,
    js::JSValueHandle canvas,
    const char* propertyName,
    uint32_t& dimension
) {
    if (!state->engine || state->engine->isNull(canvas) || state->engine->isUndefined(canvas)) return false;

    const double value = state->engine->toNumber(state->engine->getProperty(canvas, propertyName));
    if (!std::isfinite(value) || value <= 0 || std::floor(value) != value ||
        value > static_cast<double>(std::numeric_limits<uint32_t>::max())) {
        return false;
    }

    dimension = static_cast<uint32_t>(value);
    return true;
}

/**
 * Keep the native presentation surface in lockstep with renderer.setSize().
 * Three.js changes the canvas backing dimensions directly; unlike a browser
 * GPUCanvasContext, the native surface is not reconfigured by that property
 * write, so acquire must apply the pending size before creating the color view.
 */
static bool syncSurfaceSizeToCanvas(BindingsState* state, js::JSValueHandle canvas) {
    if (!state->surface) return true;

    uint32_t width = 0;
    uint32_t height = 0;
    if (!readCanvasDimension(state, canvas, "width", width) ||
        !readCanvasDimension(state, canvas, "height", height)) {
        return false;
    }

    if (width == state->canvasWidth && height == state->canvasHeight) return true;

    // On a direct-presentation surface, a swapchain image acquired earlier in this scene's
    // life may still be held in state->currentTexture — the frame boundary that presents it has
    // not run. wgpu-native refuses to reconfigure a surface with an outstanding
    // SurfaceOutput: its panic reads "`SurfaceOutput` must be dropped before a new `Surface`
    // is made", and the panic aborts the process (PRD-183: the Android emulator died with a
    // silent SIGABRT exactly here, 67 ms into the first render after renderer.setSize).
    //
    // Discard that image rather than presenting it: the caller is already replacing the
    // frame's contents at the new size, an extra present would break the one-present-per-
    // frame invariant the device gates enforce, and releasing the texture back unwinds the
    // SurfaceOutput so the reconfigure below is accepted. Deferring the reconfigure instead
    // is worse on both platforms — the current frame would draw new-size depth onto
    // old-size colour, "attachments have differing sizes", the failure tier-1 day recorded
    // on desktop.
    //
    // The sRGB presentation bridge never holds a raw surface output across frames
    // (state->currentTexture is an offscreen linear texture there), so it keeps the immediate
    // reconfigure it always had.
    if (state->currentTexture != nullptr && !state->requiresSrgbPresentationBridge) {
    state->framePresentPending = false;
    if (state->currentTextureView != nullptr) {
    wgpuTextureViewRelease(state->currentTextureView);
    state->currentTextureView = nullptr;
    }
    if (state->currentSurfaceTextureId != 0) {
    state->textureRegistry.erase(state->currentSurfaceTextureId);
    state->currentSurfaceTextureId = 0;
    }
    wgpuTextureRelease(state->currentTexture);
    state->currentTexture = nullptr;
    state->surfaceRenderEncoder = nullptr;
    state->surfaceRenderPassEnded = false;
    }

    WGPUSurfaceConfiguration config = {};
    config.device = state->device;
    config.format = state->nativeSurfaceFormat;
    config.usage = WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc;
    config.alphaMode = WGPUCompositeAlphaMode_Auto;
    config.width = width;
    config.height = height;
    config.presentMode = state->presentMode;
    wgpuSurfaceConfigure(state->surface, &config);

    state->canvasWidth = width;
    state->canvasHeight = height;
    if (state->verboseLogging) {
        std::cout << "[WebGPU] Surface resized from canvas: " << width << "x" << height << std::endl;
    }
    return true;
}

static WGPUTexture createLinearPresentationTexture(BindingsState* state) {
    WGPUTextureDescriptor descriptor = {};
    descriptor.size = {state->canvasWidth, state->canvasHeight, 1};
    descriptor.mipLevelCount = 1;
    descriptor.sampleCount = 1;
    descriptor.dimension = WGPUTextureDimension_2D;
    descriptor.format = state->surfaceFormat;
    descriptor.usage = WGPUTextureUsage_RenderAttachment |
                       WGPUTextureUsage_TextureBinding |
                       WGPUTextureUsage_CopySrc;
    return wgpuDeviceCreateTexture(state->device, &descriptor);
}

static bool ensureSrgbPresentationPipeline(BindingsState* state) {
    if (state->srgbPresentationPipeline) return true;

    const char* shaderCode = R"(
        @group(0) @binding(0) var sourceTexture: texture_2d<f32>;

        @vertex
        fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
            var positions = array<vec2f, 3>(
                vec2f(-1.0, -1.0),
                vec2f(3.0, -1.0),
                vec2f(-1.0, 3.0)
            );
            return vec4f(positions[vertexIndex], 0.0, 1.0);
        }

        fn srgbToLinear(value: vec3f) -> vec3f {
            let low = value / 12.92;
            let high = pow((value + 0.055) / 1.055, vec3f(2.4));
            return select(high, low, value <= vec3f(0.04045));
        }

        @fragment
        fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
            let encoded = textureLoad(sourceTexture, vec2i(position.xy), 0);
            return vec4f(srgbToLinear(encoded.rgb), encoded.a);
        }
    )";

    WGPUShaderModuleWGSLDescriptor_Compat wgslDescriptor = {};
    WGPUShaderModuleDescriptor shaderDescriptor = {};
    setupShaderModuleWGSL(&shaderDescriptor, &wgslDescriptor, shaderCode);
    WGPUShaderModule shaderModule = wgpuDeviceCreateShaderModule(state->device, &shaderDescriptor);
    if (!shaderModule) return false;

    WGPUBindGroupLayoutEntry bindGroupEntry = {};
    bindGroupEntry.binding = 0;
    bindGroupEntry.visibility = WGPUShaderStage_Fragment;
    bindGroupEntry.texture.sampleType = WGPUTextureSampleType_Float;
    bindGroupEntry.texture.viewDimension = WGPUTextureViewDimension_2D;
    bindGroupEntry.texture.multisampled = false;

    WGPUBindGroupLayoutDescriptor bindGroupLayoutDescriptor = {};
    bindGroupLayoutDescriptor.entryCount = 1;
    bindGroupLayoutDescriptor.entries = &bindGroupEntry;
    state->srgbPresentationBindGroupLayout =
        wgpuDeviceCreateBindGroupLayout(state->device, &bindGroupLayoutDescriptor);
    if (!state->srgbPresentationBindGroupLayout) {
        wgpuShaderModuleRelease(shaderModule);
        return false;
    }

    WGPUPipelineLayoutDescriptor pipelineLayoutDescriptor = {};
    pipelineLayoutDescriptor.bindGroupLayoutCount = 1;
    pipelineLayoutDescriptor.bindGroupLayouts = &state->srgbPresentationBindGroupLayout;
    WGPUPipelineLayout pipelineLayout =
        wgpuDeviceCreatePipelineLayout(state->device, &pipelineLayoutDescriptor);
    if (!pipelineLayout) {
        wgpuBindGroupLayoutRelease(state->srgbPresentationBindGroupLayout);
        state->srgbPresentationBindGroupLayout = nullptr;
        wgpuShaderModuleRelease(shaderModule);
        return false;
    }

    WGPUColorTargetState colorTarget = {};
    colorTarget.format = state->nativeSurfaceFormat;
    colorTarget.writeMask = WGPUColorWriteMask_All;

    WGPUFragmentState fragmentState = {};
    fragmentState.module = shaderModule;
    WGPU_SET_ENTRY_POINT(fragmentState, "fs_main");
    fragmentState.targetCount = 1;
    fragmentState.targets = &colorTarget;

    WGPURenderPipelineDescriptor pipelineDescriptor = {};
    pipelineDescriptor.layout = pipelineLayout;
    pipelineDescriptor.vertex.module = shaderModule;
    WGPU_SET_ENTRY_POINT(pipelineDescriptor.vertex, "vs_main");
    pipelineDescriptor.fragment = &fragmentState;
    pipelineDescriptor.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    pipelineDescriptor.multisample.count = 1;
    pipelineDescriptor.multisample.mask = 0xffffffff;
    state->srgbPresentationPipeline =
        wgpuDeviceCreateRenderPipeline(state->device, &pipelineDescriptor);

    wgpuPipelineLayoutRelease(pipelineLayout);
    wgpuShaderModuleRelease(shaderModule);
    if (!state->srgbPresentationPipeline) {
        wgpuBindGroupLayoutRelease(state->srgbPresentationBindGroupLayout);
        state->srgbPresentationBindGroupLayout = nullptr;
        return false;
    }
    return true;
}

static bool presentLinearTextureToSrgbSurface(BindingsState* state, WGPUTextureView sourceView) {
    if (!sourceView || !ensureSrgbPresentationPipeline(state)) return false;

    WGPUSurfaceTexture surfaceTexture = {};
    wgpuSurfaceGetCurrentTexture(state->surface, &surfaceTexture);
    if (!wgpuSurfaceTextureStatusIsSuccess(surfaceTexture.status)) return false;

    WGPUTextureViewDescriptor surfaceViewDescriptor = {};
    surfaceViewDescriptor.format = state->nativeSurfaceFormat;
    surfaceViewDescriptor.dimension = WGPUTextureViewDimension_2D;
    surfaceViewDescriptor.baseMipLevel = 0;
    surfaceViewDescriptor.mipLevelCount = 1;
    surfaceViewDescriptor.baseArrayLayer = 0;
    surfaceViewDescriptor.arrayLayerCount = 1;
    surfaceViewDescriptor.aspect = WGPUTextureAspect_All;
    WGPUTextureView surfaceView =
        wgpuTextureCreateView(surfaceTexture.texture, &surfaceViewDescriptor);
    if (!surfaceView) {
        wgpuTextureRelease(surfaceTexture.texture);
        return false;
    }

    WGPUBindGroupEntry bindGroupEntry = {};
    bindGroupEntry.binding = 0;
    bindGroupEntry.textureView = sourceView;
    WGPUBindGroupDescriptor bindGroupDescriptor = {};
    bindGroupDescriptor.layout = state->srgbPresentationBindGroupLayout;
    bindGroupDescriptor.entryCount = 1;
    bindGroupDescriptor.entries = &bindGroupEntry;
    WGPUBindGroup bindGroup = wgpuDeviceCreateBindGroup(state->device, &bindGroupDescriptor);
    if (!bindGroup) {
        wgpuTextureViewRelease(surfaceView);
        wgpuTextureRelease(surfaceTexture.texture);
        return false;
    }

    WGPUCommandEncoderDescriptor encoderDescriptor = {};
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(state->device, &encoderDescriptor);
    if (!encoder) {
        wgpuBindGroupRelease(bindGroup);
        wgpuTextureViewRelease(surfaceView);
        wgpuTextureRelease(surfaceTexture.texture);
        return false;
    }
    WGPURenderPassColorAttachment colorAttachment = {};
    colorAttachment.view = surfaceView;
    colorAttachment.loadOp = WGPULoadOp_Clear;
    colorAttachment.storeOp = WGPUStoreOp_Store;
    colorAttachment.clearValue = {0.0, 0.0, 0.0, 1.0};
#if defined(MYSTRAL_WEBGPU_DAWN)
    colorAttachment.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
#endif
    WGPURenderPassDescriptor renderPassDescriptor = {};
    renderPassDescriptor.colorAttachmentCount = 1;
    renderPassDescriptor.colorAttachments = &colorAttachment;
    WGPURenderPassEncoder renderPass =
        wgpuCommandEncoderBeginRenderPass(encoder, &renderPassDescriptor);
    if (!renderPass) {
        wgpuCommandEncoderRelease(encoder);
        wgpuBindGroupRelease(bindGroup);
        wgpuTextureViewRelease(surfaceView);
        wgpuTextureRelease(surfaceTexture.texture);
        return false;
    }
    wgpuRenderPassEncoderSetPipeline(renderPass, state->srgbPresentationPipeline);
    wgpuRenderPassEncoderSetBindGroup(renderPass, 0, bindGroup, 0, nullptr);
    wgpuRenderPassEncoderDraw(renderPass, 3, 1, 0, 0);
    wgpuRenderPassEncoderEnd(renderPass);
    wgpuRenderPassEncoderRelease(renderPass);

    WGPUCommandBufferDescriptor commandBufferDescriptor = {};
    WGPUCommandBuffer commandBuffer =
        wgpuCommandEncoderFinish(encoder, &commandBufferDescriptor);
    const bool encoded = commandBuffer != nullptr;
    if (encoded) {
        wgpuQueueSubmit(state->queue, 1, &commandBuffer);
        wgpuSurfacePresent(state->surface);
    }

    if (commandBuffer) wgpuCommandBufferRelease(commandBuffer);
    wgpuCommandEncoderRelease(encoder);
    wgpuBindGroupRelease(bindGroup);
    wgpuTextureViewRelease(surfaceView);
    wgpuTextureRelease(surfaceTexture.texture);
    return encoded;
}

/**
 * Names a failed swapchain acquire, at most once a second and always the first one.
 *
 * `TN_SURFACE_ACQUIRE_FAILED` is the marker a logcat filter finds when a device shows a black
 * screen; the status is wgpu's own `WGPUSurfaceGetCurrentTextureStatus`, so an outdated or lost
 * surface is distinguishable from a device that simply has no window.
 */
static void reportSurfaceAcquireFailure(uint32_t status) {
    static uint64_t suppressed = 0;
    static std::chrono::steady_clock::time_point lastReport{};
    const auto now = std::chrono::steady_clock::now();
    const bool first = lastReport.time_since_epoch().count() == 0;
    if (!first && now - lastReport < std::chrono::seconds(1)) {
        suppressed += 1;
        return;
    }
    lastReport = now;
    std::ostringstream out;
    out << "TN_SURFACE_ACQUIRE_FAILED:{\"status\":" << status << ",\"suppressed\":" << suppressed
        << "}";
    suppressed = 0;
    const std::string marker = out.str();
    std::cerr << "[WebGPU] " << marker << " the surface handed out no texture, so this frame "
                 "presents nothing" << std::endl;
#if defined(__ANDROID__)
    __android_log_print(ANDROID_LOG_ERROR, "MystralRuntime", "%s", marker.c_str());
#endif
}

/**
 * Get the current swapchain texture (or offscreen texture in no-SDL mode)
 */
static WGPUTexture getCurrentSwapchainTexture(BindingsState* state) {
#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)
    // In no-SDL mode, use the offscreen texture
    if (!state->surface) {
        if (state->offscreenTexture) {
            return state->offscreenTexture;
        }
        std::cerr << "[WebGPU] No surface and no offscreen texture available" << std::endl;
        return nullptr;
    }

    if (state->requiresSrgbPresentationBridge) {
        return createLinearPresentationTexture(state);
    }

    WGPUSurfaceTexture surfaceTexture;
    wgpuSurfaceGetCurrentTexture(state->surface, &surfaceTexture);

    if (!wgpuSurfaceTextureStatusIsSuccess(surfaceTexture.status)) {
        // Fail by name. A surface that stops handing out images presents nothing, and the loop is
        // no longer paced by presenting, so this fires hundreds of times a second, which is
        // precisely how the resume defect looked from the outside: frames running away, presents
        // frozen, a black screen, and no line in the log that said why. Rate-limited so the marker
        // stays readable instead of becoming a flood.
        reportSurfaceAcquireFailure(static_cast<uint32_t>(surfaceTexture.status));
        return nullptr;
    }

    return surfaceTexture.texture;
#else
    return nullptr;
#endif
}

// Maps JS WebGPU feature names onto this header's WGPUFeatureName values for the
// adapter/device feature sets. Returns 0 (never a valid value) when unmapped: either a
// name this build does not model or one whose backing bindings are not implemented.
static WGPUFeatureName jsFeatureNameToWGPU(const std::string& featureName) {
    if (featureName == "depth-clip-control") return WGPUFeatureName_DepthClipControl;
    if (featureName == "depth32float-stencil8") return WGPUFeatureName_Depth32FloatStencil8;
    if (featureName == "texture-compression-bc") return WGPUFeatureName_TextureCompressionBC;
    if (featureName == "texture-compression-etc2") return WGPUFeatureName_TextureCompressionETC2;
    if (featureName == "texture-compression-astc") return WGPUFeatureName_TextureCompressionASTC;
    if (featureName == "float32-filterable") return WGPUFeatureName_Float32Filterable;
    return static_cast<WGPUFeatureName>(0);
}

static js::JSValueHandle configureCanvasContext(
    BindingsState* state,
    BindingDestination,
    const std::vector<js::JSValueHandle>& args) {
    const auto descriptor = args[0];
    const std::string format = state->engine->toString(state->engine->getProperty(descriptor, "format"));
    const WGPUTextureFormat configuredFormat = stringToFormat(format);
    if (state->requiresSrgbPresentationBridge &&
        configuredFormat != linearSurfaceFormat(state->nativeSurfaceFormat)) {
        state->engine->throwException(
            "GPUCanvasContext.configure format does not match the native presentation bridge");
        return state->engine->newUndefined();
    }
    state->surfaceFormat = configuredFormat;
    state->contextConfigured = true;
    if (state->verboseLogging) {
        std::cout << "[Canvas] Context configured with format: " << format << std::endl;
    }
    return state->engine->newUndefined();
}

static js::JSValueHandle getCurrentCanvasTexture(
    BindingsState* state,
    const std::vector<js::JSValueHandle>&,
    bool offscreen) {
    if (offscreen) {
        const WGPUTexture previousCurrentTexture = state->currentTexture;
        const uint64_t previousSurfaceTextureId = state->currentSurfaceTextureId;
        WGPUTexture texture = getCurrentSwapchainTexture(state);
        if (!texture) {
            state->engine->throwException("Failed to get current texture");
            return state->engine->newUndefined();
        }

        state->currentTexture = texture;
        const uint64_t textureId = state->nextTextureId++;
        TextureInfo textureInfo;
        textureInfo.texture = texture;
        textureInfo.format = state->surfaceFormat;
        textureInfo.width = state->canvasWidth;
        textureInfo.height = state->canvasHeight;
        textureInfo.ownsTexture = false;
        state->textureRegistry[textureId] = textureInfo;
        state->engine->suspendFrameTracking();
        auto jsTexture = createTextureWrapper(
            state,
            texture,
            textureId,
            state->canvasWidth,
            state->canvasHeight,
            formatToString(state->surfaceFormat),
            true);
        state->engine->resumeFrameTracking();
        if (state->engine->isUndefined(jsTexture) && state->engine->hasException()) {
            state->currentTexture = previousCurrentTexture;
            state->currentSurfaceTextureId = previousSurfaceTextureId;
            if (state->surface && texture && texture != previousCurrentTexture) {
                wgpuTextureRelease(texture);
            }
        }
        return jsTexture;
    }

    if (!syncSurfaceSizeToCanvas(state, state->engine->getGlobalProperty("canvas"))) {
        state->engine->throwException("Canvas dimensions must be positive integer pixels");
        return state->engine->newUndefined();
    }

    return acquireSurfaceTexture(
        state,
        [](BindingsState* state) {
            WGPUTexture texture = getCurrentSwapchainTexture(state);
            return texture;
        },
        [](BindingsState* currentState,
           WGPUTexture texture,
           uint64_t textureId,
           uint32_t width,
           uint32_t height,
           const char* format,
           bool createdSurfaceTexture) {
            return createTextureWrapper(
                currentState,
                texture,
                textureId,
                width,
                height,
                format,
                createdSurfaceTexture);
        },
        [](BindingsState* currentState,
           WGPUTexture texture,
           WGPUTexture previousCurrentTexture) {
            if (currentState->surface && texture && texture != previousCurrentTexture) {
                wgpuTextureRelease(texture);
            }
        });

}

static BindingHandler makeUnconfigureCanvasContextHandler(bool offscreen) {
    return [offscreen](BindingsState* state, BindingDestination, const std::vector<js::JSValueHandle>&) {
        if (!offscreen) state->contextConfigured = false;
        return state->engine->newUndefined();
    };
}

static BindingHandler makeCurrentTextureCanvasContextHandler(bool offscreen) {
    return [offscreen](BindingsState* state, BindingDestination, const std::vector<js::JSValueHandle>& args) {
        return getCurrentCanvasTexture(state, args, offscreen);
    };
}

static bool installCanvasContextBindings(
    BindingsState* state,
    js::JSValueHandle canvasContext,
    bool offscreen) {
    if (!installBindingTable(state->engine, state, bindingTable({
        {"GPUCanvasContext", "configure", 1, "configure requires a descriptor", &configureCanvasContext, canvasContext},
        {"GPUCanvasContext", "unconfigure", 0, nullptr,
         makeUnconfigureCanvasContextHandler(offscreen), canvasContext},
        {"GPUCanvasContext", "getCurrentTexture", 0, nullptr,
         makeCurrentTextureCanvasContextHandler(offscreen), canvasContext},
    }))) return false;
    return true;
}

template <typename T>
static BindingHandler makeCapturedHandler(
    T captured,
    js::JSValueHandle (*handler)(BindingsState*, T, const std::vector<js::JSValueHandle>&)) {
    return [captured, handler](BindingsState* state, BindingDestination,
                               const std::vector<js::JSValueHandle>& args) {
        return handler(state, captured, args);
    };
}

template <typename T, typename U>
static BindingHandler makeCapturedPairHandler(
    T first,
    U second,
    js::JSValueHandle (*handler)(
        BindingsState*, T, U, const std::vector<js::JSValueHandle>&)) {
    return [first, second, handler](BindingsState* state, BindingDestination,
                                    const std::vector<js::JSValueHandle>& args) {
        return handler(state, first, second, args);
    };
}

/** Install the table-driven WebGPU surfaces after state has been initialized. */
#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)
static bool installWebGPUBindingTables(BindingsState* state, js::Engine* engine);

static bool installWebGPUBindingSurfaces(BindingsState* state, js::Engine* engine) {
    return installWebGPUBindingTables(state, engine);
}

static js::JSValueHandle tnWebgpuHandler88(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& a) {
                    // Get the stored context from the global (we need a way to access it)
                    // For now, return null and let callers use the _context directly
                    return state->engine->newNull();
}

static js::JSValueHandle tnWebgpuHandler87(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
            int width = 800;
            int height = 600;
            if (args.size() >= 1) {
                width = static_cast<int>(state->engine->toNumber(args[0]));
            }
            if (args.size() >= 2) {
                height = static_cast<int>(state->engine->toNumber(args[1]));
            }
            if (state->verboseLogging) std::cout << "[Canvas] Creating offscreen 2D canvas (" << width << "x" << height << ")" << std::endl;
            // Create a wrapper object that mimics a canvas with a 2D context
            auto canvasWrapper = state->engine->newObject();
            state->engine->setProperty(canvasWrapper, "width", state->engine->newNumber(width));
            state->engine->setProperty(canvasWrapper, "height", state->engine->newNumber(height));
            // Create the 2D context
            auto ctx2d = createOwnedCanvas2DContext(state, width, height);
            state->engine->setProperty(canvasWrapper, "_context", ctx2d);
            // getContext('2d') returns the pre-created context
            if (!installBindingTable(state->engine, state, bindingTable({
                {"HTMLCanvasElement", "getContext", 0, nullptr,
                &tnWebgpuHandler88
            , canvasWrapper}}))) {
                rollbackOwnedCanvas2DContext(state, ctx2d);
                return state->engine->newUndefined();
            }
            return canvasWrapper;
}

static js::JSValueHandle tnWebgpuHandler86(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
            if (args.size() < 2) {
                std::cerr << "[Canvas] __nativeGetContext2D requires contextType and canvasId" << std::endl;
                return state->engine->newNull();
            }
            std::string contextType = state->engine->toString(args[0]);
            int canvasId = static_cast<int>(state->engine->toNumber(args[1]));
            if (contextType != "2d") {
                std::cerr << "[Canvas] Unsupported context type for offscreen canvas: " << contextType << std::endl;
                return state->engine->newNull();
            }
            auto it = state->offscreenCanvases.find(canvasId);
            if (it == state->offscreenCanvases.end()) {
                std::cerr << "[Canvas] Canvas not found: " << canvasId << std::endl;
                return state->engine->newNull();
            }
            OffscreenCanvas* canvas = it->second.get();
            // Return cached context if already created
            if (canvas->hasContext2d) {
                return canvas->context2d;
            }
            // Get current dimensions from the canvas element (in case they were changed)
            std::string globalName = "__offscreenCanvas_" + std::to_string(canvasId);
            auto canvasElement = state->engine->getGlobalProperty(globalName.c_str());
            if (!state->engine->isNull(canvasElement) && !state->engine->isUndefined(canvasElement)) {
                auto widthProp = state->engine->getProperty(canvasElement, "width");
                auto heightProp = state->engine->getProperty(canvasElement, "height");
                if (!state->engine->isUndefined(widthProp)) {
                    canvas->width = static_cast<int>(state->engine->toNumber(widthProp));
                }
                if (!state->engine->isUndefined(heightProp)) {
                    canvas->height = static_cast<int>(state->engine->toNumber(heightProp));
                }
            }
            // Create Canvas 2D context with current dimensions
            if (state->verboseLogging) std::cout << "[Canvas] Creating offscreen 2D context (" << canvas->width << "x" << canvas->height << ")" << std::endl;
            canvas->context2d = createOwnedCanvas2DContext(state, canvas->width, canvas->height);
            canvas->hasContext2d = true;
            return canvas->context2d;
}
static js::JSValueHandle tnWebgpuHandler84(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
            if (args.empty()) {
                state->engine->throwException("__decodeImageData requires an ArrayBuffer argument");
                return state->engine->newUndefined();
            }
            // Get ArrayBuffer data
            size_t inputSize = 0;
            void* inputData = state->engine->getArrayBufferData(args[0], &inputSize);
            if (!inputData || inputSize == 0) {
                state->engine->throwException("__decodeImageData: invalid ArrayBuffer");
                return state->engine->newUndefined();
            }
            const unsigned char* inputBytes = (const unsigned char*)inputData;
            int width = 0, height = 0;
            unsigned char* data = nullptr;
            bool isWebP = false;
            // Check if this is a WebP image (starts with "RIFF" and has "WEBP" at offset 8)
            if (inputSize >= 12 &&
                inputBytes[0] == 'R' && inputBytes[1] == 'I' &&
                inputBytes[2] == 'F' && inputBytes[3] == 'F' &&
                inputBytes[8] == 'W' && inputBytes[9] == 'E' &&
                inputBytes[10] == 'B' && inputBytes[11] == 'P') {
                isWebP = true;
            }
            if (isWebP) {
#ifdef MYSTRAL_HAS_WEBP
                // Decode WebP using libwebp
                data = WebPDecodeRGBA(inputBytes, inputSize, &width, &height);
                if (!data) {
                    state->engine->throwException("Failed to decode WebP image");
                    return state->engine->newUndefined();
                }
                if (state->verboseLogging) std::cout << "[createImageBitmap] Decoded WebP " << width << "x" << height << " image" << std::endl;
#else
                state->engine->throwException("WebP image detected but libwebp support not compiled in. Rebuild with MYSTRAL_HAS_WEBP.");
                return state->engine->newUndefined();
#endif
            } else {
                // Decode using stb_image (PNG, JPEG, etc.)
                int channels;
                data = stbi_load_from_memory(inputBytes, (int)inputSize, &width, &height, &channels, 4);
                if (!data) {
                    std::string error = std::string("Failed to decode image: ") + stbi_failure_reason();
                    state->engine->throwException(error.c_str());
                    return state->engine->newUndefined();
                }
                if (state->verboseLogging) std::cout << "[createImageBitmap] Decoded " << width << "x" << height << " image" << std::endl;
            }
            // Create ImageBitmap-like object
            auto result = state->engine->newObject();
            // Create ArrayBuffer with RGBA pixel data
            size_t dataSize = width * height * 4;
            auto arrayBuffer = state->engine->newArrayBuffer(data, dataSize);
            state->engine->setProperty(result, "width", state->engine->newNumber(width));
            state->engine->setProperty(result, "height", state->engine->newNumber(height));
            state->engine->setProperty(result, "_data", arrayBuffer);  // Internal pixel data
            state->engine->setProperty(result, "_closed", state->engine->newBoolean(false));
            // Free decoded data (we copied it to ArrayBuffer)
            if (isWebP) {
#ifdef MYSTRAL_HAS_WEBP
                WebPFree(data);
#endif
            } else {
                stbi_image_free(data);
            }
            return result;
}

static js::JSValueHandle tnWebgpuHandler83(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
            return state->engine->newString(formatToString(state->surfaceFormat));
}

static js::JSValueHandle tnWebgpuHandler82(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                    if (args.empty()) return state->engine->newBoolean(false);
                    std::string featureName = state->engine->toString(args[0]);
                    // indirect-first-instance is required for indirect draws with non-zero firstInstance
                    // This is supported by Dawn on all backends
                    if (featureName == "indirect-first-instance") {
                        return state->engine->newBoolean(true);
                    }
                    // timestamp-query is NOT supported yet - bindings not implemented
                    if (featureName == "timestamp-query") {
                        return state->engine->newBoolean(false);
                    }
                    // Answered from the real adapter so feature-dependent consumers (three's
                    // KTX2Loader.detectSupport among them) request what the hardware has.
                    WGPUFeatureName feature = jsFeatureNameToWGPU(featureName);
                    if (feature == static_cast<WGPUFeatureName>(0)) return state->engine->newBoolean(false);
                    return state->engine->newBoolean(wgpuAdapterHasFeature(state->adapter, feature) != 0);
}

static js::JSValueHandle tnWebgpuHandler81(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            if (state->verboseLogging) {
                                std::cout << "[WebGPU] popErrorScope" << std::endl;
                            }
                            auto* data = new ErrorScopeData();
#if WGPU_USES_CALLBACK_INFO_PATTERN
                            WGPUPopErrorScopeCallbackInfo callbackInfo = {};
                            callbackInfo.mode = WGPUCallbackMode_AllowSpontaneous;
                            callbackInfo.callback = onErrorScopePopped;
                            callbackInfo.userdata1 = data;
                            callbackInfo.userdata2 = nullptr;
                            (void)wgpuDevicePopErrorScope(state->device, callbackInfo);
#else
                            wgpuDevicePopErrorScope(state->device, onErrorScopePopped, data);
#endif
                            if (!waitForWebGpuCallback(state, data)) {
                                releaseCallbackData(data);
                                return rejectedPromise(state,
                                    "GPUDevice.popErrorScope timed out waiting for native observation.",
                                    "popErrorScope-timeout"
                                );
                            }
#if WGPU_USES_CALLBACK_INFO_PATTERN
                            const WGPUPopErrorScopeStatus popStatus = data->status;
                            if (popStatus != WGPUPopErrorScopeStatus_Success) {
                                releaseCallbackData(data);
                                return rejectedPromise(state,
                                    "GPUDevice.popErrorScope failed with native status "
                                        + std::to_string(static_cast<int>(popStatus)),
                                    "popErrorScope-status"
                                );
                            }
#endif
                            const WGPUErrorType errorType = data->type;
                            const std::string errorMessage = data->message;
                            releaseCallbackData(data);
                            if (errorType == WGPUErrorType_NoError) {
                            return resolvedPromise(state, "null", "popErrorScope-empty");
                            }
                            const std::string errorExpression = "{ name: "
                                + jsStringLiteral(gpuErrorName(errorType))
                                + ", message: " + jsStringLiteral(errorMessage) + " }";
                            return resolvedPromise(state, errorExpression, "popErrorScope-observed");
}

static js::JSValueHandle tnWebgpuHandler80(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            const std::string filterName = args.empty() ? "validation" : state->engine->toString(args[0]);
                            WGPUErrorFilter filter;
                            if (filterName == "validation") filter = WGPUErrorFilter_Validation;
                            else if (filterName == "out-of-memory") filter = WGPUErrorFilter_OutOfMemory;
                            else if (filterName == "internal") filter = WGPUErrorFilter_Internal;
                            else {
                                state->engine->throwException("GPUDevice.pushErrorScope received an unknown filter");
                                return state->engine->newUndefined();
                            }
                            wgpuDevicePushErrorScope(state->device, filter);
                            if (state->verboseLogging) {
                                std::cout << "[WebGPU] pushErrorScope: " << filterName << std::endl;
                            }
                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler79(BindingsState* state, WGPURenderBundleEncoder capturedEncoder, const std::vector<js::JSValueHandle>& args) {
                                    WGPURenderBundleDescriptor desc = {};
                                    WGPURenderBundle bundle = wgpuRenderBundleEncoderFinish(capturedEncoder, &desc);
                                    auto jsBundle = state->engine->newObject();
                                    state->engine->setPrivateData(jsBundle, bundle);
                                    state->engine->setProperty(jsBundle, "_type", state->engine->newString("renderBundle"));
                                    if (state->verboseLogging) std::cout << "[WebGPU] Render bundle finished" << std::endl;
                                    return jsBundle;
}

static js::JSValueHandle tnWebgpuHandler78(BindingsState* state, WGPURenderBundleEncoder capturedEncoder, const std::vector<js::JSValueHandle>& args) {
                                    if (args.empty()) return state->engine->newUndefined();
#if TN_ANDROID_JS_PROFILE
                                    const auto profileStart = beginProfiledBinding();
#endif
                                    uint32_t indexCount = (uint32_t)state->engine->toNumber(args[0]);
                                    uint32_t instanceCount = args.size() > 1 ? (uint32_t)state->engine->toNumber(args[1]) : 1;
                                    uint32_t firstIndex = args.size() > 2 ? (uint32_t)state->engine->toNumber(args[2]) : 0;
                                    int32_t baseVertex = args.size() > 3 ? (int32_t)state->engine->toNumber(args[3]) : 0;
                                    uint32_t firstInstance = args.size() > 4 ? (uint32_t)state->engine->toNumber(args[4]) : 0;
                                    wgpuRenderBundleEncoderDrawIndexed(capturedEncoder, indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
#if TN_ANDROID_JS_PROFILE
                                    endProfiledBinding(state, ProfiledRenderCommand::BundleDrawIndexed, profileStart);
#endif
                                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler77(BindingsState* state, WGPURenderBundleEncoder capturedEncoder, const std::vector<js::JSValueHandle>& args) {
                                    if (args.empty()) return state->engine->newUndefined();
                                    uint32_t vertexCount = (uint32_t)state->engine->toNumber(args[0]);
                                    uint32_t instanceCount = args.size() > 1 ? (uint32_t)state->engine->toNumber(args[1]) : 1;
                                    uint32_t firstVertex = args.size() > 2 ? (uint32_t)state->engine->toNumber(args[2]) : 0;
                                    uint32_t firstInstance = args.size() > 3 ? (uint32_t)state->engine->toNumber(args[3]) : 0;
                                    wgpuRenderBundleEncoderDraw(capturedEncoder, vertexCount, instanceCount, firstVertex, firstInstance);
                                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler76(BindingsState* state, WGPURenderBundleEncoder capturedEncoder, const std::vector<js::JSValueHandle>& args) {
                                    if (args.size() < 2) return state->engine->newUndefined();
                                    uint32_t index = (uint32_t)state->engine->toNumber(args[0]);
                                    WGPUBindGroup bindGroup = (WGPUBindGroup)state->engine->getPrivateData(args[1]);
                                    // Parse dynamic offsets if provided
                                    std::vector<uint32_t> dynamicOffsets;
                                    if (args.size() > 2 && !state->engine->isUndefined(args[2])) {
                                        auto offsetsArray = args[2];
                                        auto lengthProp = state->engine->getProperty(offsetsArray, "length");
                                        int offsetCount = state->engine->isUndefined(lengthProp) ? 0 : (int)state->engine->toNumber(lengthProp);
                                        for (int i = 0; i < offsetCount; i++) {
                                            dynamicOffsets.push_back((uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(offsetsArray, i)));
                                        }
                                    }
                                    wgpuRenderBundleEncoderSetBindGroup(capturedEncoder, index, bindGroup, dynamicOffsets.size(), dynamicOffsets.data());
                                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler75(BindingsState* state, WGPURenderBundleEncoder capturedEncoder, const std::vector<js::JSValueHandle>& args) {
                                    if (args.size() < 2) return state->engine->newUndefined();
                                    WGPUBuffer buffer = (WGPUBuffer)state->engine->getPrivateData(args[0]);
                                    std::string formatStr = state->engine->toString(args[1]);
                                    WGPUIndexFormat format = formatStr == "uint32" ? WGPUIndexFormat_Uint32 : WGPUIndexFormat_Uint16;
                                    uint64_t offset = args.size() > 2 && !state->engine->isUndefined(args[2]) ? (uint64_t)state->engine->toNumber(args[2]) : 0;
                                    uint64_t size = args.size() > 3 && !state->engine->isUndefined(args[3]) ? (uint64_t)state->engine->toNumber(args[3]) : WGPU_WHOLE_SIZE;
                                    wgpuRenderBundleEncoderSetIndexBuffer(capturedEncoder, buffer, format, offset, size);
                                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler74(BindingsState* state, WGPURenderBundleEncoder capturedEncoder, const std::vector<js::JSValueHandle>& args) {
                                    if (args.size() < 2) return state->engine->newUndefined();
                                    uint32_t slot = (uint32_t)state->engine->toNumber(args[0]);
                                    WGPUBuffer buffer = (WGPUBuffer)state->engine->getPrivateData(args[1]);
                                    uint64_t offset = args.size() > 2 && !state->engine->isUndefined(args[2]) ? (uint64_t)state->engine->toNumber(args[2]) : 0;
                                    uint64_t size = args.size() > 3 && !state->engine->isUndefined(args[3]) ? (uint64_t)state->engine->toNumber(args[3]) : WGPU_WHOLE_SIZE;
                                    wgpuRenderBundleEncoderSetVertexBuffer(capturedEncoder, slot, buffer, offset, size);
                                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler73(BindingsState* state, WGPURenderBundleEncoder capturedEncoder, const std::vector<js::JSValueHandle>& args) {
                                    if (args.empty()) return state->engine->newUndefined();
                                    WGPURenderPipeline pipeline = (WGPURenderPipeline)state->engine->getPrivateData(args[0]);
                                    wgpuRenderBundleEncoderSetPipeline(capturedEncoder, pipeline);
                                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler72(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            if (args.empty()) {
                                state->engine->throwException("createRenderBundleEncoder requires a descriptor");
                                return state->engine->newUndefined();
                            }
                            auto descriptor = args[0];
                            // Parse color formats
                            auto colorFormats = state->engine->getProperty(descriptor, "colorFormats");
                            auto colorFormatsLength = state->engine->getProperty(colorFormats, "length");
                            int colorFormatCount = state->engine->isUndefined(colorFormatsLength) ? 0 : (int)state->engine->toNumber(colorFormatsLength);
                            std::vector<WGPUTextureFormat> formats;
                            formats.reserve(colorFormatCount);
                            for (int i = 0; i < colorFormatCount; i++) {
                                auto formatProp = state->engine->getPropertyIndex(colorFormats, i);
                                if (!state->engine->isUndefined(formatProp) && !state->engine->isNull(formatProp)) {
                                    formats.push_back(stringToFormat(state->engine->toString(formatProp)));
                                }
                            }
                            // Parse depth stencil format
                            WGPUTextureFormat depthFormat = WGPUTextureFormat_Undefined;
                            auto depthFormatProp = state->engine->getProperty(descriptor, "depthStencilFormat");
                            if (!state->engine->isUndefined(depthFormatProp) && !state->engine->isNull(depthFormatProp)) {
                                depthFormat = stringToFormat(state->engine->toString(depthFormatProp));
                            }
                            // Parse sample count
                            uint32_t sampleCount = 1;
                            auto sampleCountProp = state->engine->getProperty(descriptor, "sampleCount");
                            if (!state->engine->isUndefined(sampleCountProp)) {
                                sampleCount = (uint32_t)state->engine->toNumber(sampleCountProp);
                            }
                            WGPURenderBundleEncoderDescriptor desc = {};
                            desc.colorFormatCount = formats.size();
                            desc.colorFormats = formats.data();
                            desc.depthStencilFormat = depthFormat;
                            desc.sampleCount = sampleCount;
                            WGPURenderBundleEncoder bundleEncoder = wgpuDeviceCreateRenderBundleEncoder(state->device, &desc);
                            if (!bundleEncoder) {
                                state->engine->throwException("Failed to create render bundle encoder");
                                return state->engine->newUndefined();
                            }
                            auto jsEncoder = state->engine->newObject();
                            state->engine->setPrivateData(jsEncoder, bundleEncoder);
                            // Capture for closures
                            WGPURenderBundleEncoder capturedEncoder = bundleEncoder;
                            // renderBundleEncoder.setPipeline(pipeline)
                            if (!installBindingTable(state->engine, state, bindingTable({
                                {"GPURenderBundleEncoder", "setPipeline", 0, nullptr,
                                makeCapturedHandler(capturedEncoder, &tnWebgpuHandler73)
                            , jsEncoder},
                            // renderBundleEncoder.setVertexBuffer(slot, buffer, offset?, size?)
                                {"GPURenderBundleEncoder", "setVertexBuffer", 0, nullptr,
                                makeCapturedHandler(capturedEncoder, &tnWebgpuHandler74)
                            , jsEncoder},
                            // renderBundleEncoder.setIndexBuffer(buffer, format, offset?, size?)
                                {"GPURenderBundleEncoder", "setIndexBuffer", 0, nullptr,
                                makeCapturedHandler(capturedEncoder, &tnWebgpuHandler75)
                            , jsEncoder},
                            // renderBundleEncoder.setBindGroup(index, bindGroup, dynamicOffsets?)
                                {"GPURenderBundleEncoder", "setBindGroup", 0, nullptr,
                                makeCapturedHandler(capturedEncoder, &tnWebgpuHandler76)
                            , jsEncoder},
                            // renderBundleEncoder.draw(vertexCount, instanceCount?, firstVertex?, firstInstance?)
                                {"GPURenderBundleEncoder", "draw", 0, nullptr,
                                makeCapturedHandler(capturedEncoder, &tnWebgpuHandler77)
                            , jsEncoder},
                            // renderBundleEncoder.drawIndexed(indexCount, instanceCount?, firstIndex?, baseVertex?, firstInstance?)
                                {"GPURenderBundleEncoder", "drawIndexed", 0, nullptr,
                                makeCapturedHandler(capturedEncoder, &tnWebgpuHandler78)
                            , jsEncoder},
                            // renderBundleEncoder.finish(descriptor?)
                                {"GPURenderBundleEncoder", "finish", 0, nullptr,
                                makeCapturedHandler(capturedEncoder, &tnWebgpuHandler79)
                            , jsEncoder}}))) {
                                wgpuRenderBundleEncoderRelease(bundleEncoder);
                                return state->engine->newUndefined();
                            }
                            if (state->verboseLogging) std::cout << "[WebGPU] Created render bundle encoder" << std::endl;
                            return jsEncoder;
}

static js::JSValueHandle tnWebgpuHandler71(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            if (args.empty()) {
                                state->engine->throwException("createTextureView requires a texture");
                                return state->engine->newUndefined();
                            }
                            auto textureHandle = args[0];
                            WGPUTexture texture = (WGPUTexture)state->engine->getPrivateData(textureHandle);
                            if (!texture) {
                                state->engine->throwException("createTextureView: invalid texture");
                                return state->engine->newUndefined();
                            }
                            // Get texture info
                            double formatEnum = state->engine->toNumber(state->engine->getProperty(textureHandle, "_formatEnum"));
                            WGPUTextureFormat format = formatEnum == 0 ? state->surfaceFormat : (WGPUTextureFormat)(int)formatEnum;
                            // Get format from _textureId if available
                            auto textureIdVal = state->engine->getProperty(textureHandle, "_textureId");
                            if (!state->engine->isUndefined(textureIdVal)) {
                                uint64_t textureId = (uint64_t)state->engine->toNumber(textureIdVal);
                                auto it = state->textureRegistry.find(textureId);
                                if (it != state->textureRegistry.end()) {
                                    format = it->second.format;
                                }
                            }
                            WGPUTextureViewDescriptor viewDesc = {};
                            viewDesc.format = format;
                            viewDesc.dimension = WGPUTextureViewDimension_2D;
                            viewDesc.baseMipLevel = 0;
                            viewDesc.mipLevelCount = 1;
                            viewDesc.baseArrayLayer = 0;
                            viewDesc.arrayLayerCount = 1;
                            viewDesc.aspect = WGPUTextureAspect_All;
                            // Parse descriptor if provided
                            if (args.size() > 1 && !state->engine->isUndefined(args[1])) {
                                auto descriptor = args[1];
                                auto formatProp = state->engine->getProperty(descriptor, "format");
                                if (!state->engine->isUndefined(formatProp)) {
                                    viewDesc.format = stringToFormat(state->engine->toString(formatProp));
                                }
                                auto dimensionProp = state->engine->getProperty(descriptor, "dimension");
                                if (!state->engine->isUndefined(dimensionProp)) {
                                    viewDesc.dimension = stringToTextureViewDimension(state->engine->toString(dimensionProp));
                                }
                                auto baseMipLevel = state->engine->getProperty(descriptor, "baseMipLevel");
                                if (!state->engine->isUndefined(baseMipLevel)) {
                                    viewDesc.baseMipLevel = (uint32_t)state->engine->toNumber(baseMipLevel);
                                }
                                auto mipLevelCount = state->engine->getProperty(descriptor, "mipLevelCount");
                                if (!state->engine->isUndefined(mipLevelCount)) {
                                    viewDesc.mipLevelCount = (uint32_t)state->engine->toNumber(mipLevelCount);
                                }
                                auto baseArrayLayer = state->engine->getProperty(descriptor, "baseArrayLayer");
                                if (!state->engine->isUndefined(baseArrayLayer)) {
                                    viewDesc.baseArrayLayer = (uint32_t)state->engine->toNumber(baseArrayLayer);
                                }
                                auto arrayLayerCount = state->engine->getProperty(descriptor, "arrayLayerCount");
                                if (!state->engine->isUndefined(arrayLayerCount)) {
                                    uint32_t requested = (uint32_t)state->engine->toNumber(arrayLayerCount);
                                    // Clamp to 1 for surface textures (which only have 1 layer)
                                    // or look up actual layer count from registry
                                    auto textureIdVal2 = state->engine->getProperty(textureHandle, "_textureId");
                                    uint32_t maxLayers = 1;
                                    if (!state->engine->isUndefined(textureIdVal2)) {
                                        uint64_t tid = (uint64_t)state->engine->toNumber(textureIdVal2);
                                        auto it = state->textureRegistry.find(tid);
                                        if (it != state->textureRegistry.end()) {
                                            maxLayers = it->second.depthOrArrayLayers > 0 ? it->second.depthOrArrayLayers : 1;
                                        }
                                    }
                                    viewDesc.arrayLayerCount = std::min(requested, maxLayers - viewDesc.baseArrayLayer);
                                }
                                auto aspect = state->engine->getProperty(descriptor, "aspect");
                                if (!state->engine->isUndefined(aspect)) {
                                    std::string aspectStr = state->engine->toString(aspect);
                                    if (aspectStr == "all") viewDesc.aspect = WGPUTextureAspect_All;
                                    else if (aspectStr == "stencil-only") viewDesc.aspect = WGPUTextureAspect_StencilOnly;
                                    else if (aspectStr == "depth-only") viewDesc.aspect = WGPUTextureAspect_DepthOnly;
                                }
                            }
                            // Final validation: Fix arrayLayerCount based on view dimension
                            if (viewDesc.dimension == WGPUTextureViewDimension_3D ||
                                viewDesc.dimension == WGPUTextureViewDimension_1D) {
                                viewDesc.arrayLayerCount = 1;
                            } else if (viewDesc.dimension == WGPUTextureViewDimension_Cube) {
                                viewDesc.arrayLayerCount = 6;
                            }
                            WGPUTextureView view = wgpuTextureCreateView(texture, &viewDesc);
                            if (!requireHandle(state->engine, view, "device.createTextureView"))
                                return state->engine->newUndefined();
                            auto jsView = state->engine->newObject();
                            state->engine->setPrivateData(jsView, view);
                            state->engine->setProperty(jsView, "_type", state->engine->newString("textureView"));
                            state->engine->registerRelease(jsView, [view]() {
                                wgpuTextureViewRelease(view);
                            });
                            if (state->verboseLogging) std::cout << "[WebGPU] Created texture view" << std::endl;
                            return jsView;
}

static js::JSValueHandle tnWebgpuHandler70(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            if (args.empty()) {
                                state->engine->throwException("createPipelineLayout requires a descriptor");
                                return state->engine->newUndefined();
                            }
                            auto descriptor = args[0];
                            auto bindGroupLayouts = state->engine->getProperty(descriptor, "bindGroupLayouts");
                            auto lengthProp = state->engine->getProperty(bindGroupLayouts, "length");
                            int layoutCount = state->engine->isUndefined(lengthProp) ? 0 : (int)state->engine->toNumber(lengthProp);
                            std::vector<WGPUBindGroupLayout> layouts;
                            layouts.reserve(layoutCount);
                            for (int i = 0; i < layoutCount; i++) {
                                auto layoutHandle = state->engine->getPropertyIndex(bindGroupLayouts, i);
                                WGPUBindGroupLayout layout = (WGPUBindGroupLayout)state->engine->getPrivateData(layoutHandle);
                                layouts.push_back(layout);
                            }
                            WGPUPipelineLayoutDescriptor layoutDesc = {};
                            layoutDesc.bindGroupLayoutCount = layouts.size();
                            layoutDesc.bindGroupLayouts = layouts.data();
                            WGPUPipelineLayout pipelineLayout = wgpuDeviceCreatePipelineLayout(state->device, &layoutDesc);
                            if (!requireHandle(state->engine, pipelineLayout, "device.createPipelineLayout",
                                               "bindGroupLayouts=" + std::to_string(layouts.size())))
                                return state->engine->newUndefined();
                            auto jsLayout = state->engine->newObject();
                            state->engine->setPrivateData(jsLayout, pipelineLayout);
                            if (state->verboseLogging) std::cout << "[WebGPU] Created pipeline layout with " << layoutCount << " bind group layouts" << std::endl;
                            return jsLayout;
}

static js::JSValueHandle tnWebgpuHandler69(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            if (args.empty()) {
                                state->engine->throwException("createBindGroup requires a descriptor");
                                return state->engine->newUndefined();
                            }
                            auto descriptor = args[0];
                            auto layoutHandle = state->engine->getProperty(descriptor, "layout");
                            WGPUBindGroupLayout layout = (WGPUBindGroupLayout)state->engine->getPrivateData(layoutHandle);
                            if (!layout) {
                                state->engine->throwException("Failed to create bind group");
                                return state->engine->newUndefined();
                            }
                            auto entries = state->engine->getProperty(descriptor, "entries");
                            auto lengthProp = state->engine->getProperty(entries, "length");
                            int entryCount = state->engine->isUndefined(lengthProp) ? 0 : (int)state->engine->toNumber(lengthProp);
                            std::vector<WGPUBindGroupEntry> bindGroupEntries;
                            bindGroupEntries.reserve(entryCount);
                            std::vector<WGPUTextureView> autoCreatedViews;
                            auto releaseAutoCreatedViews = [&autoCreatedViews]() {
                                for (auto v : autoCreatedViews) {
                                    wgpuTextureViewRelease(v);
                                }
                            };
                            auto failResource = [&](const std::string& resourceType, const std::string& reason, uint32_t binding) -> js::JSValueHandle {
                                releaseAutoCreatedViews();
                                const std::string message =
                                    "Failed to create bind group: " + resourceType +
                                    " at binding " + std::to_string(binding) + ": " + reason;
                                state->engine->throwException(message.c_str());
                                return state->engine->newUndefined();
                            };
                            for (int i = 0; i < entryCount; i++) {
                                auto entry = state->engine->getPropertyIndex(entries, i);
                                WGPUBindGroupEntry bgEntry = {};
                                bgEntry.binding = (uint32_t)state->engine->toNumber(state->engine->getProperty(entry, "binding"));
                                auto resource = state->engine->getProperty(entry, "resource");
                                if (state->engine->isUndefined(resource) || state->engine->isNull(resource)) {
                                    return failResource("resource", "resource handle is null or undefined", bgEntry.binding);
                                }
                                // Check if resource is a sampler (has no buffer property)
                                auto bufferProp = state->engine->getProperty(resource, "buffer");
                                if (!state->engine->isUndefined(bufferProp)) {
                                    // Buffer binding: {buffer, offset?, size?}
                                    bgEntry.buffer = (WGPUBuffer)state->engine->getPrivateData(bufferProp);
                                    if (!bgEntry.buffer) {
                                        return failResource("buffer", "native handle is null", bgEntry.binding);
                                    }
                                    auto offset = state->engine->getProperty(resource, "offset");
                                    bgEntry.offset = state->engine->isUndefined(offset) ? 0 : (uint64_t)state->engine->toNumber(offset);
                                    auto size = state->engine->getProperty(resource, "size");
                                    // Size 0 means whole buffer
                                    bgEntry.size = state->engine->isUndefined(size) ? WGPU_WHOLE_SIZE : (uint64_t)state->engine->toNumber(size);
                                } else {
                                    // Could be a sampler or texture view
                                    void* resourcePtr = state->engine->getPrivateData(resource);
                                    // Check for type hints set when creating the object
                                    auto typeHint = state->engine->getProperty(resource, "_type");
                                    if (!state->engine->isUndefined(typeHint)) {
                                        std::string typeStr = state->engine->toString(typeHint);
                                        if (typeStr == "sampler") {
                                            if (resourcePtr) {
                                                bgEntry.sampler = (WGPUSampler)resourcePtr;
                                            } else {
                                                return failResource("sampler", "native handle is null", bgEntry.binding);
                                            }
                                        } else if (typeStr == "textureView") {
                                            if (resourcePtr) {
                                                bgEntry.textureView = (WGPUTextureView)resourcePtr;
                                            } else {
                                                return failResource("texture view", "native handle is null", bgEntry.binding);
                                            }
                                        } else if (!resourcePtr) {
                                            return failResource("resource", "native handle is null", bgEntry.binding);
                                        }
                                    } else if (resourcePtr) {
                                        // No type hint - try to detect based on properties
                                        // Check if it looks like a texture (has width/height/format properties)
                                        auto widthProp = state->engine->getProperty(resource, "width");
                                        auto formatProp = state->engine->getProperty(resource, "format");
                                        if (!state->engine->isUndefined(widthProp) && !state->engine->isUndefined(formatProp)) {
                                            // This is a texture, create a view automatically
                                            WGPUTexture tex = (WGPUTexture)resourcePtr;
                                            WGPUTextureViewDescriptor viewDesc = {};
                                            WGPUTextureView view = wgpuTextureCreateView(tex, &viewDesc);
                                            if (!requireHandle(state->engine, view, "device.createBindGroup/autoTextureView",
                                                               "binding=" + std::to_string(bgEntry.binding))) {
                                                return failResource("texture view", "native handle is null after automatic creation", bgEntry.binding);
                                            }
                                            autoCreatedViews.push_back(view);
                                            bgEntry.textureView = view;
                                            if (state->verboseLogging) std::cout << "[WebGPU] Auto-created texture view for binding " << bgEntry.binding << std::endl;
                                        } else {
                                            // Assume sampler as fallback
                                            bgEntry.sampler = (WGPUSampler)resourcePtr;
                                        }
                                    } else {
                                        return failResource("resource", "native handle is null", bgEntry.binding);
                                    }
                                }
                                bindGroupEntries.push_back(bgEntry);
                            }
                            WGPUBindGroupDescriptor bgDesc = {};
                            bgDesc.layout = layout;
                            bgDesc.entryCount = bindGroupEntries.size();
                            bgDesc.entries = bindGroupEntries.data();
                            WGPUBindGroup bindGroup = wgpuDeviceCreateBindGroup(state->device, &bgDesc);
                            if (!bindGroup) {
                                releaseAutoCreatedViews();
                                // Name the operation in the platform log — logcat is the only place a
                                // phone crash can be read from — then fail closed with this binding's
                                // own message.
                                requireHandle(state->engine, bindGroup, "device.createBindGroup",
                                              "entries=" + std::to_string(bindGroupEntries.size()));
                                state->engine->throwException("Failed to create bind group");
                                return state->engine->newUndefined();
                            }
                            // Release auto-created texture views — Dawn holds its own
                            // internal references through the bind group
                            releaseAutoCreatedViews();
                            auto jsBindGroup = state->engine->newObject();
                            state->engine->setPrivateData(jsBindGroup, bindGroup);
                            state->engine->registerRelease(jsBindGroup, [bindGroup]() {
                                wgpuBindGroupRelease(bindGroup);
                            });
                            if (state->verboseLogging) std::cout << "[WebGPU] Created bind group with " << entryCount << " entries" << std::endl;
                            return jsBindGroup;
}

static js::JSValueHandle tnWebgpuHandler68(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            if (args.empty()) {
                                state->engine->throwException("createBindGroupLayout requires a descriptor");
                                return state->engine->newUndefined();
                            }
                            auto descriptor = args[0];
                            auto entries = state->engine->getProperty(descriptor, "entries");
                            auto lengthProp = state->engine->getProperty(entries, "length");
                            int entryCount = state->engine->isUndefined(lengthProp) ? 0 : (int)state->engine->toNumber(lengthProp);
                            std::vector<WGPUBindGroupLayoutEntry> layoutEntries;
                            layoutEntries.reserve(entryCount);
                            for (int i = 0; i < entryCount; i++) {
                                auto entry = state->engine->getPropertyIndex(entries, i);
                                WGPUBindGroupLayoutEntry layoutEntry = {};
                                layoutEntry.binding = (uint32_t)state->engine->toNumber(state->engine->getProperty(entry, "binding"));
                                layoutEntry.visibility = (WGPUShaderStage)(uint32_t)state->engine->toNumber(state->engine->getProperty(entry, "visibility"));
                                // Check for buffer binding
                                auto buffer = state->engine->getProperty(entry, "buffer");
                                if (!state->engine->isUndefined(buffer)) {
                                    auto typeProp = state->engine->getProperty(buffer, "type");
                                    std::string typeStr = state->engine->isUndefined(typeProp) ? "" : state->engine->toString(typeProp);
                                    if (typeStr == "uniform" || typeStr == "") {
                                        // Default to uniform if no type specified (Three.js uses empty {})
                                        layoutEntry.buffer.type = WGPUBufferBindingType_Uniform;
                                    } else if (typeStr == "storage") {
                                        layoutEntry.buffer.type = WGPUBufferBindingType_Storage;
                                    } else if (typeStr == "read-only-storage") {
                                        layoutEntry.buffer.type = WGPUBufferBindingType_ReadOnlyStorage;
                                    } else {
                                        // Default to uniform for unknown types
                                        layoutEntry.buffer.type = WGPUBufferBindingType_Uniform;
                                    }
                                }
                                // Check for sampler binding
                                auto sampler = state->engine->getProperty(entry, "sampler");
                                if (!state->engine->isUndefined(sampler)) {
                                    std::string typeStr = state->engine->toString(state->engine->getProperty(sampler, "type"));
                                    if (typeStr == "filtering") {
                                        layoutEntry.sampler.type = WGPUSamplerBindingType_Filtering;
                                    } else if (typeStr == "non-filtering") {
                                        layoutEntry.sampler.type = WGPUSamplerBindingType_NonFiltering;
                                    } else if (typeStr == "comparison") {
                                        layoutEntry.sampler.type = WGPUSamplerBindingType_Comparison;
                                    } else {
                                        // Default to filtering
                                        layoutEntry.sampler.type = WGPUSamplerBindingType_Filtering;
                                    }
                                }
                                // Check for texture binding
                                auto texture = state->engine->getProperty(entry, "texture");
                                if (!state->engine->isUndefined(texture)) {
                                    auto sampleTypeProp = state->engine->getProperty(texture, "sampleType");
                                    std::string sampleType = state->engine->isUndefined(sampleTypeProp) ? "" : state->engine->toString(sampleTypeProp);
                                    if (sampleType == "float" || sampleType == "") {
                                        // Default to float if no type specified (Three.js uses empty {})
                                        layoutEntry.texture.sampleType = WGPUTextureSampleType_Float;
                                    } else if (sampleType == "unfilterable-float") {
                                        layoutEntry.texture.sampleType = WGPUTextureSampleType_UnfilterableFloat;
                                    } else if (sampleType == "depth") {
                                        layoutEntry.texture.sampleType = WGPUTextureSampleType_Depth;
                                    } else if (sampleType == "sint") {
                                        layoutEntry.texture.sampleType = WGPUTextureSampleType_Sint;
                                    } else if (sampleType == "uint") {
                                        layoutEntry.texture.sampleType = WGPUTextureSampleType_Uint;
                                    } else {
                                        // Default to float for unknown types
                                        layoutEntry.texture.sampleType = WGPUTextureSampleType_Float;
                                    }
                                    auto viewDim = state->engine->getProperty(texture, "viewDimension");
                                    if (!state->engine->isUndefined(viewDim)) {
                                        layoutEntry.texture.viewDimension = stringToTextureViewDimension(state->engine->toString(viewDim));
                                    } else {
                                        layoutEntry.texture.viewDimension = WGPUTextureViewDimension_2D;
                                    }
                                    auto multisampled = state->engine->getProperty(texture, "multisampled");
                                    layoutEntry.texture.multisampled = !state->engine->isUndefined(multisampled) && state->engine->toBoolean(multisampled);
                                }
                                // Check for storageTexture binding
                                auto storageTexture = state->engine->getProperty(entry, "storageTexture");
                                if (!state->engine->isUndefined(storageTexture)) {
                                    std::string access = state->engine->toString(state->engine->getProperty(storageTexture, "access"));
                                    if (access == "write-only") {
                                        layoutEntry.storageTexture.access = WGPUStorageTextureAccess_WriteOnly;
                                    } else if (access == "read-only") {
                                        layoutEntry.storageTexture.access = WGPUStorageTextureAccess_ReadOnly;
                                    } else if (access == "read-write") {
                                        layoutEntry.storageTexture.access = WGPUStorageTextureAccess_ReadWrite;
                                    }
                                    auto format = state->engine->getProperty(storageTexture, "format");
                                    if (!state->engine->isUndefined(format)) {
                                        layoutEntry.storageTexture.format = stringToFormat(state->engine->toString(format));
                                    }
                                    auto viewDim = state->engine->getProperty(storageTexture, "viewDimension");
                                    if (!state->engine->isUndefined(viewDim)) {
                                        layoutEntry.storageTexture.viewDimension = stringToTextureViewDimension(state->engine->toString(viewDim));
                                    } else {
                                        layoutEntry.storageTexture.viewDimension = WGPUTextureViewDimension_2D;
                                    }
                                }
                                layoutEntries.push_back(layoutEntry);
                            }
                            WGPUBindGroupLayoutDescriptor layoutDesc = {};
                            layoutDesc.entryCount = layoutEntries.size();
                            layoutDesc.entries = layoutEntries.data();
                            WGPUBindGroupLayout layout = wgpuDeviceCreateBindGroupLayout(state->device, &layoutDesc);
                            if (!requireHandle(state->engine, layout, "device.createBindGroupLayout",
                                               "entries=" + std::to_string(entryCount)))
                                return state->engine->newUndefined();
                            auto jsLayout = state->engine->newObject();
                            state->engine->setPrivateData(jsLayout, layout);
                            if (state->verboseLogging) std::cout << "[WebGPU] Created bind group layout with " << entryCount << " entries" << std::endl;
                            return jsLayout;
}

static js::JSValueHandle tnWebgpuHandler67(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            WGPUSamplerDescriptor samplerDesc = {};
                            // Default values
                            samplerDesc.addressModeU = WGPUAddressMode_ClampToEdge;
                            samplerDesc.addressModeV = WGPUAddressMode_ClampToEdge;
                            samplerDesc.addressModeW = WGPUAddressMode_ClampToEdge;
                            samplerDesc.magFilter = WGPUFilterMode_Nearest;
                            samplerDesc.minFilter = WGPUFilterMode_Nearest;
                            samplerDesc.mipmapFilter = WGPUMipmapFilterMode_Nearest;
                            samplerDesc.lodMinClamp = 0.0f;
                            samplerDesc.lodMaxClamp = 32.0f;
                            samplerDesc.maxAnisotropy = 1;
                            if (!args.empty()) {
                                auto descriptor = args[0];
                                auto addressModeU = state->engine->getProperty(descriptor, "addressModeU");
                                if (!state->engine->isUndefined(addressModeU)) {
                                    samplerDesc.addressModeU = stringToAddressMode(state->engine->toString(addressModeU));
                                }
                                auto addressModeV = state->engine->getProperty(descriptor, "addressModeV");
                                if (!state->engine->isUndefined(addressModeV)) {
                                    samplerDesc.addressModeV = stringToAddressMode(state->engine->toString(addressModeV));
                                }
                                auto addressModeW = state->engine->getProperty(descriptor, "addressModeW");
                                if (!state->engine->isUndefined(addressModeW)) {
                                    samplerDesc.addressModeW = stringToAddressMode(state->engine->toString(addressModeW));
                                }
                                auto magFilter = state->engine->getProperty(descriptor, "magFilter");
                                if (!state->engine->isUndefined(magFilter)) {
                                    samplerDesc.magFilter = stringToFilterMode(state->engine->toString(magFilter));
                                }
                                auto minFilter = state->engine->getProperty(descriptor, "minFilter");
                                if (!state->engine->isUndefined(minFilter)) {
                                    samplerDesc.minFilter = stringToFilterMode(state->engine->toString(minFilter));
                                }
                                auto mipmapFilter = state->engine->getProperty(descriptor, "mipmapFilter");
                                if (!state->engine->isUndefined(mipmapFilter)) {
                                    samplerDesc.mipmapFilter = stringToMipmapFilterMode(state->engine->toString(mipmapFilter));
                                }
                                auto lodMinClamp = state->engine->getProperty(descriptor, "lodMinClamp");
                                if (!state->engine->isUndefined(lodMinClamp)) {
                                    samplerDesc.lodMinClamp = (float)state->engine->toNumber(lodMinClamp);
                                }
                                auto lodMaxClamp = state->engine->getProperty(descriptor, "lodMaxClamp");
                                if (!state->engine->isUndefined(lodMaxClamp)) {
                                    samplerDesc.lodMaxClamp = (float)state->engine->toNumber(lodMaxClamp);
                                }
                                auto compare = state->engine->getProperty(descriptor, "compare");
                                if (!state->engine->isUndefined(compare)) {
                                    samplerDesc.compare = stringToCompareFunction(state->engine->toString(compare));
                                }
                                auto maxAnisotropy = state->engine->getProperty(descriptor, "maxAnisotropy");
                                if (!state->engine->isUndefined(maxAnisotropy)) {
                                    samplerDesc.maxAnisotropy = (uint16_t)state->engine->toNumber(maxAnisotropy);
                                }
                            }
#if defined(MYSTRAL_WEBGPU_WGPU)
                            // wgpu-native's Vulkan backend returns zero when Three.js samples
                            // a one-level render target with its generic lodMaxClamp of 32.
                            // Samplers are created before they are paired with a texture view,
                            // so keep filtering intact and cap the backend's effective LOD range.
                            if (samplerDesc.lodMaxClamp > 1.0f) {
                                samplerDesc.lodMaxClamp = 1.0f;
                            }
#endif
                            if (samplerDesc.lodMinClamp > samplerDesc.lodMaxClamp) {
                                state->engine->throwException("Failed to create sampler");
                                return state->engine->newUndefined();
                            }
                            WGPUSampler sampler = wgpuDeviceCreateSampler(state->device, &samplerDesc);
                            if (!sampler) {
                                state->engine->throwException("Failed to create sampler");
                                return state->engine->newUndefined();
                            }
                            auto jsSampler = state->engine->newObject();
                            state->engine->setPrivateData(jsSampler, sampler);
                            state->engine->setProperty(jsSampler, "_type", state->engine->newString("sampler"));
                            if (state->verboseLogging) std::cout << "[WebGPU] Created sampler" << std::endl;
                            return jsSampler;
}

static js::JSValueHandle tnWebgpuHandler66(
    BindingsState* state,
    uint64_t textureId,
    const std::vector<js::JSValueHandle>&) {
                                    releaseTextureRegistryEntry(state, textureId);
                                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler65(BindingsState* state, uint64_t textureId, const std::vector<js::JSValueHandle>& args) {
                                    // Look up texture from registry using captured textureId
                                    auto it = state->textureRegistry.find(textureId);
                                    if (it == state->textureRegistry.end()) {
                                        std::cerr << "[WebGPU] createView: Texture " << textureId << " not found in registry" << std::endl;
                                        return state->engine->newUndefined();
                                    }
                                    WGPUTexture texture = it->second.texture;
                                    if (!texture) {
                                        std::cerr << "[WebGPU] createView: Texture " << textureId << " is null" << std::endl;
                                        return state->engine->newUndefined();
                                    }
                                    WGPUTextureViewDescriptor viewDesc = {};
                                    // Default values - use all mips and layers from the texture
                                    viewDesc.format = it->second.format;
                                    viewDesc.mipLevelCount = it->second.mipLevelCount > 0 ? it->second.mipLevelCount : 1;
                                    viewDesc.baseMipLevel = 0;
                                    viewDesc.baseArrayLayer = 0;
                                    viewDesc.aspect = WGPUTextureAspect_All;
                                    // Default dimension and arrayLayerCount based on texture dimension
                                    if (it->second.dimension == WGPUTextureDimension_3D) {
                                        // 3D textures: view as 3D, arrayLayerCount must be 1
                                        viewDesc.dimension = WGPUTextureViewDimension_3D;
                                        viewDesc.arrayLayerCount = 1;
                                    } else if (it->second.dimension == WGPUTextureDimension_1D) {
                                        // 1D textures
                                        viewDesc.dimension = WGPUTextureViewDimension_1D;
                                        viewDesc.arrayLayerCount = 1;
                                    } else {
                                        // 2D textures: use layers for 2D-array, 1 for regular 2D
                                        viewDesc.arrayLayerCount = it->second.depthOrArrayLayers > 0 ? it->second.depthOrArrayLayers : 1;
                                        viewDesc.dimension = it->second.depthOrArrayLayers > 1 ? WGPUTextureViewDimension_2DArray : WGPUTextureViewDimension_2D;
                                    }
                                    // Parse view descriptor if provided
                                    if (!args.empty() && !state->engine->isUndefined(args[0])) {
                                        auto descriptor = args[0];
                                        // format (optional, defaults to texture format)
                                        auto formatProp = state->engine->getProperty(descriptor, "format");
                                        if (!state->engine->isUndefined(formatProp)) {
                                            viewDesc.format = stringToFormat(state->engine->toString(formatProp));
                                        } else {
                                            viewDesc.format = it->second.format;
                                        }
                                        // dimension (optional)
                                        auto dimensionProp = state->engine->getProperty(descriptor, "dimension");
                                        if (!state->engine->isUndefined(dimensionProp)) {
                                            std::string dimStr = state->engine->toString(dimensionProp);
                                            if (dimStr == "1d") viewDesc.dimension = WGPUTextureViewDimension_1D;
                                            else if (dimStr == "2d") viewDesc.dimension = WGPUTextureViewDimension_2D;
                                            else if (dimStr == "2d-array") viewDesc.dimension = WGPUTextureViewDimension_2DArray;
                                            else if (dimStr == "cube") viewDesc.dimension = WGPUTextureViewDimension_Cube;
                                            else if (dimStr == "cube-array") viewDesc.dimension = WGPUTextureViewDimension_CubeArray;
                                            else if (dimStr == "3d") viewDesc.dimension = WGPUTextureViewDimension_3D;
                                        }
                                        // aspect (optional)
                                        auto aspectProp = state->engine->getProperty(descriptor, "aspect");
                                        if (!state->engine->isUndefined(aspectProp)) {
                                            std::string aspectStr = state->engine->toString(aspectProp);
                                            if (aspectStr == "all") viewDesc.aspect = WGPUTextureAspect_All;
                                            else if (aspectStr == "stencil-only") viewDesc.aspect = WGPUTextureAspect_StencilOnly;
                                            else if (aspectStr == "depth-only") viewDesc.aspect = WGPUTextureAspect_DepthOnly;
                                        }
                                        // baseMipLevel (optional)
                                        auto baseMipProp = state->engine->getProperty(descriptor, "baseMipLevel");
                                        if (!state->engine->isUndefined(baseMipProp)) {
                                            viewDesc.baseMipLevel = (uint32_t)state->engine->toNumber(baseMipProp);
                                        }
                                        // mipLevelCount (optional)
                                        auto mipCountProp = state->engine->getProperty(descriptor, "mipLevelCount");
                                        if (!state->engine->isUndefined(mipCountProp)) {
                                            viewDesc.mipLevelCount = (uint32_t)state->engine->toNumber(mipCountProp);
                                        }
                                        // baseArrayLayer (optional)
                                        auto baseLayerProp = state->engine->getProperty(descriptor, "baseArrayLayer");
                                        if (!state->engine->isUndefined(baseLayerProp)) {
                                            viewDesc.baseArrayLayer = (uint32_t)state->engine->toNumber(baseLayerProp);
                                        }
                                        // arrayLayerCount (optional)
                                        auto layerCountProp = state->engine->getProperty(descriptor, "arrayLayerCount");
                                        if (!state->engine->isUndefined(layerCountProp)) {
                                            uint32_t requested = (uint32_t)state->engine->toNumber(layerCountProp);
                                            uint32_t maxLayers = it->second.depthOrArrayLayers > 0 ? it->second.depthOrArrayLayers : 1;
                                            // Clamp to actual texture layer count
                                            viewDesc.arrayLayerCount = std::min(requested, maxLayers - viewDesc.baseArrayLayer);
                                        }
                                    }
                                    // else: defaults are already set above
                                    // Final validation: Fix arrayLayerCount based on view dimension
                                    if (viewDesc.dimension == WGPUTextureViewDimension_3D ||
                                        viewDesc.dimension == WGPUTextureViewDimension_1D) {
                                        // 3D/1D textures have no array layers
                                        viewDesc.arrayLayerCount = 1;
                                    } else if (viewDesc.dimension == WGPUTextureViewDimension_Cube) {
                                        // Cube requires exactly 6 layers (the 6 faces)
                                        viewDesc.arrayLayerCount = 6;
                                    } else if (viewDesc.dimension == WGPUTextureViewDimension_CubeArray) {
                                        // CubeArray must have multiple of 6 layers
                                        uint32_t maxLayers = it->second.depthOrArrayLayers > 0 ? it->second.depthOrArrayLayers : 6;
                                        viewDesc.arrayLayerCount = std::min(viewDesc.arrayLayerCount, maxLayers);
                                        // Round down to nearest multiple of 6
                                        viewDesc.arrayLayerCount = (viewDesc.arrayLayerCount / 6) * 6;
                                        if (viewDesc.arrayLayerCount < 6) viewDesc.arrayLayerCount = 6;
                                    }
                                    WGPUTextureView view = wgpuTextureCreateView(texture, &viewDesc);
                                    // PRD-207 routes the offscreen-canvas texture through the same wrapper, so
                                    // this one site is what main's `offscreenTexture.createView` guarded as well.
                                    if (!requireHandle(state->engine, view, "texture.createView",
                                                       "textureId=" + std::to_string(textureId)))
                                        return state->engine->newUndefined();
                                    auto jsView = state->engine->newObject();
                                    state->engine->setPrivateData(jsView, view);
                                    state->engine->setProperty(jsView, "_type", state->engine->newString("textureView"));
                                    state->engine->registerRelease(jsView, [view]() {
                                        wgpuTextureViewRelease(view);
                                    });
                                    return jsView;
}

static js::JSValueHandle tnWebgpuHandler64(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            mystral::StallScope stall(mystral::StallSegment::TextureUpload);
                            if (args.empty()) {
                                state->engine->throwException("createTexture requires a descriptor");
                                return state->engine->newUndefined();
                            }
                            auto descriptor = args[0];
                            // Parse size - can be [width, height, depth] array or {width, height, depthOrArrayLayers} object
                            auto sizeVal = state->engine->getProperty(descriptor, "size");
                            uint32_t width = 1, height = 1, depthOrArrayLayers = 1;
                            // Check if size is an array
                            auto lengthProp = state->engine->getProperty(sizeVal, "length");
                            if (!state->engine->isUndefined(lengthProp)) {
                                // Array format: [width, height?, depth?]
                                int len = (int)state->engine->toNumber(lengthProp);
                                if (len >= 1) width = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(sizeVal, 0));
                                if (len >= 2) height = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(sizeVal, 1));
                                if (len >= 3) depthOrArrayLayers = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(sizeVal, 2));
                            } else {
                                // Object format: {width, height, depthOrArrayLayers}
                                auto w = state->engine->getProperty(sizeVal, "width");
                                auto h = state->engine->getProperty(sizeVal, "height");
                                auto d = state->engine->getProperty(sizeVal, "depthOrArrayLayers");
                                if (!state->engine->isUndefined(w)) width = (uint32_t)state->engine->toNumber(w);
                                if (!state->engine->isUndefined(h)) height = (uint32_t)state->engine->toNumber(h);
                                if (!state->engine->isUndefined(d)) depthOrArrayLayers = (uint32_t)state->engine->toNumber(d);
                            }
                            // Parse format
                            std::string formatStr = state->engine->toString(state->engine->getProperty(descriptor, "format"));
                            WGPUTextureFormat format = stringToFormat(formatStr);
                            // Parse usage
                            double usageVal = state->engine->toNumber(state->engine->getProperty(descriptor, "usage"));
                            WGPUTextureUsage usage = (WGPUTextureUsage)(uint32_t)usageVal;
                            // Fix format/usage incompatibility:
                            // BGRA8UnormSrgb doesn't support StorageBinding, convert to BGRA8Unorm or RGBA8Unorm
                            if (format == WGPUTextureFormat_BGRA8UnormSrgb && (usage & WGPUTextureUsage_StorageBinding)) {
                                std::cout << "[WebGPU] Warning: BGRA8UnormSrgb doesn't support StorageBinding, using RGBA8Unorm instead" << std::endl;
                                format = WGPUTextureFormat_RGBA8Unorm;
                                formatStr = "rgba8unorm";
                            }
                            // Also handle BGRA8Unorm which may not support storage on all platforms
                            if (format == WGPUTextureFormat_BGRA8Unorm && (usage & WGPUTextureUsage_StorageBinding)) {
                                std::cout << "[WebGPU] Warning: BGRA8Unorm may not support StorageBinding, using RGBA8Unorm instead" << std::endl;
                                format = WGPUTextureFormat_RGBA8Unorm;
                                formatStr = "rgba8unorm";
                            }
                            // Parse optional properties
                            std::string dimensionStr = state->engine->toString(state->engine->getProperty(descriptor, "dimension"));
                            WGPUTextureDimension dimension = dimensionStr.empty() ? WGPUTextureDimension_2D : stringToTextureDimension(dimensionStr);
                            auto mipLevelCountVal = state->engine->getProperty(descriptor, "mipLevelCount");
                            uint32_t mipLevelCount = state->engine->isUndefined(mipLevelCountVal) ? 1 : (uint32_t)state->engine->toNumber(mipLevelCountVal);
                            auto sampleCountVal = state->engine->getProperty(descriptor, "sampleCount");
                            uint32_t sampleCount = state->engine->isUndefined(sampleCountVal) ? 1 : (uint32_t)state->engine->toNumber(sampleCountVal);
                            // Create texture descriptor
                            WGPUTextureDescriptor texDesc = {};
                            texDesc.size.width = width;
                            texDesc.size.height = height;
                            texDesc.size.depthOrArrayLayers = depthOrArrayLayers;
                            texDesc.format = format;
                            texDesc.usage = usage;
                            texDesc.dimension = dimension;
                            texDesc.mipLevelCount = mipLevelCount;
                            texDesc.sampleCount = sampleCount;
                            WGPUTexture texture = wgpuDeviceCreateTexture(state->device, &texDesc);
                            if (!texture) {
                                state->engine->throwException("Failed to create texture");
                                return state->engine->newUndefined();
                            }
                            // Create JS wrapper
                            auto jsTexture = state->engine->newObject();
                            state->engine->setPrivateData(jsTexture, texture);
                            // Store texture properties
                            state->engine->setProperty(jsTexture, "width", state->engine->newNumber(width));
                            state->engine->setProperty(jsTexture, "height", state->engine->newNumber(height));
                            state->engine->setProperty(jsTexture, "depthOrArrayLayers", state->engine->newNumber(depthOrArrayLayers));
                            state->engine->setProperty(jsTexture, "format", state->engine->newString(formatStr.c_str()));
                            state->engine->setProperty(jsTexture, "mipLevelCount", state->engine->newNumber(mipLevelCount));
                            state->engine->setProperty(jsTexture, "sampleCount", state->engine->newNumber(sampleCount));
                            // Register texture for lookup by createView
                            uint64_t textureId = state->nextTextureId++;
                            TextureInfo textureInfo;
                            textureInfo.texture = texture;
                            textureInfo.format = format;
                            textureInfo.width = width;
                            textureInfo.height = height;
                            textureInfo.depthOrArrayLayers = depthOrArrayLayers;
                            textureInfo.mipLevelCount = mipLevelCount;
                            textureInfo.dimension = dimension;
                            textureInfo.sampleCount = sampleCount;
                            textureInfo.ownsTexture = true;
                            textureInfo.accounted = false;
                            state->textureRegistry[textureId] = textureInfo;
                            // Store texture ID for lookup
                            state->engine->setProperty(jsTexture, "_textureId", state->engine->newNumber((double)textureId));
                            // texture.createView(descriptor?) - Store texture ID for lookup
                            // We store the textureId to look up the texture later since callbacks don't have 'this'
                            state->engine->setProperty(jsTexture, "_createViewTextureId", state->engine->newNumber((double)textureId));
                            if (!installBindingTable(state->engine, state, bindingTable({
                                {"GPUTexture", "createView", 0, nullptr,
                                makeCapturedHandler(textureId, &tnWebgpuHandler65)
                            , jsTexture},
                            // texture.destroy()
                                                            {"GPUTexture", "destroy", 0, nullptr,
                                makeCapturedHandler(textureId, &tnWebgpuHandler66)
                            , jsTexture}}))) {
                                releaseTextureRegistryEntry(state, textureId);
                                return state->engine->newUndefined();
                            }
                            recordTextureCreated(state, width, height, depthOrArrayLayers, mipLevelCount,
                                                 sampleCount, formatStr);
                            state->textureRegistry[textureId].accounted = true;
                            if (state->verboseLogging) std::cout << "[WebGPU] Created texture " << width << "x" << height << " format=" << formatStr << " (id=" << textureId << ")" << std::endl;
                            return jsTexture;
}

static js::JSValueHandle tnWebgpuHandler63(BindingsState* state, WGPUCommandEncoder capturedEncoder, const std::vector<js::JSValueHandle>& args) {
                                    // Use captured encoder for this specific command encoder
                                    WGPUCommandEncoder encoderToFinish = capturedEncoder;
                                    if (!encoderToFinish ||
                                        state->commandEncoderRegistry.find(encoderToFinish) ==
                                            state->commandEncoderRegistry.end()) {
                                        return state->engine->newUndefined();
                                    }
                                    // Auto-end any active render/compute passes for THIS encoder
                                    // Look up from per-encoder map, not global
                                    auto renderPassIt = state->encoderRenderPassMap.find(encoderToFinish);
                                    if (renderPassIt != state->encoderRenderPassMap.end() && renderPassIt->second) {
                                        WGPURenderPassEncoder renderPass = renderPassIt->second;
                                        if (state->verboseLogging) std::cout << "[WebGPU] Auto-ending render pass (pass=" << (void*)renderPass << ", encoder=" << (void*)encoderToFinish << ")" << std::endl;
                                        wgpuRenderPassEncoderEnd(renderPass);
                                        wgpuRenderPassEncoderRelease(renderPass);
                                        state->encoderRenderPassMap.erase(renderPassIt);
                                        // Clear global if it matches
                                        if (state->jsRenderPass == renderPass) {
                                            state->jsRenderPass = nullptr;
                                        }
                                        // Mark surface render pass as ended
                                        if (state->surfaceRenderEncoder == encoderToFinish) {
                                            state->surfaceRenderPassEnded = true;
                                            if (state->verboseLogging) std::cout << "[WebGPU] Surface render pass auto-ended (encoder=" << (void*)encoderToFinish << ")" << std::endl;
                                        }
                                    }
                                    auto computePassIt = state->encoderComputePassMap.find(encoderToFinish);
                                    if (computePassIt != state->encoderComputePassMap.end() && computePassIt->second) {
                                        WGPUComputePassEncoder computePass = computePassIt->second;
                                        if (state->verboseLogging) std::cout << "[WebGPU] Auto-ending compute pass (pass=" << (void*)computePass << ", encoder=" << (void*)encoderToFinish << ")" << std::endl;
                                        wgpuComputePassEncoderEnd(computePass);
                                        wgpuComputePassEncoderRelease(computePass);
                                        state->encoderComputePassMap.erase(computePassIt);
                                        // Clear global if it matches
                                        if (state->jsComputePass == computePass) {
                                            state->jsComputePass = nullptr;
                                        }
                                    }
                                    WGPUCommandBufferDescriptor cmdDesc = {};
                                    WGPUCommandBuffer cmdBuffer = nullptr;
                                    if (encoderToFinish) {
                                        cmdBuffer = wgpuCommandEncoderFinish(encoderToFinish, &cmdDesc);
                                        wgpuCommandEncoderRelease(encoderToFinish);
                                        // Clear global if it matches
                                        if (state->jsCommandEncoder == encoderToFinish) {
                                            state->jsCommandEncoder = nullptr;
                                        }
                                        state->commandEncoderRegistry.erase(encoderToFinish);
                                        if (state->surfaceRenderEncoder == encoderToFinish) {
                                            state->surfaceRenderEncoder = nullptr;
                                        }
                                        if (!state->jsCommandEncoder && !state->commandEncoderRegistry.empty()) {
                                            state->jsCommandEncoder = *state->commandEncoderRegistry.begin();
                                        }
                                        // The encoder was checked; the command buffer it returns was not, and a
                                        // NULL one reaches queue.submit(), which reads it inside wgpu-native.
                                        if (!requireHandle(state->engine, cmdBuffer, "commandEncoder.finish"))
                                            return state->engine->newUndefined();
                                        if (state->verboseLogging) std::cout << "[WebGPU] Command encoder finished, buffer: " << cmdBuffer << std::endl;
                                    }
                                    auto jsCommandBuffer = state->engine->newObject();
                                    state->engine->setPrivateData(jsCommandBuffer, cmdBuffer);
                                    return jsCommandBuffer;
}

static js::JSValueHandle tnWebgpuHandler62(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                                    if (args.empty() || !state->jsCommandEncoder) return state->engine->newUndefined();
                                    WGPUBuffer buffer = (WGPUBuffer)state->engine->getPrivateData(args[0]);
                                    uint64_t offset = args.size() > 1 ? (uint64_t)state->engine->toNumber(args[1]) : 0;
                                    uint64_t size = args.size() > 2 ? (uint64_t)state->engine->toNumber(args[2]) : WGPU_WHOLE_SIZE;
                                    if (buffer) {
                                        wgpuCommandEncoderClearBuffer(state->jsCommandEncoder, buffer, offset, size);
                                    }
                                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler61(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                                    if (args.size() < 3 || !state->jsCommandEncoder) return state->engine->newUndefined();
                                    auto sourceProp = args[0];
                                    auto destProp = args[1];
                                    auto sizeProp = args[2];
                                    // Source texture
                                    WGPUTexture srcTexture = (WGPUTexture)state->engine->getPrivateData(state->engine->getProperty(sourceProp, "texture"));
                                    uint32_t srcMipLevel = (uint32_t)state->engine->toNumber(state->engine->getProperty(sourceProp, "mipLevel"));
                                    auto srcOriginProp = state->engine->getProperty(sourceProp, "origin");
                                    uint32_t srcOriginX = 0, srcOriginY = 0, srcOriginZ = 0;
                                    if (!state->engine->isUndefined(srcOriginProp)) {
                                        srcOriginX = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(srcOriginProp, 0));
                                        srcOriginY = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(srcOriginProp, 1));
                                        srcOriginZ = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(srcOriginProp, 2));
                                    }
                                    // Destination texture
                                    WGPUTexture dstTexture = (WGPUTexture)state->engine->getPrivateData(state->engine->getProperty(destProp, "texture"));
                                    uint32_t dstMipLevel = (uint32_t)state->engine->toNumber(state->engine->getProperty(destProp, "mipLevel"));
                                    auto dstOriginProp = state->engine->getProperty(destProp, "origin");
                                    uint32_t dstOriginX = 0, dstOriginY = 0, dstOriginZ = 0;
                                    if (!state->engine->isUndefined(dstOriginProp)) {
                                        dstOriginX = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(dstOriginProp, 0));
                                        dstOriginY = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(dstOriginProp, 1));
                                        dstOriginZ = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(dstOriginProp, 2));
                                    }
                                    // Copy size - handle both array and object forms
                                    uint32_t width = 1, height = 1, depthOrLayers = 1;
                                    if (state->engine->isArray(sizeProp)) {
                                        width = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(sizeProp, 0));
                                        height = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(sizeProp, 1));
                                        auto depthVal = state->engine->getPropertyIndex(sizeProp, 2);
                                        if (!state->engine->isUndefined(depthVal)) {
                                            depthOrLayers = (uint32_t)state->engine->toNumber(depthVal);
                                        }
                                    } else {
                                        width = (uint32_t)state->engine->toNumber(state->engine->getProperty(sizeProp, "width"));
                                        height = (uint32_t)state->engine->toNumber(state->engine->getProperty(sizeProp, "height"));
                                        auto depthVal = state->engine->getProperty(sizeProp, "depthOrArrayLayers");
                                        if (!state->engine->isUndefined(depthVal)) {
                                            depthOrLayers = (uint32_t)state->engine->toNumber(depthVal);
                                        }
                                    }
                                    if (depthOrLayers == 0) depthOrLayers = 1;
                                    if (srcTexture && dstTexture) {
                                        WGPUImageCopyTexture_Compat srcCopy = {};
                                        srcCopy.texture = srcTexture;
                                        srcCopy.mipLevel = srcMipLevel;
                                        srcCopy.origin = {srcOriginX, srcOriginY, srcOriginZ};
                                        WGPUImageCopyTexture_Compat dstCopy = {};
                                        dstCopy.texture = dstTexture;
                                        dstCopy.mipLevel = dstMipLevel;
                                        dstCopy.origin = {dstOriginX, dstOriginY, dstOriginZ};
                                        WGPUExtent3D copySize = {width, height, depthOrLayers};
                                        wgpuCommandEncoderCopyTextureToTexture(state->jsCommandEncoder, &srcCopy, &dstCopy, &copySize);
                                    }
                                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler60(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                                    if (args.size() < 3 || !state->jsCommandEncoder) return state->engine->newUndefined();
                                    auto sourceProp = args[0];
                                    auto destProp = args[1];
                                    auto sizeProp = args[2];
                                    // Source (texture info)
                                    WGPUTexture texture = (WGPUTexture)state->engine->getPrivateData(state->engine->getProperty(sourceProp, "texture"));
                                    uint32_t mipLevel = (uint32_t)state->engine->toNumber(state->engine->getProperty(sourceProp, "mipLevel"));
                                    auto originProp = state->engine->getProperty(sourceProp, "origin");
                                    uint32_t originX = 0, originY = 0, originZ = 0;
                                    if (!state->engine->isUndefined(originProp)) {
                                        originX = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(originProp, 0));
                                        originY = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(originProp, 1));
                                        originZ = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(originProp, 2));
                                    }
                                    // Destination (buffer info)
                                    WGPUBuffer buffer = (WGPUBuffer)state->engine->getPrivateData(state->engine->getProperty(destProp, "buffer"));
                                    uint64_t offset = (uint64_t)state->engine->toNumber(state->engine->getProperty(destProp, "offset"));
                                    uint32_t bytesPerRow = (uint32_t)state->engine->toNumber(state->engine->getProperty(destProp, "bytesPerRow"));
                                    uint32_t rowsPerImage = (uint32_t)state->engine->toNumber(state->engine->getProperty(destProp, "rowsPerImage"));
                                    // Copy size - can be array [w,h,d] or object {width, height, depthOrArrayLayers}
                                    uint32_t width = 0, height = 0, depthOrLayers = 1;
                                    auto widthProp = state->engine->getProperty(sizeProp, "width");
                                    if (!state->engine->isUndefined(widthProp)) {
                                        // Object format: { width, height, depthOrArrayLayers }
                                        width = (uint32_t)state->engine->toNumber(widthProp);
                                        height = (uint32_t)state->engine->toNumber(state->engine->getProperty(sizeProp, "height"));
                                        auto depthProp = state->engine->getProperty(sizeProp, "depthOrArrayLayers");
                                        depthOrLayers = state->engine->isUndefined(depthProp) ? 1 : (uint32_t)state->engine->toNumber(depthProp);
                                    } else {
                                        // Array format: [width, height, depth]
                                        width = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(sizeProp, 0));
                                        height = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(sizeProp, 1));
                                        depthOrLayers = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(sizeProp, 2));
                                    }
                                    if (depthOrLayers == 0) depthOrLayers = 1;
                                    if (state->verboseLogging) {
                                        std::cout << "[WebGPU] copyTextureToBuffer: texture=" << texture
                                                  << ", buffer=" << buffer
                                                  << ", size=" << width << "x" << height << "x" << depthOrLayers
                                                  << ", bytesPerRow=" << bytesPerRow << std::endl;
                                    }
                                    if (buffer && texture) {
                                        WGPUImageCopyTexture_Compat srcCopy = {};
                                        srcCopy.texture = texture;
                                        srcCopy.mipLevel = mipLevel;
                                        srcCopy.origin = {originX, originY, originZ};
                                        WGPUImageCopyBuffer_Compat dstCopy = {};
                                        dstCopy.buffer = buffer;
                                        dstCopy.layout.offset = offset;
                                        dstCopy.layout.bytesPerRow = bytesPerRow;
                                        dstCopy.layout.rowsPerImage = rowsPerImage > 0 ? rowsPerImage : height;
                                        WGPUExtent3D copySize = {width, height, depthOrLayers};
                                        wgpuCommandEncoderCopyTextureToBuffer(state->jsCommandEncoder, &srcCopy, &dstCopy, &copySize);
                                    }
                                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler59(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                                    if (args.size() < 3 || !state->jsCommandEncoder) return state->engine->newUndefined();
                                    auto sourceProp = args[0];
                                    auto destProp = args[1];
                                    auto sizeProp = args[2];
                                    // Source (buffer info)
                                    WGPUBuffer buffer = (WGPUBuffer)state->engine->getPrivateData(state->engine->getProperty(sourceProp, "buffer"));
                                    uint64_t offset = (uint64_t)state->engine->toNumber(state->engine->getProperty(sourceProp, "offset"));
                                    uint32_t bytesPerRow = (uint32_t)state->engine->toNumber(state->engine->getProperty(sourceProp, "bytesPerRow"));
                                    uint32_t rowsPerImage = (uint32_t)state->engine->toNumber(state->engine->getProperty(sourceProp, "rowsPerImage"));
                                    // Destination (texture info)
                                    WGPUTexture texture = (WGPUTexture)state->engine->getPrivateData(state->engine->getProperty(destProp, "texture"));
                                    uint32_t mipLevel = (uint32_t)state->engine->toNumber(state->engine->getProperty(destProp, "mipLevel"));
                                    auto originProp = state->engine->getProperty(destProp, "origin");
                                    uint32_t originX = 0, originY = 0, originZ = 0;
                                    if (!state->engine->isUndefined(originProp)) {
                                        originX = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(originProp, 0));
                                        originY = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(originProp, 1));
                                        originZ = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(originProp, 2));
                                    }
                                    // Copy size
                                    uint32_t width = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(sizeProp, 0));
                                    uint32_t height = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(sizeProp, 1));
                                    uint32_t depthOrLayers = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(sizeProp, 2));
                                    if (depthOrLayers == 0) depthOrLayers = 1;
                                    if (buffer && texture) {
                                        WGPUImageCopyBuffer_Compat srcCopy = {};
                                        srcCopy.buffer = buffer;
                                        srcCopy.layout.offset = offset;
                                        srcCopy.layout.bytesPerRow = bytesPerRow;
                                        srcCopy.layout.rowsPerImage = rowsPerImage > 0 ? rowsPerImage : height;
                                        WGPUImageCopyTexture_Compat dstCopy = {};
                                        dstCopy.texture = texture;
                                        dstCopy.mipLevel = mipLevel;
                                        dstCopy.origin = {originX, originY, originZ};
                                        WGPUExtent3D copySize = {width, height, depthOrLayers};
                                        wgpuCommandEncoderCopyBufferToTexture(state->jsCommandEncoder, &srcCopy, &dstCopy, &copySize);
                                    }
                                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler58(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                                    if (args.size() < 5 || !state->jsCommandEncoder) return state->engine->newUndefined();
                                    WGPUBuffer source = (WGPUBuffer)state->engine->getPrivateData(args[0]);
                                    uint64_t sourceOffset = (uint64_t)state->engine->toNumber(args[1]);
                                    WGPUBuffer destination = (WGPUBuffer)state->engine->getPrivateData(args[2]);
                                    uint64_t destOffset = (uint64_t)state->engine->toNumber(args[3]);
                                    uint64_t size = (uint64_t)state->engine->toNumber(args[4]);
                                    if (source && destination) {
                                        wgpuCommandEncoderCopyBufferToBuffer(state->jsCommandEncoder, source, sourceOffset, destination, destOffset, size);
                                    }
                                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler57(
    BindingsState* state,
    WGPUCommandEncoder capturedEncoder,
    WGPUComputePassEncoder capturedComputePass,
    const std::vector<js::JSValueHandle>&) {
                                            auto passIt = state->encoderComputePassMap.find(capturedEncoder);
                                            if (capturedComputePass && passIt != state->encoderComputePassMap.end() &&
                                                passIt->second == capturedComputePass) {
                                                wgpuComputePassEncoderEnd(capturedComputePass);
                                                wgpuComputePassEncoderRelease(capturedComputePass);
                                                state->encoderComputePassMap.erase(passIt);
                                                if (state->jsComputePass == capturedComputePass) {
                                                    state->jsComputePass = nullptr;
                                                }
                                            }
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler56(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                                            if (args.empty()) return state->engine->newUndefined();
                                            uint32_t countX = (uint32_t)state->engine->toNumber(args[0]);
                                            uint32_t countY = args.size() > 1 ? (uint32_t)state->engine->toNumber(args[1]) : 1;
                                            uint32_t countZ = args.size() > 2 ? (uint32_t)state->engine->toNumber(args[2]) : 1;
                                            if (state->jsComputePass) {
                                                wgpuComputePassEncoderDispatchWorkgroups(state->jsComputePass, countX, countY, countZ);
                                            }
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler55(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                                            if (args.size() < 2) return state->engine->newUndefined();
                                            uint32_t index = (uint32_t)state->engine->toNumber(args[0]);
                                            WGPUBindGroup bindGroup = (WGPUBindGroup)state->engine->getPrivateData(args[1]);
                                            if (state->jsComputePass && bindGroup) {
                                                wgpuComputePassEncoderSetBindGroup(state->jsComputePass, index, bindGroup, 0, nullptr);
                                            }
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler54(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                                            if (args.empty()) return state->engine->newUndefined();
                                            WGPUComputePipeline pipeline = (WGPUComputePipeline)state->engine->getPrivateData(args[0]);
                                            if (state->jsComputePass && pipeline) {
                                                wgpuComputePassEncoderSetPipeline(state->jsComputePass, pipeline);
                                            }
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler53(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                                    if (!state->jsCommandEncoder) {
                                        state->engine->throwException("No command encoder");
                                        return state->engine->newUndefined();
                                    }
                                    WGPUComputePassDescriptor computePassDesc = {};
                                    WGPUCommandEncoder capturedEncoder = state->jsCommandEncoder;
                                    WGPUComputePassEncoder computePass =
                                        wgpuCommandEncoderBeginComputePass(capturedEncoder, &computePassDesc);
                                    if (!requireHandle(state->engine, computePass, "commandEncoder.beginComputePass"))
                                        return state->engine->newUndefined();
                                    const WGPUComputePassEncoder previousJsComputePass =
                                        state->jsComputePass;
                                    const auto previousComputePassIt =
                                        state->encoderComputePassMap.find(capturedEncoder);
                                    const bool hadPreviousComputePass =
                                        previousComputePassIt != state->encoderComputePassMap.end();
                                    const WGPUComputePassEncoder previousComputePassForEncoder =
                                        hadPreviousComputePass ? previousComputePassIt->second : nullptr;
                                    state->jsComputePass = computePass;
                                    state->encoderComputePassMap[capturedEncoder] = computePass;
                                    auto jsComputePass = state->engine->newObject();
                                    // computePass.setPipeline(pipeline)
                                    if (!installBindingTable(state->engine, state, bindingTable({
                                        {"GPUComputePassEncoder", "setPipeline", 0, nullptr,
                                        &tnWebgpuHandler54
                                    , jsComputePass},
                                    // computePass.setBindGroup(index, bindGroup, dynamicOffsets?)
                                                                            {"GPUComputePassEncoder", "setBindGroup", 0, nullptr,
                                        &tnWebgpuHandler55
                                    , jsComputePass},
                                    // computePass.dispatchWorkgroups(countX, countY?, countZ?)
                                                                            {"GPUComputePassEncoder", "dispatchWorkgroups", 0, nullptr,
                                        &tnWebgpuHandler56
                                    , jsComputePass},
                                    // computePass.end()
                                                                            {"GPUComputePassEncoder", "end", 0, nullptr,
                                        makeCapturedPairHandler(capturedEncoder, computePass, &tnWebgpuHandler57)
                                    , jsComputePass}}))) {
                                        wgpuComputePassEncoderEnd(computePass);
                                        wgpuComputePassEncoderRelease(computePass);
                                        auto it = state->encoderComputePassMap.find(capturedEncoder);
                                        if (it != state->encoderComputePassMap.end() && it->second == computePass) {
                                            if (hadPreviousComputePass) {
                                                it->second = previousComputePassForEncoder;
                                            } else {
                                                state->encoderComputePassMap.erase(it);
                                            }
                                        } else if (hadPreviousComputePass) {
                                            state->encoderComputePassMap[capturedEncoder] =
                                                previousComputePassForEncoder;
                                        }
                                        state->jsComputePass = previousJsComputePass;
                                        return state->engine->newUndefined();
                                    }
                                    if (state->verboseLogging) std::cout << "[WebGPU] Compute pass started" << std::endl;
                                    return jsComputePass;
}

static js::JSValueHandle tnWebgpuHandler52(
    BindingsState* state,
    WGPUCommandEncoder capturedEncoderForEnd,
    WGPURenderPassEncoder capturedRenderPass,
    const std::vector<js::JSValueHandle>& args) {
#if TN_ANDROID_JS_PROFILE
                                            const auto profileStart = beginProfiledBinding();
#endif
                                            auto passIt = state->encoderRenderPassMap.find(capturedEncoderForEnd);
                                            if (capturedRenderPass && passIt != state->encoderRenderPassMap.end() &&
                                                passIt->second == capturedRenderPass) {
                                                wgpuRenderPassEncoderEnd(capturedRenderPass);
                                                wgpuRenderPassEncoderRelease(capturedRenderPass);
                                                // Remove from per-encoder map
                                                state->encoderRenderPassMap.erase(passIt);
                                                // Clear global if it matches
                                                if (state->jsRenderPass == capturedRenderPass) {
                                                    state->jsRenderPass = nullptr;
                                                }
                                                // Mark surface render pass as ended
                                                if (state->surfaceRenderEncoder == capturedEncoderForEnd) {
                                                    state->surfaceRenderPassEnded = true;
                                                }
                                                if (state->verboseLogging) std::cout << "[WebGPU] Render pass ended" << std::endl;
                                            }
#if TN_ANDROID_JS_PROFILE
                                            endProfiledBinding(state, ProfiledRenderCommand::EndRenderPass, profileStart);
#endif
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler51(BindingsState* state, WGPURenderPassEncoder capturedRenderPassForBundles, const std::vector<js::JSValueHandle>& args) {
                                            if (args.empty() || !capturedRenderPassForBundles) return state->engine->newUndefined();
#if TN_ANDROID_JS_PROFILE
                                            const auto profileStart = beginProfiledBinding();
#endif
                                            auto bundlesArray = args[0];
                                            auto lengthProp = state->engine->getProperty(bundlesArray, "length");
                                            int bundleCount = state->engine->isUndefined(lengthProp) ? 0 : (int)state->engine->toNumber(lengthProp);
                                            std::vector<WGPURenderBundle> bundles;
                                            bundles.reserve(bundleCount);
                                            for (int i = 0; i < bundleCount; i++) {
                                                auto bundleHandle = state->engine->getPropertyIndex(bundlesArray, i);
                                                WGPURenderBundle bundle = (WGPURenderBundle)state->engine->getPrivateData(bundleHandle);
                                                if (bundle) bundles.push_back(bundle);
                                            }
                                            if (!bundles.empty()) {
                                                wgpuRenderPassEncoderExecuteBundles(capturedRenderPassForBundles, bundles.size(), bundles.data());
#if TN_ANDROID_JS_PROFILE
                                                state->androidJsNativeProfile.bundlesExecuted += bundles.size();
#endif
                                                if (state->verboseLogging) std::cout << "[WebGPU] Executed " << bundles.size() << " render bundles" << std::endl;
                                            }
#if TN_ANDROID_JS_PROFILE
                                            endProfiledBinding(state, ProfiledRenderCommand::ExecuteBundles, profileStart);
#endif
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler50(BindingsState* state, WGPURenderPassEncoder capturedRenderPassForCommands, const std::vector<js::JSValueHandle>& args) {
                                            if (args.empty()) return state->engine->newUndefined();
                                            uint32_t reference = (uint32_t)state->engine->toNumber(args[0]);
                                            if (capturedRenderPassForCommands) {
                                                wgpuRenderPassEncoderSetStencilReference(capturedRenderPassForCommands, reference);
                                            }
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler49(BindingsState* state, WGPURenderPassEncoder capturedRenderPassForCommands, const std::vector<js::JSValueHandle>& args) {
                                            if (args.empty()) return state->engine->newUndefined();
                                            auto color = args[0];
                                            WGPUColor blendColor = {};
                                            if (state->engine->isArray(color)) {
                                                blendColor.r = state->engine->toNumber(state->engine->getPropertyIndex(color, 0));
                                                blendColor.g = state->engine->toNumber(state->engine->getPropertyIndex(color, 1));
                                                blendColor.b = state->engine->toNumber(state->engine->getPropertyIndex(color, 2));
                                                blendColor.a = state->engine->toNumber(state->engine->getPropertyIndex(color, 3));
                                            } else {
                                                blendColor.r = state->engine->toNumber(state->engine->getProperty(color, "r"));
                                                blendColor.g = state->engine->toNumber(state->engine->getProperty(color, "g"));
                                                blendColor.b = state->engine->toNumber(state->engine->getProperty(color, "b"));
                                                blendColor.a = state->engine->toNumber(state->engine->getProperty(color, "a"));
                                            }
                                            if (capturedRenderPassForCommands) {
                                                wgpuRenderPassEncoderSetBlendConstant(capturedRenderPassForCommands, &blendColor);
                                            }
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler48(BindingsState* state, WGPURenderPassEncoder capturedRenderPassForCommands, const std::vector<js::JSValueHandle>& args) {
                                            if (args.size() < 4) return state->engine->newUndefined();
                                            uint32_t x = (uint32_t)state->engine->toNumber(args[0]);
                                            uint32_t y = (uint32_t)state->engine->toNumber(args[1]);
                                            uint32_t width = (uint32_t)state->engine->toNumber(args[2]);
                                            uint32_t height = (uint32_t)state->engine->toNumber(args[3]);
                                            if (capturedRenderPassForCommands) {
                                                wgpuRenderPassEncoderSetScissorRect(capturedRenderPassForCommands, x, y, width, height);
                                                if (state->verboseLogging) std::cout << "[WebGPU] SetScissorRect: " << x << "," << y << " " << width << "x" << height << std::endl;
                                            }
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler47(BindingsState* state, WGPURenderPassEncoder capturedRenderPassForCommands, const std::vector<js::JSValueHandle>& args) {
                                            if (args.size() < 6) return state->engine->newUndefined();
                                            float x = (float)state->engine->toNumber(args[0]);
                                            float y = (float)state->engine->toNumber(args[1]);
                                            float width = (float)state->engine->toNumber(args[2]);
                                            float height = (float)state->engine->toNumber(args[3]);
                                            float minDepth = (float)state->engine->toNumber(args[4]);
                                            float maxDepth = (float)state->engine->toNumber(args[5]);
                                            if (capturedRenderPassForCommands) {
                                                wgpuRenderPassEncoderSetViewport(capturedRenderPassForCommands, x, y, width, height, minDepth, maxDepth);
                                                if (state->verboseLogging) std::cout << "[WebGPU] SetViewport: " << x << "," << y << " " << width << "x" << height << std::endl;
                                            }
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler46(BindingsState* state, WGPURenderPassEncoder capturedRenderPassForCommands, const std::vector<js::JSValueHandle>& args) {
                                            if (args.size() < 2) return state->engine->newUndefined();
                                            WGPUBuffer indirectBuffer = (WGPUBuffer)state->engine->getPrivateData(args[0]);
                                            uint64_t indirectOffset = (uint64_t)state->engine->toNumber(args[1]);
                                            if (capturedRenderPassForCommands && indirectBuffer) {
                                                wgpuRenderPassEncoderDrawIndexedIndirect(capturedRenderPassForCommands, indirectBuffer, indirectOffset);
                                                if (state->verboseLogging) std::cout << "[WebGPU] DrawIndexedIndirect at offset " << indirectOffset << std::endl;
                                            }
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler45(BindingsState* state, WGPURenderPassEncoder capturedRenderPassForCommands, const std::vector<js::JSValueHandle>& args) {
                                            if (args.size() < 2) return state->engine->newUndefined();
                                            WGPUBuffer indirectBuffer = (WGPUBuffer)state->engine->getPrivateData(args[0]);
                                            uint64_t indirectOffset = (uint64_t)state->engine->toNumber(args[1]);
                                            if (capturedRenderPassForCommands && indirectBuffer) {
                                                wgpuRenderPassEncoderDrawIndirect(capturedRenderPassForCommands, indirectBuffer, indirectOffset);
                                                if (state->verboseLogging) std::cout << "[WebGPU] DrawIndirect at offset " << indirectOffset << std::endl;
                                            }
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler44(BindingsState* state, WGPURenderPassEncoder capturedRenderPassForCommands, const std::vector<js::JSValueHandle>& args) {
                                            if (args.empty()) return state->engine->newUndefined();
#if TN_ANDROID_JS_PROFILE
                                            const auto profileStart = beginProfiledBinding();
#endif
                                            uint32_t indexCount = (uint32_t)state->engine->toNumber(args[0]);
                                            uint32_t instanceCount = args.size() > 1 ? (uint32_t)state->engine->toNumber(args[1]) : 1;
                                            uint32_t firstIndex = args.size() > 2 ? (uint32_t)state->engine->toNumber(args[2]) : 0;
                                            int32_t baseVertex = args.size() > 3 ? (int32_t)state->engine->toNumber(args[3]) : 0;
                                            uint32_t firstInstance = args.size() > 4 ? (uint32_t)state->engine->toNumber(args[4]) : 0;
                                            if (capturedRenderPassForCommands) {
                                                wgpuRenderPassEncoderDrawIndexed(capturedRenderPassForCommands, indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
                                                if (state->verboseLogging) std::cout << "[WebGPU] DrawIndexed: " << indexCount << " indices, firstInstance=" << firstInstance << std::endl;
                                            }
#if TN_ANDROID_JS_PROFILE
                                            endProfiledBinding(state, ProfiledRenderCommand::DrawIndexed, profileStart);
#endif
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler43(BindingsState* state, WGPURenderPassEncoder capturedRenderPassForCommands, const std::vector<js::JSValueHandle>& args) {
                                            if (args.size() < 2) return state->engine->newUndefined();
#if TN_ANDROID_JS_PROFILE
                                            const auto profileStart = beginProfiledBinding();
#endif
                                            WGPUBuffer buffer = (WGPUBuffer)state->engine->getPrivateData(args[0]);
                                            std::string formatStr = state->engine->toString(args[1]);
                                            uint64_t offset = args.size() > 2 ? (uint64_t)state->engine->toNumber(args[2]) : 0;
                                            uint64_t size = args.size() > 3 ? (uint64_t)state->engine->toNumber(args[3]) : WGPU_WHOLE_SIZE;
                                            WGPUIndexFormat format = WGPUIndexFormat_Uint16;
                                            if (formatStr == "uint32") format = WGPUIndexFormat_Uint32;
                                            else if (formatStr == "uint16") format = WGPUIndexFormat_Uint16;
                                            if (capturedRenderPassForCommands && buffer) {
                                                wgpuRenderPassEncoderSetIndexBuffer(capturedRenderPassForCommands, buffer, format, offset, size);
                                                if (state->verboseLogging) std::cout << "[WebGPU] Set index buffer, format: " << formatStr << std::endl;
                                            }
#if TN_ANDROID_JS_PROFILE
                                            endProfiledBinding(state, ProfiledRenderCommand::SetIndexBuffer, profileStart);
#endif
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler42(BindingsState* state, WGPURenderPassEncoder capturedRenderPassForCommands, const std::vector<js::JSValueHandle>& args) {
                                            if (args.size() < 2) return state->engine->newUndefined();
#if TN_ANDROID_JS_PROFILE
                                            const auto profileStart = beginProfiledBinding();
#endif
                                            uint32_t slot = (uint32_t)state->engine->toNumber(args[0]);
                                            WGPUBuffer buffer = (WGPUBuffer)state->engine->getPrivateData(args[1]);
                                            uint64_t offset = args.size() > 2 ? (uint64_t)state->engine->toNumber(args[2]) : 0;
                                            uint64_t size = args.size() > 3 ? (uint64_t)state->engine->toNumber(args[3]) : WGPU_WHOLE_SIZE;
                                            if (capturedRenderPassForCommands && buffer) {
                                                wgpuRenderPassEncoderSetVertexBuffer(capturedRenderPassForCommands, slot, buffer, offset, size);
                                                if (state->verboseLogging) std::cout << "[WebGPU] Set vertex buffer at slot " << slot << std::endl;
                                            }
#if TN_ANDROID_JS_PROFILE
                                            endProfiledBinding(state, ProfiledRenderCommand::SetVertexBuffer, profileStart);
#endif
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler41(BindingsState* state, WGPURenderPassEncoder capturedRenderPassForCommands, const std::vector<js::JSValueHandle>& args) {
                                            if (args.empty()) return state->engine->newUndefined();
#if TN_ANDROID_JS_PROFILE
                                            const auto profileStart = beginProfiledBinding();
#endif
                                            uint32_t vertexCount = (uint32_t)state->engine->toNumber(args[0]);
                                            uint32_t instanceCount = args.size() > 1 ? (uint32_t)state->engine->toNumber(args[1]) : 1;
                                            uint32_t firstVertex = args.size() > 2 ? (uint32_t)state->engine->toNumber(args[2]) : 0;
                                            uint32_t firstInstance = args.size() > 3 ? (uint32_t)state->engine->toNumber(args[3]) : 0;
                                            if (capturedRenderPassForCommands) {
                                                wgpuRenderPassEncoderDraw(capturedRenderPassForCommands, vertexCount, instanceCount, firstVertex, firstInstance);
                                                if (state->verboseLogging) std::cout << "[WebGPU] Draw: " << vertexCount << " vertices" << std::endl;
                                            }
#if TN_ANDROID_JS_PROFILE
                                            endProfiledBinding(state, ProfiledRenderCommand::Draw, profileStart);
#endif
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler40(BindingsState* state, WGPURenderPassEncoder capturedRenderPassForCommands, const std::vector<js::JSValueHandle>& args) {
                                            if (args.size() < 2) {
                                                state->engine->throwException("setBindGroup requires index and bindGroup");
                                                return state->engine->newUndefined();
                                            }
#if TN_ANDROID_JS_PROFILE
                                            const auto profileStart = beginProfiledBinding();
#endif
                                            uint32_t groupIndex = (uint32_t)state->engine->toNumber(args[0]);
                                            WGPUBindGroup bindGroup = (WGPUBindGroup)state->engine->getPrivateData(args[1]);
                                            if (capturedRenderPassForCommands && bindGroup) {
                                                // TODO: Support dynamic offsets
                                                wgpuRenderPassEncoderSetBindGroup(capturedRenderPassForCommands, groupIndex, bindGroup, 0, nullptr);
                                                if (state->verboseLogging) std::cout << "[WebGPU] Set bind group at index " << groupIndex << std::endl;
                                            }
#if TN_ANDROID_JS_PROFILE
                                            endProfiledBinding(state, ProfiledRenderCommand::SetBindGroup, profileStart);
#endif
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler39(BindingsState* state, WGPURenderPassEncoder capturedRenderPassForCommands, const std::vector<js::JSValueHandle>& args) {
                                            if (args.empty()) return state->engine->newUndefined();
#if TN_ANDROID_JS_PROFILE
                                            const auto profileStart = beginProfiledBinding();
#endif
                                            WGPURenderPipeline pipeline = (WGPURenderPipeline)state->engine->getPrivateData(args[0]);
                                            if (capturedRenderPassForCommands && pipeline) {
                                                wgpuRenderPassEncoderSetPipeline(capturedRenderPassForCommands, pipeline);
                                                if (state->verboseLogging) std::cout << "[WebGPU] Pipeline set" << std::endl;
                                            }
#if TN_ANDROID_JS_PROFILE
                                            endProfiledBinding(state, ProfiledRenderCommand::SetPipeline, profileStart);
#endif
                                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler38(BindingsState* state, WGPUCommandEncoder capturedEncoder, const std::vector<js::JSValueHandle>& args) {
                                    if (args.empty()) {
                                        state->engine->throwException("beginRenderPass requires a descriptor");
                                        return state->engine->newUndefined();
                                    }
                                    // Use the captured encoder for this specific command encoder
                                    WGPUCommandEncoder encoderToUse = capturedEncoder;
                                    if (!encoderToUse) {
                                        state->engine->throwException("Command encoder not available");
                                        return state->engine->newUndefined();
                                    }
                                    auto descriptor = args[0];
                                    const WGPUCommandEncoder previousSurfaceRenderEncoder = state->surfaceRenderEncoder;
                                    const bool previousSurfaceRenderPassEnded = state->surfaceRenderPassEnded;
                                    const WGPURenderPassEncoder previousJsRenderPass =
                                        state->jsRenderPass;
                                    const auto previousRenderPassIt =
                                        state->encoderRenderPassMap.find(encoderToUse);
                                    const bool hadPreviousRenderPass =
                                        previousRenderPassIt != state->encoderRenderPassMap.end();
                                    const WGPURenderPassEncoder previousRenderPassForEncoder =
                                        hadPreviousRenderPass ? previousRenderPassIt->second : nullptr;
                                    auto colorAttachments = state->engine->getProperty(descriptor, "colorAttachments");
                                    // Parse all color attachments (deferred renderer uses multiple)
                                    auto attachmentsLengthProp = state->engine->getProperty(colorAttachments, "length");
                                    int numAttachments = state->engine->isUndefined(attachmentsLengthProp) ? 0 : (int)state->engine->toNumber(attachmentsLengthProp);
                                    std::vector<WGPURenderPassColorAttachment> colorAttachmentList;
                                    colorAttachmentList.reserve(numAttachments);
                                    double firstR = 0, firstG = 0, firstB = 0, firstA = 1;
                                    for (int i = 0; i < numAttachments; i++) {
                                        auto attachment = state->engine->getPropertyIndex(colorAttachments, i);
                                        auto viewHandle = state->engine->getProperty(attachment, "view");
                                        WGPUTextureView view = (WGPUTextureView)state->engine->getPrivateData(viewHandle);
                                        // Debug: Log first color attachment for comparison with state->currentTextureView
                                        if (i == 0) {
                                            if (state->verboseLogging) {
                                                std::cout << "[WebGPU] Render pass attachment[0]: view=" << (void*)view
                                                          << ", state->currentTextureView=" << (void*)state->currentTextureView
                                                          << ", matches=" << (view == state->currentTextureView ? "YES" : "NO") << std::endl;
                                            }
                                            // Track if this render pass uses the surface texture
                                            if (view == state->currentTextureView && state->currentTextureView != nullptr) {
                                                state->surfaceRenderEncoder = encoderToUse;
                                                state->surfaceRenderPassEnded = false;
                                            }
                                        }
                                        // Debug: Log GBuffer pass attachments
                                        if (numAttachments >= 5 && i == 0) {
                                            if (state->verboseLogging) std::cout << "[WebGPU] GBuffer pass - 5 attachments, view[0]=" << (void*)view << std::endl;
                                        }
                                        if (!view && numAttachments >= 5) {
                                            std::cerr << "[WebGPU] ERROR: GBuffer attachment " << i << " has null view!" << std::endl;
                                        }
                                        // Parse loadOp (default 'clear')
                                        WGPULoadOp loadOp = WGPULoadOp_Clear;
                                        auto loadOpProp = state->engine->getProperty(attachment, "loadOp");
                                        if (!state->engine->isUndefined(loadOpProp)) {
                                            std::string loadOpStr = state->engine->toString(loadOpProp);
                                            if (loadOpStr == "load") loadOp = WGPULoadOp_Load;
                                        }
                                        // Parse storeOp (default 'store')
                                        WGPUStoreOp storeOp = WGPUStoreOp_Store;
                                        auto storeOpProp = state->engine->getProperty(attachment, "storeOp");
                                        if (!state->engine->isUndefined(storeOpProp)) {
                                            std::string storeOpStr = state->engine->toString(storeOpProp);
                                            if (storeOpStr == "discard") storeOp = WGPUStoreOp_Discard;
                                        }
                                        // Parse clearValue only if loadOp is 'clear'
                                        double r = 0, g = 0, b = 0, a = 1;
                                        if (loadOp == WGPULoadOp_Clear) {
                                            auto clearValue = state->engine->getProperty(attachment, "clearValue");
                                            if (!state->engine->isUndefined(clearValue)) {
                                                // Check if it's an array [r, g, b, a] or object {r, g, b, a}
                                                if (state->engine->isArray(clearValue)) {
                                                    r = state->engine->toNumber(state->engine->getPropertyIndex(clearValue, 0));
                                                    g = state->engine->toNumber(state->engine->getPropertyIndex(clearValue, 1));
                                                    b = state->engine->toNumber(state->engine->getPropertyIndex(clearValue, 2));
                                                    a = state->engine->toNumber(state->engine->getPropertyIndex(clearValue, 3));
                                                } else {
                                                    r = state->engine->toNumber(state->engine->getProperty(clearValue, "r"));
                                                    g = state->engine->toNumber(state->engine->getProperty(clearValue, "g"));
                                                    b = state->engine->toNumber(state->engine->getProperty(clearValue, "b"));
                                                    a = state->engine->toNumber(state->engine->getProperty(clearValue, "a"));
                                                }
                                            }
                                        }
                                        if (i == 0) {
                                            firstR = r; firstG = g; firstB = b; firstA = a;
                                        }
                                        WGPURenderPassColorAttachment colorAttachment = {};
                                        colorAttachment.view = view;
                                        colorAttachment.loadOp = loadOp;
                                        colorAttachment.storeOp = storeOp;
                                        colorAttachment.clearValue = {r, g, b, a};
                                        colorAttachment.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
                                        colorAttachmentList.push_back(colorAttachment);
                                    }
                                    WGPURenderPassDescriptor renderPassDesc = {};
                                    renderPassDesc.colorAttachmentCount = colorAttachmentList.size();
                                    renderPassDesc.colorAttachments = colorAttachmentList.data();
                                    // Parse depth stencil attachment if present
                                    WGPURenderPassDepthStencilAttachment depthStencilAttachment = {};
                                    auto depthStencilProp = state->engine->getProperty(descriptor, "depthStencilAttachment");
                                    if (!state->engine->isUndefined(depthStencilProp)) {
                                        auto depthViewHandle = state->engine->getProperty(depthStencilProp, "view");
                                        WGPUTextureView depthView = (WGPUTextureView)state->engine->getPrivateData(depthViewHandle);
                                        depthStencilAttachment.view = depthView;
                                        // Depth clear value (default 1.0)
                                        auto depthClearValueProp = state->engine->getProperty(depthStencilProp, "depthClearValue");
                                        depthStencilAttachment.depthClearValue = state->engine->isUndefined(depthClearValueProp)
                                            ? 1.0f : (float)state->engine->toNumber(depthClearValueProp);
                                        // Depth load/store ops (default clear/store)
                                        auto depthLoadOpProp = state->engine->getProperty(depthStencilProp, "depthLoadOp");
                                        if (!state->engine->isUndefined(depthLoadOpProp)) {
                                            std::string loadOpStr = state->engine->toString(depthLoadOpProp);
                                            if (loadOpStr == "load") depthStencilAttachment.depthLoadOp = WGPULoadOp_Load;
                                            else depthStencilAttachment.depthLoadOp = WGPULoadOp_Clear;
                                        } else {
                                            depthStencilAttachment.depthLoadOp = WGPULoadOp_Clear;
                                        }
                                        auto depthStoreOpProp = state->engine->getProperty(depthStencilProp, "depthStoreOp");
                                        if (!state->engine->isUndefined(depthStoreOpProp)) {
                                            std::string storeOpStr = state->engine->toString(depthStoreOpProp);
                                            if (storeOpStr == "discard") depthStencilAttachment.depthStoreOp = WGPUStoreOp_Discard;
                                            else depthStencilAttachment.depthStoreOp = WGPUStoreOp_Store;
                                        } else {
                                            depthStencilAttachment.depthStoreOp = WGPUStoreOp_Store;
                                        }
                                        // Stencil ops (default undefined/disabled)
                                        depthStencilAttachment.stencilClearValue = 0;
                                        depthStencilAttachment.stencilLoadOp = WGPULoadOp_Undefined;
                                        depthStencilAttachment.stencilStoreOp = WGPUStoreOp_Undefined;
                                        renderPassDesc.depthStencilAttachment = &depthStencilAttachment;
                                        if (state->verboseLogging) std::cout << "[WebGPU] Render pass with depth attachment, clear=" << depthStencilAttachment.depthClearValue << std::endl;
                                    }
                                    // Begin render pass on the captured encoder (not the global)
                                    WGPURenderPassEncoder renderPass = wgpuCommandEncoderBeginRenderPass(encoderToUse, &renderPassDesc);
                                    if (!requireHandle(state->engine, renderPass, "commandEncoder.beginRenderPass",
                                                       "colorAttachments=" + std::to_string(numAttachments))) {
                                        state->surfaceRenderEncoder = previousSurfaceRenderEncoder;
                                        state->surfaceRenderPassEnded = previousSurfaceRenderPassEnded;
                                        return state->engine->newUndefined();
                                    }
                                    // Store in per-encoder map (fixes issue with multiple encoders)
                                    state->encoderRenderPassMap[encoderToUse] = renderPass;
                                    // Also set global for backwards compatibility with render pass methods
                                    state->jsRenderPass = renderPass;
                                    if (state->verboseLogging) std::cout << "[WebGPU] Render pass started (" << numAttachments << " attachments), clear: (" << firstR << "," << firstG << "," << firstB << "," << firstA << ")" << std::endl;
                                    // Suspend frame tracking while creating render pass wrapper
                                    state->engine->suspendFrameTracking();
                                    auto jsRenderPass = state->engine->newObject();
                                    state->engine->setPrivateData(jsRenderPass, renderPass);
                                    WGPURenderPassEncoder capturedRenderPassForCommands = renderPass;
                                    const auto rollbackRenderPass = [&]() {
                                        auto it = state->encoderRenderPassMap.find(encoderToUse);
                                        if (it != state->encoderRenderPassMap.end() && it->second == renderPass) {
                                            if (hadPreviousRenderPass) {
                                                it->second = previousRenderPassForEncoder;
                                            } else {
                                                state->encoderRenderPassMap.erase(it);
                                            }
                                        } else if (hadPreviousRenderPass) {
                                            state->encoderRenderPassMap[encoderToUse] =
                                                previousRenderPassForEncoder;
                                        }
                                        state->jsRenderPass = previousJsRenderPass;
                                        if (renderPass) {
                                            wgpuRenderPassEncoderEnd(renderPass);
                                            wgpuRenderPassEncoderRelease(renderPass);
                                            renderPass = nullptr;
                                        }
                                        state->surfaceRenderEncoder = previousSurfaceRenderEncoder;
                                        state->surfaceRenderPassEnded = previousSurfaceRenderPassEnded;
                                    };
                                    // renderPass.setPipeline(pipeline)
                                    if (!installBindingTable(state->engine, state, bindingTable({
                                        {"GPURenderPassEncoder", "setPipeline", 0, nullptr,
                                        makeCapturedHandler(renderPass, &tnWebgpuHandler39)
                                    , jsRenderPass},
                                    // renderPass.setBindGroup(index, bindGroup, dynamicOffsets?)
                                        {"GPURenderPassEncoder", "setBindGroup", 0, nullptr,
                                        makeCapturedHandler(renderPass, &tnWebgpuHandler40)
                                    , jsRenderPass},
                                    // renderPass.draw(vertexCount, instanceCount?, firstVertex?, firstInstance?)
                                        {"GPURenderPassEncoder", "draw", 0, nullptr,
                                        makeCapturedHandler(renderPass, &tnWebgpuHandler41)
                                    , jsRenderPass},
                                    // renderPass.setVertexBuffer(slot, buffer, offset?, size?)
                                        {"GPURenderPassEncoder", "setVertexBuffer", 0, nullptr,
                                        makeCapturedHandler(renderPass, &tnWebgpuHandler42)
                                    , jsRenderPass},
                                    // renderPass.setIndexBuffer(buffer, format, offset?, size?)
                                        {"GPURenderPassEncoder", "setIndexBuffer", 0, nullptr,
                                        makeCapturedHandler(renderPass, &tnWebgpuHandler43)
                                    , jsRenderPass},
                                    // renderPass.drawIndexed(indexCount, instanceCount?, firstIndex?, baseVertex?, firstInstance?)
                                        {"GPURenderPassEncoder", "drawIndexed", 0, nullptr,
                                        makeCapturedHandler(renderPass, &tnWebgpuHandler44)
                                    , jsRenderPass},
                                    // renderPass.drawIndirect(indirectBuffer, indirectOffset)
                                        {"GPURenderPassEncoder", "drawIndirect", 0, nullptr,
                                        makeCapturedHandler(renderPass, &tnWebgpuHandler45)
                                    , jsRenderPass},
                                    // renderPass.drawIndexedIndirect(indirectBuffer, indirectOffset)
                                        {"GPURenderPassEncoder", "drawIndexedIndirect", 0, nullptr,
                                        makeCapturedHandler(renderPass, &tnWebgpuHandler46)
                                    , jsRenderPass},
                                    // renderPass.setViewport(x, y, width, height, minDepth, maxDepth)
                                        {"GPURenderPassEncoder", "setViewport", 0, nullptr,
                                        makeCapturedHandler(renderPass, &tnWebgpuHandler47)
                                    , jsRenderPass},
                                    // renderPass.setScissorRect(x, y, width, height)
                                        {"GPURenderPassEncoder", "setScissorRect", 0, nullptr,
                                        makeCapturedHandler(renderPass, &tnWebgpuHandler48)
                                    , jsRenderPass},
                                    // renderPass.setBlendConstant(color)
                                        {"GPURenderPassEncoder", "setBlendConstant", 0, nullptr,
                                        makeCapturedHandler(renderPass, &tnWebgpuHandler49)
                                    , jsRenderPass},
                                    // renderPass.setStencilReference(reference)
                                        {"GPURenderPassEncoder", "setStencilReference", 0, nullptr,
                                        makeCapturedHandler(renderPass, &tnWebgpuHandler50)
                                    , jsRenderPass}}))) {
                                        rollbackRenderPass();
                                        state->engine->resumeFrameTracking();
                                        return state->engine->newUndefined();
                                    }
                                    // renderPass.executeBundles(bundles)
                                    // Used by Three.js for mipmap generation
                                    WGPURenderPassEncoder capturedRenderPassForBundles = renderPass;
                                    if (!installBindingTable(state->engine, state, bindingTable({
                                        {"GPURenderPassEncoder", "executeBundles", 0, nullptr,
                                        makeCapturedHandler(renderPass, &tnWebgpuHandler51)
                                    , jsRenderPass}}))) {
                                        rollbackRenderPass();
                                        state->engine->resumeFrameTracking();
                                        return state->engine->newUndefined();
                                    }
                                    // renderPass.end() - capture encoder and render pass for cleanup
                                    if (!installBindingTable(state->engine, state, bindingTable({
                                        {"GPURenderPassEncoder", "end", 0, nullptr,
                                        makeCapturedPairHandler(encoderToUse, renderPass, &tnWebgpuHandler52)
                                    , jsRenderPass}}))) {
                                        rollbackRenderPass();
                                        state->engine->resumeFrameTracking();
                                        return state->engine->newUndefined();
                                    }
                                    // Resume frame tracking
                                    state->engine->resumeFrameTracking();
                                    return jsRenderPass;
}

static void rollbackCommandEncoder(
    BindingsState* state,
    WGPUCommandEncoder encoder,
    WGPUCommandEncoder previousJsCommandEncoder) {
    if (!state || !encoder) return;
    auto renderIt = state->encoderRenderPassMap.find(encoder);
    if (renderIt != state->encoderRenderPassMap.end()) {
        if (renderIt->second) {
            wgpuRenderPassEncoderEnd(renderIt->second);
            wgpuRenderPassEncoderRelease(renderIt->second);
        }
        if (state->jsRenderPass == renderIt->second) state->jsRenderPass = nullptr;
        state->encoderRenderPassMap.erase(renderIt);
    }
    auto computeIt = state->encoderComputePassMap.find(encoder);
    if (computeIt != state->encoderComputePassMap.end()) {
        if (computeIt->second) {
            wgpuComputePassEncoderEnd(computeIt->second);
            wgpuComputePassEncoderRelease(computeIt->second);
        }
        if (state->jsComputePass == computeIt->second) state->jsComputePass = nullptr;
        state->encoderComputePassMap.erase(computeIt);
    }
    if (state->surfaceRenderEncoder == encoder) {
        state->surfaceRenderEncoder = nullptr;
        state->surfaceRenderPassEnded = true;
    }
    state->commandEncoderRegistry.erase(encoder);
    state->jsCommandEncoder = previousJsCommandEncoder;
    wgpuCommandEncoderRelease(encoder);
}

static js::JSValueHandle tnWebgpuHandler37(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            WGPUCommandEncoderDescriptor desc = {};
                            WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(state->device, &desc);
                            if (!requireHandle(state->engine, encoder, "device.createCommandEncoder"))
                                return state->engine->newUndefined();
                            // Store in global for use by beginRenderPass
                            // Note: Multiple encoders are supported via per-encoder render pass tracking
                            const WGPUCommandEncoder previousJsCommandEncoder =
                                state->jsCommandEncoder;
                            state->jsCommandEncoder = encoder;
                            state->commandEncoderRegistry.insert(encoder);
                            // Suspend frame tracking while creating encoder wrapper
                            // This prevents the wrapper's methods from being garbage collected at frame end
                            state->engine->suspendFrameTracking();
                            auto jsEncoder = state->engine->newObject();
                            state->engine->setPrivateData(jsEncoder, encoder);
                            // Capture encoder pointer for use in closures
                            WGPUCommandEncoder capturedEncoder = encoder;
                            // encoder.beginRenderPass(descriptor)
                            if (!installBindingTable(state->engine, state, bindingTable({
                                {"GPUCommandEncoder", "beginRenderPass", 0, nullptr,
                                makeCapturedHandler(capturedEncoder, &tnWebgpuHandler38)
                            , jsEncoder}}))) {
                                rollbackCommandEncoder(state, encoder, previousJsCommandEncoder);
                                state->engine->resumeFrameTracking();
                                return state->engine->newUndefined();
                            }
                            // encoder.beginComputePass(descriptor?)
                            if (!installBindingTable(state->engine, state, bindingTable({
                                {"GPUCommandEncoder", "beginComputePass", 0, nullptr,
                                &tnWebgpuHandler53
                            , jsEncoder}}))) {
                                rollbackCommandEncoder(state, encoder, previousJsCommandEncoder);
                                state->engine->resumeFrameTracking();
                                return state->engine->newUndefined();
                            }
                            // encoder.copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size)
                            if (!installBindingTable(state->engine, state, bindingTable({
                                {"GPUCommandEncoder", "copyBufferToBuffer", 0, nullptr,
                                &tnWebgpuHandler58
                            , jsEncoder},
                            // encoder.copyBufferToTexture(source, destination, copySize)
                                                            {"GPUCommandEncoder", "copyBufferToTexture", 0, nullptr,
                                &tnWebgpuHandler59
                            , jsEncoder},
                            // encoder.copyTextureToBuffer(source, destination, copySize)
                                                            {"GPUCommandEncoder", "copyTextureToBuffer", 0, nullptr,
                                &tnWebgpuHandler60
                            , jsEncoder},
                            // encoder.copyTextureToTexture(source, destination, copySize)
                                                            {"GPUCommandEncoder", "copyTextureToTexture", 0, nullptr,
                                &tnWebgpuHandler61
                            , jsEncoder},
                            // encoder.clearBuffer(buffer, offset?, size?)
                                                            {"GPUCommandEncoder", "clearBuffer", 0, nullptr,
                                &tnWebgpuHandler62
                            , jsEncoder},
                            // encoder.finish(descriptor?)
                                {"GPUCommandEncoder", "finish", 0, nullptr,
                                makeCapturedHandler(capturedEncoder, &tnWebgpuHandler63)
                            , jsEncoder}}))) {
                                rollbackCommandEncoder(state, encoder, previousJsCommandEncoder);
                                state->engine->resumeFrameTracking();
                                return state->engine->newUndefined();
                            }
                            // Resume frame tracking now that encoder wrapper is created
                            state->engine->resumeFrameTracking();
                            return jsEncoder;
}

static js::JSValueHandle tnWebgpuHandler36(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            mystral::StallScope stall(mystral::StallSegment::PipelineCompile);
                            if (args.empty()) {
                                state->engine->throwException("createComputePipeline requires a descriptor");
                                return state->engine->newUndefined();
                            }
                            auto descriptor = args[0];
                            // Get layout
                            auto layoutProp = state->engine->getProperty(descriptor, "layout");
                            WGPUPipelineLayout layout = nullptr;
                            bool isAutoLayout = false;
                            if (!state->engine->isUndefined(layoutProp) && !state->engine->isString(layoutProp)) {
                                layout = (WGPUPipelineLayout)state->engine->getPrivateData(layoutProp);
                            } else if (state->engine->isString(layoutProp)) {
                                std::string layoutStr = state->engine->toString(layoutProp);
                                if (layoutStr == "auto") {
                                    isAutoLayout = true;
                                    if (state->verboseLogging) std::cout << "[WebGPU] Using 'auto' layout for compute pipeline" << std::endl;
                                    std::cout.flush();
                                }
                            }
                            // Get compute stage
                            auto computeProp = state->engine->getProperty(descriptor, "compute");
                            auto moduleProp = state->engine->getProperty(computeProp, "module");
                            WGPUShaderModule module = (WGPUShaderModule)state->engine->getPrivateData(moduleProp);
                            // Entry point (default "main")
                            std::string entryPoint = "main";
                            auto entryPointProp = state->engine->getProperty(computeProp, "entryPoint");
                            if (!state->engine->isUndefined(entryPointProp)) {
                                entryPoint = state->engine->toString(entryPointProp);
                            }
                            // Create pipeline
                            WGPUComputePipelineDescriptor pipelineDesc = {};
                            pipelineDesc.layout = layout;
                            pipelineDesc.compute.module = module;
                            WGPU_SET_ENTRY_POINT(pipelineDesc.compute, entryPoint.c_str());
                            WGPUComputePipeline pipeline = wgpuDeviceCreateComputePipeline(state->device, &pipelineDesc);
                            if (!pipeline) {
                                state->engine->throwException("Failed to create compute pipeline");
                                return state->engine->newUndefined();
                            }
                            // Register pipeline for getBindGroupLayout
                            uint64_t pipelineId = state->nextComputePipelineId++;
                            state->computePipelineRegistry[pipelineId] = pipeline;
                            auto jsPipeline = createPipelineWrapper(state, pipeline, pipelineId, false);
                            if (state->verboseLogging) std::cout << "[WebGPU] Compute pipeline created (id=" << pipelineId << ")" << std::endl;
                            return jsPipeline;
}

static js::JSValueHandle tnWebgpuHandler35(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            mystral::StallScope stall(mystral::StallSegment::PipelineCompile);
                            if (args.empty()) {
                                state->engine->throwException("createRenderPipeline requires a descriptor");
                                return state->engine->newUndefined();
                            }
                            const size_t blendStatesBefore = state->blendStates.size();
                            const auto rollbackBlendStates = [&]() {
                                state->blendStates.resize(blendStatesBefore);
                            };
                            auto descriptor = args[0];
                            // Get vertex stage
                            auto vertex = state->engine->getProperty(descriptor, "vertex");
                            auto vertexModule = state->engine->getProperty(vertex, "module");
                            auto vertexEntryProp = state->engine->getProperty(vertex, "entryPoint");
                            const bool hasVertexEntry = !state->engine->isUndefined(vertexEntryProp);
                            std::string vertexEntry = hasVertexEntry
                                ? state->engine->toString(vertexEntryProp)
                                : state->engine->toString(
                                    state->engine->getProperty(vertexModule, "_tnVertexEntryPoint"));
                            if (vertexEntry.empty()) {
                                state->engine->throwException(
                                    "createRenderPipeline: omitted vertex entryPoint requires exactly one @vertex function");
                                return state->engine->newUndefined();
                            }
                            // Get fragment stage (optional - depth-only pipelines don't have fragment)
                            auto fragment = state->engine->getProperty(descriptor, "fragment");
                            WGPUShaderModule fsModule = nullptr;
                            std::string fragmentEntry;
                            bool hasFragment = !state->engine->isUndefined(fragment) && !state->engine->isNull(fragment);
                            if (hasFragment) {
                                auto fragmentModule = state->engine->getProperty(fragment, "module");
                                fsModule = (WGPUShaderModule)state->engine->getPrivateData(fragmentModule);
                                auto fragEntryProp = state->engine->getProperty(fragment, "entryPoint");
                                if (!state->engine->isUndefined(fragEntryProp)) {
                                    fragmentEntry = state->engine->toString(fragEntryProp);
                                } else {
                                    fragmentEntry = state->engine->toString(state->engine->getProperty(
                                        fragmentModule, "_tnFragmentEntryPoint"));
                                    if (fragmentEntry.empty()) {
                                        state->engine->throwException(
                                            "createRenderPipeline: omitted fragment entryPoint requires exactly one @fragment function");
                                        return state->engine->newUndefined();
                                    }
                                }
                            }
                            // Get native shader modules
                            WGPUShaderModule vsModule = (WGPUShaderModule)state->engine->getPrivateData(vertexModule);
                            // Create pipeline descriptor
                            WGPURenderPipelineDescriptor pipelineDesc = {};
                            // Check for layout property
                            auto layoutProp = state->engine->getProperty(descriptor, "layout");
                            if (!state->engine->isUndefined(layoutProp)) {
                                // Check if it's "auto" string or a PipelineLayout object
                                if (state->engine->isString(layoutProp)) {
                                    std::string layoutStr = state->engine->toString(layoutProp);
                                    if (layoutStr == "auto") {
                                        pipelineDesc.layout = nullptr;  // Auto layout
                                    }
                                } else {
                                    // It's a PipelineLayout object
                                    WGPUPipelineLayout layout = (WGPUPipelineLayout)state->engine->getPrivateData(layoutProp);
                                    pipelineDesc.layout = layout;
                                }
                            }
                            // Vertex state
                            pipelineDesc.vertex.module = vsModule;
                            WGPU_SET_ENTRY_POINT(pipelineDesc.vertex, vertexEntry.c_str());
                            // Parse vertex buffers if present
                            std::vector<WGPUVertexBufferLayout> vertexBuffers;
                            std::vector<std::vector<WGPUVertexAttribute>> allAttributes; // Keep attributes alive
                            auto buffersArray = state->engine->getProperty(vertex, "buffers");
                            if (!state->engine->isUndefined(buffersArray)) {
                                auto buffersLen = state->engine->getProperty(buffersArray, "length");
                                int bufferCount = (int)state->engine->toNumber(buffersLen);
                                for (int i = 0; i < bufferCount; i++) {
                                    auto buffer = state->engine->getPropertyIndex(buffersArray, i);
                                    WGPUVertexBufferLayout layout = {};
                                    layout.arrayStride = (uint64_t)state->engine->toNumber(state->engine->getProperty(buffer, "arrayStride"));
                                    layout.stepMode = WGPUVertexStepMode_Vertex;
                                    // Parse step mode if present
                                    auto stepModeProp = state->engine->getProperty(buffer, "stepMode");
                                    if (!state->engine->isUndefined(stepModeProp)) {
                                        std::string stepModeStr = state->engine->toString(stepModeProp);
                                        if (stepModeStr == "instance") {
                                            layout.stepMode = WGPUVertexStepMode_Instance;
                                        }
                                    }
                                    // Parse attributes
                                    auto attrsArray = state->engine->getProperty(buffer, "attributes");
                                    if (!state->engine->isUndefined(attrsArray)) {
                                        auto attrsLen = state->engine->getProperty(attrsArray, "length");
                                        int attrCount = (int)state->engine->toNumber(attrsLen);
                                        std::vector<WGPUVertexAttribute> attributes;
                                        for (int j = 0; j < attrCount; j++) {
                                            auto attr = state->engine->getPropertyIndex(attrsArray, j);
                                            WGPUVertexAttribute va = {};
                                            va.shaderLocation = (uint32_t)state->engine->toNumber(state->engine->getProperty(attr, "shaderLocation"));
                                            va.offset = (uint64_t)state->engine->toNumber(state->engine->getProperty(attr, "offset"));
                                            std::string formatStr = state->engine->toString(state->engine->getProperty(attr, "format"));
                                            // Parse vertex format
                                            if (formatStr == "float32") va.format = WGPUVertexFormat_Float32;
                                            else if (formatStr == "float32x2") va.format = WGPUVertexFormat_Float32x2;
                                            else if (formatStr == "float32x3") va.format = WGPUVertexFormat_Float32x3;
                                            else if (formatStr == "float32x4") va.format = WGPUVertexFormat_Float32x4;
                                            else if (formatStr == "uint8x2") va.format = WGPUVertexFormat_Uint8x2;
                                            else if (formatStr == "uint8x4") va.format = WGPUVertexFormat_Uint8x4;
                                            else if (formatStr == "sint8x2") va.format = WGPUVertexFormat_Sint8x2;
                                            else if (formatStr == "sint8x4") va.format = WGPUVertexFormat_Sint8x4;
                                            else if (formatStr == "unorm8x2") va.format = WGPUVertexFormat_Unorm8x2;
                                            else if (formatStr == "unorm8x4") va.format = WGPUVertexFormat_Unorm8x4;
                                            else if (formatStr == "snorm8x2") va.format = WGPUVertexFormat_Snorm8x2;
                                            else if (formatStr == "snorm8x4") va.format = WGPUVertexFormat_Snorm8x4;
                                            else if (formatStr == "uint16x2") va.format = WGPUVertexFormat_Uint16x2;
                                            else if (formatStr == "uint16x4") va.format = WGPUVertexFormat_Uint16x4;
                                            else if (formatStr == "sint16x2") va.format = WGPUVertexFormat_Sint16x2;
                                            else if (formatStr == "sint16x4") va.format = WGPUVertexFormat_Sint16x4;
                                            else if (formatStr == "unorm16x2") va.format = WGPUVertexFormat_Unorm16x2;
                                            else if (formatStr == "unorm16x4") va.format = WGPUVertexFormat_Unorm16x4;
                                            else if (formatStr == "snorm16x2") va.format = WGPUVertexFormat_Snorm16x2;
                                            else if (formatStr == "snorm16x4") va.format = WGPUVertexFormat_Snorm16x4;
                                            else if (formatStr == "float16x2") va.format = WGPUVertexFormat_Float16x2;
                                            else if (formatStr == "float16x4") va.format = WGPUVertexFormat_Float16x4;
                                            else if (formatStr == "uint32") va.format = WGPUVertexFormat_Uint32;
                                            else if (formatStr == "uint32x2") va.format = WGPUVertexFormat_Uint32x2;
                                            else if (formatStr == "uint32x3") va.format = WGPUVertexFormat_Uint32x3;
                                            else if (formatStr == "uint32x4") va.format = WGPUVertexFormat_Uint32x4;
                                            else if (formatStr == "sint32") va.format = WGPUVertexFormat_Sint32;
                                            else if (formatStr == "sint32x2") va.format = WGPUVertexFormat_Sint32x2;
                                            else if (formatStr == "sint32x3") va.format = WGPUVertexFormat_Sint32x3;
                                            else if (formatStr == "sint32x4") va.format = WGPUVertexFormat_Sint32x4;
                                            else va.format = WGPUVertexFormat_Float32x3; // Default
                                            attributes.push_back(va);
                                        }
                                        allAttributes.push_back(attributes);
                                        layout.attributeCount = attributes.size();
                                        layout.attributes = allAttributes.back().data();
                                    }
                                    vertexBuffers.push_back(layout);
                                }
                                pipelineDesc.vertex.bufferCount = vertexBuffers.size();
                                pipelineDesc.vertex.buffers = vertexBuffers.data();
                            }
                            // Fragment state (only if fragment shader exists)
                            WGPUColorTargetState colorTarget = {};
                            WGPUFragmentState fragmentState = {};
                            std::vector<WGPUColorTargetState> colorTargets;
                            bool targetsExplicitlySpecified = false;
                            if (hasFragment && fsModule) {
                                // Parse targets from fragment descriptor
                                auto targetsProp = state->engine->getProperty(fragment, "targets");
                                if (!state->engine->isUndefined(targetsProp)) {
                                    targetsExplicitlySpecified = true;  // Even if empty array
                                    auto targetsLen = state->engine->getProperty(targetsProp, "length");
                                    int targetCount = (int)state->engine->toNumber(targetsLen);
                                    for (int i = 0; i < targetCount; i++) {
                                        auto target = state->engine->getPropertyIndex(targetsProp, i);
                                        WGPUColorTargetState targetState = {};
                                        auto formatProp = state->engine->getProperty(target, "format");
                                        if (!state->engine->isUndefined(formatProp)) {
                                            std::string formatStr = state->engine->toString(formatProp);
                                            targetState.format = stringToFormat(formatStr);
                                            if (targetCount >= 5) {
                                                if (state->verboseLogging) std::cout << "[WebGPU] Pipeline target " << i << ": format=" << formatStr << " (enum=" << targetState.format << ")" << std::endl;
                                            }
                                        } else {
                                            targetState.format = state->surfaceFormat;
                                        }
                                        targetState.writeMask = WGPUColorWriteMask_All;
                                        // Parse blend state if provided
                                        auto blendProp = state->engine->getProperty(target, "blend");
                                        if (!state->engine->isUndefined(blendProp)) {
                                            // Store blend state in a persistent container
                                            auto blendState = std::make_unique<WGPUBlendState>();
                                            // Helper lambda to parse blend factor
                                            auto parseBlendFactor = [](const std::string& str) -> WGPUBlendFactor {
                                                if (str == "zero") return WGPUBlendFactor_Zero;
                                                if (str == "one") return WGPUBlendFactor_One;
                                                if (str == "src") return WGPUBlendFactor_Src;
                                                if (str == "one-minus-src") return WGPUBlendFactor_OneMinusSrc;
                                                if (str == "src-alpha") return WGPUBlendFactor_SrcAlpha;
                                                if (str == "one-minus-src-alpha") return WGPUBlendFactor_OneMinusSrcAlpha;
                                                if (str == "dst") return WGPUBlendFactor_Dst;
                                                if (str == "one-minus-dst") return WGPUBlendFactor_OneMinusDst;
                                                if (str == "dst-alpha") return WGPUBlendFactor_DstAlpha;
                                                if (str == "one-minus-dst-alpha") return WGPUBlendFactor_OneMinusDstAlpha;
                                                if (str == "src-alpha-saturated") return WGPUBlendFactor_SrcAlphaSaturated;
                                                if (str == "constant") return WGPUBlendFactor_Constant;
                                                if (str == "one-minus-constant") return WGPUBlendFactor_OneMinusConstant;
                                                return WGPUBlendFactor_One;  // Default
                                            };
                                            // Helper lambda to parse blend operation
                                            auto parseBlendOp = [](const std::string& str) -> WGPUBlendOperation {
                                                if (str == "add") return WGPUBlendOperation_Add;
                                                if (str == "subtract") return WGPUBlendOperation_Subtract;
                                                if (str == "reverse-subtract") return WGPUBlendOperation_ReverseSubtract;
                                                if (str == "min") return WGPUBlendOperation_Min;
                                                if (str == "max") return WGPUBlendOperation_Max;
                                                return WGPUBlendOperation_Add;  // Default
                                            };
                                            // Parse color blend component
                                            auto colorProp = state->engine->getProperty(blendProp, "color");
                                            if (!state->engine->isUndefined(colorProp)) {
                                                auto srcFactor = state->engine->getProperty(colorProp, "srcFactor");
                                                auto dstFactor = state->engine->getProperty(colorProp, "dstFactor");
                                                auto operation = state->engine->getProperty(colorProp, "operation");
                                                if (!state->engine->isUndefined(srcFactor))
                                                    blendState->color.srcFactor = parseBlendFactor(state->engine->toString(srcFactor));
                                                else
                                                    blendState->color.srcFactor = WGPUBlendFactor_One;
                                                if (!state->engine->isUndefined(dstFactor))
                                                    blendState->color.dstFactor = parseBlendFactor(state->engine->toString(dstFactor));
                                                else
                                                    blendState->color.dstFactor = WGPUBlendFactor_Zero;
                                                if (!state->engine->isUndefined(operation))
                                                    blendState->color.operation = parseBlendOp(state->engine->toString(operation));
                                                else
                                                    blendState->color.operation = WGPUBlendOperation_Add;
                                            } else {
                                                // Default color blend (no blending)
                                                blendState->color.srcFactor = WGPUBlendFactor_One;
                                                blendState->color.dstFactor = WGPUBlendFactor_Zero;
                                                blendState->color.operation = WGPUBlendOperation_Add;
                                            }
                                            // Parse alpha blend component
                                            auto alphaProp = state->engine->getProperty(blendProp, "alpha");
                                            if (!state->engine->isUndefined(alphaProp)) {
                                                auto srcFactor = state->engine->getProperty(alphaProp, "srcFactor");
                                                auto dstFactor = state->engine->getProperty(alphaProp, "dstFactor");
                                                auto operation = state->engine->getProperty(alphaProp, "operation");
                                                if (!state->engine->isUndefined(srcFactor))
                                                    blendState->alpha.srcFactor = parseBlendFactor(state->engine->toString(srcFactor));
                                                else
                                                    blendState->alpha.srcFactor = WGPUBlendFactor_One;
                                                if (!state->engine->isUndefined(dstFactor))
                                                    blendState->alpha.dstFactor = parseBlendFactor(state->engine->toString(dstFactor));
                                                else
                                                    blendState->alpha.dstFactor = WGPUBlendFactor_Zero;
                                                if (!state->engine->isUndefined(operation))
                                                    blendState->alpha.operation = parseBlendOp(state->engine->toString(operation));
                                                else
                                                    blendState->alpha.operation = WGPUBlendOperation_Add;
                                            } else {
                                                // Default alpha blend (no blending)
                                                blendState->alpha.srcFactor = WGPUBlendFactor_One;
                                                blendState->alpha.dstFactor = WGPUBlendFactor_Zero;
                                                blendState->alpha.operation = WGPUBlendOperation_Add;
                                            }
                                            targetState.blend = blendState.get();
                                            state->blendStates.push_back(std::move(blendState));
                                            if (state->verboseLogging) std::cout << "[WebGPU] Pipeline target " << i << " has blend state" << std::endl;
                                        }
                                        colorTargets.push_back(targetState);
                                    }
                                }
                                // Only add default target if targets wasn't explicitly specified
                                // If targets: [] was specified, don't add any (depth-only pass)
                                if (colorTargets.empty() && !targetsExplicitlySpecified) {
                                    // Default single target only when targets is not specified at all
                                    colorTarget.format = state->surfaceFormat;
                                    colorTarget.writeMask = WGPUColorWriteMask_All;
                                    colorTargets.push_back(colorTarget);
                                }
                                fragmentState.module = fsModule;
                                WGPU_SET_ENTRY_POINT(fragmentState, fragmentEntry.c_str());
                                fragmentState.targetCount = colorTargets.size();
                                fragmentState.targets = colorTargets.data();
                                pipelineDesc.fragment = &fragmentState;
                                if (state->verboseLogging) std::cout << "[WebGPU] Render pipeline with " << colorTargets.size() << " color targets" << std::endl;
                            } else {
                                // Depth-only pipeline - no fragment state
                                pipelineDesc.fragment = nullptr;
                            }
                            // Primitive state
                            pipelineDesc.primitive.topology = WGPUPrimitiveTopology_TriangleList;
                            pipelineDesc.primitive.stripIndexFormat = WGPUIndexFormat_Undefined;
                            pipelineDesc.primitive.frontFace = WGPUFrontFace_CCW;
                            pipelineDesc.primitive.cullMode = WGPUCullMode_None;
                            // Parse primitive state if provided
                            auto primitiveProp = state->engine->getProperty(descriptor, "primitive");
                            if (!state->engine->isUndefined(primitiveProp)) {
                                auto topologyProp = state->engine->getProperty(primitiveProp, "topology");
                                if (!state->engine->isUndefined(topologyProp)) {
                                    std::string topologyStr = state->engine->toString(topologyProp);
                                    if (topologyStr == "point-list") pipelineDesc.primitive.topology = WGPUPrimitiveTopology_PointList;
                                    else if (topologyStr == "line-list") pipelineDesc.primitive.topology = WGPUPrimitiveTopology_LineList;
                                    else if (topologyStr == "line-strip") pipelineDesc.primitive.topology = WGPUPrimitiveTopology_LineStrip;
                                    else if (topologyStr == "triangle-list") pipelineDesc.primitive.topology = WGPUPrimitiveTopology_TriangleList;
                                    else if (topologyStr == "triangle-strip") pipelineDesc.primitive.topology = WGPUPrimitiveTopology_TriangleStrip;
                                }
                                auto cullModeProp = state->engine->getProperty(primitiveProp, "cullMode");
                                if (!state->engine->isUndefined(cullModeProp)) {
                                    std::string cullModeStr = state->engine->toString(cullModeProp);
                                    if (cullModeStr == "none") pipelineDesc.primitive.cullMode = WGPUCullMode_None;
                                    else if (cullModeStr == "front") pipelineDesc.primitive.cullMode = WGPUCullMode_Front;
                                    else if (cullModeStr == "back") pipelineDesc.primitive.cullMode = WGPUCullMode_Back;
                                }
                                auto frontFaceProp = state->engine->getProperty(primitiveProp, "frontFace");
                                if (!state->engine->isUndefined(frontFaceProp)) {
                                    std::string frontFaceStr = state->engine->toString(frontFaceProp);
                                    if (frontFaceStr == "ccw") pipelineDesc.primitive.frontFace = WGPUFrontFace_CCW;
                                    else if (frontFaceStr == "cw") pipelineDesc.primitive.frontFace = WGPUFrontFace_CW;
                                }
                            }
                            // Depth stencil state
                            WGPUDepthStencilState depthStencilState = {};
                            bool hasDepthStencil = false;
                            auto depthStencilProp = state->engine->getProperty(descriptor, "depthStencil");
                            if (!state->engine->isUndefined(depthStencilProp)) {
                                hasDepthStencil = true;
                                auto formatProp = state->engine->getProperty(depthStencilProp, "format");
                                if (!state->engine->isUndefined(formatProp)) {
                                    depthStencilState.format = stringToFormat(state->engine->toString(formatProp));
                                } else {
                                    depthStencilState.format = WGPUTextureFormat_Depth24Plus;
                                }
                                auto depthWriteEnabledProp = state->engine->getProperty(depthStencilProp, "depthWriteEnabled");
                                depthStencilState.depthWriteEnabled = state->engine->isUndefined(depthWriteEnabledProp)
                                    ? WGPU_OPTIONAL_BOOL_TRUE
                                    : (state->engine->toBoolean(depthWriteEnabledProp) ? WGPU_OPTIONAL_BOOL_TRUE : WGPU_OPTIONAL_BOOL_FALSE);
                                auto depthCompareProp = state->engine->getProperty(depthStencilProp, "depthCompare");
                                if (!state->engine->isUndefined(depthCompareProp)) {
                                    std::string compareStr = state->engine->toString(depthCompareProp);
                                    if (compareStr == "never") depthStencilState.depthCompare = WGPUCompareFunction_Never;
                                    else if (compareStr == "less") depthStencilState.depthCompare = WGPUCompareFunction_Less;
                                    else if (compareStr == "less-equal") depthStencilState.depthCompare = WGPUCompareFunction_LessEqual;
                                    else if (compareStr == "greater") depthStencilState.depthCompare = WGPUCompareFunction_Greater;
                                    else if (compareStr == "greater-equal") depthStencilState.depthCompare = WGPUCompareFunction_GreaterEqual;
                                    else if (compareStr == "equal") depthStencilState.depthCompare = WGPUCompareFunction_Equal;
                                    else if (compareStr == "not-equal") depthStencilState.depthCompare = WGPUCompareFunction_NotEqual;
                                    else if (compareStr == "always") depthStencilState.depthCompare = WGPUCompareFunction_Always;
                                } else {
                                    depthStencilState.depthCompare = WGPUCompareFunction_Less;
                                }
                                // Default stencil operations
                                depthStencilState.stencilFront.compare = WGPUCompareFunction_Always;
                                depthStencilState.stencilFront.failOp = WGPUStencilOperation_Keep;
                                depthStencilState.stencilFront.depthFailOp = WGPUStencilOperation_Keep;
                                depthStencilState.stencilFront.passOp = WGPUStencilOperation_Keep;
                                depthStencilState.stencilBack = depthStencilState.stencilFront;
                                depthStencilState.stencilReadMask = 0xFFFFFFFF;
                                depthStencilState.stencilWriteMask = 0xFFFFFFFF;
                                pipelineDesc.depthStencil = &depthStencilState;
                            }
                            // Multisample state - parse from descriptor or use defaults
                            pipelineDesc.multisample.count = 1;
                            pipelineDesc.multisample.mask = 0xFFFFFFFF;
                            pipelineDesc.multisample.alphaToCoverageEnabled = false;
                            auto multisampleProp = state->engine->getProperty(descriptor, "multisample");
                            if (!state->engine->isUndefined(multisampleProp)) {
                                auto countProp = state->engine->getProperty(multisampleProp, "count");
                                if (!state->engine->isUndefined(countProp)) {
                                    pipelineDesc.multisample.count = (uint32_t)state->engine->toNumber(countProp);
                                }
                                auto maskProp = state->engine->getProperty(multisampleProp, "mask");
                                if (!state->engine->isUndefined(maskProp)) {
                                    pipelineDesc.multisample.mask = (uint32_t)state->engine->toNumber(maskProp);
                                }
                                auto alphaToCoverageProp = state->engine->getProperty(multisampleProp, "alphaToCoverageEnabled");
                                if (!state->engine->isUndefined(alphaToCoverageProp)) {
                                    pipelineDesc.multisample.alphaToCoverageEnabled = state->engine->toBoolean(alphaToCoverageProp);
                                }
                                if (state->verboseLogging) {
                                    std::cout << "[WebGPU] Render pipeline multisample: count=" << pipelineDesc.multisample.count
                                              << ", mask=" << pipelineDesc.multisample.mask << std::endl;
                                }
                            }
                            // Create pipeline
                            WGPURenderPipeline pipeline = wgpuDeviceCreateRenderPipeline(state->device, &pipelineDesc);
                            if (!pipeline) {
                                rollbackBlendStates();
                                state->engine->throwException("Failed to create render pipeline");
                                return state->engine->newUndefined();
                            }
                            // Register pipeline for getBindGroupLayout
                            uint64_t pipelineId = state->nextRenderPipelineId++;
                            state->renderPipelineRegistry[pipelineId] = pipeline;
                            auto jsPipeline = createPipelineWrapper(state, pipeline, pipelineId, true);
                            if (state->engine->hasException()) rollbackBlendStates();
                            if (state->verboseLogging) std::cout << "[WebGPU] Render pipeline created (id=" << pipelineId << ")" << std::endl;
                            return jsPipeline;
}

static js::JSValueHandle tnWebgpuHandler34(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            mystral::StallScope stall(mystral::StallSegment::ShaderCompile);
                            if (args.empty()) {
                                state->engine->throwException("createShaderModule requires a descriptor");
                                return state->engine->newUndefined();
                            }
                            auto descriptor = args[0];
                            std::string code = state->engine->toString(state->engine->getProperty(descriptor, "code"));
                            // Debug: Print first 500 chars of shader code
                            if (state->verboseLogging && code.length() > 0) {
                                std::cout << "[Shader] Creating shader (" << code.length() << " chars):\n"
                                          << code.substr(0, std::min((size_t)500, code.length()))
                                          << (code.length() > 500 ? "\n..." : "") << std::endl;
                            }
                            WGPUShaderModuleWGSLDescriptor_Compat wgslDesc = {};
                            WGPUShaderModuleDescriptor shaderDesc = {};
                            setupShaderModuleWGSL(&shaderDesc, &wgslDesc, code.c_str());
                            WGPUShaderModule shaderModule = wgpuDeviceCreateShaderModule(state->device, &shaderDesc);
                            if (!requireHandle(state->engine, shaderModule, "device.createShaderModule",
                                               "wgslBytes=" + std::to_string(code.size())))
                                return state->engine->newUndefined();
                            auto jsShader = state->engine->newObject();
                            state->engine->setPrivateData(jsShader, shaderModule);
                            state->engine->setProperty(jsShader, "_tnVertexEntryPoint",
                                state->engine->newString(singleWgslEntryPoint(code, "vertex").c_str()));
                            state->engine->setProperty(jsShader, "_tnFragmentEntryPoint",
                                state->engine->newString(singleWgslEntryPoint(code, "fragment").c_str()));
                            return jsShader;
}

static js::JSValueHandle tnWebgpuHandler33(BindingsState* state, uint64_t bufferId, const std::vector<js::JSValueHandle>& args) {
                                    releaseBufferRegistryEntry(state, bufferId);
                                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler32(BindingsState* state, uint64_t bufferId, const std::vector<js::JSValueHandle>& args) {
                                    // Look up this specific buffer by its ID
                                    auto it = state->bufferRegistry.find(bufferId);
                                    if (it == state->bufferRegistry.end()) {
                                        std::cerr << "[WebGPU] unmap: Buffer " << bufferId << " not found in registry" << std::endl;
                                        return state->engine->newUndefined();
                                    }
                                    auto& bufferInfo = it->second;
                                    if (bufferInfo.isMapped) {
                                        wgpuBufferUnmap(bufferInfo.buffer);
                                        bufferInfo.isMapped = false;
                                        bufferInfo.mappedData = nullptr;
                                        bufferInfo.mappedSize = 0;
                                    }
                                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler31(BindingsState* state, uint64_t bufferId, const std::vector<js::JSValueHandle>& args) {
                                    // Look up this specific buffer by its ID
                                    auto it = state->bufferRegistry.find(bufferId);
                                    if (it == state->bufferRegistry.end()) {
                                        std::cerr << "[WebGPU] getMappedRange: Buffer " << bufferId << " not found in registry" << std::endl;
                                        return state->engine->newUndefined();
                                    }
                                    auto& bufferInfo = it->second;
                                    if (!bufferInfo.isMapped && !bufferInfo.mappedData) {
                                        if (state->verboseLogging) std::cerr << "[WebGPU] getMappedRange: Buffer " << bufferId << " is not mapped" << std::endl;
                                        return state->engine->newUndefined();
                                    }
                                    uint64_t offset = args.empty() ? 0 : (uint64_t)state->engine->toNumber(args[0]);
                                    uint64_t rangeSize = args.size() > 1 ? (uint64_t)state->engine->toNumber(args[1]) : bufferInfo.size - offset;
                                    // Use wgpuBufferGetConstMappedRange for MAP_READ, wgpuBufferGetMappedRange for MAP_WRITE
                                    // Dawn requires the const version for read-only mapped buffers
                                    const void* mappedData = nullptr;
                                    if (bufferInfo.mapMode == WGPUMapMode_Read) {
                                        mappedData = wgpuBufferGetConstMappedRange(bufferInfo.buffer, offset, rangeSize);
                                    } else {
                                        mappedData = wgpuBufferGetMappedRange(bufferInfo.buffer, offset, rangeSize);
                                    }
                                    if (mappedData) {
                                        // Use newArrayBufferExternal to avoid copying
                                        // Cast away const for read-only buffers - the JS side shouldn't modify but we need void*
                                        return state->engine->newArrayBufferExternal(const_cast<void*>(mappedData), rangeSize);
                                    }
                                    if (state->verboseLogging) std::cerr << "[WebGPU] getMappedRange: GetMappedRange returned null for buffer " << bufferId << std::endl;
                                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler30(BindingsState* state, uint64_t bufferId, const std::vector<js::JSValueHandle>& args) {
                                    auto it = state->bufferRegistry.find(bufferId);
                                    if (it == state->bufferRegistry.end()) {
                                        std::cerr << "[WebGPU] mapAsync: Buffer " << bufferId << " not found" << std::endl;
                                        return state->engine->evalWithResult("Promise.reject(new Error('Buffer not found'))", "mapAsync-error");
                                    }
                                    auto& bufferInfo = it->second;
                                    // Already mapped (mappedAtCreation)?
                                    if (bufferInfo.isMapped) {
                                        return state->engine->evalWithResult("Promise.resolve()", "mapAsync-already-mapped");
                                    }
                                    // Get mode (default to READ)
                                    WGPUMapMode mode = WGPUMapMode_Read;
                                    if (!args.empty()) {
                                        uint32_t jsMode = (uint32_t)state->engine->toNumber(args[0]);
                                        // GPUMapMode.READ = 1, GPUMapMode.WRITE = 2
                                        if (jsMode == 2) mode = WGPUMapMode_Write;
                                    }
                                    uint64_t offset = args.size() > 1 ? (uint64_t)state->engine->toNumber(args[1]) : 0;
                                    uint64_t mapSize = args.size() > 2 ? (uint64_t)state->engine->toNumber(args[2]) : bufferInfo.size;
                                    // Debug: Log buffer info
                                    bool hasMapRead = (bufferInfo.usage & WGPUBufferUsage_MapRead) != 0;
                                    (void)hasMapRead;  // Used for debug logging when enabled
                                    // Ensure all pending GPU work is processed before attempting to map
                                    // This is critical for buffers that were just used in a copy operation
                                    for (int prePoll = 0; prePoll < 100; prePoll++) {
#if defined(MYSTRAL_WEBGPU_WGPU)
                                        wgpuDevicePoll(state->device, false, nullptr);
#else
                                        if (state->instance) {
                                            wgpuInstanceProcessEvents(state->instance);
                                        }
                                        if (state->device) {
                                            wgpuDeviceTick(state->device);
                                        }
#endif
                                    }
                                    // Synchronous mapping: use global callback + device poll
                                    {
                                        std::lock_guard<std::mutex> lock(state->bufferMapData.waitMutex);
                                        state->bufferMapData.completed = false;
                                        state->bufferMapData.status = WGPUBufferMapAsyncStatus_Unknown_Compat;
                                        state->bufferMapData.errorMessage.clear();
                                    }
#if WGPU_BUFFER_MAP_USES_CALLBACK_INFO
                                    // Dawn uses CallbackInfo struct with 4-param callback
                                    // Use AllowSpontaneous mode so callback can be invoked at any time
                                    WGPUBufferMapCallbackInfo mapCallbackInfo = {};
                                    mapCallbackInfo.mode = WGPUCallbackMode_AllowSpontaneous;
                                    mapCallbackInfo.callback = onBufferMapped;
                                    mapCallbackInfo.userdata1 = &state->bufferMapData;
                                    mapCallbackInfo.userdata2 = nullptr;
                                    wgpuBufferMapAsync(bufferInfo.buffer, mode, offset, mapSize, mapCallbackInfo);
#else
                                    // wgpu-native uses separate callback and userdata
                                    wgpuBufferMapAsync(bufferInfo.buffer, mode, offset, mapSize, onBufferMapped, &state->bufferMapData);
#endif
                                    // Poll device until mapping completes
                                    // Add small sleep to avoid busy-looping and let GPU work complete
                                    int pollCount = 0;
                                    while (!bufferMapCompleted(state->bufferMapData) && pollCount < 10000) {
#if defined(MYSTRAL_WEBGPU_WGPU)
                                        wgpuDevicePoll(state->device, true, nullptr);
#else
                                        if (state->instance) {
                                            wgpuInstanceProcessEvents(state->instance);
                                        }
                                        if (state->device) {
                                            wgpuDeviceTick(state->device);
                                        }
#endif
                                        // A timed condition wait avoids a fixed sleep while preserving
                                        // the existing 100-iteration timeout budget.
                                        if (pollCount % 100 == 0) {
                                            std::unique_lock<std::mutex> lock(state->bufferMapData.waitMutex);
                                            state->bufferMapData.waitCondition.wait_for(
                                                lock,
                                                std::chrono::milliseconds(1),
                                                [&state]() { return state->bufferMapData.completed; });
                                        }
                                        pollCount++;
                                    }
                                    const auto mapStatus = bufferMapStatus(state->bufferMapData);
                                    if (mapStatus == WGPUBufferMapAsyncStatus_Success_Compat) {
                                        bufferInfo.isMapped = true;
                                        bufferInfo.mapMode = mode;  // Store whether mapped for read or write
                                        return state->engine->evalWithResult("Promise.resolve()", "mapAsync-success");
                                    } else {
                                        const std::string mapError = bufferMapError(state->bufferMapData);
                                        std::cerr << "[WebGPU] mapAsync: Failed with status " << mapStatus;
                                        if (!mapError.empty()) {
                                            std::cerr << " - " << mapError;
                                        }
                                        std::cerr << std::endl;
                                        return state->engine->evalWithResult("Promise.reject(new Error('Buffer map failed'))", "mapAsync-failed");
                                    }
}

static js::JSValueHandle tnWebgpuHandler29(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            mystral::StallScope stall(mystral::StallSegment::BufferUpload);
                            if (args.empty()) {
                                state->engine->throwException("createBuffer requires a descriptor");
                                return state->engine->newUndefined();
                            }
                            auto descriptor = args[0];
                            double size = state->engine->toNumber(state->engine->getProperty(descriptor, "size"));
                            double usage = state->engine->toNumber(state->engine->getProperty(descriptor, "usage"));
                            // Check for mappedAtCreation
                            auto mappedAtCreationProp = state->engine->getProperty(descriptor, "mappedAtCreation");
                            bool mappedAtCreation = !state->engine->isUndefined(mappedAtCreationProp) && state->engine->toBoolean(mappedAtCreationProp);
                            WGPUBufferDescriptor bufferDesc = {};
                            bufferDesc.size = (uint64_t)size;
                            bufferDesc.usage = (WGPUBufferUsage)(uint32_t)usage;
                            bufferDesc.mappedAtCreation = mappedAtCreation;
                            WGPUBuffer buffer = wgpuDeviceCreateBuffer(state->device, &bufferDesc);
                            if (!buffer) {
                                state->engine->throwException("Failed to create buffer");
                                return state->engine->newUndefined();
                            }
                            // Register buffer for mapping operations
                            uint64_t bufferId = state->nextBufferId++;
                            // mappedAtCreation buffers are mapped for write
                            WGPUMapMode initialMapMode = mappedAtCreation ? WGPUMapMode_Write : WGPUMapMode_None;
                            BufferInfo bufferInfo;
                            bufferInfo.buffer = buffer;
                            bufferInfo.size = bufferDesc.size;
                            bufferInfo.usage = bufferDesc.usage;
                            bufferInfo.isMapped = mappedAtCreation;
                            bufferInfo.mappedData = nullptr;
                            bufferInfo.mappedSize = 0;
                            bufferInfo.mapMode = initialMapMode;
                            bufferInfo.accounted = false;
                            state->bufferRegistry[bufferId] = bufferInfo;
                            auto jsBuffer = state->engine->newObject();
                            state->engine->setPrivateData(jsBuffer, buffer);
                            state->engine->setProperty(jsBuffer, "size", state->engine->newNumber(size));
                            state->engine->setProperty(jsBuffer, "_bufferId", state->engine->newNumber((double)bufferId));
                            state->engine->setProperty(jsBuffer, "usage", state->engine->newNumber(usage));
                            // Set initial mapState
                            state->engine->setProperty(jsBuffer, "mapState", state->engine->newString(mappedAtCreation ? "mapped" : "unmapped"));
                            // buffer.mapAsync(mode, offset?, size?) -> Promise
                            // Returns a Promise that resolves when the buffer is mapped
                            if (!installBindingTable(state->engine, state, bindingTable({
                                {"GPUBuffer", "mapAsync", 0, nullptr,
                                makeCapturedHandler(bufferId, &tnWebgpuHandler30)
                            , jsBuffer},
                            // buffer.getMappedRange(offset?, size?) -> ArrayBuffer
                            // Capture bufferId in closure to identify the correct buffer
                                {"GPUBuffer", "getMappedRange", 0, nullptr,
                                makeCapturedHandler(bufferId, &tnWebgpuHandler31)
                            , jsBuffer},
                            // buffer.unmap()
                            // Capture bufferId in closure to identify the correct buffer
                                {"GPUBuffer", "unmap", 0, nullptr,
                                makeCapturedHandler(bufferId, &tnWebgpuHandler32)
                            , jsBuffer},
                            // buffer.destroy()
                            // Capture bufferId in closure to identify the correct buffer
                                {"GPUBuffer", "destroy", 0, nullptr,
                                makeCapturedHandler(bufferId, &tnWebgpuHandler33)
                            , jsBuffer}}))) {
                                releaseBufferRegistryEntry(state, bufferId);
                                return state->engine->newUndefined();
                            }
                            recordBufferCreated(state, bufferDesc.size, (uint32_t)usage);
                            state->bufferRegistry[bufferId].accounted = true;
                            return jsBuffer;
}

static js::JSValueHandle tnWebgpuHandler28(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            if (args.empty()) return state->engine->newBoolean(false);
                            std::string featureName = state->engine->toString(args[0]);
                            // indirect-first-instance enables non-zero firstInstance in indirect draws
                            if (featureName == "indirect-first-instance") {
                                return state->engine->newBoolean(true);
                            }
                            // timestamp-query is NOT supported yet - bindings not implemented
                            if (featureName == "timestamp-query") {
                                return state->engine->newBoolean(false);
                            }
                            // This Dawn has no Undefined member; 0 is outside the enum's values
                            // and never a valid feature, so it stands in as the sentinel.
                            WGPUFeatureName feature = jsFeatureNameToWGPU(featureName);
                            if (feature == static_cast<WGPUFeatureName>(0)) return state->engine->newBoolean(false);
                            return state->engine->newBoolean(wgpuDeviceHasFeature(state->device, feature) != 0);
}

static js::JSValueHandle tnWebgpuHandler27(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>&) {
                            std::cout << "[WebGPU] device.destroy(): teardown is owned by the host"
                                      << std::endl;
                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler26(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            auto* data = new QueueWorkDoneData();
#if WGPU_USES_CALLBACK_INFO_PATTERN
                            WGPUQueueWorkDoneCallbackInfo callbackInfo = {};
                            callbackInfo.mode = WGPUCallbackMode_AllowSpontaneous;
                            callbackInfo.callback = onQueueWorkDone;
                            callbackInfo.userdata1 = data;
                            callbackInfo.userdata2 = nullptr;
                            (void)wgpuQueueOnSubmittedWorkDone(state->queue, callbackInfo);
#else
                            wgpuQueueOnSubmittedWorkDone(state->queue, onQueueWorkDone, data);
#endif
                            if (!waitForWebGpuCallback(state, data)) {
                                releaseCallbackData(data);
                                return rejectedPromise(state,
                                    "GPUQueue.onSubmittedWorkDone timed out waiting for native completion.",
                                    "onSubmittedWorkDone-timeout"
                                );
                            }
                            const WGPUQueueWorkDoneStatus status = data->status;
                            const std::string nativeMessage = data->message;
                            releaseCallbackData(data);
                            if (status != WGPUQueueWorkDoneStatus_Success) {
                                std::string message = "GPUQueue.onSubmittedWorkDone failed with native status "
                                    + std::to_string(static_cast<int>(status));
                                if (!nativeMessage.empty()) message += ": " + nativeMessage;
                                return rejectedPromise(state, message, "onSubmittedWorkDone-error");
                            }
                            return resolvedPromise(state, "undefined", "onSubmittedWorkDone-success");
}

static js::JSValueHandle tnWebgpuHandler25(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            if (args.size() < 3) {
                                state->engine->throwException("copyExternalImageToTexture requires source, destination, and copySize");
                                return state->engine->newUndefined();
                            }
                            // Parse source (ImageBitmap-like object or canvas element)
                            auto source = args[0];
                            auto sourceObj = state->engine->getProperty(source, "source");
                            if (state->engine->isUndefined(sourceObj)) {
                                sourceObj = source; // source might be passed directly
                            }
                            // Parse flipY option (default false per WebGPU spec)
                            bool flipY = false;
                            auto flipYProp = state->engine->getProperty(source, "flipY");
                            if (!state->engine->isUndefined(flipYProp)) {
                                flipY = state->engine->toBoolean(flipYProp);
                            }
                            // Parse destination.premultipliedAlpha (default false per WebGPU spec).
                            // PixiJS sets this true so its NORMAL blend (ONE, ONE_MINUS_SRC_ALPHA)
                            // produces correct results. Our PNG decoder returns straight alpha, so
                            // when the destination requests premultiplied we must multiply RGB by
                            // A/255 on the fly. Without this, pixels with 0<a<255 and color>0 render
                            // too bright / with color halos.
                            bool premultipliedAlpha = false;
                            {
                                auto premulProp = state->engine->getProperty(args[1], "premultipliedAlpha");
                                if (!state->engine->isUndefined(premulProp)) {
                                    premultipliedAlpha = state->engine->toBoolean(premulProp);
                                }
                            }
                            int imgWidth = 0;
                            int imgHeight = 0;
                            size_t dataSize = 0;
                            void* dataPtr = nullptr;
                            // Try to get data from ImageBitmap
                            auto imageData = state->engine->getProperty(sourceObj, "_data");
                            if (!state->engine->isUndefined(imageData)) {
                                // Standard ImageBitmap with _data
                                imgWidth = (int)state->engine->toNumber(state->engine->getProperty(sourceObj, "width"));
                                imgHeight = (int)state->engine->toNumber(state->engine->getProperty(sourceObj, "height"));
                                dataPtr = state->engine->getArrayBufferData(imageData, &dataSize);
                            } else {
                                // Check if it's a canvas element
                                auto tagName = state->engine->getProperty(sourceObj, "tagName");
                                std::string tagNameStr = state->engine->isUndefined(tagName) ? "" : state->engine->toString(tagName);
                                if (tagNameStr == "CANVAS" || tagNameStr == "canvas") {
                                    // Get the canvas ID from private data or property
                                    auto canvasIdProp = state->engine->getProperty(sourceObj, "_offscreenCanvasId");
                                    if (!state->engine->isUndefined(canvasIdProp)) {
                                        int canvasId = (int)state->engine->toNumber(canvasIdProp);
                                        auto it = state->offscreenCanvases.find(canvasId);
                                        if (it != state->offscreenCanvases.end() && it->second->hasContext2d) {
                                            // Get pixel data from the 2D context
                                            auto ctx2dHandle = it->second->context2d;
                                            auto nativeCtx = static_cast<canvas::Canvas2DContext*>(state->engine->getPrivateData(ctx2dHandle));
                                            if (nativeCtx) {
                                                imgWidth = it->second->width;
                                                imgHeight = it->second->height;
                                                dataPtr = const_cast<void*>(static_cast<const void*>(nativeCtx->getPixelData()));
                                                dataSize = nativeCtx->getPixelDataSize();
                                            }
                                        }
                                    }
                                }
                                // Check if it's already a 2D context (has getImageData method or _contextType)
                                auto contextType = state->engine->getProperty(sourceObj, "_contextType");
                                if (!state->engine->isUndefined(contextType)) {
                                    std::string ctxTypeStr = state->engine->toString(contextType);
                                    if (ctxTypeStr == "2d") {
                                        // It's a 2D context, get the canvas and then get pixel data
                                        auto canvas = state->engine->getProperty(sourceObj, "canvas");
                                        if (!state->engine->isUndefined(canvas)) {
                                            auto canvasIdProp = state->engine->getProperty(canvas, "_offscreenCanvasId");
                                            if (!state->engine->isUndefined(canvasIdProp)) {
                                                int canvasId = (int)state->engine->toNumber(canvasIdProp);
                                                auto it = state->offscreenCanvases.find(canvasId);
                                                if (it != state->offscreenCanvases.end() && it->second->hasContext2d) {
                                                    auto nativeCtx = static_cast<canvas::Canvas2DContext*>(state->engine->getPrivateData(sourceObj));
                                                    if (nativeCtx) {
                                                        imgWidth = it->second->width;
                                                        imgHeight = it->second->height;
                                                        dataPtr = const_cast<void*>(static_cast<const void*>(nativeCtx->getPixelData()));
                                                        dataSize = nativeCtx->getPixelDataSize();
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            if (!dataPtr || dataSize == 0) {
                                // Try to get width/height anyway for better error message
                                auto widthProp = state->engine->getProperty(sourceObj, "width");
                                auto heightProp = state->engine->getProperty(sourceObj, "height");
                                if (!state->engine->isUndefined(widthProp)) imgWidth = (int)state->engine->toNumber(widthProp);
                                if (!state->engine->isUndefined(heightProp)) imgHeight = (int)state->engine->toNumber(heightProp);
                                std::cerr << "[WebGPU] copyExternalImageToTexture: unsupported source type, width=" << imgWidth << ", height=" << imgHeight << std::endl;
                                // Return silently instead of throwing - PixiJS might be able to continue
                                return state->engine->newUndefined();
                            }
                            // Parse destination
                            auto destination = args[1];
                            auto textureObj = state->engine->getProperty(destination, "texture");
                            WGPUTexture texture = (WGPUTexture)state->engine->getPrivateData(textureObj);
                            if (!texture) {
                                state->engine->throwException("copyExternalImageToTexture: invalid texture");
                                return state->engine->newUndefined();
                            }
                            // Detect the destination texture format. In a real browser,
                            // copyExternalImageToTexture converts the source's RGBA pixels into the
                            // destination's format; we upload bytes verbatim via writeTexture, so for
                            // BGRA8 destinations we must swap the R/B channels ourselves. Our
                            // ImageBitmap data is always RGBA (stb_image / WebPDecodeRGBA), but PixiJS
                            // v8's TextureSource.defaultOptions.format is "bgra8unorm", so every
                            // Texture.from(imageBitmap) lands here — without the swap, red and blue
                            // come out transposed.
                            bool swapRB = false;
                            {
                                auto fmtProp = state->engine->getProperty(textureObj, "format");
                                if (!state->engine->isUndefined(fmtProp)) {
                                    std::string fmt = state->engine->toString(fmtProp);
                                    swapRB = (fmt == "bgra8unorm" || fmt == "bgra8unorm-srgb");
                                }
                            }
                            // Optional mipLevel and origin
                            uint32_t mipLevel = 0;
                            auto mipLevelVal = state->engine->getProperty(destination, "mipLevel");
                            if (!state->engine->isUndefined(mipLevelVal)) {
                                mipLevel = (uint32_t)state->engine->toNumber(mipLevelVal);
                            }
                            uint32_t originX = 0, originY = 0, originZ = 0;
                            auto originVal = state->engine->getProperty(destination, "origin");
                            if (!state->engine->isUndefined(originVal)) {
                                if (state->engine->isArray(originVal)) {
                                    originX = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(originVal, 0));
                                    originY = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(originVal, 1));
                                    originZ = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(originVal, 2));
                                }
                            }
                            // Parse copySize
                            auto sizeVal = args[2];
                            uint32_t width = imgWidth, height = imgHeight, depthOrArrayLayers = 1;
                            if (state->engine->isArray(sizeVal)) {
                                width = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(sizeVal, 0));
                                height = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(sizeVal, 1));
                                auto depthVal = state->engine->getPropertyIndex(sizeVal, 2);
                                if (!state->engine->isUndefined(depthVal)) {
                                    depthOrArrayLayers = (uint32_t)state->engine->toNumber(depthVal);
                                }
                            } else if (!state->engine->isUndefined(sizeVal)) {
                                auto widthVal = state->engine->getProperty(sizeVal, "width");
                                auto heightVal = state->engine->getProperty(sizeVal, "height");
                                if (!state->engine->isUndefined(widthVal)) width = (uint32_t)state->engine->toNumber(widthVal);
                                if (!state->engine->isUndefined(heightVal)) height = (uint32_t)state->engine->toNumber(heightVal);
                            }
                            // Handle flipY, premultipliedAlpha, and/or BGRA channel swap by writing
                            // into a staging copy. RGBA8 only (matches the hardcoded bytesPerRow below).
                            std::vector<uint8_t> stagingData;
                            void* uploadDataPtr = dataPtr;
                            if ((flipY || premultipliedAlpha || swapRB) && dataPtr && imgHeight > 0 && imgWidth > 0) {
                                size_t bytesPerRow = (size_t)imgWidth * 4;
                                stagingData.resize(dataSize);
                                const uint8_t* srcData = static_cast<const uint8_t*>(dataPtr);
                                for (int y = 0; y < imgHeight; y++) {
                                    const uint8_t* srcRow = srcData + (flipY ? (imgHeight - 1 - y) : y) * bytesPerRow;
                                    uint8_t* dstRow = stagingData.data() + (size_t)y * bytesPerRow;
                                    if (premultipliedAlpha || swapRB) {
                                        for (int x = 0; x < imgWidth; x++) {
                                            uint32_t r = srcRow[x * 4 + 0];
                                            uint32_t g = srcRow[x * 4 + 1];
                                            uint32_t b = srcRow[x * 4 + 2];
                                            uint32_t a = srcRow[x * 4 + 3];
                                            if (premultipliedAlpha) {
                                                // (v * a + 127) / 255 rounds correctly without a divide instruction
                                                r = (r * a + 127) / 255;
                                                g = (g * a + 127) / 255;
                                                b = (b * a + 127) / 255;
                                            }
                                            // BGRA8 destinations read byte 0 as B and byte 2 as R, so emit
                                            // the channels swapped; RGBA8 destinations get them in order.
                                            dstRow[x * 4 + 0] = (uint8_t)(swapRB ? b : r);
                                            dstRow[x * 4 + 1] = (uint8_t)g;
                                            dstRow[x * 4 + 2] = (uint8_t)(swapRB ? r : b);
                                            dstRow[x * 4 + 3] = (uint8_t)a;
                                        }
                                    } else {
                                        std::memcpy(dstRow, srcRow, bytesPerRow);
                                    }
                                }
                                uploadDataPtr = stagingData.data();
                                if (state->verboseLogging) {
                                    std::cout << "[WebGPU] copyExternalImageToTexture: "
                                              << (flipY ? "flipY " : "")
                                              << (premultipliedAlpha ? "premultiplyAlpha " : "")
                                              << (swapRB ? "swapRB" : "")
                                              << std::endl;
                                }
                            }
                            // Use writeTexture internally (same effect as copyExternalImageToTexture)
                            WGPUImageCopyTexture_Compat destCopy = {};
                            destCopy.texture = texture;
                            destCopy.mipLevel = mipLevel;
                            destCopy.origin = {originX, originY, originZ};
                            destCopy.aspect = WGPUTextureAspect_All;
                            WGPUTextureDataLayout_Compat layout = {};
                            layout.offset = 0;
                            layout.bytesPerRow = imgWidth * 4;  // RGBA
                            layout.rowsPerImage = imgHeight;
                            WGPUExtent3D copySize = {width, height, depthOrArrayLayers};
                            wgpuQueueWriteTexture(state->queue, &destCopy, uploadDataPtr, dataSize, &layout, &copySize);
                            if (state->verboseLogging) std::cout << "[WebGPU] copyExternalImageToTexture: " << width << "x" << height << (flipY ? " (flipY)" : "") << std::endl;
                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler24(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            mystral::StallScope stall(mystral::StallSegment::TextureUpload);
                            if (args.size() < 4) {
                                state->engine->throwException("writeTexture requires destination, data, dataLayout, and size");
                                return state->engine->newUndefined();
                            }
                            // Parse destination {texture, mipLevel?, origin?, aspect?}
                            auto destination = args[0];
                            auto textureHandle = state->engine->getProperty(destination, "texture");
                            WGPUTexture texture = (WGPUTexture)state->engine->getPrivateData(textureHandle);
                            if (!texture) {
                                state->engine->throwException("writeTexture: invalid texture");
                                return state->engine->newUndefined();
                            }
                            auto mipLevelVal = state->engine->getProperty(destination, "mipLevel");
                            uint32_t mipLevel = state->engine->isUndefined(mipLevelVal) ? 0 : (uint32_t)state->engine->toNumber(mipLevelVal);
                            // Parse origin
                            auto originVal = state->engine->getProperty(destination, "origin");
                            uint32_t originX = 0, originY = 0, originZ = 0;
                            if (!state->engine->isUndefined(originVal)) {
                                auto lengthProp = state->engine->getProperty(originVal, "length");
                                if (!state->engine->isUndefined(lengthProp)) {
                                    // Array format
                                    int len = (int)state->engine->toNumber(lengthProp);
                                    if (len >= 1) originX = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(originVal, 0));
                                    if (len >= 2) originY = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(originVal, 1));
                                    if (len >= 3) originZ = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(originVal, 2));
                                } else {
                                    // Object format
                                    auto x = state->engine->getProperty(originVal, "x");
                                    auto y = state->engine->getProperty(originVal, "y");
                                    auto z = state->engine->getProperty(originVal, "z");
                                    if (!state->engine->isUndefined(x)) originX = (uint32_t)state->engine->toNumber(x);
                                    if (!state->engine->isUndefined(y)) originY = (uint32_t)state->engine->toNumber(y);
                                    if (!state->engine->isUndefined(z)) originZ = (uint32_t)state->engine->toNumber(z);
                                }
                            }
                            // Get ArrayBuffer data
                            size_t dataSize = 0;
                            void* dataPtr = state->engine->getArrayBufferData(args[1], &dataSize);
                            if (!dataPtr || dataSize == 0) {
                                state->engine->throwException("writeTexture: invalid data");
                                return state->engine->newUndefined();
                            }
                            // Parse size FIRST (need height for rowsPerImage default)
                            auto sizeVal = args[3];
                            uint32_t width = 1, height = 1, depthOrArrayLayers = 1;
                            auto lengthProp = state->engine->getProperty(sizeVal, "length");
                            if (!state->engine->isUndefined(lengthProp)) {
                                int len = (int)state->engine->toNumber(lengthProp);
                                if (len >= 1) width = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(sizeVal, 0));
                                if (len >= 2) height = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(sizeVal, 1));
                                if (len >= 3) depthOrArrayLayers = (uint32_t)state->engine->toNumber(state->engine->getPropertyIndex(sizeVal, 2));
                            } else {
                                auto w = state->engine->getProperty(sizeVal, "width");
                                auto h = state->engine->getProperty(sizeVal, "height");
                                auto d = state->engine->getProperty(sizeVal, "depthOrArrayLayers");
                                if (!state->engine->isUndefined(w)) width = (uint32_t)state->engine->toNumber(w);
                                if (!state->engine->isUndefined(h)) height = (uint32_t)state->engine->toNumber(h);
                                if (!state->engine->isUndefined(d)) depthOrArrayLayers = (uint32_t)state->engine->toNumber(d);
                            }
                            // Parse dataLayout {offset?, bytesPerRow, rowsPerImage?}
                            auto dataLayout = args[2];
                            auto layoutOffsetVal = state->engine->getProperty(dataLayout, "offset");
                            uint64_t layoutOffset = state->engine->isUndefined(layoutOffsetVal) ? 0 : (uint64_t)state->engine->toNumber(layoutOffsetVal);
                            uint32_t bytesPerRow = (uint32_t)state->engine->toNumber(state->engine->getProperty(dataLayout, "bytesPerRow"));
                            auto rowsPerImageVal = state->engine->getProperty(dataLayout, "rowsPerImage");
                            // rowsPerImage must be >= height for 2D textures (wgpu validation requirement)
                            uint32_t rowsPerImage = state->engine->isUndefined(rowsPerImageVal) ? height : (uint32_t)state->engine->toNumber(rowsPerImageVal);
                            if (rowsPerImage == 0) rowsPerImage = height;
                            // Create copy structures
                            WGPUImageCopyTexture_Compat destCopy = {};
                            destCopy.texture = texture;
                            destCopy.mipLevel = mipLevel;
                            destCopy.origin = {originX, originY, originZ};
                            destCopy.aspect = WGPUTextureAspect_All;
                            WGPUTextureDataLayout_Compat layout = {};
                            layout.offset = layoutOffset;
                            layout.bytesPerRow = bytesPerRow;
                            layout.rowsPerImage = rowsPerImage;
                            WGPUExtent3D copySize = {width, height, depthOrArrayLayers};
                            // Write texture
                            wgpuQueueWriteTexture(state->queue, &destCopy, (uint8_t*)dataPtr + layoutOffset, dataSize - layoutOffset, &layout, &copySize);
                            if (state->verboseLogging) std::cout << "[WebGPU] writeTexture: " << width << "x" << height << " (" << dataSize << " bytes)" << std::endl;
                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler23(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            mystral::StallScope stall(mystral::StallSegment::BufferUpload);
                            if (args.size() < 3) {
                                state->engine->throwException("writeBuffer requires buffer, offset, and data");
                                return state->engine->newUndefined();
                            }
#if TN_ANDROID_JS_PROFILE
                            const auto profileStart = beginProfiledBinding();
#endif
                            WGPUBuffer buffer = (WGPUBuffer)state->engine->getPrivateData(args[0]);
                            const double offsetValue = state->engine->toNumber(args[1]);
                            if (!std::isfinite(offsetValue) || offsetValue < 0 || std::floor(offsetValue) != offsetValue ||
                                static_cast<uint64_t>(offsetValue) % 4 != 0) {
                                state->engine->throwException("writeBuffer: buffer offset must be a non-negative multiple of 4");
                                return state->engine->newUndefined();
                            }
                            const uint64_t offset = static_cast<uint64_t>(offsetValue);
                            // Get ArrayBuffer data
                            size_t dataSize = 0;
                            void* dataPtr = state->engine->getArrayBufferData(args[2], &dataSize);
                            if (!dataPtr || dataSize == 0) {
                                state->engine->throwException("writeBuffer: invalid data");
                                return state->engine->newUndefined();
                            }
                            // WebGPU expresses dataOffset/size in elements for a TypedArray,
                            // but in bytes for ArrayBuffer and DataView inputs.
                            size_t bytesPerElement = 1;
                            auto bytesPerElementValue = state->engine->getProperty(args[2], "BYTES_PER_ELEMENT");
                            if (!state->engine->isUndefined(bytesPerElementValue)) {
                                const double value = state->engine->toNumber(bytesPerElementValue);
                                if (value > 0) bytesPerElement = static_cast<size_t>(value);
                            }
                            const double dataOffsetValue = args.size() > 3 ? state->engine->toNumber(args[3]) : 0;
                            const double sizeValue = args.size() > 4 ? state->engine->toNumber(args[4]) : -1;
                            if (!std::isfinite(dataOffsetValue) || dataOffsetValue < 0 ||
                                std::floor(dataOffsetValue) != dataOffsetValue ||
                                (args.size() > 4 && (!std::isfinite(sizeValue) || sizeValue < 0 ||
                                                    std::floor(sizeValue) != sizeValue))) {
                                state->engine->throwException("writeBuffer: data offset and size must be non-negative");
                                return state->engine->newUndefined();
                            }
                            const size_t dataOffset = static_cast<size_t>(dataOffsetValue) * bytesPerElement;
                            const size_t writeSize = args.size() > 4
                                ? static_cast<size_t>(sizeValue) * bytesPerElement
                                : (dataOffset <= dataSize ? dataSize - dataOffset : 0);
                            if (dataOffset > dataSize || writeSize > dataSize - dataOffset) {
                                state->engine->throwException("writeBuffer: source range exceeds the supplied buffer view");
                                return state->engine->newUndefined();
                            }
                            if (buffer && state->queue) {
                                const uint8_t* source = static_cast<uint8_t*>(dataPtr) + dataOffset;
                                const size_t alignedWriteSize = (writeSize + 3) & ~size_t(3);
                                if (alignedWriteSize == writeSize) {
                                    wgpuQueueWriteBuffer(state->queue, buffer, offset, source, writeSize);
                                } else {
                                    // Three pads destination attribute buffers to four bytes.
                                    // Mirror browser implementations by zero-padding the final
                                    // partial element before crossing the native WebGPU ABI.
                                    std::vector<uint8_t> alignedData(alignedWriteSize, 0);
                                    std::memcpy(alignedData.data(), source, writeSize);
                                    wgpuQueueWriteBuffer(state->queue, buffer, offset, alignedData.data(), alignedData.size());
                                }
                            }
#if TN_ANDROID_JS_PROFILE
                            endProfiledBinding(state, ProfiledRenderCommand::WriteBuffer, profileStart);
                            if (buffer && state->queue) {
                                state->androidJsNativeProfile.writeBufferBytes += writeSize;
                                state->androidJsNativeProfile.writeBufferTargets.insert(buffer);
                                if (writeSize <= 256) {
                                    state->androidJsNativeProfile.writeBufferSmallCalls += 1;
                                } else if (writeSize <= 4096) {
                                    state->androidJsNativeProfile.writeBufferMediumCalls += 1;
                                } else {
                                    state->androidJsNativeProfile.writeBufferLargeCalls += 1;
                                }
                            }
#endif
                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler22(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                            mystral::StallScope stall(mystral::StallSegment::QueueSubmit);
                            if (args.empty()) {
                                return state->engine->newUndefined();
                            }
                            // Get command buffers array and submit them
                            auto cmdBuffersArray = args[0];
                            // Get array length
                            auto lengthProp = state->engine->getProperty(cmdBuffersArray, "length");
                            int length = (int)state->engine->toNumber(lengthProp);
                            // Collect command buffers
                            std::vector<WGPUCommandBuffer> cmdBuffers;
                            for (int i = 0; i < length; i++) {
                                auto cmdBufferHandle = state->engine->getPropertyIndex(cmdBuffersArray, i);
                                WGPUCommandBuffer cmdBuffer = (WGPUCommandBuffer)state->engine->getPrivateData(cmdBufferHandle);
                                // A NULL entry used to be dropped silently, which turns "the GPU never got
                                // this frame's work" into a rendering mystery instead of an error, and
                                // leaves the caller believing it submitted.
                                if (!requireHandle(state->engine, cmdBuffer, "queue.submit",
                                                   "commandBuffers[" + std::to_string(i) + "]"))
                                    return state->engine->newUndefined();
                                cmdBuffers.push_back(cmdBuffer);
                            }
                            // Submit user command buffers first
                            state->submitCount++;
#if TN_ANDROID_JS_PROFILE
                            uint64_t submitPollNs = 0;
                            uint64_t presentNs = 0;
#endif
                            if (!cmdBuffers.empty() && state->queue) {
#if TN_ANDROID_JS_PROFILE
                                const auto submitStart = std::chrono::steady_clock::now();
#endif
                                wgpuQueueSubmit(state->queue, cmdBuffers.size(), cmdBuffers.data());
#if TN_ANDROID_JS_PROFILE
                                submitPollNs = static_cast<uint64_t>(
                                    std::chrono::duration_cast<std::chrono::nanoseconds>(
                                        std::chrono::steady_clock::now() - submitStart
                                    ).count()
                                );
#endif
                                // Release command buffers after submission (they're consumed by submit)
                                for (auto cmdBuf : cmdBuffers) {
                                    wgpuCommandBufferRelease(cmdBuf);
                                }
                                // Tick to flush GPU work
#if TN_ANDROID_JS_PROFILE
                                const auto pollStart = std::chrono::steady_clock::now();
#endif
#if defined(MYSTRAL_WEBGPU_DAWN)
                                wgpuDeviceTick(state->device);
#elif defined(MYSTRAL_WEBGPU_WGPU)
                                wgpuDevicePoll(state->device, false, nullptr);
#endif
#if TN_ANDROID_JS_PROFILE
                                submitPollNs += static_cast<uint64_t>(
                                    std::chrono::duration_cast<std::chrono::nanoseconds>(
                                        std::chrono::steady_clock::now() - pollStart
                                    ).count()
                                );
#endif
                                if (state->verboseLogging) std::cout << "[WebGPU] Submit #" << state->submitCount << ": " << cmdBuffers.size() << " command buffers, currentTexture=" << (void*)state->currentTexture << std::endl;
                            } else {
                                if (state->verboseLogging) std::cout << "[WebGPU] Submit #" << state->submitCount << ": EMPTY (length=" << length << "), currentTexture=" << (void*)state->currentTexture << std::endl;
                            }
                            // Mark the frame ready to present rather than presenting here.
                            //
                            // A frame can submit more than once: three.js renders the world, then
                            // the framework renders `ctx.canvasLayer` as an overlay pass, and each
                            // `renderer.render()` ends in its own submit. Presenting per submit gave
                            // each of those its own swapchain image, so only the first reached the
                            // display and every overlay was silently dropped — the framework's own
                            // loading screen and any game HUD on the canvas layer drew nothing on
                            // native while working on web. presentPendingSurface() runs once per
                            // frame from endDawnFrame(), after every rAF callback has returned.
                            if (state->surface && state->currentTexture && state->surfaceRenderPassEnded) {
                                state->framePresentPending = true;
                            }
#if TN_ANDROID_JS_PROFILE
                            // The present happens after this submit returns, from
                            // presentPendingSurface(); report the previous frame's present on this
                            // frame's first submit only, so per-frame sums count it once.
                            if (!state->presentReportedSinceLastPresent) {
                                presentNs = state->lastPresentNs;
                                state->presentReportedSinceLastPresent = true;
                            }
#endif
#if TN_ANDROID_JS_PROFILE
                            emitAndroidJsNativeProfile(state, submitPollNs, presentNs);
#endif
                            return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler21(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
                    // Return a device object wrapping our native device
                    auto device = state->engine->newObject();
                    state->engine->setPrivateData(device, state->device);
                    // device.queue
                    auto queue = state->engine->newObject();
                    state->engine->setPrivateData(queue, state->queue);
                    // queue.submit(commandBuffers)
                    if (!installBindingTable(state->engine, state, bindingTable({
                        {"GPUQueue", "submit", 0, nullptr,
                        &tnWebgpuHandler22
                    , queue},
                    // queue.writeBuffer(buffer, offset, data, dataOffset?, size?)
                                            {"GPUQueue", "writeBuffer", 0, nullptr,
                        &tnWebgpuHandler23
                    , queue},
                    // queue.writeTexture(destination, data, dataLayout, size)
                                            {"GPUQueue", "writeTexture", 0, nullptr,
                        &tnWebgpuHandler24
                    , queue},
                    // queue.copyExternalImageToTexture(source, destination, copySize)
                    // Standard WebGPU way to upload ImageBitmap to texture
                                            {"GPUQueue", "copyExternalImageToTexture", 0, nullptr,
                        &tnWebgpuHandler25
                    , queue},
                    // queue.onSubmittedWorkDone() - returns Promise that resolves when GPU work is done
                                            {"GPUQueue", "onSubmittedWorkDone", 0, nullptr,
                        &tnWebgpuHandler26
                    , queue}}))) return state->engine->newUndefined();
                    state->engine->setProperty(device, "queue", queue);
                    // device.destroy() - part of the GPUDevice interface, and three.js calls it from
                    // `WebGPURenderer.dispose()`. Without it every clean teardown on a native host
                    // throws `this.device.destroy is not a function`, which reads as a crash at the
                    // end of an otherwise successful run. Releasing the wgpu device here would pull
                    // the surface out from under a host that may still be presenting, so this
                    // reports the call and lets the host own the lifetime.
                    if (!installBindingTable(state->engine, state, bindingTable({
                        {"GPUDevice", "destroy", 0, nullptr,
                        &tnWebgpuHandler27
                    , device}}))) return state->engine->newUndefined();
                    // device.limits - expose device limits
                    auto deviceLimits = state->engine->newObject();
                    state->engine->setProperty(deviceLimits, "maxTextureDimension2D", state->engine->newNumber(8192));
                    state->engine->setProperty(deviceLimits, "maxColorAttachmentBytesPerSample", state->engine->newNumber(64));
                    state->engine->setProperty(deviceLimits, "maxBindGroups", state->engine->newNumber(4));
                    state->engine->setProperty(deviceLimits, "maxBindingsPerBindGroup", state->engine->newNumber(1000));
                    state->engine->setProperty(deviceLimits, "maxUniformBufferBindingSize", state->engine->newNumber(65536));
                    state->engine->setProperty(deviceLimits, "maxStorageBufferBindingSize", state->engine->newNumber(134217728));
                    state->engine->setProperty(deviceLimits, "maxSampledTexturesPerShaderStage", state->engine->newNumber(16));
                    state->engine->setProperty(deviceLimits, "maxSamplersPerShaderStage", state->engine->newNumber(16));
                    state->engine->setProperty(deviceLimits, "maxStorageTexturesPerShaderStage", state->engine->newNumber(8));
                    state->engine->setProperty(deviceLimits, "maxUniformBuffersPerShaderStage", state->engine->newNumber(12));
                    state->engine->setProperty(deviceLimits, "maxStorageBuffersPerShaderStage", state->engine->newNumber(8));
                    state->engine->setProperty(deviceLimits, "maxDynamicUniformBuffersPerPipelineLayout", state->engine->newNumber(8));
                    state->engine->setProperty(deviceLimits, "minUniformBufferOffsetAlignment", state->engine->newNumber(256));
                    state->engine->setProperty(deviceLimits, "minStorageBufferOffsetAlignment", state->engine->newNumber(256));
                    state->engine->setProperty(device, "limits", deviceLimits);
                    // device.features - Set-like object with enabled features, answered from the
                    // real device so consumers (three's KTX2Loader.detectSupport among them)
                    // pick transcode targets from actual hardware capability.
                    auto deviceFeatures = state->engine->newArray(0);
                    auto deviceFeaturesBindingHost = state->engine->newObject();
                    if (!installBindingTable(state->engine, state, bindingTable({
                        {"GPUSupportedFeatures", "has", 0, nullptr,
                        &tnWebgpuHandler28
                    , deviceFeaturesBindingHost}}))) return state->engine->newUndefined();
                    if (!state->engine->setProperty(
                            deviceFeatures,
                            "has",
                            state->engine->getProperty(deviceFeaturesBindingHost, "has"))) {
                        return state->engine->newUndefined();
                    }
                    state->engine->setProperty(device, "features", deviceFeatures);
                    // device.createBuffer(descriptor)
                    if (!installBindingTable(state->engine, state, bindingTable({
                        {"GPUDevice", "createBuffer", 0, nullptr,
                        &tnWebgpuHandler29
                    , device}}))) return state->engine->newUndefined();
                    // device.createShaderModule(descriptor)
                    if (!installBindingTable(state->engine, state, bindingTable({
                        {"GPUDevice", "createShaderModule", 0, nullptr,
                        &tnWebgpuHandler34
                    , device},
                    // device.createRenderPipeline(descriptor)
                                            {"GPUDevice", "createRenderPipeline", 0, nullptr,
                        &tnWebgpuHandler35
                    , device},
                    // device.createComputePipeline(descriptor)
                                            {"GPUDevice", "createComputePipeline", 0, nullptr,
                        &tnWebgpuHandler36
                    , device}}))) return state->engine->newUndefined();
                    // device.createRenderPipelineAsync / createComputePipelineAsync
                    //
                    // Without these, `renderer.compileAsync()` throws "not a function" and every
                    // pipeline is instead built lazily on the draw that first needs it — during
                    // play, where it is a stall the player feels. A Pixel 8 recording measured a
                    // 1,659 ms worst frame with them missing.
                    //
                    // The implementation is synchronous behind an asynchronous signature, which
                    // the WebGPU specification permits: the async form promises a pipeline, never
                    // that the compile happens off-thread. What it buys is *when* the work runs,
                    // not what it costs — a game that awaits `compileAsync` behind its loading
                    // screen pays for the pipelines there instead of mid-frame.
                    {
                        js::JSValueGuard installer(
                            *state->engine,
                            evalEmbeddedRuntimeScriptWithResult(
                                *state->engine, "install-async-pipelines",
                                "install-async-pipelines.js"));
                        js::JSValueGuard installed(*state->engine, {});
                        if (installer) {
                            js::JSValueGuard thisArg(
                                *state->engine, state->engine->newUndefined());
                            installed.reset(
                                state->engine->call(installer.get(), thisArg.get(), {device}));
                        }
                        // Fail loudly rather than leave the renderer to discover it mid-frame.
                        if (!installed || !state->engine->toBoolean(installed.get())) {
                            std::cerr << "[WebGPU] failed to install async pipeline creation"
                                      << std::endl;
                            return state->engine->newUndefined();
                        }
                    }
                    // device.createCommandEncoder(descriptor?)
                    if (!installBindingTable(state->engine, state, bindingTable({
                        {"GPUDevice", "createCommandEncoder", 0, nullptr,
                        &tnWebgpuHandler37
                    , device}}))) return state->engine->newUndefined();
                    // device.createTexture(descriptor)
                    if (!installBindingTable(state->engine, state, bindingTable({
                        {"GPUDevice", "createTexture", 0, nullptr,
                        &tnWebgpuHandler64
                    , device}}))) return state->engine->newUndefined();
                    // device.createSampler(descriptor?)
                    if (!installBindingTable(state->engine, state, bindingTable({
                        {"GPUDevice", "createSampler", 0, nullptr,
                        &tnWebgpuHandler67
                    , device},
                    // device.createBindGroupLayout(descriptor)
                                            {"GPUDevice", "createBindGroupLayout", 0, nullptr,
                        &tnWebgpuHandler68
                    , device},
                    // device.createBindGroup(descriptor)
                                            {"GPUDevice", "createBindGroup", 0, nullptr,
                        &tnWebgpuHandler69
                    , device},
                    // device.createPipelineLayout(descriptor)
                                            {"GPUDevice", "createPipelineLayout", 0, nullptr,
                        &tnWebgpuHandler70
                    , device},
                    // device.createTextureView(texture, descriptor?) - Non-standard helper
                    // Workaround because texture.createView() can't easily access 'this'
                                            {"GPUDevice", "createTextureView", 0, nullptr,
                        &tnWebgpuHandler71
                    , device},
                    // device.createRenderBundleEncoder(descriptor)
                    // Used by Three.js for mipmap generation
                                            {"GPUDevice", "createRenderBundleEncoder", 0, nullptr,
                        &tnWebgpuHandler72
                    , device}}))) return state->engine->newUndefined();
                    // device.pushErrorScope(filter) - Push an error scope for validation/OOM/internal errors
                    // Used by Three.js for error handling during pipeline creation
                    if (!installBindingTable(state->engine, state, bindingTable({
                        {"GPUDevice", "pushErrorScope", 0, nullptr,
                        &tnWebgpuHandler80
                    , device},
                    // device.popErrorScope() - Pop an error scope and return Promise<GPUError | null>
                    // Returns Promise<GPUError | null>
                                            {"GPUDevice", "popErrorScope", 0, nullptr,
                        &tnWebgpuHandler81
                    , device}}))) return state->engine->newUndefined();
                    // device.lost - Promise that resolves when the device is lost
                    // Required by Three.js WebGPU renderer during init
                    // We create a Promise that never resolves (device never lost in normal operation)
                    auto deviceLostPromise = state->engine->evalWithResult(
                        "new Promise(function(resolve) { globalThis.__mystral_device_lost_resolve = resolve; })",
                        "device.lost"
                    );
                    state->engine->setProperty(device, "lost", deviceLostPromise);
                    // Return the device directly
                    // await on a non-Promise just returns the value
                    return device;
}

static js::JSValueHandle tnWebgpuHandler20(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
            // In native runtime, we already have an adapter, so just return a mock adapter object
            auto adapter = state->engine->newObject();
            // adapter.requestDevice()
            if (!installBindingTable(state->engine, state, bindingTable({
                {"GPUAdapter", "requestDevice", 0, nullptr,
                &tnWebgpuHandler21
            , adapter}}))) return state->engine->newUndefined();
            // adapter.features - Set-like iterable backed by the real adapter feature query
            // Dawn supports indirect-first-instance on Metal which is required for indirect draws
            // with non-zero firstInstance values
            auto features = state->engine->newArray(0);
            auto featuresBindingHost = state->engine->newObject();
            if (!installBindingTable(state->engine, state, bindingTable({
                {"GPUSupportedFeatures", "has", 0, nullptr,
                &tnWebgpuHandler82
            , featuresBindingHost}}))) return state->engine->newUndefined();
            if (!state->engine->setProperty(
                    features,
                    "has",
                    state->engine->getProperty(featuresBindingHost, "has"))) {
                return state->engine->newUndefined();
            }
            state->engine->setProperty(features, "size", state->engine->newNumber(1));
            state->engine->setProperty(adapter, "features", features);
            // adapter.limits
            auto limits = state->engine->newObject();
            state->engine->setProperty(limits, "maxTextureDimension2D", state->engine->newNumber(8192));
            state->engine->setProperty(limits, "maxColorAttachmentBytesPerSample", state->engine->newNumber(64));
            state->engine->setProperty(limits, "maxBindGroups", state->engine->newNumber(4));
            state->engine->setProperty(limits, "maxBindingsPerBindGroup", state->engine->newNumber(1000));
            state->engine->setProperty(limits, "maxUniformBufferBindingSize", state->engine->newNumber(65536));
            state->engine->setProperty(limits, "maxStorageBufferBindingSize", state->engine->newNumber(134217728));
            state->engine->setProperty(limits, "maxSampledTexturesPerShaderStage", state->engine->newNumber(16));
            state->engine->setProperty(limits, "maxSamplersPerShaderStage", state->engine->newNumber(16));
            state->engine->setProperty(limits, "maxStorageTexturesPerShaderStage", state->engine->newNumber(8));
            state->engine->setProperty(limits, "maxUniformBuffersPerShaderStage", state->engine->newNumber(12));
            state->engine->setProperty(limits, "maxStorageBuffersPerShaderStage", state->engine->newNumber(8));
            state->engine->setProperty(limits, "maxDynamicUniformBuffersPerPipelineLayout", state->engine->newNumber(8));
            state->engine->setProperty(adapter, "limits", limits);
            // Return the adapter directly
            // await on a non-Promise just returns the value
            // Three.js: const adapter = await navigator.gpu.requestAdapter()
            // This works whether we return a Promise or the adapter directly
            return adapter;
}

static js::JSValueHandle tnWebgpuHandler19(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
            return args.empty() ? state->engine->newUndefined() : args[0];
}

static js::JSValueHandle tnWebgpuHandler18(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
            return args.empty() ? state->engine->newUndefined() : args[0];
}

static js::JSValueHandle tnWebgpuHandler17(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& a) {
                        // Get dimensions from the main canvas if available
                        auto rect = state->engine->newObject();
                        state->engine->setProperty(rect, "x", state->engine->newNumber(0));
                        state->engine->setProperty(rect, "y", state->engine->newNumber(0));
                        state->engine->setProperty(rect, "width", state->engine->newNumber(state->canvasWidth));
                        state->engine->setProperty(rect, "height", state->engine->newNumber(state->canvasHeight));
                        state->engine->setProperty(rect, "top", state->engine->newNumber(0));
                        state->engine->setProperty(rect, "left", state->engine->newNumber(0));
                        state->engine->setProperty(rect, "right", state->engine->newNumber(state->canvasWidth));
                        state->engine->setProperty(rect, "bottom", state->engine->newNumber(state->canvasHeight));
                        return rect;
}

static js::JSValueHandle tnWebgpuHandler16(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& a) {
                        std::string mimeType = "image/png";
                        if (!a.empty()) {
                            mimeType = state->engine->toString(a[0]);
                        }
                        // Return a minimal data URI (for @loaders.gl WebP detection)
                        if (mimeType.find("webp") != std::string::npos) {
                            return state->engine->newString("data:image/webp;base64,");
                        }
                        return state->engine->newString("data:image/png;base64,");
}

static js::JSValueHandle getOffscreenCanvasContext(
    BindingsState* state,
    int canvasId,
    const std::vector<js::JSValueHandle>& contextArgs) {
                    if (contextArgs.empty()) {
                        return state->engine->newNull();
                    }
                    std::string contextType = state->engine->toString(contextArgs[0]);
                    // Use the captured canvasId to find the correct canvas
                    // This ensures each canvas element's getContext returns its own context
                    auto it = state->offscreenCanvases.find(canvasId);
                    if (it == state->offscreenCanvases.end()) {
                        std::cerr << "[Canvas] Canvas not found: " << canvasId << std::endl;
                        return state->engine->newNull();
                    }
                    OffscreenCanvas* canvas = it->second.get();
                    if (contextType == "2d") {
                        // Return cached context if already created
                        if (canvas->hasContext2d) {
                            return canvas->context2d;
                        }
                        // Get current dimensions from the canvas element (in case they were changed)
                        std::string globalName = "__offscreenCanvas_" + std::to_string(canvasId);
                        auto canvasElement = state->engine->getGlobalProperty(globalName.c_str());
                        if (!state->engine->isNull(canvasElement) && !state->engine->isUndefined(canvasElement)) {
                            auto widthProp = state->engine->getProperty(canvasElement, "width");
                            auto heightProp = state->engine->getProperty(canvasElement, "height");
                            if (!state->engine->isUndefined(widthProp)) {
                                canvas->width = static_cast<int>(state->engine->toNumber(widthProp));
                            }
                            if (!state->engine->isUndefined(heightProp)) {
                                canvas->height = static_cast<int>(state->engine->toNumber(heightProp));
                            }
                        }
                        // Create Canvas 2D context
                        if (state->verboseLogging) std::cout << "[Canvas] Creating offscreen 2D context (" << canvas->width << "x" << canvas->height << ")" << std::endl;
                        canvas->context2d = createOwnedCanvas2DContext(
                            state, canvas->width, canvas->height);
                        canvas->hasContext2d = true;
                        return canvas->context2d;
                    }
                    if (contextType == "webgpu") {
                        // Create GPUCanvasContext for offscreen canvas
                        // This shares the main surface/device for simplicity
                        if (state->verboseLogging) std::cout << "[Canvas] Creating offscreen WebGPU context" << std::endl;
                        // Suspend frame tracking - this context persists across frames
                        state->engine->suspendFrameTracking();
                        auto canvasContext = state->engine->newObject();
                        // Store reference to our surface
                        state->engine->setPrivateData(canvasContext, state->surface);
                        // context.canvas - reference back to canvas element
                        std::string globalName = "__offscreenCanvas_" + std::to_string(canvasId);
                        auto canvasElement = state->engine->getGlobalProperty(globalName.c_str());
                        state->engine->setProperty(canvasContext, "canvas", canvasElement);
                        if (!installCanvasContextBindings(state, canvasContext, true)) {
                            state->engine->resumeFrameTracking();
                            return state->engine->newUndefined();
                        }
                        state->engine->resumeFrameTracking();
                        return canvasContext;
                    }
                    // Ignore webgl requests silently (PixiJS feature detection)
                    if (contextType == "webgl" || contextType == "webgl2" || contextType == "experimental-webgl") {
                        return state->engine->newNull();
                    }
                    std::cerr << "[Canvas] Unsupported context type: " << contextType << std::endl;
                    return state->engine->newNull();
}

static BindingHandler makeOffscreenCanvasGetContextHandler(int canvasId) {
    return [canvasId](BindingsState* state, BindingDestination,
                      const std::vector<js::JSValueHandle>& contextArgs) {
        return getOffscreenCanvasContext(state, canvasId, contextArgs);
    };
}

static js::JSValueHandle tnWebgpuHandler14(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
    const auto mainCanvas = state->engine->getGlobalProperty("canvas");
    const auto element = bindingDestination;
                        const auto request = state->engine->getProperty(mainCanvas, "requestPointerLock");
                        const auto result = state->engine->call(request, mainCanvas, args);
                        const auto document = state->engine->getGlobalProperty("document");
                        state->engine->setProperty(document, "pointerLockElement", element);
                        const auto event = state->engine->newObject();
                        state->engine->setProperty(event, "type", state->engine->newString("pointerlockchange"));
                        const auto dispatch = state->engine->getProperty(document, "dispatchEvent");
                        state->engine->call(dispatch, document, {event});
                        return result;
}

static js::JSValueHandle tnWebgpuHandler13(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
    const auto mainCanvas = state->engine->getGlobalProperty("canvas");
                        const auto dispatch = state->engine->getProperty(mainCanvas, "dispatchEvent");
                        return state->engine->call(dispatch, mainCanvas, args);
}

static js::JSValueHandle tnWebgpuHandler12(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
    const auto mainCanvas = state->engine->getGlobalProperty("canvas");
                        const auto remove = state->engine->getProperty(mainCanvas, "removeEventListener");
                        return state->engine->call(remove, mainCanvas, args);
}

static js::JSValueHandle tnWebgpuHandler11(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
    const auto mainCanvas = state->engine->getGlobalProperty("canvas");
                        const auto add = state->engine->getProperty(mainCanvas, "addEventListener");
                        return state->engine->call(add, mainCanvas, args);
}

static js::JSValueHandle tnWebgpuHandler10(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& a) {
                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler09(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& a) {
                    // No-op in native runtime
                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler08(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& a) {
                    // No-op in native runtime - element is not attached to DOM
                    return state->engine->newUndefined();
}

static js::JSValueHandle tnWebgpuHandler07(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& a) {
                    return a.empty() ? state->engine->newUndefined() : a[0];
}

static js::JSValueHandle tnWebgpuHandler06(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& a) {
                    return a.empty() ? state->engine->newUndefined() : a[0];
}

static js::JSValueHandle tnWebgpuHandler05(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
            auto element = state->engine->newObject();
            // Registration rows retain this handle for callbacks after the creating frame. The
            // JavaScript object is also returned to the caller, so this protection preserves the
            // existing ownership semantics without using a later mutable row property as state.
            protectBindingHandle(state, element);
            // Get tag name if provided
            std::string tagName = "";
            if (!args.empty()) {
                tagName = state->engine->toString(args[0]);
            }
            // Add basic DOM element properties
            state->engine->setProperty(element, "style", state->engine->newObject());
            state->engine->setProperty(element, "className", state->engine->newString(""));
            state->engine->setProperty(element, "innerHTML", state->engine->newString(""));
            state->engine->setProperty(element, "textContent", state->engine->newString(""));
            state->engine->setProperty(element, "tagName", state->engine->newString(tagName.c_str()));
            if (!installBindingTable(state->engine, state, bindingTable({
                {"HTMLElement", "appendChild", 0, nullptr,
                &tnWebgpuHandler06
            , element},
                {"HTMLElement", "removeChild", 0, nullptr,
                &tnWebgpuHandler07
            , element},
                {"HTMLElement", "remove", 0, nullptr,
                &tnWebgpuHandler08
            , element},
                {"HTMLElement", "addEventListener", 0, nullptr,
                &tnWebgpuHandler09
            , element},
                {"HTMLElement", "removeEventListener", 0, nullptr,
                &tnWebgpuHandler10
            , element}}))) {
                unprotectBindingHandle(state, element);
                return state->engine->newUndefined();
            }
            // Special handling for canvas elements - add Canvas 2D support
            if (tagName == "canvas" || tagName == "CANVAS") {
                // Three's renderer creates its surface through document.createElement('canvas'),
                // while the runtime's SDL input dispatches to the main canvas exposed by
                // document.getElementById('canvas'). Forward the event surface so a renderer
                // canvas receives the same pointer and pointer-lock events on native.
                const auto mainCanvas = state->engine->getGlobalProperty("canvas");
                if (!installBindingTable(state->engine, state, bindingTable({
                    {"HTMLCanvasElement", "addEventListener", 0, nullptr,
                    &tnWebgpuHandler11
                , element},
                    {"HTMLCanvasElement", "removeEventListener", 0, nullptr,
                    &tnWebgpuHandler12
                , element},
                    {"HTMLCanvasElement", "dispatchEvent", 0, nullptr,
                    &tnWebgpuHandler13
                , element},
                    {"HTMLCanvasElement", "requestPointerLock", 0, nullptr,
                    &tnWebgpuHandler14
                , element}}))) {
                    unprotectBindingHandle(state, element);
                    return state->engine->newUndefined();
                }
                // Create OffscreenCanvas struct to store state
                int canvasId = state->nextOffscreenCanvasId++;
                auto offscreenCanvas = std::make_unique<OffscreenCanvas>();
                OffscreenCanvas* canvasPtr = offscreenCanvas.get();
                state->offscreenCanvases[canvasId] = std::move(offscreenCanvas);
                // Store the canvas ID as private data for getContext lookup
                state->engine->setPrivateData(element, reinterpret_cast<void*>(static_cast<intptr_t>(canvasId)));
                // Also store as property for debugging
                state->engine->setProperty(element, "_offscreenCanvasId", state->engine->newNumber(canvasId));
                // Default canvas dimensions (stored in struct)
                state->engine->setProperty(element, "width", state->engine->newNumber(canvasPtr->width));
                state->engine->setProperty(element, "height", state->engine->newNumber(canvasPtr->height));
                // Store reference to element globally so getContext can find it
                std::string globalName = "__offscreenCanvas_" + std::to_string(canvasId);
                state->engine->setGlobalProperty(globalName.c_str(), element);
                // Create getContext function
                // Capture canvasId to ensure each canvas element's getContext uses its own canvas
                // This fixes the bug where all canvases shared the same context
                if (!installBindingTable(state->engine, state, bindingTable({
                    {"HTMLCanvasElement", "getContext", 0, nullptr,
                    makeOffscreenCanvasGetContextHandler(canvasId)
                , element}}))) {
                    rollbackOffscreenCanvas(state, canvasId, element);
                    return state->engine->newUndefined();
                }
                if (state->verboseLogging) std::cout << "[Canvas] Created offscreen canvas " << canvasId << std::endl;
                // toDataURL for compatibility (returns empty data URI)
                if (!installBindingTable(state->engine, state, bindingTable({
                    {"HTMLCanvasElement", "toDataURL", 0, nullptr,
                    &tnWebgpuHandler16
                , element},
                // getBoundingClientRect - return canvas dimensions
                    {"HTMLCanvasElement", "getBoundingClientRect", 0, nullptr,
                    &tnWebgpuHandler17
                , element}}))) {
                    rollbackOffscreenCanvas(state, canvasId, element);
                    return state->engine->newUndefined();
                }
            }
            return element;
}

static js::JSValueHandle tnWebgpuHandler04(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
            // Check if querying for canvas
            if (!args.empty()) {
                std::string selector = state->engine->toString(args[0]);
                if (selector == "canvas" || selector.find("canvas") != std::string::npos) {
                    return state->engine->getGlobalProperty("canvas");
                }
            }
            return state->engine->newNull();
}

static js::JSValueHandle tnWebgpuHandler03(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
            if (args.empty()) {
                return state->engine->newNull();
            }
            std::string contextType = state->engine->toString(args[0]);
            // Handle Canvas 2D context
            if (contextType == "2d") {
                if (state->verboseLogging) std::cout << "[Canvas] Creating 2D context (" << state->canvasWidth << "x" << state->canvasHeight << ")" << std::endl;
                auto ctx2d = createOwnedCanvas2DContext(
                    state, state->canvasWidth, state->canvasHeight);
                // Set reference back to canvas
                auto canvas = state->engine->getGlobalProperty("canvas");
                state->engine->setProperty(ctx2d, "canvas", canvas);
                if (state->engine->hasException()) {
                    rollbackOwnedCanvas2DContext(state, ctx2d);
                    return state->engine->newUndefined();
                }
                // Store the native context for Canvas 2D to WebGPU compositing
                state->mainCanvas2DContext = static_cast<canvas::Canvas2DContext*>(state->engine->getPrivateData(ctx2d));
                if (state->verboseLogging) std::cout << "[Canvas] Main canvas using 2D context - will composite to WebGPU" << std::endl;
                return ctx2d;
            }
            if (contextType != "webgpu") {
                std::cerr << "[Canvas] Unknown context type: " << contextType << std::endl;
                return state->engine->newNull();
            }
            // Create GPUCanvasContext
            auto canvasContext = state->engine->newObject();
            // Store reference to our surface
            state->engine->setPrivateData(canvasContext, state->surface);
            // context.canvas - reference back to canvas
            auto canvas = state->engine->getGlobalProperty("canvas");
            state->engine->setProperty(canvasContext, "canvas", canvas);
            if (!installCanvasContextBindings(state, canvasContext, false)) {
                return state->engine->newUndefined();
            }
            if (state->verboseLogging) std::cout << "[Canvas] WebGPU context created" << std::endl;
            return canvasContext;
}

static js::JSValueHandle tnWebgpuHandler02(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
            return args.empty() ? state->engine->newUndefined() : args[0];
}

static js::JSValueHandle tnWebgpuHandler01(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
            // No-op in native runtime
            return args.empty() ? state->engine->newUndefined() : args[0];
}/** Every migrated WebGPU method is a BindingRegistration row in this table unit. */
static js::JSValueHandle tnWebgpuHandler89(BindingsState* state, BindingDestination bindingDestination, const std::vector<js::JSValueHandle>& args) {
    // Read with no argument, set with one. Hz, where 0 means uncapped and is the only way a game
    // presents above the ceiling. `@threenative/core` wraps this as the game-facing name; the
    // global is the host half of the contract and is recorded in shim-manifest.json.
    //
    // Fail closed on a rate the runtime cannot honour: a game that asks for -1 or 5000 has a bug,
    // and silently clamping it would make the next frame-rate measurement a fiction.
    if (args.empty()) return state->engine->newNumber(static_cast<double>(g_presentationCapHz));
    const double requested = state->engine->toNumber(args[0]);
    const int32_t hz = static_cast<int32_t>(requested);
    if (!(requested >= 0.0) || requested > 1000.0 || static_cast<double>(hz) != requested) {
        state->engine->throwException(
            "TN_PRESENTATION_CAP_INVALID: the presentation cap is a whole number of frames "
            "per second between 0 (uncapped) and 1000.");
        return state->engine->newUndefined();
    }
    g_presentationCapHz = static_cast<uint32_t>(hz);
    g_nextPresentDeadline = std::chrono::steady_clock::time_point{};
    return state->engine->newNumber(static_cast<double>(g_presentationCapHz));
}

static bool installWebGPUBindingTables(BindingsState* state, js::Engine* engine) {
    const auto globalBindingHost = engine->newObject();
    engine->freezeHandle(globalBindingHost);
    struct GlobalBindingHostProtection {
        js::Engine* engine;
        js::JSValueHandle value;
        ~GlobalBindingHostProtection() {
            if (value.ptr) engine->freeHandle(value);
        }
    } globalBindingHostProtection{engine, globalBindingHost};
    const auto copyGlobalBinding = [&](js::JSValueHandle host, const char* name) {
        const auto binding = engine->getProperty(host, name);
        if (engine->hasException()) return false;
        if (!engine->isFunction(binding)) {
            const std::string message =
                std::string("WebGPU global binding was not installed: ") + name;
            engine->throwException(message.c_str());
            return false;
        }
        if (engine->setGlobalProperty(name, binding) && !engine->hasException()) {
            return true;
        }
        if (!engine->hasException()) {
            const std::string message =
                std::string("WebGPU global binding copy failed: ") + name;
            engine->throwException(message.c_str());
        }
        return false;
    };

    // ========================================================================
    // Create a mock parent element for the canvas (needed by Debugger)
    // ========================================================================
    auto parentElement = engine->newObject();
    engine->setProperty(parentElement, "style", engine->newObject());
    if (!installBindingTable(state->engine, state, bindingTable({
        {"HTMLElement", "appendChild", 0, nullptr,
        &tnWebgpuHandler01
    , parentElement},
        {"HTMLElement", "removeChild", 0, nullptr,
        &tnWebgpuHandler02
    , parentElement}}))) return false;

    // ========================================================================
    // Get existing canvas from runtime.cpp's document.getElementById
    // The canvas was created by setupDOMEvents() with addEventListener, style, etc.
    // We just need to add WebGPU-specific methods (getContext) to it.
    // ========================================================================
    auto existingDocument = engine->getGlobalProperty("document");
    auto getElementByIdFunc = engine->getProperty(existingDocument, "getElementById");

    // Call document.getElementById('canvas') to get the existing canvas
    std::vector<js::JSValueHandle> args;
    args.push_back(engine->newString("canvas"));
    auto canvasObject = engine->call(getElementByIdFunc, existingDocument, args);

    if (engine->isNull(canvasObject) || engine->isUndefined(canvasObject)) {
        std::cerr << "[WebGPU] Warning: No existing canvas found, creating new one" << std::endl;
        canvasObject = engine->newObject();
        engine->setProperty(canvasObject, "width", engine->newNumber(state->canvasWidth));
        engine->setProperty(canvasObject, "height", engine->newNumber(state->canvasHeight));
        engine->setProperty(canvasObject, "clientWidth", engine->newNumber(state->canvasWidth));
        engine->setProperty(canvasObject, "clientHeight", engine->newNumber(state->canvasHeight));
    }

    // Update canvas dimensions (in case they differ)
    engine->setProperty(canvasObject, "width", engine->newNumber(state->canvasWidth));
    engine->setProperty(canvasObject, "height", engine->newNumber(state->canvasHeight));
    engine->setProperty(canvasObject, "clientWidth", engine->newNumber(state->canvasWidth));
    engine->setProperty(canvasObject, "clientHeight", engine->newNumber(state->canvasHeight));

    // canvas.parentElement - mock parent element (for Debugger compatibility)
    engine->setProperty(canvasObject, "parentElement", parentElement);

    // canvas.getContext('webgpu') -> GPUCanvasContext
    // This is the WebGPU-specific method we add to the existing canvas
    if (!installBindingTable(state->engine, state, bindingTable({
        {"HTMLCanvasElement", "getContext", 0, nullptr,
        &tnWebgpuHandler03
    , canvasObject}}))) return false;

    // Set global canvas - this is the SAME object as document.getElementById('canvas')
    // so it now has both WebGPU getContext AND event listener support
    engine->setGlobalProperty("canvas", canvasObject);

    // ========================================================================
    // Add missing methods to the existing document (from runtime.cpp)
    // We DON'T create a new document - just augment the existing one
    // ========================================================================

    // Add querySelector to existing document (if not present)
    if (!installBindingTable(state->engine, state, bindingTable({
        {"Document", "querySelector", 0, nullptr,
        &tnWebgpuHandler04
    , existingDocument},

    // Add createElement to existing document
    // NOTE: runtime.cpp sets up a createElement with canvas support (toDataURL) for @loaders.gl WebP detection
    // We ALWAYS override it here to add proper Canvas 2D support for offscreen canvases
        {"Document", "createElement", 0, nullptr,
        &tnWebgpuHandler05
    , existingDocument}}))) return false;

    // Add document.body if not present, or enhance existing body with required methods
    auto existingBody = engine->getProperty(existingDocument, "body");
    if (engine->isUndefined(existingBody) || engine->isNull(existingBody)) {
        existingBody = engine->newObject();
        engine->setProperty(existingDocument, "body", existingBody);
    }
    // Always add/update these methods on body
    engine->setProperty(existingBody, "style", engine->newObject());
    if (!installBindingTable(state->engine, state, bindingTable({
        {"HTMLElement", "appendChild", 0, nullptr,
        &tnWebgpuHandler18
    , existingBody},
        {"HTMLElement", "removeChild", 0, nullptr,
        &tnWebgpuHandler19
    , existingBody}}))) return false;

    // ========================================================================
    // Navigator object
    // ========================================================================
    auto navigatorHandle = engine->getGlobalProperty("navigator");
    if (engine->isUndefined(navigatorHandle)) {
        navigatorHandle = engine->newObject();
        engine->setGlobalProperty("navigator", navigatorHandle);
    }

    // Add common navigator properties for browser compatibility
    // PixiJS and other libraries check these for feature detection
    engine->setProperty(navigatorHandle, "userAgent",
        engine->newString("Mozilla/5.0 (Macintosh; MystralNative/0.1) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"));
    engine->setProperty(navigatorHandle, "platform", engine->newString("MystralNative"));
    engine->setProperty(navigatorHandle, "vendor", engine->newString("Mystral Engine"));
    engine->setProperty(navigatorHandle, "language", engine->newString("en-US"));
    engine->setProperty(navigatorHandle, "languages", engine->newArray(1));  // ["en-US"]
    engine->setProperty(navigatorHandle, "onLine", engine->newBoolean(true));
    engine->setProperty(navigatorHandle, "hardwareConcurrency", engine->newNumber(8));
    engine->setProperty(navigatorHandle, "maxTouchPoints", engine->newNumber(0));

    // Create navigator.gpu object
    auto gpuObject = engine->newObject();

    // ========================================================================
    // navigator.gpu.requestAdapter()
    // ========================================================================
    if (!installBindingTable(state->engine, state, bindingTable({
        {"GPU", "requestAdapter", 0, nullptr,
        &tnWebgpuHandler20
    , gpuObject}}))) return false;

    // navigator.gpu.getPreferredCanvasFormat()
    if (!installBindingTable(state->engine, state, bindingTable({
        {"GPU", "getPreferredCanvasFormat", 0, nullptr,
        &tnWebgpuHandler83
    , gpuObject}}))) return false;

    // Set navigator.gpu
    engine->setProperty(navigatorHandle, "gpu", gpuObject);

    // ========================================================================
    // GPU Usage Constants
    // ========================================================================
    auto gpuBufferUsage = engine->newObject();
    engine->setProperty(gpuBufferUsage, "MAP_READ", engine->newNumber(0x0001));
    engine->setProperty(gpuBufferUsage, "MAP_WRITE", engine->newNumber(0x0002));
    engine->setProperty(gpuBufferUsage, "COPY_SRC", engine->newNumber(0x0004));
    engine->setProperty(gpuBufferUsage, "COPY_DST", engine->newNumber(0x0008));
    engine->setProperty(gpuBufferUsage, "INDEX", engine->newNumber(0x0010));
    engine->setProperty(gpuBufferUsage, "VERTEX", engine->newNumber(0x0020));
    engine->setProperty(gpuBufferUsage, "UNIFORM", engine->newNumber(0x0040));
    engine->setProperty(gpuBufferUsage, "STORAGE", engine->newNumber(0x0080));
    engine->setProperty(gpuBufferUsage, "INDIRECT", engine->newNumber(0x0100));
    engine->setProperty(gpuBufferUsage, "QUERY_RESOLVE", engine->newNumber(0x0200));
    engine->setGlobalProperty("GPUBufferUsage", gpuBufferUsage);

    auto gpuTextureUsage = engine->newObject();
    engine->setProperty(gpuTextureUsage, "COPY_SRC", engine->newNumber(0x01));
    engine->setProperty(gpuTextureUsage, "COPY_DST", engine->newNumber(0x02));
    engine->setProperty(gpuTextureUsage, "TEXTURE_BINDING", engine->newNumber(0x04));
    engine->setProperty(gpuTextureUsage, "STORAGE_BINDING", engine->newNumber(0x08));
    engine->setProperty(gpuTextureUsage, "RENDER_ATTACHMENT", engine->newNumber(0x10));
    engine->setGlobalProperty("GPUTextureUsage", gpuTextureUsage);

    auto gpuShaderStage = engine->newObject();
    engine->setProperty(gpuShaderStage, "VERTEX", engine->newNumber(0x1));
    engine->setProperty(gpuShaderStage, "FRAGMENT", engine->newNumber(0x2));
    engine->setProperty(gpuShaderStage, "COMPUTE", engine->newNumber(0x4));
    engine->setGlobalProperty("GPUShaderStage", gpuShaderStage);

    auto gpuMapMode = engine->newObject();
    engine->setProperty(gpuMapMode, "READ", engine->newNumber(0x1));
    engine->setProperty(gpuMapMode, "WRITE", engine->newNumber(0x2));
    engine->setGlobalProperty("GPUMapMode", gpuMapMode);

    // =========================================================================
    // createImageBitmap() - Standard Web API for image decoding
    // =========================================================================
    // createImageBitmap(source) -> Promise<ImageBitmap>
    // source can be: Blob, ArrayBuffer, or object with arrayBuffer() method
    // Returns ImageBitmap with: width, height, close(), and internal pixel data
    //
    // Note: PNG/JPEG supported via stb_image. WebP supported via libwebp (when MYSTRAL_HAS_WEBP defined).

    // The presentation ceiling's named override (PRD-218).
    if (!installBindingTable(state->engine, state, bindingTable({
        {"WebGPU", "__tnPresentationCap", 0, nullptr,
        &tnWebgpuHandler89
    , globalBindingHost}})) ||
        !copyGlobalBinding(globalBindingHost, "__tnPresentationCap")) return false;

    // Native helper that decodes image data synchronously
    if (!installBindingTable(state->engine, state, bindingTable({
        {"WebGPU", "__decodeImageData", 0, nullptr,
        &tnWebgpuHandler84
    , globalBindingHost}})) ||
        !copyGlobalBinding(globalBindingHost, "__decodeImageData")) return false;

    // JavaScript polyfill for createImageBitmap
    if (!evalEmbeddedRuntimeScript(*engine, "image-bitmap-polyfill", "image-bitmap-polyfill.js")) {
        return false;
    }

    auto mystralNamespace = engine->newObject();

    engine->setGlobalProperty("Mystral", mystralNamespace);

    // ========================================================================
    // Native helper for offscreen canvas getContext('2d')
    // Called by the JS closure created in createElement('canvas')
    // ========================================================================
    if (!installBindingTable(state->engine, state, bindingTable({
        {"WebGPU", "__nativeGetContext2D", 0, nullptr,
        &tnWebgpuHandler86
    , globalBindingHost},

    // ========================================================================
    // Global createOffscreenCanvas2D(width, height) helper
    // Creates an offscreen canvas with a 2D context at the specified size
    // This is easier to use than document.createElement('canvas').getContext('2d')
    // since it handles dimensions correctly
    // ========================================================================
            {"WebGPU", "createOffscreenCanvas2D", 0, nullptr,
        &tnWebgpuHandler87
    , globalBindingHost}})) ||
        !copyGlobalBinding(globalBindingHost, "__nativeGetContext2D") ||
        !copyGlobalBinding(globalBindingHost, "createOffscreenCanvas2D")) return false;


    if (state->verboseLogging) {
        std::cout << "[WebGPU] JavaScript bindings initialized" << std::endl;
        std::cout << "[WebGPU] createImageBitmap() available for image decoding" << std::endl;
    }

    return true;

}
#endif

/** Initialize WebGPU bindings in the JS engine. */
bool initBindings(BindingsState* state, js::Engine* engine, void* wgpuInstance, void* wgpuDevice, void* wgpuQueue, void* wgpuSurface, uint32_t surfaceFormat, uint32_t presentMode, uint32_t width, uint32_t height, bool debug, void* wgpuAdapter) {
    if (!state || !engine) {
        std::cerr << "[WebGPU] No JS engine provided for bindings" << std::endl;
        return false;
    }

#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)
    // Set verbose logging based on debug flag
    state->verboseLogging = debug;

    state->engine = engine;
    state->instance = (WGPUInstance)wgpuInstance;
    state->device = (WGPUDevice)wgpuDevice;
    state->adapter = (WGPUAdapter)wgpuAdapter;
    state->queue = (WGPUQueue)wgpuQueue;
    state->surface = (WGPUSurface)wgpuSurface;
    state->presentMode = static_cast<WGPUPresentMode>(presentMode);

    // Set canvas dimensions from window size
    state->canvasWidth = width;
    state->canvasHeight = height;
    state->nativeSurfaceFormat = (WGPUTextureFormat)surfaceFormat;
    state->requiresSrgbPresentationBridge =
        state->surface != nullptr && isSrgbSurfaceFormat(state->nativeSurfaceFormat);
    state->surfaceFormat = state->requiresSrgbPresentationBridge
        ? linearSurfaceFormat(state->nativeSurfaceFormat)
        : state->nativeSurfaceFormat;

    if (state->verboseLogging) {
        std::cout << "[WebGPU] Initializing JavaScript bindings..." << std::endl;
        std::cout << "[WebGPU] Native surface format: " << surfaceFormat
                  << ", canvas format: " << state->surfaceFormat
                  << ", sRGB presentation bridge: "
                  << (state->requiresSrgbPresentationBridge ? "enabled" : "disabled") << std::endl;
    }

    return installWebGPUBindingSurfaces(state, engine);
#else
    std::cerr << "[WebGPU] No WebGPU backend available" << std::endl;
    return true;
#endif
}

// Getter for current texture (used by screenshot)
void* getCurrentRenderedTexture(BindingsState* state) {
#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)
    return state->currentTexture;
#else
    return nullptr;
#endif
}

uint32_t getCurrentTextureWidth(BindingsState* state) {
    return state->canvasWidth;
}

uint32_t getCurrentTextureHeight(BindingsState* state) {
    return state->canvasHeight;
}

void* getCurrentSurfaceTexture(BindingsState* state) {
#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)
    // Return the texture that the current view was created from (for screenshots)
    // or the current texture if no view was created yet
    return state->currentViewSourceTexture ? state->currentViewSourceTexture : state->currentTexture;
#else
    return nullptr;
#endif
}

// Screenshot buffer access
void* getScreenshotBuffer(BindingsState* state) {
#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)
    return state->screenshotBuffer;
#else
    return nullptr;
#endif
}

size_t getScreenshotBufferSize(BindingsState* state) {
    return state->screenshotBufferSize;
}

uint32_t getScreenshotBytesPerRow(BindingsState* state) {
    return state->screenshotBytesPerRow;
}

uint32_t getScreenshotFormat(BindingsState* state) {
    return static_cast<uint32_t>(state->surfaceFormat);
}

uint64_t presentCount(BindingsState* state) {
    return state->presentCount;
}

bool isScreenshotReady(BindingsState* state) {
    return state->screenshotReady;
}

void clearScreenshotReady(BindingsState* state) {
    state->screenshotReady = false;
}

void requestFrameScreenshot(BindingsState* state) {
    state->screenshotRequested = true;
}

/**
 * Drops every reference to the live presentation surface, ahead of a rebuild.
 *
 * Android destroys the `ANativeWindow` behind a backgrounded app, so on resume the surface is
 * replaced rather than reconfigured. Any swapchain image acquired and not yet presented has to be
 * released first: wgpu-native refuses to tear a surface down with an outstanding `SurfaceOutput`
 * ("`SurfaceOutput` must be dropped before a new `Surface` is made") and that panic aborts the
 * process, which is how PRD-183's silent SIGABRT happened on the resize path.
 */
void detachSurfaceForRebuild(BindingsState* state) {
#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)
    if (!state) return;
    state->framePresentPending = false;
    if (state->currentTextureView != nullptr) {
        wgpuTextureViewRelease(state->currentTextureView);
        state->currentTextureView = nullptr;
    }
    if (state->currentSurfaceTextureId != 0) {
        state->textureRegistry.erase(state->currentSurfaceTextureId);
        state->currentSurfaceTextureId = 0;
    }
    if (state->currentTexture != nullptr) {
        wgpuTextureRelease(state->currentTexture);
        state->currentTexture = nullptr;
    }
    state->currentViewSourceTexture = nullptr;
    state->surfaceRenderEncoder = nullptr;
    state->surfaceRenderPassEnded = false;
    state->screenshotCapturedThisFrame = false;
    state->surface = nullptr;
#else
    (void)state;
#endif
}

/**
 * Publishes a rebuilt surface to the bindings, which is where every present reads it from.
 *
 * Without this the host would hold a fresh surface and JavaScript would keep presenting to the
 * dead one: the resume defect again, one indirection later.
 */
void republishSurface(BindingsState* state, void* wgpuSurface, uint32_t surfaceFormat,
                      uint32_t presentMode, uint32_t width, uint32_t height) {
#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)
    if (!state) return;
    state->surface = (WGPUSurface)wgpuSurface;
    state->presentMode = static_cast<WGPUPresentMode>(presentMode);
    state->nativeSurfaceFormat = (WGPUTextureFormat)surfaceFormat;
    state->requiresSrgbPresentationBridge =
        state->surface != nullptr && isSrgbSurfaceFormat(state->nativeSurfaceFormat);
    state->surfaceFormat = state->requiresSrgbPresentationBridge
        ? linearSurfaceFormat(state->nativeSurfaceFormat)
        : state->nativeSurfaceFormat;
    // The same pairing startup makes: the canvas dimensions name the size the surface is
    // configured at, so `syncSurfaceSizeToCanvas` reconfigures on the next frame if the game is
    // rendering at a different one.
    state->canvasWidth = width;
    state->canvasHeight = height;
    std::cout << "[WebGPU] Surface republished to bindings: " << wgpuSurface << " " << width << "x"
              << height << " (format=" << state->surfaceFormat << ")" << std::endl;
#else
    (void)state; (void)wgpuSurface; (void)surfaceFormat; (void)presentMode; (void)width; (void)height;
#endif
}

void setOffscreenTexture(BindingsState* state, void* texture, void* textureView) {
    state->offscreenTexture = (WGPUTexture)texture;
    state->offscreenTextureView = (WGPUTextureView)textureView;
    if (state->verboseLogging) std::cout << "[WebGPU] Offscreen texture set for headless rendering" << std::endl;
}

void beginDawnFrame(BindingsState* state) {
    // The launch stall is measured from here: this is the first instant the loop is inside a
    // frame rather than still loading, so everything after it and before the first present is the
    // gap the player watches a frozen loading screen through. PRD-218.
    mystral::stallBudget().markFirstFrameBegan();

    // Otherwise a no-op: Dawn resource cleanup is handled by V8 weak callbacks
    // via Engine::registerRelease() — resources are released when
    // their JS wrapper objects are garbage collected.
}

// Canvas 2D compositing resources live in BindingsState.
void compositeCanvas2DToWebGPU(BindingsState* state) {
    if (!state->mainCanvas2DContext || !state->device || !state->queue || !state->surface) {
        return;
    }

    // Get Canvas 2D pixel data
    const uint8_t* pixelData = state->mainCanvas2DContext->getPixelData();
    size_t pixelDataSize = state->mainCanvas2DContext->getPixelDataSize();
    int width = state->mainCanvas2DContext->getWidth();
    int height = state->mainCanvas2DContext->getHeight();

    if (!pixelData || pixelDataSize == 0) {
        return;
    }

    // Create or resize texture if needed
    if (!state->canvas2DTexture || state->canvas2DTextureWidth != (uint32_t)width || state->canvas2DTextureHeight != (uint32_t)height) {
        if (state->canvas2DTexture) {
            wgpuTextureDestroy(state->canvas2DTexture);
            wgpuTextureRelease(state->canvas2DTexture);
        }
        if (state->canvas2DBindGroup) {
            wgpuBindGroupRelease(state->canvas2DBindGroup);
            state->canvas2DBindGroup = nullptr;
        }

        WGPUTextureDescriptor texDesc = {};
        texDesc.size = {(uint32_t)width, (uint32_t)height, 1};
        texDesc.mipLevelCount = 1;
        texDesc.sampleCount = 1;
        texDesc.dimension = WGPUTextureDimension_2D;
        texDesc.format = WGPUTextureFormat_RGBA8Unorm;
        texDesc.usage = WGPUTextureUsage_TextureBinding | WGPUTextureUsage_CopyDst;

        state->canvas2DTexture = wgpuDeviceCreateTexture(state->device, &texDesc);
        // Host-side path: there is no JS frame to throw into, so skip the composite rather than
        // write pixels through a NULL texture. The next frame retries.
        if (!requireHandleHostSide(state->canvas2DTexture, "canvas2D.createTexture",
                                   std::to_string(width) + "x" + std::to_string(height)))
            return;
        state->canvas2DTextureWidth = width;
        state->canvas2DTextureHeight = height;
    }

    // Upload pixel data to texture
    WGPUImageCopyTexture_Compat destTexture = {};
    destTexture.texture = state->canvas2DTexture;
    destTexture.mipLevel = 0;
    destTexture.origin = {0, 0, 0};
    destTexture.aspect = WGPUTextureAspect_All;

    WGPUTextureDataLayout_Compat dataLayout = {};
    dataLayout.offset = 0;
    dataLayout.bytesPerRow = width * 4;
    dataLayout.rowsPerImage = height;

    WGPUExtent3D writeSize = {(uint32_t)width, (uint32_t)height, 1};
    wgpuQueueWriteTexture(state->queue, &destTexture, pixelData, pixelDataSize, &dataLayout, &writeSize);

    // Create pipeline if needed
    if (!state->canvas2DPipeline) {
        // Simple fullscreen quad shader
        const char* shaderCode = R"(
            @group(0) @binding(0) var texSampler: sampler;
            @group(0) @binding(1) var tex: texture_2d<f32>;

            struct VertexOutput {
                @builtin(position) position: vec4f,
                @location(0) uv: vec2f,
            }

            @vertex
            fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
                var positions = array<vec2f, 6>(
                    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
                );
                var uvs = array<vec2f, 6>(
                    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
                    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
                );
                var output: VertexOutput;
                output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
                output.uv = uvs[vertexIndex];
                return output;
            }

            @fragment
            fn fs_main(input: VertexOutput) -> @location(0) vec4f {
                return textureSample(tex, texSampler, input.uv);
            }
        )";

        WGPUShaderModuleWGSLDescriptor_Compat wgslDesc = {};
        WGPUShaderModuleDescriptor shaderDesc = {};
        setupShaderModuleWGSL(&shaderDesc, &wgslDesc, shaderCode);

        WGPUShaderModule shaderModule = wgpuDeviceCreateShaderModule(state->device, &shaderDesc);

        // Create sampler
        WGPUSamplerDescriptor samplerDesc = {};
        samplerDesc.magFilter = WGPUFilterMode_Linear;
        samplerDesc.minFilter = WGPUFilterMode_Linear;
        samplerDesc.mipmapFilter = WGPUMipmapFilterMode_Linear;
        samplerDesc.addressModeU = WGPUAddressMode_ClampToEdge;
        samplerDesc.addressModeV = WGPUAddressMode_ClampToEdge;
        samplerDesc.addressModeW = WGPUAddressMode_ClampToEdge;
        samplerDesc.maxAnisotropy = 1;
        samplerDesc.lodMinClamp = 0.0f;
        samplerDesc.lodMaxClamp = 1.0f;
        state->canvas2DSampler = wgpuDeviceCreateSampler(state->device, &samplerDesc);

        // Create bind group layout
        WGPUBindGroupLayoutEntry bgLayoutEntries[2] = {};
        bgLayoutEntries[0].binding = 0;
        bgLayoutEntries[0].visibility = WGPUShaderStage_Fragment;
        bgLayoutEntries[0].sampler.type = WGPUSamplerBindingType_Filtering;
        bgLayoutEntries[1].binding = 1;
        bgLayoutEntries[1].visibility = WGPUShaderStage_Fragment;
        bgLayoutEntries[1].texture.sampleType = WGPUTextureSampleType_Float;
        bgLayoutEntries[1].texture.viewDimension = WGPUTextureViewDimension_2D;

        WGPUBindGroupLayoutDescriptor bgLayoutDesc = {};
        bgLayoutDesc.entryCount = 2;
        bgLayoutDesc.entries = bgLayoutEntries;
        WGPUBindGroupLayout bgLayout = wgpuDeviceCreateBindGroupLayout(state->device, &bgLayoutDesc);

        // Create pipeline layout
        WGPUPipelineLayoutDescriptor pipelineLayoutDesc = {};
        pipelineLayoutDesc.bindGroupLayoutCount = 1;
        pipelineLayoutDesc.bindGroupLayouts = &bgLayout;
        WGPUPipelineLayout pipelineLayout = wgpuDeviceCreatePipelineLayout(state->device, &pipelineLayoutDesc);

        // Create pipeline
        WGPURenderPipelineDescriptor pipelineDesc = {};
        pipelineDesc.layout = pipelineLayout;
        pipelineDesc.vertex.module = shaderModule;
        WGPU_SET_ENTRY_POINT(pipelineDesc.vertex, "vs_main");

        WGPUFragmentState fragmentState = {};
        fragmentState.module = shaderModule;
        WGPU_SET_ENTRY_POINT(fragmentState, "fs_main");
        fragmentState.targetCount = 1;

        WGPUColorTargetState colorTarget = {};
        colorTarget.format = state->nativeSurfaceFormat;
        colorTarget.writeMask = WGPUColorWriteMask_All;
        fragmentState.targets = &colorTarget;

        pipelineDesc.fragment = &fragmentState;
        pipelineDesc.primitive.topology = WGPUPrimitiveTopology_TriangleList;
        pipelineDesc.multisample.count = 1;
        pipelineDesc.multisample.mask = 0xFFFFFFFF;

        state->canvas2DPipeline = wgpuDeviceCreateRenderPipeline(state->device, &pipelineDesc);

        wgpuShaderModuleRelease(shaderModule);
        wgpuPipelineLayoutRelease(pipelineLayout);
        wgpuBindGroupLayoutRelease(bgLayout);

        if (!state->canvas2DPipeline) {
            std::cerr << "[Canvas2D] Failed to create compositing pipeline" << std::endl;
            return;
        }
    }

    // Create bind group (recreate if texture changed)
    if (!state->canvas2DBindGroup) {
        if (!state->canvas2DSampler || !state->canvas2DTexture) {
            return;
        }

        WGPUTextureViewDescriptor viewDesc = {};
        viewDesc.format = WGPUTextureFormat_RGBA8Unorm;
        viewDesc.dimension = WGPUTextureViewDimension_2D;
        viewDesc.baseMipLevel = 0;
        viewDesc.mipLevelCount = 1;
        viewDesc.baseArrayLayer = 0;
        viewDesc.arrayLayerCount = 1;
        WGPUTextureView texView = wgpuTextureCreateView(state->canvas2DTexture, &viewDesc);

        if (!texView) {
            return;
        }

        WGPUBindGroupEntry bgEntries[2] = {};
        bgEntries[0].binding = 0;
        bgEntries[0].sampler = state->canvas2DSampler;
        bgEntries[1].binding = 1;
        bgEntries[1].textureView = texView;

        WGPUBindGroupLayout layout = wgpuRenderPipelineGetBindGroupLayout(state->canvas2DPipeline, 0);
        if (!layout) {
            wgpuTextureViewRelease(texView);
            return;
        }

        WGPUBindGroupDescriptor bgDesc = {};
        bgDesc.layout = layout;
        bgDesc.entryCount = 2;
        bgDesc.entries = bgEntries;
        state->canvas2DBindGroup = wgpuDeviceCreateBindGroup(state->device, &bgDesc);

        wgpuBindGroupLayoutRelease(layout);
        wgpuTextureViewRelease(texView);

        if (!state->canvas2DBindGroup) {
            return;
        }
    }

    // Get surface texture
    WGPUSurfaceTexture surfaceTexture;
    wgpuSurfaceGetCurrentTexture(state->surface, &surfaceTexture);
    if (!wgpuSurfaceTextureStatusIsSuccess(surfaceTexture.status)) {
        return;
    }

    WGPUTextureViewDescriptor surfaceViewDesc = {};
    surfaceViewDesc.format = state->nativeSurfaceFormat;
    surfaceViewDesc.dimension = WGPUTextureViewDimension_2D;
    surfaceViewDesc.baseMipLevel = 0;
    surfaceViewDesc.mipLevelCount = 1;
    surfaceViewDesc.baseArrayLayer = 0;
    surfaceViewDesc.arrayLayerCount = 1;
    WGPUTextureView surfaceView = wgpuTextureCreateView(surfaceTexture.texture, &surfaceViewDesc);
    // A surface whose window was released underneath us hands back NULL here. Compositing on
    // through it is the "present into a released window" fault this pass exists to remove.
    if (!requireHandleHostSide(surfaceView, "canvas2DComposite.surfaceView")) return;

    // Create command encoder and render pass
    WGPUCommandEncoderDescriptor encDesc = {};
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(state->device, &encDesc);
    if (!requireHandleHostSide(encoder, "canvas2DComposite.createCommandEncoder")) {
        wgpuTextureViewRelease(surfaceView);
        return;
    }

    WGPURenderPassColorAttachment colorAttachment = {};
    colorAttachment.view = surfaceView;
    colorAttachment.loadOp = WGPULoadOp_Clear;
    colorAttachment.storeOp = WGPUStoreOp_Store;
    colorAttachment.clearValue = {0.0, 0.0, 0.0, 1.0};
#if defined(MYSTRAL_WEBGPU_DAWN)
    colorAttachment.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
#endif

    WGPURenderPassDescriptor renderPassDesc = {};
    renderPassDesc.colorAttachmentCount = 1;
    renderPassDesc.colorAttachments = &colorAttachment;

    WGPURenderPassEncoder renderPass = wgpuCommandEncoderBeginRenderPass(encoder, &renderPassDesc);
    if (!requireHandleHostSide(renderPass, "canvas2DComposite.beginRenderPass")) {
        wgpuCommandEncoderRelease(encoder);
        wgpuTextureViewRelease(surfaceView);
        return;
    }
    wgpuRenderPassEncoderSetPipeline(renderPass, state->canvas2DPipeline);
    wgpuRenderPassEncoderSetBindGroup(renderPass, 0, state->canvas2DBindGroup, 0, nullptr);
    wgpuRenderPassEncoderDraw(renderPass, 6, 1, 0, 0);
    wgpuRenderPassEncoderEnd(renderPass);
    wgpuRenderPassEncoderRelease(renderPass);

    // Copy rendered texture to screenshot buffer
    uint32_t bytesPerRow = ((state->canvasWidth * 4 + 255) / 256) * 256;  // Align to 256
    size_t requiredSize = bytesPerRow * state->canvasHeight;

    if (!state->screenshotBuffer || state->screenshotBufferSize < requiredSize) {
        if (state->screenshotBuffer) {
            wgpuBufferDestroy(state->screenshotBuffer);
            wgpuBufferRelease(state->screenshotBuffer);
        }

        WGPUBufferDescriptor bufferDesc = {};
        bufferDesc.size = requiredSize;
        bufferDesc.usage = WGPUBufferUsage_CopyDst | WGPUBufferUsage_MapRead;
        bufferDesc.mappedAtCreation = false;

        state->screenshotBuffer = wgpuDeviceCreateBuffer(state->device, &bufferDesc);
        state->screenshotBufferSize = requiredSize;
        state->screenshotBytesPerRow = bytesPerRow;
    }

    // Copy surface texture to screenshot buffer
    WGPUImageCopyTexture_Compat srcCopy = {};
    srcCopy.texture = surfaceTexture.texture;
    srcCopy.mipLevel = 0;
    srcCopy.origin = {0, 0, 0};
    srcCopy.aspect = WGPUTextureAspect_All;

    WGPUImageCopyBuffer_Compat dstCopy = {};
    dstCopy.buffer = state->screenshotBuffer;
    dstCopy.layout.offset = 0;
    dstCopy.layout.bytesPerRow = bytesPerRow;
    dstCopy.layout.rowsPerImage = state->canvasHeight;

    WGPUExtent3D copySize = {state->canvasWidth, state->canvasHeight, 1};
    wgpuCommandEncoderCopyTextureToBuffer_Compat(encoder, &srcCopy, &dstCopy, &copySize);

    WGPUCommandBufferDescriptor cmdDesc = {};
    WGPUCommandBuffer cmdBuffer = wgpuCommandEncoderFinish(encoder, &cmdDesc);
    if (!requireHandleHostSide(cmdBuffer, "canvas2DComposite.finish")) {
        wgpuCommandEncoderRelease(encoder);
        wgpuTextureViewRelease(surfaceView);
        return;
    }
    wgpuQueueSubmit(state->queue, 1, &cmdBuffer);

    wgpuCommandBufferRelease(cmdBuffer);
    wgpuCommandEncoderRelease(encoder);
    wgpuTextureViewRelease(surfaceView);

    // Present
    wgpuSurfacePresent(state->surface);

    // Track for screenshot
    state->currentTexture = surfaceTexture.texture;
    state->screenshotReady = true;
}

// ============================================================================
// Video capture callback support (used by GPUReadbackRecorder)
// ============================================================================

// Video capture callback - called when queue.submit happens with a surface texture
// This allows the video recorder to capture frames without modifying the render loop
void setVideoCaptureCallback(BindingsState* state, void (*callback)(void* texture, uint32_t width, uint32_t height, void* userData), void* userData) {
    state->videoCaptureCallback = callback;
    state->videoCaptureUserData = userData;
}

void clearVideoCaptureCallback(BindingsState* state) {
    state->videoCaptureCallback = nullptr;
    state->videoCaptureUserData = nullptr;
}

// Internal function to invoke video capture callback (called from queue.submit)
void invokeVideoCaptureCallback(BindingsState* state, WGPUTexture texture, uint32_t width, uint32_t height) {
    if (state->videoCaptureCallback && texture) {
        state->videoCaptureCallback(static_cast<void*>(texture), width, height, state->videoCaptureUserData);
    }
}

/**
 * Copies the finished frame into the screenshot buffer.
 *
 * This used to run inside `queue.submit`, on the first submit whose surface pass had ended. A
 * frame that renders an overlay submits twice, so the capture happened after the world pass and
 * before the overlay — every native screenshot was of a half-finished frame, and any gate reading
 * one could not see an overlay at all. It now runs at the frame boundary, with everything drawn.
 */
static void captureFrameScreenshot(BindingsState* state) {
    // Copy texture to screenshot buffer ONLY when about to present
    // This prevents capturing intermediate render passes (e.g., Three.js post-processing)
    // Only capture when the surface render pass has ended, matching the present condition
    // Also ensure we only capture once per frame (Three.js does multiple queue.submit() per frame)
    WGPUTexture screenshotTexture = state->currentViewSourceTexture ? state->currentViewSourceTexture : state->currentTexture;
    // Requested only: a frame nobody asked to capture performs no copy and pays none of the
    // completion wait below. Consumers raise the flag via requestFrameScreenshot() before reading.
    if (state->screenshotRequested && state->surfaceRenderPassEnded && !state->screenshotCapturedThisFrame && screenshotTexture && state->device && state->queue) {
        // Calculate buffer requirements
        uint32_t bytesPerPixel = 4;  // BGRA8
        uint32_t unalignedBytesPerRow = state->canvasWidth * bytesPerPixel;
        uint32_t bytesPerRow = (unalignedBytesPerRow + 255) & ~255;  // Align to 256
        size_t requiredSize = bytesPerRow * state->canvasHeight;

        // Create or resize screenshot buffer if needed
        if (!state->screenshotBuffer || state->screenshotBufferSize < requiredSize) {
            if (state->screenshotBuffer) {
                wgpuBufferDestroy(state->screenshotBuffer);
                wgpuBufferRelease(state->screenshotBuffer);
            }

            WGPUBufferDescriptor bufferDesc = {};
            bufferDesc.size = requiredSize;
            bufferDesc.usage = WGPUBufferUsage_CopyDst | WGPUBufferUsage_MapRead;
            bufferDesc.mappedAtCreation = false;

            state->screenshotBuffer = wgpuDeviceCreateBuffer(state->device, &bufferDesc);
            state->screenshotBufferSize = requiredSize;
        }
        state->screenshotBytesPerRow = bytesPerRow;

        // Create encoder to copy texture to buffer
        WGPUCommandEncoderDescriptor encDesc = {};
        WGPUCommandEncoder copyEncoder = wgpuDeviceCreateCommandEncoder(state->device, &encDesc);
        if (!requireHandleHostSide(copyEncoder, "screenshot.createCommandEncoder")) return;

        WGPUImageCopyTexture_Compat srcCopy = {};
        srcCopy.texture = screenshotTexture;
        srcCopy.mipLevel = 0;
        srcCopy.origin = {0, 0, 0};
        srcCopy.aspect = WGPUTextureAspect_All;

        WGPUImageCopyBuffer_Compat dstCopy = {};
        dstCopy.buffer = state->screenshotBuffer;
        dstCopy.layout.offset = 0;
        dstCopy.layout.bytesPerRow = bytesPerRow;
        dstCopy.layout.rowsPerImage = state->canvasHeight;

        WGPUExtent3D copySize = {state->canvasWidth, state->canvasHeight, 1};
        wgpuCommandEncoderCopyTextureToBuffer(copyEncoder, &srcCopy, &dstCopy, &copySize);

        if (state->verboseLogging) std::cout << "[Screenshot] Copying from texture " << (void*)screenshotTexture
                  << " (format=" << state->surfaceFormat << ", size=" << state->canvasWidth << "x" << state->canvasHeight << ")" << std::endl;

        WGPUCommandBufferDescriptor cmdDesc = {};
        WGPUCommandBuffer copyCmd = wgpuCommandEncoderFinish(copyEncoder, &cmdDesc);
        if (!requireHandleHostSide(copyCmd, "screenshot.finish")) {
            wgpuCommandEncoderRelease(copyEncoder);
            return;
        }
        wgpuQueueSubmit(state->queue, 1, &copyCmd);

        wgpuCommandBufferRelease(copyCmd);
        wgpuCommandEncoderRelease(copyEncoder);

        // Wait for GPU work to complete before present
        // This ensures the screenshot copy finishes before the texture is released
        for (int syncIter = 0; syncIter < 100; syncIter++) {
#if defined(MYSTRAL_WEBGPU_DAWN)
            wgpuDeviceTick(state->device);
#elif defined(MYSTRAL_WEBGPU_WGPU)
            wgpuDevicePoll(state->device, false, nullptr);
#endif
            if (state->instance) {
                wgpuInstanceProcessEvents(state->instance);
            }
        }

        state->screenshotReady = true;
        state->screenshotRequested = false;
        state->screenshotCapturedThisFrame = true;
    }
}

/**
 * Presents the frame, once, after every rAF callback has returned.
 *
 * The surface used to be presented from inside `queue.submit`. That is wrong for any frame that
 * submits more than once — three.js renders the world and then the framework renders the canvas
 * layer as a second pass — because each submit acquired and presented its own swapchain image.
 * Only the first reached the display, so overlays drew into an image nobody ever saw. Acquisition
 * is idempotent within a frame (see the canvas `getCurrentTexture` binding) and the present
 * happens here, so both passes land on one image and that image is presented once.
 */
static void presentPendingSurface(BindingsState* state) {
    // Exactly one acquire and one release per frame, whether or not anything was presented.
    // Returning early without releasing would strand the acquired swapchain image, and because
    // acquisition is idempotent within a frame every later frame would reuse that stranded image
    // and never present again — a black screen from the first frame that renders nothing.
    // Capture before presenting: the surface texture is still alive and now carries every pass.
    captureFrameScreenshot(state);
    const bool pending = state->framePresentPending;
    state->framePresentPending = false;
    if (!state->currentTexture) return;

    if (pending && state->surface) {
    state->presentCount += 1;
    if (state->verboseLogging) std::cout << "[WebGPU] Presenting surface" << std::endl;
    const auto presentStart = std::chrono::steady_clock::now();
    const bool presented = state->requiresSrgbPresentationBridge
        ? presentLinearTextureToSrgbSurface(state, state->currentTextureView)
        : (wgpuSurfacePresent(state->surface), true);
    state->lastPresentNs = static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::steady_clock::now() - presentStart
        ).count()
    );
#if TN_ANDROID_JS_PROFILE
    state->presentReportedSinceLastPresent = false;
#endif

    if (presented) {
        // The last cold-start segment. Emitted from the present that actually reached the
        // display, so "first frame" means the player saw something rather than the loop merely ran.
        if (!state->firstPresentReported) {
            state->firstPresentReported = true;
            mystral::coldStartMark("first_frame");
            // Same clock, same instant: the attribution for everything that happened before this
            // present, reported against the gap the player just sat through. PRD-218.
            mystral::stallBudget().report(mystral::coldStartNowMs());
        }
        // Hitches are what the player feels after launch, and they are invisible to a mean.
        mystral::frameHitches().record();
    } else {
        std::cerr << "[WebGPU] sRGB presentation bridge failed" << std::endl;
    }
    }

    // Reset surface render tracking for the next frame.
    state->surfaceRenderEncoder = nullptr;
    state->surfaceRenderPassEnded = false;
    state->screenshotCapturedThisFrame = false;

    if (state->currentTextureView) {
        wgpuTextureViewRelease(state->currentTextureView);
        state->currentTextureView = nullptr;
    }

    // Drop every alias so screenshot capture cannot dereference the just-presented surface
    // texture or the consumed linear bridge texture.
    if (state->currentSurfaceTextureId != 0) {
        state->textureRegistry.erase(state->currentSurfaceTextureId);
        state->currentSurfaceTextureId = 0;
    }
    wgpuTextureRelease(state->currentTexture);
    state->currentTexture = nullptr;
    state->currentViewSourceTexture = nullptr;
}

/**
 * Reports frames and presents together, periodically, on every platform.
 *
 * The desktop CLI prints `TN_PRESENTS:<n>` once, at the end of a fixed-frame screenshot run. A
 * device run has no end: the app launches and keeps rendering, so a gate on Android or iOS has
 * nothing to read. Frames and presents are emitted as a pair because the number alone proves
 * nothing — the defect this guards was presents outrunning frames, and only the ratio shows it.
 * On Android `std::cout` goes nowhere, so this also writes to logcat.
 */
static void reportPresentTick(BindingsState* state, uint64_t frames) {
    std::ostringstream output;
    output << "TN_PRESENTS_TICK:{\"frames\":" << frames << ",\"presents\":" << state->presentCount
           << ",\"textureMB\":" << (state->textureBytesLive / 1048576)
           << ",\"textures\":" << state->textureCountLive
           << ",\"bufferMB\":" << (state->bufferBytesLive / 1048576)
           << ",\"capHz\":" << g_presentationCapHz << "}";
    const std::string marker = output.str();
    std::cout << marker << std::endl;
#if defined(__ANDROID__)
    __android_log_print(ANDROID_LOG_INFO, "MystralRuntime", "%s", marker.c_str());
#endif
    // The per-bucket breakdown is the part that names a cause, so it goes out periodically rather
    // than every tick: the running total above is enough to watch growth, and this answers "which
    // allocation" once a run has settled.
    if ((state->reportTickIndex++ % 5) == 0 && !state->textureBuckets.empty()) {
        std::vector<std::pair<std::string, std::pair<uint64_t, uint64_t>>> sorted(
            state->textureBuckets.begin(), state->textureBuckets.end());
        std::sort(sorted.begin(), sorted.end(), [](const auto& a, const auto& b) {
            return a.second.second > b.second.second;
        });
        std::ostringstream buckets;
        buckets << "TN_GPU_TEXTURES:{\"totalMB\":" << (state->textureBytesLive / 1048576)
                << ",\"count\":" << state->textureCountLive << ",\"buckets\":[";
        const size_t limit = sorted.size() < 12 ? sorted.size() : 12;
        for (size_t i = 0; i < limit; i += 1) {
            if (i > 0) buckets << ",";
            buckets << "{\"k\":\"" << sorted[i].first << "\",\"n\":" << sorted[i].second.first
                    << ",\"mb\":" << (sorted[i].second.second / 1048576) << "}";
        }
        buckets << "],\"bucketsTotal\":" << sorted.size() << "}";
        const std::string bucketMarker = buckets.str();
        std::cout << bucketMarker << std::endl;
#if defined(__ANDROID__)
        __android_log_print(ANDROID_LOG_INFO, "MystralRuntime", "%s", bucketMarker.c_str());
#endif
        std::vector<std::pair<std::string, std::pair<uint64_t, uint64_t>>> bufferSorted(
            state->bufferBuckets.begin(), state->bufferBuckets.end());
        std::sort(bufferSorted.begin(), bufferSorted.end(), [](const auto& a, const auto& b) {
            return a.second.second > b.second.second;
        });
        std::ostringstream buffers;
        buffers << "TN_GPU_BUFFERS:{\"totalMB\":" << (state->bufferBytesLive / 1048576)
                << ",\"count\":" << state->bufferCountLive << ",\"buckets\":[";
        const size_t bufferLimit = bufferSorted.size() < 10 ? bufferSorted.size() : 10;
        for (size_t i = 0; i < bufferLimit; i += 1) {
            if (i > 0) buffers << ",";
            buffers << "{\"k\":\"" << bufferSorted[i].first << "\",\"n\":"
                    << bufferSorted[i].second.first << ",\"mb\":"
                    << (bufferSorted[i].second.second / 1048576) << "}";
        }
        buffers << "]}";
        const std::string bufferMarker = buffers.str();
        std::cout << bufferMarker << std::endl;
#if defined(__ANDROID__)
        __android_log_print(ANDROID_LOG_INFO, "MystralRuntime", "%s", bufferMarker.c_str());
#endif
    }
#if defined(__APPLE__)
    // The iOS gate reads the unified log, which `std::cout` does not reach -- the JSC console
    // calls NSLog beside its cout for the same reason. os_log is the C entry point to the same
    // place, so this stays in a .cpp.
    os_log(OS_LOG_DEFAULT, "%{public}s", marker.c_str());
#endif
}

void endDawnFrame(BindingsState* state) {
    // Composite Canvas 2D content to WebGPU if the main canvas uses 2D context
    compositeCanvas2DToWebGPU(state);

    // Every pass this frame has been submitted; put the one image on screen.
    const uint64_t presentsBefore = state->presentCount;
    presentPendingSurface(state);
    // Only a frame that reached the display is paced. See paceToPresentationCap().
    if (state->presentCount != presentsBefore) paceToPresentationCap();

    // One line a second, by the clock and not by the frame count.
    //
    // `% 60` alone is one line a second only if the loop runs at 60 Hz. When a game fails to start
    // there is nothing to present and nothing to wait for, so the loop free-runs: measured at
    // ~96,000 fps on a Pixel 8, which is ~1,600 of these lines a second, ~24,000 in fifteen
    // seconds. That overruns logcat's ring buffer and **evicts the entire startup sequence** —
    // this diagnostic was destroying the evidence for the failure it exists to report, and two
    // wrong conclusions in one debugging session came from reading the buffer it had emptied.
    //
    // The first tick is unconditional so any run of at least 60 frames still emits one and the
    // desktop and device gates keep their `minTicks` guarantee; every tick after it waits a
    // second of wall clock, whatever the loop is doing.
    state->frameEndCount += 1;
    if (state->frameEndCount % 60 == 0) {
        using clock = std::chrono::steady_clock;
        const clock::time_point now = clock::now();
        if (state->reportLastTick == clock::time_point{} ||
            now - state->reportLastTick >= std::chrono::seconds(1)) {
            state->reportLastTick = now;
            reportPresentTick(state, state->frameEndCount);
        }
    }

    // Tick the WebGPU device to process completed GPU work and free internal
    // resources (staging buffers, command encoder state, etc.). Without this,
    // internal objects accumulate unboundedly since completion callbacks never fire.
    if (state->device) {
#if defined(MYSTRAL_WEBGPU_DAWN)
        wgpuDeviceTick(state->device);
#elif defined(MYSTRAL_WEBGPU_WGPU)
        wgpuDevicePoll(state->device, false, nullptr);
#endif
    }
}

}  // namespace webgpu
}  // namespace mystral
